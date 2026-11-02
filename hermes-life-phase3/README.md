# Hermes Life v0.3 — Phase 3 (Autonomous goal queue)

Adds a persisted, opt-in goal queue and single-worker scheduler to the Phase 2.1 world UI. **Existing SQLite data and the Phase 2 task API remain unchanged.** The database location remains `~/.local/share/hermes-life/life.db` unless `HERMES_LIFE_DB` was configured.

## Upgrade on Kubuntu

Stop both servers (`Ctrl+C` in the backend and frontend terminals). Unzip this package into `~/Apps`, then create a backup and copy the new source over the existing installation (the archive folder is named `hermes-life-phase3`):

```bash
cd ~/Apps
unzip -o ~/Downloads/hermes-life-phase3.zip
cp -a hermes-life "hermes-life-backup-$(date +%Y%m%d-%H%M%S)"
cp -a hermes-life-phase3/. hermes-life/
```

The copied files do **not** include a database or `.venv`. The existing installation's local data is retained.

Backend terminal:

```bash
cd ~/Apps/hermes-life
./start.sh
```

Frontend terminal:

```bash
cd ~/Apps/hermes-life
./scripts/start-world.sh
```

Browse to `http://127.0.0.1:5173`. An **Autonomous goals** panel now appears above manual task submission. Create one goal with a specific Hermes prompt and click **Enable autonomy**. Tasks run one at a time. To view results use **View task** in the goal list. **Pause autonomy** prevents starting new tasks; it does not abort a task already running.

## API

- `GET /api/autonomy` — scheduler enabled state
- `PUT /api/autonomy` — `{"enabled": true|false}`
- `GET /api/goals` — most recent 200 goals
- `POST /api/goals` — `{"title":"...","prompt":"...","priority":50}`
- `POST /api/goals/{id}/cancel` — cancels pending or interrupted goal
- `POST /api/goals/{id}/retry` — requeues failed or interrupted goal

Goal state is persisted in SQLite. On restart unfinished running *goals* become `interrupted` and are not blindly rerun; use Retry after inspecting them. Manual Phase 2 tasks are unaffected by these endpoints. Events include `goal.created`, `goal.selected`, `goal.completed`, `goal.failed`, `autonomy.paused`, and `autonomy.resumed`.

## Scope

Phase 3 foundation adds **autonomous sequencing of explicitly approved goals**, not unrestricted task discovery. It does not scan repositories or create independent goals yet. It intentionally does not alter Hermes global settings, self-modify its agent configuration, merge code, or create new repos without an explicit goal. A future task-discovery module can feed this same persisted queue.

Run backend tests with `./.venv/bin/python -m pytest -q` after installing the test extras if needed (`./.venv/bin/python -m pip install -e '.[test]'`). For production use, keep only one server process/worker on the SQLite database, since this version uses an in-process execution lock.
