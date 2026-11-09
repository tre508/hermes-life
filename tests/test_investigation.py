import json
from datetime import datetime, timedelta, timezone
from typing import Any
from fastapi.testclient import TestClient
from hermes_life.app import create_app

class PlanAdapter:
    transport='ssh'
    def available(self): return True
    def run(self, prompt, callback, task_id=None):
        assert 'No implementation is authorized' in prompt
        return {'result': json.dumps({
            'summary':'The module lacks a reliable automated regression check.',
            'project_scope':{
                'repo':'demo','commit':'abc123','source_paths':['/home/hermes/workspaces/demo/abc123/spec.md'],
                'linked_discovery_id':'d','linked_formulation_id':'f','linked_goal_id':'g','linked_task_id':'t'
            },
            'evidence':['Investigation task reported no test file in the project'],
            'unknowns':['Whether tests run in a separate CI environment'],
            'steps':['Add a minimal unit test to a candidate branch'],
            'acceptance_criteria':['A new test file exists and passes under pytest'],
            'test_approach':{
                'baseline_command':'pytest -q','candidate_command':'pytest -q',
                'expected_environment':'python3.11','expected_dependencies':['pytest'],'test_framework':'pytest'
            },
            'risks':{
                'permissions':'candidate_write','blockers':[],'dependencies':[],
                'risks':['New tests may require a runner dependency']
            },
            'status_dates':{
                'created':'2024-01-01T00:00:00+00:00','approved':'2024-01-01T00:00:00+00:00',
                'started':None,'last_event':None,'completed':None,'reviewed':None
            }
        }), 'session_id':'plan-test'}
    def cancel(self, task_id):
        return True

def seed(store, status='completed'):
    with store.lock:
        con=store.connection
        con.execute("INSERT INTO discoveries(id,fingerprint,project,path,line,note,proposed_prompt,rationale,state,created_at,updated_at) VALUES ('d','fp','demo','main.py',1,'TODO: tests','p','r','proposed','now','now')")
        con.execute("INSERT INTO formulated_goals VALUES ('f','d','Testing plan','coding','Implement tests','[\"Tests pass\"]','Read only',50,'approved','g','now','now')")
        con.execute("INSERT INTO goals(id,title,prompt,state,priority,created_at,updated_at,task_id) VALUES ('g','Investigation','Inspect','%s',50,'now','now','t')" % status)
        con.execute("INSERT INTO tasks(id,prompt,state,created_at,updated_at,result) VALUES ('t','Inspect','completed','now','now','Investigation found no test file')")
        con.commit()

def test_plan_generation_persistence_and_dedup(tmp_path):
    path=tmp_path/'p.db'
    with TestClient(create_app(path,PlanAdapter())) as client:
        seed(client.app.state.runtime.store)
        # Register the project for the plan to find
        client.post('/api/projects', json={'name': 'demo', 'host_path': '/home/gayzer/Apps/hermes-life', 'spec_path': None})
        response=client.post('/api/investigation-plans/from-formulation/f')
        assert response.status_code==201,response.text
        assert 'steps' in json.loads(response.json()['report'])
        assert client.post('/api/investigation-plans/from-formulation/f').status_code==409
    with TestClient(create_app(path,PlanAdapter())) as client:
        assert len(client.get('/api/investigation-plans').json())==1

class MissingCriteriaAdapter(PlanAdapter):
    """A plan response that omits the section the pipeline consumes."""

    def run(self, prompt, callback, task_id=None):
        doc = json.loads(super().run(prompt, callback, task_id)['result'])
        doc.pop('acceptance_criteria')
        return {'result': json.dumps(doc), 'session_id': 'plan-test'}


def test_plan_without_acceptance_criteria_is_rejected(tmp_path):
    """A plan that could never be reviewed or started must not be created at all."""
    with TestClient(create_app(tmp_path/'p.db',MissingCriteriaAdapter())) as client:
        seed(client.app.state.runtime.store)
        client.post('/api/projects', json={'name': 'demo', 'host_path': '/home/gayzer/Apps/hermes-life', 'spec_path': None})
        response=client.post('/api/investigation-plans/from-formulation/f')
        assert response.status_code==409,response.text
        assert 'acceptance_criteria' in response.text
        assert client.get('/api/investigation-plans').json()==[]


def test_cannot_plan_before_investigation_complete(tmp_path):
    with TestClient(create_app(tmp_path/'p.db',PlanAdapter())) as client:
        seed(client.app.state.runtime.store, 'pending')
        client.post('/api/projects', json={'name': 'demo', 'host_path': '/home/gayzer/Apps/hermes-life', 'spec_path': None})
        assert client.post('/api/investigation-plans/from-formulation/f').status_code==409

def test_schema_migration_from_v1(tmp_path):
    from hermes_life.schema import SCHEMA_VERSION, migrate
    import sqlite3
    con=sqlite3.connect(tmp_path/'v1.db')
    con.execute('PRAGMA user_version=0');con.commit()  # Start from 0 so DDL runs
    migrate(con)
    assert con.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
    assert con.execute("SELECT name FROM sqlite_master WHERE name='investigation_plans'").fetchone()


# ---------------------------------------------------------------------------------------------------
# Drafting is a record, not a gap. The plan row now exists for the whole model call, in state
# 'drafting', and becomes 'proposed' in place. Without this the world has no signal that the planner is
# working — it used to see nothing at all until the plan was already finished.
# ---------------------------------------------------------------------------------------------------

class DraftObservingAdapter(PlanAdapter):
    """Captures the plan table every time the model is called.

    There is more than one model call in this flow — drafting the plan, then compiling its acceptance
    criteria — so this keeps every snapshot in order rather than only the last one.
    """

    store: Any = None
    snapshots: Any = None

    def run(self, prompt, callback, task_id=None):
        if self.snapshots is None:
            self.snapshots = []
        with self.store.lock:
            self.snapshots.append([dict(r) for r in self.store.connection.execute(
                'SELECT id,state,report,formulation_id FROM investigation_plans').fetchall()])
        return super().run(prompt, callback, task_id)


def _register_demo(client):
    client.post('/api/projects', json={'name': 'demo', 'host_path': '/home/gayzer/Apps/hermes-life', 'spec_path': None})


def test_a_draft_record_exists_while_the_model_is_writing(tmp_path):
    """The planner is visibly working for the whole call, and the same row becomes the plan."""
    adapter = DraftObservingAdapter()
    adapter.snapshots = []
    with TestClient(create_app(tmp_path/'p.db', adapter)) as client:
        adapter.store = client.app.state.runtime.store
        seed(adapter.store)
        _register_demo(client)

        response = client.post('/api/investigation-plans/from-formulation/f')
        assert response.status_code == 201, response.text

        # At the first model call — the drafting one — the record already exists and says drafting.
        assert adapter.snapshots, 'the adapter was never called'
        first = adapter.snapshots[0]
        assert len(first) == 1, first
        draft = first[0]
        assert draft['state'] == 'drafting'
        assert draft['report'] == ''
        assert draft['formulation_id'] == 'f'

        # The row keeps its identity for the whole flow; only its state and body change.
        for later in adapter.snapshots[1:]:
            assert [r['id'] for r in later] == [draft['id']], later
            assert later[0]['state'] in ('drafting', 'proposed'), later

        plans = client.get('/api/investigation-plans').json()
        assert len(plans) == 1
        assert plans[0]['id'] == draft['id']
        assert plans[0]['state'] == 'proposed'
        assert 'steps' in json.loads(plans[0]['report'])


def test_a_draft_is_reported_as_awaiting_nothing_while_it_is_written(tmp_path):
    """A drafting plan must not be offered for approval: the workflow says 'await', not 'approve'."""
    adapter = DraftObservingAdapter()
    with TestClient(create_app(tmp_path/'p.db', adapter)) as client:
        adapter.store = client.app.state.runtime.store
        seed(adapter.store)
        _register_demo(client)
        client.post('/api/investigation-plans/from-formulation/f')
        plan = client.get('/api/investigation-plans').json()[0]
        # once proposed it IS the approval gate
        assert plan['workflow']['next_action'] == 'approve_plan'


class ExplodingAdapter(PlanAdapter):
    """The model call fails after the draft record already exists."""

    def run(self, prompt, callback, task_id=None):
        raise RuntimeError('read-only adapter went away')


def test_a_failed_draft_leaves_no_plan_and_stays_retryable(tmp_path):
    """A crash mid-draft must not leave a plan that can never be reviewed, nor burn the formulation."""
    path = tmp_path/'p.db'
    with TestClient(create_app(path, ExplodingAdapter())) as client:
        seed(client.app.state.runtime.store)
        _register_demo(client)
        response = client.post('/api/investigation-plans/from-formulation/f')
        assert response.status_code in (409, 422), response.text
        assert client.get('/api/investigation-plans').json() == []

    # the same formulation can be drafted again
    with TestClient(create_app(path, PlanAdapter())) as client:
        response = client.post('/api/investigation-plans/from-formulation/f')
        assert response.status_code == 201, response.text
        assert [p['state'] for p in client.get('/api/investigation-plans').json()] == ['proposed']


def test_an_abandoned_draft_does_not_block_the_formulation(tmp_path):
    """A drafting row older than the stale window is debris from a crash, not work in progress."""
    with TestClient(create_app(tmp_path/'p.db', PlanAdapter())) as client:
        store = client.app.state.runtime.store
        seed(store)
        _register_demo(client)
        abandoned = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        with store.lock:
            store.connection.execute(
                "INSERT INTO investigation_plans (id,formulation_id,task_id,report,state,created_at) "
                "VALUES ('crashed-draft','f','t','','drafting',?)", (abandoned,))
            store.connection.commit()

        response = client.post('/api/investigation-plans/from-formulation/f')
        assert response.status_code == 201, response.text
        states = [p['state'] for p in client.get('/api/investigation-plans').json()]
        assert states == ['proposed'], states          # the debris is gone, the real plan is there


def test_a_live_draft_still_blocks_a_second_plan(tmp_path):
    """A fresh draft is genuine work in progress: it must not be swept away mid-call."""
    with TestClient(create_app(tmp_path/'p.db', PlanAdapter())) as client:
        store = client.app.state.runtime.store
        seed(store)
        _register_demo(client)
        with store.lock:
            store.connection.execute(
                "INSERT INTO investigation_plans (id,formulation_id,task_id,report,state,created_at) "
                "VALUES ('live-draft','f','t','','drafting',?)", (datetime.now(timezone.utc).isoformat(),))
            store.connection.commit()

        assert client.post('/api/investigation-plans/from-formulation/f').status_code == 409
        states = [p['state'] for p in client.get('/api/investigation-plans').json()]
        assert states == ['drafting'], states
