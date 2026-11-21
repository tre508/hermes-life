"""M2 sanity check: real ONNX model through the backfill path (run once, not in CI)."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from hermes_life.knowledge_library import KnowledgeLibrary  # noqa: E402
from hermes_life.schema import migrate  # noqa: E402
from hermes_life.store import Store  # noqa: E402

tmp = tempfile.mkdtemp()
store = Store(os.path.join(tmp, 's.db'))
migrate(store.connection)
lib = KnowledgeLibrary(store)
lib.migrate()
src = lib.register('https://example.com/t.pdf', 'T')
lib.add_pages(src['source_id'], [{'page': 1, 'text': 'To stop a program that is running, use the kill command.'}])
print('backfill:', lib.backfill())
row = store.connection.execute('SELECT length(embedding), embed_model FROM library_chunks').fetchone()
print('vector bytes:', row[0], 'model:', row[1])
print('sources:', lib.sources()[0]['chunks'], lib.sources()[0]['embedded_chunks'])
