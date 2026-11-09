"""HL-PERS-001 §5G — the Obsidian mirror must not keep presenting superseded knowledge as current.

The mirror was write-once: `_mirror` returned early when the note existed and no invalidation branch
ever touched the vault, so a corrected or deleted memory left a note that still read as current. These
tests pin the lifecycle: a note records its status, a retired memory is marked in place, a curated body
below the front matter survives verbatim, and the vault can never fail a correction.
"""
import os

import pytest
from fastapi.testclient import TestClient

from hermes_life.app import create_app

MEMORY = 'Prefer identifying the root cause from verifiable evidence before proposing a fix.'
ADAPTER = type('Adapter', (), {
    'available': lambda self: True,
    'run': lambda self, prompt, callback, task_id=None: {'result': 'ok', 'session_id': 's'},
    'cancel': lambda self, task_id: True,
})()


def runtime_of(client):
    return getattr(client.app, 'state').runtime


def app_client(tmp_path, vault=None):
    os.environ['HERMES_LIFE_OBSIDIAN_VAULT'] = str(vault or tmp_path / 'vault')
    client = TestClient(create_app(database=tmp_path / 'life.db', adapter=ADAPTER))
    client.__enter__()
    return client


def note_path(vault, memory_id, kind='preference'):
    return vault / 'Hermes-Life' / 'Memory' / 'Auto' / f'{kind.capitalize()}s' / f'{memory_id}.md'


def save(client, content=MEMORY, kind='preference'):
    response = client.post('/api/memories', json={'content': content, 'kind': kind})
    assert response.status_code == 201, response.text
    return response.json()['id']


def front_matter(text):
    keys, _, body = text[4:].partition('\n---\n')
    return dict(line.split(': ', 1) for line in keys.strip().splitlines()), body


def test_the_test_environment_cannot_reach_the_real_vault(tmp_path):
    """Regression: the suite used to resolve the *live* Obsidian vault and write fixture notes into it.

    `create_app` reads HERMES_LIFE_OBSIDIAN_VAULT, so conftest must always point it somewhere disposable.
    """
    from pathlib import Path

    real = Path.home() / 'black' / 'obsidian' / 'hermes'
    client = TestClient(create_app(database=tmp_path / 'guard.db', adapter=ADAPTER))
    client.__enter__()
    resolved = runtime_of(client).vault_memory.vault
    assert resolved != real, 'a test must never resolve the user\'s real vault'
    assert str(resolved).startswith(str(tmp_path.parent)), f'expected a scratch vault, got {resolved}'


def test_a_saved_memory_is_mirrored_with_its_status_and_provenance(tmp_path):
    vault = tmp_path / 'vault'
    vault.mkdir()
    client = app_client(tmp_path, vault)
    memory_id = save(client)

    path = note_path(vault, memory_id)
    assert path.is_file(), 'an explicitly saved memory must appear in the mirror'
    keys, body = front_matter(path.read_text())
    assert keys['status'] == '"active"' and keys['kind'] == '"preference"'
    assert keys['hermes_memory_id'] == f'"{memory_id}"' and 'updated_at' in keys
    assert MEMORY in body


def test_an_invalidated_memory_is_marked_and_keeps_its_body(tmp_path):
    vault = tmp_path / 'vault'
    vault.mkdir()
    client = app_client(tmp_path, vault)
    memory_id = save(client)
    path = note_path(vault, memory_id)
    path.write_text(path.read_text() + '\nHand-written context that must survive.\n')

    response = client.post(f'/api/personality/profile/{memory_id}/correct',
                           json={'action': 'delete', 'rationale': 'the preference changed',
                                 'actor': 'gayzer'})
    assert response.status_code == 200, response.text

    text = path.read_text()
    keys, body = front_matter(text)
    assert keys['status'] == '"invalidated"', 'a retired note must stop claiming to be current'
    assert keys['decided_by'] == '"gayzer"' and keys['rationale'] == '"the preference changed"'
    assert '> **Invalidated** on ' in body and 'the preference changed' in body
    assert 'Hand-written context that must survive.' in body, 'the body must be preserved, not replaced'
    assert MEMORY in body


def test_a_supersede_marks_the_old_note_and_writes_the_replacement(tmp_path):
    vault = tmp_path / 'vault'
    vault.mkdir()
    client = app_client(tmp_path, vault)
    memory_id = save(client)

    response = client.post(f'/api/personality/profile/{memory_id}/correct',
                           json={'action': 'supersede', 'new_content': 'Prefer leading with the answer.',
                                 'rationale': 'the user restated it', 'actor': 'gayzer'})
    assert response.status_code == 200, response.text
    replacement = response.json()['new_memory_id']

    keys, body = front_matter(note_path(vault, memory_id).read_text())
    assert keys['status'] == '"superseded"' and keys['superseded_by'] == f'"{replacement}"'
    assert '> **Superseded** on ' in body

    new_keys, new_body = front_matter(note_path(vault, replacement).read_text())
    assert new_keys['status'] == '"active"' and 'Prefer leading with the answer.' in new_body


def test_a_merge_marks_the_retired_duplicate_and_leaves_the_target_current(tmp_path):
    vault = tmp_path / 'vault'
    vault.mkdir()
    client = app_client(tmp_path, vault)
    keep = save(client, 'Prefer leading with the answer.')
    duplicate = save(client, 'Prefer short replies that front-load the answer.')

    response = client.post(f'/api/personality/profile/{duplicate}/correct',
                           json={'action': 'merge', 'merge_into': keep,
                                 'rationale': 'the same preference in different words'})
    assert response.status_code == 200, response.text
    keys, body = front_matter(note_path(vault, duplicate).read_text())
    assert keys['status'] == '"merged"' and keys['superseded_by'] == f'"{keep}"'
    assert '> **Merged** on ' in body and keep in body
    assert front_matter(note_path(vault, keep).read_text())[0]['status'] == '"active"'


def test_retiring_twice_leaves_one_marker_not_a_stack(tmp_path):
    vault = tmp_path / 'vault'
    vault.mkdir()
    client = app_client(tmp_path, vault)
    memory_id = save(client)
    vault_memory = runtime_of(client).vault_memory
    retire = lambda why: vault_memory.retire_memory(memory_id, 'preference', 'invalidated', None, why, 'gayzer')
    assert retire('first reason') == 'marked'
    assert retire('second reason') == 'marked'

    keys, body = front_matter(note_path(vault, memory_id).read_text())
    assert body.count('> **Invalidated**') == 1, 'the marker must be replaced, not appended to'
    assert 'second reason' in body and 'first reason' not in body
    assert text_key_count(note_path(vault, memory_id).read_text(), 'status') == 1


def text_key_count(text, name):
    keys, _, _ = text[4:].partition('\n---\n')
    return sum(1 for line in keys.splitlines() if line.startswith(name + ':'))


def test_the_vault_never_creates_a_note_for_a_memory_it_never_saw(tmp_path):
    vault = tmp_path / 'vault'
    vault.mkdir()
    client = app_client(tmp_path, vault)
    vault_memory = runtime_of(client).vault_memory
    assert vault_memory.retire_memory('never-mirrored', 'preference', 'invalidated', None, 'gone') == 'absent'
    assert not list((vault / 'Hermes-Life' / 'Memory' / 'Auto').rglob('*.md'))


def test_a_curated_note_is_never_touched(tmp_path):
    vault = tmp_path / 'vault'
    memory = vault / 'Hermes-Life' / 'Memory'
    (memory / 'Curated').mkdir(parents=True)
    curated = memory / 'Curated' / 'hand-written.md'
    curated.write_text('# Curated\n\nA note a human maintains.\n')
    client = app_client(tmp_path, vault)

    memory_id = save(client)
    client.post(f'/api/personality/profile/{memory_id}/correct',
                json={'action': 'delete', 'rationale': 'retired'})

    assert curated.read_text() == '# Curated\n\nA note a human maintains.\n', 'Curated/ is human territory'


def test_a_vault_failure_never_fails_a_correction(tmp_path):
    if os.geteuid() == 0:
        pytest.skip('a read-only directory does not stop root')
    vault = tmp_path / 'vault'
    vault.mkdir()
    client = app_client(tmp_path, vault)
    memory_id = save(client)
    # Writing an existing file needs write permission on the file itself, not on its directory.
    note_path(vault, memory_id).chmod(0o400)
    try:
        assert runtime_of(client).vault_memory.retire_memory(
            memory_id, 'preference', 'invalidated', None, 'retired') == 'failed'
        response = client.post(f'/api/personality/profile/{memory_id}/correct',
                               json={'action': 'delete', 'rationale': 'retired'})
        assert response.status_code == 200, 'the vault is a mirror: it cannot veto a correction'
    finally:
        note_path(vault, memory_id).chmod(0o600)
    assert client.get('/api/personality/profile').json()['profile'] == []


def test_a_review_accept_marks_the_note_it_replaced(tmp_path):
    vault = tmp_path / 'vault'
    vault.mkdir()
    client = app_client(tmp_path, vault)
    memory_id = save(client)
    runtime = runtime_of(client)
    with runtime.store.lock:
        cursor = runtime.store.connection.execute(
            'INSERT INTO hl_memory_reviews(task_id,candidate,existing_memory_id,reason)'
            " VALUES('t1','Prefer short replies that get to the point.',?,'contradiction')", (memory_id,))
        runtime.store.connection.commit()
        review_id = cursor.lastrowid

    response = client.post(f'/api/memory-reviews/{review_id}/resolve',
                           json={'decision': 'accept', 'rationale': 'the newer wording wins'})
    assert response.status_code == 200, response.text

    keys, body = front_matter(note_path(vault, memory_id).read_text())
    assert keys['status'] == '"superseded"' and '> **Superseded** on ' in body
    newer = [path for path in (vault / 'Hermes-Life' / 'Memory' / 'Auto').rglob('*.md')
             if path.name != f'{memory_id}.md']
    assert len(newer) == 1 and front_matter(newer[0].read_text())[0]['status'] == '"active"'
