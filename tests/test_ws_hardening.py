"""HA-025/HA-026/HA-027 hardening for the project workspaces backend.

HA-025: hot read paths (file/tree) must not run a git subprocess storm per
request — the per-root git-fact cache is asserted by COUNTING subprocess.run
invocations and by observable host_version facts after changes.
HA-026: projects registered under HERMES_LIFE_PROJECT_EXTRA_ROOTS must keep
working after registration — the containment re-checks accept any configured
root, and a path outside every root is still refused.
HA-027: base64 write payloads must be refused BEFORE decoding when their
encoded length provably exceeds MAX_WRITE_BYTES — a decode bomb must never be
buffered — while the post-decode size belt stays in place.

Module style follows tests/test_project_file_ops.py: direct ProjectWorkspaces
construction with a minimal fake runtime — the same cache/containment code
paths run either way.
"""
from __future__ import annotations

import base64
import os
import sqlite3
import subprocess
import threading
import types

import pytest

from hermes_life.project_workspaces import (MAX_WRITE_BYTES, ProjectWorkspaces,
                                            WorkspaceError)


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


class DecodeBomb(BaseException):
    """Not an Exception: the writers' `except Exception` must not swallow it,
    so a decode that runs at all fails the test with a readable message."""


def _manager(tmp_path, monkeypatch, extra=None):
    apps = tmp_path / 'apps'
    apps.mkdir(exist_ok=True)
    monkeypatch.setenv('HERMES_LIFE_PROJECT_ROOT', str(apps))
    if extra:
        monkeypatch.setenv('HERMES_LIFE_PROJECT_EXTRA_ROOTS', str(extra))
    else:
        monkeypatch.delenv('HERMES_LIFE_PROJECT_EXTRA_ROOTS', raising=False)
    return ProjectWorkspaces(FakeRuntime(FakeStore()))


def _project_dir(root):
    (root / 'src').mkdir(parents=True)
    (root / 'src' / 'a.py').write_text('print(1)\n')
    return root


def _git(args, cwd):
    return subprocess.run(['git', *args], cwd=cwd, text=True,
                          capture_output=True, check=True).stdout


def _git_repo(root):
    """A committed, clean repository so host_version has real facts to report."""
    root.mkdir(parents=True)
    _git(['init', '-q'], root)
    _git(['config', 'user.email', 'test@test'], root)
    _git(['config', 'user.name', 'test'], root)
    _project_dir(root)
    _git(['add', '.'], root)
    _git(['commit', '-qm', 'base'], root)
    return root


@pytest.fixture()
def ws(tmp_path, monkeypatch):
    manager = _manager(tmp_path, monkeypatch)
    project = _git_repo(tmp_path / 'apps' / 'demo')
    manager.register('demo', str(project))
    return manager, manager.runtime.store, project


@pytest.fixture()
def ws_extra(tmp_path, monkeypatch):
    """A project registered under HERMES_LIFE_PROJECT_EXTRA_ROOTS (HA-026)."""
    extra = tmp_path / 'elsewhere'
    manager = _manager(tmp_path, monkeypatch, extra=extra)
    project = _git_repo(extra / 'outer')
    manager.register('outer', str(project))
    return manager, manager.runtime.store, project


def _count_runs(monkeypatch):
    """Count every subprocess.run invocation while leaving behavior unchanged."""
    calls: list = []
    real_run = subprocess.run

    def counting_run(cmd, *args, **kwargs):
        calls.append(cmd)
        return real_run(cmd, *args, **kwargs)

    monkeypatch.setattr(subprocess, 'run', counting_run)
    return calls


# --- HA-025: git subprocess storms on hot read paths -------------------------

def test_hot_reads_reuse_cached_git_state_instead_of_subprocess_storms(ws, monkeypatch):
    manager, store, project = ws
    calls = _count_runs(monkeypatch)
    first = manager.file('demo', 'src/a.py')['host_version']
    assert first and first['commit']  # populated from real git facts
    storm = len(calls)
    assert storm  # the cache miss ran git exactly once...
    manager.file('demo', 'src/a.py')
    manager.file('demo', 'src/a.py')
    assert len(calls) == storm  # ...repeat reads run zero new git subprocesses
    manager.tree('demo')
    assert len(calls) == storm  # tree() shares the same cached entry


def test_manager_writes_invalidate_the_git_cache(ws, monkeypatch):
    manager, store, project = ws
    before = manager.file('demo', 'src/a.py')['host_version']
    assert before and before['dirty'] is False
    manager.write_file('demo', 'src/new.py', 'x=1\n')
    after = manager.file('demo', 'src/a.py')['host_version']
    assert after['dirty'] is True  # never the stale 'clean' from the cache


def test_worktree_change_invalidates_the_cache_before_the_ttl(ws, monkeypatch):
    manager, store, project = ws
    calls = _count_runs(monkeypatch)
    assert manager.file('demo', 'src/a.py')['host_version']['dirty'] is False
    assert len(calls) == 4  # rev-parse + status + branch + scm status
    (project / 'top.txt').write_text('changed outside the manager\n')
    # The cheap stamp key: root dir mtime must move the cache on its own.
    future = project.stat().st_mtime + 30
    os.utime(project, (future, future))
    calls.clear()
    assert manager.file('demo', 'src/a.py')['host_version']['dirty'] is True
    assert len(calls) == 4  # recomputed via the key, not after the TTL


def test_git_cache_expires_after_the_ttl(ws, monkeypatch):
    manager, store, project = ws
    calls = _count_runs(monkeypatch)
    clock = [1_000.0]
    monkeypatch.setattr('hermes_life.project_workspaces.time',
                        types.SimpleNamespace(monotonic=lambda: clock[0]))
    manager.file('demo', 'src/a.py')
    storm = len(calls)
    assert storm
    manager.file('demo', 'src/a.py')
    assert len(calls) == storm  # within GIT_CACHE_TTL: served from the cache
    clock[0] += 60  # past GIT_CACHE_TTL, stamps unchanged
    manager.file('demo', 'src/a.py')
    assert len(calls) > storm  # expired: git is re-run even with a stable key


# --- HA-026: extra-roots projects survive registration -----------------------

def test_extra_root_project_reads_writes_and_lists(ws_extra):
    """HA-026 acceptance: read, write and list must all work after
    registration under HERMES_LIFE_PROJECT_EXTRA_ROOTS."""
    manager, store, project = ws_extra
    got = manager.file('outer', 'src/a.py')
    assert got['content'] == 'print(1)\n'
    res = manager.write_file('outer', 'src/b.py', 'x=1\n')
    assert res['created'] is True
    assert (project / 'src' / 'b.py').read_text() == 'x=1\n'
    tree = manager.tree('outer')
    assert {e['path'] for e in tree['entries']} >= {'src/a.py', 'src/b.py'}
    assert [p['name'] for p in manager.list()] == ['outer']


def test_extra_root_project_passes_the_sync_validation(ws_extra):
    """sync() re-validates containment first; a dirty tree is the refusal
    AFTER it. 'Registered path no longer valid' is the HA-026 regression."""
    manager, store, project = ws_extra
    (project / 'dirty.txt').write_text('uncommitted\n')
    with pytest.raises(WorkspaceError, match='uncommitted or untracked'):
        manager.sync('outer')


def test_extra_root_project_changes_sees_local_git_state(ws_extra):
    manager, store, project = ws_extra
    (project / 'dirty.txt').write_text('uncommitted\n')
    out = manager.changes('outer')
    assert out['project'] == 'outer'
    assert '---GIT-STATUS---' in out['output'] and 'dirty.txt' in out['output']


def test_containment_still_refuses_paths_outside_every_root(tmp_path, monkeypatch):
    """The wider predicate must track the CONFIGURED roots — when the extra
    root is no longer configured, the project is refused, not served."""
    extra = tmp_path / 'elsewhere'
    manager = _manager(tmp_path, monkeypatch, extra=extra)
    project = _project_dir(extra / 'outer')
    manager.register('outer', str(project))
    monkeypatch.delenv('HERMES_LIFE_PROJECT_EXTRA_ROOTS', raising=False)
    strict = ProjectWorkspaces(FakeRuntime(manager.runtime.store))
    with pytest.raises(WorkspaceError, match='no longer valid'):
        strict._root('outer')
    with pytest.raises(WorkspaceError, match='no longer valid'):
        strict.file('outer', 'src/a.py')


# --- HA-027: oversized base64 payloads ---------------------------------------

def test_oversized_payloads_are_refused_before_base64_decoding(ws, monkeypatch):
    manager, store, project = ws

    def bomb(*args, **kwargs):
        raise DecodeBomb('oversized payload was decoded — the size check runs too late')

    monkeypatch.setattr(base64, 'b64decode', bomb)
    huge = 'A' * (MAX_WRITE_BYTES * 2)  # valid base64; would decode to 1.5 MB
    with pytest.raises(WorkspaceError, match='File too large to write'):
        manager.write_file('demo', 'big.bin', '', content_base64=huge)
    with pytest.raises(WorkspaceError, match='File too large to write'):
        manager.upload('big.png', huge)
    assert not (project / 'big.bin').exists()


def test_the_post_decode_size_belt_still_holds(ws):
    manager, store, project = ws
    # Encoded length passes the pre-decode gate; decoded length must still be
    # refused by the belt check.
    just_over = base64.b64encode(b'x' * (MAX_WRITE_BYTES + 1)).decode('ascii')
    with pytest.raises(WorkspaceError, match='File too large to write'):
        manager.write_file('demo', 'big.bin', '', content_base64=just_over)
    with pytest.raises(WorkspaceError, match='File too large to write'):
        manager.upload('big.png', just_over)
    assert not (project / 'big.bin').exists()


def test_base64_writes_at_the_limit_still_land(ws):
    manager, store, project = ws
    payload = base64.b64encode(b'x' * MAX_WRITE_BYTES).decode('ascii')
    res = manager.write_file('demo', 'blob.bin', '', content_base64=payload)
    assert res['size'] == MAX_WRITE_BYTES
    assert (project / 'blob.bin').stat().st_size == MAX_WRITE_BYTES
