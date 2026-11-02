"""Review/apply immutable VM workspace diffs to registered host Git repositories."""
from __future__ import annotations
import hashlib
import os
import secrets
import shlex
import subprocess
import threading
import time
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from .project_workspaces import WorkspaceError

class Approve(BaseModel):
    review_id: str
    confirmation: str

class ProjectApprovals:
    def __init__(self, manager):
        self.manager = manager
        self.lock = threading.RLock()
        self.reviews = {}  # ephemeral: restart requires a fresh review

    def _snapshot(self, name):
        p = self.manager._read(name)
        if not p.get('vm_path') or not p.get('commit_hash'):
            raise WorkspaceError('Synchronize this project before reviewing changes')
        # Verify the current VM HEAD equals the synchronized immutable base.
        root = shlex.quote(p['vm_path'])
        output = self.manager._ssh(f'''set -eu
cd {root}
test "$(git rev-parse HEAD)" = {shlex.quote(p['commit_hash'])}
git add -N -- .
printf '%s\\n' __HERMES_PATCH_BEGIN__
git diff --binary HEAD
printf '%s\\n' __HERMES_PATCH_END__
''')
        marker = '__HERMES_PATCH_BEGIN__\n'
        if marker not in output:
            raise WorkspaceError('Could not extract VM Git changes')
        diff = output.split(marker, 1)[1].rsplit('__HERMES_PATCH_END__',1)[0]
        if not diff.strip():
            raise WorkspaceError('No source changes to review')
        if len(diff.encode()) > 1_500_000:
            raise WorkspaceError('Diff is too large for in-app review')
        # Detect symlinks/submodules; only regular files can be applied from the UI.
        if any(x in diff for x in ('new file mode 120000', 'new file mode 160000', 'old mode 120000', 'old mode 160000', 'new mode 160000')):
            raise WorkspaceError('Symlink or submodule changes need manual Git review')
        return p, diff

    def review(self, name):
        with self.lock:
            p, diff = self._snapshot(name)
            digest = hashlib.sha256(diff.encode()).hexdigest()
            review_id = secrets.token_urlsafe(24)
            self.reviews[review_id] = dict(name=name, digest=digest, base=p['commit_hash'], issued=time.monotonic())
            # Bound in-memory token table.
            for key, rec in list(self.reviews.items()):
                if time.monotonic()-rec['issued'] > 900:
                    self.reviews.pop(key, None)
            return {'review_id': review_id, 'project': name, 'base_commit': p['commit_hash'],
                    'sha256': digest, 'diff': diff, 'confirmation_required': f'APPLY {name}',
                    'expires_in_seconds': 900}

    def apply(self, name, data: Approve):
        with self.lock:
            rec = self.reviews.pop(data.review_id, None)
            if not rec or rec['name'] != name or time.monotonic()-rec['issued'] > 900:
                raise WorkspaceError('Review has expired. Request a new review')
            if data.confirmation != f'APPLY {name}':
                raise WorkspaceError('Confirmation phrase does not match')
            p, diff = self._snapshot(name)
            if p['commit_hash'] != rec['base'] or hashlib.sha256(diff.encode()).hexdigest() != rec['digest']:
                raise WorkspaceError('VM content or synchronized base changed. Review again')
            host = Path(p['host_path']).resolve(strict=True)
            if not host.is_relative_to(self.manager.allowed_root):
                raise WorkspaceError('Registered host path is no longer permitted')
            if self.manager._git(['rev-parse','HEAD'],host).strip() != rec['base']:
                raise WorkspaceError('Host commit has changed. Synchronize and review again')
            if self.manager._git(['status','--porcelain','--untracked-files=all'],host).strip():
                raise WorkspaceError('Host working tree is not clean. Commit or resolve changes before applying')
            payload = diff.encode()
            for args in (['git','apply','--check'], ['git','apply']):
                proc = subprocess.run(args, cwd=host, input=payload, capture_output=True, timeout=40)
                if proc.returncode:
                    raise WorkspaceError('Could not apply reviewed changes: '+proc.stderr.decode(errors='replace')[-700:])
            return {'status':'applied', 'project':name, 'base_commit':rec['base'],
                    'sha256':rec['digest'], 'host_path':str(host),
                    'note':'Files changed in host working tree; changes were not committed or deployed'}


def add_approval_routes(app, manager):
    approval=ProjectApprovals(manager)
    router=APIRouter(prefix='/api/projects',tags=['projects'])
    def handle(fn, *args):
        try:
            return fn(*args)
        except (WorkspaceError, OSError, subprocess.TimeoutExpired) as exc:
            raise HTTPException(status_code=409,detail=str(exc)) from exc
    @router.post('/{name}/review')
    def review(name: str): return handle(approval.review,name)
    @router.post('/{name}/apply')
    def apply(name: str, payload: Approve): return handle(approval.apply,name,payload)
    app.include_router(router)
