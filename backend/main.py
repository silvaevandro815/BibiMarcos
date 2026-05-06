import os
import json
import math
import uuid
from datetime import datetime
from typing import Dict, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="BibiMarcos API v3 - Uber Clone")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# IN-MEMORY STATE (funciona sem banco de dados externo)
# ============================================================
users: Dict[str, dict] = {}
online_drivers: Dict[str, dict] = {}
active_rides: Dict[str, dict] = {}
ws_connections: Dict[str, WebSocket] = {}
ride_history: List[dict] = []


# ============================================================
# HELPERS
# ============================================================
def haversine(lat1, lon1, lat2, lon2) -> float:
    """Calcula a distância em metros entre duas coordenadas GPS."""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def calculate_fare(distance_meters: float) -> float:
    """
    Calcula a tarifa baseado em:
    - Taxa base: R$ 5,00
    - R$ 2,20 por km
    - Tarifa mínima: R$ 8,00
    - Multiplicador noturno / fim de semana
    """
    distance_km = distance_meters / 1000
    base_fare = 5.00
    rate_per_km = 2.20
    min_fare = 8.00
    now = datetime.now()
    hour = now.hour
    day = now.weekday()
    is_weekend = day >= 5
    multiplier = 1.0
    if 0 <= hour < 6:
        multiplier = 1.5       # Madrugada
    elif 20 <= hour <= 23:
        multiplier = 1.3 if is_weekend else 1.2  # Noite
    elif is_weekend:
        multiplier = 1.15      # Fim de semana diurno
    final = max((base_fare + distance_km * rate_per_km) * multiplier, min_fare)
    return round(final, 2)


async def notify(user_id: str, message: dict):
    """Envia mensagem WebSocket para um usuário específico."""
    ws = ws_connections.get(user_id)
    if ws:
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            ws_connections.pop(user_id, None)


# ============================================================
# MODELS
# ============================================================
class RegisterModel(BaseModel):
    nome: str
    telefone: str
    tipo: str  # 'motorista' | 'passageiro'
    chave_pix: Optional[str] = None
    veiculo: Optional[str] = None
    foto_url: Optional[str] = None


class LocationUpdate(BaseModel):
    user_id: str
    lat: float
    lng: float


class RideRequest(BaseModel):
    passenger_id: str
    origin_lat: float
    origin_lng: float
    origin_name: str
    dest_lat: float
    dest_lng: float
    dest_name: str
    distance_meters: float
    payment_preference: Optional[str] = "any"  # 'pix' | 'cash' | 'any'


class RideAction(BaseModel):
    user_id: str


class CompleteRideAction(BaseModel):
    user_id: str
    payment_method: str  # 'pix' | 'cash'


# ============================================================
# ENDPOINTS DE SAÚDE
# ============================================================
@app.get("/")
def root():
    return {
        "status": "online",
        "app": "BibiMarcos API v3",
        "docs": "/docs",
        "drivers_online": len(online_drivers),
        "active_rides": len([r for r in active_rides.values() if r["status"] not in ("completed", "cancelled")]),
    }


# ============================================================
# ENDPOINTS DE USUÁRIO
# ============================================================
@app.post("/api/register")
def register(data: RegisterModel):
    # Se já existe pelo telefone, retorna o existente
    for uid, u in users.items():
        if u["telefone"] == data.telefone:
            # Atualiza info se necessário
            if data.tipo:
                u["tipo"] = data.tipo
            return {"user_id": uid, "user": u}
    user_id = str(uuid.uuid4())[:8]
    user = {
        "user_id": user_id,
        "nome": data.nome,
        "telefone": data.telefone,
        "tipo": data.tipo,
        "chave_pix": data.chave_pix or "",
        "veiculo": data.veiculo or "Não informado",
        "foto_url": data.foto_url or "",
        "avaliacao": 5.0,
        "total_corridas": 0,
        "created_at": datetime.now().isoformat(),
    }
    users[user_id] = user
    return {"user_id": user_id, "user": user}


@app.post("/api/login")
def login(data: dict):
    telefone = data.get("telefone", "")
    for uid, u in users.items():
        if u["telefone"] == telefone:
            return {"user_id": uid, "user": u}
    raise HTTPException(status_code=404, detail="Usuário não encontrado. Cadastre-se primeiro.")


@app.get("/api/users/{user_id}")
def get_user(user_id: str):
    if user_id not in users:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    return users[user_id]


# ============================================================
# ENDPOINTS DE MOTORISTA
# ============================================================
@app.post("/api/drivers/online")
async def go_online(data: dict):
    user_id = data.get("user_id")
    if not user_id or user_id not in users:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    user = users[user_id]
    if user["tipo"] != "motorista":
        raise HTTPException(status_code=400, detail="Usuário não é motorista")
    online_drivers[user_id] = {
        "user_id": user_id,
        "nome": user["nome"],
        "chave_pix": user.get("chave_pix", ""),
        "veiculo": user.get("veiculo", ""),
        "avaliacao": user.get("avaliacao", 5.0),
        "foto_url": user.get("foto_url", ""),
        "lat": data.get("lat", 0),
        "lng": data.get("lng", 0),
        "updated_at": datetime.now().isoformat(),
        "status": "available",  # available | in_ride
    }
    return {"status": "online", "driver": online_drivers[user_id]}


@app.post("/api/drivers/offline")
def go_offline(data: dict):
    user_id = data.get("user_id")
    online_drivers.pop(user_id, None)
    return {"status": "offline"}


@app.get("/api/drivers/nearby")
def get_nearby_drivers(lat: float, lng: float, radius: float = 10000):
    """Retorna motoristas disponíveis dentro do raio (em metros)."""
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
# ENDPOINTS DE CORRIDA
# ============================================================
@app.post("/api/rides/request")
async def request_ride(data: RideRequest):
    """
    Solicita uma corrida. O sistema encontra os 3 motoristas mais próximos
    e os notifica via WebSocket para aceitar ou recusar.
    """
    # Encontra motoristas disponíveis
    available = []
    for uid, d in online_drivers.items():
        if d.get("status") == "in_ride":
            continue
        dist = haversine(data.origin_lat, data.origin_lng, d["lat"], d["lng"])
        available.append((uid, d, dist))

    if not available:
        raise HTTPException(
            status_code=404,
            detail="Nenhum motorista disponível no momento. Tente novamente em instantes."
        )

    available.sort(key=lambda x: x[2])
    fare = calculate_fare(data.distance_meters)
    ride_id = str(uuid.uuid4())[:8]

    ride = {
        "ride_id": ride_id,
        "passenger_id": data.passenger_id,
        "passenger_name": users.get(data.passenger_id, {}).get("nome", "Passageiro"),
        "passenger_avaliacao": users.get(data.passenger_id, {}).get("avaliacao", 5.0),
        "driver_id": None,
        "driver_name": None,
        "driver_chave_pix": None,
        "driver_veiculo": None,
        "driver_avaliacao": None,
        "origin_lat": data.origin_lat,
        "origin_lng": data.origin_lng,
        "origin_name": data.origin_name,
        "dest_lat": data.dest_lat,
        "dest_lng": data.dest_lng,
        "dest_name": data.dest_name,
        "distance_meters": data.distance_meters,
        "fare": fare,
        "payment_preference": data.payment_preference,
        "payment_method": None,
        "status": "searching",
        "created_at": datetime.now().isoformat(),
        "accepted_at": None,
        "started_at": None,
        "completed_at": None,
    }
    active_rides[ride_id] = ride

    # Notifica os 3 motoristas mais próximos
    notified = 0
    for uid, d, dist in available[:3]:
        await notify(uid, {
            "type": "ride_request",
            "ride": {**ride, "driver_distance_meters": round(dist)},
        })
        notified += 1

    return {"ride_id": ride_id, "fare": fare, "status": "searching", "drivers_notified": notified}


@app.post("/api/rides/{ride_id}/accept")
async def accept_ride(ride_id: str, data: RideAction):
    """Motorista aceita a corrida."""
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    ride = active_rides[ride_id]
    if ride["status"] != "searching":
        raise HTTPException(status_code=400, detail="Corrida não está mais disponível")
    driver = online_drivers.get(data.user_id)
    if not driver:
        raise HTTPException(status_code=400, detail="Motorista não está online")

    ride["driver_id"] = data.user_id
    ride["driver_name"] = driver["nome"]
    ride["driver_chave_pix"] = driver["chave_pix"]
    ride["driver_veiculo"] = driver.get("veiculo", "")
    ride["driver_avaliacao"] = driver.get("avaliacao", 5.0)
    ride["status"] = "accepted"
    ride["accepted_at"] = datetime.now().isoformat()
    online_drivers[data.user_id]["status"] = "in_ride"

    # Notifica o passageiro
    await notify(ride["passenger_id"], {"type": "ride_accepted", "ride": ride})
    return {"status": "accepted", "ride": ride}


@app.post("/api/rides/{ride_id}/arrived")
async def driver_arrived(ride_id: str, data: RideAction):
    """Motorista chegou ao ponto de embarque."""
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    ride = active_rides[ride_id]
    if ride.get("driver_id") != data.user_id:
        raise HTTPException(status_code=403, detail="Não autorizado")
    ride["status"] = "driver_arrived"
    await notify(ride["passenger_id"], {"type": "driver_arrived", "ride": ride})
    return {"status": "driver_arrived"}


@app.post("/api/rides/{ride_id}/start")
async def start_ride(ride_id: str, data: RideAction):
    """Motorista inicia a corrida (passageiro embarcou)."""
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    ride = active_rides[ride_id]
    if ride.get("driver_id") != data.user_id:
        raise HTTPException(status_code=403, detail="Não autorizado")
    ride["status"] = "in_ride"
    ride["started_at"] = datetime.now().isoformat()
    await notify(ride["passenger_id"], {"type": "ride_started", "ride": ride})
    return {"status": "in_ride"}


@app.post("/api/rides/{ride_id}/complete")
async def complete_ride(ride_id: str, data: CompleteRideAction):
    """Motorista finaliza a corrida."""
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    ride = active_rides[ride_id]
    if ride.get("driver_id") != data.user_id:
        raise HTTPException(status_code=403, detail="Não autorizado")

    ride["status"] = "completed"
    ride["completed_at"] = datetime.now().isoformat()
    ride["payment_method"] = data.payment_method

    # Incrementa contador de corridas dos usuários
    if data.user_id in users:
        users[data.user_id]["total_corridas"] = users[data.user_id].get("total_corridas", 0) + 1
    passenger_id = ride.get("passenger_id")
    if passenger_id and passenger_id in users:
        users[passenger_id]["total_corridas"] = users[passenger_id].get("total_corridas", 0) + 1

    # Libera o motorista
    if data.user_id in online_drivers:
        online_drivers[data.user_id]["status"] = "available"

    # Notifica passageiro para pagar
    await notify(ride["passenger_id"], {"type": "ride_completed", "ride": ride})

    # Arquiva corrida no histórico
    ride_history.append({**ride})
    return {"status": "completed", "ride": ride}


@app.post("/api/rides/{ride_id}/cancel")
async def cancel_ride(ride_id: str, data: RideAction):
    """Cancela uma corrida (passageiro ou motorista pode cancelar)."""
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    ride = active_rides[ride_id]

    # Verificar se é passageiro ou motorista da corrida
    if data.user_id != ride.get("passenger_id") and data.user_id != ride.get("driver_id"):
        raise HTTPException(status_code=403, detail="Não autorizado")

    ride["status"] = "cancelled"
    ride["cancelled_at"] = datetime.now().isoformat()

    # Libera o motorista se havia um
    if ride.get("driver_id") and ride["driver_id"] in online_drivers:
        online_drivers[ride["driver_id"]]["status"] = "available"

    # Notifica ambos
    await notify(ride["passenger_id"], {"type": "ride_cancelled", "ride": ride, "by": data.user_id})
    if ride.get("driver_id"):
        await notify(ride["driver_id"], {"type": "ride_cancelled", "ride": ride, "by": data.user_id})

    return {"status": "cancelled"}


@app.get("/api/rides/{ride_id}")
def get_ride(ride_id: str):
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    return active_rides[ride_id]


@app.get("/api/rides/history/{user_id}")
def get_history(user_id: str):
    """Retorna histórico de corridas do usuário."""
    result = [
        r for r in ride_history
        if r.get("passenger_id") == user_id or r.get("driver_id") == user_id
    ]
    result.sort(key=lambda x: x.get("completed_at", ""), reverse=True)
    return {"rides": result[:20]}


# ============================================================
# WEBSOCKET - Hub Central de Eventos em Tempo Real
# ============================================================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    user_id = None
    try:
        while True:
            raw = await websocket.receive_text()
            payload = json.loads(raw)
            msg_type = payload.get("type")

            # ── Registro do usuário na conexão ──────────────────────
            if msg_type == "register":
                user_id = payload.get("user_id")
                ws_connections[user_id] = websocket
                await websocket.send_text(json.dumps({
                    "type": "registered",
                    "user_id": user_id,
                    "timestamp": datetime.now().isoformat()
                }))

            # ── Atualização de localização do motorista ─────────────
            elif msg_type == "location_update":
                uid = payload.get("user_id", user_id)
                lat = payload.get("lat")
                lng = payload.get("lng")
                if uid and lat and lng:
                    if uid in online_drivers:
                        online_drivers[uid]["lat"] = lat
                        online_drivers[uid]["lng"] = lng
                        online_drivers[uid]["updated_at"] = datetime.now().isoformat()

                    # Notifica o passageiro de cada corrida ativa deste motorista
                    for ride in active_rides.values():
                        if ride.get("driver_id") == uid and ride["status"] in ("accepted", "driver_arrived", "in_ride"):
                            await notify(ride["passenger_id"], {
                                "type": "driver_location",
                                "lat": lat,
                                "lng": lng,
                                "ride_id": ride["ride_id"],
                            })

            # ── Chat por corrida ─────────────────────────────────────
            elif msg_type == "chat":
                ride_id = payload.get("ride_id")
                if ride_id and ride_id in active_rides:
                    ride = active_rides[ride_id]
                    sender_id = payload.get("sender_id")

                    # Define o destinatário (o outro lado da corrida)
                    if sender_id == ride.get("passenger_id"):
                        other_id = ride.get("driver_id")
                    else:
                        other_id = ride.get("passenger_id")

                    enriched = {
                        **payload,
                        "timestamp": datetime.now().isoformat()
                    }
                    # Envia para o outro lado
                    if other_id:
                        await notify(other_id, enriched)
                    # Confirma para o remetente
                    await websocket.send_text(json.dumps({**enriched, "delivered": True}))

            # ── Ping/Pong para manter conexão viva ──────────────────
            elif msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

    except WebSocketDisconnect:
        if user_id:
            ws_connections.pop(user_id, None)
    except Exception as e:
        print(f"WebSocket error for {user_id}: {e}")
        if user_id:
            ws_connections.pop(user_id, None)
