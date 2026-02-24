#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "update-start.sh is deprecated; forwarding to python run.py"
if command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
else
    echo "Error: Neither python nor python3 is available in PATH." >&2
    exit 1
fi

exec "$PYTHON_BIN" "$ROOT_DIR/run.py" "$@"
