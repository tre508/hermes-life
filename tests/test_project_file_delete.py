"""Project file soft-delete (move to .trash) and binary upload contract.

User decisions, 2026-11-25: DELETE never unlinks — the file MOVES into
<project>/.trash/ under its original relative path; and FileWrite accepts a
base64 binary channel (chat image attach) alongside the UTF-8 text channel.
"""
from __future__ import annotations

import base64

from fastapi.testclient import TestClient

from hermes_life.app import create_app


class FakeAdapter:
    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        return {'result': 'ok', 'session_id': 'fake-session'}

    def cancel(self, task_id):
        return True


def _client(tmp_path, monkeypatch, files=('src/main.py',)):
    monkeypatch.setenv('HERMES_LIFE_PROJECT_ROOT', str(tmp_path))
    root = tmp_path / 'alpha'
    root.mkdir()
    for rel in files:
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text('print("hi")\n')
    client = TestClient(create_app(tmp_path / 'life.db', FakeAdapter()))
    r = client.post('/api/projects', json={'name': 'alpha', 'host_path': str(root)})
    assert r.status_code == 201, r.text
    return client, root


def test_delete_moves_the_file_into_trash_under_its_relative_path(tmp_path, monkeypatch):
    client, root = _client(tmp_path, monkeypatch)
    r = client.delete('/api/projects/alpha/file', params={'path': 'src/main.py'})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body['deleted'] == 'src/main.py'
    assert body['trash'].startswith('.trash/src/main.py')
    assert not (root / 'src' / 'main.py').exists()
    assert (root / body['trash']).read_text() == 'print("hi")\n'
    # The tree no longer lists the file — and never lists the trash dir itself.
    tree = client.get('/api/projects/alpha/tree').json()
    paths = [e['path'] for e in tree['entries']]
    assert 'src/main.py' not in paths
    assert not any(p.startswith('.trash') for p in paths)


def test_delete_never_overwrites_an_existing_trash_entry(tmp_path, monkeypatch):
    client, root = _client(tmp_path, monkeypatch)
    first = client.delete('/api/projects/alpha/file', params={'path': 'src/main.py'})
    assert first.status_code == 200
    (root / 'src').mkdir(exist_ok=True)
    (root / 'src' / 'main.py').write_text('print("v2")\n')
    second = client.delete('/api/projects/alpha/file', params={'path': 'src/main.py'})
    assert second.status_code == 200
    assert second.json()['trash'] != first.json()['trash']


def test_delete_refuses_escaping_and_missing_paths(tmp_path, monkeypatch):
    client, root = _client(tmp_path, monkeypatch)
    assert client.delete('/api/projects/alpha/file', params={'path': '../escape'}).status_code in (400, 404, 409)
    assert client.delete('/api/projects/alpha/file', params={'path': 'nope.py'}).status_code in (400, 404, 409)
    # The file itself is untouched.
    assert (root / 'src' / 'main.py').exists()


def test_binary_upload_writes_exact_bytes(tmp_path, monkeypatch):
    client, root = _client(tmp_path, monkeypatch)
    payload = bytes(range(256)) * 4
    r = client.put('/api/projects/alpha/file', json={
        'path': 'assets/dot.bin', 'content_base64': base64.b64encode(payload).decode()})
    assert r.status_code == 200, r.text
    assert (root / 'assets' / 'dot.bin').read_bytes() == payload


def test_text_write_still_refuses_binary_targets(tmp_path, monkeypatch):
    client, root = _client(tmp_path, monkeypatch, files=())
    raw = bytes(range(256))
    (root / 'blob.bin').write_bytes(raw)
    r = client.put('/api/projects/alpha/file', json={'path': 'blob.bin', 'content': 'text'})
    assert r.status_code in (400, 409, 422), 'text channel must still refuse a binary target'
    assert (root / 'blob.bin').read_bytes() == raw
