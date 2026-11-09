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
# Host configuration (this NUC): paths that belong to the controller, not the worker. Sourced first so
# an explicit value here wins over the code defaults. The Obsidian vault lives on the external disk
# labelled "black" (a udisks mount under /run/media), not under $HOME.
host_env="${HERMES_LIFE_HOST_ENV:-config/hermes-life-host.env}"
if [[ -f "$host_env" ]]; then
  # shellcheck disable=SC1090
  . "$host_env"
  echo "host: vault=${HERMES_LIFE_OBSIDIAN_VAULT:-<unset>} (from $host_env)"
else
  echo "host: no config at $host_env; using code defaults (vault may not resolve)" >&2
fi
# HL-WORKER: load the coding-worker configuration so the backend never depends on being started by
# hand with the right environment (which is how the retired VM address used to leak back in).
# The Lenovo file below is the only worker configuration; HERMES_LIFE_WORKER_ENV only overrides the
# path for tests that need a throwaway worker definition.
worker_env="${HERMES_LIFE_WORKER_ENV:-config/hermes-life-lenovo.env}"
if [[ -f "$worker_env" ]]; then
  # shellcheck disable=SC1090
  . "$worker_env"
  echo "worker: ${HERMES_LIFE_VM_USER:-?}@${HERMES_LIFE_VM_HOST:-?} transport=${HERMES_LIFE_TRANSPORT:-local} (from $worker_env)"
else
  echo "worker: none configured; transport=${HERMES_LIFE_TRANSPORT:-local}. Set one with HERMES_LIFE_WORKER_ENV." >&2
fi
exec uvicorn hermes_life.app:create_app --factory --host 127.0.0.1 --port 8766
