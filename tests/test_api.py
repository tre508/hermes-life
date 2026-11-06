import time
from fastapi.testclient import TestClient
from hermes_life.app import create_app

class FakeAdapter:
    def available(self):
        return True
    def run(self, prompt, callback, task_id=None):
        callback('hermes.tool_use', {'name':'test_tool','input':{'prompt':prompt}})
        return {'result':'Test complete', 'session_id':'fake-session'}
    def cancel(self, task_id):
        return True

def test_task_lifecycle_and_restart(tmp_path):
    db = tmp_path / 'life.db'
    client = TestClient(create_app(database=db, adapter=FakeAdapter()))
    client.__enter__()
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
    client.__exit__(None,None,None)
    restored = TestClient(create_app(database=db,adapter=FakeAdapter()))
    restored.__enter__()
    assert restored.get(f'/api/tasks/{task_id}').json()['state']=='completed'
    assert len(restored.get('/api/events').json()) >= 3
    restored.__exit__(None,None,None)

def test_invalid_prompt(tmp_path):
    client = TestClient(create_app(database=tmp_path/'life.db', adapter=FakeAdapter()))
    client.__enter__()
    assert client.post('/api/tasks',json={'prompt':''}).status_code == 422
    client.__exit__(None,None,None)

def test_api_only_calls_engine_methods_that_exist():
    """Guard against route/engine drift: an orphaned call is a 500 at request time, not a
    test failure, so nothing else catches it (a removed ImplementationRevision.abandon did)."""
    import re
    from pathlib import Path
    from hermes_life.implementation import ImplementationEngine
    from hermes_life.implementation_revision import ImplementationRevision
    from hermes_life.implementation_review import ImplementationReview
    from hermes_life.verification import VerificationEngine

    source = Path(__file__).resolve().parent.parent / 'hermes_life' / 'app.py'
    text = source.read_text(encoding='utf-8')
    engines = {'revisions': ImplementationRevision, 'implementer': ImplementationEngine,
               'reviewer': ImplementationReview, 'verifier': VerificationEngine}
    missing = sorted(
        f'{name}.{attribute}'
        for name, engine in engines.items()
        for attribute in set(re.findall(rf'\b{name}\.([A-Za-z_][A-Za-z0-9_]*)', text))
        if not hasattr(engine, attribute))
    assert missing == [], f'app.py calls methods that no longer exist: {missing}'
