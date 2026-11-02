# Hermes Life 0.3.5 — Evaluated Implementation (candidate stage)

This patch adds a reviewed-plan implementation path to the current Phase 3.4.1 application. It does NOT auto-merge, modify the host's Hermes installation, or automatically promote agent-written code.

## How it works

1. Open **Evaluated implementation** after a Phase 3.4 plan is saved.
2. Enter the exact directory name of a project directly under `/home/hermes/projects` (e.g. `hermes-life-test`).
3. Confirm **Implement isolated candidate**.
4. Host backend uses SSH to run guest-side Python operations. It clones the project into `/home/hermes/experiments/baseline-<UUID>` and `candidate-<UUID>` (excluding git metadata, virtual environments, and caches).
5. It runs `python3 -m pytest -q` in the baseline copy; it asks VM Hermes to implement the plan in the candidate copy; then runs the same test command in the candidate copy.
6. It saves separate baseline/candidate results, paths, and final Hermes explanation in the host SQLite DB. `candidate_passed` means pytest returned exit code 0, NOT that all plan acceptance criteria are proven. A human must review before merging.

## Important operational limits

- This is a COPY-BASED candidate workflow, **not yet hardened confinement**. Hermes still executes as user `hermes` and has Linux permissions to modify its original VM projects. Prompt instructions alone cannot enforce path restrictions. Don't grant unattended coding authority until the candidate runner executes under a separate restricted user/container with only the candidate mounted writable.
- The test runner executes project pytest suites in the VM. Such tests can have side effects, though copies protect the original project files from normal relative writes. No tests are run on the Kubuntu host by the remote runner.
- Baseline and candidate tests require `python3 -m pytest` to be installed inside the guest VM. External dependencies must be provisioned separately. Failed baseline is recorded as evidence, not interpreted as an acceptable regression.
- Implementation is an explicit, blocking POST call and may take several minutes; do not click it twice. Only one attempt per plan is persisted.
- Test pass/fail is not a full independent acceptance-criteria evaluation; that is a follow-up capability.
- The executor runs through the existing SSH adapter. Current response history remains unchanged; implementation events appear in Activity and the new evaluation panel. Long-running implementation responses are stored separately from ordinary task records.

## Install

1. Pause autonomy and stop the backend and frontend.
2. Back up the project and SQLite database (with the backend stopped).
3. From `/home/gayzer/Apps/hermes-life`, extract `hermes-life-phase3.5-evaluated-implementation.zip` using `unzip -o`.
4. Run `./.venv/bin/python -m pytest -q` with backend stopped.
5. Restart with `source config/hermes-life-ssh.env.example && ./start.sh` (backend) and `./scripts/start-world.sh` (frontend). Hard refresh the browser.
6. Schema migrates from version 2 to 3 on backend start. Visit the Evaluated implementation panel.

## New APIs

- GET `/api/implementations`
- GET `/api/implementations/{id}`
- POST `/api/implementations/from-plan/{plan_id}` with body `{"project":"hermes-life-test"}`

## Verification status

- Backend test suite: 22 passed in build environment.
- Browser/Vite build: verify on installed machine if Node dependencies unavailable in build environment.
- Actual VM integration and command execution: pending validation on your machine.
