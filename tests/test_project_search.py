"""D12: workspace content search (direct-manager style — see test_project_file_ops.py
for why create_app is bypassed; the search shares tree()'s walk rules)."""
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
        self.events = []

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
    (project / 'src' / 'main.py').write_text('import os\ndef main():\n    return os.environ\n')
    (project / 'README.md').write_text('# Demo\nThe word haystack lives here.\n')
    (project / '.env').write_text('SECRET_TOKEN=haystack-should-never-be-found\n')
    (project / 'node_modules').mkdir()
    (project / 'node_modules' / 'dep.js').write_text('haystack in a dependency\n')
    manager.register('demo', str(project))
    return manager, project


def test_search_finds_hits_with_line_numbers(ws):
    manager, project = ws
    out = manager.search('demo', 'haystack')
    paths = {(h['path'], h['line']) for h in out['hits']}
    assert ('README.md', 2) in paths
    assert all('line' in h and 'text' in h for h in out['hits'])
    assert out['scanned'] >= 2


def test_search_honours_the_denylist(ws):
    manager, project = ws
    out = manager.search('demo', 'haystack')
    assert not any('.env' in h['path'] for h in out['hits']), 'denylisted files are never searched'
    assert not any('node_modules' in h['path'] for h in out['hits'])


def test_search_is_case_insensitive_and_substring(ws):
    manager, project = ws
    out = manager.search('demo', 'HAYSTACK')
    assert out['hits'], 'case-insensitive'
    out2 = manager.search('demo', 'ystack')  # substring
    assert out2['hits']


def test_search_refuses_a_short_query(ws):
    manager, project = ws
    with pytest.raises(WorkspaceError):
        manager.search('demo', 'x')


def test_search_reports_the_limit_honestly(ws):
    manager, project = ws
    # One file with many matching lines; the cap must truncate and say so.
    big = project / 'big.txt'
    big.write_text('\n'.join(f'needles line {i}' for i in range(50)) + '\n')
    out = manager.search('demo', 'needle', limit=10)
    assert len(out['hits']) == 10
    assert out['truncated'] is True


def test_search_counts_oversize_skips(ws):
    manager, project = ws
    huge = project / 'huge.txt'
    huge.write_bytes(b'x' * (200_000 * 2 + 1))  # above the search read cap
    out = manager.search('demo', 'needle')
    assert out['skipped_oversize'] >= 1
