# Hermes Life Phase 4.15 – Compact chat workspace + review drawer

Replaces the Phase 4.12 frontend project UI in place. The Phase 4.12 backend APIs, approval-token validation, task submission, project selection, and VM isolation are unchanged.

## Install

Extract the ZIP at the repository root. **Before extraction**, optionally back up `frontend/src/phase412-project-ui.ts`. Extraction replaces this single TypeScript file and adds `frontend/src/phase415-workspace.css` and a verification script.

```bash
cd ~/Apps/hermes-life
cp frontend/src/phase412-project-ui.ts frontend/src/phase412-project-ui.ts.pre-phase415
unzip -o ~/Downloads/hermes-life-phase4.15-compact-chat.zip
.venv/bin/python scripts/install-phase415.py
cd frontend && npm run build
```

The chat displays a one-line project selector + Workspace button, with the full review/apply UI in an overlay drawer shown only when requested. The chat also gains Expand/Restore. The drawer keeps its pending review while closed; refreshing, changing projects, syncing, and applying invalidate the old review. The host backend rechecks the actual diff and base before application as before. No host writes occur without the explicit confirmation phrase and final confirmation.

### Verify

1. With an active task, open the chat; messages and composer occupy the available height.
2. Change/select project and send a task: the existing `@project` behavior remains.
3. Open Workspace, click Review changes; diff and phrase are in a drawer, not above the composer.
4. Close Workspace; message history returns with no task interruption or lost review state.
5. Expand/Restore; confirm the composer is still visible.

This patch does **not** change the workflow engine or resolve its reported missing plan approval / lifecycle handoffs.
