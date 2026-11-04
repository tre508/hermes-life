"""HL-FLOW-006 isolated regression tests, with a fake VM and real SQLite records."""
import sqlite3
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from hermes_life.implementation_revision import ImplementationRevision

class Store:
    def __init__(self):
        self.connection=sqlite3.connect(':memory:',check_same_thread=False)
        self.connection.row_factory=sqlite3.Row
        self.lock=threading.RLock()
        self.events=[]
        self.connection.executescript('''
          CREATE TABLE implementation_runs(id TEXT PRIMARY KEY,plan_id TEXT,project TEXT,state TEXT);
          CREATE TABLE investigation_plans(id TEXT PRIMARY KEY,report TEXT);
          CREATE TABLE implementation_reviews(run_id TEXT PRIMARY KEY,decision TEXT,
              evidence_sha256 TEXT,criteria_json TEXT,feedback TEXT,decided_at TEXT);
          INSERT INTO implementation_runs VALUES ('run','plan','demo','candidate_failed');
          INSERT INTO investigation_plans VALUES ('plan','{"acceptance_criteria":["sample behavior"]}');
          INSERT INTO implementation_reviews VALUES ('run','revision_requested','abc','[false]','Fix broken test','yesterday');
        ''')
    def emit(self,*args):self.events.append(args)

@pytest.fixture
def env():
    store=Store()
    adapter=SimpleNamespace(run=lambda prompt, cb:{'result':'Fixed it'})
    runtime=SimpleNamespace(store=store,adapter=adapter,active=threading.Lock())
    engine=Mock()
    engine.lock=threading.Lock()
    engine.get.side_effect=lambda _:dict(store.connection.execute('SELECT * FROM implementation_runs WHERE id="run"').fetchone())
    engine._evaluate.side_effect=lambda ident,prev:store.connection.execute("UPDATE implementation_runs SET state='candidate_passed' WHERE id='run'") or store.connection.commit()
    reviewer=Mock()
    reviewer.get_decision.side_effect=lambda _:dict(store.connection.execute('SELECT * FROM implementation_reviews WHERE run_id="run"').fetchone()) if store.connection.execute('SELECT * FROM implementation_reviews WHERE run_id="run"').fetchone() else None
    reviewer._snapshot.return_value={'snapshot_sha256':'abc'}
    worker=ImplementationRevision(runtime,engine,reviewer)
    return worker,store,engine,reviewer

def test_revision_queue_is_idempotent(env):
    worker,store,*_=env
    first=worker.queue('run')
    assert first['state']=='queued'
    second=worker.queue('run')
    assert first['id']==second['id']
    assert len(worker.list('run')['attempts'])==1

def test_success_reopens_review_and_retains_history(env):
    worker,store,engine,_=env
    worker._guest=lambda x:({'path':'/vm/revision'} if x['operation']=='prepare' else
        {'status':'passed','exit_code':0,'output':'3 passed'} if x['operation']=='test' else
        {'candidate':'/vm/candidate'})
    row=worker.queue('run')
    worker._execute(row)
    assert worker.list('run')['attempts'][0]['state']=='passed'
    assert worker.list('run')['review_history'][0]['decision']=='revision_requested'
    assert store.connection.execute('SELECT 1 FROM implementation_reviews').fetchone() is None
    assert engine._evaluate.call_count==1

def test_failed_tests_preserve_review_and_allow_retry(env):
    worker,store,engine,_=env
    worker._guest=lambda x:({'path':'/vm/revision'} if x['operation']=='prepare' else
       {'status':'failed','exit_code':1,'output':'2 failed'} if x['operation']=='test' else None)
    worker._execute(worker.queue('run'))
    assert worker.list('run')['attempts'][0]['state']=='tests_failed'
    assert store.connection.execute('SELECT decision FROM implementation_reviews').fetchone()['decision']=='revision_requested'
    assert worker.queue('run')['attempt']==2
    engine._evaluate.assert_not_called()

def test_changed_candidate_blocks_revision(env):
    worker,_,engine,reviewer=env
    reviewer._snapshot.return_value={'snapshot_sha256':'changed'}
    worker._execute(worker.queue('run'))
    assert worker.list('run')['attempts'][0]['state']=='error'
    assert 'Candidate changed' in worker.list('run')['attempts'][0]['error']
    engine._evaluate.assert_not_called()
