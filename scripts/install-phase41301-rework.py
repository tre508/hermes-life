#!/usr/bin/env python3
"""Install Discover replacement; preserves original TS and its listeners for rollback."""
from pathlib import Path
from datetime import datetime
import shutil
root=Path(__file__).resolve().parents[1]
main=root/'frontend/src/main.ts'
mod=root/'frontend/src/phase41301-rework.ts'
css=root/'frontend/src/phase41301-rework.css'
for p in (main,mod,css):
    if not p.is_file():raise SystemExit(f'Missing {p}')
s=main.read_text()
if "import './phase41301-rework';" in s:
    print('UI-413-01 replacement already installed');raise SystemExit(0)
backup=main.with_name('main.ts.before-phase41301-rework-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
shutil.copy2(main,backup)
main.write_text(s+"\n// UI-413-01 replacement view\nimport './phase41301-rework';\n")
print('Installed. Backup:',backup)
