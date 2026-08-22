#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PYTHON_BIN="${FASTPPT_PYTHON:-$ROOT_DIR/.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "FastPPT requires a project .venv at $ROOT_DIR/.venv" >&2
  exit 1
fi
"$PYTHON_BIN" -m compileall -q "$ROOT_DIR/apps" "$ROOT_DIR/packages" "$ROOT_DIR/services"
mkdir -p "$ROOT_DIR/var/data" "$ROOT_DIR/var/tmp" "$ROOT_DIR/var/exports"
echo "FastPPT macOS experimental runtime is ready"
