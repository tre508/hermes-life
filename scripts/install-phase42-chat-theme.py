#!/usr/bin/env python3
"""Install Phase 4.2 chat presentation only; preserve runtime and memories."""
from pathlib import Path
from datetime import datetime
import shutil
root = Path(__file__).resolve().parents[1]
frontend = root / 'frontend' / 'src'
ts = frontend / 'hermes-chat.ts'
css = frontend / 'hermes-chat.css'
if not ts.exists() or not css.exists():
    raise SystemExit('Phase 4.1 chat not installed: frontend/src/hermes-chat.ts and .css are required.')
# The package ships replacement files under scripts/phase42-assets to avoid
# overwriting anything until the installer checks the installed chat.
assets = root / 'scripts' / 'phase42-assets'
for file in (ts, css):
    source = assets / file.name
    if not source.exists():
        raise SystemExit(f'Missing patch asset: {source}')
    if file.name == 'hermes-chat.ts':
        existing = file.read_text()
        if 'hc-toggle' not in existing or '/api/tasks' not in existing:
            raise SystemExit('Unknown chat implementation. Aborting without replacing it.')
stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
for file in (ts, css):
    shutil.copy2(file, file.with_name(f'{file.name}.before-phase42-{stamp}'))
    shutil.copy2(assets / file.name, file)
print('Phase 4.2 dark chat theme installed. Backend, conversations, vault and agent transport unchanged.')
