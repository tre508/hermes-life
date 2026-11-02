import json
from hermes_life.app import create_app
from unittest.mock import patch

class FakeAdapter:
    transport='ssh'
    def _ssh_base(self): return ['ssh','fake-vm']
    def available(self): return True
    def run(self,prompt,callback):return {'result':'OK','session_id':'demo'}

def test_candidate_review_persists(tmp_path):
    from fastapi.testclient import TestClient
    path=tmp_path/'state.db'
    app=create_app(path,adapter=FakeAdapter())
    record={'project':'demo','file':'main.py','line':3,'note':'# TODO: add tests'}
    with TestClient(app) as client:
        with patch('hermes_life.discovery.subprocess.run') as run:
            run.return_value.returncode=0
            run.return_value.stdout=json.dumps([record])
            first=client.post('/api/discoveries/scan')
            assert first.status_code==200 and first.json()['new']==1
            assert client.post('/api/discoveries/scan').json()['new']==0
        item=client.get('/api/discoveries').json()[0]
        assert client.post(f"/api/discoveries/{item['id']}/approve").status_code==200
        goals=client.get('/api/goals').json()
        assert len(goals)==1 and goals[0]['state']=='pending'
        assert 'Do not modify files' in goals[0]['prompt']
        assert client.post(f"/api/discoveries/{item['id']}/approve").status_code==409
    with TestClient(create_app(path,adapter=FakeAdapter())) as client:
        assert client.get('/api/discoveries').json()[0]['state']=='approved'
        assert len(client.get('/api/goals').json())==1
