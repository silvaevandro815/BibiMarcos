-- BibiMarcos v4 — Schema PostgreSQL
-- Roda em qualquer Postgres 14+ (sem PostGIS necessário para este schema)

CREATE TABLE IF NOT EXISTS users (
    user_id         TEXT PRIMARY KEY,
    nome            TEXT NOT NULL,
    telefone        TEXT UNIQUE NOT NULL,
    tipo            TEXT NOT NULL CHECK (tipo IN ('motorista', 'passageiro')),
    chave_pix       TEXT DEFAULT '',
    veiculo         TEXT DEFAULT '',
    foto_url        TEXT DEFAULT '',
    avaliacao       REAL DEFAULT 5.0,
    total_corridas  INTEGER DEFAULT 0,
    push_token      TEXT DEFAULT '',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rides (
    ride_id             TEXT PRIMARY KEY,
    passenger_id        TEXT REFERENCES users(user_id),
    driver_id           TEXT REFERENCES users(user_id),
    origin_lat          DOUBLE PRECISION,
    origin_lng          DOUBLE PRECISION,
    origin_name         TEXT,
    dest_lat            DOUBLE PRECISION,
    dest_lng            DOUBLE PRECISION,
    dest_name           TEXT,
    distance_meters     DOUBLE PRECISION,
    fare                DOUBLE PRECISION,
    status              TEXT DEFAULT 'searching',
    payment_method      TEXT,
    payment_preference  TEXT DEFAULT 'any',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    accepted_at         TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver    ON rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_status    ON rides(status);
CREATE INDEX IF NOT EXISTS idx_users_telefone  ON users(telefone);
