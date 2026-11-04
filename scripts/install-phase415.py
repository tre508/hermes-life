#!/usr/bin/env python3
"""Install Phase 4.15 UI in place of the Phase 4.12 project UI module."""
from pathlib import Path
import shutil,datetime,subprocess,sys
root=Path(__file__).resolve().parents[1]
source=root/'frontend/src/phase412-project-ui.ts'
newcss=root/'frontend/src/phase415-workspace.css'
if not source.is_file() or not newcss.is_file():
    raise SystemExit('Phase 4.12 UI and Phase 4.15 CSS must be extracted into repository first.')
main=root/'frontend/src/main.ts'
if not main.is_file() or 'phase412-project-ui' not in main.read_text():
    raise SystemExit('Phase 4.12 frontend import missing; refusing ambiguous installation.')
if 'Phase 4.15' not in source.read_text() or 'hc415-workspace-drawer' not in source.read_text():
    raise SystemExit('Phase 4.15 UI replacement not found; no further changes made.')
print('Phase 4.15 UI files in place. Run: cd frontend && npm run build')
