import json
from fastapi.testclient import TestClient
from hermes_life.app import create_app

class PlanAdapter:
    transport='ssh'
    def available(self): return True
    def run(self, prompt, callback):
        assert 'No implementation is authorized' in prompt
        return {'result': json.dumps({
            'summary':'The module lacks a reliable automated regression check.',
            'evidence':['Investigation task reported no test file in the project'],
            'unknowns':['Whether tests run in a separate CI environment'],
            'steps':['Add a minimal unit test to a candidate branch'],
            'acceptance_criteria':['The new test passes in the isolated workspace'],
            'risks':['New tests may require a runner dependency']
        }), 'session_id':'plan-test'}

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
        response=client.post('/api/investigation-plans/from-formulation/f')
        assert response.status_code==201,response.text
        assert 'steps' in json.loads(response.json()['report'])
        assert client.post('/api/investigation-plans/from-formulation/f').status_code==409
    with TestClient(create_app(path,PlanAdapter())) as client:
        assert len(client.get('/api/investigation-plans').json())==1

def test_cannot_plan_before_investigation_complete(tmp_path):
    with TestClient(create_app(tmp_path/'p.db',PlanAdapter())) as client:
        seed(client.app.state.runtime.store,'pending')
        assert client.post('/api/investigation-plans/from-formulation/f').status_code==409

def test_schema_migration_from_v1(tmp_path):
    from hermes_life.schema import SCHEMA_VERSION, migrate
    import sqlite3
    con=sqlite3.connect(tmp_path/'v1.db')
    con.execute('PRAGMA user_version=1');con.commit()
    migrate(con)
    assert con.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
    assert con.execute("SELECT name FROM sqlite_master WHERE name='investigation_plans'").fetchone()
