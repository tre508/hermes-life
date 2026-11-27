"""§5: hosted-filesystem browse for attachment WITHOUT project registration.

The security boundary must be identical to project registration: a path is served
only when it sits inside a configured allowed root, and the same denylist that
protects the project reader protects the browser.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from hermes_life.app import create_app


class FakeAdapter:
    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        return {'result': 'ok', 'session_id': 'fake-session'}

    def cancel(self, task_id):
        return True


def _tree(tmp_path):
    """A host area with attachable content AND things that must never be offered."""
    (tmp_path / 'notes.txt').write_text('hello\n')
    (tmp_path / 'project-a').mkdir()
    (tmp_path / 'project-a' / 'main.py').write_text('print(1)\n')
    (tmp_path / 'node_modules').mkdir()
    (tmp_path / 'node_modules' / 'junk.js').write_text('junk\n')
    (tmp_path / '.git').mkdir()
    (tmp_path / '.env').write_text('SECRET=1\n')
    (tmp_path / 'server.key').write_text('PRIVATE KEY\n')
    # A sibling of the allowed root — reachable only by escaping it.
    outside = tmp_path.parent / ('outside-' + tmp_path.name)
    outside.mkdir()
    (outside / 'secret.txt').write_text('nope\n')
    return outside


def _client(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_PROJECT_ROOT', str(tmp_path))
    monkeypatch.delenv('HERMES_LIFE_PROJECT_EXTRA_ROOTS', raising=False)
    _tree(tmp_path)
    return TestClient(create_app(tmp_path / 'life.db', FakeAdapter()))


def test_browse_lists_a_host_directory_without_registering_a_project(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    r = client.get('/api/fs/list', params={'path': str(tmp_path)})
    assert r.status_code == 200, r.text
    data = r.json()
    by_name = {e['name']: e for e in data['entries']}
    assert 'notes.txt' in by_name
    assert 'project-a' in by_name
    assert data['path'] == str(tmp_path)
    # A directory is offered as a directory, a file as a file.
    assert by_name['project-a']['type'] == 'dir'
    assert by_name['notes.txt']['type'] == 'file'


def test_browse_prunes_the_same_denylist_as_the_reader(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    names = {e['name'] for e in client.get('/api/fs/list', params={'path': str(tmp_path)}).json()['entries']}
    assert 'node_modules' not in names
    assert '.git' not in names
    assert '.env' not in names
    assert 'server.key' not in names


def test_browse_defaults_to_the_primary_root(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    r = client.get('/api/fs/list')
    assert r.status_code == 200, r.text
    data = r.json()
    assert data['path'] == str(tmp_path)
    # At a root there is nowhere higher INSIDE the permitted area to go.
    assert data['parent'] is None


def test_browse_offers_parent_only_inside_the_permitted_roots(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    data = client.get('/api/fs/list', params={'path': str(tmp_path / 'project-a')}).json()
    assert data['parent'] == str(tmp_path)
    # ...and the root itself reports no parent, so the browser cannot climb out.
    assert client.get('/api/fs/list', params={'path': str(tmp_path)}).json()['parent'] is None


def test_browse_refuses_a_path_outside_the_permitted_roots(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    outside = tmp_path.parent / ('outside-' + tmp_path.name)
    r = client.get('/api/fs/list', params={'path': str(outside)})
    assert r.status_code == 409, r.text
    assert 'permitted roots' in r.json()['detail']


def test_browse_refuses_traversal_escape(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    r = client.get('/api/fs/list', params={'path': str(tmp_path / '..' / '..' / 'etc')})
    assert r.status_code == 409, r.text


def test_browse_reports_a_file_path_as_not_a_directory(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    r = client.get('/api/fs/list', params={'path': str(tmp_path / 'notes.txt')})
    assert r.status_code == 409
    assert 'Not a directory' in r.json()['detail']


def test_browse_exposes_the_permitted_roots_for_the_picker(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    data = client.get('/api/fs/list').json()
    assert str(tmp_path) in data['roots']


# --- D6: project-free uploads (policy decision 2026-11-27) -------------------

import base64

def _upload(client, name, payload=b'\x89PNG fake image bytes'):
    return client.put('/api/fs/upload', json={
        'filename': name,
        'content_base64': base64.b64encode(payload).decode('ascii'),
    })


def test_upload_lands_inside_the_permitted_root_without_a_project(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    r = _upload(client, 'shot.png')
    assert r.status_code == 200, r.text
    data = r.json()
    stored = data['path']
    # Absolute, inside the allowed root, under the hermes-uploads area.
    assert stored.startswith(str(tmp_path / 'hermes-uploads' + '/'))
    assert data['name'] == 'shot.png'
    assert data['size'] > 0
    # The stored file is browsable by the same containment-checked picker.
    listing = client.get('/api/fs/list', params={'path': str(tmp_path)}).json()
    assert any(e['name'] == 'hermes-uploads' for e in listing['entries'])


def test_upload_refuses_a_denylisted_filename(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    assert _upload(client, 'server.key').status_code == 409
    assert _upload(client, '.env').status_code == 409
    assert not (tmp_path / 'server.key').exists()


def test_upload_refuses_path_tricks_and_oversized_payloads(tmp_path, monkeypatch):
    from hermes_life.project_workspaces import MAX_WRITE_BYTES
    client = _client(tmp_path, monkeypatch)
    assert _upload(client, '../escape.png').status_code == 409
    assert _upload(client, 'sub/dir/escape.png').status_code == 409
    big = base64.b64encode(b'x' * (MAX_WRITE_BYTES + 1)).decode('ascii')
    r = client.put('/api/fs/upload', json={'filename': 'big.png', 'content_base64': big})
    assert r.status_code == 409
    assert not (tmp_path / 'escape.png').exists()


def test_upload_duplicate_names_are_disambiguated_not_overwritten(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    first = _upload(client, 'dup.png').json()
    second = _upload(client, 'dup.png').json()
    assert first['path'] != second['path']
    assert second['name'] == 'dup-2.png'
