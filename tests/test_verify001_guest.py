"""HL-VERIFY-001 part B: the verification guest actually executes and records evidence.

The guest is run for real here (no SSH, no mock) against a temporary experiments root,
so the closed check vocabulary is exercised end to end rather than asserted about.
"""
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

from hermes_life.verification import VERIFY_GUEST

IDENT = 'eed8f347-4863-4fca-b441-82475db65bd2'


def test_verify_guest_compiles():
    compile(VERIFY_GUEST, '<guest>', 'exec')


def run_guest(tmp_path, checks, project=None):
    guest = (VERIFY_GUEST
             .replace("EXPERIMENTS=pathlib.Path('/home/hermes/experiments').resolve()",
                      'EXPERIMENTS=pathlib.Path(' + repr(str(tmp_path / 'experiments')) + ').resolve()')
             .replace("PROJECTS=pathlib.Path('/home/hermes/projects').resolve()",
                      'PROJECTS=pathlib.Path(' + repr(str(tmp_path / 'projects')) + ').resolve()'))
    payload = {'operation': 'verify', 'id': IDENT, 'checks': checks, 'project': project}
    result = subprocess.run([sys.executable, '-c', guest], input=json.dumps(payload),
                            text=True, capture_output=True, timeout=180)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def workspace(tmp_path):
    experiments = tmp_path / 'experiments'
    candidate = experiments / ('candidate-' + IDENT)
    baseline = experiments / ('baseline-' + IDENT)
    (candidate / 'tests').mkdir(parents=True)
    baseline.mkdir(parents=True)
    (candidate / 'main.py').write_text('print("hello")\n# NEEDLE_CANDIDATE\n')
    (baseline / 'main.py').write_text('print("hello")\n# NEEDLE_BASELINE_ONLY\n')
    (candidate / 'tests' / 'test_main.py').write_text(
        'def test_ok():\n    assert True\n')
    (candidate / 'report.json').write_text(json.dumps({'summary': 's', 'evidence': ['e']}))
    (candidate / 'other.json').write_text(json.dumps({'summary': 's'}))
    (candidate / 'store.db').write_text('')
    connection = sqlite3.connect(candidate / 'store.db')
    connection.execute('CREATE TABLE events (id INTEGER PRIMARY KEY)')
    connection.execute('INSERT INTO events DEFAULT VALUES')
    connection.commit()
    connection.close()
    venv = candidate / '.venv' / 'bin'
    venv.mkdir(parents=True)
    (venv / 'python').symlink_to(sys.executable)
    return experiments


def by_ordinal(payload):
    return {c['ordinal']: c for c in payload['checks']}


def test_every_check_kind_executes_and_records_evidence(tmp_path):
    workspace(tmp_path)
    payload = run_guest(tmp_path, [
        {'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'},
        {'ordinal': 2, 'kind': 'file_contains', 'root': 'candidate', 'path': 'main.py',
         'needle': 'NEEDLE_CANDIDATE'},
        {'ordinal': 3, 'kind': 'file_contains', 'root': 'baseline', 'path': 'main.py',
         'needle': 'NEEDLE_CANDIDATE'},
        {'ordinal': 4, 'kind': 'search', 'root': 'candidate', 'needle': 'NEEDLE_BASELINE_ONLY',
         'expect_present': False},
        {'ordinal': 5, 'kind': 'search', 'root': 'candidate', 'needle': 'NEEDLE_CANDIDATE',
         'expect_present': True},
        {'ordinal': 6, 'kind': 'json_object', 'root': 'candidate', 'path': 'report.json',
         'keys': ['summary', 'evidence']},
        {'ordinal': 7, 'kind': 'json_object', 'root': 'candidate', 'path': 'other.json',
         'keys': ['summary', 'evidence']},
        {'ordinal': 8, 'kind': 'sqlite_table', 'root': 'candidate', 'path': 'store.db',
         'table': 'events'},
        {'ordinal': 9, 'kind': 'sqlite_table', 'root': 'candidate', 'path': 'store.db',
         'table': 'missing'},
        {'ordinal': 10, 'kind': 'byte_count', 'root': 'candidate', 'path': 'main.py'},
        {'ordinal': 11, 'kind': 'file_read', 'root': 'candidate', 'path': 'main.py'},
        {'ordinal': 12, 'kind': 'git_state', 'root': 'candidate'},
    ])
    got = by_ordinal(payload)
    assert payload['status'] == 'ok'
    assert [got[n]['status'] for n in range(1, 13)] == [
        'pass',   # pytest runs in the candidate
        'pass',   # needle present
        'fail',   # needle absent from the baseline copy
        'pass',   # search proves absence
        'pass',   # search proves presence
        'pass',   # both JSON keys present
        'fail',   # a required key is missing
        'pass',   # table exists, row count read
        'fail',   # table absent
        'pass',   # size recorded
        'pass',   # contents recorded
        'error',  # not a git repository is not 'clean'
    ]
    # Evidence is recorded, not summarised away.
    assert got[1]['command'] and 'pytest' in got[1]['command'] and got[1]['exit_code'] == 0
    assert '2 passed' in got[1]['output'] or '1 passed' in got[1]['output']
    assert got[1]['duration_ms'] >= 0 and got[1]['output_sha256']
    assert 'rows: 1' in got[8]['output']
    assert got[5]['output'] == 'matches: ["main.py"]'
    assert 'NEEDLE_CANDIDATE' in got[5]['detail'] and 'matches=1' in got[5]['detail']
    assert 'read 34 bytes' in got[11]['detail'] or 'sha256' in got[11]['detail']


def test_guest_treats_an_absent_target_as_a_failed_check(tmp_path):
    workspace(tmp_path)
    payload = run_guest(tmp_path, [
        {'ordinal': 1, 'kind': 'file_contains', 'root': 'candidate', 'path': 'RELEASE_NOTES.md',
         'needle': 'MB-VERIFIED'},
        {'ordinal': 2, 'kind': 'file_read', 'root': 'candidate', 'path': 'missing.json'},
    ])
    got = by_ordinal(payload)
    assert got[1]['status'] == 'fail' and 'absent' in got[1]['output']
    assert got[2]['status'] == 'fail'


def test_guest_rejects_paths_outside_the_workspace(tmp_path):
    workspace(tmp_path)
    payload = run_guest(tmp_path, [
        {'ordinal': 1, 'kind': 'file_read', 'root': 'candidate', 'path': '../../etc/passwd'},
        {'ordinal': 2, 'kind': 'file_read', 'root': 'candidate', 'path': '/etc/passwd'},
        {'ordinal': 3, 'kind': 'search', 'root': 'candidate', 'needle': 'root'},
    ])
    got = by_ordinal(payload)
    assert got[1]['status'] == 'error' and 'could not run' in got[1]['output']
    assert got[2]['status'] == 'error'
    assert got[3]['status'] in ('pass', 'fail')  # a bounded search is allowed


def test_guest_rejects_an_unknown_kind_and_a_bad_project_name(tmp_path):
    workspace(tmp_path)
    projects = tmp_path / 'projects' / 'demo'
    projects.mkdir(parents=True)
    (projects / 'main.py').write_text('print("hi")\n')
    payload = run_guest(tmp_path, [
        {'ordinal': 1, 'kind': 'shell', 'root': 'candidate', 'path': 'main.py'},
        {'ordinal': 2, 'kind': 'file_read', 'root': 'project', 'path': 'main.py'},
    ], project='demo')
    got = by_ordinal(payload)
    assert got[1]['status'] == 'error'
    assert got[2]['status'] == 'pass'
    # A traversal attempt in the project name fails that check only; the guest stays bounded.
    escaped = run_guest(tmp_path, [
        {'ordinal': 1, 'kind': 'file_read', 'root': 'project', 'path': 'main.py'}], project='../escape')
    assert by_ordinal(escaped)[1]['status'] == 'error'
    assert 'Invalid project name' in by_ordinal(escaped)[1]['output']