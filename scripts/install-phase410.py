#!/usr/bin/env python3
"""Phase 4.10: conservative semantic memory extraction + review queue."""
import ast
from pathlib import Path
import shutil
from datetime import datetime
root=Path(__file__).resolve().parents[1]
app=root/'hermes_life/app.py'
target=root/'hermes_life/vault_memory.py'
asset=root/'scripts/phase410-assets/vault_memory.py'
routes=root/'scripts/phase410-assets/review_routes.txt'
for p in (app,target,asset):
    if not p.is_file():raise SystemExit(f'Missing expected file: {p}')
s=app.read_text();old='self.vault_memory = VaultMemory(self.store, self.recall)'
new='self.vault_memory = VaultMemory(self.store, self.recall, self.adapter)  # PHASE410_SEMANTIC_MEMORY'
if new in s:raise SystemExit('Phase 4.10 already installed.')
if s.count(old)!=1:raise SystemExit('Expected Phase 4.9 VaultMemory constructor not found; nothing changed')
# The wrapper must exist before the memory extractor gets it.
if s.index('self.adapter =')>s.index(old):raise SystemExit('Adapter constructed after memory; incompatible app layout')
s=s.replace(old,new,1)
anchor="    @app.get('/api/memories')"
if s.count(anchor)!=1:raise SystemExit('Memory API anchor absent; nothing changed')
s=s.replace(anchor,routes.read_text()+anchor,1)
ast.parse(s);ast.parse(asset.read_text())
stamp=datetime.now().strftime('%Y%m%d-%H%M%S')
for path in (app,target):shutil.copy2(path,path.with_name(path.name+'.before-phase410-'+stamp))
app.write_text(s);shutil.copy2(asset,target)
print('Phase 4.10 installed; previous files backed up. Restart backend.')
