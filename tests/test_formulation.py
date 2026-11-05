import json
from fastapi.testclient import TestClient
from hermes_life.app import create_app

class FakeAdapter:
    transport='ssh'
    def available(self): return True
    def run(self,prompt,callback,task_id=None):
        callback('hermes.result',{'type':'result'})
        return {'result':json.dumps({'title':'Investigate timeout defect','action':'coding','rationale':'Repeated timeout is reported in repository','acceptance_criteria':['Document reproducible failure'], 'priority':70,'execution_prompt':'Read the file and diagnose the issue without changes'}),'session_id':'test'}
    def cancel(self, task_id):
        return True

def test_formulation_approval_and_persistence(tmp_path):
    path=tmp_path/'life.db'
    app=create_app(path,adapter=FakeAdapter())
    with TestClient(app) as client:
        store=app.state.runtime.store
        with store.lock:
            store.connection.execute('INSERT INTO discoveries (id,fingerprint,project,path,line,note,proposed_prompt,rationale,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',('disc','finger','demo','a.py',3,'FIXME: timeout','prompt','marker','proposed','now','now'))
            store.connection.commit()
        response=client.post('/api/formulations/from-discovery/disc')
        assert response.status_code==201,response.text
        proposal=response.json()
        assert proposal['action']=='coding'
        assert client.post('/api/formulations/from-discovery/disc').status_code==409
        approval=client.post('/api/formulations/'+proposal['id']+'/approve')
        assert approval.status_code==200
        goal=client.get('/api/goals').json()[0]
        assert 'Do not modify files' in goal['prompt']
        assert client.post('/api/formulations/'+proposal['id']+'/approve').status_code==409
    with TestClient(create_app(path,adapter=FakeAdapter())) as client:
        assert client.get('/api/formulations').json()[0]['state']=='approved'

def test_busy_prevents_formulation(tmp_path):
    app=create_app(tmp_path/'other.db',adapter=FakeAdapter())
    with TestClient(app) as client:
        lock=app.state.runtime.active
        lock.acquire()
        try: assert client.post('/api/formulations/from-discovery/nothing').status_code==409
        finally: lock.release()
