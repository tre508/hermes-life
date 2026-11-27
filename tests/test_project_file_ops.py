"""D1/D2: file-change events + explorer create/rename/move (build spec d1-d5-build-spec.md).

These exercise the ProjectWorkspaces manager directly: a file.changed event must
follow every successful write/move/delete/upload (never precede it, never fail
the operation), and mkdir/move must enforce the same containment + denylist as
every other write. The HTTP layer is the same `handle()` wrapper the existing
project routes use; the manager is the behavior under test.

NOTE: tests that build the full app via create_app are currently blocked by an
unrelated in-progress refactor in hermes_life/app.py (Runtime init raises
AttributeError). This module therefore constructs the manager with a minimal
fake runtime — the same containment code paths run either way.
"""
from __future__ import annotations

import os
import sqlite3
import threading

import pytest

from hermes_life.project_workspaces import ProjectWorkspaces, WorkspaceError


class FakeStore:
    def __init__(self):
        self.lock = threading.RLock()
        self.connection = sqlite3.connect(':memory:')
        self.connection.row_factory = sqlite3.Row
        self.connection.execute(
            'CREATE TABLE hl_projects (name TEXT PRIMARY KEY, host_path TEXT,'
            ' spec_path TEXT, remote_path TEXT, commit_hash TEXT, synced_at TEXT)')
        self.events: list[tuple[str, dict]] = []

    def emit(self, kind, payload, task_id=None, **links):
        self.events.append((kind, payload))


class FakeRuntime:
    def __init__(self, store):
        self.store = store


@pytest.fixture()
def ws(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_PROJECT_ROOT', str(tmp_path))
    monkeypatch.delenv('HERMES_LIFE_PROJECT_EXTRA_ROOTS', raising=False)
    runtime = FakeRuntime(FakeStore())
    manager = ProjectWorkspaces(runtime)
    project = tmp_path / 'demo'
    (project / 'src').mkdir(parents=True)
    (project / 'src' / 'a.py').write_text('print(1)\n')
    manager.register('demo', str(project))
    return manager, runtime.store, project


def _changes(store):
    return [p for kind, p in store.events if kind == 'file.changed']


def test_write_emits_file_changed_after_the_fact(ws):
    manager, store, project = ws
    res = manager.write_file('demo', 'src/b.py', 'x=1\n')
    changes = _changes(store)
    assert len(changes) == 1
    c = changes[0]
    assert c['project'] == 'demo' and c['path'] == 'src/b.py'
    assert c['change'] == 'written' and c['created'] is True
    assert c['mtime'] == res['mtime'] and c['size'] == res['size']


def test_delete_emits_file_changed_with_the_trash_destination(ws):
    manager, store, project = ws
    res = manager.delete_file('demo', 'src/a.py')
    changes = _changes(store)
    assert changes and changes[0]['change'] == 'deleted'
    assert changes[0]['path'] == 'src/a.py'
    assert changes[0]['trash'] == res['trash']
    assert (project / res['trash']).exists() and not (project / 'src' / 'a.py').exists()


def test_upload_emits_file_changed_with_project_empty(ws):
    import base64
    manager, store, project = ws
    manager.upload('shot.png', base64.b64encode(b'\x89PNG').decode())
    changes = [c for c in _changes(store) if c['change'] == 'uploaded']
    assert len(changes) == 1
    assert changes[0]['project'] == ''
    assert changes[0]['path'].startswith(str(manager.allowed_root / 'hermes-uploads') + '/')


def test_move_file_updates_events_and_state(ws):
    manager, store, project = ws
    manager.make_dir('demo', 'src/sub')
    res = manager.move_entry('demo', 'src/a.py', 'src/sub/a.py')
    assert res == {'moved': 'src/a.py', 'to': 'src/sub/a.py'}
    assert (project / 'src' / 'sub' / 'a.py').is_file()
    assert not (project / 'src' / 'a.py').exists()
    c = [c for c in _changes(store) if c['change'] == 'moved'][-1]
    assert c['source'] == 'src/a.py' and c['path'] == 'src/sub/a.py'


def test_move_directory_moves_the_whole_subtree(ws):
    manager, store, project = ws
    (project / 'src' / 'sub').mkdir()
    (project / 'src' / 'sub' / 'x.txt').write_text('x\n')
    res = manager.move_entry('demo', 'src/sub', 'src/sub2')
    assert res == {'moved': 'src/sub', 'to': 'src/sub2'}
    assert (project / 'src' / 'sub2' / 'x.txt').is_file()
    assert not (project / 'src' / 'sub').exists()


def test_move_refuses_overwrite_missing_source_same_path_escape(ws):
    manager, store, project = ws
    (project / 'src' / 'c.py').write_text('c\n')
    with pytest.raises(WorkspaceError):  # overwrite
        manager.move_entry('demo', 'src/a.py', 'src/c.py')
    with pytest.raises(WorkspaceError):  # missing source
        manager.move_entry('demo', 'src/missing.py', 'src/x.py')
    with pytest.raises(WorkspaceError):  # same path
        manager.move_entry('demo', 'src/a.py', 'src/a.py')
    with pytest.raises(WorkspaceError):  # escape
        manager.move_entry('demo', 'src/a.py', '../escape.py')
    assert (project / 'escape.py').exists() is False
    assert not [c for c in _changes(store) if c['change'] == 'moved']


def test_move_refuses_a_missing_target_parent(ws):
    manager, store, project = ws
    with pytest.raises(WorkspaceError):
        manager.move_entry('demo', 'src/a.py', 'nope/deep/a.py')


def test_make_dir_creates_and_refuses_existing_denylisted(ws):
    manager, store, project = ws
    assert manager.make_dir('demo', 'src/newdir') == {'created': 'src/newdir'}
    assert (project / 'src' / 'newdir').is_dir()
    with pytest.raises(WorkspaceError):
        manager.make_dir('demo', 'src/newdir')  # already exists
    with pytest.raises(WorkspaceError):  # denylisted directory NAME
        manager.make_dir('demo', 'node_modules')
    with pytest.raises(WorkspaceError):  # escape
        manager.make_dir('demo', '../outside')


def test_event_failure_never_fails_the_operation(ws, monkeypatch):
    manager, store, project = ws
    def boom(kind, payload, task_id=None, **links):
        raise RuntimeError('event sink down')
    monkeypatch.setattr(store, 'emit', boom)
    res = manager.write_file('demo', 'src/ok.py', 'fine\n')
    assert res['created'] is True
    assert (project / 'src' / 'ok.py').read_text() == 'fine\n'
