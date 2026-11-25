"""Deleting a conversation — the host-side half of the chat's delete control.

Three things must hold or the feature is a lie about what it did:

  * the turns go with their conversation (leaving them behind would resurrect a
    deleted thread the moment anything listed turns);
  * the TASKS stay — they are the worker's audit trail (model, cost, commands),
    not the chat's content, and a deleted chat must not rewrite that history;
  * deletion is scoped to the id we generated, so no id can be talked into
    removing a note the user owns.

Hermetic: temp DB, temp vault, no worker.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.conversation_memory import ConversationMemory
from hermes_life.schema import migrate
from hermes_life.store import Store


@pytest.fixture()
def memory(tmp_path, monkeypatch):
    """A store, a conversation memory, and a vault we are allowed to write in."""
    vault = tmp_path / 'vault'
    (vault / 'Hermes-Life' / 'Conversations').mkdir(parents=True)
    monkeypatch.setenv('HERMES_LIFE_OBSIDIAN_VAULT', str(vault))
    store = Store(str(tmp_path / 'hl.sqlite3'))
    migrate(store.connection)
    return store, ConversationMemory(store), vault / 'Hermes-Life' / 'Conversations'


def _seed(store, memory, prompt='hello there'):
    """One conversation with a user turn, an assistant turn and a revision."""
    cid = memory.add_user_turn(prompt, None, 'task-' + uuid.uuid4().hex[:8])
    memory.finish(cid, 'task-1', {'result': 'an answer'})
    turn = store.connection.execute(
        'SELECT id FROM hl_conversation_turns WHERE conversation_id=? ORDER BY id', (cid,)).fetchone()
    store.connection.execute(
        'INSERT INTO hl_turn_revisions (id,conversation_id,original_turn_id,revised_content,task_id,created_at)'
        ' VALUES (?,?,?,?,?,?)',
        (str(uuid.uuid4()), cid, turn['id'], 'revised', 'rev-' + uuid.uuid4().hex[:8], '2026-01-01T00:00:00'))
    store.connection.commit()
    return cid


# ---------------------------------------------------------------- the store

def test_delete_removes_the_conversation_and_everything_that_points_at_it(memory):
    store, mem, _ = memory
    cid = _seed(store, mem)

    assert mem.delete(cid) is True

    def count(table, column):
        return store.connection.execute(
            f'SELECT COUNT(*) FROM {table} WHERE {column}=?', (cid,)).fetchone()[0]
    assert count('hl_conversations', 'id') == 0
    assert count('hl_conversation_turns', 'conversation_id') == 0
    assert count('hl_turn_revisions', 'conversation_id') == 0
    assert mem.turns(cid) == []


def test_delete_leaves_the_other_conversations_alone(memory):
    store, mem, _ = memory
    keep = _seed(store, mem, 'keep me')
    drop = _seed(store, mem, 'drop me')

    mem.delete(drop)

    assert [c['id'] for c in mem.list()] == [keep]
    assert len(mem.turns(keep)) == 2


def test_delete_keeps_the_task_records(memory):
    """A task is the worker's audit trail, not chat content."""
    store, mem, _ = memory
    cid = mem.add_user_turn('prompt', None, 'task-audit')
    store.connection.execute(
        'INSERT INTO tasks (id,prompt,state,created_at,updated_at) VALUES (?,?,?,?,?)',
        ('task-audit', 'prompt', 'completed', '2026-01-01T00:00:00', '2026-01-01T00:00:00'))
    store.connection.commit()

    mem.delete(cid)

    left = store.connection.execute('SELECT COUNT(*) FROM tasks WHERE id=?', ('task-audit',)).fetchone()[0]
    assert left == 1


def test_deleting_an_unknown_conversation_reports_false(memory):
    _, mem, _ = memory
    assert mem.delete(str(uuid.uuid4())) is False
    assert mem.delete('') is False
    assert mem.delete('not-a-uuid') is False


# ---------------------------------------------------------------- the mirror

def test_delete_removes_this_conversations_mirror_note(memory):
    store, mem, notes = memory
    cid = _seed(store, mem)
    assert (notes / f'{cid}.md').is_file()          # the mirror is really there first

    mem.delete(cid)

    assert not (notes / f'{cid}.md').exists()


def test_a_foreign_note_is_never_touched(memory):
    """Only `<uuid>.md` inside our own Conversations folder is a deletion target."""
    store, mem, notes = memory
    cid = _seed(store, mem)
    foreign = notes / 'notes-i-wrote.md'
    foreign.write_text('mine', encoding='utf-8')

    mem.delete(cid)
    assert mem._unmirror('../../notes-i-wrote') == 'refused'
    assert mem._unmirror('not-a-uuid') == 'refused'
    assert foreign.is_file()


# ---------------------------------------------------------------- the route

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.delenv('HERMES_LIFE_GATE_PASSWORD_HASH', raising=False)
    monkeypatch.delenv('HERMES_LIFE_GATE_PASSKEY_STORE', raising=False)
    app = create_app(database=str(tmp_path / 'route.sqlite3'))
    return TestClient(app), app


def test_route_deletes_and_then_reports_it_gone(client):
    http, app = client
    mem = app.state.runtime.conversations
    cid = _seed(app.state.runtime.store, mem)

    assert cid in [c['id'] for c in http.get('/api/conversations').json()['conversations']]

    first = http.delete(f'/api/conversations/{cid}')
    assert first.status_code == 200
    assert first.json() == {'deleted': cid}
    assert cid not in [c['id'] for c in http.get('/api/conversations').json()['conversations']]

    # Gone is not the same as never existed, and the second answer says so.
    assert http.delete(f'/api/conversations/{cid}').status_code == 404
    assert http.delete(f'/api/conversations/{uuid.uuid4()}').status_code == 404
