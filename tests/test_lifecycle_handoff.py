"""HL-FLOW-001 acceptance: autonomous lifecycle handoff + investigation safety.

Covers: approved discovery -> formulation -> read-only investigation -> auto-plan,
failure never plans, unapproved plans cannot trigger implementation, and restarts
never duplicate goals/plans. Uses a fake adapter and a temporary database.
"""
import json
import time
from contextlib import contextmanager
from unittest.mock import patch
from fastapi.testclient import TestClient
from hermes_life.app import create_app

PLAN_DOC = {
    'summary': 'The module lacks reliable automated regression coverage.',
    'project_scope': {
        'repo': 'demo', 'commit': 'abc123', 'source_paths': ['/home/hermes/workspaces/demo/abc123/main.py'],
        'linked_discovery_id': 'd', 'linked_formulation_id': 'f', 'linked_goal_id': 'g', 'linked_task_id': 't'
    },
    'evidence': ['Investigation found no test file in the candidate project'],
    'unknowns': [],
    'steps': ['Add a minimal unit test to the candidate workspace'],
    'test_approach': {
        'baseline_command': 'pytest -q', 'candidate_command': 'pytest -q',
        'expected_environment': 'python3.11', 'expected_dependencies': ['pytest'], 'test_framework': 'pytest'
    },
    'risks': {
        'permissions': 'candidate_write', 'blockers': [], 'dependencies': [],
        'risks': []
    },
    'status_dates': {
        'created': '2024-01-01T00:00:00+00:00', 'approved': '2024-01-01T00:00:00+00:00',
        'started': None, 'last_event': None, 'completed': None, 'reviewed': None
    }
}

SAMPLE = [{'project': 'demo', 'file': 'main.py', 'line': 3, 'note': '# TODO: add tests'}]


class LifecycleAdapter:
    """Serves an approved investigation run, then a plan-generation run on demand."""
    transport = 'ssh'

    def __init__(self, fail_investigation=False):
        self.fail_investigation = fail_investigation

    def _ssh_base(self):
        return ['ssh', 'fake-vm']

    def available(self):
        return True

    def run(self, prompt, callback):
        if 'No implementation is authorized' in prompt:  # planning stage only
            return {'result': json.dumps(PLAN_DOC), 'session_id': 'plan'}
        if self.fail_investigation:
            raise RuntimeError('investigation failed')
        return {'result': 'read-only finding: no tests present', 'session_id': 'invest'}


@contextmanager
def _scan(app, sample=SAMPLE):
    with patch('hermes_life.discovery.subprocess.run') as run:
        run.return_value.returncode = 0
        run.return_value.stdout = json.dumps(sample)
        with TestClient(app) as c:
            r = c.post('/api/discoveries/scan')
            assert r.json()['new'] == 1
            disc = c.get('/api/discoveries').json()[0]
            # Register the project for the plan to find
            c.post('/api/projects', json={'name': 'demo', 'host_path': '/home/gayzer/Apps/hermes-life', 'spec_path': None})
            yield c, disc


def _wait_for(predicate, timeout=8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.1)
    return predicate()


def test_approved_discovery_auto_plans_without_duplicate_goal(tmp_path):
    app = create_app(tmp_path / 'flow.db', adapter=LifecycleAdapter())
    with _scan(app) as (c, disc):
        c.put('/api/autonomy', json={'enabled': True})
        assert c.post(f"/api/discoveries/{disc['id']}/approve").status_code == 200

        goals = c.get('/api/goals').json()
        assert len(goals) == 1 and goals[0]['state'] == 'pending'
        # Raw proposed_prompt must NOT reach the adapter; a safe source-derived
        # read-only prompt is used instead.
        assert 'Do not modify files' in goals[0]['prompt']
        assert goals[0]['prompt'] != disc['proposed_prompt']
        porm = c.get('/api/formulations').json()
        assert len(porm) == 1 and porm[0]['discovery_id'] == disc['id']

        # Investigation runs autonomously and the plan is created automatically.
        plan = _wait_for(lambda: c.get('/api/investigation-plans').json() or None)
        assert len(plan) == 1 and plan[0]['state'] == 'proposed'
        # Still exactly one goal/formulation after the handoff (no duplicates).
        assert len(c.get('/api/goals').json()) == 1
        assert len(c.get('/api/formulations').json()) == 1
    # Restart: nothing is duplicated (recovery is idempotent, autonomy stays enabled).
    app2 = create_app(tmp_path / 'flow.db', adapter=LifecycleAdapter())
    with TestClient(app2) as c:
        assert len(c.get('/api/goals').json()) == 1
        assert len(c.get('/api/formulations').json()) == 1
        assert len(c.get('/api/investigation-plans').json()) == 1


def test_failed_investigation_does_not_create_plan(tmp_path):
    app = create_app(tmp_path / 'fail.db', adapter=LifecycleAdapter(fail_investigation=True))
    with _scan(app) as (c, disc):
        c.put('/api/autonomy', json={'enabled': True})
        c.post(f"/api/discoveries/{disc['id']}/approve")
        goal = _wait_for(lambda: next((g for g in c.get('/api/goals').json()
                                       if g['state'] in ('failed', 'completed')), None))
        assert goal['state'] == 'failed', goal
        assert c.get('/api/investigation-plans').json() == []


def test_unapproved_plan_cannot_initiate_implementation(tmp_path):
    app = create_app(tmp_path / 'impl.db', adapter=LifecycleAdapter())
    with TestClient(app) as c:
        with app.state.runtime.store.lock:
            con = app.state.runtime.store.connection
            con.execute("INSERT INTO discoveries(id,fingerprint,project,path,line,note,proposed_prompt,rationale,state,created_at,updated_at) VALUES ('d','fp','demo','main.py',1,'TODO','p','r','proposed','now','now')")
            con.execute("INSERT INTO formulated_goals VALUES ('f','d','Testing','coding','r','[\"ok\"]','read',50,'approved','g','now','now')")
            con.execute("INSERT INTO goals(id,title,prompt,state,priority,created_at,updated_at,task_id) VALUES ('g','Investigation','Inspect','completed',50,'now','now','t')")
            con.execute("INSERT INTO tasks(id,prompt,state,created_at,updated_at,result) VALUES ('t','Inspect','completed','now','now','evidence')")
            con.commit()
        plan = c.post('/api/investigation-plans/from-formulation/f').json()
        assert plan['state'] == 'proposed'
        # Unapproved: refused before any provisioning happens.
        assert c.post(f"/api/implementations/from-plan/{plan['id']}", json={'project': 'demo'}).status_code == 409
        # Explicit approval opens the gate; second approval is rejected.
        approved = c.post(f"/api/investigation-plans/{plan['id']}/approve")
        assert approved.status_code == 200 and approved.json()['state'] == 'approved'
        assert c.post(f"/api/investigation-plans/{plan['id']}/approve").status_code == 409
