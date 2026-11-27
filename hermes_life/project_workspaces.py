"""Phase 4.11 project registry and isolated, Git-backed work-machine workspaces.

No direct host source writes through the SYNC pipeline: each synchronization creates
a new immutable-base checkout; modifications on the work machine are reviewable via
`git diff`. The chat UI's own file editor is the one deliberate exception and is
provisional by the same rule as the agent's edits — it writes the host working tree
UNCOMMITTED, so `changes()`/review shows the exact diff and Git remains the safety net.
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
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

SLUG = re.compile(r'^[a-z][a-z0-9-]{1,47}$')
SELECTOR = re.compile(r'^\s*@project\s+([a-z][a-z0-9-]{1,47})(?:\s|$)', re.I)

class ProjectInput(BaseModel):
    name: str = Field(min_length=2, max_length=48)
    host_path: str = Field(min_length=1, max_length=1024)
    spec_path: str | None = None

class ProjectCreate(BaseModel):
    name: str = Field(min_length=2, max_length=48)
    spec_path: str | None = None
    git: bool = False  # optional repository init; plain folder is the default

class FileWrite(BaseModel):
    path: str = Field(min_length=1, max_length=1024)
    content: str = ''
    #: Binary upload channel (e.g. chat-composer image attach). When set, takes
    #: precedence over `content` and skips the UTF-8 text validation — the bytes
    #: are written as-is under the same containment, size limit and atomicity.
    content_base64: str | None = None
    expected_mtime: float | None = None

class FileUpload(BaseModel):
    #: D6: project-free chat upload (images). The server picks the destination
    #: inside the primary allowed root; the client sends only the basename.
    filename: str = Field(min_length=1, max_length=255)
    content_base64: str

class PathIn(BaseModel):
    #: D2: new-directory creation inside a workspace.
    path: str = Field(min_length=1, max_length=1024)

class MoveIn(BaseModel):
    #: D2: rename/move inside a workspace. `source` → `target`; a same-parent
    #: target is a rename. Relative to the workspace root.
    source: str = Field(min_length=1, max_length=1024)
    target: str = Field(min_length=1, max_length=1024)

class WorkspaceError(ValueError): pass

# HL-CHAT-006: file-context manager. Whole-tree inspection must never silently
# pull junk or secrets, so the walk prunes a fixed denylist and caps volume.
DENY_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', 'venv', '.venv2',
             '.trash',  # soft-delete destination (user decision, 2026-11-25) — never listed, never readable as project files
             'dist', 'build', '.next', '.cache', '.mypy_cache', '.pytest_cache',
             '.ruff_cache', '.tox', '.idea', '.vscode', '.run', 'coverage'}
DENY_FILE = re.compile(r'(^\.env|\.env$|\.pem$|\.key$|\.p12$|\.pfx$|id_rsa|id_ed25519|'
                       r'\.keystore$|credential|secret|\.token|\.crt$|\.cer$|\.pem\b)', re.I)
MAX_TREE_ENTRIES = 3000
MAX_FILE_BYTES = 200_000
MAX_DEPTH = 12
#: Writes are bounded separately: an uploaded or edited text file may exceed the
#: read/attach cap (which exists to protect the model context), but must stay finite.
MAX_WRITE_BYTES = 1_000_000


def workspace_dest(name, commit):
    """Absolute worker path for a project snapshot; the worker home comes from guest_env."""
    from .guest_env import WORKSPACES_ROOT
    return f'{WORKSPACES_ROOT}/{name}/{commit[:16]}'

class ProjectWorkspaces:
    def __init__(self, runtime):
        self.runtime = runtime
        self.lock = threading.RLock()
        self.allowed_root = Path(os.environ.get('HERMES_LIFE_PROJECT_ROOT', str(Path.home()/'Apps'))).resolve()
        # Additional allowed roots (HERMES_LIFE_PROJECT_EXTRA_ROOTS, colon-separated):
        # project directories do not all live under ~/Apps. Registration stays
        # config-bounded — an arbitrary host path is still refused unless it sits
        # under one of these roots, so the agent's workspace reach never grows
        # because of a UI click.
        self.allowed_roots = [self.allowed_root]
        for raw in os.environ.get('HERMES_LIFE_PROJECT_EXTRA_ROOTS', '').split(':'):
            candidate = raw.strip()
            if candidate:
                self.allowed_roots.append(Path(candidate).expanduser().resolve())
        with runtime.store.lock:
            runtime.store.connection.execute('''CREATE TABLE IF NOT EXISTS hl_projects (
                name TEXT PRIMARY KEY, host_path TEXT NOT NULL, spec_path TEXT,
                remote_path TEXT, commit_hash TEXT, synced_at TEXT)''')
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
        if not root.is_dir() or not any(root.is_relative_to(allowed) for allowed in self.allowed_roots):
            raise WorkspaceError('Project must be a directory under an allowed root: '
                                 + ' or '.join(str(r) for r in self.allowed_roots))
        # Git is OPTIONAL (VS Code-style: any directory can be a workspace).
        # A non-git directory registers fine; sync/review then degrade with an
        # honest "no git repository" message instead of blocking registration.
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

    def create(self, name, spec_path=None, git=False):
        """Create a brand-new project: directory, README seed, register.

        Git is OPTIONAL (VS Code-style): a plain folder is the default, and
        git=True initializes a repository for projects that want sync/review.
        New projects are born under the PRIMARY allowed root — creating a
        directory is a write, and the primary root is the documented home for
        workspaces. Registration then runs the exact checks every other project
        passes, so a created project is indistinguishable from a registered one.
        """
        if not SLUG.fullmatch(name): raise WorkspaceError('Invalid project name (lowercase letters, digits, hyphens)')
        root = self.allowed_root / name
        if root.exists():
            if any(root.iterdir()):
                raise WorkspaceError('Directory already exists and is not empty')
        else:
            root.mkdir(parents=True)
        if git:
            self._git(['init', '-q'], root)
        readme = root / 'README.md'
        if not readme.exists():
            readme.write_text('# ' + name + '\n\nCreated from the Hermes Life project panel.\n', encoding='utf-8')
        return self.register(name, str(root), spec_path)

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
        if p.returncode:raise WorkspaceError('Work machine: '+p.stderr[-450:])
        return p.stdout.strip()

    def sync(self,name):
        with self.lock:
            project=self._read(name)
            root=Path(project['host_path'])
            if not root.is_dir() or root.resolve()!=root or not root.is_relative_to(self.allowed_root):
                raise WorkspaceError('Registered path no longer valid')
            if not (root/'.git').exists():
                raise WorkspaceError('No git repository here — sync/review need git. The workspace still works for browsing, reading, and attaching files.')
            # A bundle only includes commits. Never quietly omit uncommitted work.
            if self._git(['status','--porcelain','--untracked-files=all'],root).strip():
                raise WorkspaceError('Host repository has uncommitted or untracked files; commit or clean before sync')
            commit=self._git(['rev-parse','HEAD'],root).strip()
            dest=workspace_dest(name, commit)
            if project.get('remote_path')==dest:
                return project
            # Use Git bundle for a snapshot including history, without mounting host files.
            with tempfile.TemporaryDirectory(prefix='hermes-project-') as tmp:
                bundle=Path(tmp)/'project.bundle'
                self._git(['bundle','create',str(bundle),'--all'],root)
                remote_bundle=f'/tmp/hermes-project-{name}-{commit[:16]}.bundle'
                # _ssh_base includes options followed by user@host; SCP needs host/key params separately.
                # Reach the base adapter and fail as a clean WorkspaceError (409) when
                # no SSH transport exists, instead of an unwrapped AttributeError (500).
                adapter=self.runtime.adapter
                while hasattr(adapter,'delegate'):adapter=adapter.delegate
                if not all(hasattr(adapter,a) for a in ('user','host','port','identity_file')):
                    raise WorkspaceError('Hermes SSH transport is unavailable')
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
                self.runtime.store.connection.execute('UPDATE hl_projects SET remote_path=?,commit_hash=?,synced_at=CURRENT_TIMESTAMP WHERE name=?',(dest,commit,name))
                self.runtime.store.connection.commit()
            return self._read(name)

    def context(self,name,read_only=False):
        project=self._read(name)
        if project['remote_path']:
            workspace=f"{project['remote_path']}"
            base=f"Base commit: {project['commit_hash']}\n"
        else:
            # SSHFS architecture: no work machine exists, so the live host
            # repository IS the workspace. The attachment endpoints already
            # read host_path directly; the task path must agree with them.
            root=self._root(name)
            workspace=f'{root} (live host repository)'
            version=self._host_version(root)
            base=("Base commit: live host HEAD"
                  +(f" {version['commit']} ({'dirty' if version['dirty'] else 'clean'})" if version else '')+'\n')
        spec=(f"Project requirements: {workspace}/{project['spec_path']}\n" if project['spec_path'] else '')
        # HL-AUTO-004: the workspace instruction must match the enforced scope.
        authority=('This is a READ-ONLY task: inspect this workspace and report evidence. '
                   'Do not modify it, install packages, or change system settings.\n'
                   if read_only else
                   'Work inside this workspace. You may investigate, modify and run tests there. '
                   'Report changed files, verification results and remaining risks. '
                   'Edits are provisional until separately reviewed.\n')
        return ('[Hermes Life selected project workspace]\n'
                f"Project: {name}\nWorkspace: {workspace}\n"
                f"{base}{spec}"
                + authority +
                '[/Project workspace]\n\n')

    def changes(self,name):
        p=self._read(name)
        if p['remote_path']:
            root=p['remote_path']
            script=(f'set -eu; cd {shlex.quote(root)}; echo ---GIT-STATUS---; '
                    f'git status --porcelain; echo ---GIT-DIFF---; '
                    f'git diff --binary HEAD; echo ---END-DIFF---')
            output=self._ssh(script)
        else:
            # No work machine: run the same review locally against the live host repo.
            host=self._root(name)
            script=['sh','-c',
                    'echo ---GIT-STATUS---; git status --porcelain; echo ---GIT-DIFF---; '
                    'git diff --binary HEAD; echo ---END-DIFF---']
            run=subprocess.run(script,cwd=str(host),text=True,capture_output=True,timeout=90)
            if run.returncode:raise WorkspaceError('Git: '+run.stderr.strip()[-350:])
            output=run.stdout.strip()
        if len(output)>500_000:raise WorkspaceError('Patch too large for API; review through Git on the work machine')
        workspace=p['remote_path'] or str(self._root(name))+' (live host repository)'
        return {'project':name,'base_commit':p['commit_hash'],'workspace':workspace,'output':output}


    # --- HL-CHAT-006: file-context manager ---------------------------------

    def _root(self, name):
        project = self._read(name)
        root = Path(project['host_path'])
        if not root.is_dir() or root.resolve() != root or not root.is_relative_to(self.allowed_root):
            raise WorkspaceError('Registered path no longer valid')
        return root

    # --- §5: hosted-filesystem browse (attachment WITHOUT project registration) --

    def _contained(self, path):
        """Resolve a host path and prove it sits inside a configured allowed root.

        Attachment must not require registering a project (user brief §5), but it
        must not widen the agent's reach either: the boundary is still the
        configured roots, so a path outside them is refused here exactly as
        registration refuses it. resolve() also collapses `..` and follows
        symlinks, so a link pointing outside a root is refused, not followed.
        """
        raw = str(path or '').strip()
        target = Path(raw).expanduser() if raw else Path(self.allowed_root)
        if not target.is_absolute():
            target = self.allowed_root / target
        resolved = target.resolve()
        if any(resolved.is_relative_to(allowed) for allowed in self.allowed_roots):
            return resolved
        raise WorkspaceError('Path is outside the permitted roots: ' + str(resolved))

    def browse(self, path=None):
        """List ONE host directory under the permitted roots.

        One level per call — an on-demand browser, so a single click never walks a
        whole tree. The SAME denylist the reader applies is applied to entries, so
        secrets, VCS metadata and build junk are never offered for attachment.
        """
        target = self._contained(path)
        if not target.is_dir():
            raise WorkspaceError('Not a directory: ' + str(target))
        entries = []
        for entry in sorted(target.iterdir(), key=lambda p: p.name.lower()):
            name = entry.name
            try:
                is_dir = entry.is_dir()
            except OSError:
                continue
            if is_dir:
                if name in DENY_DIRS:
                    continue
            else:
                try:
                    if not entry.is_file():
                        continue
                except OSError:
                    continue
                if DENY_FILE.search(name):
                    continue
            item: dict[str, object] = {'name': name, 'path': str(entry), 'type': 'dir' if is_dir else 'file'}
            if not is_dir:
                try:
                    item['size'] = entry.stat().st_size
                except OSError:
                    item['size'] = None
            entries.append(item)
        # "Up one level" is offered only while the parent is still inside a root —
        # so the browser can never climb out of the permitted area.
        parent = None
        candidate = target.parent
        if any(candidate.is_relative_to(allowed) for allowed in self.allowed_roots):
            parent = str(candidate)
        return {'path': str(target), 'parent': parent,
                'roots': [str(r) for r in self.allowed_roots],
                'entries': entries}

    # --- D6: project-free uploads --------------------------------------------
    # Policy (user decision 2026-11-27): local uploads (chat images) no longer
    # require a registered project. The upload lands inside the SAME configured
    # boundary the picker browses — <primary allowed root>/hermes-uploads/ —
    # under the same denylist, size limit and atomic write as project writes.
    # The stored file is referenced by absolute host path; contents are never
    # injected and the upload grants no modification authority (spec §4.2).

    @staticmethod
    def _upload_dir():
        day = time.strftime('%Y%m%d')
        return Path('hermes-uploads') / day

    def upload(self, filename: str, content_base64: str):
        import base64 as base64_module
        raw = str(filename or '').strip()
        name = Path(raw).name
        # Refuse path tricks outright — never launder them into a safe name.
        if not name or name in ('.', '..') or raw != name or '/' in raw or '\\' in raw:
            raise WorkspaceError('Invalid upload filename')
        if DENY_FILE.search(name):
            raise WorkspaceError('Refused filename (denylist): ' + name)
        try:
            data = base64_module.b64decode(content_base64, validate=True)
        except Exception:
            raise WorkspaceError('Invalid base64 file content') from None
        if len(data) > MAX_WRITE_BYTES:
            raise WorkspaceError(f'File too large to write ({len(data)} bytes; limit {MAX_WRITE_BYTES})')
        dest_dir = self._contained(self._upload_dir())
        dest_dir.mkdir(parents=True, exist_ok=True)
        stem, suffix = Path(name).stem, Path(name).suffix
        target = dest_dir / name
        # A duplicate upload is disambiguated, never silently overwritten.
        for n in range(2, 1000):
            if not target.exists():
                break
            target = dest_dir / f'{stem}-{n}{suffix}'
        handle_fd, tmp_name = tempfile.mkstemp(dir=dest_dir, prefix='.hermes-write-', suffix='.tmp')
        tmp = Path(tmp_name)
        try:
            with os.fdopen(handle_fd, 'wb') as fh:
                fh.write(data)
            os.chmod(tmp, 0o644)
            os.replace(tmp, target)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        st = target.stat()
        self._emit_file_change('uploaded', '', str(target), mtime=st.st_mtime,
                               size=st.st_size)
        return {'path': str(target), 'name': target.name, 'size': st.st_size, 'mtime': st.st_mtime}

    def search(self, name, query, limit=200):
        """D12: content search across the workspace (spec §4.3 Search view).

        Same walk rules as tree(): denylist, MAX_DEPTH, bounded volume. Files
        above the read cap are SKIPPED AND COUNTED — honest about what was not
        searched instead of pretending full coverage. Case-insensitive
        substring match per line; hit text is trimmed for the results list.
        """
        q = str(query or '').strip()
        if len(q) < 2:
            raise WorkspaceError('Search query must be at least 2 characters')
        root = self._root(name)
        ql = q.lower()
        hits: list[dict] = []
        skipped = 0
        scanned = 0
        done = False
        for dirpath, dirnames, filenames in os.walk(root):
            if done:
                break
            rel_dir = os.path.relpath(dirpath, root)
            depth = 0 if rel_dir == '.' else rel_dir.count(os.sep) + 1
            if depth >= MAX_DEPTH:
                dirnames[:] = []
            dirnames[:] = sorted(d for d in dirnames if d not in DENY_DIRS)
            for fname in sorted(filenames):
                rel = fname if rel_dir == '.' else f'{rel_dir}/{fname}'
                if self._denied(rel):
                    continue
                path = root / rel
                try:
                    if path.stat().st_size > MAX_FILE_BYTES * 2:
                        skipped += 1
                        continue
                    text = path.read_bytes().decode('utf-8', errors='strict')
                except (OSError, UnicodeDecodeError, ValueError):
                    continue
                scanned += 1
                for lineno, line in enumerate(text.splitlines(), 1):
                    if ql in line.lower():
                        hits.append({'path': rel, 'line': lineno, 'text': line.strip()[:200]})
                        if len(hits) >= limit:
                            done = True
                            break
                if done:
                    break
        return {'query': q, 'hits': hits, 'scanned': scanned,
                'truncated': done, 'skipped_oversize': skipped}

    def _emit_file_change(self, change, name, path, **extra):
        """D1: a host-side file fact, emitted AFTER the filesystem changed.

        The event store already carries the durable record; this only adds the
        live notification the Projects workspace subscribes to (spec §4.4
        "shared file change events"). Task-id stays None — these are host
        writes, not task executions.
        """
        try:
            self.runtime.store.emit('file.changed', {
                'project': name, 'path': path, 'change': change, **extra})
        except Exception:
            # The filesystem fact is already durable; a notification failure
            # must never fail the operation that produced it.
            pass

    @staticmethod
    def _denied(rel: str) -> bool:
        parts = Path(rel).parts
        if any(part in DENY_DIRS for part in parts[:-1]):
            return True
        for part in parts:
            if part != parts[-1] and part in DENY_DIRS:
                return True
        return bool(DENY_FILE.search(parts[-1]))

    @staticmethod
    def _host_version(root):
        try:
            commit = subprocess.run(['git', '-C', str(root), 'rev-parse', '--short', 'HEAD'],
                                    capture_output=True, text=True, timeout=10)
            status = subprocess.run(['git', '-C', str(root), 'status', '--porcelain'],
                                    capture_output=True, text=True, timeout=10)
            # D13: the spec status row wants branch · host · sync — report the
            # branch name alongside the commit when the repo is readable.
            branch = subprocess.run(['git', '-C', str(root), 'rev-parse', '--abbrev-ref', 'HEAD'],
                                    capture_output=True, text=True, timeout=10)
            if commit.returncode == 0 and status.returncode == 0:
                out: dict[str, object] = {'commit': commit.stdout.strip(),
                                          'dirty': bool(status.stdout.strip())}
                if branch.returncode == 0 and branch.stdout.strip():
                    out['branch'] = branch.stdout.strip()
                return out
        except (OSError, subprocess.SubprocessError):
            pass
        return None

    @staticmethod
    def _scm_status(root):
        """D13: per-path source-control state for explorer decorations."""
        try:
            r = subprocess.run(['git', '-C', str(root), 'status', '--porcelain'],
                               capture_output=True, text=True, timeout=10)
            if r.returncode != 0:
                return {}
            state: dict[str, str] = {}
            for line in r.stdout.splitlines():
                if len(line) < 4:
                    continue
                code, path = line[:2], line[3:].strip().strip('"')
                if '->' in path:  # rename "old -> new"
                    path = path.split('->')[-1].strip()
                state[path] = 'M' if code.strip() and code.strip() != '??' else 'U'
            return state
        except (OSError, subprocess.SubprocessError):
            return {}

    def tree(self, name):
        root = self._root(name)
        entries = []
        truncated = False
        base = root
        for dirpath, dirnames, filenames in os.walk(base):
            rel_dir = os.path.relpath(dirpath, base)
            depth = 0 if rel_dir == '.' else rel_dir.count(os.sep) + 1
            if depth >= MAX_DEPTH:
                dirnames[:] = []
            dirnames[:] = sorted(d for d in dirnames if d not in DENY_DIRS)
            if len(entries) >= MAX_TREE_ENTRIES:
                truncated = True
                break
            for fname in sorted(filenames):
                rel = fname if rel_dir == '.' else f'{rel_dir}/{fname}'
                if self._denied(rel):
                    continue
                try:
                    st = os.stat(base / rel)
                except OSError:
                    continue
                entries.append({'path': rel, 'type': 'file', 'size': st.st_size,
                                'mtime': st.st_mtime})
                if len(entries) >= MAX_TREE_ENTRIES:
                    truncated = True
                    break
        return {'project': name, 'root': str(root), 'count': len(entries),
                'truncated': truncated, 'entries': entries,
                'scm': self._scm_status(root),
                'host_version': self._host_version(root)}

    IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'}

    def file(self, name, relpath, preview=False, raw=False):
        """Read a file from the workspace.

        preview=True (the UI stage) never hard-fails on size: files over the
        attach limit return their first MAX_FILE_BYTES with `truncated: True`
        and the full size, and binary files return `binary: True` with no
        content instead of a page of replacement characters. Attach flows
        (preview=False) keep the strict limit — an inline attachment must be
        complete or refused, never silently cut.

        raw=True (D13, image previews): image files return their bytes as
        `content_base64` (same containment + denylist as every read) so the
        editor can render a real <img> instead of the binary dead end.
        """
        root = self._root(name)
        if not relpath or relpath.startswith('/') or '\\' in relpath or '..' in Path(relpath).parts:
            raise WorkspaceError('Invalid file path')
        target = (root / relpath).resolve()
        if not target.is_relative_to(root):
            raise WorkspaceError('Path escapes the project root')
        rel = target.relative_to(root).as_posix()
        if self._denied(rel):
            raise WorkspaceError('File is denylisted (secret or build artifact): ' + rel)
        if not target.is_file():
            raise WorkspaceError('Not a regular file: ' + rel)
        st = target.stat()
        import stat as stat_module
        if raw and target.suffix.lower() in self.IMAGE_EXTS:
            import base64 as base64_module
            data = target.read_bytes()
            if len(data) > MAX_FILE_BYTES * 4:
                raise WorkspaceError(f'Image too large to preview ({len(data)} bytes)')
            return {'path': rel, 'size': st.st_size, 'mtime': st.st_mtime,
                    'mode': stat_module.filemode(st.st_mode), 'truncated': False,
                    'binary': True, 'image': True,
                    'content_base64': base64_module.b64encode(data).decode('ascii'),
                    'content': '', 'host_version': self._host_version(root)}
        with target.open('rb') as handle:
            head = handle.read(MAX_FILE_BYTES + 1)
        is_binary = b'\x00' in head[:8192]
        if is_binary:
            return {'path': rel, 'size': st.st_size, 'mtime': st.st_mtime,
                    'mode': stat_module.filemode(st.st_mode), 'truncated': False,
                    'binary': True, 'content': '', 'host_version': self._host_version(root)}
        truncated = st.st_size > MAX_FILE_BYTES
        if truncated and not preview:
            raise WorkspaceError(f'File too large to attach ({st.st_size} bytes; limit {MAX_FILE_BYTES})')
        content = head[:MAX_FILE_BYTES].decode('utf-8', errors='replace')
        return {'path': rel, 'size': st.st_size, 'mtime': st.st_mtime,
                'mode': stat_module.filemode(st.st_mode), 'truncated': truncated,
                'binary': False, 'content': content, 'host_version': self._host_version(root)}

    def _resolve_writable(self, name, relpath):
        """The same containment and denylist rules the reader applies, for writes."""
        root = self._root(name)
        if not relpath or relpath.startswith('/') or '\\' in relpath or '..' in Path(relpath).parts:
            raise WorkspaceError('Invalid file path')
        target = (root / relpath).resolve()
        if not target.is_relative_to(root):
            raise WorkspaceError('Path escapes the project root')
        rel = target.relative_to(root).as_posix()
        if self._denied(rel):
            raise WorkspaceError('File is denylisted (secret or build artifact): ' + rel)
        return root, target, rel

    def delete_file(self, name, relpath):
        """Soft-delete a project file: move it into the project's `.trash/`.

        User decision (2026-11-25): delete is a MOVE, not an unlink — the file
        lands in `<project>/.trash/` under its original relative path so a
        restore is a plain move back. The same containment and denylist rules
        as the writer apply to the source path; directories are refused (the
        IDE deletes files one at a time). Same-filesystem `os.replace` keeps
        the move atomic; an existing trash entry is never silently overwritten
        — a millisecond timestamp suffix disambiguates instead.
        """
        import os as os_module
        root, target, rel = self._resolve_writable(name, relpath)
        if not target.is_file():
            raise WorkspaceError('Not a regular file (only files can be deleted): ' + rel)
        trash_root = root / '.trash'
        dest = trash_root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            stamp = f'.{int(time.time() * 1000)}'
            dest = dest.with_name(dest.name + stamp)
        os_module.replace(target, dest)
        self._emit_file_change('deleted', name, rel, trash=dest.relative_to(root).as_posix())
        return {'deleted': rel, 'trash': dest.relative_to(root).as_posix()}

    def make_dir(self, name, relpath):
        """D2: create a directory inside the workspace (IDE 'New Folder')."""
        root, target, rel = self._resolve_writable(name, relpath)
        # _denied only refuses a DENY_DIRS name as an ANCESTOR (a file may
        # legitimately end in e.g. 'build'). A directory NAMED like a denylisted
        # build/VCS dir must never be creatable: refuse any part.
        if any(part in DENY_DIRS for part in Path(rel).parts):
            raise WorkspaceError('Directory is denylisted (VCS or build artifact): ' + rel)
        if target.exists():
            raise WorkspaceError('Already exists in the project: ' + rel)
        target.mkdir(parents=True, exist_ok=False)
        return {'created': rel}

    def move_entry(self, name, source, target_rel):
        """D2: rename/move a file or directory inside the workspace.

        IDE 'Rename / Move…'. Both endpoints resolve through the SAME
        containment + denylist as writes. A rename is a same-parent move.
        The target is never silently overwritten and its parent must exist
        (the IDE creates directories explicitly). Plain os.rename keeps it
        same-filesystem and atomic.
        """
        root, src, src_rel = self._resolve_writable(name, source)
        root2, dst, dst_rel = self._resolve_writable(name, target_rel)
        if not src.exists():
            raise WorkspaceError('Source does not exist in the project: ' + src_rel)
        if src == dst:
            raise WorkspaceError('Source and target are the same path')
        if dst.exists():
            raise WorkspaceError('Target already exists in the project: ' + dst_rel)
        if not dst.parent.is_dir():
            parent_rel = dst_rel.rsplit('/', 1)[0] if '/' in dst_rel else '.'
            raise WorkspaceError('Parent directory does not exist in the project: ' + parent_rel)
        os.rename(src, dst)
        self._emit_file_change('moved', name, dst_rel, source=src_rel)
        return {'moved': src_rel, 'to': dst_rel}

    def roots(self):
        """Candidate project directories under every allowed root.

        The registration UI needs something to offer besides a free-text path.
        Git is optional (VS Code-style): every directory under an allowed root
        is a candidate, and `git` records whether sync/review features apply.
        """
        seen=set()
        out=[]
        registered = {r['host_path'] for r in self.list()}
        for allowed in self.allowed_roots:
            try:
                candidates = sorted(p for p in allowed.iterdir()
                                    if p.is_dir() and not p.name.startswith('.'))
            except OSError:
                continue
            for path in candidates:
                if str(path) in seen:
                    continue
                seen.add(str(path))
                out.append({'name': path.name, 'path': str(path), 'registered': str(path) in registered,
                            'git': (path / '.git').exists(),
                            'version': self._host_version(path)})
        return out

    def write_file(self, name, relpath, content, expected_mtime=None, content_base64=None):
        """Create or overwrite a file inside the project workspace.

        Provisional by design, exactly like the agent's own edits: the change lands in
        the host working tree UNCOMMITTED and is visible through `changes()`. Text
        writes keep the strict round-trip contract (binary targets refused, UTF-8
        validated); `content_base64` carries a BINARY upload (chat image attach) and
        skips that text validation while keeping the same containment, size limit,
        mtime guard and atomic write. `expected_mtime` refuses a save over a file
        that changed on disk since it was loaded, and the write is atomic
        (tempfile + rename) so a failed save cannot truncate.
        """
        root, target, rel = self._resolve_writable(name, relpath)
        if content_base64 is not None:
            import base64 as base64_module
            try:
                data = base64_module.b64decode(content_base64, validate=True)
            except Exception:
                raise WorkspaceError('Invalid base64 file content') from None
        else:
            if not isinstance(content, str):
                raise WorkspaceError('File content must be text')
            data = content.encode('utf-8')
        if len(data) > MAX_WRITE_BYTES:
            raise WorkspaceError(f'File too large to write ({len(data)} bytes; limit {MAX_WRITE_BYTES})')
        created = not target.exists()
        mode = 0o644
        if not created:
            if not target.is_file():
                raise WorkspaceError('Not a regular file: ' + rel)
            st = target.stat()
            if content_base64 is None:
                try:
                    target.read_bytes()[:8192].decode('utf-8', errors='strict')
                except UnicodeDecodeError:
                    raise WorkspaceError('Binary file — edit it in a real editor, not through chat') from None
            if expected_mtime is not None and abs(st.st_mtime - float(expected_mtime)) > 0.001:
                raise WorkspaceError('File changed on disk since it was loaded — reload it before saving')
            mode = st.st_mode & 0o777
        if not target.parent.is_dir():
            if content_base64 is not None:
                # An upload may reference a fresh subpath (chat image attach);
                # create the parents rather than refusing the upload.
                target.parent.mkdir(parents=True, exist_ok=True)
            else:
                raise WorkspaceError('Parent directory does not exist in the project: ' + rel)
        import tempfile as tempfile_module
        handle_fd, tmp_name = tempfile_module.mkstemp(dir=target.parent, prefix='.hermes-write-', suffix='.tmp')
        tmp = Path(tmp_name)
        try:
            with os.fdopen(handle_fd, 'wb') as fh:
                fh.write(data)
            os.chmod(tmp, mode)
            os.replace(tmp, target)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        st = target.stat()
        self._emit_file_change('written', name, rel, mtime=st.st_mtime, size=st.st_size,
                               created=created)
        return {'path': rel, 'size': st.st_size, 'mtime': st.st_mtime, 'created': created,
                'host_version': self._host_version(root)}


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
    # Create-before-{name} routes so `create` can never be read as a project name.
    @router.post('/create',status_code=201)
    def create(payload:ProjectCreate):return handle(manager.create,payload.name,payload.spec_path,payload.git)
    # Declare BEFORE the /{name}/... routes so `roots` can never be read as a project name.
    @router.get('/roots')
    def roots():return {'allowed_root':str(manager.allowed_root),
                        'allowed_roots':[str(r) for r in manager.allowed_roots],
                        'roots':manager.roots()}
    @router.post('/{name}/sync')
    def sync(name:str):return handle(manager.sync,name)
    @router.get('/{name}/changes')
    def changes(name:str):return handle(manager.changes,name)
    # HL-CHAT-006: file-context manager endpoints (host paths, read-only).
    @router.get('/{name}/tree')
    def tree(name:str):return handle(manager.tree,name)
    @router.get('/{name}/file')
    def file(name:str,path:str,preview:bool=False,raw:bool=False):
        return handle(manager.file,name,path,preview,raw)
    # D12: content search across the workspace (same walk rules as tree()).
    @router.get('/{name}/search')
    def search(name:str,q:str,limit:int=200):
        return handle(manager.search,name,q,limit)
    # UI edits and uploads: provisional, uncommitted host working-tree writes (see
    # the module docstring) — the same containment and denylist rules as the reader.
    @router.put('/{name}/file')
    def write_file(name:str,payload:FileWrite):
        return handle(manager.write_file,name,payload.path,payload.content,payload.expected_mtime,payload.content_base64)
    # Soft delete (user decision 2026-11-25): the file MOVES to <project>/.trash/
    # under its original relative path — never an unlink.
    @router.delete('/{name}/file')
    def delete_file(name:str,path:str):
        return handle(manager.delete_file,name,path)
    # D2: IDE create-directory and rename/move. Same containment + denylist as
    # every other write; a move never overwrites an existing target.
    @router.post('/{name}/dir')
    def make_dir(name:str,payload:PathIn):
        return handle(manager.make_dir,name,payload.path)
    @router.post('/{name}/move')
    def move_entry(name:str,payload:MoveIn):
        return handle(manager.move_entry,name,payload.source,payload.target)
    app.include_router(router)


def add_fs_routes(app, runtime, manager):
    """§5: browse the HOST filesystem for attachment WITHOUT registering a project.

    Registration and attachment are separate operations (user brief §5): a file or
    directory may be attached to a conversation without first becoming a project.
    The security boundary is unchanged — every path is proven to sit inside a
    configured allowed root — so this UI affordance never widens the agent's reach.
    """
    router=APIRouter(prefix='/api/fs',tags=['filesystem'])
    def handle(fn,*args):
        try:return fn(*args)
        except (WorkspaceError,OSError,subprocess.TimeoutExpired) as exc:
            raise HTTPException(status_code=409,detail=str(exc)) from exc
    @router.get('/list')
    def listing(path:str|None=None):return handle(manager.browse,path)
    # D6: project-free uploads (user decision 2026-11-27) — images land inside
    # the primary allowed root under hermes-uploads/, same containment rules.
    @router.put('/upload')
    def upload(payload:FileUpload):return handle(manager.upload,payload.filename,payload.content_base64)
    app.include_router(router)
