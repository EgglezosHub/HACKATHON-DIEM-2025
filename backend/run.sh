#!/usr/bin/env bash
set -euo pipefail

export PYTHONUNBUFFERED=1

# Change to the backend directory
cd "$(dirname "$0")"

<<<<<<< HEAD
# Start FastAPI backend in the background
echo "Starting FastAPI backend on port 8000..."
nohup uvicorn main:app --reload --host 0.0.0.0 --port 8000 > backend.log 2>&1 &

# Start frontend server in foreground
echo "Starting frontend server on port 5173..."
cd ../frontend
python -m http.server 5173 --bind 0.0.0.0

=======
# Run Uvicorn with hot reload on port 8000
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
source .venv/bin/activate
cd .. 
cd frontend/
python -m http.server 5173
>>>>>>> docker
