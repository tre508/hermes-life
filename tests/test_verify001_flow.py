"""HL-VERIFY-001 parts D/E: the API flow, and re-verification without re-implementation.

A candidate is only eligible for acceptance once independent verification says so; a
re-verification re-runs the checks and never asks the coding agent to implement again.
"""
import json
from unittest.mock import patch

from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.schema import migrate

RUN_PREPARE = {'candidate': '/home/hermes/experiments/candidate-x',
               'baseline': '/home/hermes/experiments/baseline-x'}
CRITERIA = ['The candidate contains tests/test_main.py and pytest passes in it.',
            'A read of main.py is recorded showing the print statement.']
COMPILED = {'deliverable_class': 'code_change',
            'checks': [{'ordinal': 1, 'kind': 'pytest', 'root': 'candidate',
                        'expect': 'pytest exits 0', 'evidence_required': 'exit code and output'},
                       {'ordinal': 2, 'kind': 'file_read', 'root': 'candidate', 'path': 'main.py',
                        'expect': 'file readable', 'evidence_required': 'contents and sha256'}]}
CHECK_RESULTS = [
    {'ordinal': 1, 'kind': 'pytest', 'status': 'pass', 'command': 'pytest -q', 'cwd': '/vm/c',
     'exit_code': 0, 'output': '2 passed', 'output_sha256': 'p1', 'detail': 'pytest exit 0',
     'duration_ms': 800},
    {'ordinal': 2, 'kind': 'file_read', 'status': 'pass', 'command': None, 'cwd': '/vm/c',
     'exit_code': None, 'output': 'print("hi")', 'output_sha256': 'r1',
     'detail': 'read 12 bytes', 'duration_ms': 3},
]


class Adapter:
    """Serves the criteria compiler and the coding agent; records every prompt."""
    transport = 'ssh'

    def __init__(self):
        self.prompts = []

    def _ssh_base(self):
        return ['ssh', 'fake-vm']

    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        self.prompts.append(prompt)
        if 'convert acceptance criteria into checks' in prompt:
            return {'result': json.dumps(COMPILED), 'session_id': 'criteria'}
        return {'result': 'Added tests/test_main.py and verified the output.', 'session_id': 'code'}

    def cancel(self, task_id):
        return True

    def coding_calls(self):
        return [p for p in self.prompts if 'Implement this REVIEWED plan' in p]


def build(tmp_path, changed_files):
    adapter = Adapter()
    app = create_app(tmp_path / 'flow.db', adapter=adapter)
    store = app.state.runtime.store
    migrate(store.connection)
    with store.lock:
        con = store.connection
        con.execute("INSERT INTO investigation_plans(id,formulation_id,task_id,report,state,created_at,approved_at)"
                    " VALUES ('plan','form','task',?,'approved','now','now')",
                    (json.dumps({'summary': 'Add tests', 'steps': ['write tests'],
                                 'acceptance_criteria': CRITERIA}),))
        con.commit()
    verifier = app.state.verifier
    # This file exercises the acceptance gate; automatic revision has its own test file.
    verifier.set_auto_revision(False)
    verifier.compile_criteria('plan')
    verifier.reviewer._snapshot = lambda ident: {
        'snapshot_sha256': 'sha', 'changed_files': changed_files,
        'files': [{'path': 'main.py', 'change': 'modified'}] if changed_files else [],
        'diff': '--- a\n+++ b'}
    verifier._guest = lambda payload: {'status': 'ok', 'checks': CHECK_RESULTS}
    return app, adapter


def start_run(client):
    response = client.post('/api/implementations/from-plan/plan', json={'project': 'demo'})
    assert response.status_code == 201, response.text
    return response.json()


def test_acceptance_requires_verification_and_reverification_needs_no_agent(tmp_path):
    app, adapter = build(tmp_path, changed_files=0)
    with TestClient(app) as client:
        with patch.object(app.state.implementer, '_guest', side_effect=[
                RUN_PREPARE, {'status': 'ok', 'interpreter': '/usr/bin/python3'},
                {'status': 'passed', 'exit_code': 0, 'output': 'baseline ok'},
                {'status': 'passed', 'exit_code': 0, 'output': 'candidate ok'}]):
            run = start_run(client)
        run_id = run['id']
        assert run['state'] == 'candidate_passed'

        # 1. Automatic verification ran with the build and reports the missing deliverable.
        report = client.get(f'/api/implementations/{run_id}/verification').json()
        assert report['disposition'] == 'failed'
        assert report['deliverable_class'] == 'code_change'
        assert [c['verdict'] for c in report['criteria']] == ['failed', 'failed']
        assert all('changed 0 files' in c['reason'] for c in report['criteria'])
        assert [c['status'] for c in report['checks']] == ['pass', 'pass']

        # 2. Acceptance is refused while the disposition is not 'verified'.
        refused = client.post(f'/api/implementations/{run_id}/review', json={
            'decision': 'accepted', 'snapshot_sha256': 'sha',
            'criteria': [True, True], 'feedback': ''})
        assert refused.status_code == 409, refused.text
        assert 'verification disposition is failed' in refused.text

        # 3. Verification never mutates the run itself.
        assert client.get(f'/api/implementations/{run_id}').json()['state'] == 'candidate_passed'

        # 4. Re-verify after the deliverable exists: the checks decide, the agent is not called.
        app.state.verifier.reviewer._snapshot = lambda ident: {
            'snapshot_sha256': 'sha', 'changed_files': 1,
            'files': [{'path': 'main.py', 'change': 'modified'}], 'diff': '--- a\n+++ b'}
        coding_before = len(adapter.coding_calls())
        again = client.post(f'/api/implementations/{run_id}/verify')
        assert again.status_code == 201, again.text
        assert again.json()['disposition'] == 'verified'
        assert again.json()['attempt'] == 2
        assert len(adapter.coding_calls()) == coding_before, 're-verification must not re-implement'

        # 5. With a verified disposition the human decision goes through.
        accepted = client.post(f'/api/implementations/{run_id}/review', json={
            'decision': 'accepted', 'snapshot_sha256': 'sha',
            'criteria': [True, True], 'feedback': ''})
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()['decision'] == 'accepted'
        assert accepted.json()['host_modified'] is False
        assert client.get(f'/api/implementations/{run_id}/review-state').json()['decision'] == 'accepted'


def test_verification_report_is_empty_for_an_unverified_run(tmp_path):
    app, adapter = build(tmp_path, changed_files=1)
    with TestClient(app) as client:
        with patch.object(app.state.implementer, '_guest', side_effect=[
                RUN_PREPARE, {'status': 'ok'}, {'status': 'passed', 'exit_code': 0, 'output': 'ok'},
                {'status': 'passed', 'exit_code': 0, 'output': 'ok'}]):
            run = start_run(client)
        report = client.get(f'/api/implementations/{run["id"]}/verification').json()
        assert report['disposition'] == 'verified'
        assert client.get('/api/implementations/missing/verification').status_code == 404
        assert client.post('/api/implementations/missing/verify').status_code == 404