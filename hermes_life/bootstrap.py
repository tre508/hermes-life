"""HL-AUTO-001 Phase 3 (§26.10): approved proposal -> isolated VM project bootstrap.

Gate order (§26.7): the proposal must be approved, the policy must authorize
create_project_repo for this project, and the target VM path must sit inside the configured
workspace allowlist. A denied proposal or denied policy check performs NO write anywhere —
the SSH transport is never even invoked. Partial initialization is rolled back: a directory
this bootstrap created is removed, and ambiguous outcomes become recovery_required.
"""
import hashlib
import json
import shlex
from uuid import uuid4
from .store import now
from .project_workspaces import SLUG


class BootstrapError(ValueError):
    pass


def _quoted_file(path, content):
    return f"printf '%s' {shlex.quote(content)} > {shlex.quote(path)}"


def _bootstrap_script(name, vm_path, spec, manifest):
    """Idempotent-safe: refuses to touch an existing path; returns the new base commit."""
    return f'''set -eu
TARGET={shlex.quote(vm_path)}
if [ -e "$TARGET" ]; then echo "EXISTS"; exit 3; fi
mkdir -p "$TARGET"
cd "$TARGET"
git init -q
{_quoted_file('SPEC.md', spec)}
{_quoted_file('requirements-manifest.json', manifest)}
git add -A
git -c user.email=hermes-life@localhost -c user.name='Hermes Life' commit -q -m {shlex.quote(f'Bootstrap project {name} from approved proposal')}
git rev-parse HEAD
'''


class ProjectBootstrapper:
    def __init__(self, store, policy, workspaces=None, ssh=None):
        self.store = store
        self.policy = policy
        self._workspaces = workspaces  # ProjectWorkspaces, used only for its transport
        self._ssh_override = ssh
        self.lock = store.lock

    def _ssh(self, script, timeout=90):
        if self._ssh_override is not None:
            return self._ssh_override(script)
        if self._workspaces is None:
            raise BootstrapError('No VM transport available for bootstrap')
        return self._workspaces._ssh(script)

    # -- validation ---------------------------------------------------------------
    def _check_allowlist(self, vm_path):
        allowlist = self.policy.settings()['allowlist']
        if not allowlist:
            raise BootstrapError(
                'No workspace allowlist is configured; autonomous repository creation'
                ' is not authorized anywhere')
        normalized = vm_path.rstrip('/') or '/'
        for entry in allowlist:
            if normalized == entry or normalized.startswith(entry.rstrip('/') + '/'):
                return
        raise BootstrapError(
            f'Target path {vm_path} is outside the configured workspace allowlist')

    def _record(self, bootstrap_id):
        with self.lock:
            row = self.store.connection.execute(
                'SELECT * FROM project_bootstraps WHERE id=?', (bootstrap_id,)).fetchone()
        row = dict(row)
        row['steps_done'] = json.loads(row['steps_done'])
        return row

    def _set_status(self, bootstrap_id, status, steps=None, error=None, spec_sha=None,
                    base_commit=None):
        with self.lock:
            sets, values = ['status=?', 'updated_at=?'], [status, now()]
            if steps is not None:
                sets.append('steps_done=?')
                values.append(json.dumps(steps))
            if error is not None:
                sets.append('error=?')
                values.append(str(error)[:800])
            if spec_sha is not None:
                sets.append('spec_sha256=?')
                values.append(spec_sha)
            if base_commit is not None:
                sets.append('base_commit=?')
                values.append(base_commit)
            values.append(bootstrap_id)
            self.store.connection.execute(
                f'UPDATE project_bootstraps SET {", ".join(sets)} WHERE id=?', values)
            self.store.connection.commit()
        return self._record(bootstrap_id)

    # -- bootstrap ----------------------------------------------------------------
    def bootstrap(self, proposal_id, project_name, vm_path, specification=None,
                  manifest=None):
        """Bootstrap an approved proposal into a fresh, isolated VM repository."""
        if not SLUG.fullmatch(project_name or ''):
            raise BootstrapError('Invalid project name (lowercase letters, digits, hyphens)')
        proposal = None
        with self.lock:
            row = self.store.connection.execute(
                'SELECT * FROM project_proposals WHERE id=?', (proposal_id,)).fetchone()
            if row:
                proposal = dict(row)
        if proposal is None:
            return None
        if proposal['status'] != 'approved':
            # Denied/unapproved proposal: no VM write, no registration — fail closed.
            raise BootstrapError(
                f"Proposal is '{proposal['status']}'; only an approved proposal may"
                ' bootstrap a project')
        # Idempotency: one bootstrap per proposal.
        with self.lock:
            existing = self.store.connection.execute(
                'SELECT id, status FROM project_bootstraps WHERE proposal_id=?',
                (proposal_id,)).fetchone()
        if existing:
            record = self._record(existing['id'])
            if existing['status'] == 'active':
                return record
            if existing['status'] == 'recovery_required':
                raise BootstrapError(
                    'Bootstrap is in recovery_required; resolve the ambiguous VM state'
                    ' before any retry')
            # A rolled_back or failed attempt left no project behind: supersede it so the
            # proposal is not deadlocked, and keep the ledger auditable via events.
            with self.lock:
                self.store.connection.execute(
                    'DELETE FROM project_bootstraps WHERE id=?', (existing['id'],))
                self.store.connection.commit()
            self.store.emit('project.bootstrap_superseded',
                            {'bootstrap_id': existing['id'],
                             'previous_status': existing['status']})
        # Policy gate — evaluated BEFORE any VM write.
        self.policy.require('create_project_repo', project_id=project_name)
        # Scope gate — also before any VM write.
        self._check_allowlist(vm_path)
        spec = (specification or proposal['specification'])
        manifest = manifest or json.dumps({'specs': [], 'inputs': {}, 'files': [],
                                           'includes': []})
        spec_sha = hashlib.sha256(spec.encode('utf-8')).hexdigest()
        bootstrap_id = str(uuid4())
        stamp = now()
        with self.lock:
            self.store.connection.execute(
                'INSERT INTO project_bootstraps (id, proposal_id, project_name, vm_path,'
                ' status, steps_done, spec_sha256, created_at, updated_at)'
                ' VALUES (?,?,?,?,?,?,?,?,?)',
                (bootstrap_id, proposal_id, project_name, vm_path, 'initializing', '[]',
                 spec_sha, stamp, stamp))
            self.store.connection.commit()
        self.store.emit('project.bootstrap_started',
                        {'bootstrap_id': bootstrap_id, 'proposal_id': proposal_id,
                         'project_name': project_name, 'vm_path': vm_path})
        script = _bootstrap_script(project_name, vm_path, spec, manifest)
        try:
            output = self._ssh(script)
        except Exception as exc:  # noqa: BLE001 — every failure path must be classified
            message = str(exc)
            if 'EXISTS' in message:
                # The path pre-existed and was NOT touched: nothing to roll back.
                self._set_status(bootstrap_id, 'failed', steps=['precheck'],
                                 error='Target path already exists; nothing was modified')
            else:
                # Ambiguous mid-flight failure: mark recovery, attempt bounded cleanup only
                # of a path this run created. Never delete blindly on unknown state.
                rolled_back = 'unknown'
                try:
                    probe = self._ssh(
                        f'if [ -d {shlex.quote(vm_path)} ] && [ ! -e {shlex.quote(vm_path)}/.git ];'
                        f' then rm -rf {shlex.quote(vm_path)}; echo cleaned;'
                        f' elif [ -e {shlex.quote(vm_path)} ]; then echo ambiguous;'
                        f' else echo absent; fi')
                    rolled_back = probe.strip().splitlines()[-1] if probe.strip() else 'unknown'
                except Exception:
                    pass
                status = ('rolled_back' if rolled_back == 'cleaned'
                          else 'recovery_required' if rolled_back in ('ambiguous', 'unknown')
                          else 'failed')
                self._set_status(bootstrap_id, status, steps=['precheck', 'provision'],
                                 error=message)
                self.store.emit('project.bootstrap_' + status,
                                {'bootstrap_id': bootstrap_id, 'proposal_id': proposal_id})
                if status == 'recovery_required':
                    raise BootstrapError(
                        f'Bootstrap failed mid-flight ({message[:200]}); state is'
                        ' recovery_required and further mutation is blocked until resolved')
            self.store.emit('project.bootstrap_failed',
                            {'bootstrap_id': bootstrap_id, 'proposal_id': proposal_id})
            return self._record(bootstrap_id)
        lines = [line for line in output.strip().splitlines() if line.strip()]
        base_commit = lines[-1].strip() if lines else None
        if not base_commit or len(base_commit) < 7:
            self._set_status(bootstrap_id, 'recovery_required', steps=['provision'],
                             error=f'Unusable bootstrap output: {output[:200]!r}')
            raise BootstrapError('Bootstrap could not confirm a base commit;'
                                 ' recovery_required')
        self._set_status(bootstrap_id, 'active', steps=['provision', 'commit'],
                         spec_sha=spec_sha, base_commit=base_commit)
        # Register the autonomous project identity.
        project_id = str(uuid4())
        with self.lock:
            self.store.connection.execute(
                'INSERT INTO autonomy_projects (id, name, origin, proposal_id, vm_path,'
                ' spec_sha256, status, created_at, updated_at)'
                ' VALUES (?,?,?,?,?,?,?,?,?)',
                (project_id, project_name, 'autonomous', proposal_id, vm_path, spec_sha,
                 'active', now(), now()))
            self.store.connection.commit()
        self.store.emit('project.bootstrap_completed',
                        {'bootstrap_id': bootstrap_id, 'project_id': project_id,
                         'proposal_id': proposal_id, 'base_commit': base_commit})
        record = self._record(bootstrap_id)
        record['project_id'] = project_id
        return record

    def list_bootstraps(self, limit=100):
        with self.lock:
            rows = self.store.connection.execute(
                'SELECT * FROM project_bootstraps ORDER BY created_at DESC LIMIT ?',
                (min(int(limit), 500),)).fetchall()
        out = []
        for row in rows:
            row = dict(row)
            row['steps_done'] = json.loads(row['steps_done'])
            out.append(row)
        return out

    def get_bootstrap(self, ident):
        for row in self.list_bootstraps(limit=500):
            if row['id'] == ident:
                return row
        return None

    def projects(self, origin=None, limit=100):
        with self.lock:
            if origin:
                rows = self.store.connection.execute(
                    'SELECT * FROM autonomy_projects WHERE origin=? ORDER BY created_at DESC'
                    ' LIMIT ?', (origin, min(int(limit), 500))).fetchall()
            else:
                rows = self.store.connection.execute(
                    'SELECT * FROM autonomy_projects ORDER BY created_at DESC LIMIT ?',
                    (min(int(limit), 500),)).fetchall()
        return [dict(row) for row in rows]

    def set_project_state(self, name, state):
        allowed = ('active', 'paused', 'blocked', 'cancelled', 'archived')
        if state not in allowed:
            raise ValueError('Unknown project state')
        with self.lock:
            cursor = self.store.connection.execute(
                'UPDATE autonomy_projects SET status=?, updated_at=? WHERE name=?',
                (state, now(), name))
            self.store.connection.commit()
        if not cursor.rowcount:
            return None
        self.store.emit('project.' + state, {'project_name': name})
        return self.project(name)

    def project(self, name):
        with self.lock:
            row = self.store.connection.execute(
                'SELECT * FROM autonomy_projects WHERE name=?', (name,)).fetchone()
        return dict(row) if row else None
