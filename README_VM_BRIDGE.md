# Phase 3 — Hermes Life isolated VM bridge

This patch changes only `hermes_life/hermes_adapter.py` and adds tests/configuration. Existing `/api/tasks`, `/api/goals`, SQLite data, and `/ws/events` remain unchanged.

## Prerequisites

- SSH key access from Kubuntu host to `hermes@192.168.124.136` (already established).
- **Hermes CLI installed and configured with a model provider inside the VM** (`ssh ... 'command -v hermes'`).
- No host directories are mounted in the VM.

## Install patch

Stop the backend process, back up `hermes_life/hermes_adapter.py`, and copy this archive's `hermes_life/hermes_adapter.py` over it. Copy the included config if useful. Existing `start.sh` and frontend do not change.

In the Kubuntu host backend terminal:

```bash
cd ~/Apps/hermes-life
source config/hermes-life-ssh.env.example
./start.sh
```

`GET /health` reports `hermes_available: true` only if the SSH probe can reach the VM Hermes CLI. If false, verify `ssh -i ~/.ssh/hermes_life_vm hermes@192.168.124.136 'command -v hermes'` and `hermes model` **inside the guest**.

Open `http://127.0.0.1:5173` and submit: `Run hostname and pwd using the terminal, then give me the actual output.` Results should identify the VM (`hermes` and `/home/hermes`), and tool events should appear in the unchanged event stream.

**Important:** The bridge invokes the *guest* Hermes process; it does not proxy only individual terminal commands. The guest must have its own Hermes configuration and tools. Existing host-side Hermes sessions are not migrated.

The backend service should run as one worker. No in-flight tasks should be running when switching transports. Autonomy should remain paused during the first integration test.
