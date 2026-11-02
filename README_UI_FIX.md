# Hermes Life UI patch 3.3.1

What changes:
- Sidebar becomes internally scrollable on desktop. The world stays visible.
- Discovery, formulation, decisions, autonomy, history, activity, and room info can collapse.
- Reloads no longer automatically select/display an old completed task. You can still open any old task from Task History.
- Historical event replay no longer triggers API refreshes for every past event.
- Empty discovery explains why the Formulate goal button is not present. The button appears only for a discovered TODO/FIXME entry.

Install on host after stopping frontend:

```bash
cd ~/Apps/hermes-life
cp -a frontend "frontend.backup-$(date +%Y%m%d-%H%M%S)"
unzip -o ~/Downloads/hermes-life-phase3.3-ui-fix.zip
./scripts/start-world.sh
```

Backend and SSH adapter unchanged. Hard refresh the browser if it caches old code.
