# Hermes Life 3.3.3 — backend startup/database stability patch

## Fixes
- No application instance created by importing `hermes_life.app`.
- `Store`, `Autonomy`, `Discovery`, `DecisionEngine`, and `GoalFormulator` constructors no longer perform schema DDL or restart recovery.
- Explicit schema migration tracked with SQLite `PRAGMA user_version=1`; prior databases with version 0 are migrated in place preserving rows.
- Startup-lifespan recovery changes unfinished running/queued tasks and running goals to interrupted; it does not run on imports, incidental Store opens, or tests importing modules.
- FastAPI lifespan replaces deprecated startup/shutdown decorators.
- Server launch uses `uvicorn hermes_life.app:create_app --factory`; does not reinstall Python dependencies every launch.
- Tests isolate default DB paths and exercise startup/recovery.

## Install on Kubuntu host (not inside VM)
1. Stop the Hermes Life BACKEND (Ctrl+C). Stop/pause autonomous tasks before shutdown.
2. Back up the existing installation and SQLite DB.
3. Extract this ZIP from `~/Apps/hermes-life` with `unzip -o ~/Downloads/hermes-life-phase3.3.3-stability-patch.zip`.
4. Run `./.venv/bin/python -m pytest -q` while backend remains stopped.
5. Run `./start.sh` with the existing sourced SSH bridge config in the backend terminal.

This package intentionally does not change the VM bridge, frontend, or your existing database file. The first startup performs schema migration in the same database; make a database backup first.

**Limitations:** This patch does not implement multi-process DB ownership or full SQLite migration coverage for every future schema change. One backend worker process is still required. Any former in-flight task may be labelled interrupted after a clean restart; this is current conservative recovery behavior.
