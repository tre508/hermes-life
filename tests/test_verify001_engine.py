"""HL-VERIFY-001 parts B/C: independent checks decide, deterministic results win.

Every case here runs the real engine against a real (temporary) database; only the VM
boundary is faked, so the verdict and disposition logic is exercised as shipped.
"""
import json

from hermes_life.app import create_app
from hermes_life.schema import migrate

RUN = '11111111-2222-3333-4444-555555555555'
CRITERIA = [
    'A test file exists and pytest passes in the candidate.',
    'A read of main.py is recorded.',
]


class Compiler:
    transport = 'ssh'

    def __init__(self, value):
        self.value = value

    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        return {'result': json.dumps(self.value), 'session_id': 'criteria'}

    def cancel(self, task_id):
        return True


class Adjudicator:
    """Stands in for the read_only adapter when a criterion needs interpretation."""
    transport = 'ssh'

    def __init__(self, verdicts):
        self.verdicts = verdicts

    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        return {'result': json.dumps({'verdicts': self.verdicts}), 'session_id': 'adjudicate'}

    def cancel(self, task_id):
        return True


def build(tmp_path, checks, deliverable='code_change', changed_files=1,
          baseline_status='passed', environment_status='ok', criteria=None, attempt_state='candidate_passed'):
    app = create_app(tmp_path / 'engine.db')
    store = app.state.runtime.store
    migrate(store.connection)
    criteria = criteria or CRITERIA
    with store.lock:
        con = store.connection
        con.execute("INSERT INTO investigation_plans(id,formulation_id,task_id,report,state,created_at,approved_at)"
                    " VALUES ('plan','form','task',?,'approved','now','now')",
                    (json.dumps({'summary': 'work', 'acceptance_criteria': criteria}),))
        con.execute("""INSERT INTO implementation_runs
            (id,plan_id,project,state,candidate_path,baseline_path,baseline_json,candidate_json,
             response,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'now','now')""",
                    (RUN, 'plan', 'demo', attempt_state, '/home/hermes/experiments/candidate-x',
                     '/home/hermes/experiments/baseline-x', json.dumps({'status': baseline_status}),
                     json.dumps({'status': 'passed'}), 'agent claims everything was verified'))
        con.execute("""INSERT INTO implementation_environments
            (run_id,status,python_version,interpreter,manifest_json,packages_json,install_json,error,
             created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'now','now')""",
                    (RUN, environment_status, '3.11', '/usr/bin/python3', '{}', None, '[]', None))
        con.commit()
    app.state.runtime.adapters['read_only'] = Compiler(
        {'deliverable_class': deliverable, 'checks': checks})
    verifier = app.state.verifier
    verifier.compile_criteria('plan')
    verifier.reviewer._snapshot = lambda ident: {
        'snapshot_sha256': 'sha', 'changed_files': changed_files,
        'files': [{'path': 'main.py', 'change': 'modified'}] if changed_files else [],
        'diff': '--- a\n+++ b'}
    return app, verifier


def guest(calls, results):
    def fake(payload):
        calls.append(payload)
        return {'status': 'ok', 'checks': results}
    return fake


PASS_PYTEST = {'ordinal': 1, 'kind': 'pytest', 'status': 'pass', 'command': 'pytest -q',
               'cwd': '/vm/candidate', 'exit_code': 0, 'output': '2 passed',
               'output_sha256': 'p1', 'detail': 'pytest exit 0 via platform', 'duration_ms': 900}
PASS_READ = {'ordinal': 2, 'kind': 'file_read', 'status': 'pass', 'command': None,
             'cwd': '/vm/candidate', 'exit_code': None, 'output': 'print("hi")',
             'output_sha256': 'r1', 'detail': 'read 12 bytes, sha256 abc', 'duration_ms': 4}


def test_a_code_plan_with_no_changed_files_fails_every_criterion(tmp_path):
    app, verifier = build(tmp_path, [{'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'},
                                     {'ordinal': 2, 'kind': 'file_read', 'root': 'candidate',
                                      'path': 'main.py'}],
                          deliverable='code_change', changed_files=0)
    calls = []
    verifier._guest = guest(calls, [PASS_PYTEST, PASS_READ])
    report = verifier.run(RUN)
    assert report['disposition'] == 'failed'
    assert [c['verdict'] for c in report['criteria']] == ['failed', 'failed']
    # The missing deliverable decides the verdict even though both checks passed...
    assert all('changed 0 files' in c['reason'] for c in report['criteria'])
    # ...and the checks that did run are still recorded as evidence for the reviewer.
    assert len(calls) == 1 and [c['status'] for c in report['checks']] == ['pass', 'pass']


def test_zero_changed_files_is_correct_for_an_evidence_plan(tmp_path):
    app, verifier = build(tmp_path, [{'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'},
                                     {'ordinal': 2, 'kind': 'file_read', 'root': 'candidate',
                                      'path': 'main.py'}],
                          deliverable='evidence_report', changed_files=0)
    calls = []
    verifier._guest = guest(calls, [PASS_PYTEST, PASS_READ])
    report = verifier.run(RUN)
    assert report['disposition'] == 'verified'
    assert [c['verdict'] for c in report['criteria']] == ['passed', 'passed']
    assert len(calls) == 1 and len(calls[0]['checks']) == 2


def test_a_failed_deterministic_check_cannot_be_overridden_by_the_model(tmp_path):
    app, verifier = build(tmp_path, [{'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'},
                                     {'ordinal': 2, 'kind': 'interpretive', 'root': 'candidate'}])
    verifier._guest = guest([], [dict(PASS_PYTEST, status='fail', exit_code=1, detail='1 failed')])
    app.state.runtime.adapters['read_only'] = Adjudicator([
        {'ordinal': 1, 'verdict': 'passed', 'reason': 'looks fine', 'evidence_refs': ['agent said so']},
        {'ordinal': 2, 'verdict': 'passed', 'reason': 'report explains it', 'evidence_refs': ['claim']}])
    report = verifier.run(RUN)
    assert report['criteria'][0]['verdict'] == 'failed'
    assert report['disposition'] == 'failed'


def test_a_missing_required_artifact_fails_its_criterion(tmp_path):
    """An absent file is a definite negative answer, not an unevaluable check: it must be
    actionable (a revision can create it) rather than merely 'unverified'."""
    app, verifier = build(tmp_path, [{'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'},
                                     {'ordinal': 2, 'kind': 'file_read', 'root': 'candidate',
                                      'path': 'report.json'}])
    absent = {'ordinal': 2, 'kind': 'file_read', 'status': 'fail', 'command': None, 'cwd': '/vm/c',
              'exit_code': None, 'output': 'required file is absent: report.json',
              'output_sha256': 'x1', 'detail': 'the required file is not present in the candidate workspace',
              'duration_ms': 1}
    verifier._guest = guest([], [PASS_PYTEST, absent])
    report = verifier.run(RUN)
    assert report['criteria'][1]['verdict'] == 'failed'
    assert report['disposition'] == 'failed'


def test_an_unevaluable_check_is_unverified(tmp_path):
    """A check that could not run at all is evidence of nothing, so it stays unverified."""
    app, verifier = build(tmp_path, [{'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'},
                                     {'ordinal': 2, 'kind': 'file_read', 'root': 'candidate',
                                      'path': 'report.json'}])
    unreadable = dict(PASS_READ, status='error', detail='Check path escape')
    verifier._guest = guest([], [PASS_PYTEST, unreadable])
    report = verifier.run(RUN)
    assert report['criteria'][1]['verdict'] == 'unverified'
    assert report['disposition'] == 'insufficient_evidence'


def test_an_unestablished_baseline_blocks_verification(tmp_path):
    app, verifier = build(tmp_path, [{'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'},
                                     {'ordinal': 2, 'kind': 'file_read', 'root': 'candidate',
                                      'path': 'main.py'}],
                          baseline_status='evaluation_error')
    calls = []
    verifier._guest = guest(calls, [])
    report = verifier.run(RUN)
    assert report['disposition'] == 'blocked'
    assert report['blocker'] == 'baseline_not_established'
    assert calls == []


def test_a_failed_baseline_is_established_evidence(tmp_path):
    """A fix plan expects failing tests before the change; that is not a blocker."""
    app, verifier = build(tmp_path, [{'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'},
                                     {'ordinal': 2, 'kind': 'file_read', 'root': 'candidate',
                                      'path': 'main.py'}],
                          baseline_status='failed')
    calls = []
    verifier._guest = guest(calls, [PASS_PYTEST, PASS_READ])
    report = verifier.run(RUN)
    assert report['blocker'] is None
    assert report['disposition'] == 'verified'
    assert len(calls) == 1


def test_model_verdict_without_evidence_is_downgraded(tmp_path):
    app, verifier = build(tmp_path, [{'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'},
                                     {'ordinal': 2, 'kind': 'interpretive', 'root': 'candidate'}])
    verifier._guest = guest([], [PASS_PYTEST])
    app.state.runtime.adapters['read_only'] = Adjudicator([
        {'ordinal': 2, 'verdict': 'passed', 'reason': 'trust me', 'evidence_refs': []}])
    report = verifier.run(RUN)
    assert report['criteria'][1]['verdict'] == 'unverified'
    assert 'downgraded' in report['criteria'][1]['reason']
    assert report['disposition'] == 'insufficient_evidence'


def test_model_verdict_with_cited_evidence_is_accepted(tmp_path):
    app, verifier = build(tmp_path, [{'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'},
                                     {'ordinal': 2, 'kind': 'interpretive', 'root': 'candidate'}])
    verifier._guest = guest([], [PASS_PYTEST])
    app.state.runtime.adapters['read_only'] = Adjudicator([
        {'ordinal': 2, 'verdict': 'passed', 'reason': 'the report cites the search count',
         'evidence_refs': ['output_sha256=p1']}])
    report = verifier.run(RUN)
    assert report['criteria'][1]['verdict'] == 'passed'
    assert report['criteria'][1]['interpreted_by_model'] is True
    assert report['disposition'] == 'verified'


def test_compiled_criteria_are_reported_when_none_can_be_checked(tmp_path):
    app, verifier = build(tmp_path, [{'ordinal': 1, 'kind': 'interpretive', 'root': 'candidate'},
                                     {'ordinal': 2, 'kind': 'interpretive', 'root': 'candidate'}])
    verifier._guest = guest([], [])
    report = verifier.run(RUN)
    assert [c['verdict'] for c in report['criteria']] == ['unverified', 'unverified']
    assert report['disposition'] == 'insufficient_evidence'