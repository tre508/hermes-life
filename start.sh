#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
. .venv/bin/activate
# Import the application module, not just the package: this is what actually
# pulls in fastapi/pydantic and every project module, so a venv broken by an
# incompatible dependency pair fails here instead of inside uvicorn later.
if ! .venv/bin/python -c 'import hermes_life.app, uvicorn' >/dev/null 2>&1; then
  echo 'Backend cannot import. Repair the environment with:' >&2
  echo '  .venv/bin/pip install -e ".[test]" && .venv/bin/pip check' >&2
  exit 1
fi
exec uvicorn hermes_life.app:create_app --factory --host 127.0.0.1 --port 8766
