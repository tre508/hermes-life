# Hermes Life Phase 3.9.4 — contradiction resolution

## Scope
Backend-only; schema v11. Existing tasks, lessons, observations, and challenge records are retained. **No automatic mutation of an existing memory by the test.**

## Install
Stop backend, back up the active SQLite DB (usually `~/.local/share/hermes-life/life.db`), extract archive in `~/Apps/hermes-life`, restart backend via existing `source config/hermes-life-ssh.env.example && ./start.sh`. No frontend changes.

## Inspect
`GET /api/technical-lessons/{lesson_id}/challenges` — append-only challenges and decisions.
`GET /api/technical-lessons` — additionally exposes `resolution_verdict` and `unresolved_challenges`.

## Controlled workflow
1. Submit an actual Hermes VM task that independently investigates a **real** potential contradiction. The agent may report a challenge with `challenges_lesson_id` through the existing tool-evidence-backed learning report. Do not prompt it to fabricate a contradictory output.
2. Inspect the lesson and its challenge history; disputed lessons are excluded from automatic retrieval.
3. Run a separate, independently completed verification task in the VM. To become eligible for adjudication, the verification run must produce tool-result evidence recorded with a technical finding or challenge. Save its reflective `run_id` and exact recorded evidence excerpt.
4. A human/reviewer calls `POST /api/technical-lessons/{id}/resolve` with JSON `{ "verdict": "upheld"|"retired", "rationale": "at least 20 characters", "verification_run_id": 123, "verification_excerpt": "exact snippet from captured evidence, at least 12 chars" }`.
5. `upheld` makes the original lesson recall-eligible again. `retired` keeps it out of automatic recall. A fresh challenge reopens the dispute regardless of past decisions. No lesson is erased. To correct a wrong lesson, retire it and create a new separately evidenced finding.

This is an **explicit adjudication mechanism**, not an automatic truth oracle. It checks a completed independent run and exact recorded evidence, not whether the stated verdict logically follows from that evidence. No automatic verdict or updates to original lesson text.

## Local regression
`python test_integration.py` is a self-contained in-memory test using a stub of the store and reflection helpers. It intentionally creates synthetic challenge data **only in its in-memory database**, not against the live API/DB.

## Cautions
The included `app.py` is based on the Phase 3.9 API baseline, with the two endpoints added. If you've made custom edits to `hermes_life/app.py` since, merge those endpoints instead of overwriting the file. Production calls to `/resolve` should be restricted to trusted operators; the existing local host API does not provide per-route authentication.
