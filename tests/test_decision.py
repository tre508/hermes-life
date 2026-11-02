import json
from unittest.mock import patch
from fastapi.testclient import TestClient
from hermes_life.app import create_app

class FakeAdapter:
    transport='ssh'
    def _ssh_base(self): return ['ssh','guest']
    def available(self): return True
    def run(self,prompt,callback): return {'result':'ok','session_id':'guest-session'}

def test_decision_opt_in_and_curiosity_persists(tmp_path):
    path=tmp_path/'life.db'
    app=create_app(path,adapter=FakeAdapter())
    sample=[{'project':'demo','file':'a.py','line':2,'note':'# FIXME: broken'}]
    with TestClient(app) as client:
        assert client.get('/api/decisions').json()['enabled'] is False
        assert app.state.decision.tick()['action']=='paused'
        with patch('hermes_life.discovery.subprocess.run') as proc:
            proc.return_value.returncode=0
            proc.return_value.stdout=json.dumps(sample)
            response=client.post('/api/decisions/scan')
            assert response.status_code==200
            assert response.json()['questions_added']==1
            assert client.post('/api/decisions/scan').json()['questions_added']==0
        item=client.get('/api/curiosity').json()[0]
        assert item['priority']==65
        assert client.post(f"/api/curiosity/{item['id']}/deferred").status_code==200
        assert len(client.get('/api/goals').json())==0
    with TestClient(create_app(path,adapter=FakeAdapter())) as client:
        assert client.get('/api/curiosity').json()[0]['state']=='deferred'
        assert client.get('/api/decisions').json()['enabled'] is False

def test_busy_prevents_scan(tmp_path):
    app=create_app(tmp_path/'busy.db',adapter=FakeAdapter())
    with TestClient(app) as client:
        runtime=app.state.runtime
        runtime.active.acquire()
        try: assert client.post('/api/decisions/scan').json()['action']=='busy'
        finally: runtime.active.release()
