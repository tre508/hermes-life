# Hermes Life — Phase 2: Living World

This is the **complete Phase 1 backend with Phase 2 additions**, not a replacement for your existing SQLite database. It retains `/api/tasks`, `/api/events`, `/api/agent/state`, and `/ws/events`.

New features: `/api/world/state` (persistent world projection), a Phaser 3 six-room pixel-art dashboard, clickable rooms, visual character movement from real Hermes events, reconnect with event sequence cursors, task submission panel, and history list.

## Installation into an existing Phase 1 checkout

1. Back up `~/Apps/hermes-life` or copy its code and database location before updating.
2. Extract this ZIP to a temporary directory. Copy the extracted project files into `~/Apps/hermes-life`, preserving any local configuration; **do not delete your `.venv` or `~/.local/share/hermes-life/life.db`**.
3. From `~/Apps/hermes-life` run `./start.sh` for the backend (http://127.0.0.1:8766/docs).
4. In a separate terminal run `./scripts/start-world.sh` for the pixel world (http://127.0.0.1:5173).
5. Submit a task in the UI. The agent moves as actual backend events arrive.

**Prerequisites:** existing Hermes CLI and Python environment from Phase 1, Node.js / npm installed on Kubuntu. Vite downloads frontend dependencies with `npm install` on first launch.

## Checks

Run `./.venv/bin/python -m pytest -q` in the repository.

## Semantics

Phaser animates the **observed action phase**, not a proof that work completed. Completed tasks are persisted in SQLite; the backend event stream is authoritative. The current visualization is intentionally simple: original geometric pixel art rendered by Phaser without external sprite assets.

For v0.2 the backend reducer represents an activity snapshot, with event batches reconciled when a UI connects or requests the world state. UI reconnect is cursor-based; after long disconnections reload the page to recover more than 500 historical events. The REST snapshot is retained across restarts. Autonomous goal selection, pathfinding, and detailed world routines are later phases.

## Phase 2.1 response panel

The frontend now displays the selected task's full `result`, execution status, backend `error`, Hermes tool-use/tool-result events, and the most recent 100 tasks. A task can be reopened from the history panel. WebSocket completion events trigger an immediate response refresh, with polling every three seconds as a fallback. The backend and database schema are unchanged.

On an existing Phase 2 installation, replace only `frontend/index.html`, `frontend/src/main.ts`, and `frontend/src/style.css`, preserving your database, virtual environment, and other configuration. Restart `scripts/start-world.sh` if necessary and refresh the browser.
