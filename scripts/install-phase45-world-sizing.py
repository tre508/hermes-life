#!/usr/bin/env python3
"""Correct the unbounded Phase 4.4 world/operations layout, without backend changes."""
from pathlib import Path
from datetime import datetime
import shutil

root = Path(__file__).resolve().parents[1]
src = root / 'frontend' / 'src'
main = src / 'main.ts'
asset = root / 'scripts' / 'phase45-assets' / 'phase45-world-layout.css'
target = src / 'phase45-world-layout.css'
if not main.is_file() or not (src / 'phase44-layout.css').is_file() or not asset.is_file():
    raise SystemExit('Phase 4.4 frontend files not found. No changes made.')
content = main.read_text()
marker = "import './phase45-world-layout.css';"
if marker in content:
    print('Phase 4.5 already installed; no changes made.')
    raise SystemExit(0)
if "import './phase44-layout.css';" not in content:
    raise SystemExit('Phase 4.4 import missing; no changes made.')
stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
shutil.copy2(main, main.with_name(f'main.ts.before-phase45-{stamp}'))
if target.exists():
    shutil.copy2(target, target.with_name(f'phase45-world-layout.css.before-{stamp}'))
shutil.copy2(asset, target)
main.write_text(content + '\n// Phase 4.5: bounded dashboard / world sizing fix.\n' + marker + '\n')
print('Installed Phase 4.5. World and operations panel bounded to viewport; activity scrolls inside tab.')
