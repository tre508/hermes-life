import json
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
