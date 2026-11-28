"""HA-006: host-apply paths feed the shared file-change events (build spec
ha001-ha047-build-spec.md, Phase 2).

emit_applied_changes() is exercised against a REAL git repository: both apply
paths (project_approvals.apply, implementation.apply_to_host) verify a CLEAN
tree before `git apply`, so every porcelain entry afterwards is the applied
change itself. The two apply call sites are pinned by source contract below —
the full apply flows need the SSH work machine and cannot run hermetically.

Module style follows tests/test_project_file_ops.py: direct ProjectWorkspaces
construction with a minimal fake runtime.
"""
from __future__ import annotations

import sqlite3
import subprocess
import threading

import pytest

from hermes_life.project_workspaces import ProjectWorkspaces


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
def mgr(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_PROJECT_ROOT', str(tmp_path))
    monkeypatch.delenv('HERMES_LIFE_PROJECT_EXTRA_ROOTS', raising=False)
    store = FakeStore()
    manager = ProjectWorkspaces(FakeRuntime(store))
    return manager, store


def _git(args, cwd):
    return subprocess.run(['git', *args], cwd=cwd, text=True,
                          capture_output=True, check=True).stdout


def _repo(tmp_path):
    repo = tmp_path / 'repo'
    repo.mkdir()
    _git(['init', '-q'], repo)
    _git(['config', 'user.email', 'test@test'], repo)
    _git(['config', 'user.name', 'test'], repo)
    (repo / 'mod.txt').write_text('v1\n')
    (repo / 'gone.txt').write_text('x\n')
    _git(['add', '.'], repo)
    _git(['commit', '-qm', 'base'], repo)
    return repo


def test_emit_applied_changes_lists_every_applied_file(mgr, tmp_path):
    manager, store = mgr
    repo = _repo(tmp_path)
    # simulate the result of a git-apply on the once-clean tree
    (repo / 'mod.txt').write_text('v2\n')
    (repo / 'gone.txt').unlink()
    (repo / 'new.txt').write_text('n\n')
    manager.emit_applied_changes('demo', repo)
    got = {(p['change'], p['path']) for k, p in store.events if k == 'file.changed'}
    assert ('written', 'mod.txt') in got
    assert ('deleted', 'gone.txt') in got
    assert ('created', 'new.txt') in got
    # the manual writers' vocabulary — no new change words appear
    assert all(p['change'] in ('written', 'created', 'deleted')
               for k, p in store.events if k == 'file.changed')


def test_emit_applied_changes_never_fails_the_operation(mgr):
    manager, store = mgr
    # not a git repository at all — the helper must swallow, not raise
    manager.emit_applied_changes('demo', '/nonexistent/path')
    assert store.events == []


def test_make_dir_emits_created(mgr, tmp_path):
    manager, store = mgr
    project = tmp_path / 'demo'
    project.mkdir()
    (project / 'keep.txt').write_text('k\n')
    manager.register('demo', str(project))
    manager.make_dir('demo', 'sub')
    assert ('file.changed', {'project': 'demo', 'path': 'sub', 'change': 'created'}) \
        in store.events


def test_apply_call_sites_emit_applied_changes():
    """Source contract: both host-apply paths feed the shared channel."""
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent / 'hermes_life'
    approvals = (root / 'project_approvals.py').read_text()
    impl = (root / 'implementation.py').read_text()
    assert 'emit_applied_changes' in approvals, \
        'project_approvals.apply must emit file.changed after git apply (HA-006)'
    assert 'emit_applied_changes' in impl, \
        'implementation.apply_to_host must emit file.changed after git apply (HA-006)'
