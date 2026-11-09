# Coding worker — Hermes Life runs on the NUC, codes on the Lenovo

Hermes Life keeps its controller on this NUC and moves all autonomous execution to a dedicated
worker machine. The split is configuration, not code: one environment file selects the worker, and
the guest scripts execute there over SSH.

## Division of labour

| This NUC (controller)                                     | The worker (execution)                                  |
| --------------------------------------------------------- | ------------------------------------------------------- |
| FastAPI backend, web UI, SQLite database, memory           | Hermes Agent runs (`hermes chat`)                        |
| Obsidian integration, scheduling, orchestration            | Project checkouts under `/home/hermes/projects`          |
| Planning, approvals, verification policy, review state     | Candidate/baseline copies in `/home/hermes/experiments`  |
| Task history, implementation runs, revision records        | Platform test envs, pytest runs, revisions               |

The backend stays the single source of truth. The worker holds no task queue, no permissions and no
schedule of its own; it executes what the controller asks for and returns results.

## Active worker configuration

`config/hermes-life-lenovo.env` (loaded automatically by `./start.sh`):

```bash
export HERMES_LIFE_TRANSPORT=ssh
export HERMES_LIFE_VM_HOST=192.168.178.37      # glenn-mem, LAN; Tailscale 100.82.210.26
export HERMES_LIFE_VM_USER=glenn
export HERMES_LIFE_VM_PORT=22
export HERMES_LIFE_VM_KEY="$HOME/.ssh/hermes-lenovo"
```

`HERMES_LIFE_GUEST_HOME=/home/glenn` is the important line: every guest script, prompt and workspace
path is derived from it, so the whole pipeline executes against the Lenovo's **own** directory layout
and needs no compatibility symlink. Other optional overrides, defaults derived from it:
`HERMES_LIFE_GUEST_HERMES=/home/glenn/.local/bin/hermes`, `HERMES_LIFE_TIMEOUT=1800`.

There is **no default worker address and no path default**. Selecting `ssh` without a complete
configuration raises at startup instead of silently driving another machine, and the retired VM's
address and key appear nowhere in live code or configuration (the old `config/hermes-life-ssh.env.example`
was deleted for exactly that reason).

`hermes_life/guest_env.py` owns the worker's paths (`GUEST_HOME`, `PROJECTS_ROOT`,
`EXPERIMENTS_ROOT`, `WORKSPACES_ROOT`, `HERMES_BIN`) and exposes `for_worker()`. Guest scripts are
*author*d against `CANONICAL_GUEST_HOME` and pass through `for_worker()` at import, which rewrites
them to `GUEST_HOME`; the same helper covers the host-built prompts. `tests/test_worker_migration.py`
enforces that no string literal naming a worker home exists outside a `for_worker(...)` call, that a
moved home rewrites every executed script and prompt, and that no live module or config carries the
retired VM's address.

## Worker prerequisites (all verified on the Lenovo)

- SSH key auth from the NUC (`~/.ssh/hermes-lenovo`), key present in the NUC's `known_hosts`.
- Hermes Agent at `/home/glenn/.local/bin/hermes`, with its **gateway service running**:
  `systemctl --user status hermes-gateway` (a logged-in user manager; `loginctl enable-linger glenn`
  keeps it alive after logout). Every agent turn travels through that gateway — if it is down or
  stale, chats fail with `Gateway disconnected; turn outcome is unknown`.
- `python3` with `venv`, plus network access to PyPI for the first environment provisioning.
- Data: `/home/glenn/projects`, `/home/glenn/workspaces`, `/home/glenn/experiments` (baselines,
  candidates, envs, revision backups) and `/home/glenn/learning` (the handbook study material).
- The compatibility symlink `/home/hermes -> /home/glenn` still exists on the worker but is no longer
  required by Hermes Life. Historical database rows still carry `/home/hermes/...` paths; the guest
  derives every directory from the configured root plus the run id, so those rows keep working
  (verified against pre-migration runs).

> **Pitfall — restart the worker's gateway after any Hermes update on the worker.** An update
> rewrites the checkout under a running gateway, leaving it on mixed-version modules. Symptoms:
> every chat turn dies with `Gateway disconnected`, and `journalctl --user -u hermes-gateway` shows
> an `ImportError` (for example `cannot import name 'Principal' from 'gateway.session_contract'`)
> even though the file on disk is correct. Restarting `hermes-gateway` reloads the on-disk tree.

## Start and operate

```bash
# Backend (loads config/hermes-life-lenovo.env and prints the active worker)
cd ~/Apps/hermes-life && ./start.sh
# ...detached, surviving logout:
systemd-run --user --unit=hermes-life-backend --collect \
  --property=WorkingDirectory=/home/gayzer/Apps/hermes-life /bin/bash -lc './start.sh'

# Frontend
cd ~/Apps/hermes-life/frontend && npm run dev -- --host 127.0.0.1   # http://127.0.0.1:5173

# Which worker is the backend actually driving?
curl -s http://127.0.0.1:8766/health
# {"status":"ok","hermes_available":true,
#  "worker":{"transport":"ssh","target":"glenn@192.168.178.37:22",
#            "guest_home":"/home/glenn","agent":"/home/glenn/.local/bin/hermes"}}

# Tests and acceptance
.venv/bin/python -m pytest -q          # 145 passed
hermes verify --json                   # bootstrap + tests + readiness

# Stop
systemctl --user stop hermes-life-backend
pkill -f 'vite --host 127.0.0.1'
```

## The retired VM

The Kubuntu VM is decommissioned and is **not a fallback**. Its address and key no longer appear in
any live module, script or config file (the old `config/hermes-life-ssh.env.example` was deleted),
and the ssh transport refuses to start without an explicit worker. Powering the VM off changes
nothing: the backend, database, memory, Obsidian vault, scheduling and orchestration are on this NUC,
and every execution path goes to the Lenovo over SSH.

Moving to a different worker machine again is configuration only: set `HERMES_LIFE_VM_*` to the new
address and `HERMES_LIFE_GUEST_HOME` to that machine's home. No code change and no symlink.

## What was verified on the Lenovo

| Capability                     | Evidence                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Worker reachable + agent ready | `/health` → `hermes_available: true` (real SSH probe of the agent binary)       |
| Remote agent execution         | pipeline task completed, result `lenovo-ok`, exit 0, ~13k tokens                 |
| Discovery scan                 | `examined: 60, skipped_by_rule: 140, errors: 0, elapsed_ms: 27`                  |
| Project synchronization        | git bundle → scp → clone, HEAD `5a08b09`, 290 tracked files                     |
| Isolated candidate creation    | `prepare` copied the project checkout into `/home/glenn/experiments/candidate-*` |
| Platform test environment      | `environment` → `status: ok`, pytest installed, `/home/glenn/experiments/env-*`  |
| Worker's own directory layout  | with `HERMES_LIFE_GUEST_HOME=/home/glenn` the executed script contains zero `/home/hermes`, and `prepare`/`environment`/`test` ran in `/home/glenn/experiments/*` |
| Pre-migration runs under the new root | runs created while the VM was the worker evaluate unchanged (`3 passed`, `27 passed` twice) from their stored `/home/hermes/...` rows |
| No VM dependency               | `/proc/<backend pid>/environ` names only the Lenovo; `/health` reports `guest_home=/home/glenn` |
| Candidate testing + evaluation | real pytest runs; `3 passed` on the toy candidate, provenance + `duration_ms`    |
| Agent coding in a candidate    | agent wrote `tests/test_smoke.py` and ran pytest inside the candidate workspace  |
| Independent verification       | per-criterion verdicts with hashes and search counts; `disposition: failed`      |
| Revision policy                | auto-revision bounds enforced (`auto_revision_budget_exhausted`, criteria 3/7/8) |

## Known limitations

- `hermes-life-test` exists only on the worker (no host repository), so it cannot be registered as a
  host project and cannot be driven from a plan through the host-side sync path.
- Host project `hermes-life` is registered at commit `b3cd8a56` while its workspace directory
  currently holds `0abfe98`; the registry and the directory disagree from before the migration.
  A fresh `POST /api/projects/hermes-life/sync` fixes it, and needs a clean host tree (uncommitted
  work is deliberately never bundled).
- A baseline with **no tests** is reported as `evaluation_error` (pytest exit 5) and blocks
  verification (`baseline_not_established`). The environment is no longer the cause — the toy
  project simply had no tests before the change.
- `max_auto_revisions` is process configuration; only `auto_revision` is settable through
  `PUT /api/verification/settings`.
- No local inference runtime (Janas/Qwen3-0.6B) exists on the Lenovo. Agent inference continues to
  use Hermes Agent's configured provider, unchanged by this migration.
- `hl_projects.vm_path` (and the workspace directory recorded for `hermes-life`) still use the old
  `/home/hermes/...` spelling and disagree about the commit (see above). A re-sync rewrites both; the
  worker's symlink keeps the recorded path resolvable until then.
- Historical documents (`README_PHASE3_*`, `README_VM_BRIDGE.md`, `FIX.md`) describe the VM-era setup.
  They are release notes from that period, not current instructions; this file is authoritative.
