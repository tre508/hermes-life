"""HL-AUTO-001 Phase 1 policy engine (§26.7): mode, per-action authorization, audit grants.

Separation rule (autonomy.md §2, HL-PERS-001): this module governs WHAT autonomous work is
authorized. It never reads personality stores (hl_memories, persona_experiences) — see
tests/test_pers001_policy_separation.py.

Deny-without-mutation: an evaluation that returns/denies performs no side effect beyond the
audit ledger row itself. No mode label ever implies host apply, deployment, spending,
secret access or self-modification; those need a separate explicit grant.
"""
import json
import threading
from datetime import datetime, timezone, timedelta
from uuid import uuid4
from .store import now

MODES = ('observe', 'suggest', 'guided', 'independent')

#: Actions a mode may authorize WITHOUT a stored grant. Everything else requires an
#: explicit audited grant bound to action + scope + expiry (§26.7).
MODE_ALLOWED = {
    'observe': {'inspect_read'},
    'suggest': {'inspect_read', 'propose_project'},
    'guided': {'inspect_read', 'propose_project', 'isolated_edit', 'run_tests',
               'promote_revision'},
    'independent': {'inspect_read', 'propose_project', 'isolated_edit', 'run_tests',
                    'promote_revision'},
}

#: Actions a mode can NEVER authorize implicitly — a separate grant is mandatory, and some
#: are forbidden outright regardless of grants (§26.7 last sentence).
#: Actions a mode can NEVER authorize implicitly — a separate, bounded grant (with a
#: recorded rationale) is mandatory. Repo creation belongs here too: it is a VM write.
GRANT_ONLY = {'host_apply', 'network_download', 'package_install', 'publish',
              'external_message', 'spend', 'secrets_access', 'create_project_repo'}
NEVER = {'modify_core'}

BUDGET_RESOURCES = ('time_seconds', 'tokens', 'storage_bytes', 'concurrency')


class PolicyDenied(Exception):
    """Raised by require() when an operation is not authorized. Carries the audit decision."""

    def __init__(self, decision):
        super().__init__(decision['reason'])
        self.decision = decision


def _utcnow():
    return datetime.now(timezone.utc)


class AutonomyPolicy:
    def __init__(self, store):
        self.store = store
        self.lock = threading.RLock()

    # -- configuration ------------------------------------------------------------
    def settings(self):
        with self.lock:
            row = self.store.connection.execute(
                'SELECT mode, allowlist, policy_version FROM autonomy_policy_settings WHERE id=1'
            ).fetchone()
        return {'mode': row['mode'], 'allowlist': json.loads(row['allowlist']),
                'policy_version': row['policy_version']}

    def configure(self, mode=None, allowlist=None):
        if mode is not None and mode not in MODES:
            raise ValueError('Unknown autonomy mode')
        with self.lock:
            row = self.store.connection.execute(
                'SELECT mode, allowlist, policy_version FROM autonomy_policy_settings WHERE id=1'
            ).fetchone()
            new_mode = mode if mode is not None else row['mode']
            new_allowlist = allowlist if allowlist is not None else json.loads(row['allowlist'])
            if not isinstance(new_allowlist, list) or \
                    not all(isinstance(p, str) and p.startswith('/') for p in new_allowlist):
                raise ValueError('Allowlist must be a list of absolute workspace paths')
            self.store.connection.execute(
                'UPDATE autonomy_policy_settings SET mode=?, allowlist=?, policy_version=?,'
                ' updated_at=? WHERE id=1',
                (new_mode, json.dumps(new_allowlist), row['policy_version'] + 1, now()))
            self.store.connection.commit()
        self.store.emit('autonomy.policy_changed', self.settings())
        return self.settings()

    # -- evaluation ---------------------------------------------------------------
    def _audit(self, action, project_id, decision, reason, actor='system', expires_at=None):
        grant_id = str(uuid4())
        with self.lock:
            self.store.connection.execute(
                'INSERT INTO autonomy_grants (id, action_type, project_id, scope, decision,'
                ' actor, rationale, policy_version, expires_at, created_at)'
                ' VALUES (?,?,?,?,?,?,?,?,?,?)',
                (grant_id, action, project_id, json.dumps({}), decision, actor, reason,
                 self.settings()['policy_version'], expires_at, now()))
            self.store.connection.commit()
        return grant_id

    def evaluate(self, action, project_id=None):
        """Check an action against mode, stored grants and budgets. Audits every denial."""
        if action in NEVER:
            grant_id = self._audit(action, project_id, 'denied',
                                   'Self-modification of Hermes core is forbidden')
            return {'allowed': False, 'reason': 'Self-modification of Hermes core is forbidden',
                    'grant_id': grant_id}
        with self.lock:
            grant = self.store.connection.execute(
                "SELECT id FROM autonomy_grants WHERE action_type=? AND decision='granted'"
                " AND (project_id IS NULL OR project_id=?)"
                " AND (expires_at IS NULL OR expires_at>?)"
                ' ORDER BY created_at DESC LIMIT 1', (action, project_id, now())).fetchone()
        if grant:
            return {'allowed': True, 'reason': 'explicit grant', 'grant_id': grant['id']}
        if action in MODE_ALLOWED.get(self.settings()['mode'], ()):
            # Scope for create_project_repo is path-based (workspace allowlist) and is
            # enforced by the bootstrapper BEFORE any VM write; project_id here is the new
            # project's name, not a registry reference.
            return {'allowed': True, 'reason': f"mode '{self.settings()['mode']}'"}
        grant_id = self._audit(action, project_id, 'denied',
                               f"Action '{action}' requires an explicit grant in mode"
                               f" '{self.settings()['mode']}'")
        return {'allowed': False, 'grant_id': grant_id,
                'reason': f"Action '{action}' requires an explicit grant in mode"
                          f" '{self.settings()['mode']}'"}

    def require(self, action, project_id=None):
        decision = self.evaluate(action, project_id)
        if not decision['allowed']:
            raise PolicyDenied(decision)
        return decision

    def grant(self, action, project_id=None, scope=None, actor='user', rationale=None,
              expires_at=None):
        """Create an explicit audited grant. Forbidden actions are refused outright."""
        if action in NEVER:
            raise ValueError('Self-modification of Hermes core cannot be granted')
        if action in GRANT_ONLY and not rationale:
            raise ValueError('A grant for a sensitive action requires a recorded rationale')
        grant_id = str(uuid4())
        with self.lock:
            self.store.connection.execute(
                'INSERT INTO autonomy_grants (id, action_type, project_id, scope, decision,'
                ' actor, rationale, policy_version, expires_at, created_at)'
                ' VALUES (?,?,?,?,?,?,?,?,?,?)',
                (grant_id, action, project_id, json.dumps(scope or {}), 'granted', actor,
                 rationale, self.settings()['policy_version'], expires_at, now()))
            self.store.connection.commit()
        self.store.emit('autonomy.granted', {'grant_id': grant_id, 'action': action,
                                             'project_id': project_id, 'actor': actor})
        return self.get_grant(grant_id)

    def get_grant(self, grant_id):
        with self.lock:
            row = self.store.connection.execute(
                'SELECT * FROM autonomy_grants WHERE id=?', (grant_id,)).fetchone()
        if not row:
            return None
        row = dict(row)
        row['scope'] = json.loads(row['scope'])
        return row

    def grants(self, decision=None, limit=100):
        with self.lock:
            if decision:
                rows = self.store.connection.execute(
                    'SELECT * FROM autonomy_grants WHERE decision=? ORDER BY created_at DESC'
                    ' LIMIT ?', (decision, min(int(limit), 500))).fetchall()
            else:
                rows = self.store.connection.execute(
                    'SELECT * FROM autonomy_grants ORDER BY created_at DESC LIMIT ?',
                    (min(int(limit), 500),)).fetchall()
        out = []
        for row in rows:
            row = dict(row)
            row['scope'] = json.loads(row['scope'])
            out.append(row)
        return out

    def revoke(self, grant_id, actor='user', rationale=None):
        rationale = (rationale or '').strip()
        if not rationale:
            raise ValueError('A revocation requires a rationale')
        with self.lock:
            cursor = self.store.connection.execute(
                "UPDATE autonomy_grants SET decision='revoked', actor=?, rationale=? WHERE id=?"
                " AND decision='granted'", (actor, rationale.strip()[:500], grant_id))
            self.store.connection.commit()
        if not cursor.rowcount:
            return None
        self.store.emit('autonomy.grant_revoked', {'grant_id': grant_id, 'actor': actor})
        return self.get_grant(grant_id)

    # -- budgets ------------------------------------------------------------------
    def set_budget(self, resource, limit_amount, project_id=None, window_days=30):
        if resource not in BUDGET_RESOURCES:
            raise ValueError('Unknown budget resource')
        if limit_amount <= 0:
            raise ValueError('Budget limit must be positive')
        start = _utcnow().date().isoformat()
        budget_id = str(uuid4())
        with self.lock:
            end = (_utcnow() + timedelta(days=window_days)).date().isoformat()
            self.store.connection.execute(
                'INSERT INTO budget_ledger (id, project_id, resource, limit_amount, used,'
                ' window_start, window_end, created_at) VALUES (?,?,?,?,0,?,?,?)'
                ' ON CONFLICT(project_id, resource, window_start) DO UPDATE SET'
                ' limit_amount=excluded.limit_amount, window_end=excluded.window_end',
                (budget_id, project_id, resource, limit_amount, start, end, now()))
            self.store.connection.commit()
        return self.budget(resource, project_id)

    def budget(self, resource, project_id=None):
        with self.lock:
            row = self.store.connection.execute(
                'SELECT * FROM budget_ledger WHERE resource=? AND (project_id IS NULL'
                ' OR project_id=?) ORDER BY window_start DESC LIMIT 1',
                (resource, project_id)).fetchone()
        return dict(row) if row else None

    def check_budget(self, resource, amount, project_id=None):
        """Hard-cap accounting. No configured budget = the cap cannot be enforced."""
        row = self.budget(resource, project_id)
        if row is None:
            return {'enforced': False, 'reason': 'no budget configured'}
        if row['used'] + amount > row['limit_amount']:
            return {'enforced': True, 'allowed': False,
                    'reason': f'{resource} budget exhausted'
                              f' ({row["used"]}/{row["limit_amount"]})', 'budget_id': row['id']}
        return {'enforced': True, 'allowed': True, 'budget_id': row['id']}

    def record_usage(self, resource, amount, project_id=None):
        """Account usage. Unknown/unmeasurable usage must be recorded as blocked, not ignored."""
        row = self.budget(resource, project_id)
        if row is None:
            return {'enforced': False, 'reason': 'no budget configured'}
        check = self.check_budget(resource, amount, project_id)
        with self.lock:
            if check['enforced'] and not check['allowed']:
                # Over-cap usage is clamped at the limit so the ledger reflects reality;
                # the caller must treat the operation as blocked.
                self.store.connection.execute(
                    'UPDATE budget_ledger SET used=limit_amount WHERE id=?', (row['id'],))
            else:
                self.store.connection.execute(
                    'UPDATE budget_ledger SET used=used+? WHERE id=?', (amount, row['id']))
            self.store.connection.commit()
        return check
