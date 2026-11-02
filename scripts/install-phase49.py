#!/usr/bin/env python3
"""Install Phase 4.9 on the Phase 4.3+ backend; preserve existing integrations."""
from pathlib import Path
import ast,datetime,shutil
root=Path(__file__).resolve().parents[1]
app=root/'hermes_life/app.py'
asset=root/'scripts/phase49-assets/vault_memory.py'
target=root/'hermes_life/vault_memory.py'
for p in (app,asset):
    if not p.is_file():raise SystemExit(f'Missing: {p}')
s=app.read_text()
if 'PHASE49_VAULT_MEMORY' in s:raise SystemExit('Phase 4.9 already installed')
anchors=[
 ('from .conversation_recall import Recall','from .conversation_recall import Recall\nfrom .vault_memory import VaultMemory  # PHASE49_VAULT_MEMORY'),
 ('self.recall = Recall(self.store)','self.recall = Recall(self.store)\n        self.vault_memory = VaultMemory(self.store, self.recall)'),
 ("recall = self.recall.retrieve(self.store.task(ident)['prompt'], conversation_id) if conversation_id else ''", "recall = self.recall.retrieve(self.store.task(ident)['prompt'], conversation_id) if conversation_id else ''\n            recall += self.vault_memory.retrieve_notes(self.store.task(ident)['prompt']) if conversation_id else ''"),
 ('if conversation_id: self.conversations.finish(conversation_id, ident, result)', 'if conversation_id:\n                self.conversations.finish(conversation_id, ident, result)\n                try:\n                    self.vault_memory.extract_completed(conversation_id, ident)\n                except Exception as exc:\n                    self.store.emit("memory.extraction_failed", {"error":str(exc)[:400]}, ident)'),
]
for old,_ in anchors:
    if s.count(old)!=1:raise SystemExit(f'Compatibility check failed: expected once: {old[:85]}')
for old,new in anchors:s=s.replace(old,new,1)
ast.parse(s)
ast.parse(asset.read_text())
stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
shutil.copy2(app,app.with_name(app.name+'.before-phase49-'+stamp))
shutil.copy2(asset,target)
app.write_text(s)
print('Phase 4.9 installed. Restart backend. Vault curated notes: Hermes-Life/Memory/Curated and Hermes-Life/Projects.')
