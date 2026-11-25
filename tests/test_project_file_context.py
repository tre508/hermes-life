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


def test_context_and_changes_work_without_sync(tmp_path, monkeypatch):
    # SSHFS architecture: remote_path is never set, yet @project tasks must
    # still work — context() points at the live host repository and changes()
    # reviews it locally instead of failing at the sync gate.
    client, root = _client(tmp_path, monkeypatch)
    ws = client.app.state.runtime.project_workspaces
    project = ws._read('alpha')
    assert project['remote_path'] is None

    ctx = ws.context('alpha')
    assert str(root) in ctx
    assert '(live host repository)' in ctx
    assert 'Base commit: live host HEAD' in ctx
    assert 'not synchronized' not in ctx.lower()

    result = ws.changes('alpha')
    assert result['workspace'].startswith(str(root))
    assert '(live host repository)' in result['workspace']
    assert '---GIT-STATUS---' in result['output']
    assert '---END-DIFF---' in result['output']


def test_context_read_only_authority_text(tmp_path, monkeypatch):
    client, root = _client(tmp_path, monkeypatch)
    ws = client.app.state.runtime.project_workspaces
    ctx = ws.context('alpha', read_only=True)
    assert 'READ-ONLY' in ctx
    assert 'Work inside this workspace' not in ctx


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


def test_tree_reports_host_version(tmp_path, monkeypatch):
    client, root = _client(tmp_path, monkeypatch)
    r = client.get('/api/projects/alpha/tree')
    assert r.status_code == 200, r.text
    ver = r.json()['host_version']
    assert isinstance(ver, dict)
    commit = ver['commit']
    assert commit and len(commit) <= 40
    assert ver['dirty'] is False  # clean test repo
    # A new untracked file makes the host working tree dirty.
    (root / 'untracked.txt').write_text('x\n')
    r2 = client.get('/api/projects/alpha/tree')
    ver2 = r2.json()['host_version']
    assert ver2['dirty'] is True
    assert ver2['commit'] == commit
    (root / 'untracked.txt').unlink()
    # Git repo with no commits: rev-parse HEAD fails -> host_version must be None, not an error.
    empty = tmp_path / 'emptyrepo'
    empty.mkdir()
    subprocess.run(['git', 'init'], cwd=empty, check=True, capture_output=True)
    c2 = TestClient(create_app(tmp_path / 'life.db', FakeAdapter()))
    c2.post('/api/projects', json={'name': 'emptyrepo', 'host_path': str(empty)})
    r3 = c2.get('/api/projects/emptyrepo/tree')
    assert r3.status_code == 200, r3.text
    assert r3.json()['host_version'] is None


def test_file_response_carries_host_version(tmp_path, monkeypatch):
    client, root = _client(tmp_path, monkeypatch)
    r = client.get('/api/projects/alpha/file', params={'path': 'src/main.py'})
    assert r.status_code == 200, r.text
    ver = r.json()['host_version']
    assert isinstance(ver, dict) and ver['commit'] and ver['dirty'] is False


def test_endpoints_409_for_unknown_project(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_PROJECT_ROOT', str(tmp_path))
    client = TestClient(create_app(tmp_path / 'life.db', FakeAdapter()))
    assert client.get('/api/projects/ghost/tree').status_code == 409
    assert client.get('/api/projects/ghost/file', params={'path': 'x'}).status_code == 409


# --- UI-driven registration candidates and the write path ---------------------

def test_roots_lists_git_repos_under_the_allowed_root(tmp_path, monkeypatch):
    client, root = _client(tmp_path, monkeypatch)
    other = _git_repo(tmp_path, name='beta')
    plain = tmp_path / 'notarepo'
    plain.mkdir()
    (plain / 'x.txt').write_text('x\n')
    r = client.get('/api/projects/roots')
    assert r.status_code == 200, r.text
    data = r.json()
    assert data['allowed_root'] == str(tmp_path)
    by_name = {item['name']: item for item in data['roots']}
    assert by_name['alpha']['registered'] is True
    assert by_name['alpha']['path'] == str(root)
    assert by_name['beta']['registered'] is False
    assert by_name['beta']['path'] == str(other)
    assert 'notarepo' not in by_name, 'only Git repositories are offered'


def test_write_creates_and_overwrites(tmp_path, monkeypatch):
    client, root = _client(tmp_path, monkeypatch)
    # The write endpoint refuses to invent directories (a typo must not create one),
    # so creation happens in the project root.
    r = client.put('/api/projects/alpha/file',
                   json={'path': 'notes.md', 'content': '# notes\n'})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body['created'] is True
    assert (root / 'notes.md').read_text() == '# notes\n'

    # Read it back through the normal endpoint.
    got = client.get('/api/projects/alpha/file', params={'path': 'notes.md'})
    assert got.status_code == 200 and got.json()['content'] == '# notes\n'

    # Overwrite with the mtime the write returned: succeeds, reports created=False.
    r2 = client.put('/api/projects/alpha/file',
                    json={'path': 'notes.md', 'content': '# notes v2\n',
                          'expected_mtime': body['mtime']})
    assert r2.status_code == 200, r2.text
    assert r2.json()['created'] is False
    assert (root / 'notes.md').read_text() == '# notes v2\n'


def test_write_refuses_a_stale_save(tmp_path, monkeypatch):
    client, root = _client(tmp_path, monkeypatch)
    first = client.put('/api/projects/alpha/file',
                       json={'path': 'a.txt', 'content': 'one\n'})
    assert first.status_code == 200
    mtime = first.json()['mtime']
    # Simulate the file moving on underneath the editor.
    (root / 'a.txt').write_text('changed externally\n')
    import os as _os
    _os.utime(root / 'a.txt', (mtime + 500, mtime + 500))
    stale = client.put('/api/projects/alpha/file',
                       json={'path': 'a.txt', 'content': 'two\n', 'expected_mtime': mtime})
    assert stale.status_code == 409
    assert 'changed on disk' in stale.json()['detail']
    assert (root / 'a.txt').read_text() == 'changed externally\n', 'a stale save must not land'


def test_write_enforces_the_same_containment_and_denylist(tmp_path, monkeypatch):
    client, root = _client(tmp_path, monkeypatch)
    for bad_path in ('../escaped.txt', '/etc/passwd', '.env', 'node_modules/x.js',
                     'sub/.env', 'no-such-dir/new.txt'):
        r = client.put('/api/projects/alpha/file', json={'path': bad_path, 'content': 'x'})
        assert r.status_code == 409, bad_path
    assert not (root / 'escaped.txt').exists()


def test_write_refuses_a_binary_target(tmp_path, monkeypatch):
    client, root = _client(tmp_path, monkeypatch)
    (root / 'logo.png').write_bytes(b'\x89PNG\r\n\x1a\n\x00\x01')
    r = client.put('/api/projects/alpha/file', json={'path': 'logo.png', 'content': 'text'})
    assert r.status_code == 409
    assert 'Binary' in r.json()['detail']
    assert (root / 'logo.png').read_bytes().startswith(b'\x89PNG'), 'binary content untouched'


def test_a_ui_edit_is_visible_to_the_review_flow(tmp_path, monkeypatch):
    # Provisional-by-design: the edit lands uncommitted in the host working tree,
    # exactly like the agent's edits, so `changes()` (Review changes) shows it.
    client, root = _client(tmp_path, monkeypatch)
    r = client.put('/api/projects/alpha/file',
                   json={'path': 'src/main.py', 'content': 'print("edited")\n'})
    assert r.status_code == 200, r.text
    result = client.get('/api/projects/alpha/changes').json()
    assert 'src/main.py' in result['output']
