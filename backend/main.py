import os
import json
import math
import uuid
import random
import string
from datetime import datetime, timedelta
from typing import Dict, Optional, List
import asyncpg
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="BibiMarcos API v4 - Production")

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
otp_store: Dict[str, dict] = {}   # telefone → {code, expires_at}


# ============================================================
# BANCO DE DADOS
# ============================================================
async def get_db():
    return await asyncpg.connect(DATABASE_URL)


@app.on_event("startup")
async def startup():
    conn = await get_db()
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
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                accepted_at     TIMESTAMPTZ,
                started_at      TIMESTAMPTZ,
                completed_at    TIMESTAMPTZ,
                cancelled_at    TIMESTAMPTZ
            );
        """)
    finally:
        await conn.close()


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
    """Envia Push Notification via Expo Push API (gratuito, sem Firebase)."""
    if not push_token or not push_token.startswith("ExponentPushToken"):
        return
    import urllib.request
    payload = json.dumps({
        "to": push_token,
        "title": title,
        "body": body,
        "data": data,
        "sound": "default",
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


# ============================================================
# SAÚDE
# ============================================================
@app.get("/")
def root():
    return {
        "status": "online",
        "app": "BibiMarcos API v4",
        "drivers_online": len(online_drivers),
        "active_rides": len([r for r in active_rides.values() if r["status"] not in ("completed","cancelled")]),
    }


# ============================================================
# OTP AUTH
# ============================================================
@app.post("/api/auth/request-otp")
async def request_otp(data: OTPRequest):
    """
    Gera um código OTP de 6 dígitos.
    Em produção: enviar por SMS (Twilio/Z-API) ou WhatsApp.
    Por ora: retorna o código na resposta para testes.
    """
    code = ''.join(random.choices(string.digits, k=6))
    otp_store[data.telefone] = {
        "code": code,
        "expires_at": (datetime.now() + timedelta(minutes=10)).isoformat()
    }
    # TODO produção: enviar via Z-API WhatsApp ou Twilio SMS
    # Por ora: retorna o código (remover em produção real)
    return {
        "message": "Código enviado!",
        "debug_code": code,  # ← remover em produção
        "expires_in": "10 minutos"
    }


@app.post("/api/auth/verify-otp")
async def verify_otp(data: OTPVerify):
    """Verifica o OTP e faz login/registro automático."""
    entry = otp_store.get(data.telefone)
    if not entry:
        raise HTTPException(status_code=400, detail="Código não solicitado. Peça um novo código.")
    if datetime.now() > datetime.fromisoformat(entry["expires_at"]):
        otp_store.pop(data.telefone, None)
        raise HTTPException(status_code=400, detail="Código expirado. Solicite um novo.")
    if entry["code"] != data.code:
        raise HTTPException(status_code=400, detail="Código incorreto.")

    otp_store.pop(data.telefone, None)

    # Busca usuário existente
    conn = await get_db()
    try:
        row = await conn.fetchrow("SELECT * FROM users WHERE telefone=$1", data.telefone)
        if row:
            user = dict(row)
            return {"user_id": user["user_id"], "user": user, "is_new": False}
        else:
            return {"user_id": None, "user": None, "is_new": True, "telefone": data.telefone}
    finally:
        await conn.close()


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
        await conn.execute("""
            INSERT INTO users (user_id, nome, telefone, tipo, chave_pix, veiculo, push_token)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
        """, user_id, data.nome, data.telefone, data.tipo,
            data.chave_pix or "", data.veiculo or "", data.push_token or "")

        row = await conn.fetchrow("SELECT * FROM users WHERE user_id=$1", user_id)
        return {"user_id": user_id, "user": dict(row)}
    finally:
        await conn.close()


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
        await conn.close()


@app.post("/api/users/push-token")
async def update_push_token(data: PushTokenUpdate):
    conn = await get_db()
    try:
        await conn.execute("UPDATE users SET push_token=$1 WHERE user_id=$2", data.push_token, data.user_id)
        return {"status": "ok"}
    finally:
        await conn.close()


@app.get("/api/users/{user_id}")
async def get_user(user_id: str):
    conn = await get_db()
    try:
        row = await conn.fetchrow("SELECT * FROM users WHERE user_id=$1", user_id)
        if not row:
            raise HTTPException(status_code=404, detail="Usuário não encontrado")
        return dict(row)
    finally:
        await conn.close()


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
            "push_token": u.get("push_token", ""),
            "lat": data.get("lat", 0),
            "lng": data.get("lng", 0),
            "status": "available",
        }
        return {"status": "online"}
    finally:
        await conn.close()


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
# CORRIDAS
# ============================================================
@app.post("/api/rides/request")
async def request_ride(data: RideRequest):
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
        pass_row = await conn.fetchrow("SELECT nome FROM users WHERE user_id=$1", data.passenger_id)
        passenger_name = pass_row["nome"] if pass_row else "Passageiro"

        await conn.execute("""
            INSERT INTO rides (ride_id, passenger_id, origin_lat, origin_lng, origin_name,
                dest_lat, dest_lng, dest_name, distance_meters, fare, payment_preference)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        """, ride_id, data.passenger_id, data.origin_lat, data.origin_lng, data.origin_name,
            data.dest_lat, data.dest_lng, data.dest_name, data.distance_meters, fare, data.payment_preference)
    finally:
        await conn.close()

    ride = {
        "ride_id": ride_id,
        "passenger_id": data.passenger_id,
        "passenger_name": passenger_name,
        "driver_id": None,
        "origin_lat": data.origin_lat, "origin_lng": data.origin_lng,
        "origin_name": data.origin_name,
        "dest_lat": data.dest_lat, "dest_lng": data.dest_lng,
        "dest_name": data.dest_name,
        "distance_meters": data.distance_meters,
        "fare": fare,
        "status": "searching",
    }
    active_rides[ride_id] = ride

    # Notifica até 3 motoristas mais próximos via WS + Push
    for uid, d, dist in available[:3]:
        await notify(uid, {"type": "ride_request", "ride": {**ride, "driver_distance_meters": round(dist)}})
        await send_push(
            d.get("push_token", ""),
            "🚗 Nova corrida disponível!",
            f"{passenger_name} • R$ {fare:.2f} • {dist/1000:.1f}km de você",
            {"type": "ride_request", "ride_id": ride_id}
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
        await conn.close()

    await notify(ride["passenger_id"], {"type": "ride_accepted", "ride": ride})
    if pass_row and pass_row["push_token"]:
        await send_push(
            pass_row["push_token"],
            "✅ Motorista encontrado!",
            f"{driver['nome']} • {driver['veiculo']} • a caminho",
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
        await conn.close()

    await notify(ride["passenger_id"], {"type": "driver_arrived", "ride": ride})
    if row and row["push_token"]:
        await send_push(row["push_token"], "🚗 Motorista chegou!", "Seu motorista está no ponto de embarque.", {"type": "driver_arrived"})
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
        await conn.close()

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
        await conn.close()

    await notify(ride["passenger_id"], {"type": "ride_completed", "ride": ride})
    if row and row["push_token"]:
        await send_push(row["push_token"], "🏁 Corrida finalizada!", f"Valor: R$ {ride['fare']:.2f}. Obrigado por usar o BibiMarcos!", {"type": "ride_completed"})
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
        await conn.close()

    await notify(ride["passenger_id"], {"type": "ride_cancelled", "ride": ride})
    if ride.get("driver_id"):
        await notify(ride["driver_id"], {"type": "ride_cancelled", "ride": ride})
    return {"status": "cancelled"}


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
        await conn.close()


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
        await conn.close()


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
                    online_drivers[uid].update({"lat": lat, "lng": lng})
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
        print(f"WS error {user_id}: {e}")
        if user_id:
            ws_connections.pop(user_id, None)
