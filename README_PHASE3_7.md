# Hermes Life 0.3.7 — Living Agent

Incremental patch over Phase 3.6.3 and backend Phase 3.5. Does not replace your current SSH adapter, VM, database, task queue or evaluation pipeline.

## Changes
- SQLite schema v4 with one persistent host-side personality profile.
- `GET /api/personality` and `PUT /api/personality`.
- Persona is included as a short work-style preface in **new** Hermes tasks (manual and autonomous) without changing permissions.
- New `life.narration` events derived deterministically from real Hermes tool/task events; no extra model calls.
- UI fetches and saves persona to backend rather than browser localStorage. Narration ticker and mood follow live events.
- Robot moves between rooms using the corridor between the rows instead of a single diagonal tween.
- Historical events remain log-only (no movement replay).

## Installation
1. Pause autonomous execution, stop backend and frontend.
2. Back up project and SQLite DB, including using SQLite backup API if WAL is active.
3. Extract this patch from project root (`unzip -o ~/Downloads/hermes-life-phase3.7-living-agent.zip`).
4. Run `./.venv/bin/python -m pytest -q` while backend is stopped.
5. Launch backend with its VM SSH environment (`source config/hermes-life-ssh.env.example && ./start.sh`), then start frontend (`./scripts/start-world.sh`).
6. Hard-refresh browser. Verify `GET /api/personality`, change temperament, reload page and check persistence. Submit a task and verify `life.narration` events and character movement.

**Tested:** 24 backend tests passed in the assembly environment. **Not verified:** TypeScript browser build on user's Kubuntu machine or live Hermes/VM end-to-end behavior.

## Notes
- Personality is an explicit tool-use/communication preference, not a model weight change or real emotion.
- Mood is a deterministic label based on observed activity; it does not assert subjective experience.
- New schema migration occurs on backend startup. Back up the database first.
- Your existing single-process backend ownership constraint remains.
