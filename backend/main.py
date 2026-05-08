import os
import json
import math
import uuid
import urllib.parse
import logging
import asyncio
import random
import string
from datetime import datetime, timedelta
from typing import Dict, Optional, List
import asyncpg
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(
    title="BibiMarcos API v5 - Production",
    # Aumentar limite do corpo da requisição para 50MB (fotos base64)
)

# Middleware de limite de tamanho ANTES do CORS
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import JSONResponse

class LimitUploadSize(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        if request.headers.get('content-length'):
            size = int(request.headers['content-length'])
            if size > 52_428_800:  # 50 MB
                return JSONResponse({'detail': 'Payload muito grande. Use uma imagem menor.'}, status_code=413)
        return await call_next(request)

app.add_middleware(LimitUploadSize)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# CONFIGURAÇÃO
# ============================================================
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/bibimarcos")

# In-memory para estado em tempo real (WebSocket + localização)
online_drivers: Dict[str, dict] = {}
active_rides: Dict[str, dict] = {}
ws_connections: Dict[str, WebSocket] = {}
otp_store: Dict[str, dict] = {}


# ============================================================
# BANCO DE DADOS — Connection Pool
# ============================================================
db_pool = None

async def get_db():
    """Retorna uma conexão do pool."""
    if db_pool is None:
        # Fallback: conexão direta se o pool ainda não foi criado
        return await asyncpg.connect(DATABASE_URL)
    return await db_pool.acquire()

async def release_db(conn):
    """Libera a conexão de volta ao pool (ou fecha diretamente se o pool não existe)."""
    if db_pool is not None:
        await db_pool.release(conn)
    else:
        # Sem pool: apenas fecha a conexão direta — sem recursão
        await conn.close()


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup():
    """
    Startup RESILIENTE — o servidor SEMPRE sobe, mesmo se o Postgres falhar.
    Isso é crítico para o healthcheck do Coolify funcionar.
    Se o banco não estiver disponível, o app roda em modo degradado (in-memory).
    """
    global db_pool
    logger.info("🚀 BibiMarcos API iniciando...")

    # Tenta conectar ao banco com timeout total de 30s
    # Se falhar, o servidor sobe MESMO ASSIM em modo degradado
    try:
        await _init_database()
    except Exception as e:
        logger.error(f"⚠️  Banco de dados não disponível no startup: {e}")
        logger.warning("🟡 Servidor iniciando em MODO DEGRADADO (sem banco). Dados serão in-memory.")

    # Inicia o GC periódico de memória em segundo plano
    asyncio.create_task(_periodic_memory_cleanup())
    logger.info("✅ BibiMarcos API pronta para receber requisições.")


async def _periodic_memory_cleanup():
    """
    Garbage Collector autônomo — roda a cada 5 minutos independente de corridas.
    Previne acúmulo de active_rides concluídas e motoristas zumbis (offline sem avisar).
    """
    while True:
        await asyncio.sleep(300)  # 5 minutos
        try:
            now = datetime.now()
            # 1. Limpar corridas finalizadas ou expiradas do dicionário em memória
            to_delete = [
                k for k, v in active_rides.items()
                if v.get("status") in ("completed", "cancelled")
                or (v.get("status") == "searching" and v.get("created_at")
                    and now - datetime.fromisoformat(v["created_at"]) > timedelta(minutes=30))
            ]
            for k in to_delete:
                active_rides.pop(k, None)

            # 2. Limpar motoristas zumbis (online há mais de 10min sem enviar GPS)
            zombie_drivers = [
                uid for uid, d in online_drivers.items()
                if d.get("last_seen") and now - datetime.fromisoformat(d["last_seen"]) > timedelta(minutes=10)
                and d.get("status") == "available"
            ]
            for uid in zombie_drivers:
                online_drivers.pop(uid, None)
                logger.warning(f"🧟 Motorista zumbi removido: {uid}")

            if to_delete or zombie_drivers:
                logger.info(f"🧹 GC periódico: {len(to_delete)} corridas + {len(zombie_drivers)} motoristas zumbis removidos.")
        except Exception as e:
            logger.error(f"Erro no GC periódico: {e}")



async def _init_database():
    """Inicializa o banco de dados. Lançará exceção se falhar — tratado no startup."""
    global db_pool
    parsed_url = urllib.parse.urlparse(DATABASE_URL)
    db_name = parsed_url.path.lstrip('/')
    sys_url = parsed_url._replace(path='/postgres').geturl()

    # 1. Auto-criar banco se não existir (3 tentativas, 3s entre cada)
    for attempt in range(3):
        try:
            sys_conn = await asyncio.wait_for(
                asyncpg.connect(sys_url),
                timeout=10.0
            )
            exists = await sys_conn.fetchval(
                "SELECT 1 FROM pg_database WHERE datname = $1", db_name
            )
            if not exists:
                logger.info(f"Criando banco '{db_name}'...")
                await sys_conn.execute(f'CREATE DATABASE "{db_name}"')
            logger.info(f"✅ Banco '{db_name}' detectado/criado.")
            await sys_conn.close()
            break
        except Exception as e:
            logger.warning(f"Tentativa {attempt+1}/3 de conexão ao banco falhou: {e}")
            if attempt < 2:
                await asyncio.sleep(3)
            else:
                raise

    # 2. Criar connection pool
    db_pool = await asyncio.wait_for(
        asyncpg.create_pool(
            DATABASE_URL,
            min_size=1,
            max_size=10,
            command_timeout=30,
        ),
        timeout=15.0
    )
    logger.info("✅ Connection pool criado.")

    # 3. Criar/migrar tabelas
    conn = await db_pool.acquire()
    try:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                user_id     TEXT PRIMARY KEY,
                nome        TEXT NOT NULL,
                telefone    TEXT UNIQUE NOT NULL,
                tipo        TEXT NOT NULL CHECK (tipo IN ('motorista', 'passageiro')),
                chave_pix   TEXT DEFAULT '',
                veiculo     TEXT DEFAULT '',
                foto_url    TEXT DEFAULT '',
                avaliacao   REAL DEFAULT 5.0,
                total_corridas INTEGER DEFAULT 0,
                push_token  TEXT DEFAULT '',
                created_at  TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS rides (
                ride_id         TEXT PRIMARY KEY,
                passenger_id    TEXT REFERENCES users(user_id),
                driver_id       TEXT REFERENCES users(user_id),
                origin_lat      DOUBLE PRECISION,
                origin_lng      DOUBLE PRECISION,
                origin_name     TEXT,
                dest_lat        DOUBLE PRECISION,
                dest_lng        DOUBLE PRECISION,
                dest_name       TEXT,
                distance_meters DOUBLE PRECISION,
                fare            DOUBLE PRECISION,
                status          TEXT DEFAULT 'searching',
                payment_method  TEXT,
                payment_preference TEXT DEFAULT 'any',
                passenger_rating INTEGER,
                driver_rating   INTEGER,
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                accepted_at     TIMESTAMPTZ,
                started_at      TIMESTAMPTZ,
                completed_at    TIMESTAMPTZ,
                cancelled_at    TIMESTAMPTZ
            );
        """)
        for col_sql in [
            "ALTER TABLE rides ADD COLUMN IF NOT EXISTS passenger_rating INTEGER;",
            "ALTER TABLE rides ADD COLUMN IF NOT EXISTS driver_rating INTEGER;",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT DEFAULT '';",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS foto_url TEXT DEFAULT '';",
        ]:
            try:
                await conn.execute(col_sql)
            except Exception:
                pass
        logger.info("✅ Tabelas verificadas/criadas com sucesso.")
    finally:
        await db_pool.release(conn)


@app.on_event("shutdown")
async def shutdown():
    global db_pool
    if db_pool:
        await db_pool.close()
        logger.info("🔒 Connection pool fechado.")


# ============================================================
# HELPERS
# ============================================================
def haversine(lat1, lon1, lat2, lon2) -> float:
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1-a))


def calculate_fare(distance_meters: float) -> float:
    km = distance_meters / 1000
    base, rate, minimum = 5.0, 2.20, 8.0
    now = datetime.now()
    h, d = now.hour, now.weekday()
    m = 1.5 if 0 <= h < 6 else (1.3 if h >= 20 and d >= 5 else (1.2 if h >= 20 else (1.15 if d >= 5 else 1.0)))
    return round(max((base + km * rate) * m, minimum), 2)


async def notify(user_id: str, message: dict):
    ws = ws_connections.get(user_id)
    if ws:
        try:
            await ws.send_text(json.dumps(message))
        except:
            ws_connections.pop(user_id, None)


async def send_push(push_token: str, title: str, body: str, data: dict = {}):
    if not push_token or not push_token.startswith("ExponentPushToken"):
        return
    import urllib.request
    payload = json.dumps({
        "to": push_token,
        "title": title,
        "body": body,
        "data": data,
        "sound": "horn.ogg",
        "priority": "high",
        "channelId": "corridas",
    }).encode()
    req = urllib.request.Request(
        "https://exp.host/--/api/v2/push/send",
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST"
    )
    try:
        urllib.request.urlopen(req, timeout=5)
    except:
        pass


# ============================================================
# MODELS
# ============================================================
class RegisterModel(BaseModel):
    nome: str
    telefone: str
    tipo: str
    chave_pix: Optional[str] = None
    veiculo: Optional[str] = None
    push_token: Optional[str] = None
    foto_url: Optional[str] = None


class OTPRequest(BaseModel):
    telefone: str


class OTPVerify(BaseModel):
    telefone: str
    code: str


class RideRequest(BaseModel):
    passenger_id: str
    origin_lat: float
    origin_lng: float
    origin_name: str
    dest_lat: float
    dest_lng: float
    dest_name: str
    distance_meters: float
    payment_preference: Optional[str] = "any"


class RideAction(BaseModel):
    user_id: str


class CompleteRideAction(BaseModel):
    user_id: str
    payment_method: str


class PushTokenUpdate(BaseModel):
    user_id: str
    push_token: str


class RateRequest(BaseModel):
    user_id: str
    rating: int


# ============================================================
# SAÚDE E DIAGNÓSTICO
# ============================================================
@app.get("/")
def root():
    return {
        "status": "online",
        "app": "BibiMarcos API v5",
        "db_connected": db_pool is not None,
        "mode": "full" if db_pool else "degraded_in_memory",
        "drivers_online": len(online_drivers),
        "active_rides": len([r for r in active_rides.values() if r["status"] not in ("completed","cancelled")]),
    }

@app.get("/api/health/ping")
def ping():
    """Endpoint leve para o app e Coolify testarem a conectividade."""
    return {
        "ok": True,
        "ts": datetime.now().isoformat(),
        "db": "connected" if db_pool else "unavailable",
        "mode": "full" if db_pool else "degraded",
    }


# ============================================================
# OTP AUTH
# ============================================================
@app.post("/api/auth/request-otp")
async def request_otp(data: OTPRequest):
    code = ''.join(random.choices(string.digits, k=6))
    otp_store[data.telefone] = {
        "code": code,
        "expires_at": (datetime.now() + timedelta(minutes=10)).isoformat()
    }
    return {
        "message": "Código enviado!",
        "debug_code": code,
        "expires_in": "10 minutos"
    }


@app.post("/api/auth/verify-otp")
async def verify_otp(data: OTPVerify):
    entry = otp_store.get(data.telefone)
    if not entry:
        raise HTTPException(status_code=400, detail="Código não solicitado. Peça um novo código.")
    if datetime.now() > datetime.fromisoformat(entry["expires_at"]):
        otp_store.pop(data.telefone, None)
        raise HTTPException(status_code=400, detail="Código expirado. Solicite um novo.")
    if entry["code"] != data.code:
        raise HTTPException(status_code=400, detail="Código incorreto.")

    otp_store.pop(data.telefone, None)

    conn = await get_db()
    try:
        row = await conn.fetchrow("SELECT * FROM users WHERE telefone=$1", data.telefone)
        if row:
            user = dict(row)
            return {"user_id": user["user_id"], "user": user, "is_new": False}
        else:
            return {"user_id": None, "user": None, "is_new": True, "telefone": data.telefone}
    finally:
        await release_db(conn)



# ============================================================
# RECUPERAÇÃO / TROCA DE NÚMERO
# Como o sistema usa OTP, o número de telefone É a identidade.
# Se o usuário perder acesso ao número, ele solicita troca aqui.
# O fluxo é: OTP no número NOVO + confirmar com nome cadastrado.
# ============================================================

class ChangePhoneRequest(BaseModel):
    novo_telefone: str
    nome_confirmacao: str  # usuário precisa saber o nome cadastrado

class ChangePhoneVerify(BaseModel):
    novo_telefone: str
    nome_confirmacao: str
    code: str

@app.post("/api/auth/change-phone/request")
async def change_phone_request(data: ChangePhoneRequest):
    """Envia OTP para o NOVO número. Usuário precisa informar o nome cadastrado."""
    conn = await get_db()
    try:
        # Verifica se o nome existe (sem revelar dados sensivelmente)
        row = await conn.fetchrow(
            "SELECT user_id FROM users WHERE LOWER(nome) LIKE LOWER($1)",
            f"%{data.nome_confirmacao.strip()}%"
        )
        if not row:
            raise HTTPException(
                status_code=404,
                detail="Nome não encontrado. Verifique o nome exato que usou no cadastro."
            )
    finally:
        await release_db(conn)

    code = ''.join(random.choices(string.digits, k=6))
    otp_store[f"change_{data.novo_telefone}"] = {
        "code": code,
        "expires_at": (datetime.now() + timedelta(minutes=10)).isoformat(),
        "nome_confirmacao": data.nome_confirmacao,
        "novo_telefone": data.novo_telefone,
    }
    logger.info(f"OTP de troca de número para {data.novo_telefone}: {code}")
    return {
        "message": "Código enviado para o novo número!",
        "debug_code": code,
        "expires_in": "10 minutos"
    }

@app.post("/api/auth/change-phone/verify")
async def change_phone_verify(data: ChangePhoneVerify):
    """Confirma o OTP e atualiza o telefone na conta."""
    key = f"change_{data.novo_telefone}"
    entry = otp_store.get(key)
    if not entry:
        raise HTTPException(status_code=400, detail="Solicite um novo código primeiro.")
    if datetime.now() > datetime.fromisoformat(entry["expires_at"]):
        otp_store.pop(key, None)
        raise HTTPException(status_code=400, detail="Código expirado. Solicite um novo.")
    if entry["code"] != data.code:
        raise HTTPException(status_code=400, detail="Código incorreto.")

    conn = await get_db()
    try:
        row = await conn.fetchrow(
            "SELECT user_id, nome FROM users WHERE LOWER(nome) LIKE LOWER($1)",
            f"%{data.nome_confirmacao.strip()}%"
        )
        if not row:
            raise HTTPException(status_code=404, detail="Conta não encontrada.")

        # Verifica se o novo número já está em uso
        existing = await conn.fetchrow("SELECT user_id FROM users WHERE telefone=$1", data.novo_telefone)
        if existing and existing["user_id"] != row["user_id"]:
            raise HTTPException(status_code=409, detail="Este número já está em uso por outra conta.")

        await conn.execute(
            "UPDATE users SET telefone=$1 WHERE user_id=$2",
            data.novo_telefone, row["user_id"]
        )
        otp_store.pop(key, None)
        user = await conn.fetchrow("SELECT * FROM users WHERE user_id=$1", row["user_id"])
        logger.info(f"Telefone do usuário {row['user_id']} atualizado para {data.novo_telefone}")
        return {
            "status": "ok",
            "message": "Número atualizado com sucesso! Faça login com o novo número.",
            "user": dict(user)
        }
    finally:
        await release_db(conn)


# ============================================================
# USUÁRIOS
# ============================================================
@app.post("/api/register")
async def register(data: RegisterModel):
    conn = await get_db()
    try:
        row = await conn.fetchrow("SELECT * FROM users WHERE telefone=$1", data.telefone)
        if row:
            u = dict(row)
            if data.push_token:
                await conn.execute("UPDATE users SET push_token=$1 WHERE user_id=$2", data.push_token, u["user_id"])
                u["push_token"] = data.push_token
            return {"user_id": u["user_id"], "user": u}

        user_id = str(uuid.uuid4())[:8]
        # foto_url pode ser grande (base64) — armazena so se nao exceder 2MB
        foto = data.foto_url or ""
        if len(foto.encode('utf-8')) > 2_097_152:
            foto = ""
            logger.warning(f"foto_url muito grande ({len(foto)} bytes), ignorada no cadastro de {user_id}")

        await conn.execute("""
            INSERT INTO users (user_id, nome, telefone, tipo, chave_pix, veiculo, push_token, foto_url)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        """, user_id, data.nome, data.telefone, data.tipo,
            data.chave_pix or "", data.veiculo or "", data.push_token or "", foto)

        row = await conn.fetchrow("SELECT * FROM users WHERE user_id=$1", user_id)
        return {"user_id": user_id, "user": dict(row)}
    finally:
        await release_db(conn)


class PhotoUpdate(BaseModel):
    user_id: str
    foto_base64: str

@app.post("/api/users/photo")
async def update_photo(data: PhotoUpdate):
    if len(data.foto_base64.encode('utf-8')) > 5_242_880:
        raise HTTPException(status_code=413, detail="Imagem muito grande. Use uma foto menor que 5MB.")
    conn = await get_db()
    try:
        await conn.execute("UPDATE users SET foto_url=$1 WHERE user_id=$2", data.foto_base64, data.user_id)
        return {"status": "ok"}
    finally:
        await release_db(conn)



@app.post("/api/login")
async def login(data: dict):
    telefone = data.get("telefone", "")
    conn = await get_db()
    try:
        row = await conn.fetchrow("SELECT * FROM users WHERE telefone=$1", telefone)
        if not row:
            raise HTTPException(status_code=404, detail="Usuário não encontrado. Cadastre-se primeiro.")
        u = dict(row)
        if data.get("push_token"):
            await conn.execute("UPDATE users SET push_token=$1 WHERE user_id=$2", data["push_token"], u["user_id"])
            u["push_token"] = data["push_token"]
        return {"user_id": u["user_id"], "user": u}
    finally:
        await release_db(conn)


@app.post("/api/users/push-token")
async def update_push_token(data: PushTokenUpdate):
    conn = await get_db()
    try:
        await conn.execute("UPDATE users SET push_token=$1 WHERE user_id=$2", data.push_token, data.user_id)
        return {"status": "ok"}
    finally:
        await release_db(conn)


@app.get("/api/users/{user_id}")
async def get_user(user_id: str):
    conn = await get_db()
    try:
        row = await conn.fetchrow("SELECT * FROM users WHERE user_id=$1", user_id)
        if not row:
            raise HTTPException(status_code=404, detail="Usuário não encontrado")
        return dict(row)
    finally:
        await release_db(conn)


@app.get("/api/users/{user_id}/active-ride")
async def get_active_ride(user_id: str):
    # Procura na memória por qualquer corrida não finalizada onde o usuário seja motorista ou passageiro
    for r in active_rides.values():
        if (r.get("passenger_id") == user_id or r.get("driver_id") == user_id) and r.get("status") not in ("completed", "cancelled"):
            return r
    return {}


class LocationUpdateSchema(BaseModel):
    user_id: str
    lat: float
    lng: float

@app.post("/api/drivers/location-update")
async def update_bg_location(data: LocationUpdateSchema):
    uid = data.user_id
    if uid in online_drivers:
        online_drivers[uid].update({"lat": data.lat, "lng": data.lng, "last_seen": datetime.now().isoformat()})
        # Notifica o passageiro se estiver em corrida
        for ride in active_rides.values():
            if ride.get("driver_id") == uid and ride.get("status") in ("accepted", "driver_arrived", "in_ride"):
                await notify(ride["passenger_id"], {
                    "type": "driver_location", "lat": data.lat, "lng": data.lng, "ride_id": ride["ride_id"]
                })
    return {"status": "ok"}


# ============================================================
# MOTORISTAS
# ============================================================
@app.post("/api/drivers/online")
async def go_online(data: dict):
    user_id = data.get("user_id")
    conn = await get_db()
    try:
        row = await conn.fetchrow("SELECT * FROM users WHERE user_id=$1 AND tipo='motorista'", user_id)
        if not row:
            raise HTTPException(status_code=404, detail="Motorista não encontrado")
        u = dict(row)
        online_drivers[user_id] = {
            "user_id": user_id,
            "nome": u["nome"],
            "chave_pix": u.get("chave_pix", ""),
            "veiculo": u.get("veiculo", ""),
            "avaliacao": u.get("avaliacao", 5.0),
            "foto_url": u.get("foto_url", ""),
            "push_token": u.get("push_token", ""),
            "lat": data.get("lat", 0),
            "lng": data.get("lng", 0),
            "status": "available",
        }
        return {"status": "online"}
    finally:
        await release_db(conn)


@app.post("/api/drivers/offline")
def go_offline(data: dict):
    online_drivers.pop(data.get("user_id"), None)
    return {"status": "offline"}


@app.get("/api/drivers/nearby")
def get_nearby_drivers(lat: float, lng: float, radius: float = 10000):
    nearby = []
    for uid, d in online_drivers.items():
        if d.get("status") == "in_ride":
            continue
        dist = haversine(lat, lng, d["lat"], d["lng"])
        if dist <= radius:
            nearby.append({**d, "distance_meters": round(dist)})
    nearby.sort(key=lambda x: x["distance_meters"])
    return {"drivers": nearby, "count": len(nearby)}


# ============================================================
# CORRIDAS E AVALIAÇÕES
# ============================================================
@app.post("/api/rides/request")
async def request_ride(data: RideRequest):
    # Garbage Collector: Prevenção de Memory Leak em produção
    now = datetime.now()
    to_delete = []
    for k, v in active_rides.items():
        if v.get("status") in ("completed", "cancelled"):
            to_delete.append(k)
        elif v.get("status") == "searching" and v.get("created_at"):
            try:
                if now - datetime.fromisoformat(v["created_at"]) > timedelta(minutes=30):
                    to_delete.append(k)
            except: pass
    for k in to_delete:
        active_rides.pop(k, None)

    available = []
    for uid, d in online_drivers.items():
        if d.get("status") == "in_ride":
            continue
        dist = haversine(data.origin_lat, data.origin_lng, d["lat"], d["lng"])
        available.append((uid, d, dist))

    if not available:
        raise HTTPException(status_code=404, detail="Nenhum motorista disponível. Tente novamente em instantes.")

    available.sort(key=lambda x: x[2])
    fare = calculate_fare(data.distance_meters)
    ride_id = str(uuid.uuid4())[:8]

    conn = await get_db()
    try:
        pass_row = await conn.fetchrow("SELECT nome, avaliacao, foto_url FROM users WHERE user_id=$1", data.passenger_id)
        passenger_name = pass_row["nome"] if pass_row else "Passageiro"
        passenger_avaliacao = pass_row["avaliacao"] if pass_row else 5.0
        passenger_foto_url = pass_row["foto_url"] if pass_row else ""

        await conn.execute("""
            INSERT INTO rides (ride_id, passenger_id, origin_lat, origin_lng, origin_name,
                dest_lat, dest_lng, dest_name, distance_meters, fare, payment_preference)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        """, ride_id, data.passenger_id, data.origin_lat, data.origin_lng, data.origin_name,
            data.dest_lat, data.dest_lng, data.dest_name, data.distance_meters, fare, data.payment_preference)
    finally:
        await release_db(conn)

    ride = {
        "ride_id": ride_id,
        "passenger_id": data.passenger_id,
        "passenger_name": passenger_name,
        "passenger_avaliacao": passenger_avaliacao,
        "passenger_foto_url": passenger_foto_url,
        "driver_id": None,
        "origin_lat": data.origin_lat, "origin_lng": data.origin_lng,
        "origin_name": data.origin_name,
        "dest_lat": data.dest_lat, "dest_lng": data.dest_lng,
        "dest_name": data.dest_name,
        "distance_meters": data.distance_meters,
        "fare": fare,
        "payment_preference": data.payment_preference,
        "status": "searching",
        "created_at": datetime.now().isoformat()
    }
    active_rides[ride_id] = ride

    for uid, d, dist in available[:3]:
        await notify(uid, {"type": "ride_request", "ride": {**ride, "driver_distance_meters": round(dist)}})
        await send_push(
            d.get("push_token", ""),
            "🚗 Nova corrida disponível!",
            f"{data.payment_preference} • R$ {fare:.2f} • {dist/1000:.1f}km até você",
            {"type": "ride_request", "ride_id": ride_id, "ride": {**ride, "driver_distance_meters": round(dist)}}
        )

    return {"ride_id": ride_id, "fare": fare, "status": "searching"}


@app.post("/api/rides/{ride_id}/accept")
async def accept_ride(ride_id: str, data: RideAction):
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    ride = active_rides[ride_id]
    if ride["status"] != "searching":
        raise HTTPException(status_code=400, detail="Corrida não disponível")
    driver = online_drivers.get(data.user_id)
    if not driver:
        raise HTTPException(status_code=400, detail="Motorista não online")

    ride.update({
        "driver_id": data.user_id,
        "driver_name": driver["nome"],
        "driver_chave_pix": driver["chave_pix"],
        "driver_veiculo": driver["veiculo"],
        "driver_avaliacao": driver.get("avaliacao", 5.0),
        "driver_foto_url": driver.get("foto_url", ""),
        "status": "accepted",
    })
    online_drivers[data.user_id]["status"] = "in_ride"

    conn = await get_db()
    try:
        await conn.execute(
            "UPDATE rides SET driver_id=$1, status='accepted', accepted_at=NOW() WHERE ride_id=$2",
            data.user_id, ride_id
        )
        pass_row = await conn.fetchrow("SELECT push_token FROM users WHERE user_id=$1", ride["passenger_id"])
    finally:
        await release_db(conn)

    await notify(ride["passenger_id"], {"type": "ride_accepted", "ride": ride})
    if pass_row and pass_row["push_token"]:
        await send_push(
            pass_row["push_token"],
            "✅ Motorista a caminho!",
            f"{driver['nome']} (⭐{driver.get('avaliacao',5.0):.1f}) • {driver['veiculo']}",
            {"type": "ride_accepted", "ride_id": ride_id}
        )
    return {"status": "accepted", "ride": ride}


@app.post("/api/rides/{ride_id}/arrived")
async def driver_arrived(ride_id: str, data: RideAction):
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    ride = active_rides[ride_id]
    ride["status"] = "driver_arrived"

    conn = await get_db()
    try:
        await conn.execute("UPDATE rides SET status='driver_arrived' WHERE ride_id=$1", ride_id)
        row = await conn.fetchrow("SELECT push_token FROM users WHERE user_id=$1", ride["passenger_id"])
    finally:
        await release_db(conn)

    await notify(ride["passenger_id"], {"type": "driver_arrived", "ride": ride})
    if row and row["push_token"]:
        await send_push(row["push_token"], "🚗 Motorista chegou!", "Seu motorista está no local.", {"type": "driver_arrived"})
    return {"status": "driver_arrived"}


@app.post("/api/rides/{ride_id}/start")
async def start_ride(ride_id: str, data: RideAction):
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    ride = active_rides[ride_id]
    ride["status"] = "in_ride"

    conn = await get_db()
    try:
        await conn.execute("UPDATE rides SET status='in_ride', started_at=NOW() WHERE ride_id=$1", ride_id)
    finally:
        await release_db(conn)

    await notify(ride["passenger_id"], {"type": "ride_started", "ride": ride})
    return {"status": "in_ride"}


@app.post("/api/rides/{ride_id}/complete")
async def complete_ride(ride_id: str, data: CompleteRideAction):
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    ride = active_rides[ride_id]
    ride["status"] = "completed"
    ride["payment_method"] = data.payment_method

    if data.user_id in online_drivers:
        online_drivers[data.user_id]["status"] = "available"

    conn = await get_db()
    try:
        await conn.execute(
            "UPDATE rides SET status='completed', completed_at=NOW(), payment_method=$1 WHERE ride_id=$2",
            data.payment_method, ride_id
        )
        await conn.execute("UPDATE users SET total_corridas=total_corridas+1 WHERE user_id=$1", data.user_id)
        await conn.execute("UPDATE users SET total_corridas=total_corridas+1 WHERE user_id=$1", ride["passenger_id"])
        row = await conn.fetchrow("SELECT push_token FROM users WHERE user_id=$1", ride["passenger_id"])
    finally:
        await release_db(conn)

    await notify(ride["passenger_id"], {"type": "ride_completed", "ride": ride})
    if row and row["push_token"]:
        await send_push(row["push_token"], "🏁 Corrida finalizada!", f"Valor: R$ {ride['fare']:.2f}. Avalie no app!", {"type": "ride_completed"})
    return {"status": "completed", "ride": ride}


@app.post("/api/rides/{ride_id}/cancel")
async def cancel_ride(ride_id: str, data: RideAction):
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    ride = active_rides[ride_id]

    if data.user_id != ride.get("passenger_id") and data.user_id != ride.get("driver_id"):
        raise HTTPException(status_code=403, detail="Não autorizado")

    ride["status"] = "cancelled"
    if ride.get("driver_id") and ride["driver_id"] in online_drivers:
        online_drivers[ride["driver_id"]]["status"] = "available"

    conn = await get_db()
    try:
        await conn.execute("UPDATE rides SET status='cancelled', cancelled_at=NOW() WHERE ride_id=$1", ride_id)
    finally:
        await release_db(conn)

    await notify(ride["passenger_id"], {"type": "ride_cancelled", "ride": ride})
    if ride.get("driver_id"):
        await notify(ride["driver_id"], {"type": "ride_cancelled", "ride": ride})
    return {"status": "cancelled"}


@app.post("/api/rides/{ride_id}/rate")
async def rate_ride(ride_id: str, data: RateRequest):
    conn = await get_db()
    try:
        ride = await conn.fetchrow("SELECT * FROM rides WHERE ride_id=$1", ride_id)
        if not ride:
            raise HTTPException(status_code=404, detail="Corrida não encontrada")
        
        is_passenger = ride["passenger_id"] == data.user_id
        is_driver = ride["driver_id"] == data.user_id
        
        if not (is_passenger or is_driver):
            raise HTTPException(status_code=403, detail="Não autorizado")
            
        target_user_id = ride["driver_id"] if is_passenger else ride["passenger_id"]
        column_to_update = "driver_rating" if is_passenger else "passenger_rating"
        
        await conn.execute(f"UPDATE rides SET {column_to_update}=$1 WHERE ride_id=$2", data.rating, ride_id)
        
        avg_row = await conn.fetchrow(f"SELECT AVG({column_to_update}) as media FROM rides WHERE {'driver_id' if is_passenger else 'passenger_id'}=$1 AND {column_to_update} IS NOT NULL", target_user_id)
        media = round(avg_row["media"], 1) if avg_row["media"] else 5.0
        
        await conn.execute("UPDATE users SET avaliacao=$1 WHERE user_id=$2", media, target_user_id)
        if target_user_id in online_drivers:
            online_drivers[target_user_id]["avaliacao"] = media
            
        return {"status": "ok", "new_rating": media}
    finally:
        await release_db(conn)


@app.get("/api/rides/history/{user_id}")
async def get_history(user_id: str):
    conn = await get_db()
    try:
        rows = await conn.fetch("""
            SELECT r.*, u.nome as driver_nome FROM rides r
            LEFT JOIN users u ON r.driver_id = u.user_id
            WHERE r.passenger_id=$1 OR r.driver_id=$1
            ORDER BY r.created_at DESC LIMIT 20
        """, user_id)
        return {"rides": [dict(r) for r in rows]}
    finally:
        await release_db(conn)


@app.get("/api/rides/{ride_id}")
async def get_ride(ride_id: str):
    if ride_id in active_rides:
        return active_rides[ride_id]
    conn = await get_db()
    try:
        row = await conn.fetchrow("SELECT * FROM rides WHERE ride_id=$1", ride_id)
        if not row:
            raise HTTPException(status_code=404, detail="Corrida não encontrada")
        return dict(row)
    finally:
        await release_db(conn)


# ============================================================
# WEBSOCKET
# ============================================================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    user_id = None
    try:
        while True:
            raw = await websocket.receive_text()
            payload = json.loads(raw)
            t = payload.get("type")

            if t == "register":
                user_id = payload.get("user_id")
                ws_connections[user_id] = websocket
                await websocket.send_text(json.dumps({"type": "registered", "user_id": user_id}))

            elif t == "location_update":
                uid = payload.get("user_id", user_id)
                lat, lng = payload.get("lat"), payload.get("lng")
                if uid and lat and lng and uid in online_drivers:
                    online_drivers[uid].update({"lat": lat, "lng": lng, "last_seen": datetime.now().isoformat()})
                    for ride in active_rides.values():
                        if ride.get("driver_id") == uid and ride["status"] in ("accepted","driver_arrived","in_ride"):
                            await notify(ride["passenger_id"], {"type":"driver_location","lat":lat,"lng":lng,"ride_id":ride["ride_id"]})

            elif t == "chat":
                ride_id = payload.get("ride_id")
                if ride_id and ride_id in active_rides:
                    ride = active_rides[ride_id]
                    sender_id = payload.get("sender_id")
                    other_id = ride.get("driver_id") if sender_id == ride.get("passenger_id") else ride.get("passenger_id")
                    enriched = {**payload, "timestamp": datetime.now().isoformat()}
                    if other_id:
                        await notify(other_id, enriched)
                    await websocket.send_text(json.dumps({**enriched, "delivered": True}))

            elif t == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

    except WebSocketDisconnect:
        if user_id:
            ws_connections.pop(user_id, None)
    except Exception as e:
        if user_id:
            ws_connections.pop(user_id, None)
