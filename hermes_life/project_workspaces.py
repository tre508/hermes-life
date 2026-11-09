"""Phase 4.11 project registry and isolated, Git-backed VM workspaces.

No direct host source writes. Each synchronization creates a new immutable-base
checkout; modifications in the VM are reviewable via `git diff`.
"""
from __future__ import annotations
import hashlib
import json
import os
import re
import shlex
import subprocess
import tempfile
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

SLUG = re.compile(r'^[a-z][a-z0-9-]{1,47}$')
SELECTOR = re.compile(r'^\s*@project\s+([a-z][a-z0-9-]{1,47})(?:\s|$)', re.I)

class ProjectInput(BaseModel):
    name: str = Field(min_length=2, max_length=48)
    host_path: str = Field(min_length=1, max_length=1024)
    spec_path: str | None = None

class WorkspaceError(ValueError): pass


def workspace_dest(name, commit):
    """Absolute worker path for a project snapshot; the worker home comes from guest_env."""
    from .guest_env import WORKSPACES_ROOT
    return f'{WORKSPACES_ROOT}/{name}/{commit[:16]}'

class ProjectWorkspaces:
    def __init__(self, runtime):
        self.runtime = runtime
        self.lock = threading.RLock()
        self.allowed_root = Path(os.environ.get('HERMES_LIFE_PROJECT_ROOT', str(Path.home()/'Apps'))).resolve()
        with runtime.store.lock:
            runtime.store.connection.execute('''CREATE TABLE IF NOT EXISTS hl_projects (
                name TEXT PRIMARY KEY, host_path TEXT NOT NULL, spec_path TEXT,
                vm_path TEXT, commit_hash TEXT, synced_at TEXT)''')
            runtime.store.connection.commit()

    def _read(self, name):
        with self.runtime.store.lock:
            row=self.runtime.store.connection.execute('SELECT * FROM hl_projects WHERE name=?',(name,)).fetchone()
        if not row: raise WorkspaceError('Unknown project: '+str(name))
        return dict(row)

    def list(self):
        with self.runtime.store.lock:
            return [dict(r) for r in self.runtime.store.connection.execute('SELECT * FROM hl_projects ORDER BY name')]

    def register(self, name, host_path, spec_path=None):
        if not SLUG.fullmatch(name): raise WorkspaceError('Invalid project name (lowercase letters, digits, hyphens)')
        root=Path(host_path).expanduser().resolve(strict=True)
        if not root.is_dir() or not root.is_relative_to(self.allowed_root):
            raise WorkspaceError('Project must be a directory under '+str(self.allowed_root))
        top=self._git(['rev-parse','--show-toplevel'],root).strip()
        if Path(top).resolve()!=root:raise WorkspaceError('Path must be the repository root')
        if spec_path:
            p=(root/spec_path).resolve(strict=True)
            if not p.is_file() or not p.is_relative_to(root):raise WorkspaceError('Specification must be a file inside the repository')
            spec_path=str(p.relative_to(root))
        with self.runtime.store.lock:
            db=self.runtime.store.connection
            row=db.execute('SELECT host_path FROM hl_projects WHERE name=?',(name,)).fetchone()
            if row and Path(row['host_path']) != root:
                raise WorkspaceError('Project name already registered to a different repository')
            db.execute('INSERT INTO hl_projects (name,host_path,spec_path) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET spec_path=excluded.spec_path', (name,str(root),spec_path))
            db.commit()
        return self._read(name)

    @staticmethod
    def _git(args, cwd):
        p=subprocess.run(['git',*args],cwd=cwd,text=True,capture_output=True,timeout=35)
        if p.returncode:raise WorkspaceError('Git: '+p.stderr.strip()[-350:])
        return p.stdout

    def _remote(self):
        # Traverse existing adapter wrappers without changing their behavior.
        obj=self.runtime.adapter
        for _ in range(5):
            if getattr(obj,'transport',None)=='ssh' and hasattr(obj,'_ssh_base'):
                return obj._ssh_base()
            obj=getattr(obj,'delegate',None)
            if obj is None:break
        raise WorkspaceError('Hermes SSH transport is unavailable')

    def _ssh(self, shell_script):
        p=subprocess.run(self._remote()+['sh -c '+shlex.quote(shell_script)],text=True,capture_output=True,timeout=90)
        if p.returncode:raise WorkspaceError('VM: '+p.stderr[-450:])
        return p.stdout.strip()

    def sync(self,name):
        with self.lock:
            project=self._read(name)
            root=Path(project['host_path'])
            if not root.is_dir() or root.resolve()!=root or not root.is_relative_to(self.allowed_root):
                raise WorkspaceError('Registered path no longer valid')
            # A bundle only includes commits. Never quietly omit uncommitted work.
            if self._git(['status','--porcelain','--untracked-files=all'],root).strip():
                raise WorkspaceError('Host repository has uncommitted or untracked files; commit or clean before sync')
            commit=self._git(['rev-parse','HEAD'],root).strip()
            dest=workspace_dest(name, commit)
            if project.get('vm_path')==dest:
                return project
            # Use Git bundle for a snapshot including history, without mounting host files.
            with tempfile.TemporaryDirectory(prefix='hermes-project-') as tmp:
                bundle=Path(tmp)/'project.bundle'
                self._git(['bundle','create',str(bundle),'--all'],root)
                remote_bundle=f'/tmp/hermes-project-{name}-{commit[:16]}.bundle'
                # _ssh_base includes options followed by user@host; SCP needs host/key params separately.
                adapter=self.runtime.adapter
                while hasattr(adapter,'delegate'):adapter=adapter.delegate
                host=f'{adapter.user}@{adapter.host}'
                scp=['scp','-o','BatchMode=yes','-o','ConnectTimeout=12','-P',str(adapter.port or 22),'-i',str(adapter.identity_file),str(bundle),f'{host}:{remote_bundle}']
                up=subprocess.run(scp,text=True,capture_output=True,timeout=120)
                if up.returncode:raise WorkspaceError('Upload: '+up.stderr[-450:])
                command=(f'set -eu; mkdir -p {workspace_dest(name, commit).rsplit("/", 1)[0]}; '
                         f'if [ ! -d {shlex.quote(dest)}/.git ]; then '
                         f'git clone --quiet {shlex.quote(remote_bundle)} {shlex.quote(dest)}; fi; '
                         f'test "$(git -C {shlex.quote(dest)} rev-parse HEAD)" = {shlex.quote(commit)}; '
                         f'rm -f {shlex.quote(remote_bundle)}')
                self._ssh(command)
            with self.runtime.store.lock:
                self.runtime.store.connection.execute('UPDATE hl_projects SET vm_path=?,commit_hash=?,synced_at=CURRENT_TIMESTAMP WHERE name=?',(dest,commit,name))
                self.runtime.store.connection.commit()
            return self._read(name)

    def context(self,name,read_only=False):
        project=self._read(name)
        if not project['vm_path']:
            raise WorkspaceError('Project is not synchronized; POST /api/projects/'+name+'/sync first')
        spec=(f"Project requirements: {project['vm_path']}/{project['spec_path']}\n" if project['spec_path'] else '')
        # HL-AUTO-004: the workspace instruction must match the enforced scope.
        authority=('This is a READ-ONLY task: inspect this workspace and report evidence. '
                   'Do not modify it, install packages, or change system settings.\n'
                   if read_only else
                   'Work ONLY inside this VM workspace. You may investigate, modify and run tests there. '
                   'Do not modify host paths or apply/deploy results. Report changed files, verification results and remaining risks. '
                   'Edits are provisional until separately reviewed.\n')
        return ('[Hermes Life selected project workspace]\n'
                f"Project: {name}\nWorkspace: {project['vm_path']}\n"
                f"Base commit: {project['commit_hash']}\n{spec}"
                + authority +
                '[/Project workspace]\n\n')

    def changes(self,name):
        p=self._read(name)
        if not p['vm_path']:raise WorkspaceError('No synchronized workspace')
        root=shlex.quote(p['vm_path'])
        # Binary patch output is bounded; untracked files are reported rather than silently omitted.
        script=(f'set -eu; cd {root}; echo ---GIT-STATUS---; '
                f'git status --porcelain; echo ---GIT-DIFF---; '
                f'git diff --binary HEAD; echo ---END-DIFF---')

        output=self._ssh(script)
        if len(output)>500_000:raise WorkspaceError('Patch too large for API; review through Git in VM')
        return {'project':name,'base_commit':p['commit_hash'],'workspace':p['vm_path'],'output':output}


def add_project_routes(app, runtime, manager):
    router=APIRouter(prefix='/api/projects',tags=['projects'])
    def handle(fn,*args):
        try:return fn(*args)
        except (WorkspaceError,OSError,subprocess.TimeoutExpired) as exc:
            raise HTTPException(status_code=409,detail=str(exc)) from exc
    @router.get('')
    def listing():return {'projects':manager.list()}
    @router.post('',status_code=201)
    def register(payload:ProjectInput):return handle(manager.register,payload.name,payload.host_path,payload.spec_path)
    @router.post('/{name}/sync')
    def sync(name:str):return handle(manager.sync,name)
    @router.get('/{name}/changes')
    def changes(name:str):return handle(manager.changes,name)
    app.include_router(router)
