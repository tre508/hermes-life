"""HL-WORK-001 M2: registry API contract the Projects-tab registered section consumes.

Real git repository in tmp_path, real FastAPI app (FakeAdapter, no work-machine SSH).
Verifies the exact endpoints and status codes the frontend renders against:
register -> list -> changes(409 unsynced) -> sync(409 no SSH transport).
"""
from __future__ import annotations

import subprocess

from fastapi.testclient import TestClient

from hermes_life.app import create_app


class FakeAdapter:
    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        return {'result': 'ok', 'session_id': 'fake-session'}

    def cancel(self, task_id):
        return True


def _git_repo(tmp_path, name='alpha'):
    root = tmp_path / name
    root.mkdir()
    (root / 'README.md').write_text('# alpha\n')
    def git(*args):
        subprocess.run(['git', *args], cwd=root, check=True, capture_output=True)
    git('init')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    git('add', '.')
    git('commit', '-m', 'init')
    return root


def test_register_list_changes_sync_contract(tmp_path, monkeypatch):
    root = _git_repo(tmp_path)
    monkeypatch.setenv('HERMES_LIFE_PROJECT_ROOT', str(tmp_path))
    with TestClient(create_app(tmp_path / 'life.db', FakeAdapter())) as client:
        # Register: 201 with the registry row echoed back.
        r = client.post('/api/projects', json={'name': 'alpha', 'host_path': str(root), 'spec_path': 'README.md'})
        assert r.status_code == 201, r.text
        row = r.json()
        assert row['name'] == 'alpha'
        assert row['spec_path'] == 'README.md'

        # GET list: the row the frontend cards render.
        r = client.get('/api/projects')
        assert r.status_code == 200
        projects = r.json()['projects']
        assert [p['name'] for p in projects] == ['alpha']
        assert projects[0]['host_path'] == str(root)
        assert projects[0]['remote_path'] is None or projects[0]['remote_path'] == ''

        # Changes before any sync: a 409 with a message the UI can surface.
        r = client.get('/api/projects/alpha/changes')
        assert r.status_code == 409
        assert 'synchronized' in r.json()['detail'].lower()

        # Sync without an SSH-transport adapter: 409, not a silent success.
        r = client.post('/api/projects/alpha/sync')
        assert r.status_code == 409, r.text

        # Re-registering the same name to the same repo updates, not duplicates.
        r = client.post('/api/projects', json={'name': 'alpha', 'host_path': str(root)})
        assert r.status_code == 201
        assert len(client.get('/api/projects').json()['projects']) == 1


def test_register_rejects_bad_name_and_out_of_root_paths(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_PROJECT_ROOT', str(tmp_path))
    with TestClient(create_app(tmp_path / 'life.db', FakeAdapter())) as client:
        r = client.post('/api/projects', json={'name': 'Bad_Name', 'host_path': str(tmp_path)})
        assert r.status_code == 409
        assert 'Invalid project name' in r.json()['detail']

        r = client.post('/api/projects', json={'name': 'outside', 'host_path': '/etc'})
        assert r.status_code == 409
        assert 'under' in r.json()['detail']
