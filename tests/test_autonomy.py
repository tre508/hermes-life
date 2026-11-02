import time
from fastapi.testclient import TestClient
from hermes_life.app import create_app

class FakeAdapter:
    def available(self):return True
    def run(self,prompt,callback):
        callback('hermes.result',{'text':prompt})
        return {'result':prompt,'session_id':'fake'}

def test_opt_in_queue_execution_and_restart(tmp_path):
    db=tmp_path/'life.db'
    with TestClient(create_app(database=db,adapter=FakeAdapter())) as client:
        goal=client.post('/api/goals',json={'title':'Sample','prompt':'Finish this test','priority':65}).json()
        assert goal['state']=='pending'
        time.sleep(1.15)
        assert client.get(f"/api/goals").json()[0]['state']=='pending'
        assert client.put('/api/autonomy',json={'enabled':True}).status_code==200
        for _ in range(50):
            current=client.get('/api/goals').json()[0]
            if current['state']=='completed':break
            time.sleep(.1)
        assert current['state']=='completed',current
        # The adapter receives the persona/memory/report-augmented prompt, so the
        # goal text is contained in the stored result rather than ending it.
        result=client.get('/api/tasks/'+current['task_id']).json()['result']
        assert 'Finish this test' in result
        client.put('/api/autonomy',json={'enabled':False})
    with TestClient(create_app(database=db,adapter=FakeAdapter())) as restored:
        assert restored.get('/api/goals').json()[0]['state']=='completed'
        assert restored.get('/api/autonomy').json()['enabled']==False

def test_cancel_and_retry_controls(tmp_path):
    with TestClient(create_app(database=tmp_path/'db.sqlite',adapter=FakeAdapter())) as client:
        goal=client.post('/api/goals',json={'title':'Cancel me','prompt':'Nothing'}).json()
        assert client.post('/api/goals/'+goal['id']+'/cancel').json()['state']=='cancelled'
        assert client.post('/api/goals/'+goal['id']+'/retry').status_code==409
