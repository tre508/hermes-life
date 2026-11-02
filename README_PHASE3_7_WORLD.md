# Hermes Life — Phase 3.7 visual-world patch

This is an incremental **frontend-only** upgrade based on v0.3.6.3. It adds an animated walking character, a continuous office corridor, active-room highlighting, richer event-to-room routing, and a simple state-aware character animation. The existing room-click details and operational dashboard are retained.

## Install

Stop the Vite frontend, leave the FastAPI backend running. Back up `frontend/src/main.ts` and replace it with the file in this archive. Restart `./scripts/start-world.sh` and hard-refresh the browser.

```bash
cd ~/Apps/hermes-life
cp frontend/src/main.ts frontend/src/main.ts.before-phase37
unzip -o ~/Downloads/hermes-life-phase3.7-world.zip
./scripts/start-world.sh
```

## Verify

Submit a task in Pixel World asking Hermes to read a project file and run a test. The robot should walk using the middle connecting corridor between the Library, Studio, Test Lab and Archive as tool events arrive. Room clicks should continue opening the existing details panel. Reloading should place the robot immediately at the latest persisted room, rather than replaying the entire historical walk.

## Boundaries

The backend and SQLite schema are unchanged. Existing browser-local persona is unchanged and **does not yet influence Hermes decision-making**. Actual persistent personality injection into the VM agent will require a separate backend/adapter update. The event classifier uses heuristics against structured event payloads and should be refined with real tool event samples. No frontend build was run in this environment.
