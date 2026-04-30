-- Habilita a extensão PostGIS caso ainda não esteja habilitada
CREATE EXTENSION IF NOT EXISTS postgis;

-- Criação de tipos ENUM para garantir integridade dos dados
CREATE TYPE user_type AS ENUM ('motorista', 'passageiro');
CREATE TYPE ride_status AS ENUM ('pendente', 'em_curso', 'finalizada');

-- 1. Tabela de Usuários
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    tipo user_type NOT NULL,
    chave_pix VARCHAR(255)
);

-- 2. Tabela de Localização dos Motoristas
CREATE TABLE IF NOT EXISTS driver_locations (
    id_motorista INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    coordenadas GEOGRAPHY(POINT, 4326) NOT NULL,
    ultima_atualizacao TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Criação do Índice Espacial GIST na coluna de coordenadas para buscas ultra-rápidas
CREATE INDEX IF NOT EXISTS idx_driver_locations_coordenadas 
ON driver_locations USING GIST (coordenadas);

-- 3. Tabela de Corridas (Rides)
CREATE TABLE IF NOT EXISTS rides (
    id SERIAL PRIMARY KEY,
    passageiro_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    motorista_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status ride_status NOT NULL DEFAULT 'pendente',
    origem GEOGRAPHY(POINT, 4326) NOT NULL,
    destino GEOGRAPHY(POINT, 4326) NOT NULL,
    valor_estimado DECIMAL(10, 2) NOT NULL,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índices adicionais recomendados para otimizar consultas comuns nas corridas
CREATE INDEX IF NOT EXISTS idx_rides_passageiro_id ON rides(passageiro_id);
CREATE INDEX IF NOT EXISTS idx_rides_motorista_id ON rides(motorista_id);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
