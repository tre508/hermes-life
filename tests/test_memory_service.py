"""P4 Obsidian memory adapter: /memory/* contract over a temporary vault.

Covers the spec's acceptance surface: health, search with citation anchors,
note retrieval with backlinks/revision, atomic create, optimistic-revision
conflict rejection (409), path-traversal rejection, and reindex. The vault is
a tmp_path fixture — the real vault is never touched.
"""
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hermes_life.app import create_app


@pytest.fixture()
def vault(tmp_path):
    v = tmp_path / 'vault'
    (v / 'Hermes-Life' / 'Projects' / 'demo').mkdir(parents=True)
    (v / 'Hermes-Life' / 'Projects' / 'demo' / 'alpha.md').write_text(
        '---\nhermes_note_id: "note_alpha001"\ntitle: "Alpha note"\n'
        'project_id: "proj_1"\n---\n\n# Alpha note\n\nWikilink to [[Beta note]].\n')
    (v / 'Hermes-Life' / 'Projects' / 'demo' / 'beta.md').write_text(
        '---\ntitle: "Beta note"\n---\n\nBody mentioning ownership.\n')
    (v / 'Hermes-Life' / 'Memory').mkdir(parents=True, exist_ok=True)
    (v / 'Hermes-Life' / 'Memory' / 'legacy.md').write_text(
        '---\nhermes_memory_id: "mem_legacy01"\ntitle: "Legacy memory"\n---\n\nOld extraction note.\n')
    return v


@pytest.fixture()
def client(tmp_path, vault, monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_OBSIDIAN_VAULT', str(vault))
    monkeypatch.delenv('HERMES_LIFE_GATE_PASSWORD_HASH', raising=False)
    app = create_app(database=tmp_path / 'test.db')
    with TestClient(app) as test_client:
        yield test_client


def wait_for_index(client, minimum=3):
    for _ in range(50):
        data = client.get('/api/memory/reindex').json()
        if data.get('notes', 0) >= minimum:
            return data
        time.sleep(0.05)
    return client.get('/api/memory/reindex').json()


def test_health_reports_vault_state(client, vault):
    data = client.get('/api/memory/health').json()
    assert data['reachable'] is True
    assert data['writable'] is True
    assert data['index']['notes'] >= 3
    assert data['watcher']['running'] is True
    assert data['errors'] == []


def test_search_returns_stable_ids_and_citation_anchor(client):
    wait_for_index(client)
    results = client.get('/api/memory/search', params={'q': 'ownership'}).json()['results']
    assert any(r['path'].endswith('beta.md') for r in results)
    top = client.get('/api/memory/search', params={'q': 'alpha'}).json()['results'][0]
    assert top['note_id'] == 'note_alpha001'
    assert top['citation_anchor'] == top['path']
    assert 'excerpt' in top


def test_get_note_by_id_includes_backlinks_and_revision(client):
    wait_for_index(client)
    note = client.get('/api/memory/notes/note_alpha001').json()
    assert note['title'] == 'Alpha note'
    assert 'Beta note' in note['outgoing_links']
    # Legacy hermes_memory_id notes are first-class citizens.
    legacy = client.get('/api/memory/notes/mem_legacy01').json()
    assert legacy['title'] == 'Legacy memory'


def test_create_note_then_conflict_rejected_on_stale_patch(client, vault):
    wait_for_index(client)
    created = client.post('/api/memory/notes', json={
        'folder': 'Hermes-Life/Projects/demo', 'title': 'Gamma finding',
        'body': 'A research finding.', 'meta': {'project_id': 'proj_1'},
    })
    assert created.status_code == 200, created.text
    note_id = created.json()['note_id']
    path = vault / created.json()['path']
    assert path.exists()
    # Correct revision edits fine.
    fresh = client.get(f'/api/memory/notes/{note_id}').json()
    ok = client.patch(f'/api/memory/notes/{note_id}',
                      json={'expected_revision': fresh['revision'], 'body': 'Updated body.'})
    assert ok.status_code == 200
    # A stale revision (Obsidian edited underneath us) is rejected, not clobbered.
    stale = client.patch(f'/api/memory/notes/{note_id}',
                         json={'expected_revision': fresh['revision'], 'body': 'Clobber attempt.'})
    assert stale.status_code == 409
    assert client.get(f'/api/memory/notes/{note_id}').json()['body'].strip() == 'Updated body.'


def test_duplicate_create_and_traversal_rejected(client):
    wait_for_index(client)
    dup = client.post('/api/memory/notes', json={'folder': 'Hermes-Life/Projects/demo',
                                             'title': 'alpha', 'body': 'x'})
    assert dup.status_code == 400
    escape = client.post('/api/memory/notes', json={'folder': '../../escape', 'title': 'evil', 'body': 'x'})
    assert escape.status_code == 400
    assert not (Path(os.environ['HERMES_LIFE_OBSIDIAN_VAULT']).parent / 'escape').exists()


def test_unmounted_vault_degrades_to_health_error(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_OBSIDIAN_VAULT', str(tmp_path / 'not-mounted'))
    monkeypatch.delenv('HERMES_LIFE_GATE_PASSWORD_HASH', raising=False)
    app = create_app(database=tmp_path / 'test2.db')
    with TestClient(app) as c:
        data = c.get('/api/memory/health').json()
        assert data['reachable'] is False
        assert data['errors']
        assert c.get('/api/memory/search', params={'q': 'anything'}).json()['results'] == []
