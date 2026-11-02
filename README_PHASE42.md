# Phase 4.2 — Hermes Life chat visual alignment + theme

Requires installed Phase 4.1 chat. Only `frontend/src/hermes-chat.ts` and `frontend/src/hermes-chat.css` are replaced, with timestamped backups. No backend changes.

1. Unzip this ZIP into `~/Apps/hermes-life`.
2. Run `python3 scripts/install-phase42-chat-theme.py`.
3. Restart `./scripts/start-world.sh`, then hard-refresh the browser.

Updated: dark navy and teal theme, mint accents, corrected panel spacing, readable user/Hermes message bubbles, labeled New Chat / Threads / Close / Send buttons, matching Chat launcher, mobile breakpoints and accessibility contrast. Retains original task API, conversation ID, WebSocket and action semantics.
