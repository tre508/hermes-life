"""HL-CHAT-006: file-context manager endpoints (tree + file) contract.

Real git repository in tmp_path with junk/secret files that must be denied.
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
    (root / 'src').mkdir()
    (root / 'src' / 'main.py').write_text('print("hi")\n')
    (root / 'node_modules').mkdir()
    (root / 'node_modules' / 'junk.js').write_text('junk\n')
    (root / '.env').write_text('SECRET=1\n')
    (root / 'server.key').write_text('PRIVATE KEY\n')
    def git(*args):
        subprocess.run(['git', *args], cwd=root, check=True, capture_output=True)
    git('init')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    git('add', '.')
    git('commit', '-m', 'init')
    return root


def _client(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_PROJECT_ROOT', str(tmp_path))
    root = _git_repo(tmp_path)
    client = TestClient(create_app(tmp_path / 'life.db', FakeAdapter()))
    r = client.post('/api/projects', json={'name': 'alpha', 'host_path': str(root)})
    assert r.status_code == 201, r.text
    return client, root


def test_tree_lists_files_and_prunes_denylist(tmp_path, monkeypatch):
    client, root = _client(tmp_path, monkeypatch)
    r = client.get('/api/projects/alpha/tree')
    assert r.status_code == 200, r.text
    data = r.json()
    paths = [e['path'] for e in data['entries']]
    assert 'README.md' in paths
    assert 'src/main.py' in paths
    assert not any('node_modules' in p for p in paths)
    assert not any(p.startswith('.env') for p in paths)
    assert not any('server.key' in p for p in paths)
    assert data['root'] == str(root)
    assert data['count'] == len(data['entries'])


def test_file_reads_content_and_blocks_denylist_and_escape(tmp_path, monkeypatch):
    client, root = _client(tmp_path, monkeypatch)
    r = client.get('/api/projects/alpha/file', params={'path': 'src/main.py'})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body['path'] == 'src/main.py'
    assert body['content'] == 'print("hi")\n'
    assert body['truncated'] is False

    # Denylisted file: 409, never returns contents.
    r = client.get('/api/projects/alpha/file', params={'path': '.env'})
    assert r.status_code == 409
    assert 'denylisted' in r.json()['detail']

    r = client.get('/api/projects/alpha/file', params={'path': 'server.key'})
    assert r.status_code == 409

    # Path traversal and absolute paths: 409.
    for bad in ('../life.db', '/etc/passwd', 'src/../../x'):
        r = client.get('/api/projects/alpha/file', params={'path': bad})
        assert r.status_code == 409, bad

    # Missing file: 409.
    r = client.get('/api/projects/alpha/file', params={'path': 'nope.txt'})
    assert r.status_code == 409


def test_endpoints_409_for_unknown_project(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_PROJECT_ROOT', str(tmp_path))
    client = TestClient(create_app(tmp_path / 'life.db', FakeAdapter()))
    assert client.get('/api/projects/ghost/tree').status_code == 409
    assert client.get('/api/projects/ghost/file', params={'path': 'x'}).status_code == 409
