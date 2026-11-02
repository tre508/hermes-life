# Hermes Life Phase 3.1 — read-only discovery patch

This is a **patch** for an existing Phase 3 installation with the SSH VM bridge already installed. It does not overwrite hermes_adapter.py, the SQLite database, or your main Hermes installation.

## Install
Stop the host backend and frontend first. In ~/Apps/hermes-life, make a copy of the project, then unzip this patch into that directory. Restart ./start.sh and ./scripts/start-world.sh in separate terminals, ensuring that the backend terminal still exports HERMES_LIFE_TRANSPORT=ssh and the existing VM SSH settings.

## Usage
Open http://127.0.0.1:5173. In **Independent discovery**, click **Scan VM projects**. The backend runs a fixed, read-only Python scan via SSH on the guest, restricted to `/home/hermes/projects`. It looks for TODO/FIXME markers in bounded code/document files. Proposals persist in the existing SQLite database. Review and choose **approve**, **defer**, or **dismiss**. Approved candidates become pending existing Phase 3 goals, which the opt-in scheduler can execute. Proposals request *investigation only*, with no file modifications.

## Contracts
GET /api/discoveries; POST /api/discoveries/scan; POST /api/discoveries/{id}/approve|defer|dismiss. Events: discovery.proposed, discovery.scan_completed, discovery.approved, discovery.deferred, discovery.dismissed. The existing /api/tasks, /api/goals, /ws/events remain unchanged.

## Limits
Discovery is **manually initiated** and approvals are mandatory in this increment. It does **not** yet independently choose when to scan, invent new goals without markers, implement fixes, reflect on successes, or learn a new skill. Those need a separate bounded decision/evaluation loop. Never expose the backend externally without authentication.

## Validation
9 Python tests passed (including new proposal deduplication, approval, persisted goal and restart). Frontend browser/build and live SSH scanning have not been verified in this container.
