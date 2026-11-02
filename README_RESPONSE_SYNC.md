# Hermes Life 3.4.1 — Response synchronization

Fixes the disconnect between autonomous task activity and the Response Workspace.

- Live `task.queued`, `task.started`, `task.completed`, and `task.failed` events automatically select the corresponding task in Follow Live mode.
- On a browser reload, the latest recorded task event is restored and labeled **Latest agent activity**, not incorrectly called an active task.
- Clicking a historical task enters History selection mode; the **Follow live** button resumes automatic tracking.
- Existing task and tool event persistence is unchanged. No backend or database migration is involved.

## Install

Stop only the Vite frontend. Back up `frontend/index.html` and `frontend/src/main.ts`, then extract this ZIP at the project root:

```bash
cd ~/Apps/hermes-life
unzip -o ~/Downloads/hermes-life-phase3.4.1-response-sync-patch.zip
./scripts/start-world.sh
```

Refresh the browser with Ctrl+Shift+R.

## Verify

1. With Following live enabled, queue a manual or autonomous goal. The response task ID should track task events without clicking History.
2. When it completes, its result should be displayed.
3. Select an older history entry; it should remain selected while new live events arrive.
4. Click Follow live to return to the current/latest task.
5. Reload the page; the last observed task should appear as Latest agent activity with its actual completed/running state.
