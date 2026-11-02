import time
from fastapi.testclient import TestClient
from hermes_life.app import create_app

class FakeAdapter:
    def available(self):
        return True
    def run(self, prompt, callback):
        callback('hermes.tool_use', {'name':'test_tool','input':{'prompt':prompt}})
        return {'result':'Test complete', 'session_id':'fake-session'}

def test_task_lifecycle_and_restart(tmp_path):
    db = tmp_path / 'life.db'
    client = TestClient(create_app(database=db, adapter=FakeAdapter()))
    assert client.get('/health').json()['status'] == 'ok'
    response = client.post('/api/tasks',json={'prompt':'Say hello'})
    assert response.status_code == 202
    task_id = response.json()['id']
    for _ in range(100):
        if client.get(f'/api/tasks/{task_id}').json()['state']=='completed':
            break
        time.sleep(.01)
    assert client.get(f'/api/tasks/{task_id}').json()['result']=='Test complete'
    events = client.get('/api/events').json()
    assert any(e['type']=='hermes.tool_use' for e in events)
    restored = TestClient(create_app(database=db,adapter=FakeAdapter()))
    assert restored.get(f'/api/tasks/{task_id}').json()['state']=='completed'
    assert len(restored.get('/api/events').json()) >= 3

def test_invalid_prompt(tmp_path):
    client = TestClient(create_app(database=tmp_path/'life.db', adapter=FakeAdapter()))
    assert client.post('/api/tasks',json={'prompt':''}).status_code == 422
