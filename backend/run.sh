#!/usr/bin/env bash
set -euo pipefail
export PYTHONUNBUFFERED=1

# --- go to backend folder (where this script lives) ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# --- (optional) activate venv if present ---
if [[ -f "../.venv/bin/activate" ]]; then
  source ../.venv/bin/activate
elif [[ -f ".venv/bin/activate" ]]; then
  source .venv/bin/activate
fi

# --- start FastAPI in background (same as you do manually) ---
echo "Starting FastAPI backend on :8000 ..."
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 > backend.log 2>&1 &

# --- wait until /users responds (avoid race with frontend) ---
echo -n "Waiting for backend"
for i in {1..40}; do
  if curl -sf http://127.0.0.1:8000/users >/dev/null; then
    echo " ...ready."
    break
  fi
  echo -n "."
  sleep 0.3
done

# --- start frontend in foreground (same as you do manually) ---
echo "Starting frontend server on :5173 ..."
cd ../frontend
exec python -m http.server 5173 --bind 0.0.0.0
