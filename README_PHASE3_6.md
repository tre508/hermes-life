# Hermes Life Phase 3.6 — Cozy Studio UI

Frontend-only patch for the existing Phase 3.5 installation. No backend, database, SSH bridge or VM changes.

## Files
- frontend/index.html
- frontend/src/main.ts
- frontend/src/style.css

## Install
1. Stop only the Vite frontend.
2. Back up the `frontend` directory.
3. Extract this archive **from the project root** (`~/Apps/hermes-life`).
4. Start `./scripts/start-world.sh` and hard-refresh the browser.

## UI
- The world is a cozy six-room studio with real room IDs unchanged.
- Operations views: Overview, Discover, Planning, Build, Activity.
- Fixed-height response reader with tabs and full-screen expansion.
- Personality display: name and temperament stored in browser localStorage.
- Mood/narration inferred from real task event activity. This is **presentation behavior only**, not a new persistent Hermes brain personality or an emotional model.
- Existing API controls/IDs and WebSocket/response synchronization retained.

## Validation
The HTML was parsed and required view containers checked. `npm install` timed out in the patch environment, so TypeScript/browser build and live Kubuntu rendering remain unverified.

## Test
- Verify pixel world renders, top operations tabs switch views, and task submission still succeeds.
- Switch to Activity, run a Hermes task, confirm event updates and response reader results.
- Refresh and verify persona name/temperament remains, while latest response follows current events.
- Verify existing discovery, plans, and implementation controls still work in their tabs.
