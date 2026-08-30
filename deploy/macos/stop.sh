#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PID_FILE="$ROOT_DIR/var/fastppt-api.pid"
WORKER_PID_FILE="$ROOT_DIR/var/fastppt-worker.pid"
if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  kill "$PID" 2>/dev/null || true
  rm -f "$PID_FILE"
fi
if [[ -f "$WORKER_PID_FILE" ]]; then
  kill "$(cat "$WORKER_PID_FILE")" 2>/dev/null || true
  rm -f "$WORKER_PID_FILE"
fi
echo "FastPPT stopped"
