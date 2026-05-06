import os
import json
import math
import uuid
from datetime import datetime
from typing import Dict, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="BibiMarcos API v2")

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


# ============================================================
# HELPERS
# ============================================================
def haversine(lat1, lon1, lat2, lon2) -> float:
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def calculate_fare(distance_meters: float) -> float:
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
        multiplier = 1.5
    elif 20 <= hour <= 23:
        multiplier = 1.3 if is_weekend else 1.2
    elif is_weekend:
        multiplier = 1.2
    final = max((base_fare + distance_km * rate_per_km) * multiplier, min_fare)
    return round(final, 2)


async def notify_user(user_id: str, message: dict):
    ws = ws_connections.get(user_id)
    if ws:
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            pass


# ============================================================
# MODELS
# ============================================================
class RegisterModel(BaseModel):
    nome: str
    telefone: str
    tipo: str  # 'motorista' | 'passageiro'
    chave_pix: Optional[str] = None
    veiculo: Optional[str] = None


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


class RideAction(BaseModel):
    user_id: str


# ============================================================
# ENDPOINTS DE USUÁRIO
# ============================================================
@app.get("/")
def root():
    return {"status": "BibiMarcos API v2 online!"}


@app.post("/api/register")
def register(data: RegisterModel):
    for uid, u in users.items():
        if u["telefone"] == data.telefone:
            return {"user_id": uid, "user": u}
    user_id = str(uuid.uuid4())[:8]
    user = {
        "user_id": user_id,
        "nome": data.nome,
        "telefone": data.telefone,
        "tipo": data.tipo,
        "chave_pix": data.chave_pix or "",
        "veiculo": data.veiculo or "Não informado",
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
    raise HTTPException(status_code=404, detail="Usuário não encontrado")


# ============================================================
# ENDPOINTS DE MOTORISTA
# ============================================================
@app.post("/api/drivers/online")
async def go_online(data: dict):
    user_id = data.get("user_id")
    if user_id not in users:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    user = users[user_id]
    online_drivers[user_id] = {
        "user_id": user_id,
        "nome": user["nome"],
        "chave_pix": user.get("chave_pix", ""),
        "veiculo": user.get("veiculo", ""),
        "lat": data.get("lat", 0),
        "lng": data.get("lng", 0),
        "updated_at": datetime.now().isoformat(),
    }
    return {"status": "online"}


@app.post("/api/drivers/offline")
def go_offline(data: dict):
    user_id = data.get("user_id")
    online_drivers.pop(user_id, None)
    return {"status": "offline"}


@app.post("/api/location/update")
async def update_location(data: LocationUpdate):
    if data.user_id in online_drivers:
        online_drivers[data.user_id]["lat"] = data.lat
        online_drivers[data.user_id]["lng"] = data.lng
        online_drivers[data.user_id]["updated_at"] = datetime.now().isoformat()
        # Notifica o passageiro da corrida ativa sobre posição do motorista
        for ride in active_rides.values():
            if ride.get("driver_id") == data.user_id and ride["status"] in ["accepted", "driver_arrived", "in_ride"]:
                await notify_user(ride["passenger_id"], {
                    "type": "driver_location",
                    "lat": data.lat,
                    "lng": data.lng,
                    "ride_id": ride["ride_id"],
                })
    return {"status": "ok"}


@app.get("/api/drivers/nearby")
def get_nearby_drivers(lat: float, lng: float, radius: float = 8000):
    nearby = []
    for uid, d in online_drivers.items():
        in_ride = any(
            r.get("driver_id") == uid and r["status"] not in ["completed", "cancelled"]
            for r in active_rides.values()
        )
        if in_ride:
            continue
        dist = haversine(lat, lng, d["lat"], d["lng"])
        if dist <= radius:
            nearby.append({**d, "distance_meters": round(dist)})
    nearby.sort(key=lambda x: x["distance_meters"])
    return {"drivers": nearby}


# ============================================================
# ENDPOINTS DE CORRIDA
# ============================================================
@app.post("/api/rides/request")
async def request_ride(data: RideRequest):
    available = []
    for uid, d in online_drivers.items():
        in_ride = any(
            r.get("driver_id") == uid and r["status"] not in ["completed", "cancelled"]
            for r in active_rides.values()
        )
        if in_ride:
            continue
        dist = haversine(data.origin_lat, data.origin_lng, d["lat"], d["lng"])
        available.append((uid, d, dist))

    if not available:
        raise HTTPException(status_code=404, detail="Nenhum motorista disponível no momento")

    available.sort(key=lambda x: x[2])
    fare = calculate_fare(data.distance_meters)
    ride_id = str(uuid.uuid4())[:8]

    ride = {
        "ride_id": ride_id,
        "passenger_id": data.passenger_id,
        "passenger_name": users.get(data.passenger_id, {}).get("nome", "Passageiro"),
        "driver_id": None,
        "driver_name": None,
        "driver_chave_pix": None,
        "driver_veiculo": None,
        "origin_lat": data.origin_lat,
        "origin_lng": data.origin_lng,
        "origin_name": data.origin_name,
        "dest_lat": data.dest_lat,
        "dest_lng": data.dest_lng,
        "dest_name": data.dest_name,
        "distance_meters": data.distance_meters,
        "fare": fare,
        "status": "searching",
        "payment_method": None,
        "created_at": datetime.now().isoformat(),
    }
    active_rides[ride_id] = ride

    # Notifica os 3 motoristas mais próximos
    for uid, d, dist in available[:3]:
        await notify_user(uid, {
            "type": "ride_request",
            "ride": {**ride, "driver_distance_meters": round(dist)},
        })

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
        raise HTTPException(status_code=400, detail="Motorista não está online")

    ride["driver_id"] = data.user_id
    ride["driver_name"] = driver["nome"]
    ride["driver_chave_pix"] = driver["chave_pix"]
    ride["driver_veiculo"] = driver.get("veiculo", "")
    ride["status"] = "accepted"

    await notify_user(ride["passenger_id"], {"type": "ride_accepted", "ride": ride})
    return {"status": "accepted", "ride": ride}


@app.post("/api/rides/{ride_id}/arrived")
async def driver_arrived(ride_id: str, data: RideAction):
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    ride = active_rides[ride_id]
    ride["status"] = "driver_arrived"
    await notify_user(ride["passenger_id"], {"type": "driver_arrived", "ride": ride})
    return {"status": "driver_arrived"}


@app.post("/api/rides/{ride_id}/start")
async def start_ride(ride_id: str, data: RideAction):
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    ride = active_rides[ride_id]
    ride["status"] = "in_ride"
    ride["started_at"] = datetime.now().isoformat()
    await notify_user(ride["passenger_id"], {"type": "ride_started", "ride": ride})
    return {"status": "in_ride"}


@app.post("/api/rides/{ride_id}/complete")
async def complete_ride(ride_id: str, data: dict):
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    ride = active_rides[ride_id]
    ride["status"] = "completed"
    ride["completed_at"] = datetime.now().isoformat()
    ride["payment_method"] = data.get("payment_method", "pix")
    await notify_user(ride["passenger_id"], {"type": "ride_completed", "ride": ride})
    if ride.get("driver_id"):
        # Re-coloca motorista como disponível
        pass
    return {"status": "completed", "ride": ride}


@app.post("/api/rides/{ride_id}/cancel")
async def cancel_ride(ride_id: str, data: RideAction):
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    ride = active_rides[ride_id]
    ride["status"] = "cancelled"
    await notify_user(ride["passenger_id"], {"type": "ride_cancelled", "ride": ride})
    if ride.get("driver_id"):
        await notify_user(ride["driver_id"], {"type": "ride_cancelled", "ride": ride})
    return {"status": "cancelled"}


@app.get("/api/rides/{ride_id}")
def get_ride(ride_id: str):
    if ride_id not in active_rides:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    return active_rides[ride_id]


# ============================================================
# WEBSOCKET - Hub Central de Eventos
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

            # Registro do usuário na conexão
            if msg_type == "register":
                user_id = payload.get("user_id")
                ws_connections[user_id] = websocket
                await websocket.send_text(json.dumps({"type": "registered", "user_id": user_id}))

            # Atualização de localização do motorista via WS
            elif msg_type == "location_update":
                uid = payload.get("user_id", user_id)
                if uid and uid in online_drivers:
                    online_drivers[uid]["lat"] = payload["lat"]
                    online_drivers[uid]["lng"] = payload["lng"]
                    for ride in active_rides.values():
                        if ride.get("driver_id") == uid and ride["status"] in ["accepted", "driver_arrived", "in_ride"]:
                            await notify_user(ride["passenger_id"], {
                                "type": "driver_location",
                                "lat": payload["lat"],
                                "lng": payload["lng"],
                                "ride_id": ride["ride_id"],
                            })

            # Chat por corrida
            elif msg_type == "chat":
                ride_id = payload.get("ride_id")
                if ride_id and ride_id in active_rides:
                    ride = active_rides[ride_id]
                    other_id = (
                        ride.get("driver_id") if payload.get("sender_id") == ride["passenger_id"]
                        else ride["passenger_id"]
                    )
                    if other_id:
                        await notify_user(other_id, payload)
                    await websocket.send_text(json.dumps(payload))

    except WebSocketDisconnect:
        if user_id:
            ws_connections.pop(user_id, None)
    except Exception as e:
        print(f"WebSocket error: {e}")
        if user_id:
            ws_connections.pop(user_id, None)
