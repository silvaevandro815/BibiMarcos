import os
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncpg

app = FastAPI(title="BibiMarcos API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:sua_senha@localhost:5432/seu_banco")

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

manager = ConnectionManager()

async def update_driver_location(driver_id: int, lat: float, lon: float):
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        query = """
            INSERT INTO driver_locations (id_motorista, coordenadas, ultima_atualizacao)
            VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, CURRENT_TIMESTAMP)
            ON CONFLICT (id_motorista) 
            DO UPDATE SET 
                coordenadas = EXCLUDED.coordenadas,
                ultima_atualizacao = EXCLUDED.ultima_atualizacao;
        """
        await conn.execute(query, driver_id, lon, lat)
    finally:
        await conn.close()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            
            if "latitude" in payload and "longitude" in payload and "driver_id" in payload:
                await update_driver_location(
                    driver_id=payload["driver_id"],
                    lat=payload["latitude"],
                    lon=payload["longitude"]
                )
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"Erro no WebSocket: {e}")
        manager.disconnect(websocket)

@app.get("/")
def read_root():
    return {"status": "Backend BibiMarcos online!", "message": "API está rodando com sucesso"}
