#!/usr/bin/env python3
"""Small, idempotent integration of Phase 4.12 with Phase 4.11."""
from pathlib import Path
import ast
import datetime
import shutil
root=Path(__file__).resolve().parents[1]
app=root/'hermes_life/app.py'
ui=root/'frontend/src/main.ts'
api=root/'hermes_life/project_approvals.py'
client=root/'frontend/src/phase412-project-ui.ts'
for p in (app,ui,api,client):
    if not p.exists():raise SystemExit('Missing required file: '+str(p))
a=app.read_text();m=ui.read_text()
if 'PHASE412_APPROVALS' in a and 'phase412-project-ui' in m:
    print('Phase 4.12 already installed');raise SystemExit(0)
if 'PHASE411_PROJECT_WORKSPACES' not in a:
    raise SystemExit('Phase 4.11 must be installed first')
if 'PHASE412_APPROVALS' in a or 'phase412-project-ui' in m:
    raise SystemExit('Partial installation detected. No changes applied')
anchor='from .project_workspaces import ProjectWorkspaces, add_project_routes, SELECTOR  # PHASE411_PROJECT_WORKSPACES'
route='    add_project_routes(app, runtime, runtime.project_workspaces)'
if a.count(anchor)!=1 or a.count(route)!=1:
    raise SystemExit('Phase 4.11 backend anchors differ. No changes applied')
a=a.replace(anchor,anchor+'\nfrom .project_approvals import add_approval_routes  # PHASE412_APPROVALS')
a=a.replace(route,route+'\n    add_approval_routes(app, runtime.project_workspaces)',1)
m+='\n// PHASE412_PROJECT_PICKER\nimport \'./phase412-project-ui\';\n'
ast.parse(a)
now=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
for p in (app,ui):shutil.copy2(p,p.with_name(p.name+'.before-phase412-'+now))
app.write_text(a);ui.write_text(m)
print('Installed Phase 4.12. Restart FastAPI and Vite; open the chat project picker.')
