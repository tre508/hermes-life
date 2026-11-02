# Hermes Life Phase 4.12 — Chat project picker + approved host application

**Prerequisite:** Phase 4.11 has already been installed, the backend is running its `ProjectWorkspaces` extension, and the chosen project is registered and synchronized.

## Install

Extract this archive at the Hermes Life repository root, then:

```bash
.venv/bin/python scripts/install-phase412.py
.venv/bin/python -m py_compile hermes_life/project_approvals.py hermes_life/app.py
cd frontend && npm run build
```

Restart the existing FastAPI backend and Vite frontend, then refresh your browser. No existing chat, goal, memory, or task handlers are replaced.

## Use

1. Open Hermes Chat. **Coding project** offers registered projects from `GET /api/projects`. Select a project.
2. Click **Sync** after committing host changes. It creates a fresh VM workspace from committed Git content.
3. Send your usual chat instructions. The picker prepends `@project <name>` when sending, letting the Phase 4.11 backend route the task. An explicit `@project` in the message takes precedence.
4. Hermes edits/tests only in the VM workspace.
5. Click **Review changes** to inspect the exact Git diff. The backend issues a 15-minute, single-use review token tied to a SHA-256 hash of the diff and base commit.
6. Type `APPLY <name>`, click **Apply reviewed changes to host**, and accept the final confirmation.
7. The backend re-reads the VM diff, verifies the checksum, confirms the host commit and clean worktree, checks whether the patch applies, and applies it to the **uncommitted host working tree**. It never auto-commits, auto-deploys, or executes the changed code on the host.

## Endpoints

- `POST /api/projects/{name}/review` — returns diff, hash and one-time review ID.
- `POST /api/projects/{name}/apply` — body `{ "review_id": "...", "confirmation": "APPLY hermes-life" }`.

## Boundaries

- **Local trust model:** these are powerful write endpoints, intended only for the loopback-bound Hermes Life backend. Do not expose them to a public network without authentication and authorization.
- Only Git working-tree diffs are applied; newly created files are included through `git add -N` inside the VM. Existing host uncommitted changes, base commit drift, changed VM diff, symlink or submodule changes are rejected.
- No automatic goal-to-project inference, PR publishing, conflict resolver, auto-commit, or deployment.
- Approval tokens are in memory and expire after 15 minutes, so a backend restart requires another review.
- Only one project's approval operations are serialized inside one backend process. Direct concurrent modifications to the repository outside Hermes remain out-of-band.
