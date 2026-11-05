"""Apply-to-host refuses with an explainable blocker, never a bare refusal.

The apply target is a *registered host project* with a recorded base commit. A VM
source project (/home/hermes/projects/<name>) usually has no host repository at all,
so preview must name the blocker (project_not_registered / project_unsynced) in the
same shape it already uses for host_commit_changed / host_working_tree_dirty.
"""
import json
import os
import sqlite3
import subprocess
import threading
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from hermes_life.implementation import ImplementationEngine
from hermes_life.project_workspaces import ProjectWorkspaces

SNAPSHOT = {'snapshot_sha256': 'abc', 'changed_files': 1,
            'files': [{'path': 'main.py', 'change': 'modified'}],
            'diff': '--- old\n+++ new', 'truncated': False}


class Store:
    def __init__(self):
        self.connection = sqlite3.connect(':memory:', check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.events = []
        self.connection.executescript('''
          CREATE TABLE implementation_runs(id TEXT PRIMARY KEY, plan_id TEXT, project TEXT,
              state TEXT, candidate_path TEXT, baseline_path TEXT, baseline_json TEXT,
              candidate_json TEXT, response TEXT, error TEXT, created_at TEXT, updated_at TEXT);
          CREATE TABLE implementation_reviews(run_id TEXT PRIMARY KEY, decision TEXT,
              evidence_sha256 TEXT, criteria_json TEXT, feedback TEXT, decided_at TEXT);
          CREATE TABLE hl_projects(name TEXT PRIMARY KEY, host_path TEXT, spec_path TEXT,
              vm_path TEXT, commit_hash TEXT, synced_at TEXT);
          CREATE TABLE investigation_plans(id TEXT PRIMARY KEY, formulation_id TEXT,
              task_id TEXT, report TEXT, state TEXT, created_at TEXT, approved_at TEXT);
        ''')
        self.connection.execute(
            "INSERT INTO implementation_runs(id,plan_id,project,state,candidate_path,baseline_path)"
            " VALUES ('run','plan','scratch','candidate_passed','/vm/candidate','/vm/baseline')")
        self.connection.execute(
            "INSERT INTO implementation_reviews VALUES ('run','accepted','abc','[true]','ok','now')")
        self.connection.commit()

    def emit(self, *args):
        self.events.append(args)


def engine_for(store, allowed_root, project=None):
    adapter = SimpleNamespace(transport='ssh', _ssh_base=lambda: ['ssh', 'fake-vm'])
    manager = SimpleNamespace(allowed_root=allowed_root, _git=ProjectWorkspaces._git)
    runtime = SimpleNamespace(store=store, adapter=adapter,
                              project_workspaces=manager, active=threading.Lock())
    engine = ImplementationEngine(runtime, None)
    if project is not None:
        with store.lock:
            store.connection.execute(
                'INSERT INTO hl_projects(name,host_path,spec_path,vm_path,commit_hash,synced_at)'
                ' VALUES (?,?,?,?,?,?)',
                (project['name'], project['host_path'], None, project.get('vm_path'),
                 project.get('commit_hash'), project.get('synced_at')))
            store.connection.commit()
    return engine


def _guest_fixture():
    """Fake only the VM guest call. `implementation.subprocess` is the shared stdlib
    module, so patching `run` outright would also break the git calls the engine makes
    through ProjectWorkspaces; git commands are delegated to the real runner."""
    real_run = subprocess.run

    def fake(command, *args, **kwargs):
        if command and command[0] == 'git':
            return real_run(command, *args, **kwargs)
        return SimpleNamespace(returncode=0, stdout=json.dumps(SNAPSHOT), stderr='')

    return patch('hermes_life.implementation.subprocess.run', side_effect=fake)


def _git_repo(path):
    env = {**os.environ, 'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@example.com',
           'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@example.com'}

    def git(*args):
        subprocess.run(['git', *args], cwd=path, check=True, capture_output=True, env=env,
                       text=True)
    path.mkdir(parents=True, exist_ok=True)
    (path / 'main.py').write_text('print("hello")\n')
    git('init')
    git('add', '-A')
    git('commit', '-m', 'base')
    return subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=path, check=True,
                          capture_output=True, text=True, env=env).stdout.strip()


def test_preview_names_an_unregistered_project(tmp_path):
    store = Store()
    engine = engine_for(store, tmp_path)
    with _guest_fixture():
        preview = engine.apply_preview('run')
    assert preview['can_apply'] is False
    assert preview['blockers'] == ['project_not_registered']
    assert preview['project_registered'] is False
    # The reviewed diff is still returned: the reviewer can see what was built.
    assert preview['diff'] == SNAPSHOT['diff']
    assert ('implementation.apply_blocked',
            {'run_id': 'run', 'project': 'scratch', 'blocker': 'project_not_registered'}) in store.events


def test_preview_names_an_unsynced_project(tmp_path):
    store = Store()
    engine = engine_for(store, tmp_path, {'name': 'scratch', 'host_path': str(tmp_path),
                                          'commit_hash': None})
    with _guest_fixture():
        preview = engine.apply_preview('run')
    assert preview['blockers'] == ['project_unsynced']
    assert preview['project_registered'] is True
    assert preview['project_synced'] is False


def test_preview_offers_apply_for_a_registered_clean_project(tmp_path):
    repo = tmp_path / 'host'
    head = _git_repo(repo)
    store = Store()
    engine = engine_for(store, tmp_path, {'name': 'scratch', 'host_path': str(repo),
                                          'commit_hash': head})
    with _guest_fixture():
        preview = engine.apply_preview('run')
    assert preview['blockers'] == []
    assert preview['can_apply'] is True
    assert preview['host_clean'] is True
    assert preview['base_commit'] == head


def test_apply_refuses_with_the_spec_category(tmp_path):
    store = Store()
    engine = engine_for(store, tmp_path)
    with _guest_fixture(), pytest.raises(ValueError, match='project_not_registered'):
        engine.apply_to_host('run', 'APPLY scratch')
