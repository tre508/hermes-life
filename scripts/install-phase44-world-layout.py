#!/usr/bin/env python3
"""Add Evidence tab and world-first layout without touching Hermes runtime or memory."""
from pathlib import Path
from datetime import datetime
import shutil

root = Path(__file__).resolve().parents[1]
src = root / 'frontend' / 'src'
main = src / 'main.ts'
asset_dir = root / 'scripts' / 'phase44-assets'
if not main.exists() or not (src / 'style.css').exists():
    raise SystemExit('Missing frontend/src/main.ts or style.css; no changes made.')
content = main.read_text()
if 'data-ops-tab' not in content or 'response-workspace' not in content:
    raise SystemExit('Unrecognized Hermes World frontend. No changes made.')
for name in ('phase44-layout.ts', 'phase44-layout.css'):
    if not (asset_dir / name).exists():
        raise SystemExit(f'Missing patch asset {name}; no changes made.')
if 'installWorldFirstLayout' in content:
    print('Phase 4.4 world layout is already installed.')
    raise SystemExit(0)
stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
shutil.copy2(main, main.with_name(f'main.ts.before-phase44-{stamp}'))
for name in ('phase44-layout.ts', 'phase44-layout.css'):
    target = src / name
    if target.exists():
        shutil.copy2(target, target.with_name(f'{name}.before-phase44-{stamp}'))
    shutil.copy2(asset_dir / name, target)
main.write_text(content + "\n// Phase 4.4: non-destructive Evidence tab / expanded world layout.\nimport { installWorldFirstLayout } from './phase44-layout';\nimport './phase44-layout.css';\ninstallWorldFirstLayout();\n")
print('Phase 4.4 installed: Response & Evidence moved into an Evidence tab; world enlarged.')
print('Backups:', main.with_name(f'main.ts.before-phase44-{stamp}'))
