"""HL-VERIFY-001: independent acceptance verification for candidate runs.

The evaluator already runs the project's tests. This module answers the *other* question:
does the candidate satisfy the approved plan's acceptance criteria? It does that by
executing its own checks in the VM and recording raw evidence (command, exit code, output
hash, environment) for every criterion.

Two rules hold throughout:

* Nothing the coding agent *says* is evidence. ``implementation_runs.response`` is stored
  as a claim and can never mark a criterion passed.
* The check vocabulary is closed. A compiled check names a kind and parameters; the guest
  builds the command itself, so neither the plan text nor the agent can inject one.
"""
import json
import re
import shlex
import subprocess
import threading
from uuid import uuid4

from typing import TYPE_CHECKING

from .guest_env import ENV_RESOLVER, for_worker
from .store import now

if TYPE_CHECKING:
    from .implementation_revision import ImplementationRevision

#: Kinds the guest can execute deterministically. 'interpretive' has no deterministic
#: check and is the only kind a language model may judge.
CHECK_KINDS = ('pytest', 'file_read', 'file_contains', 'search', 'json_object',
               'sqlite_table', 'git_state', 'byte_count', 'interpretive')
ROOTS = ('candidate', 'baseline', 'project')
DELIVERABLE_CLASSES = ('code_change', 'evidence_report', 'docs_only')
VERDICTS = ('passed', 'failed', 'unverified', 'not_applicable')
DISPOSITIONS = ('verified', 'failed', 'insufficient_evidence', 'blocked')

#: Runs inside the VM. Read-only apart from the fixed pytest invocation.
VERIFY_GUEST = for_worker(ENV_RESOLVER + r'''
import hashlib,json,pathlib,re,subprocess,sys,time

EXPERIMENTS=pathlib.Path('/home/hermes/experiments').resolve()
PROJECTS=pathlib.Path('/home/hermes/projects').resolve()
IGNORE={'.git','.venv','node_modules','__pycache__','.pytest_cache','.mypy_cache','.tox','.ruff_cache','dist','build'}
MAX_FILES=2000
MAX_TEXT=1048576
MAX_OUTPUT=4000

def _finish(payload):
 print(json.dumps(payload));sys.exit(0)

def _rel(value):
 if not isinstance(value,str) or not value:return None
 pure=pathlib.PurePosixPath(value)
 if pure.is_absolute() or '..' in pure.parts:return None
 return pure

def _root(name,ident,project):
 if name=='candidate':target=EXPERIMENTS/('candidate-'+ident)
 elif name=='baseline':target=EXPERIMENTS/('baseline-'+ident)
 elif name=='project':
  if not isinstance(project,str) or re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}',project) is None:
   raise ValueError('Invalid project name')
  target=PROJECTS/project
 else:raise ValueError('Invalid check root')
 target=target.resolve(strict=True)
 if name=='project':
  if target.parent!=PROJECTS:raise ValueError('Project root escape')
 elif target.parent!=EXPERIMENTS:raise ValueError('Experiment root escape')
 return target

def _target(root,relative):
 """Returns the file, or None when the named target simply is not there.

 A malformed path raises (the check itself is wrong); an absent file is a fact about the
 candidate, so the caller reports a failed check rather than an unevaluable one.
 """
 pure=_rel(relative)
 if pure is None:raise ValueError('Invalid check path')
 try:
  path=(root/pure).resolve(strict=True)
 except FileNotFoundError:
  return None
 if path!=root and root not in path.parents:raise ValueError('Check path escape')
 if path.is_symlink() or not path.is_file():raise ValueError('Check target is not a regular file')
 return path

def _walk(root):
 count=0
 for path in root.rglob('*'):
  if any(part in IGNORE for part in path.relative_to(root).parts):continue
  if path.is_symlink() or not path.is_file():continue
  count+=1
  if count>MAX_FILES:raise ValueError('Too many files to search')
  yield path

def _text(path):
 data=path.read_bytes()
 if len(data)>MAX_TEXT:raise ValueError('File too large to inspect')
 return data.decode('utf-8',errors='replace')

def _pytest(root,ident):
 interpreter,source=resolve_interpreter(str(environment_path(ident)),str(root/'.venv'))
 command=[interpreter,'-m','pytest','-q']
 try:
  proc=subprocess.run(command,cwd=str(root),capture_output=True,text=True,timeout=120,env=runtime_env())
  code=proc.returncode
  output=(proc.stdout+'\n'+proc.stderr)[-MAX_OUTPUT:]
  if code==0:status='pass'
  elif code in (2,3,4,5):status='error'
  else:status='fail'
  return {'status':status,'command':' '.join(command),'cwd':str(root),'exit_code':code,
          'output':output,'detail':'pytest exit '+str(code)+' via '+source}
 except subprocess.TimeoutExpired:
  return {'status':'error','command':' '.join(command),'cwd':str(root),'exit_code':None,
          'output':'pytest timed out after 120s','detail':'timeout'}
 except OSError as exc:
  return {'status':'error','command':' '.join(command),'cwd':str(root),'exit_code':None,
          'output':'cannot run test interpreter: '+str(exc)[:300],'detail':'interpreter unavailable'}

def _run_check(spec,ident,project):
 kind=spec.get('kind');name=spec.get('root')
 root=_root(name,ident,project)
 if kind=='pytest':
  return _pytest(root,ident)
 if kind in ('file_read','file_contains','json_object','byte_count','sqlite_table'):
  path=_target(root,spec.get('path'))
  if path is None:
   return {'status':'fail','command':None,'cwd':str(root),'exit_code':None,
           'output':'required file is absent: '+str(spec.get('path')),
           'detail':'the required file is not present in the '+str(name)+' workspace'}
  if kind=='file_read':
   data=path.read_bytes()[:MAX_TEXT]
   return {'status':'pass','command':None,'cwd':str(root),'exit_code':None,
           'output':data.decode('utf-8',errors='replace')[:MAX_OUTPUT],
           'detail':'read '+str(len(data))+' bytes, sha256 '+hashlib.sha256(data).hexdigest()}
  if kind=='byte_count':
   size=path.stat().st_size
   return {'status':'pass','command':None,'cwd':str(root),'exit_code':None,'output':'bytes: '+str(size),
           'detail':'size '+str(size)+' bytes'}
  if kind=='file_contains':
   needle=spec.get('needle')
   if not isinstance(needle,str) or not needle or len(needle)>200:raise ValueError('Invalid needle')
   present=needle in _text(path)
   return {'status':'pass' if present else 'fail','command':None,'cwd':str(root),'exit_code':None,
           'output':'needle '+('present' if present else 'absent')+' in '+str(path),
           'detail':'contains-check on '+str(path)}
  if kind=='json_object':
   keys=spec.get('keys') or []
   if not isinstance(keys,list) or any(not isinstance(k,str) for k in keys) or len(keys)>12:
    raise ValueError('Invalid json keys')
   try:value=json.loads(_text(path))
   except ValueError as exc:
    return {'status':'fail','command':None,'cwd':str(root),'exit_code':None,
            'output':'not valid JSON: '+str(exc)[:200],'detail':'json parse failed'}
   if not isinstance(value,dict):
    return {'status':'fail','command':None,'cwd':str(root),'exit_code':None,
            'output':'top level is '+type(value).__name__+', expected object','detail':'not a JSON object'}
   missing=[k for k in keys if k not in value]
   return {'status':'fail' if missing else 'pass','command':None,'cwd':str(root),'exit_code':None,
           'output':'keys present: '+json.dumps(sorted(value.keys())[:40]),
           'detail':('missing keys: '+json.dumps(missing)) if missing else 'all required keys present'}
  table=spec.get('table')
  if not isinstance(table,str) or not re.fullmatch(r'[A-Za-z0-9_]{1,64}',table):raise ValueError('Invalid table name')
  import sqlite3
  try:
   connection=sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True)
   try:
    rows=connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    names=sorted(r[0] for r in rows)
    if table not in names:
     return {'status':'fail','command':None,'cwd':str(root),'exit_code':None,
             'output':'tables: '+json.dumps(names[:40]),'detail':'table '+table+' absent'}
    count=connection.execute('SELECT COUNT(*) FROM "'+table+'"').fetchone()[0]
   finally:
    connection.close()
  except sqlite3.Error as exc:
   return {'status':'error','command':None,'cwd':str(root),'exit_code':None,
           'output':'sqlite error: '+str(exc)[:200],'detail':'database not readable'}
  return {'status':'pass','command':None,'cwd':str(root),'exit_code':None,
          'output':'table '+table+' rows: '+str(count),'detail':'read-only inventory of '+str(path)}
 if kind=='search':
  needle=spec.get('needle')
  if not isinstance(needle,str) or not needle or len(needle)>200:raise ValueError('Invalid needle')
  expect_present=bool(spec.get('expect_present'))
  matches=[];examined=0
  for path in _walk(root):
   examined+=1
   try:text=_text(path)
   except (OSError,ValueError):continue
   if needle in text:matches.append(str(path.relative_to(root)))
  status='pass' if (bool(matches)==expect_present) else 'fail'
  return {'status':status,'command':None,'cwd':str(root),'exit_code':None,
          'output':('matches: '+json.dumps(matches[:50])) if matches else 'no matching files',
          'detail':'searched '+str(examined)+' files for '+json.dumps(needle)+'; matches='+str(len(matches))}
 if kind=='git_state':
  command=['git','status','--porcelain','--untracked-files=all']
  try:
   proc=subprocess.run(command,cwd=str(root),capture_output=True,text=True,timeout=60,env=runtime_env())
  except (OSError,subprocess.TimeoutExpired) as exc:
   return {'status':'error','command':' '.join(command),'cwd':str(root),'exit_code':None,
           'output':'git unavailable: '+str(exc)[:200],'detail':'git unavailable'}
  porcelain=proc.stdout.strip()
  if proc.returncode!=0:
   return {'status':'error','command':' '.join(command),'cwd':str(root),'exit_code':proc.returncode,
           'output':(proc.stdout+proc.stderr)[-MAX_OUTPUT:],
           'detail':'not a git repository, or git failed'}
  clean=not porcelain
  want_clean=bool(spec.get('expect_clean',True))
  return {'status':'pass' if (clean==want_clean) else 'fail','command':' '.join(command),'cwd':str(root),
          'exit_code':proc.returncode,'output':porcelain[:MAX_OUTPUT] or '(clean)',
          'detail':('clean' if clean else 'dirty')+' tree'}
 raise ValueError('Unsupported check kind')

payload=json.load(sys.stdin)
ident=payload.get('id')
if not isinstance(ident,str) or re.fullmatch(r'[0-9a-f-]{36}',ident) is None:raise ValueError('Invalid run ID')
specs=payload.get('checks')
if not isinstance(specs,list) or len(specs)>40:raise ValueError('Invalid check list')
results=[]
for spec in specs:
 if not isinstance(spec,dict):raise ValueError('Invalid check spec')
 start=time.time()
 try:
  outcome=_run_check(spec,ident,payload.get('project'))
 except (OSError,ValueError) as exc:
  outcome={'status':'error','command':None,'cwd':None,'exit_code':None,
           'output':'check could not run: '+str(exc)[:300],'detail':'invalid or unavailable target'}
 outcome['ordinal']=spec.get('ordinal')
 outcome['kind']=spec.get('kind')
 outcome['duration_ms']=int((time.time()-start)*1000)
 outcome['output_sha256']=hashlib.sha256((outcome.get('output') or '').encode()).hexdigest()
 results.append(outcome)
_finish({'status':'ok','checks':results})
''')

CRITERIA_PROMPT = (
    'Planning-only task: convert acceptance criteria into checks. Do not use tools, run '
    'commands, or edit files. Return ONLY a JSON object with this exact shape:\n'
    '{"deliverable_class": "code_change"|"evidence_report"|"docs_only",\n'
    ' "checks": [{"ordinal": <1-based index of the criterion>,\n'
    '             "kind": "pytest"|"file_read"|"file_contains"|"search"|"json_object"|"sqlite_table"|"git_state"|"byte_count"|"interpretive",\n'
    '             "root": "candidate"|"baseline"|"project",\n'
    '             "path": "relative/path/inside/root (file kinds only)",\n'
    '             "needle": "literal text (file_contains/search only)",\n'
    '             "expect_present": true|false (search only),\n'
    '             "keys": ["required","json","keys"] (json_object only),\n'
    '             "table": "table_name" (sqlite_table only),\n'
    '             "expect": "what a passing result looks like",\n'
    '             "evidence_required": "what the check records as evidence"}]}\n'
    'Rules: emit at least one check for EVERY criterion, using its ordinal; use "interpretive" '
    'only when no deterministic check can express the criterion. You may not reword, weaken or '
    'drop a criterion. deliverable_class is "code_change" when the plan must change source files, '
    '"evidence_report" when the deliverable is a recorded investigation/report, "docs_only" for '
    'documentation. Never propose a shell command; kinds are the entire vocabulary. Context: ')

_LIMITS = {'needle': 200, 'path': 400, 'table': 64, 'expect': 600, 'evidence_required': 600, 'keys': 12}

#: Which optional parameters each kind actually uses. A compiled check carrying a field
#: that is irrelevant to its kind is noise from the compiler, not a reason to discard a
#: usable check, so irrelevant fields are ignored rather than treated as invalid.
_RELEVANT = {
    'pytest': set(),
    'file_read': {'path'},
    'byte_count': {'path'},
    'file_contains': {'path', 'needle'},
    'search': {'needle'},
    'json_object': {'path', 'keys'},
    'sqlite_table': {'path', 'table'},
    'git_state': set(),
}


def clean_checks(value, criterion_count):
    """Validate compiled checks. Anything malformed is dropped, never guessed at."""
    dropped = []
    checks = []
    if not isinstance(value, list):
        return checks, dropped
    for item in value[:60]:
        if not isinstance(item, dict):
            dropped.append('check is not an object')
            continue
        kind = item.get('kind')
        root = item.get('root')
        ordinal = item.get('ordinal')
        if kind not in CHECK_KINDS:
            dropped.append('unsupported kind: ' + repr(kind)[:60])
            continue
        if not isinstance(ordinal, int) or not 1 <= ordinal <= criterion_count:
            dropped.append('ordinal out of range for kind ' + kind + ': ' + repr(ordinal)[:40])
            continue
        if kind == 'interpretive':
            # Nothing is executed for this kind: it records that the criterion needs
            # interpretation, so a root is meaningless and must not be required.
            checks.append({'ordinal': ordinal, 'kind': kind, 'root': 'candidate'})
            continue
        if root not in ROOTS:
            dropped.append('unsupported root for kind ' + kind + ': ' + repr(root)[:60])
            continue
        check = {'ordinal': ordinal, 'kind': kind, 'root': root}
        relevant = _RELEVANT[kind] | {'expect', 'evidence_required'}
        for field in ('path', 'needle', 'table', 'expect', 'evidence_required'):
            raw = item.get(field)
            if raw is None or field not in relevant:
                continue
            if not isinstance(raw, str) or not raw.strip():
                dropped.append('invalid ' + field + ' for kind ' + kind)
                break
            if len(raw) > _LIMITS[field]:
                dropped.append(field + ' too long for kind ' + kind)
                break
            check[field] = raw
        else:
            if kind in ('file_read', 'file_contains', 'json_object', 'byte_count', 'sqlite_table') and 'path' not in check:
                dropped.append('missing path for kind ' + kind)
                continue
            if kind in ('file_contains', 'search') and 'needle' not in check:
                dropped.append('missing needle for kind ' + kind)
                continue
            if kind == 'sqlite_table' and 'table' not in check:
                dropped.append('missing table for kind sqlite_table')
                continue
            if kind == 'search':
                check['expect_present'] = bool(item.get('expect_present'))
            if kind == 'git_state':
                check['expect_clean'] = bool(item.get('expect_clean', True))
            if kind == 'json_object':
                keys = item.get('keys')
                if not isinstance(keys, list) or any(not isinstance(k, str) or not k for k in keys) \
                        or len(keys) > _LIMITS['keys']:
                    dropped.append('invalid keys for kind json_object')
                    continue
                check['keys'] = keys
            checks.append(check)
    return checks, dropped


def _clean_deliverable(value):
    return value if value in DELIVERABLE_CLASSES else 'code_change'


class VerificationEngine:
    """Compile plan criteria, execute independent checks, and adjudicate the result."""

    #: HL-VERIFY-001 part D: injected by create_app so verification can request a targeted
    #: revision through the existing FLOW-006 engine.
    revisions: 'ImplementationRevision | None' = None

    def __init__(self, runtime, implementer, reviewer):
        self.runtime, self.implementer, self.reviewer = runtime, implementer, reviewer
        self.store = runtime.store
        self.lock = threading.Lock()
        self._migrate()

    def _migrate(self):
        with self.store.lock:
            self.store.connection.execute('''CREATE TABLE IF NOT EXISTS verification_plans (
                plan_id TEXT PRIMARY KEY, deliverable_class TEXT NOT NULL, compiled_at TEXT NOT NULL,
                compiler_note TEXT)''')
            self.store.connection.execute('''CREATE TABLE IF NOT EXISTS verification_criteria (
                plan_id TEXT NOT NULL, ordinal INTEGER NOT NULL, criterion_text TEXT NOT NULL,
                method TEXT, expected TEXT, evidence_required TEXT, auto_verifiable INTEGER NOT NULL,
                check_json TEXT, created_at TEXT NOT NULL, PRIMARY KEY(plan_id, ordinal))''')
            self.store.connection.execute('''CREATE TABLE IF NOT EXISTS verification_runs (
                id TEXT PRIMARY KEY, run_id TEXT NOT NULL, attempt INTEGER NOT NULL, state TEXT NOT NULL,
                disposition TEXT, deliverable_class TEXT, blocker TEXT, criteria_json TEXT,
                evidence_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                UNIQUE(run_id, attempt))''')
            self.store.connection.execute('''CREATE TABLE IF NOT EXISTS verification_checks (
                id INTEGER PRIMARY KEY AUTOINCREMENT, verification_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
                kind TEXT NOT NULL, status TEXT NOT NULL, command TEXT, cwd TEXT, exit_code INTEGER,
                output TEXT, output_sha256 TEXT, detail TEXT, duration_ms INTEGER, created_at TEXT NOT NULL)''')
            runs = {r[1] for r in self.store.connection.execute('PRAGMA table_info(verification_runs)')}
            if runs and 'auto_revision_json' not in runs:
                self.store.connection.execute('ALTER TABLE verification_runs ADD COLUMN auto_revision_json TEXT')
            self.store.connection.execute('''CREATE TABLE IF NOT EXISTS verification_settings (
                id INTEGER PRIMARY KEY CHECK(id=1), auto_revision INTEGER NOT NULL DEFAULT 1)''')
            self.store.connection.execute('INSERT OR IGNORE INTO verification_settings(id,auto_revision) VALUES(1,1)')
            # v29 columns, in case this database predates the migration.
            for table in ('implementation_reviews', 'implementation_review_history'):
                columns = {r[1] for r in self.store.connection.execute('PRAGMA table_info(' + table + ')')}
                if columns and 'decided_by' not in columns:
                    self.store.connection.execute('ALTER TABLE ' + table + ' ADD COLUMN decided_by TEXT')
            self.store.connection.commit()

    # ------------------------------------------------------------------ criteria

    def compile_criteria(self, plan_id, report=None):
        """Turn a plan's free-text criteria into explicit checks, preserving the text.

        Compilation is best effort by design: a plan is never blocked or weakened by it.
        A criterion with no compiled check can only ever be reported 'unverified'.
        """
        plan = self.store.connection.execute(
            'SELECT report FROM investigation_plans WHERE id=?', (plan_id,)).fetchone()
        if plan is None:
            raise KeyError('Plan not found')
        report = report if report is not None else json.loads(plan['report'])
        criteria = [c for c in (report.get('acceptance_criteria') or []) if isinstance(c, str) and c.strip()]
        adapter = self._analysis_adapter()
        checks, deliverable, note = [], 'code_change', ''
        if not criteria:
            note = 'plan declares no acceptance criteria'
        elif adapter is None or getattr(adapter, 'transport', None) != 'ssh':
            note = 'criteria were not compiled: isolated VM transport unavailable'
        else:
            context = {'summary': report.get('summary'), 'steps': report.get('steps'),
                       'acceptance_criteria': criteria, 'test_approach': report.get('test_approach'),
                       'deliverable_hint': (report.get('project_scope') or {}).get('repo')}
            try:
                result = adapter.run(CRITERIA_PROMPT + json.dumps(context, ensure_ascii=False),
                                     lambda kind, payload: self.store.emit(kind, payload))
                raw = (result.get('result') or '').strip()
                if raw.startswith('```'):
                    raw = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw, flags=re.I).strip()
                value = json.loads(raw)
                if not isinstance(value, dict):
                    raise ValueError('expected a JSON object')
                deliverable = _clean_deliverable(value.get('deliverable_class'))
                checks, dropped = clean_checks(value.get('checks'), len(criteria))
                if dropped:
                    note = 'dropped invalid checks: ' + '; '.join(dropped[:6])
            except Exception as exc:
                note = 'criteria were not compiled: ' + str(exc)[:240]
        stamp = now()
        by_ordinal = {}
        for check in checks:
            by_ordinal.setdefault(check['ordinal'], []).append(check)
        with self.store.lock:
            self.store.connection.execute('''INSERT INTO verification_plans
                (plan_id,deliverable_class,compiled_at,compiler_note) VALUES (?,?,?,?)
                ON CONFLICT(plan_id) DO UPDATE SET deliverable_class=excluded.deliverable_class,
                compiled_at=excluded.compiled_at, compiler_note=excluded.compiler_note''',
                (plan_id, deliverable, stamp, note or None))
            self.store.connection.execute('DELETE FROM verification_criteria WHERE plan_id=?', (plan_id,))
            for ordinal, text in enumerate(criteria, 1):
                owned = by_ordinal.get(ordinal, [])
                # Only executable kinds make a criterion auto-verifiable: an 'interpretive'
                # marker means the model must judge it, which is not automatic.
                deterministic = [c for c in owned if c['kind'] != 'interpretive']
                method = '; '.join(sorted({c['kind'] for c in deterministic})) or 'interpretive'
                self.store.connection.execute('''INSERT INTO verification_criteria
                    (plan_id,ordinal,criterion_text,method,expected,evidence_required,auto_verifiable,
                     check_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)''',
                    (plan_id, ordinal, text, method,
                     next((c.get('expect') for c in owned if c.get('expect')), None),
                     next((c.get('evidence_required') for c in owned if c.get('evidence_required')), None),
                     1 if deterministic else 0, json.dumps(owned), stamp))
            self.store.connection.commit()
        self.store.emit('verification.criteria_compiled',
                        {'plan_id': plan_id, 'criteria': len(criteria), 'checks': len(checks),
                         'deliverable_class': deliverable, 'note': note})
        return self.criteria(plan_id)

    def criteria(self, plan_id):
        with self.store.lock:
            plan = self.store.connection.execute(
                'SELECT * FROM verification_plans WHERE plan_id=?', (plan_id,)).fetchone()
            rows = self.store.connection.execute(
                'SELECT * FROM verification_criteria WHERE plan_id=? ORDER BY ordinal', (plan_id,)).fetchall()
        return {'plan_id': plan_id,
                'deliverable_class': plan['deliverable_class'] if plan else None,
                'compiled_at': plan['compiled_at'] if plan else None,
                'compiler_note': plan['compiler_note'] if plan else None,
                'criteria': [{**dict(r), 'checks': json.loads(r['check_json'] or '[]')} for r in rows]}

    def summary(self, plan_id):
        """Cheap per-plan annotation for list views."""
        with self.store.lock:
            plan = self.store.connection.execute(
                'SELECT deliverable_class FROM verification_plans WHERE plan_id=?', (plan_id,)).fetchone()
            row = self.store.connection.execute(
                'SELECT COUNT(*) AS total, SUM(auto_verifiable) AS auto FROM verification_criteria WHERE plan_id=?',
                (plan_id,)).fetchone()
        return {'deliverable_class': plan['deliverable_class'] if plan else None,
                'criteria': row['total'] or 0, 'auto_verifiable': row['auto'] or 0}

    # ------------------------------------------------------------------ execution

    def _guest(self, payload):
        adapter = self.runtime.adapter
        if getattr(adapter, 'transport', None) != 'ssh':
            raise ValueError('VM SSH execution is required')
        command = adapter._ssh_base() + ['python3 -c ' + shlex.quote(VERIFY_GUEST)]
        process = subprocess.run(command, input=json.dumps(payload), text=True,
                                 capture_output=True, timeout=420)
        if process.returncode:
            raise RuntimeError('Verification guest failed: ' + process.stderr[-600:])
        return json.loads(process.stdout)

    def _preconditions(self, run):
        """Reasons verification cannot start at all. None means 'proceed'."""
        if not run.get('candidate_path') or not run.get('baseline_path'):
            return 'candidate_workspace_missing'
        try:
            baseline = json.loads(run.get('baseline_json') or '{}')
        except ValueError:
            baseline = {}
        # A *failed* baseline is established evidence (the tests were failing before the
        # change, which is what a fix plan expects). Only an unmeasurable baseline blocks.
        if baseline.get('status') not in ('passed', 'failed'):
            return 'baseline_not_established'
        environment = self.implementer.environment(run['id'])
        if environment and environment.get('status') != 'ok':
            return 'environment_not_usable'
        return None

    def run(self, run_id, trigger='manual'):
        """Verify an existing candidate. Never invokes the coding agent."""
        if not self.lock.acquire(blocking=False):
            raise ValueError('Verification already in progress')
        try:
            run = self.implementer.get(run_id)
            if not run:
                raise KeyError('Implementation not found')
            plan_id = run['plan_id']
            compiled = self.criteria(plan_id)
            criteria = compiled['criteria']
            deliverable = compiled['deliverable_class'] or 'code_change'
            ident = str(uuid4())
            stamp = now()
            with self.store.lock:
                attempt = (self.store.connection.execute(
                    'SELECT COALESCE(MAX(attempt),0) FROM verification_runs WHERE run_id=?',
                    (run_id,)).fetchone()[0] or 0) + 1
                self.store.connection.execute('''INSERT INTO verification_runs
                    (id,run_id,attempt,state,deliverable_class,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?)''',
                    (ident, run_id, attempt, 'running', deliverable, stamp, stamp))
                self.store.connection.commit()
            self.store.emit('verification.started',
                            {'run_id': run_id, 'verification_id': ident, 'trigger': trigger})
            try:
                report = self._evaluate_run(run, criteria, deliverable)
            except Exception as exc:
                self._store_result(ident, 'error', None, [], [], str(exc)[:600])
                self.store.emit('verification.failed',
                                {'run_id': run_id, 'verification_id': ident, 'error': str(exc)[:300]})
                raise
            self._store_result(ident, 'completed', report['disposition'], report['criteria'],
                               report['evidence'], report['blocker'])
            self.store.emit('verification.completed',
                            {'run_id': run_id, 'verification_id': ident,
                             'disposition': report['disposition'], 'blocker': report['blocker']})
            result = self.report(run_id)
        finally:
            self.lock.release()
        # HL-VERIFY-001 part D, outside the verification lock: queueing a revision wakes the
        # FLOW-006 worker, which verifies again after promoting and must be able to take it.
        result = result or {}
        outcome = self._maybe_request_revision(run_id, result)
        result['auto_revision'] = outcome
        if result.get('id'):
            with self.store.lock:
                self.store.connection.execute(
                    'UPDATE verification_runs SET auto_revision_json=? WHERE id=?',
                    (json.dumps(outcome), result['id']))
                self.store.connection.commit()
        return result

    def _evaluate_run(self, run, criteria, deliverable):
        blocker = self._preconditions(run)
        snapshot = self.reviewer._snapshot(run['id'])
        checks, environment = [], {}
        if blocker is None and criteria:
            specs = [check for row in criteria for check in json.loads(row['check_json'] or '[]')
                     if check['kind'] != 'interpretive']
            if specs:
                outcome = self._guest({'operation': 'verify', 'id': run['id'],
                                       'project': run['project'], 'checks': specs})
                checks = outcome.get('checks') or []
            environment = {'interpreter': self.implementer.environment(run['id']) or {}}
        by_ordinal = {}
        for check in checks:
            by_ordinal.setdefault(check.get('ordinal'), []).append(check)
        if blocker is not None:
            verdicts = [{'ordinal': row['ordinal'], 'criterion': row['criterion_text'],
                         'verdict': 'unverified', 'reason': 'verification blocked: ' + blocker,
                         'evidence_refs': []} for row in criteria]
            return {'disposition': 'blocked', 'blocker': blocker, 'criteria': verdicts,
                    'evidence': {'checks': checks, 'environment': environment, 'snapshot': snapshot}}
        if not criteria:
            return {'disposition': 'blocked', 'blocker': 'no_compiled_criteria', 'criteria': [],
                    'evidence': {'checks': [], 'environment': environment, 'snapshot': snapshot}}
        missing_deliverable = deliverable == 'code_change' and not (snapshot.get('changed_files') or 0)
        verdicts = []
        interpretive = []
        for row in criteria:
            owned = by_ordinal.get(row['ordinal'], [])
            verdict = self._criterion_verdict(row, owned, snapshot, missing_deliverable)
            verdicts.append(verdict)
            if verdict['verdict'] == 'unverified' and not owned:
                interpretive.append(row)
        if interpretive:
            self._apply_model_verdicts(run, interpretive, verdicts, checks)
        return {'disposition': self._disposition(verdicts), 'blocker': None,
                'criteria': verdicts,
                'evidence': {'checks': checks, 'environment': environment, 'snapshot': snapshot}}

    def _criterion_verdict(self, row, owned, snapshot, missing_deliverable):
        base = {'ordinal': row['ordinal'], 'criterion': row['criterion_text']}
        if missing_deliverable:
            # The plan's own deliverable is absent: a green test run cannot satisfy a
            # criterion about code that was never written.
            return {**base, 'verdict': 'failed',
                    'reason': 'plan expects a code change but the candidate changed 0 files',
                    'evidence_refs': [{'kind': 'snapshot', 'changed_files': 0}]}
        if not owned:
            return {**base, 'verdict': 'unverified',
                    'reason': 'no deterministic check is available for this criterion',
                    'evidence_refs': []}
        failures = [c for c in owned if c.get('status') == 'fail']
        errors = [c for c in owned if c.get('status') == 'error']
        if failures:
            return {**base, 'verdict': 'failed',
                    'reason': '; '.join((c.get('detail') or 'check failed') for c in failures)[:600],
                    'evidence_refs': [self._reference(c) for c in failures]}
        if errors:
            return {**base, 'verdict': 'unverified',
                    'reason': '; '.join((c.get('detail') or 'check could not run') for c in errors)[:600],
                    'evidence_refs': [self._reference(c) for c in errors]}
        return {**base, 'verdict': 'passed',
                'reason': '; '.join((c.get('detail') or 'check passed') for c in owned)[:600],
                'evidence_refs': [self._reference(c) for c in owned]}

    @staticmethod
    def _reference(check):
        return {'ordinal': check.get('ordinal'), 'kind': check.get('kind'), 'status': check.get('status'),
                'command': check.get('command'), 'exit_code': check.get('exit_code'),
                'output_sha256': check.get('output_sha256'), 'detail': check.get('detail')}

    def _analysis_adapter(self):
        """The persona-free read-only chain used where the answer is judged or parsed as data.

        HL-PERS-001 §5A/§5C/§6: the persona, the learned profile, recalled lessons and the
        learning-report protocol must not reach a verifier or an extractor.
        """
        runtime = self.runtime
        adapter = (runtime.analysis_adapters.get('read_only')
                   if hasattr(runtime, 'analysis_adapters') else None)
        adapter = adapter or (runtime.adapters.get('read_only')
                              if hasattr(runtime, 'adapters') else None)
        return adapter or getattr(runtime, 'adapter', None)

    def _apply_model_verdicts(self, run, rows, verdicts, checks):
        """Interpretive criteria only. A model verdict can never override a deterministic one,
        and a 'passed' verdict without a cited evidence reference is downgraded."""
        adapter = self._analysis_adapter()
        if adapter is None or getattr(adapter, 'transport', None) != 'ssh':
            return
        prompt = ('Adjudication task. Decide only the criteria listed below, using the recorded '
                  'evidence and the implementation claim. Return ONLY JSON '
                  '{"verdicts":[{"ordinal":<int>,"verdict":"passed"|"failed"|"unverified",'
                  '"reason":"...","evidence_refs":["..."]}]}. A "passed" verdict requires at least one '
                  'concrete evidence reference; with no evidence the verdict must be "unverified". '
                  'Context: ' + json.dumps({
                      'criteria': [{'ordinal': r['ordinal'], 'criterion': r['criterion_text']} for r in rows],
                      'deterministic_checks': [self._reference(c) for c in checks],
                      'implementation_claim': (run.get('response') or '')[:4000]}, ensure_ascii=False))
        try:
            result = adapter.run(prompt, lambda kind, payload: self.store.emit(kind, payload))
            raw = (result.get('result') or '').strip()
            if raw.startswith('```'):
                raw = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw, flags=re.I).strip()
            value = json.loads(raw)
        except Exception as exc:
            for verdict in verdicts:
                if verdict['verdict'] == 'unverified' and not verdict['evidence_refs']:
                    verdict['reason'] = ('model adjudication unavailable: ' + str(exc)[:200])
            return
        decided = {v.get('ordinal'): v for v in (value.get('verdicts') or []) if isinstance(v, dict)}
        for verdict in verdicts:
            item = decided.get(verdict['ordinal'])
            if not item or verdict['verdict'] != 'unverified' or verdict['evidence_refs']:
                continue
            choice = item.get('verdict')
            refs = item.get('evidence_refs')
            refs = [str(r)[:300] for r in refs] if isinstance(refs, list) else []
            if choice not in ('passed', 'failed', 'unverified'):
                continue
            if choice == 'passed' and not refs:
                verdict['reason'] = 'model verdict of passed was downgraded: no evidence reference cited'
                continue
            verdict['verdict'] = choice
            verdict['reason'] = str(item.get('reason'))[:600] or 'model adjudication'
            verdict['evidence_refs'] = refs
            verdict['interpreted_by_model'] = True

    @staticmethod
    def _disposition(verdicts):
        if any(v['verdict'] == 'failed' for v in verdicts):
            return 'failed'
        if any(v['verdict'] == 'unverified' for v in verdicts):
            return 'insufficient_evidence'
        return 'verified'

    def _store_result(self, ident, state, disposition, verdicts, evidence, blocker):
        stamp = now()
        with self.store.lock:
            self.store.connection.execute('''UPDATE verification_runs SET state=?,disposition=?,
                blocker=?,criteria_json=?,evidence_json=?,updated_at=? WHERE id=?''',
                (state, disposition, blocker, json.dumps(verdicts), json.dumps(evidence), stamp, ident))
            self.store.connection.execute('DELETE FROM verification_checks WHERE verification_id=?', (ident,))
            for check in evidence.get('checks') or []:
                self.store.connection.execute('''INSERT INTO verification_checks
                    (verification_id,ordinal,kind,status,command,cwd,exit_code,output,output_sha256,
                     detail,duration_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''',
                    (ident, check.get('ordinal') or 0, check.get('kind') or 'unknown',
                     check.get('status') or 'error', check.get('command'), check.get('cwd'),
                     check.get('exit_code'), (check.get('output') or '')[:4000],
                     check.get('output_sha256'), (check.get('detail') or '')[:600],
                     check.get('duration_ms'), stamp))
            self.store.connection.commit()

    # ------------------------------------------------------------------ reporting

    def report(self, run_id):
        """Latest verification for a run, including per-criterion evidence."""
        if not self.implementer.get(run_id):
            raise KeyError('Implementation not found')
        with self.store.lock:
            row = self.store.connection.execute(
                'SELECT * FROM verification_runs WHERE run_id=? ORDER BY attempt DESC LIMIT 1',
                (run_id,)).fetchone()
            if not row:
                return None
            checks = [dict(r) for r in self.store.connection.execute(
                'SELECT * FROM verification_checks WHERE verification_id=? ORDER BY ordinal, id',
                (row['id'],))]
        report = dict(row)
        try:
            report['auto_revision'] = json.loads(row['auto_revision_json']) if row['auto_revision_json'] else None
        except (ValueError, IndexError):
            report['auto_revision'] = None
        report['criteria'] = json.loads(row['criteria_json'] or '[]')
        report['evidence'] = json.loads(row['evidence_json'] or '{}')
        report['checks'] = checks
        return report

    def latest_disposition(self, run_id):
        with self.store.lock:
            row = self.store.connection.execute(
                'SELECT disposition,blocker FROM verification_runs WHERE run_id=? ORDER BY attempt DESC LIMIT 1',
                (run_id,)).fetchone()
        return dict(row) if row else None

    def acceptance_gate(self, run_id):
        """Reasons an 'accepted' decision is not allowed yet. Empty means accept is allowed."""
        report = self.report(run_id)
        if report is None:
            return []
        if report['disposition'] == 'verified':
            return []
        failed = [c['ordinal'] for c in report['criteria'] if c['verdict'] == 'failed']
        unverified = [c['ordinal'] for c in report['criteria'] if c['verdict'] == 'unverified']
        detail = []
        if failed:
            detail.append('failed criteria ' + json.dumps(failed))
        if unverified:
            detail.append('unverified criteria ' + json.dumps(unverified))
        if report['blocker']:
            detail.append('blocker ' + str(report['blocker']))
        return ['verification disposition is ' + str(report['disposition'])
                + (' (' + '; '.join(detail) + ')' if detail else '')]

    # ------------------------------------------------------------------ part D: auto revision

    #: Machine-requested revisions allowed per run, on top of the 3 attempts each request
    #: already bounds. Each machine request is a new review decision, so without this cap the
    #: verify -> revise -> promote -> verify cycle could spend without limit.
    MAX_AUTO_REVISIONS = 2

    def settings(self):
        with self.store.lock:
            row = self.store.connection.execute(
                'SELECT auto_revision FROM verification_settings WHERE id=1').fetchone()
        return {'auto_revision': bool(row['auto_revision']) if row else True,
                'max_auto_revisions': self.MAX_AUTO_REVISIONS}

    def set_auto_revision(self, value):
        with self.store.lock:
            self.store.connection.execute(
                'UPDATE verification_settings SET auto_revision=? WHERE id=1', (int(bool(value)),))
            self.store.connection.commit()
        self.store.emit('verification.auto_revision_setting', {'auto_revision': bool(value)})
        return self.settings()

    @staticmethod
    def _failed_ordinals(report):
        return sorted(c['ordinal'] for c in (report.get('criteria') or []) if c['verdict'] == 'failed')

    def _previous_failed_ordinals(self, run_id, before_attempt):
        with self.store.lock:
            row = self.store.connection.execute(
                'SELECT criteria_json FROM verification_runs WHERE run_id=? AND attempt<? '
                'ORDER BY attempt DESC LIMIT 1', (run_id, before_attempt)).fetchone()
        if not row:
            return None
        try:
            criteria = json.loads(row['criteria_json'] or '[]')
        except ValueError:
            return None
        return sorted(c['ordinal'] for c in criteria if c.get('verdict') == 'failed')

    def _machine_requests(self, run_id):
        with self.store.lock:
            archived = self.store.connection.execute(
                "SELECT COUNT(*) FROM implementation_review_history WHERE run_id=? AND decided_by='verifier'",
                (run_id,)).fetchone()[0]
            pending = self.store.connection.execute(
                "SELECT COUNT(*) FROM implementation_reviews WHERE run_id=? AND decided_by='verifier'",
                (run_id,)).fetchone()[0]
        return int(archived or 0) + int(pending or 0)

    def _machine_feedback(self, report):
        lines = ['Automatic revision request from independent verification '
                 '(disposition: ' + str(report['disposition']) + ').',
                 'Fix exactly these criteria; the result is re-verified independently afterwards.']
        for criterion in report['criteria']:
            if criterion['verdict'] != 'failed':
                continue
            lines.append('- criterion ' + str(criterion['ordinal']) + ': ' + str(criterion['criterion'])[:400])
            lines.append('  why it failed: ' + str(criterion['reason'])[:400])
            for ref in (criterion.get('evidence_refs') or [])[:3]:
                if isinstance(ref, dict):
                    lines.append('  evidence: ' + json.dumps(ref)[:400])
                else:
                    lines.append('  evidence: ' + str(ref)[:400])
        lines.append('Do not change tests merely to achieve a passing result. '
                     'Only the isolated staging workspace may be modified.')
        return '\n'.join(lines)[:6000]

    def request_revision(self, run_id, report):
        """Record a machine revision request for the failed criteria, or explain why not.

        Never overrides a recorded human decision, never runs for a disposition a revision
        cannot fix, and stops rather than looping when nothing improves.
        """
        if self.revisions is None:
            return {'requested': False, 'stopped': 'revision_engine_unavailable'}
        if report.get('disposition') != 'failed':
            return {'requested': False, 'stopped': 'disposition_not_failed'}
        existing = self.reviewer.get_decision(run_id)
        if existing:
            # A machine request that is still pending must not stack another one; only a
            # human decision (or none) changes what happens next.
            if existing.get('decided_by') == 'verifier':
                return {'requested': False, 'stopped': 'revision_already_requested'}
            return {'requested': False, 'stopped': 'human_decision_recorded'}
        failed = self._failed_ordinals(report)
        if not failed:
            return {'requested': False, 'stopped': 'no_failed_criteria'}
        previous = self._previous_failed_ordinals(run_id, report.get('attempt') or 0)
        if previous is not None and previous == failed:
            # Same criteria failed again: a further attempt is not converging.
            self.store.emit('verification.auto_revision_stopped',
                            {'run_id': run_id, 'reason': 'no_progress', 'criteria': failed})
            return {'requested': False, 'stopped': 'no_progress', 'criteria': failed}
        if self._machine_requests(run_id) >= self.MAX_AUTO_REVISIONS:
            self.store.emit('verification.auto_revision_stopped',
                            {'run_id': run_id, 'reason': 'auto_revision_budget_exhausted',
                             'criteria': failed})
            return {'requested': False, 'stopped': 'auto_revision_budget_exhausted', 'criteria': failed}
        run = self.implementer.get(run_id)
        if not run or run.get('state') not in ('candidate_passed', 'candidate_failed', 'evaluation_error'):
            return {'requested': False, 'stopped': 'run_not_reviewable'}
        try:
            snapshot = self.reviewer._snapshot(run_id)
        except Exception as exc:
            return {'requested': False, 'stopped': 'snapshot_unavailable: ' + str(exc)[:200]}
        verdicts = [c['verdict'] == 'passed' for c in report['criteria']]
        feedback = self._machine_feedback(report)
        with self.store.lock:
            if self.store.connection.execute(
                    'SELECT 1 FROM implementation_reviews WHERE run_id=?', (run_id,)).fetchone():
                return {'requested': False, 'stopped': 'human_decision_recorded'}
            self.store.connection.execute('''INSERT INTO implementation_reviews
                (run_id,decision,evidence_sha256,criteria_json,feedback,decided_at,decided_by)
                VALUES (?,?,?,?,?,?,?)''',
                (run_id, 'revision_requested', snapshot['snapshot_sha256'], json.dumps(verdicts),
                 feedback, now(), 'verifier'))
            self.store.connection.commit()
        self.store.emit('implementation.revision_requested',
                        {'run_id': run_id, 'decided_by': 'verifier', 'criteria': failed})
        try:
            attempt = self.revisions.queue(run_id)
        except Exception as exc:
            return {'requested': True, 'queued': False, 'error': str(exc)[:300], 'criteria': failed}
        self.store.emit('verification.auto_revision_queued',
                        {'run_id': run_id, 'attempt': attempt.get('attempt') if attempt else None,
                         'criteria': failed})
        return {'requested': True, 'queued': True, 'criteria': failed,
                'attempt': attempt.get('attempt') if attempt else None,
                'attempt_id': attempt.get('id') if attempt else None}

    def _maybe_request_revision(self, run_id, report):
        """Best-effort hook after a verification run; never fails the verification itself."""
        try:
            if not self.settings()['auto_revision']:
                return {'requested': False, 'stopped': 'auto_revision_disabled'}
            outcome = self.request_revision(run_id, report)
            if outcome.get('stopped'):
                self.store.emit('verification.auto_revision_skipped',
                                {'run_id': run_id, 'reason': outcome['stopped']})
            return outcome
        except Exception as exc:
            self.store.emit('verification.auto_revision_failed',
                            {'run_id': run_id, 'error': str(exc)[:300]})
            return {'requested': False, 'stopped': 'error: ' + str(exc)[:200]}
