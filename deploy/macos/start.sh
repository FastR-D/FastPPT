#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PYTHON_BIN="${FASTPPT_PYTHON:-$ROOT_DIR/.venv/bin/python}"
PID_FILE="$ROOT_DIR/var/fastppt-api.pid"
WORKER_PID_FILE="$ROOT_DIR/var/fastppt-worker.pid"
mkdir -p "$ROOT_DIR/var"
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "FastPPT is already running (PID $(cat "$PID_FILE"))"
  exit 0
fi
cd "$ROOT_DIR"
nohup "$PYTHON_BIN" -m fastppt_api.server >"$ROOT_DIR/var/fastppt-api.log" 2>&1 &
echo $! > "$PID_FILE"
nohup "$PYTHON_BIN" -m fastppt_worker.cli >"$ROOT_DIR/var/fastppt-worker.log" 2>&1 &
echo $! > "$WORKER_PID_FILE"
echo "FastPPT started at http://127.0.0.1:${FASTPPT_PORT:-43110}"
