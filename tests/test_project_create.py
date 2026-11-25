"""Project creation and multi-root registration.

A chat should be able to start a brand-new project from a name (directory +
git init + README seed) and register directories that live outside the default
project folder — bounded by explicitly configured extra roots, never by a UI
click.
"""
import sqlite3
import subprocess
import threading
from types import SimpleNamespace

import pytest

from hermes_life.project_workspaces import ProjectWorkspaces, WorkspaceError


class Store:
    def __init__(self):
        self.connection = sqlite3.connect(':memory:', check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.lock = threading.RLock()


def manager_for(tmp_path, monkeypatch, extra=''):
    root = tmp_path / 'apps'
    root.mkdir(exist_ok=True)
    monkeypatch.setenv('HERMES_LIFE_PROJECT_ROOT', str(root))
    monkeypatch.setenv('HERMES_LIFE_PROJECT_EXTRA_ROOTS', extra)
    return ProjectWorkspaces(SimpleNamespace(store=Store()))


def _git_repo(path):
    path.mkdir(parents=True)
    subprocess.run(['git', 'init', '-q'], cwd=path, check=True, capture_output=True)
    return path


def test_create_default_is_a_plain_folder_no_git(tmp_path, monkeypatch):
    manager = manager_for(tmp_path, monkeypatch)
    created = manager.create('plain-one')
    root = tmp_path / 'apps' / 'plain-one'
    assert created['host_path'] == str(root)
    assert (root / 'README.md').is_file()
    assert not (root / '.git').exists(), 'plain folder must not get a git repo'


def test_create_with_git_initializes_a_repository(tmp_path, monkeypatch):
    manager = manager_for(tmp_path, monkeypatch)
    created = manager.create('git-one', git=True)
    root = tmp_path / 'apps' / 'git-one'
    assert (root / '.git').is_dir()
    assert (root / 'README.md').is_file()


def test_create_makes_directory_git_repo_readme_and_registers(tmp_path, monkeypatch):
    manager = manager_for(tmp_path, monkeypatch)
    created = manager.create('fresh-one', git=True)
    assert created['host_path'] == str(tmp_path / 'apps' / 'fresh-one')
    assert (tmp_path / 'apps' / 'fresh-one' / '.git').is_dir()
    assert (tmp_path / 'apps' / 'fresh-one' / 'README.md').is_file()
    assert [p['name'] for p in manager.list()] == ['fresh-one']


def test_register_accepts_a_plain_directory_without_git(tmp_path, monkeypatch):
    plain = tmp_path / 'apps' / 'no-git-here'
    plain.mkdir(parents=True)
    (plain / 'file.txt').write_text('hello')
    manager = manager_for(tmp_path, monkeypatch)
    registered = manager.register('no-git-here', str(plain))
    assert registered['host_path'] == str(plain)


def test_sync_refuses_a_plain_directory_with_an_honest_message(tmp_path, monkeypatch):
    plain = tmp_path / 'apps' / 'plain-sync'
    plain.mkdir(parents=True)
    manager = manager_for(tmp_path, monkeypatch)
    manager.register('plain-sync', str(plain))
    with pytest.raises(WorkspaceError, match='No git repository'):
        manager.sync('plain-sync')


def test_create_refuses_an_existing_non_empty_directory(tmp_path, monkeypatch):
    manager = manager_for(tmp_path, monkeypatch)
    occupied = tmp_path / 'apps' / 'taken'
    occupied.mkdir()
    (occupied / 'data.txt').write_text('x')
    with pytest.raises(WorkspaceError, match='not empty'):
        manager.create('taken')


def test_create_rejects_a_bad_slug(tmp_path, monkeypatch):
    manager = manager_for(tmp_path, monkeypatch)
    with pytest.raises(WorkspaceError, match='Invalid project name'):
        manager.create('Bad_Name!')


def test_register_accepts_a_directory_under_an_extra_root(tmp_path, monkeypatch):
    extra = tmp_path / 'elsewhere'
    repo = _git_repo(extra / 'outside-proj')
    manager = manager_for(tmp_path, monkeypatch, extra=str(extra))
    registered = manager.register('outside-proj', str(repo))
    assert registered['host_path'] == str(repo)


def test_register_refuses_a_path_outside_every_allowed_root(tmp_path, monkeypatch):
    stranger = _git_repo(tmp_path / 'stranger' / 'repo')
    manager = manager_for(tmp_path, monkeypatch, extra='')
    with pytest.raises(WorkspaceError, match='allowed root'):
        manager.register('stranger-repo', str(stranger))


def test_roots_lists_candidates_from_every_allowed_root(tmp_path, monkeypatch):
    extra = tmp_path / 'elsewhere'
    _git_repo(tmp_path / 'apps' / 'inner-proj')
    _git_repo(extra / 'outer-proj')
    (extra / 'not-a-repo').mkdir(parents=True)
    manager = manager_for(tmp_path, monkeypatch, extra=str(extra))
    names = {r['name']: r for r in manager.roots()}
    assert 'inner-proj' in names and 'outer-proj' in names
    # Git is optional (VS Code-style): plain directories are listed too, with
    # git=False so the UI can mark sync/review as unavailable.
    assert 'not-a-repo' in names
    assert names['not-a-repo']['git'] is False
    assert names['inner-proj']['git'] is True
    assert not names['inner-proj']['registered'] and not names['outer-proj']['registered']

def _file_manager(tmp_path, monkeypatch):
    manager = manager_for(tmp_path, monkeypatch, extra='')
    manager.register('file-proj', _git_repo(tmp_path / 'apps' / 'file-proj'))
    return manager


def test_file_preview_truncates_a_large_file_instead_of_refusing(tmp_path, monkeypatch):
    manager = _file_manager(tmp_path, monkeypatch)
    root = tmp_path / 'apps' / 'file-proj'
    big = root / 'big.txt'
    big.write_text('x' * 250_000)
    preview = manager.file('file-proj', 'big.txt', preview=True)
    assert preview['truncated'] is True
    assert len(preview['content']) == 200_000
    assert preview['size'] == 250_000
    with pytest.raises(WorkspaceError, match='File too large to attach'):
        manager.file('file-proj', 'big.txt', preview=False)


def test_file_preview_reports_binary_files_without_text(tmp_path, monkeypatch):
    manager = _file_manager(tmp_path, monkeypatch)
    root = tmp_path / 'apps' / 'file-proj'
    (root / 'blob.bin').write_bytes(b'\x00\x01\x02binary' * 4)
    data = manager.file('file-proj', 'blob.bin', preview=True)
    assert data['binary'] is True
    assert data['content'] == ''
    assert data['size'] > 0
