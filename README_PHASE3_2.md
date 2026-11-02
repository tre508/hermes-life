# Hermes Life Phase 3.2 — autonomous discovery decisions

Overlay this patch on your existing v0.3.1 source. It preserves your VM bridge and SQLite database.

- Scheduled scans are OFF by default; enable separately from the goal scheduler.
- When enabled, scans /home/hermes/projects over existing SSH adapter at configurable interval (default 3600s).
- Findings become persistent proposed discoveries and deduplicated research questions in the curiosity queue.
- No project changes, auto-approval, or model-generated goals occur during discovery.
- Approved discoveries continue to use the v0.3 goal scheduler.
- Use `/api/decisions`, `/api/curiosity`, and corresponding Pixel World controls.
- Only run one Uvicorn backend process, because this version uses in-process schedulers.

Install: stop backend and frontend; back up project and database, unzip patch from `~/Apps/hermes-life` (files merge); start backend with SSH environment, then frontend.

Tests: `.venv/bin/python -m pytest -q` after restart. Test scan using `POST /api/decisions/scan` and inspect `/api/curiosity`.
