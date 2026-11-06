"""The revision guest is executed for real, not only mocked.

The FLOW-006 unit tests replace `_guest`, so a guest that cannot run at all (an undefined
name in the test step) stayed green while every real revision attempt failed.
"""
import json
import subprocess
import sys

from hermes_life.implementation_revision import REVISION_GUEST

IDENT = 'eed8f347-4863-4fca-b441-82475db65bd2'
ATTEMPT = '352f4a08-cf66-4029-a754-c53f9eae33eb'


def run_guest(tmp_path, payload):
    guest = (REVISION_GUEST.replace(
        "root=pathlib.Path('/home/hermes/experiments').resolve(strict=True)",
        'root=pathlib.Path(' + repr(str(tmp_path)) + ').resolve()')
        .replace("EXPERIMENTS_ROOT='/home/hermes/experiments'",
                 'EXPERIMENTS_ROOT=' + repr(str(tmp_path))))
    return subprocess.run([sys.executable, '-c', guest], input=json.dumps(payload),
                          text=True, capture_output=True, timeout=180)


def workspace(tmp_path):
    for name in ('candidate-' + IDENT, 'revision-' + ATTEMPT):
        directory = tmp_path / name
        directory.mkdir(parents=True)
        (directory / 'test_ok.py').write_text('def test_ok():\n    assert True\n')
    env = tmp_path / ('env-' + IDENT) / 'bin'
    env.mkdir(parents=True)
    (env / 'python').symlink_to(sys.executable)


def test_revision_guest_test_step_runs_against_the_platform_environment(tmp_path):
    workspace(tmp_path)
    result = run_guest(tmp_path, {'operation': 'test', 'id': IDENT, 'attempt': ATTEMPT})
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data['status'] == 'passed', data
    assert data['env_source'] == 'platform'
    assert data['exit_code'] == 0
    assert 'passed' in data['output']


def test_revision_guest_reports_an_unusable_environment_instead_of_crashing(tmp_path):
    (tmp_path / ('candidate-' + IDENT)).mkdir(parents=True)
    (tmp_path / ('revision-' + ATTEMPT)).mkdir(parents=True)
    result = run_guest(tmp_path, {'operation': 'test', 'id': IDENT, 'attempt': ATTEMPT})
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data['status'] == 'evaluation_error'
    assert data['env_source'] == 'platform'
    assert 'Platform environment unavailable' in data['output']
