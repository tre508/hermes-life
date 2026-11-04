"""HL-FLOW-006 — queued, bounded, isolated candidate revision attempts.

A revision request is an explicit human decision. Its queued execution is automatic.
Changes remain in the experiment VM. Nothing applies to original projects or host.
"""
from __future__ import annotations
import json
import re
import shlex
import subprocess
import threading
import time
from uuid import uuid4

from .guest_env import ENV_RESOLVER
from .store import now

# Fixed operations executed by the VM's Python; model text never becomes shell source.
# FLOW-007A: interpreter resolution comes from guest_env, so a revision tests with the
# run's platform environment and never with a workspace the agent just created.
REVISION_GUEST = ENV_RESOLVER + r'''
import json,pathlib,re,shutil,subprocess,sys
x=json.load(sys.stdin)
root=pathlib.Path('/home/hermes/experiments').resolve(strict=True)
ident=x.get('id'); attempt=x.get('attempt')
if not isinstance(ident,str) or not re.fullmatch(r'[0-9a-f-]{36}',ident):raise ValueError('Invalid run ID')
if not isinstance(attempt,str) or not re.fullmatch(r'[0-9a-f-]{36}',attempt):raise ValueError('Invalid attempt ID')
candidate=root/('candidate-'+ident)
staging=root/('revision-'+attempt)
backup=root/('revision-backup-'+attempt)
for p in (candidate,staging,backup):
 if p.is_symlink() or p.parent!=root:raise ValueError('Invalid experiment path')
op=x.get('operation')
if op=='prepare':
 if not candidate.is_dir() or staging.exists() or backup.exists():raise ValueError('Missing candidate or existing revision')
 shutil.copytree(candidate,staging,symlinks=False,ignore=shutil.ignore_patterns('.venv','.git','node_modules','__pycache__','.pytest_cache','.mypy_cache'))
 print(json.dumps({'path':str(staging)}))
elif op=='test':
 if not staging.is_dir() or not candidate.is_dir():raise ValueError('Missing revision workspace')
 python,env_source=resolve_interpreter(str(environment_path(ident)),str(candidate/'.venv'))
 cmd=[python,'-m','pytest','-q']
 try:
  r=subprocess.run(cmd,cwd=staging,text=True,capture_output=True,timeout=120,env=runtime_env())
  output=(r.stdout+'\n'+r.stderr)[-12000:]
  status='passed' if r.returncode==0 else 'evaluation_error' if (r.returncode in (2,3,4,5) or 'No module named pytest' in output) else 'failed'
  print(json.dumps({'status':status,'exit_code':r.returncode,'output':output,'python':python,'command':cmd,'env_source':env_source}))
 except (OSError,subprocess.TimeoutExpired) as e:
  print(json.dumps({'status':'evaluation_error','exit_code':None,'output':str(e),'python':python,'command':cmd,'env_source':env_source}))
elif op=='promote':
 if not staging.is_dir() or not candidate.is_dir() or backup.exists():raise ValueError('Invalid promotion workspace')
 # Preserve the old candidate until independent evaluation and review archival commit.
 candidate.rename(backup)
 try:
  staging.rename(candidate)
  oldvenv=backup/'.venv'
  if oldvenv.is_dir() and not (candidate/'.venv').exists():shutil.move(str(oldvenv),str(candidate/'.venv'))
 except Exception:
  if candidate.is_dir():
   if (candidate/'.venv').exists() and not (backup/'.venv').exists():shutil.move(str(candidate/'.venv'),str(backup/'.venv'))
   candidate.rename(staging) if not staging.exists() else shutil.rmtree(candidate)
  backup.rename(candidate)
  raise
 print(json.dumps({'candidate':str(candidate),'backup':str(backup)}))
elif op=='rollback':
 # Idempotent. An interrupted promotion may leave only a backup or both folders.
 if not backup.is_dir():
  if not candidate.is_dir():raise ValueError('Cannot recover: no candidate or backup')
  print(json.dumps({'rolled_back':False,'reason':'original candidate present; no backup'}))
 else:
  failed=root/('revision-failed-'+attempt)
  if failed.exists():raise ValueError('Recovery destination already exists')
  if candidate.is_dir():
   oldvenv=candidate/'.venv'
   if oldvenv.exists() and not (backup/'.venv').exists():shutil.move(str(oldvenv),str(backup/'.venv'))
   candidate.rename(failed)
  try:backup.rename(candidate)
  except Exception:
   if failed.is_dir() and not candidate.exists():failed.rename(candidate)
   raise
  print(json.dumps({'rolled_back':True,'restored':str(candidate),'failed_revision':str(failed) if failed.exists() else None}))
else:raise ValueError('Invalid revision operation')
'''

class ImplementationRevision:
    MAX_ATTEMPTS=3
    def __init__(self, runtime, implementer, reviewer):
        self.runtime,self.implementer,self.reviewer=runtime,implementer,reviewer
        self.store=runtime.store
        self._wake=threading.Event()
        self._stop=threading.Event()
        self._thread=None
        self._migrate()

    def _migrate(self):
        with self.store.lock:
            self.store.connection.execute('''CREATE TABLE IF NOT EXISTS implementation_revisions (
                id TEXT PRIMARY KEY, run_id TEXT NOT NULL, attempt INTEGER NOT NULL,
                state TEXT NOT NULL, feedback TEXT NOT NULL, snapshot_sha256 TEXT NOT NULL,
                staging_path TEXT, response TEXT, test_json TEXT, error TEXT, original_run_json TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                UNIQUE(run_id,attempt), FOREIGN KEY(run_id) REFERENCES implementation_runs(id))''')
            self.store.connection.execute('''CREATE TABLE IF NOT EXISTS implementation_review_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
                decision TEXT NOT NULL, evidence_sha256 TEXT NOT NULL,
                criteria_json TEXT NOT NULL, feedback TEXT NOT NULL,
                decided_at TEXT NOT NULL, archived_at TEXT NOT NULL)''')
            cols={r[1] for r in self.store.connection.execute('PRAGMA table_info(implementation_revisions)')}
            if 'original_run_json' not in cols:
                self.store.connection.execute('ALTER TABLE implementation_revisions ADD COLUMN original_run_json TEXT')
            self.store.connection.commit()

    def list(self, run_id):
        if not self.implementer.get(run_id):raise KeyError('Implementation not found')
        with self.store.lock:
            attempts=[dict(r) for r in self.store.connection.execute(
                'SELECT * FROM implementation_revisions WHERE run_id=? ORDER BY attempt DESC',(run_id,))]
            history=[dict(r) for r in self.store.connection.execute(
                'SELECT * FROM implementation_review_history WHERE run_id=? ORDER BY id DESC',(run_id,))]
        return {'attempts':attempts,'review_history':history}

    def _archive_request(self, run_id, expected_decided_at=None):
        # Atomically release immutable review so a human can adjudicate again.
        with self.store.lock:
            row=self.store.connection.execute(
                "SELECT * FROM implementation_reviews WHERE run_id=? AND decision='revision_requested'",(run_id,)).fetchone()
            if not row or (expected_decided_at and row['decided_at']!=expected_decided_at):
                return False
            self.store.connection.execute('''INSERT INTO implementation_review_history
                (run_id,decision,evidence_sha256,criteria_json,feedback,decided_at,archived_at)
                VALUES (?,?,?,?,?,?,?)''',(row['run_id'],row['decision'],row['evidence_sha256'],
                   row['criteria_json'],row['feedback'],row['decided_at'],now()))
            self.store.connection.execute('DELETE FROM implementation_reviews WHERE run_id=?',(run_id,))
            self.store.connection.commit()
        self.store.emit('implementation.revision_review_reopened',{'run_id':run_id,'reason':'attempts_exhausted'})
        return True

    def _close_if_exhausted(self, run_id):
        review=self.reviewer.get_decision(run_id)
        if not review or review['decision']!='revision_requested':return
        with self.store.lock:
            count=self.store.connection.execute(
                'SELECT COUNT(*) FROM implementation_revisions WHERE run_id=? AND created_at>=?',
                (run_id,review['decided_at'])).fetchone()[0]
        if count>=self.MAX_ATTEMPTS:
            self._archive_request(run_id,review['decided_at'])

    def queue(self, run_id):
        # Queue an attempt, bounded per human review decision.
        run=self.implementer.get(run_id)
        if run is None:raise KeyError('Implementation not found')
        review=self.reviewer.get_decision(run_id)
        if not review or review['decision']!='revision_requested':raise ValueError('Revision requires a recorded request')
        with self.store.lock:
            latest=self.store.connection.execute(
                'SELECT * FROM implementation_revisions WHERE run_id=? AND created_at>=? ORDER BY attempt DESC LIMIT 1',
                (run_id,review['decided_at'])).fetchone()
            if latest and latest['state'] in ('queued','running','promoting','verifying','rollback_pending','passed'):
                self._wake.set();return dict(latest)
            if latest and latest['state'] in ('interrupted','recovery_required'):
                raise ValueError('Interrupted promotion requires recovery before retry')
            count=self.store.connection.execute(
                'SELECT COUNT(*) FROM implementation_revisions WHERE run_id=? AND created_at>=?',
                (run_id,review['decided_at'])).fetchone()[0]
            if count>=self.MAX_ATTEMPTS:
                # Historical installations can be exhausted without having closed the review.
                exhausted=True
            else:
                exhausted=False
                global_latest=self.store.connection.execute(
                    'SELECT COALESCE(MAX(attempt),0) FROM implementation_revisions WHERE run_id=?',(run_id,)).fetchone()[0]
                attempt=global_latest+1
                ident=str(uuid4());stamp=now()
                self.store.connection.execute('''INSERT INTO implementation_revisions
                  (id,run_id,attempt,state,feedback,snapshot_sha256,created_at,updated_at)
                  VALUES (?,?,?,?,?,?,?,?)''',(ident,run_id,attempt,'queued',review['feedback'],review['evidence_sha256'],stamp,stamp))
                self.store.connection.commit()
        if exhausted:
            self._archive_request(run_id, review['decided_at'])
            raise ValueError('Three attempts exhausted; review reopened for rejection or a new explicit revision request')
        self.store.emit('implementation.revision_queued',{'run_id':run_id,'attempt_id':ident,'attempt':attempt})
        self._wake.set()
        return self.list(run_id)['attempts'][0]

    def start(self):
        if self._thread and self._thread.is_alive():return
        # Interrupted in-flight runs must not be executed twice after restart.
        with self.store.lock:
            self.store.connection.execute("UPDATE implementation_revisions SET state='interrupted',updated_at=? WHERE state='running'",(now(),))
            self.store.connection.execute("UPDATE implementation_revisions SET state='rollback_pending',updated_at=? WHERE state IN ('promoting','verifying')",(now(),))
            self.store.connection.commit()
            pending=self.store.connection.execute("SELECT run_id FROM implementation_reviews WHERE decision='revision_requested'").fetchall()
        for r in pending:
            with self.store.lock:
                prior=self.store.connection.execute(
                    'SELECT 1 FROM implementation_revisions WHERE run_id=? LIMIT 1',
                    (r['run_id'],)).fetchone()
            # Recover missing enqueue after a durable review, not a failed attempt.
            # A failed attempt must be retried explicitly by the reviewer.
            if prior:continue
            try:self.queue(r['run_id'])
            except (ValueError,KeyError):pass
        self._stop.clear()
        # Recover unfinished promotion before allowing retries or additional work.
        with self.store.lock:
            pending_recovery=[dict(r) for r in self.store.connection.execute(
                "SELECT * FROM implementation_revisions WHERE state='rollback_pending'")]
        for item in pending_recovery:
            self._recover(item,'Backend restarted during candidate promotion')
        self._thread=threading.Thread(target=self._loop,name='hermes-revision-worker',daemon=True)
        self._thread.start();self._wake.set()

    def stop(self):
        self._stop.set();self._wake.set()
        if self._thread and self._thread.is_alive():self._thread.join(timeout=2)

    def _update(self, ident, state, **fields):
        allowed={'staging_path','response','test_json','error','original_run_json'}
        values={k:v for k,v in fields.items() if k in allowed}
        with self.store.lock:
            self.store.connection.execute('UPDATE implementation_revisions SET state=?, updated_at=?'+
                ''.join(', '+k+'=?' for k in values)+' WHERE id=?',
                [state,now(),*values.values(),ident])
            self.store.connection.commit()

    def _guest(self, payload):
        adapter=self.runtime.adapter
        if getattr(adapter,'transport',None)!='ssh':raise ValueError('SSH VM transport required')
        proc=subprocess.run(adapter._ssh_base()+['python3 -c '+shlex.quote(REVISION_GUEST)],
            input=json.dumps(payload),capture_output=True,text=True,timeout=150)
        if proc.returncode:raise RuntimeError('Guest operation failed: '+proc.stderr[-1000:])
        return json.loads(proc.stdout)

    def _loop(self):
        while not self._stop.is_set():
            with self.store.lock:
                item=self.store.connection.execute("SELECT * FROM implementation_revisions WHERE state='queued' ORDER BY created_at LIMIT 1").fetchone()
                item=dict(item) if item else None
            if not item:
                self._wake.wait(3);self._wake.clear();continue
            if not self.implementer.lock.acquire(blocking=False):
                self._stop.wait(1);continue
            if not self.runtime.active.acquire(blocking=False):
                self.implementer.lock.release();self._stop.wait(1);continue
            try:self._execute(item)
            finally:
                self.runtime.active.release()
                self.implementer.lock.release()

    def _restore_run(self, item):
        previous=json.loads(item['original_run_json'] or '{}')
        if not previous:return
        fields=('state','baseline_json','candidate_json','error')
        with self.store.lock:
            self.store.connection.execute('''UPDATE implementation_runs SET
                state=?,baseline_json=?,candidate_json=?,error=?,updated_at=? WHERE id=?''',
                [previous.get(k) for k in fields]+[now(),item['run_id']])
            self.store.connection.commit()

    def _recover(self, item, explanation):
        # Restore VM candidate and pre-promotion run state on recoverable faults.
        ident=item['id']
        self._update(ident,'rollback_pending',error=explanation[:2000])
        try:
            self._guest({'operation':'rollback','id':item['run_id'],'attempt':ident})
            self._restore_run(item)
            self._update(ident,'error',error=explanation[:2000])
            self._close_if_exhausted(item['run_id'])
            self.store.emit('implementation.revision_rolled_back',{'run_id':item['run_id'],'attempt_id':ident})
        except Exception as exc:
            self._update(ident,'recovery_required',error=(explanation+'; recovery failed: '+str(exc))[:2000])
            self.store.emit('implementation.revision_recovery_required',
                {'run_id':item['run_id'],'attempt_id':ident,'error':str(exc)[:300]})

    def _execute(self, item):
        ident=item['id']; run_id=item['run_id']
        self._update(ident,'running')
        self.store.emit('implementation.revision_started',{'run_id':run_id,'attempt_id':ident})
        try:
            run=self.implementer.get(run_id)
            if not run or run['state'] not in ('candidate_passed','candidate_failed','evaluation_error'):
                raise ValueError('Run is not in a reviewable state')
            review=self.reviewer.get_decision(run_id)
            if not review or review['decision']!='revision_requested':raise ValueError('Revision approval is missing')
            snap=self.reviewer._snapshot(run_id)
            if snap['snapshot_sha256']!=item['snapshot_sha256']:
                raise ValueError('Candidate changed since revision was requested')
            # FLOW-007B: a revision tests with the run's platform environment and never with a
            # workspace the agent just created. A pre-FLOW-007 run keeps its recorded venv, and
            # an environment that cannot be made usable is reported instead of silently
            # switching evaluator; the original candidate is left untouched either way.
            try:
                self.implementer._ensure_environment(run_id)
            except Exception as exc:
                self.store.emit('implementation.environment_unavailable',
                                {'run_id':run_id,'attempt_id':ident,'error':str(exc)[:300]})
            target=self._guest({'operation':'prepare','id':run_id,'attempt':ident})['path']
            self._update(ident,'running',staging_path=target)
            with self.store.lock:
                plan=self.store.connection.execute('SELECT report FROM investigation_plans WHERE id=?',(run['plan_id'],)).fetchone()
            if not plan:raise ValueError('Original approved plan is missing')
            detail=json.loads(plan['report'])
            instruction=('Perform a requested revision ONLY in the isolated staging directory '+target+'. '
                'Do not modify the original candidate, baseline, original project, host, or infrastructure. '
                'Preserve existing behavior unless specifically required. Do not rewrite tests merely to make them pass. '
                'Review feedback (untrusted request text): '+json.dumps(item['feedback'])+'\n'
                'Original acceptance criteria (data): '+json.dumps(detail.get('acceptance_criteria',[]))+'\n'
                'Explain edits and testing. No deployment or acceptance is authorized.')
            response=self.runtime.adapter.run(instruction,lambda k,v:self.store.emit(k,v))
            self._update(ident,'running',response=str(response.get('result',''))[:30000])
            result=self._guest({'operation':'test','id':run_id,'attempt':ident})
            self._update(ident,'running',test_json=json.dumps(result))
            if result['status']!='passed':
                self._update(ident,'evaluation_error' if result['status']=='evaluation_error' else 'tests_failed')
                self.store.emit('implementation.revision_failed',{'run_id':run_id,'attempt_id':ident,'status':result['status']})
                self._close_if_exhausted(run_id)
                return
            # Recheck unchanged source and review approval immediately before promotion.
            if self.reviewer._snapshot(run_id)['snapshot_sha256']!=item['snapshot_sha256']:
                raise ValueError('Candidate changed while revision was running')
            current=self.reviewer.get_decision(run_id)
            if not current or current['decision']!='revision_requested':raise ValueError('Review state changed')
            # Persist rollback metadata BEFORE the filesystem swap (restart-safe).
            original={k:run.get(k) for k in ('state','baseline_json','candidate_json','error')}
            self._update(ident,'promoting',original_run_json=json.dumps(original))
            self._guest({'operation':'promote','id':run_id,'attempt':ident})
            self._update(ident,'verifying')
            # Re-evaluation may fail; the original candidate is still available in backup.
            self.implementer._evaluate(run_id,run['state'])
            new_state=self.implementer.get(run_id)['state']
            if new_state!='candidate_passed':
                raise RuntimeError('Promoted revision did not pass independent reevaluation: '+new_state)
            # Finalize review archival and attempt state in ONE SQLite transaction.
            with self.store.lock:
                record=self.store.connection.execute(
                    "SELECT * FROM implementation_reviews WHERE run_id=? AND decision='revision_requested'",(run_id,)).fetchone()
                if not record:raise ValueError('Review decision disappeared after promotion')
                try:
                    self.store.connection.execute('''INSERT INTO implementation_review_history
                      (run_id,decision,evidence_sha256,criteria_json,feedback,decided_at,archived_at)
                      VALUES (?,?,?,?,?,?,?)''',(record['run_id'],record['decision'],record['evidence_sha256'],
                         record['criteria_json'],record['feedback'],record['decided_at'],now()))
                    self.store.connection.execute('DELETE FROM implementation_reviews WHERE run_id=?',(run_id,))
                    self.store.connection.execute('UPDATE implementation_revisions SET state=?,updated_at=? WHERE id=?',
                        ('passed',now(),ident))
                    self.store.connection.commit()
                except Exception:
                    self.store.connection.rollback()
                    raise
            self.store.emit('implementation.revision_completed',{'run_id':run_id,'attempt_id':ident,'state':new_state})
        except Exception as exc:
            with self.store.lock:
                current=self.store.connection.execute('SELECT * FROM implementation_revisions WHERE id=?',(ident,)).fetchone()
                current=dict(current) if current else item
            if current['state'] in ('promoting','verifying','rollback_pending'):
                self._recover(current,str(exc))
            else:
                self._update(ident,'error',error=str(exc)[:2000])
                self._close_if_exhausted(run_id)
            self.store.emit('implementation.revision_failed',{'run_id':run_id,'attempt_id':ident,'error':str(exc)[:300]})
