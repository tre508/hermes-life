"""HL-MAINT-001/002, HL-ENV-004: Experiment pruning and retention policy.

Database-driven prune service with dry-run preview, classification per §18.1,
and audit events. Never a silent janitor — all deletions are explicit and audited.
"""
from __future__ import annotations
import json
import shlex
import subprocess
import threading
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from .store import now
from .guest_env import EXPERIMENTS_ROOT

#: Guest script to enumerate /home/hermes/experiments with sizes and metadata.
#: Mirrors containment checks from guest_env.pathlib usage.
EXPERIMENTS_INVENTORY_GUEST = r'''
import json,os,pathlib,re,sys,time
EXPERIMENTS_ROOT="/home/hermes/experiments"
root=pathlib.Path(EXPERIMENTS_ROOT).resolve(strict=True)
def dir_size(p):
    total=0
    for f in p.rglob("*"):
        try:
            if f.is_file() and not f.is_symlink():
                total+=f.stat().st_size
        except OSError:
            pass
    return total
def dir_mtime(p):
    try:
        return max(f.stat().st_mtime for f in p.rglob("*") if f.is_file())
    except (ValueError,OSError):
        try:return p.stat().st_mtime
        except OSError:return 0
results=[]
for entry in root.iterdir():
    if entry.is_symlink():continue
    if not entry.is_dir():continue
    name=entry.name
    # Validate directory name patterns
    m=re.match(r'^(candidate|baseline|env|revision|revision-backup|revision-failed)-([0-9a-f-]{36})$',name)
    if not m:
        results.append({"name":name,"kind":"unrecognized","path":str(entry),"size_bytes":dir_size(entry),"mtime":dir_mtime(entry),"error":"Unrecognized directory pattern"})
        continue
    kind,id_part=m.group(1),m.group(2)
    size=dir_size(entry)
    mtime=dir_mtime(entry)
    results.append({"name":name,"kind":kind,"run_id":id_part,"path":str(entry),"size_bytes":size,"mtime":mtime})
print(json.dumps(results))
'''

# Classification per §18.1 table
@dataclass
class ExperimentEntry:
    name: str
    kind: str  # candidate, baseline, env, revision, revision-backup, revision-failed, unrecognized
    run_id: Optional[str]
    path: str
    size_bytes: int
    mtime: float
    age_days: float
    classification: str  # eligible, excluded, orphan, blocked
    reason: str
    owner_run_id: Optional[str] = None
    owner_attempt_id: Optional[str] = None

class MaintenanceService:
    def __init__(self, runtime):
        self.runtime = runtime
        self.store = runtime.store
        self._lock = threading.Lock()

    def _run_inventory(self) -> list[dict]:
        """Run the guest inventory script and return parsed results."""
        adapter = self.runtime.adapter
        if getattr(adapter, 'transport', None) != 'ssh':
            raise ValueError('VM SSH transport required for maintenance')
        command = adapter._ssh_base() + ['python3 -c ' + shlex.quote(EXPERIMENTS_INVENTORY_GUEST)]
        p = subprocess.run(command, capture_output=True, text=True, timeout=120)
        if p.returncode:
            raise RuntimeError('Inventory guest failed: ' + p.stderr[-500:])
        return json.loads(p.stdout)

    def _get_active_run_ids(self) -> set[str]:
        """Get run IDs that are still active (not in terminal state)."""
        with self.store.lock:
            rows = self.store.connection.execute(
                "SELECT id FROM implementation_runs WHERE state IN "
                "('preparing','testing_baseline','implementing','evaluating','interrupted')"
            ).fetchall()
            return {r['id'] for r in rows}

    def _get_active_attempt_ids(self) -> set[str]:
        """Get attempt IDs that are still active."""
        with self.store.lock:
            rows = self.store.connection.execute(
                "SELECT id FROM implementation_revisions WHERE state IN "
                "('running','promoting','verifying','rollback_pending')"
            ).fetchall()
            return {r['id'] for r in rows}

    def _get_all_run_ids(self) -> set[str]:
        """Get all run IDs from implementation_runs."""
        with self.store.lock:
            rows = self.store.connection.execute("SELECT id FROM implementation_runs").fetchall()
            return {r['id'] for r in rows}

    def _get_all_attempt_ids(self) -> set[str]:
        """Get all attempt IDs from implementation_revisions."""
        with self.store.lock:
            rows = self.store.connection.execute("SELECT id FROM implementation_revisions").fetchall()
            return {r['id'] for r in rows}

    def _get_environment_run_ids(self) -> set[str]:
        """Get run IDs that have environment records."""
        with self.store.lock:
            rows = self.store.connection.execute("SELECT run_id FROM implementation_environments").fetchall()
            return {r['run_id'] for r in rows}

    def _classify_entries(self, raw_entries: list[dict], older_than_days: float) -> list[ExperimentEntry]:
        """Classify each entry per §18.1 retention policy."""
        active_run_ids = self._get_active_run_ids()
        active_attempt_ids = self._get_active_attempt_ids()
        all_run_ids = self._get_all_run_ids()
        all_attempt_ids = self._get_all_attempt_ids()
        env_run_ids = self._get_environment_run_ids()

        cutoff_time = time.time() - (older_than_days * 86400)
        entries = []

        for raw in raw_entries:
            kind = raw['kind']
            run_id = raw.get('run_id')
            path = raw['path']
            size = raw['size_bytes']
            mtime = raw['mtime']
            age_days = (time.time() - mtime) / 86400 if mtime > 0 else 0

            # Default values
            classification = 'orphan'
            reason = 'Unrecognized or unmatched directory'
            owner_run_id = run_id
            owner_attempt_id = None

            if kind == 'unrecognized':
                classification = 'orphan'
                reason = 'Directory name does not match any known experiment pattern'
                owner_run_id = None

            elif kind in ('candidate', 'baseline', 'env'):
                if run_id in active_run_ids:
                    classification = 'blocked'
                    reason = f'Run {run_id} is still active (state not terminal)'
                elif run_id not in all_run_ids:
                    classification = 'orphan'
                    reason = f'Run {run_id} not found in database'
                elif mtime > cutoff_time:
                    classification = 'excluded'
                    reason = f'Younger than {older_than_days} days'
                else:
                    classification = 'eligible'
                    reason = f'Run {run_id} is terminal and older than {older_than_days} days'

            elif kind in ('revision', 'revision-backup', 'revision-failed'):
                if run_id in active_attempt_ids:
                    classification = 'blocked'
                    reason = f'Revision attempt {run_id} is still active'
                elif run_id not in all_attempt_ids:
                    classification = 'orphan'
                    reason = f'Revision attempt {run_id} not found in database'
                elif mtime > cutoff_time:
                    classification = 'excluded'
                    reason = f'Younger than {older_than_days} days'
                else:
                    classification = 'eligible'
                    reason = f'Revision attempt {run_id} is terminal and older than {older_than_days} days'
                owner_attempt_id = run_id
                # Find the parent run_id for the attempt
                with self.store.lock:
                    row = self.store.connection.execute(
                        "SELECT run_id FROM implementation_revisions WHERE id=?", (run_id,)
                    ).fetchone()
                    if row:
                        owner_run_id = row['run_id']

            entries.append(ExperimentEntry(
                name=raw['name'],
                kind=kind,
                run_id=run_id,
                path=path,
                size_bytes=size,
                mtime=mtime,
                age_days=round(age_days, 2),
                classification=classification,
                reason=reason,
                owner_run_id=owner_run_id,
                owner_attempt_id=owner_attempt_id
            ))

        return entries

    def preview(self, older_than_days: float = 30) -> dict:
        """Dry-run preview: return classified entries without deleting anything."""
        raw_entries = self._run_inventory()
        classified = self._classify_entries(raw_entries, older_than_days)

        eligible = [e for e in classified if e.classification == 'eligible']
        excluded = [e for e in classified if e.classification == 'excluded']
        blocked = [e for e in classified if e.classification == 'blocked']
        orphans = [e for e in classified if e.classification == 'orphan']

        total_eligible_size = sum(e.size_bytes for e in eligible)
        total_excluded_size = sum(e.size_bytes for e in excluded)
        total_blocked_size = sum(e.size_bytes for e in blocked)
        total_orphan_size = sum(e.size_bytes for e in orphans)

        return {
            'older_than_days': older_than_days,
            'dry_run': True,
            'summary': {
                'total_entries': len(classified),
                'eligible_count': len(eligible),
                'eligible_size_bytes': total_eligible_size,
                'excluded_count': len(excluded),
                'excluded_size_bytes': total_excluded_size,
                'blocked_count': len(blocked),
                'blocked_size_bytes': total_blocked_size,
                'orphan_count': len(orphans),
                'orphan_size_bytes': total_orphan_size,
            },
            'entries': [asdict(e) for e in classified],
        }

    def prune(self, older_than_days: float = 30, confirm: bool = False) -> dict:
        """Execute pruning: delete eligible entries and emit audit events.

        Requires confirm=True to actually delete. Without it, returns preview.
        """
        if not confirm:
            return self.preview(older_than_days)

        raw_entries = self._run_inventory()
        classified = self._classify_entries(raw_entries, older_than_days)

        eligible = [e for e in classified if e.classification == 'eligible']
        deleted = []
        errors = []

        for entry in eligible:
            try:
                # Run deletion on the VM
                adapter = self.runtime.adapter
                if getattr(adapter, 'transport', None) != 'ssh':
                    raise ValueError('VM SSH transport required')
                # Use rm -rf via SSH
                command = adapter._ssh_base() + ['rm -rf ' + shlex.quote(entry.path)]
                p = subprocess.run(command, capture_output=True, text=True, timeout=60)
                if p.returncode:
                    raise RuntimeError(f'Deletion failed: {p.stderr[-300:]}')

                deleted.append({
                    'name': entry.name,
                    'kind': entry.kind,
                    'run_id': entry.run_id,
                    'size_bytes': entry.size_bytes,
                    'path': entry.path,
                })

                # Emit audit event
                self.store.emit('maintenance.deleted', {
                    'name': entry.name,
                    'kind': entry.kind,
                    'run_id': entry.run_id,
                    'size_bytes': entry.size_bytes,
                    'age_days': entry.age_days,
                    'owner_run_id': entry.owner_run_id,
                    'owner_attempt_id': entry.owner_attempt_id,
                })

            except Exception as exc:
                errors.append({'name': entry.name, 'error': str(exc)[:300]})

        # Also emit a summary event
        self.store.emit('maintenance.prune_completed', {
            'older_than_days': older_than_days,
            'deleted_count': len(deleted),
            'deleted_size_bytes': sum(d['size_bytes'] for d in deleted),
            'errors': errors,
        })

        return {
            'older_than_days': older_than_days,
            'dry_run': False,
            'deleted': deleted,
            'errors': errors,
            'summary': {
                'deleted_count': len(deleted),
                'deleted_size_bytes': sum(d['size_bytes'] for d in deleted),
                'error_count': len(errors),
            }
        }