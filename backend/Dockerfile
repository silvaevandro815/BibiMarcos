# ============================================================
# BibiMarcos Backend — Dockerfile de Produção (Coolify)
# ============================================================
FROM python:3.11-slim

# Variáveis de ambiente — crítico para Docker funcionar
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copiar e instalar dependências Python ANTES do código
# (aproveita cache do Docker se requirements.txt não mudar)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copiar código da aplicação
COPY . .

# Expor porta
EXPOSE 8000

# Health check — período maior para dar tempo do Python e do Postgres iniciarem
# start-period=40s: Coolify aguarda 40s antes de checar pela 1ª vez
# interval=30s: verifica a cada 30s depois disso
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=5 \
    CMD curl -f http://localhost:8000/api/health/ping || exit 1

# Iniciar com uvicorn
# --host 0.0.0.0 é OBRIGATÓRIO para o Docker expor externamente
# --timeout-keep-alive 75: mantém conexões WebSocket vivas
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--timeout-keep-alive", "75", \
     "--access-log"]
