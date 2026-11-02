#!/usr/bin/env python3
"""Install a real Hermes Life chat frontend, requires Phase 4.0 conversation API."""
from pathlib import Path
from datetime import datetime
import shutil
root=Path(__file__).resolve().parents[1]
main=root/'frontend/src/main.ts'
chat=root/'frontend/src/hermes-chat.ts'
css=root/'frontend/src/hermes-chat.css'
if not all(p.exists() for p in (main,chat,css)):
    raise SystemExit('Missing source files; extract this archive at Hermes Life root.')
app=root/'hermes_life/app.py'
if not app.is_file() or 'ConversationMemory' not in app.read_text() or "@app.get('/api/conversations')" not in app.read_text():
    raise SystemExit('Phase 4.0 backend not installed. Install conversation continuity first.')
source=main.read_text()
if "import './hermes-chat';" in source:
    print('Hermes chat already installed.');raise SystemExit(0)
shutil.copy2(main,main.with_name(main.name+'.before-phase41-'+datetime.now().strftime('%Y%m%d-%H%M%S')))
main.write_text("import './hermes-chat';\n"+source)
print('Hermes chat installed. Restart frontend and open Chat in the browser.')
