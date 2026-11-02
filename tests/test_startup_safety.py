import os, subprocess, sys
from fastapi.testclient import TestClient
from hermes_life.store import Store
from hermes_life.schema import migrate
from hermes_life.app import create_app

class FakeAdapter:
    def available(self): return True
    def run(self, prompt, callback): return {'result': prompt, 'session_id': 'test'}

def test_import_does_not_open_or_modify_db(tmp_path):
    db=tmp_path/'life.db'
    store=Store(db); migrate(store.connection)
    task=store.create_task('test'); store.update_task(task['id'],'running')
    store.set_agent('executing', task['id'])
    subprocess.run([sys.executable,'-c','import hermes_life.app'],check=True,env={**os.environ,'HERMES_LIFE_DB':str(db)})
    assert store.task(task['id'])['state']=='running'
    assert store.agent()['state']=='executing'

def test_read_only_constructor_preserves_active_state(tmp_path):
    db=tmp_path/'life.db'
    store=Store(db); migrate(store.connection)
    task=store.create_task('test'); store.update_task(task['id'],'running')
    other=Store(db)
    assert other.task(task['id'])['state']=='running'

def test_owner_startup_recovers_only_on_lifespan(tmp_path):
    db=tmp_path/'life.db'
    store=Store(db); migrate(store.connection)
    task=store.create_task('test'); store.update_task(task['id'],'running')
    app=create_app(database=db,adapter=FakeAdapter())
    assert store.task(task['id'])['state']=='running'
    with TestClient(app) as client:
        assert client.get('/api/tasks/'+task['id']).json()['state']=='interrupted'
        assert client.get('/api/autonomy').json()['worker_running']
