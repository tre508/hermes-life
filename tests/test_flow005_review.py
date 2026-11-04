"""HL-FLOW-005: durable, idempotent review decisions; no host application."""
import json
import sqlite3
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from hermes_life.implementation_review import ImplementationReview


class Store:
    def __init__(self):
        self.connection=sqlite3.connect(':memory:',check_same_thread=False)
        self.connection.row_factory=sqlite3.Row
        self.lock=threading.RLock()
        self.events=[]
        self.connection.executescript('''
          CREATE TABLE implementation_runs(id TEXT PRIMARY KEY, plan_id TEXT, project TEXT,
              state TEXT, candidate_path TEXT, baseline_path TEXT,
              baseline_json TEXT, candidate_json TEXT, response TEXT);
          CREATE TABLE investigation_plans(id TEXT PRIMARY KEY, state TEXT, report TEXT);
        ''')
        self.connection.execute('INSERT INTO investigation_plans VALUES (?,?,?)',
           ('plan','approved',json.dumps({'summary':'Test','acceptance_criteria':['Output unchanged']})))
        self.connection.execute('INSERT INTO implementation_runs VALUES (?,?,?,?,?,?,?,?,?)',
           ('run','plan','demo','candidate_passed','/vm/candidate','/vm/baseline',
            json.dumps({'status':'evaluation_error'}),json.dumps({'status':'passed'}),'ok'))
        self.connection.commit()
    def emit(self,*args):self.events.append(args)

@pytest.fixture
def reviewer(tmp_path):
    store=Store()
    runtime=SimpleNamespace(store=store,vault_memory=SimpleNamespace(vault=tmp_path))
    engine=Mock()
    engine.get.side_effect=lambda ident:dict(store.connection.execute('SELECT * FROM implementation_runs WHERE id=?',(ident,)).fetchone()) if ident=='run' else None
    obj=ImplementationReview(runtime,engine)
    obj._snapshot=lambda ident:{'snapshot_sha256':'abc','changed_files':1,'files':[{'path':'main.py','change':'modified'}],'diff':'--- old\n+++ new'}
    return obj

def test_review_keeps_evidence_and_requires_all_criteria(reviewer):
    data=reviewer.view('run')
    assert data['baseline']['status']=='evaluation_error'
    assert data['candidate']['status']=='passed'
    with pytest.raises(ValueError,match='criterion'):
        reviewer.decide('run','accepted','abc',[False],'')
    with pytest.raises(ValueError,match='changed'):
        reviewer.decide('run','accepted','outdated',[True],'')
    out=reviewer.decide('run','accepted','abc',[True],'Output verified independently')
    assert out['decision']=='accepted' and out['host_modified'] is False
    assert reviewer.get_decision('run')['criteria_json']=='[true]'
    with pytest.raises(ValueError,match='already'):
        reviewer.decide('run','rejected','abc',[False],'Changed my mind')

def test_rejection_preserves_source_and_mirrors_to_vault(reviewer):
    result=reviewer.decide('run','rejected','abc',[False],'Needs more evidence')
    assert result['memory_mirrored'] is True
    vault=reviewer.runtime.vault_memory.vault
    note=vault/'Hermes-Life'/'Memory'/'Development-Reviews'/'run.md'
    assert 'Needs more evidence' in note.read_text()
    assert reviewer.implementer.get('run')['state']=='candidate_passed'

def test_missing_and_unready_not_accepted(reviewer):
    with pytest.raises(KeyError):reviewer.view('missing')
    reviewer.store.connection.execute("UPDATE implementation_runs SET state='candidate_failed' WHERE id='run'")
    reviewer.store.connection.commit()
    with pytest.raises(ValueError,match='pass independent'):
        reviewer.decide('run','accepted','abc',[True],'')
