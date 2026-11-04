"""Focused checks for interpreter selection and evaluation classification."""
import json
import os
import subprocess
import sys
from pathlib import Path

from hermes_life.implementation import GUEST, ImplementationEngine


def test_guest_helper_compiles():
    compile(GUEST, '<guest>', 'exec')


def test_evaluation_classification():
    assert ImplementationEngine._result_state({'status': 'passed', 'exit_code': 0}) == 'candidate_passed'
    assert ImplementationEngine._result_state({'status': 'failed', 'exit_code': 1}) == 'candidate_failed'
    assert ImplementationEngine._result_state({'status': 'evaluation_error', 'exit_code': 1}) == 'evaluation_error'
    assert ImplementationEngine._result_state({'exit_code': 1, 'output': 'No module named pytest'}) == 'evaluation_error'
    assert ImplementationEngine._result_state({'exit_code': 5, 'output': 'no tests ran'}) == 'evaluation_error'


def test_guest_uses_candidate_virtualenv(tmp_path):
    # Test helper behavior without invoking SSH, using a temporary experiments root.
    guest = GUEST.replace("pathlib.Path('/home/hermes/experiments').resolve()", 'pathlib.Path(' + repr(str(tmp_path)) + ').resolve()')
    ident = 'eed8f347-4863-4fca-b441-82475db65bd2'
    candidate = tmp_path / ('candidate-' + ident)
    candidate.mkdir()
    python = candidate / '.venv' / 'bin' / 'python'
    python.parent.mkdir(parents=True)
    python.symlink_to(sys.executable)
    # Whether or not pytest is installed, verify the chosen interpreter is candidate .venv.
    result = subprocess.run([sys.executable, '-c', guest],
        input=json.dumps({'operation': 'test', 'id': ident, 'kind': 'candidate'}),
        text=True, capture_output=True, timeout=130)
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data['python'] == str(python)
    assert data['status'] in ('passed', 'failed', 'evaluation_error')
