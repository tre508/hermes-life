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
          CREATE TABLE implementation_runs(id TEXT PRIMARY KEY,plan_id TEXT,project TEXT,state TEXT, baseline_json TEXT, candidate_json TEXT, error TEXT, updated_at TEXT);
          CREATE TABLE investigation_plans(id TEXT PRIMARY KEY,report TEXT);
          CREATE TABLE implementation_reviews(run_id TEXT PRIMARY KEY,decision TEXT,
              evidence_sha256 TEXT,criteria_json TEXT,feedback TEXT,decided_at TEXT);
          INSERT INTO implementation_runs (id,plan_id,project,state) VALUES ('run','plan','demo','candidate_failed');
          INSERT INTO investigation_plans VALUES ('plan','{"acceptance_criteria":["sample behavior"]}');
          INSERT INTO implementation_reviews VALUES ('run','revision_requested','abc','[false]','Fix broken test','2020-01-01T00:00:00+00:00');
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

def test_post_promotion_evaluation_failure_restores_original_and_reopens_retry(env):
    worker,store,engine,_=env
    calls=[]
    def guest(x):
        calls.append(x['operation'])
        if x['operation']=='prepare':return {'path':'/vm/revision'}
        if x['operation']=='test':return {'status':'passed','exit_code':0,'output':'3 passed'}
        return {'rolled_back':True} if x['operation']=='rollback' else {'candidate':'/vm/candidate'}
    worker._guest=guest
    engine._evaluate.side_effect=RuntimeError('evaluator lost connection')
    row=worker.queue('run')
    worker._execute(row)
    assert calls[-2:]==['promote','rollback']
    assert worker.list('run')['attempts'][0]['state']=='error'
    assert worker.list('run')['attempts'][0]['original_run_json']
    assert store.connection.execute("SELECT decision FROM implementation_reviews WHERE run_id='run'").fetchone()['decision']=='revision_requested'
    assert store.connection.execute("SELECT state FROM implementation_runs WHERE id='run'").fetchone()['state']=='candidate_failed'
    assert worker.queue('run')['attempt']==2


def test_three_failures_reopen_review_for_new_decision(env):
    worker,store,engine,_=env
    worker._guest=lambda x:({'path':'/vm/revision'} if x['operation']=='prepare' else
       {'status':'failed','exit_code':1,'output':'tests failed'} if x['operation']=='test' else {})
    for i in range(1,4):
        row=worker.queue('run')
        assert row['attempt']==i
        worker._execute(row)
    assert store.connection.execute('SELECT * FROM implementation_reviews WHERE run_id="run"').fetchone() is None
    assert len(worker.list('run')['review_history'])==1
    # The reviewer may now reject the candidate or explicitly request a NEW three-attempt cycle.
    store.connection.execute("INSERT INTO implementation_reviews VALUES ('run','rejected','abc','[false]','No further work','2030-01-01T00:00:00+00:00')")
    store.connection.commit()
    assert store.connection.execute('SELECT decision FROM implementation_reviews').fetchone()['decision']=='rejected'


def test_review_archive_error_rolls_back_promotion(env):
    worker,store,engine,_=env
    calls=[]
    worker._guest=lambda x:(calls.append(x['operation']) or
        ({'path':'/vm/revision'} if x['operation']=='prepare' else
         {'status':'passed','exit_code':0} if x['operation']=='test' else
         {'candidate':'/vm/candidate'}))
    store.connection.execute('''CREATE TRIGGER block_archive BEFORE INSERT ON implementation_review_history
        BEGIN SELECT RAISE(ABORT, 'injected archive failure'); END;''')
    row=worker.queue('run')
    worker._execute(row)
    assert calls[-1]=='rollback'
    assert worker.list('run')['attempts'][0]['state']=='error'
    assert store.connection.execute('SELECT decision FROM implementation_reviews').fetchone()['decision']=='revision_requested'
