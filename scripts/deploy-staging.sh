#!/usr/bin/env bash
# Arranca (o reconstruye) el stack de staging: Postgres, migrate, api, web.
# El servicio `mcp` no arranca aquí (perfil `tools` en
# docker-compose.staging.yml): habla por stdio, no tiene sentido como
# contenedor de fondo — se invoca a demanda, ver .env.staging.example.
#
# Uso: npm run staging:up  (o  bash scripts/deploy-staging.sh)
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.staging ]; then
  echo "Falta .env.staging — copia .env.staging.example y rellena los valores reales." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "El daemon de Docker no responde. Comprueba que Docker Desktop (o el" >&2
  echo "motor que uses) esté arrancado antes de reintentar." >&2
  exit 1
fi

docker compose --env-file .env.staging -f docker-compose.staging.yml up -d --build

echo
echo "Stack de staging arriba. Servicios:"
docker compose --env-file .env.staging -f docker-compose.staging.yml ps
