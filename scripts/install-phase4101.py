#!/usr/bin/env python3
"""Phase 4.10.1 installer: semantic memory, compatible with adapter constructed later."""
import ast
from pathlib import Path
import shutil
from datetime import datetime

root = Path(__file__).resolve().parents[1]
app = root / 'hermes_life/app.py'
target = root / 'hermes_life/vault_memory.py'
asset = root / 'scripts/phase410-assets/vault_memory.py'
routes = root / 'scripts/phase410-assets/review_routes.txt'
for p in (app, target, asset, routes):
    if not p.is_file():
        raise SystemExit(f'Missing required file: {p}')

s = app.read_text()
old = 'self.vault_memory = VaultMemory(self.store, self.recall)'
marker = '# PHASE4101_SEMANTIC_MEMORY'
if marker in s or "@app.get('/api/memory-reviews')" in s:
    raise SystemExit('Phase 4.10 memory integration appears already installed; no files changed')
if s.count(old) != 1:
    raise SystemExit('Expected Phase 4.9 vault memory constructor not found; no files changed')

# Keep existing initialization order. The adapter wrapper is constructed later,
# so attach it to VaultMemory immediately after its construction instead of
# passing an adapter that does not yet exist.
lines = s.splitlines(keepends=True)
adapter_indices = [i for i, line in enumerate(lines) if line.lstrip().startswith('self.adapter =')]
if len(adapter_indices) != 1:
    raise SystemExit('Cannot uniquely locate Runtime adapter initialization; no files changed')
i = adapter_indices[0]
indent = lines[i][:len(lines[i]) - len(lines[i].lstrip())]
lines.insert(i + 1, f'{indent}self.vault_memory.adapter = self.adapter  {marker}\n')
s = ''.join(lines)
anchor = "    @app.get('/api/memories')"
if s.count(anchor) != 1:
    raise SystemExit('Memory API insertion point changed; no files changed')
s = s.replace(anchor, routes.read_text() + anchor, 1)
ast.parse(s)
ast.parse(asset.read_text())

stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
for p in (app, target):
    shutil.copy2(p, p.with_name(p.name + '.before-phase4101-' + stamp))
app.write_text(s)
shutil.copy2(asset, target)
print('Phase 4.10.1 installed: semantic memory attached after existing adapter initialization.')
print('Backups created. Restart the Hermes Life backend.')
