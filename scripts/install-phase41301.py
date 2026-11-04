#!/usr/bin/env python3
"""Install UI-413-01 without replacing the existing Hermes Life frontend."""
from pathlib import Path
import datetime, shutil
root=Path(__file__).resolve().parents[1]
main=root/'frontend/src/main.ts'
module=root/'frontend/src/phase41301-discover.ts'
css=root/'frontend/src/phase41301-discover.css'
if not all(p.exists() for p in (main,module,css)):
    raise SystemExit('Missing main.ts or UI-413-01 assets; run from extracted package in repository root')
content=main.read_text()
anchor="import './phase41301-discover';"
if anchor in content:
    print('UI-413-01 already installed');raise SystemExit(0)
stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
shutil.copy2(main,main.with_name(f'main.ts.before-phase41301-{stamp}'))
main.write_text(content+'\n// UI-413-01: Discover presentation (non-invasive)\n'+anchor+'\n')
print('Installed UI-413-01. Run npm run build, then restart Vite and refresh.')
