"""HL-VERIFY-001 part D: automatic, bounded, non-looping revision requests.

The verifier may request a revision only for a deterministic failure, never over a human
decision, and it stops when nothing improves instead of spending attempts forever.
"""
import json
from unittest.mock import Mock

from hermes_life.app import create_app
from hermes_life.schema import migrate

RUN = '11111111-2222-3333-4444-555555555555'
CRITERIA = ['pytest passes in the candidate.', 'The report lists its evidence.']
COMPILED = {'deliverable_class': 'code_change',
            'checks': [{'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'},
                       {'ordinal': 2, 'kind': 'file_read', 'root': 'candidate', 'path': 'main.py'}]}
FAILING = [{'ordinal': 1, 'kind': 'pytest', 'status': 'fail', 'command': 'pytest -q', 'cwd': '/vm/c',
            'exit_code': 1, 'output': '1 failed', 'output_sha256': 'p1', 'detail': 'pytest exit 1',
            'duration_ms': 500},
           {'ordinal': 2, 'kind': 'file_read', 'status': 'pass', 'command': None, 'cwd': '/vm/c',
            'exit_code': None, 'output': 'print("hi")', 'output_sha256': 'r1', 'detail': 'read 12 bytes',
            'duration_ms': 3}]


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


def build(tmp_path, changed_files=1, baseline_status='passed'):
    app = create_app(tmp_path / 'auto.db')
    store = app.state.runtime.store
    migrate(store.connection)
    with store.lock:
        con = store.connection
        con.execute("INSERT INTO investigation_plans(id,formulation_id,task_id,report,state,created_at,approved_at)"
                    " VALUES ('plan','form','task',?,'approved','now','now')",
                    (json.dumps({'summary': 'work', 'acceptance_criteria': CRITERIA}),))
        con.execute("""INSERT INTO implementation_runs
            (id,plan_id,project,state,candidate_path,baseline_path,baseline_json,candidate_json,
             response,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'now','now')""",
                    (RUN, 'plan', 'demo', 'candidate_passed', '/home/hermes/experiments/candidate-x',
                     '/home/hermes/experiments/baseline-x', json.dumps({'status': baseline_status}),
                     json.dumps({'status': 'passed'}), 'agent claims success'))
        con.commit()
    app.state.runtime.analysis_adapters['read_only'] = Compiler(COMPILED)
    verifier = app.state.verifier
    verifier.compile_criteria('plan')
    verifier.reviewer._snapshot = lambda ident: {'snapshot_sha256': 'sha', 'changed_files': changed_files,
                                                'files': [{'path': 'main.py', 'change': 'modified'}],
                                                'diff': '--- a\n+++ b'}
    verifier._guest = lambda payload: {'status': 'ok', 'checks': FAILING}
    verifier.revisions = Mock()
    verifier.revisions.queue.return_value = {'id': 'attempt-1', 'attempt': 1}
    return app, verifier


def events(app):
    with app.state.runtime.store.lock:
        rows = app.state.runtime.store.connection.execute('SELECT type,payload FROM events').fetchall()
    return [(r['type'], json.loads(r['payload'])) for r in rows]


def review_row(app):
    with app.state.runtime.store.lock:
        row = app.state.runtime.store.connection.execute(
            'SELECT * FROM implementation_reviews WHERE run_id=?', (RUN,)).fetchone()
    return dict(row) if row else None


def test_a_failed_disposition_requests_a_targeted_revision(tmp_path):
    app, verifier = build(tmp_path)
    report = verifier.run(RUN)
    assert report['disposition'] == 'failed'
    assert report['auto_revision'] == {'requested': True, 'queued': True, 'criteria': [1],
                                       'attempt': 1, 'attempt_id': 'attempt-1'}
    row = review_row(app)
    assert row['decision'] == 'revision_requested' and row['decided_by'] == 'verifier'
    assert row['evidence_sha256'] == 'sha'
    assert row['criteria_json'] == '[false, true]'
    # The request names the exact failed criterion and its evidence.
    assert 'Automatic revision request from independent verification' in row['feedback']
    assert 'criterion 1: pytest passes in the candidate.' in row['feedback']
    assert 'pytest exit 1' in row['feedback']
    verifier.revisions.queue.assert_called_once_with(RUN)
    recorded = [e for e in events(app) if e[0] == 'implementation.revision_requested']
    assert recorded and recorded[-1][1]['decided_by'] == 'verifier'
    assert recorded[-1][1]['criteria'] == [1]


def test_insufficient_evidence_never_queues_a_revision(tmp_path):
    app, verifier = build(tmp_path)
    unreadable = {'ordinal': 2, 'kind': 'file_read', 'status': 'error', 'command': None, 'cwd': '/vm/c',
                  'exit_code': None, 'output': 'check could not run: not a regular file',
                  'output_sha256': 'e1', 'detail': 'invalid or unavailable target', 'duration_ms': 2}
    passing = dict(FAILING[0], status='pass', exit_code=0, detail='pytest exit 0')
    verifier._guest = lambda payload: {'status': 'ok', 'checks': [passing, unreadable]}
    report = verifier.run(RUN)
    assert report['disposition'] == 'insufficient_evidence'
    assert report['auto_revision'] == {'requested': False, 'stopped': 'disposition_not_failed'}
    assert review_row(app) is None
    verifier.revisions.queue.assert_not_called()


def test_the_operator_can_turn_automatic_revision_off(tmp_path):
    app, verifier = build(tmp_path)
    app.state.verifier.set_auto_revision(False)
    report = verifier.run(RUN)
    assert report['disposition'] == 'failed'
    assert report['auto_revision'] == {'requested': False, 'stopped': 'auto_revision_disabled'}
    assert review_row(app) is None
    verifier.revisions.queue.assert_not_called()


def test_the_engine_stops_when_the_same_criteria_fail_again(tmp_path):
    app, verifier = build(tmp_path)
    app.state.verifier.set_auto_revision(False)
    verifier.run(RUN)                      # attempt 1: records the failure, requests nothing
    app.state.verifier.set_auto_revision(True)
    app.state.runtime.store.connection.execute('DELETE FROM implementation_reviews')
    app.state.runtime.store.connection.commit()
    report = verifier.run(RUN)             # attempt 2: identical failure set
    assert report['attempt'] == 2
    assert report['auto_revision'] == {'requested': False, 'stopped': 'no_progress', 'criteria': [1]}
    assert review_row(app) is None
    verifier.revisions.queue.assert_not_called()
    assert any(e[0] == 'verification.auto_revision_stopped' and e[1]['reason'] == 'no_progress'
               for e in events(app))


def test_the_machine_request_budget_is_enforced(tmp_path):
    app, verifier = build(tmp_path)
    with app.state.runtime.store.lock:
        con = app.state.runtime.store.connection
        for n in range(verifier.MAX_AUTO_REVISIONS):
            con.execute("""INSERT INTO implementation_review_history
                (run_id,decision,evidence_sha256,criteria_json,feedback,decided_at,archived_at,decided_by)
                VALUES (?,?,?,?,?,?,?,'verifier')""",
                        (RUN, 'revision_requested', 'sha', '[false, true]', 'auto', 't', 't'))
        con.commit()
    report = verifier.run(RUN)
    assert report['auto_revision']['stopped'] == 'auto_revision_budget_exhausted'
    assert review_row(app) is None
    verifier.revisions.queue.assert_not_called()


def test_a_human_decision_is_never_overridden(tmp_path):
    app, verifier = build(tmp_path)
    with app.state.runtime.store.lock:
        con = app.state.runtime.store.connection
        con.execute("INSERT INTO implementation_reviews VALUES (?,?,?,?,?,?,?)",
                    (RUN, 'rejected', 'sha', '[false, true]', 'not good enough', 't', 'human'))
        con.commit()
    report = verifier.run(RUN)
    assert report['auto_revision'] == {'requested': False, 'stopped': 'human_decision_recorded'}
    assert review_row(app)['decision'] == 'rejected'
    verifier.revisions.queue.assert_not_called()


def test_a_pending_machine_request_is_not_stacked(tmp_path):
    app, verifier = build(tmp_path)
    verifier.run(RUN)
    app.state.runtime.store.connection.execute(
        "UPDATE verification_runs SET criteria_json=? WHERE run_id=?",
        (json.dumps([{'ordinal': 1, 'verdict': 'failed'}, {'ordinal': 2, 'verdict': 'passed'}]), RUN))
    app.state.runtime.store.connection.commit()
    report = verifier.run(RUN)
    assert report['auto_revision']['stopped'] == 'revision_already_requested'
    verifier.revisions.queue.assert_called_once_with(RUN)


def test_the_setting_round_trips_through_the_api(tmp_path):
    app, verifier = build(tmp_path)
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        assert client.get('/api/verification/settings').json()['auto_revision'] is True
        assert client.put('/api/verification/settings', json={'auto_revision': False}).json()['auto_revision'] is False
        assert client.get('/api/verification/settings').json()['auto_revision'] is False
        assert client.get('/api/verification/settings').json()['max_auto_revisions'] == 2
        assert client.put('/api/verification/settings', json={'auto_revision': True}).json()['auto_revision'] is True