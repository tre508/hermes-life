#!/usr/bin/env python3
"""Install project-workspace routing without replacing existing app modules."""
from pathlib import Path
import ast
import shutil
from datetime import datetime
ROOT=Path(__file__).resolve().parents[1]
app=ROOT/'hermes_life/app.py'
module=ROOT/'hermes_life/project_workspaces.py'
if not app.is_file() or not module.is_file():raise SystemExit('Missing app.py or project_workspaces.py; extract ZIP into repo root first')
text=app.read_text()
if 'PHASE411_PROJECT_WORKSPACES' in text:raise SystemExit('Already installed')
imp='from .project_workspaces import ProjectWorkspaces, add_project_routes  # PHASE411_PROJECT_WORKSPACES\n'
marker='from .knowledge_library import KnowledgeLibrary, KnowledgeAdapter\n'
if text.count(marker)!=1:raise SystemExit('Could not identify imports uniquely')
text=text.replace(marker,marker+imp)
needle='        self.active = threading.Lock()'
if text.count(needle)!=1:raise SystemExit('Could not locate Runtime active lock')
text=text.replace(needle,'        self.project_workspaces = ProjectWorkspaces(self)\n'+needle,1)
needle="            context = self.conversations.context(conversation_id, ident) if conversation_id else ''"
if text.count(needle)!=1:raise SystemExit('Conversation context layout differs')
text=text.replace(needle,needle+'''
            # Select a registered project from chat or goal prompts using @project slug.
            selected = SELECTOR.search(self.store.task(ident)['prompt'])
            if selected:
                context = self.project_workspaces.context(selected.group(1)) + context
''',1)
text=text.replace('from .project_workspaces import ProjectWorkspaces, add_project_routes  # PHASE411_PROJECT_WORKSPACES','from .project_workspaces import ProjectWorkspaces, add_project_routes, SELECTOR  # PHASE411_PROJECT_WORKSPACES')
needle="    app.state.runtime = runtime"
if text.count(needle)!=1:raise SystemExit('Could not locate FastAPI runtime binding')
text=text.replace(needle,needle+'\n    add_project_routes(app, runtime, runtime.project_workspaces)',1)
ast.parse(text)
ast.parse(module.read_text())
backup=app.with_name('app.py.before-phase411-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
shutil.copy2(app,backup)
app.write_text(text)
print('Phase 4.11 installed. Backup:',backup)
print('Restart backend; register and sync projects via /api/projects.')
