"""HL-FLOW-005: durable candidate review decisions and VM-only evidence.

No operation in this module applies files to a host or original VM project.
"""
from __future__ import annotations
import hashlib
import json
import shlex
import subprocess
import threading
from pathlib import Path

from .store import now

# Guest computes a bounded, stable snapshot of the *existing* experiment copies.
# Excluding .venv prevents the candidate's Python environment from polluting the diff.
SNAPSHOT_GUEST = r'''
import difflib,hashlib,json,pathlib,re,sys
x=json.load(sys.stdin)
ident=x.get('id','')
if not isinstance(ident,str) or not re.fullmatch(r'[0-9a-f-]{36}',ident):raise ValueError('Invalid run id')
root=pathlib.Path('/home/hermes/experiments').resolve(strict=True)
ignore={'.venv','.git','node_modules','__pycache__','.pytest_cache','.mypy_cache','.tox','.ruff_cache','dist','build'}
def collect(kind):
 directory=(root/(kind+'-'+ident)).resolve(strict=True)
 if directory.parent!=root or not directory.is_dir():raise ValueError('Invalid experiment directory')
 files={}; count=0
 for p in directory.rglob('*'):
  if any(part in ignore for part in p.relative_to(directory).parts):continue
  if p.is_symlink():continue
  if not p.is_file():continue
  rel=p.relative_to(directory).as_posix()
  count+=1
  if count>2000:raise ValueError('Too many workspace files')
  if p.stat().st_size>1024*1024:
   files[rel]=b'__LARGE__'+hashlib.sha256(p.read_bytes()).digest();continue
  files[rel]=p.read_bytes()
 return files
base=collect('baseline');cand=collect('candidate')
h=hashlib.sha256();diff=[];entries=[]
for name in sorted(set(base)|set(cand)):
 a=base.get(name);b=cand.get(name)
 h.update(name.encode());h.update(b'\x00');h.update(hashlib.sha256(b).digest() if b is not None else b'MISSING')
 if a==b:continue
 state='added' if name not in base else 'deleted' if name not in cand else 'modified'
 entries.append({'path':name,'change':state})
 if a is None or b is None or a.startswith(b'__LARGE__') or b.startswith(b'__LARGE__'):
  diff.append(f'[{state}] {name}: content excluded or too large')
  continue
 try:
  old=a.decode('utf-8').splitlines(keepends=True);new=b.decode('utf-8').splitlines(keepends=True)
 except UnicodeDecodeError:
  diff.append(f'[{state}] {name}: binary content')
  continue
 piece=''.join(difflib.unified_diff(old,new,fromfile='baseline/'+name,tofile='candidate/'+name))
 if len(piece)>24000:piece=piece[:24000]+'\n[DIFF TRUNCATED]\n'
 diff.append(piece)
output='\n'.join(diff)
print(json.dumps({'snapshot_sha256':h.hexdigest(),'files':entries[:300],
                  'diff':output[:100000], 'truncated':len(output)>100000,
                  'changed_files':len(entries)}))
'''

class ImplementationReview:
    def __init__(self, runtime, implementer):
        self.runtime = runtime
        self.implementer = implementer
        self.store = runtime.store
        self._lock = threading.Lock()
        self._migrate()

    def _migrate(self):
        with self.store.lock:
            self.store.connection.execute('''CREATE TABLE IF NOT EXISTS implementation_reviews (
                run_id TEXT PRIMARY KEY,
                decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected','revision_requested')),
                evidence_sha256 TEXT NOT NULL,
                criteria_json TEXT NOT NULL,
                feedback TEXT NOT NULL,
                decided_at TEXT NOT NULL,
                FOREIGN KEY(run_id) REFERENCES implementation_runs(id)
            )''')
            self.store.connection.commit()

    def _snapshot(self, ident):
        adapter = self.runtime.adapter
        if getattr(adapter, 'transport', None) != 'ssh':
            raise ValueError('VM SSH transport required')
        command = adapter._ssh_base() + ['python3 -c ' + shlex.quote(SNAPSHOT_GUEST)]
        p = subprocess.run(command, input=json.dumps({'id':ident}), text=True,
                           capture_output=True, timeout=60)
        if p.returncode:
            raise RuntimeError('VM review failed: ' + p.stderr[-500:])
        return json.loads(p.stdout)

    def get_decision(self, ident):
        with self.store.lock:
            row = self.store.connection.execute('SELECT * FROM implementation_reviews WHERE run_id=?', (ident,)).fetchone()
        return dict(row) if row else None

    def view(self, ident, include_diff=True):
        run = self.implementer.get(ident)
        if not run: raise KeyError('Implementation not found')
        with self.store.lock:
            plan = self.store.connection.execute('SELECT * FROM investigation_plans WHERE id=?', (run['plan_id'],)).fetchone()
        report = json.loads(plan['report']) if plan and plan['report'] else {}
        baseline = json.loads(run['baseline_json'] or '{}')
        candidate = json.loads(run['candidate_json'] or '{}')
        snapshot = self._snapshot(ident) if run['candidate_path'] and run['baseline_path'] else None
        if snapshot and not include_diff: snapshot.pop('diff', None)
        return {'run':run,'plan':{'id':run['plan_id'], 'state':plan['state'] if plan else None,
                'summary':report.get('summary',''), 'steps':report.get('steps',[]),
                'acceptance_criteria':report.get('acceptance_criteria',[])},
                'baseline':baseline,'candidate':candidate,'snapshot':snapshot,
                'decision':self.get_decision(ident)}

    def decide(self, ident, decision, sha256, criteria, feedback):
        if decision not in ('accepted','rejected','revision_requested'):
            raise ValueError('Invalid review decision')
        if not isinstance(feedback,str) or len(feedback)>8000: raise ValueError('Invalid feedback')
        if not isinstance(criteria,list) or len(criteria)>100 or any(type(v) is not bool for v in criteria):
            raise ValueError('Criteria must be a list of booleans')
        with self._lock:
            # Never re-decide: every decision is an immutable record.
            if self.get_decision(ident): raise ValueError('Run has already been adjudicated')
            view = self.view(ident)
            actual = view['snapshot']
            if not actual or actual['snapshot_sha256'] != sha256:
                raise ValueError('Candidate has changed since review; reopen review')
            expected = view['plan']['acceptance_criteria']
            if len(criteria)!=len(expected): raise ValueError('Review all acceptance criteria')
            if decision=='accepted' and not expected: raise ValueError('Cannot accept a plan with no acceptance criteria')
            if decision=='accepted':
                if view['run']['state']!='candidate_passed':
                    raise ValueError('Candidate must pass independent evaluation before acceptance')
                if not all(criteria): raise ValueError('Every acceptance criterion must be confirmed')
            with self.store.lock:
                self.store.connection.execute('''INSERT INTO implementation_reviews
                    (run_id,decision,evidence_sha256,criteria_json,feedback,decided_at)
                    VALUES (?,?,?,?,?,?)''', (ident,decision,sha256,json.dumps(criteria),feedback,now()))
                self.store.connection.commit()
            self.store.emit('implementation.review_decided', {'run_id':ident,'decision':decision})
            mirrored = self._mirror(ident,decision,view,criteria,feedback)
            return {'run_id':ident,'decision':decision,'decided_at':now(),
                    'memory_mirrored':mirrored,'host_modified':False,
                    'next_action':'Review accepted candidate for separate application' if decision=='accepted' else
                                  'Revision requested; candidate is not automatically rewritten' if decision=='revision_requested' else
                                  'Candidate rejected; no application performed'}

    def _mirror(self, ident, decision, view, criteria, feedback):
        # Durable SQLite decision is authoritative; Obsidian receives a mirror.
        vault = getattr(getattr(self.runtime,'vault_memory',None),'vault',None)
        if not vault or not Path(vault).is_dir(): return False
        folder = Path(vault)/'Hermes-Life'/'Memory'/'Development-Reviews'
        try:
            folder.mkdir(parents=True,exist_ok=True)
            path=folder/(ident+'.md')
            report = view['plan']
            lines=[f'# Candidate review: {ident}', '',f'- Decision: **{decision}**',
                   f'- Project: `{view["run"]["project"]}`',f'- Plan: `{report["id"]}`',
                   f'- Snapshot SHA-256: `{view["snapshot"]["snapshot_sha256"]}`',
                   f'- Candidate test status: {view["candidate"].get("status","unknown")}',
                   f'- Baseline test status: {view["baseline"].get("status","unknown")}',
                   '', '## Acceptance criteria']
            lines += [f'- [{"x" if ok else " "}] {str(text)}' for text,ok in zip(report['acceptance_criteria'], criteria)]
            lines += ['', '## Reviewer feedback',feedback or '(none)', '',
                      'This record is an outcome review, not permission to deploy or apply host changes.','']
            path.write_text('\n'.join(lines),encoding='utf-8')
            return True
        except OSError as exc:
            self.store.emit('implementation.review_mirror_failed', {'run_id':ident,'error':str(exc)[:200]})
            return False
