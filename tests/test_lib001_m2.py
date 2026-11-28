"""HL-LIB-001 M2 exit gate: schema v39 migration + KnowledgeLibrary.backfill().

§6 M2: fresh DB and legacy-v38 DB both migrate (user_version asserted); backfill
fills all chunks, embedded_chunks == chunks. Uses a fake embedder so the tests
never depend on the ONNX model load (the real model path is covered by M1's
tests/test_embedding.py).
"""
import sqlite3
import struct
from pathlib import Path

import pytest

from hermes_life import embedding as embedding_module
from hermes_life.knowledge_library import KnowledgeLibrary
from hermes_life.schema import SCHEMA_VERSION, migrate
from hermes_life.store import Store


class FakeEmbedder:
    """Deterministic stand-in: 4-dim float32 vectors, 64-batch aware."""
    model_name = 'fake-model-v1'

    def __init__(self):
        self.calls = []

    def available(self):
        return True

    def embed(self, texts):
        self.calls.append(len(texts))
        out = []
        for text in texts:
            # Deterministic pseudo-vector from content length and first byte.
            key = (len(text) % 7, (ord(text[0]) if text else 0) % 13, 5, 2)
            out.append(struct.pack('<4f', *key))
        return out


@pytest.fixture
def fake_embedder(monkeypatch):
    embedder = FakeEmbedder()
    monkeypatch.setattr(embedding_module, 'get_embedder', lambda: embedder)
    return embedder


def _library(store):
    lib = KnowledgeLibrary(store)
    lib.migrate()
    return lib


def _seed(lib, url='https://example.com/doc.pdf', pages=None):
    source = lib.register(url, 'Doc')
    if pages is None:
        pages = [{'page': 1, 'text': 'Find files by name with the find command.\n\nchmod 755 sets permissions.'},
                 {'page': 2, 'text': 'Redirect standard output and standard error to a file.'}]
    return source, lib.add_pages(source['source_id'], pages)


def test_fresh_database_migrates_to_current_version_with_embedding_columns(tmp_path):
    conn = sqlite3.connect(tmp_path / 'fresh.db')
    migrate(conn)
    assert conn.execute('PRAGMA user_version').fetchone()[0] == SCHEMA_VERSION
    cols = {r[1] for r in conn.execute('PRAGMA table_info(library_chunks)')}
    assert {'embedding', 'embed_model'} <= cols
    # Re-running migration (lifespan re-invokes) must be idempotent.
    migrate(conn)
    assert conn.execute('PRAGMA user_version').fetchone()[0] == SCHEMA_VERSION


def test_legacy_v38_database_migrates_with_data_preserved(tmp_path, fake_embedder):
    """A real v38 database: migrate to v38, ingest chunks, then apply the remaining ladder.

    The fake embedder keeps backfill() hermetic: this test is about the migration
    ladder, not the ONNX model load (real-model coverage lives in test_embedding).
    """
    path = tmp_path / 'legacy.db'
    conn = sqlite3.connect(path)
    import hermes_life.schema as schema_module
    # Build a genuine v38 database by capping the schema at 38: drop the v39
    # function entirely (as a real v38-era codebase would), rebuild the registry
    # for 2..38, and let the normal ladder run. No neutered or hand-faked state.
    real_version = schema_module.SCHEMA_VERSION
    cap = 38
    # Remove EVERY upgrade above the cap dynamically (HA-009: the v40-era code
    # deleted only v39/v40, so any later addition to the ladder — v41, v42, … —
    # became a 'stray' and _build_registry() refused to build).
    removed: dict[str, object] = {}
    try:
        # Everything that mutates the module sits inside try/finally: a raise
        # before the del/after it must never leak SCHEMA_VERSION=38 into later
        # tests (that leak is what silently corrupted the ladder mid-suite).
        schema_module.SCHEMA_VERSION = cap
        for name, fn in list(vars(schema_module).items()):
            suffix = name[len('_upgrade_to_v'):]
            if name.startswith('_upgrade_to_v') and suffix.isdigit() and int(suffix) > cap:
                removed[name] = fn
                delattr(schema_module, name)
        schema_module._MIGRATIONS = schema_module._build_registry()
        migrate(conn)
    finally:
        schema_module.SCHEMA_VERSION = real_version
        for name, fn in removed.items():
            setattr(schema_module, name, fn)
        schema_module._MIGRATIONS = schema_module._build_registry()
    assert conn.execute('PRAGMA user_version').fetchone()[0] == 38
    assert 'embedding' not in {r[1] for r in conn.execute('PRAGMA table_info(library_chunks)')}

    # Seed a legacy chunk while still at v38 (direct SQL — the v38 table has no
    # embedding columns; this is the realistic pre-migration state).
    conn.execute("""INSERT INTO library_sources(url,title,kind,created_at,updated_at)
        VALUES('https://example.com/legacy.pdf','Legacy','pdf','now','now')""")
    conn.execute("""INSERT INTO library_chunks(source_id,page,ordinal,content,sha256)
        VALUES(1,1,0,'Find files by name with the find command.','abc')""")
    conn.commit()
    assert conn.execute('SELECT COUNT(*) FROM library_chunks').fetchone()[0] == 1

    migrate(conn)
    assert conn.execute('PRAGMA user_version').fetchone()[0] == SCHEMA_VERSION
    cols = {r[1] for r in conn.execute('PRAGMA table_info(library_chunks)')}
    assert {'embedding', 'embed_model'} <= cols
    # Pre-existing chunk data survived the migration, still unembedded.
    assert conn.execute('SELECT COUNT(*) FROM library_chunks').fetchone()[0] == 1
    store = Store(path)
    store.connection = conn
    conn.row_factory = sqlite3.Row  # match what Store normally provides
    lib = KnowledgeLibrary(store)
    lib.migrate()
    assert lib.sources()[0]['embedded_chunks'] == 0
    # Backfill fills the legacy chunk; a re-run is idempotent.
    assert lib.backfill()['embedded'] == 1
    assert lib.sources()[0]['embedded_chunks'] == lib.sources()[0]['chunks'] == 1
    assert lib.backfill()['embedded'] == 0
    # Idempotent on restart.
    migrate(conn)
    assert conn.execute('PRAGMA user_version').fetchone()[0] == SCHEMA_VERSION


def test_add_pages_embeds_at_ingest(tmp_path, fake_embedder):
    store = Store(tmp_path / 'ingest.db')
    migrate(store.connection)
    lib = _library(store)
    source, response = _seed(lib)
    assert response['chunks_written'] == 2
    assert response['embedded'] == 2
    assert response['unembedded'] == 0
    rows = store.connection.execute(
        'SELECT embedding, embed_model FROM library_chunks WHERE source_id=?',
        (source['source_id'],)).fetchall()
    assert all(r['embedding'] is not None for r in rows)
    assert all(r['embed_model'] == 'fake-model-v1' for r in rows)
    assert lib.sources()[0]['embedded_chunks'] == 2
    assert lib.sources()[0]['chunks'] == 2


def test_add_pages_degrades_to_null_embedding_when_model_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(embedding_module, 'get_embedder', lambda: None)
    store = Store(tmp_path / 'degraded.db')
    migrate(store.connection)
    lib = _library(store)
    source, response = _seed(lib)
    assert response['chunks_written'] == 2
    assert response['embedded'] == 0
    assert response['unembedded'] == 2
    rows = store.connection.execute(
        'SELECT embedding, embed_model FROM library_chunks').fetchall()
    assert all(r['embedding'] is None and r['embed_model'] is None for r in rows)
    # Keyword search still works on unembedded chunks (§4.4 — no retrieval hole).
    hits = lib.search('find files by name')
    assert hits and hits[0]['page'] == 1


def test_backfill_fills_all_chunks_and_is_idempotent(tmp_path, fake_embedder):
    store = Store(tmp_path / 'backfill.db')
    migrate(store.connection)
    lib = _library(store)
    # Ingest with a NULL embedder first (simulating a pre-v39 corpus / degraded ingest).
    import hermes_life.embedding as emb
    saved = emb.get_embedder
    emb.get_embedder = lambda: None
    try:
        _seed(lib)
    finally:
        emb.get_embedder = saved
    assert lib.sources()[0]['embedded_chunks'] == 0

    result = lib.backfill()
    assert result['embedded'] == 2
    assert result['pending'] == 0
    assert lib.sources()[0]['embedded_chunks'] == lib.sources()[0]['chunks'] == 2
    # Second run: nothing left to do.
    again = lib.backfill()
    assert again['embedded'] == 0
    assert again['pending'] == 0


def test_backfill_reembeds_chunks_with_stale_model(tmp_path, fake_embedder):
    store = Store(tmp_path / 'stale.db')
    migrate(store.connection)
    lib = _library(store)
    _seed(lib)
    assert lib.sources()[0]['embedded_chunks'] == 2
    # Simulate a model change: stamp rows with the old model name.
    store.connection.execute("UPDATE library_chunks SET embed_model='old-model'")
    store.connection.commit()
    result = lib.backfill()
    assert result['embedded'] == 2
    assert lib.sources()[0]['embedded_chunks'] == 2
    models = {r[0] for r in store.connection.execute('SELECT embed_model FROM library_chunks')}
    assert models == {'fake-model-v1'}


def test_backfill_batches_embed_calls(tmp_path, fake_embedder):
    store = Store(tmp_path / 'batch.db')
    migrate(store.connection)
    lib = _library(store)
    lib.register('https://example.com/b.pdf', 'B')
    pages = [{'page': n, 'text': f'Paragraph {n} about the find command.'} for n in range(1, 6)]
    # Ingest degraded (no embedder) so backfill has 5 chunks to fill.
    import hermes_life.embedding as emb
    saved = emb.get_embedder
    emb.get_embedder = lambda: None
    try:
        lib.add_pages(1, pages)
    finally:
        emb.get_embedder = saved
    assert len(lib.search('find command')) >= 1
    fake_embedder.calls.clear()
    lib.backfill(batch=2)
    # 5 chunks in batches of 2 -> 3 model calls (2+2+1).
    assert fake_embedder.calls == [2, 2, 1]


def test_backfill_reports_unavailable_embedder_without_exception(tmp_path, monkeypatch):
    monkeypatch.setattr(embedding_module, 'get_embedder', lambda: None)
    store = Store(tmp_path / 'unavail.db')
    migrate(store.connection)
    lib = _library(store)
    _seed(lib)
    result = lib.backfill()
    assert result == {'embedded': 0, 'pending': None, 'reason': 'embedder_unavailable'}
    assert lib.sources()[0]['embedded_chunks'] == 0
