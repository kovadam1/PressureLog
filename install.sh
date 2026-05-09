#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "[HIBA] Docker nincs telepítve. Telepítsd a Dockert, majd futtasd újra."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[HIBA] Docker Compose plugin hiányzik."
  exit 1
fi

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "[OK] .env létrehozva .env.example alapján."
    echo "[INFO] Nézd át a .env fájlt (jelszavak/JWT_SECRET), majd futtasd újra ezt a scriptet, ha kell."
  else
    echo "[HIBA] Nincs .env és .env.example sem."
    exit 1
  fi
fi

if [ "${1:-}" = "--reset" ]; then
  echo "[INFO] Tiszta indulás: konténerek + volume-ok törlése..."
  docker compose down -v
else
  echo "[INFO] Normál indulás (adatok megmaradnak)."
fi

echo "[INFO] Build + indítás..."
docker compose up -d --build

echo "[OK] Kész. Elérés:"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:4000/health"
