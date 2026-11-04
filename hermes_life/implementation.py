"""Approved plan -> isolated candidate -> independent tests and reevaluation.

Never edits original VM projects or applies changes to the host.
"""
import json
import re
import shlex
import subprocess
import threading
from pathlib import Path
from uuid import uuid4

from .guest_env import ENV_PROVISION, ENV_RESOLVER
from .store import now

# Runs inside the VM. A fixed command is selected by the evaluator, never by
# untrusted plan/agent output. Only prepared experiment directories are tested.
# FLOW-007A: interpreter resolution and environment provisioning are owned by
# guest_env so the revision worker cannot drift away from this path.
GUEST = ENV_RESOLVER + ENV_PROVISION + r'''
import importlib.util,json,pathlib,re,shutil,subprocess,sys

def valid_name(s):
 return isinstance(s,str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}',s) is not None and s not in ('.','..')

def result(status,code,output,python=None,command=None,env_source=None):
 print(json.dumps({'status':status,'exit_code':code,'output':output[-12000:],
                   'python':python,'command':command,'env_source':env_source}))

x=json.load(sys.stdin)
root=pathlib.Path('/home/hermes/projects').resolve()
experiments=pathlib.Path('/home/hermes/experiments').resolve()
op=x.get('operation')
if op=='prepare':
 p=x.get('project')
 if not valid_name(p): raise ValueError('Invalid project name')
 src=(root/p).resolve(strict=True)
 if src.parent!=root or not src.is_dir(): raise ValueError('Project must be a direct child of /home/hermes/projects')
 ident=x.get('id')
 if not isinstance(ident,str) or re.fullmatch(r'[0-9a-f-]{36}',ident) is None: raise ValueError('Invalid run ID')
 dest=experiments/('candidate-'+ident);baseline=experiments/('baseline-'+ident)
 for target in (dest,baseline):
  if target.exists(): raise ValueError('Candidate already exists')
  shutil.copytree(src,target,symlinks=False,ignore=shutil.ignore_patterns('.git','.venv','node_modules','__pycache__','.pytest_cache','.mypy_cache'))
 print(json.dumps({'candidate':str(dest),'baseline':str(baseline)}))
elif op=='test':
 ident=x.get('id');kind=x.get('kind')
 if not isinstance(ident,str) or re.fullmatch(r'[0-9a-f-]{36}',ident) is None:raise ValueError('Invalid run ID')
 if kind not in ('candidate','baseline'):raise ValueError('Invalid test workspace')
 directory=(experiments/(kind+'-'+ident)).resolve(strict=True)
 if directory.parent!=experiments or not directory.is_dir() or directory.is_symlink():raise ValueError('Invalid test workspace')
 python,env_source=resolve_interpreter(str(environment_path(ident)),str(directory/'.venv'))
 command=[python,'-m','pytest','-q']
 try:
  r=subprocess.run(command,cwd=directory,capture_output=True,text=True,timeout=120,env=runtime_env())
  output=(r.stdout+'\n'+r.stderr)[-12000:]
  if r.returncode==0:
   status='passed'
  elif r.returncode==5:
   status='evaluation_error' # pytest started but no tests were collected
  elif 'No module named pytest' in output or 'No module named pip' in output:
   status='evaluation_error'
  elif r.returncode in (2,3,4):
   status='evaluation_error' # interrupted, internal error, usage error
  else:
   status='failed' # pytest ran and tests failed (usually exit 1)
  result(status,r.returncode,output,python,command,env_source)
 except subprocess.TimeoutExpired:
  result('evaluation_error',124,'Test timed out',python,command,env_source)
 except OSError as exc:
  result('evaluation_error',None,f'Cannot run test interpreter: {exc}',python,command,env_source)
elif op=='environment':
 ident=x.get('id')
 if not isinstance(ident,str) or re.fullmatch(r'[0-9a-f-]{36}',ident) is None:raise ValueError('Invalid run ID')
 # A missing or invalid baseline is classified by provision_environment rather than raised
 # here, so the platform reports an environment failure instead of a crashed worker.
 baseline=experiments/('baseline-'+ident)
 print(json.dumps(provision_environment(ident,str(baseline))))
else:raise ValueError('Invalid operation')
'''


class ImplementationEngine:
    def __init__(self, runtime, planner):
        self.runtime, self.planner = runtime, planner
        self.store = runtime.store
        self.lock = threading.Lock()

    def list(self):
        with self.store.lock:
            return [dict(x) for x in self.store.connection.execute(
                'SELECT * FROM implementation_runs ORDER BY created_at DESC LIMIT 100')]

    def get(self, ident):
        with self.store.lock:
            r = self.store.connection.execute(
                'SELECT * FROM implementation_runs WHERE id=?', (ident,)).fetchone()
            return dict(r) if r else None

    def evaluations(self, ident):
        if self.get(ident) is None:
            raise KeyError('Implementation not found')
        self._ensure_evaluation_history()
        with self.store.lock:
            return [dict(r) for r in self.store.connection.execute(
                'SELECT * FROM implementation_evaluations WHERE run_id=? ORDER BY id DESC',
                (ident,)).fetchall()]

    def _ensure_evaluation_history(self):
        # Additive migration. Existing schema/data and approval gates untouched.
        with self.store.lock:
            self.store.connection.execute('''CREATE TABLE IF NOT EXISTS implementation_evaluations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                evaluated_at TEXT NOT NULL,
                previous_state TEXT NOT NULL,
                resulting_state TEXT NOT NULL,
                baseline_json TEXT,
                candidate_json TEXT,
                FOREIGN KEY (run_id) REFERENCES implementation_runs(id)
            )''')
            self.store.connection.commit()

    def _record_evaluation(self, ident, previous_state, resulting_state, baseline, candidate):
        self._ensure_evaluation_history()
        with self.store.lock:
            self.store.connection.execute('''INSERT INTO implementation_evaluations
                (run_id,evaluated_at,previous_state,resulting_state,baseline_json,candidate_json)
                VALUES (?,?,?,?,?,?)''',
                (ident, now(), previous_state, resulting_state,
                 json.dumps(baseline), json.dumps(candidate)))
            self.store.connection.commit()

    def _ensure_environment_history(self):
        # Additive migration. Existing schema/data and approval gates untouched.
        with self.store.lock:
            self.store.connection.execute('''CREATE TABLE IF NOT EXISTS implementation_environments (
                run_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                python_version TEXT,
                interpreter TEXT,
                manifest_json TEXT NOT NULL,
                packages_json TEXT,
                install_json TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (run_id) REFERENCES implementation_runs(id)
            )''')
            self.store.connection.commit()

    def environment(self, ident):
        """FLOW-007A: the recorded platform environment for a run, or None."""
        if self.get(ident) is None:
            raise KeyError('Implementation not found')
        self._ensure_environment_history()
        with self.store.lock:
            row = self.store.connection.execute(
                'SELECT * FROM implementation_environments WHERE run_id=?', (ident,)).fetchone()
        return dict(row) if row else None

    def _record_environment(self, ident, result):
        self._ensure_environment_history()
        stamp = now()
        with self.store.lock:
            self.store.connection.execute('''INSERT INTO implementation_environments
                (run_id,status,python_version,interpreter,manifest_json,packages_json,install_json,error,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(run_id) DO UPDATE SET
                 status=excluded.status, python_version=excluded.python_version,
                 interpreter=excluded.interpreter, manifest_json=excluded.manifest_json,
                 packages_json=excluded.packages_json, install_json=excluded.install_json,
                 error=excluded.error, updated_at=excluded.updated_at''',
                (ident, result.get('status') or 'environment_error', result.get('python_version'),
                 result.get('interpreter'), json.dumps(result.get('manifest') or {}),
                 result.get('packages'), json.dumps(result.get('install') or []),
                 (result.get('reason') or None), stamp, stamp))
            self.store.connection.commit()

    def _ensure_environment(self, ident):
        """Create or validate this run's platform-owned test environment.

        Raises ValueError when the environment cannot be made usable, so callers can
        report an environment failure separately from a candidate test failure.
        """
        result = self._guest({'operation': 'environment', 'id': ident})
        self._record_environment(ident, result)
        if result.get('status') != 'ok':
            self.store.emit('implementation.environment_failed',
                            {'run_id': ident, 'reason': (result.get('reason') or '')[:300]})
            raise ValueError('Environment setup failed: ' + (result.get('reason') or 'unknown cause'))
        self.store.emit('implementation.environment_ready',
                        {'run_id': ident, 'interpreter': result.get('interpreter'),
                         'python_version': result.get('python_version'), 'created': result.get('created')})
        return result

    def _guest(self, payload):
        adapter = self.runtime.adapter
        if getattr(adapter, 'transport', None) != 'ssh':
            raise ValueError('VM SSH execution is required')
        command = adapter._ssh_base() + ['python3 -c ' + shlex.quote(GUEST)]
        p = subprocess.run(command, input=json.dumps(payload), text=True,
                           capture_output=True, timeout=150)
        if p.returncode:
            raise RuntimeError('Guest operation failed: ' + p.stderr[-600:])
        return json.loads(p.stdout)

    @staticmethod
    def _result_state(candidate):
        # An unavailable interpreter/pytest is not a failed candidate test.
        status = candidate.get('status')
        if status == 'passed':
            return 'candidate_passed'
        if status == 'failed':
            return 'candidate_failed'
        if status == 'evaluation_error':
            return 'evaluation_error'
        # Compatibility with older fake adapters / test payloads.
        code = candidate.get('exit_code')
        output = candidate.get('output', '')
        if 'No module named pytest' in output or code in (2, 3, 4, 5, 124, None):
            return 'evaluation_error'
        return 'candidate_passed' if code == 0 else 'candidate_failed'

    def _evaluate(self, ident, previous_state, baseline=None):
        if baseline is None:
            baseline = self._guest({'operation': 'test', 'id': ident, 'kind': 'baseline'})
        candidate = self._guest({'operation': 'test', 'id': ident, 'kind': 'candidate'})
        state = self._result_state(candidate)
        self._record_evaluation(ident, previous_state, state, baseline, candidate)
        self._update(ident, state,
                     baseline_json=json.dumps(baseline),
                     candidate_json=json.dumps(candidate), error=None)
        self.store.emit('implementation.evaluated', {
            'run_id': ident, 'state': state,
            'baseline_status': baseline.get('status'),
            'candidate_status': candidate.get('status'),
            'baseline_exit': baseline.get('exit_code'),
            'candidate_exit': candidate.get('exit_code')})
        return self.get(ident)

    def start(self, plan_id, project):
        if not self.lock.acquire(blocking=False):
            raise ValueError('Implementation already in progress')
        if not self.runtime.active.acquire(blocking=False):
            self.lock.release()
            raise ValueError('Hermes is busy')
        ident = str(uuid4())
        try:
            plan = self.planner.get(plan_id)
            if not plan:
                raise KeyError('Plan not found')
            # Preserve the HL-FLOW-001 approval gate.
            if plan.get('state') != 'approved':
                raise ValueError('Plan is not approved for implementation')
            if not isinstance(project, str) or not re.fullmatch(
                    r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}', project) or project in ('.', '..'):
                raise ValueError('Invalid project name')
            report = json.loads(plan['report'])
            stamp = now()
            with self.store.lock:
                if self.store.connection.execute(
                    'SELECT 1 FROM implementation_runs WHERE plan_id=?', (plan_id,)).fetchone():
                    raise ValueError('Plan already has an implementation run')
                self.store.connection.execute('''INSERT INTO implementation_runs
                    (id,plan_id,project,state,created_at,updated_at)
                    VALUES(?,?,?,?,?,?)''',
                    (ident, plan_id, project, 'preparing', stamp, stamp))
                self.store.connection.commit()
            self.store.emit('implementation.started', {'run_id': ident, 'plan_id': plan_id})
            paths = self._guest({'operation': 'prepare', 'project': project, 'id': ident})
            self._update(ident, 'testing_baseline',
                         candidate_path=paths['candidate'], baseline_path=paths['baseline'])
            # FLOW-007B: an unusable environment fails the run before any agent work is spent,
            # and it is reported as an environment failure rather than a candidate result.
            self._ensure_environment(ident)
            baseline = self._guest({'operation': 'test', 'id': ident, 'kind': 'baseline'})
            self._update(ident, 'implementing', baseline_json=json.dumps(baseline))
            criteria = report['acceptance_criteria']
            prompt = ('Implement this REVIEWED plan in the isolated candidate workspace ONLY: '
                + paths['candidate'] + ' . '
                'Never edit the original /home/hermes/projects directory, baseline workspace, host, or Hermes Life infrastructure. '
                'Do not change the tests merely to achieve a passing result. Work only in the candidate directory. '
                'Plan: ' + json.dumps({'summary': report['summary'],
                                      'steps': report['steps'],
                                      'acceptance_criteria': criteria}))
            result = self.runtime.adapter.run(prompt, lambda k, v: self.store.emit(k, v))
            self._update(ident, 'evaluating', response=result.get('result', ''))
            return self._evaluate(ident, 'evaluating', baseline)
        except Exception as exc:
            if self.get(ident):
                self._update(ident, 'failed', error=str(exc)[:2000])
            self.store.emit('implementation.failed',
                            {'run_id': ident, 'error': str(exc)[:300]})
            raise
        finally:
            self.runtime.active.release()
            self.lock.release()

    def reevaluate(self, ident):
        """Re-run only the fixed independent tests in existing experiment copies."""
        if not self.lock.acquire(blocking=False):
            raise ValueError('Implementation already in progress')
        if not self.runtime.active.acquire(blocking=False):
            self.lock.release()
            raise ValueError('Hermes is busy')
        try:
            row = self.get(ident)
            if not row:
                raise KeyError('Implementation not found')
            if row['state'] not in ('candidate_failed', 'candidate_passed', 'evaluation_error'):
                raise ValueError('Implementation is not eligible for reevaluation')
            # Candidate and baseline must already have been prepared. The guest
            # helper independently verifies the fixed experiments root and run ID.
            if not row['candidate_path'] or not row['baseline_path']:
                raise ValueError('Implementation has no prepared workspaces')
            before = row['state']
            # Preserve the prior recorded evaluation before overwriting the
            # original *_json columns. Older records predate history support.
            if not self.evaluations(ident):
                try:
                    old_baseline = json.loads(row['baseline_json']) if row['baseline_json'] else {}
                    old_candidate = json.loads(row['candidate_json']) if row['candidate_json'] else {}
                except (ValueError, TypeError):
                    old_baseline, old_candidate = {}, {}
                self._record_evaluation(ident, before, before, old_baseline, old_candidate)
            # FLOW-007B: reuse the recorded environment, rebuilding it when its interpreter is
            # gone. A changed or missing environment must not destroy a reviewable candidate;
            # a failure here leaves the previous state intact.
            self._ensure_environment(ident)
            self._update(ident, 'evaluating')
            self.store.emit('implementation.reevaluation_started', {'run_id': ident})
            try:
                return self._evaluate(ident, before)
            except Exception as exc:
                self._update(ident, before, error='Reevaluation failed: ' + str(exc)[:1800])
                self.store.emit('implementation.reevaluation_failed',
                                {'run_id': ident, 'error': str(exc)[:300]})
                raise
        finally:
            self.runtime.active.release()
            self.lock.release()

    def _update(self, ident, state, **fields):
        allowed = {'candidate_path', 'baseline_path', 'baseline_json',
                   'candidate_json', 'response', 'error'}
        values = {k: v for k, v in fields.items() if k in allowed}
        columns = ['state=?', 'updated_at=?'] + [f'{k}=?' for k in values]
        with self.store.lock:
            self.store.connection.execute(
                'UPDATE implementation_runs SET ' + ','.join(columns) + ' WHERE id=?',
                [state, now(), *values.values(), ident])
            self.store.connection.commit()

    def apply_to_host(self, ident, confirmation):
        """Apply an accepted candidate to the registered host repository.

        Requires:
        - An 'accepted' review row for this run_id
        - The candidate diff still hashes to review.evidence_sha256
        - The host repo is at the recorded base commit with a clean tree
        - The provided confirmation phrase matches exactly

        On success, applies the diff to the host working tree (uncommitted)
        and records an audit event. A moved base invalidates the acceptance.
        """
        if not self.lock.acquire(blocking=False):
            raise ValueError('Implementation already in progress')
        if not self.runtime.active.acquire(blocking=False):
            self.lock.release()
            raise ValueError('Hermes is busy')
        try:
            run = self.get(ident)
            if not run:
                raise KeyError('Implementation not found')

            # 1. Require an accepted review
            review = self.runtime.store.connection.execute(
                'SELECT * FROM implementation_reviews WHERE run_id=?', (ident,)
            ).fetchone()
            if not review:
                raise ValueError('No review exists for this implementation')
            if review['decision'] != 'accepted':
                raise ValueError('Review decision is not "accepted"; cannot apply')

            # 2. Re-derive the candidate diff and verify SHA-256 matches review
            from .implementation_review import SNAPSHOT_GUEST
            import shlex, subprocess, json
            adapter = self.runtime.adapter
            if getattr(adapter, 'transport', None) != 'ssh':
                raise ValueError('VM SSH transport required for apply')
            command = adapter._ssh_base() + ['python3 -c ' + shlex.quote(SNAPSHOT_GUEST)]
            p = subprocess.run(command, input=json.dumps({'id': ident}), text=True,
                               capture_output=True, timeout=60)
            if p.returncode:
                raise RuntimeError('Snapshot guest failed: ' + p.stderr[-500:])
            snapshot = json.loads(p.stdout)
            actual_sha256 = snapshot['snapshot_sha256']
            if actual_sha256 != review['evidence_sha256']:
                raise ValueError('Candidate has changed since review; re-review required')

            # 3. Get project and host path
            project = run['project']
            project_row = self.runtime.store.connection.execute(
                'SELECT * FROM hl_projects WHERE name=?', (project,)
            ).fetchone()
            if not project_row:
                raise ValueError('Project not registered')
            if not project_row['host_path'] or not project_row['commit_hash']:
                raise ValueError('Project is not synchronized; sync first')

            # 4. Verify host repo is at base commit with clean tree
            host = Path(project_row['host_path']).resolve(strict=True)
            allowed_root = self.runtime.project_workspaces.allowed_root
            if not host.is_relative_to(allowed_root):
                raise ValueError('Registered host path is no longer permitted')

            # Use the existing git helper from project_workspaces
            git = self.runtime.project_workspaces._git
            host_head = git(['rev-parse', 'HEAD'], host).strip()
            if host_head != project_row['commit_hash']:
                raise ValueError('Host commit has changed since review; synchronize and re-review')
            status = git(['status', '--porcelain', '--untracked-files=all'], host).strip()
            if status:
                raise ValueError('Host working tree is not clean; commit or resolve changes first')

            # 5. Build the diff to apply (same as review snapshot but full diff)
            diff = snapshot.get('diff', '')
            if not diff.strip():
                raise ValueError('No changes to apply')

            # 6. Require confirmation phrase
            expected_confirmation = f'APPLY {project}'
            if confirmation != expected_confirmation:
                raise ValueError(f'Confirmation must be exactly: {expected_confirmation}')

            # 7. git apply --check then git apply
            import subprocess
            payload = diff.encode()
            for args in (['git', 'apply', '--check'], ['git', 'apply']):
                proc = subprocess.run(args, cwd=host, input=payload,
                                      capture_output=True, timeout=40)
                if proc.returncode:
                    raise ValueError('Could not apply reviewed changes: ' +
                                     proc.stderr.decode(errors='replace')[-700:])

            # 8. Record applied state and emit event
            stamp = now()
            with self.store.lock:
                self.store.connection.execute('''UPDATE implementation_runs
                    SET state='applied', updated_at=?, applied_at=?, apply_sha256=?
                    WHERE id=?''', (stamp, stamp, actual_sha256, ident))
                self.store.connection.commit()

            self.store.emit('implementation.applied', {
                'run_id': ident, 'project': project,
                'base_commit': project_row['commit_hash'],
                'apply_sha256': actual_sha256,
                'host_path': str(host)
            })

            return {'status': 'applied', 'run_id': ident, 'project': project,
                    'base_commit': project_row['commit_hash'],
                    'apply_sha256': actual_sha256,
                    'host_path': str(host),
                    'note': 'Files changed in host working tree; changes were not committed'}

        except Exception as exc:
            self.store.emit('implementation.apply_failed', {'run_id': ident, 'error': str(exc)[:300]})
            raise
        finally:
            self.runtime.active.release()
            self.lock.release()

    def apply_preview(self, ident):
        """Return the diff that would be applied, without applying it."""
        run = self.get(ident)
        if not run:
            raise KeyError('Implementation not found')

        # Require an accepted review
        review = self.runtime.store.connection.execute(
            'SELECT * FROM implementation_reviews WHERE run_id=?', (ident,)
        ).fetchone()
        if not review:
            raise ValueError('No review exists for this implementation')
        if review['decision'] != 'accepted':
            raise ValueError('Review decision is not "accepted"')

        # Re-derive snapshot to get the diff
        from .implementation_review import SNAPSHOT_GUEST
        import shlex, subprocess, json
        adapter = self.runtime.adapter
        if getattr(adapter, 'transport', None) != 'ssh':
            raise ValueError('VM SSH transport required')
        command = adapter._ssh_base() + ['python3 -c ' + shlex.quote(SNAPSHOT_GUEST)]
        p = subprocess.run(command, input=json.dumps({'id': ident}), text=True,
                           capture_output=True, timeout=60)
        if p.returncode:
            raise RuntimeError('Snapshot guest failed: ' + p.stderr[-500:])
        snapshot = json.loads(p.stdout)

        if snapshot['snapshot_sha256'] != review['evidence_sha256']:
            raise ValueError('Candidate has changed since review; re-review required')

        project = run['project']
        project_row = self.runtime.store.connection.execute(
            'SELECT * FROM hl_projects WHERE name=?', (project,)
        ).fetchone()
        if not project_row:
            raise ValueError('Project not registered')

        # Check host state
        host = Path(project_row['host_path']).resolve(strict=True)
        allowed_root = self.runtime.project_workspaces.allowed_root
        if not host.is_relative_to(allowed_root):
            raise ValueError('Registered host path is no longer permitted')

        git = self.runtime.project_workspaces._git
        host_head = git(['rev-parse', 'HEAD'], host).strip()
        status = git(['status', '--porcelain', '--untracked-files=all'], host).strip()

        return {
            'run_id': ident,
            'project': project,
            'base_commit': project_row['commit_hash'],
            'host_head': host_head,
            'host_clean': not bool(status),
            'apply_sha256': snapshot['snapshot_sha256'],
            'review_sha256': review['evidence_sha256'],
            'diff': snapshot.get('diff', ''),
            'changed_files': snapshot.get('changed_files', 0),
            'truncated': snapshot.get('truncated', False),
            'can_apply': (host_head == project_row['commit_hash'] and not status),
            'blockers': [] if (host_head == project_row['commit_hash'] and not status)
                        else ['host_commit_changed' if host_head != project_row['commit_hash'] else 'host_working_tree_dirty']
        }
