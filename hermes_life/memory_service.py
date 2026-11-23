"""P4 Obsidian memory service — a stable read/write API over the existing vault.

Spec §6 (hermesha-ui-ux-obsidian-spec.md). Design rules enforced here:

- The vault is a KNOWLEDGE STORE, not the authority for anything else. This
  module never restructures it; it reads the existing layout (Hermes-Life/...)
  and adds notes only where a caller explicitly targets a path.
- Note identity is the frontmatter `hermes_note_id` (legacy notes use
  `hermes_memory_id`; both are honoured), falling back to the vault-relative
  path. IDs are stable independent of filename.
- Every write is a temporary file + atomic rename. An existing read-only
  (human-locked) note is never silently replaced: the write fails loudly.
- Conflict handling is optimistic: callers pass the revision (content sha256)
  they read; a concurrent Obsidian edit changes that hash and the PATCH is
  rejected instead of clobbering.
- The scope is the configured vault root. Candidate paths are resolved and
  must stay inside it (symlink escapes included).
- The index is a derived, rebuildable cache — never the source of truth.

Health, search, note CRUD, graph and reindex are exposed by
add_memory_routes() as /memory/* endpoints (see app.py).
"""
import os
import re
import hashlib
import threading
import time
import uuid
from pathlib import Path

VAULT_ENV = 'HERMES_LIFE_OBSIDIAN_VAULT'
VAULT_DEFAULT = '/run/media/gayzer/black/obsidian/hermes'

# Scanning the whole vault on every request is exactly what the old
# retrieve_notes did; a bounded in-memory index replaces that.
MAX_NOTES = 5000
MAX_BODY_CHARS = 400_000

_FM_BLOCK = re.compile(r'\A---\s*\n(.*?)\n---\s*\n?', re.DOTALL)
_WIKILINK = re.compile(r'\[\[([^\]\|#]+)(?:#[^\]\|]*)?(?:\|[^\]]*)?\]\]')
_HEADING = re.compile(r'^#{1,6}\s+(.*)$', re.MULTILINE)


def vault_root() -> Path:
    """The one resolver for the configured vault root."""
    return Path(os.environ.get(VAULT_ENV, VAULT_DEFAULT)).expanduser()


def _parse_frontmatter(text: str):
    m = _FM_BLOCK.match(text)
    meta: dict = {}
    if m:
        for line in m.group(1).splitlines():
            if ':' not in line:
                continue
            key, _, value = line.partition(':')
            value = value.strip().strip('"').strip("'")
            if value.startswith('[') and value.endswith(']'):
                value = [v.strip().strip('"\'') for v in value[1:-1].split(',') if v.strip()]
            meta[key.strip()] = value
    body = text[m.end():] if m else text
    return meta, body


def _frontmatter_text(meta: dict) -> str:
    lines = ['---']
    for key, value in meta.items():
        if isinstance(value, list):
            lines.append(f'{key}: [{", ".join(str(v) for v in value)}]')
        else:
            lines.append(f'{key}: "{value}"' if isinstance(value, str) else f'{key}: {value}')
    lines.append('---')
    return '\n'.join(lines) + '\n'


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:12]


def _safe_slug(title: str) -> str:
    slug = re.sub(r'[^\w\s-]', '', title).strip()
    slug = re.sub(r'[\s]+', '-', slug)[:80]
    return slug or 'untitled'


class MemoryService:
    """Read/write/index API over the Obsidian vault. Vault failures never
    raise into the caller's flow — they surface as health state."""

    def __init__(self, store, poll_seconds: int = 30):
        self.store = store
        self.poll_seconds = max(5, poll_seconds)
        self._index: dict[str, dict] = {}          # relpath -> entry
        self._by_id: dict[str, str] = {}           # note_id -> relpath
        self._lock = threading.Lock()
        self._scanned_at: float | None = None
        self._scan_error: str | None = None
        self._watcher_error: str | None = None
        self._changes_seen = 0
        self._watcher = threading.Thread(target=self._watch_loop, daemon=True)
        self._watcher.start()
        # Read pipeline step 1: scan existing notes initially — health and
        # search must be usable without waiting for the first watcher poll.
        self.reindex()

    # ------------------------------------------------------------------ indexing

    def _iter_markdown(self, root: Path):
        count = 0
        for dirpath, _dirs, files in os.walk(root):
            for name in files:
                if not name.endswith('.md'):
                    continue
                yield Path(dirpath) / name
                count += 1
                if count >= MAX_NOTES:
                    return

    def _entry_for(self, path: Path, root: Path) -> dict | None:
        try:
            rel = path.relative_to(root).as_posix()
            stat = path.stat()
            text = path.read_text(encoding='utf-8', errors='replace')[:MAX_BODY_CHARS]
        except (OSError, ValueError):
            return None
        meta, body = _parse_frontmatter(text)
        note_id = str(meta.get('hermes_note_id') or meta.get('hermes_memory_id') or f'path:{rel}')
        title = str(meta.get('title') or (body.lstrip().split('\n', 1)[0].lstrip('# ').strip() if body.strip() else '') or path.stem)
        links = [link.strip() for link in _WIKILINK.findall(body)]
        return {
            'note_id': note_id, 'path': rel, 'title': title,
            'mtime': stat.st_mtime, 'sha': _sha(text),
            'kind': str(meta.get('kind') or ''), 'project_id': str(meta.get('project_id') or ''),
            'tags': [t for t in (meta.get('tags') or []) if isinstance(t, str)] if isinstance(meta.get('tags'), list) else [],
            'redacted': bool(meta.get('redacted')), 'links': links,
        }

    def reindex(self) -> dict:
        """Full rebuild of the derived index. Never the source of truth."""
        root = vault_root()
        new_index: dict[str, dict] = {}
        if not root.is_dir():
            self._scan_error = f'vault not mounted: {root}'
        else:
            self._scan_error = None
            for path in self._iter_markdown(root):
                entry = self._entry_for(path, root)
                if entry:
                    new_index[entry['path']] = entry
        with self._lock:
            self._index = new_index
            self._by_id = {e['note_id']: e['path'] for e in new_index.values()}
            self._scanned_at = time.time()
        return {'notes': len(new_index), 'error': self._scan_error}

    def _watch_loop(self) -> None:
        while True:
            time.sleep(self.poll_seconds)
            try:
                self._poll_once()
            except Exception as exc:  # a watcher must never kill its thread silently for the caller
                self._watcher_error = str(exc)

    def _poll_once(self) -> None:
        root = vault_root()
        if not root.is_dir():
            self._watcher_error = f'vault not mounted: {root}'
            return
        self._watcher_error = None
        changed: list[str] = []
        if not self._index:
            self.reindex()
            return
        current: dict[str, float] = {}
        for path in self._iter_markdown(root):
            try:
                current[path.relative_to(root).as_posix()] = path.stat().st_mtime
            except (OSError, ValueError):
                continue
        with self._lock:
            known = {p: e['mtime'] for p, e in self._index.items()}
        for rel, mtime in current.items():
            if rel not in known or known[rel] != mtime:
                changed.append(rel)
        removed = [rel for rel in known if rel not in current]
        if len(changed) > 20 or len(removed) > 20:
            self.reindex()
        elif changed or removed:
            for rel in changed:
                entry = self._entry_for(root / rel, root)
                with self._lock:
                    if entry:
                        self._index[rel] = entry
                        self._by_id[entry['note_id']] = rel
                    else:
                        self._index.pop(rel, None)
            for rel in removed:
                with self._lock:
                    self._index.pop(rel, None)
            with self._lock:
                self._by_id = {e['note_id']: e['path'] for e in self._index.values()}
            self._scanned_at = time.time()
        if changed or removed:
            self._changes_seen += len(changed) + len(removed)
            self.store.emit('memory.vault_changed', {
                'changed': changed[:10], 'removed': removed[:10],
            }, origin='memory_service')

    # ------------------------------------------------------------------ health

    def health(self) -> dict:
        root = vault_root()
        with self._lock:
            notes = len(self._index)
            scanned_at = self._scanned_at
        return {
            'vault': str(root),
            'reachable': root.is_dir(),
            'readable': os.access(root, os.R_OK) if root.is_dir() else False,
            'writable': os.access(root, os.W_OK) if root.is_dir() else False,
            'index': {'notes': notes, 'last_scan': scanned_at, 'fresh': scanned_at is not None},
            'watcher': {
                'running': self._watcher.is_alive(),
                'poll_seconds': self.poll_seconds,
                'changes_seen': self._changes_seen,
                'error': self._watcher_error,
            },
            'errors': [e for e in (self._scan_error, self._watcher_error) if e],
        }

    # ------------------------------------------------------------------ search

    def search(self, query: str, limit: int = 20) -> list[dict]:
        if len(query) < 2:
            return []
        q = query.lower()
        scored: list[tuple[int, dict, str]] = []
        with self._lock:
            entries = list(self._index.values())
        root = vault_root()
        for entry in entries:
            if entry['redacted']:
                continue
            score = 0
            if q in entry['title'].lower():
                score += 3
            if q in entry['path'].lower():
                score += 2
            excerpt = ''
            try:
                text = (root / entry['path']).read_text(encoding='utf-8', errors='replace')[:MAX_BODY_CHARS]
            except OSError:
                continue
            pos = text.lower().find(q)
            if pos >= 0:
                score += 1
                start = max(0, pos - 80)
                excerpt = ('…' if start else '') + text[start:pos + 120].replace('\n', ' ') + '…'
            if not score:
                continue
            scored.append((score, entry, excerpt))
        scored.sort(key=lambda t: -t[0])
        results = []
        for score, entry, excerpt in scored[:max(1, min(limit, 50))]:
            results.append({
                'note_id': entry['note_id'], 'title': entry['title'], 'path': entry['path'],
                'excerpt': excerpt, 'kind': entry['kind'], 'project_id': entry['project_id'],
                'mtime': entry['mtime'], 'relevance': score,
                'citation_anchor': f'{entry["path"]}',
            })
        return results

    # ------------------------------------------------------------------ notes

    def _resolve(self, rel: str) -> Path:
        """Resolve a vault-relative path, rejecting traversal/symlink escapes."""
        root = vault_root()
        candidate = (root / rel).resolve()
        if not str(candidate).startswith(str(root.resolve()) + os.sep):
            raise ValueError('path escapes the vault root')
        return candidate

    def get_note(self, note_id: str) -> dict:
        with self._lock:
            rel = self._by_id.get(note_id) or self._by_id.get(f'path:{note_id}')
        if not rel:
            raise KeyError('note not found')
        path = self._resolve(rel)
        text = path.read_text(encoding='utf-8', errors='replace')
        meta, body = _parse_frontmatter(text)
        entry = self._index.get(rel, {})
        # Backlinks: other indexed notes whose wikilinks point here by title or path.
        backlinks = [e['path'] for e in self._index.values()
                     if e['path'] != rel
                     and (entry.get('title') in e['links'] or rel in e['links']
                          or Path(rel).stem in e['links'])]
        headings = _HEADING.findall(body)[:20]
        return {
            'note_id': note_id, 'path': rel, 'title': entry.get('title', path.stem),
            'frontmatter': meta, 'body': body, 'revision': _sha(text),
            'mtime': entry.get('mtime'), 'outgoing_links': entry.get('links', []),
            'backlinks': backlinks, 'headings': headings, 'kind': entry.get('kind', ''),
        }

    def create_note(self, folder: str, title: str, body: str,
                    meta: dict | None = None, origin: str = 'hermes_research') -> dict:
        root = vault_root()
        if not root.is_dir():
            raise RuntimeError('vault not mounted')
        clean_folder = folder.strip('/ ')
        rel = f'{clean_folder}/{_safe_slug(title)}.md' if clean_folder else f'{_safe_slug(title)}.md'
        path = self._resolve(rel)
        if path.exists():
            raise ValueError('note already exists')
        note_id = f'note_{uuid.uuid4().hex[:12]}'
        stamp = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        full_meta = {'hermes_note_id': note_id, 'title': title, 'origin': origin,
                     'created_at': stamp, 'updated_at': stamp, 'confidence': 'unverified'}
        full_meta.update(meta or {})
        text = _frontmatter_text(full_meta) + '\n' + body.strip() + '\n'
        self._atomic_write(path, text, expect_missing=True)
        self.reindex()
        self.store.emit('memory.note_created', {'note_id': note_id, 'path': rel}, origin='memory_service')
        return {'note_id': note_id, 'path': rel, 'revision': _sha(text)}

    def patch_note(self, note_id: str, expected_revision: str,
                   body: str | None = None, meta_updates: dict | None = None) -> dict:
        with self._lock:
            rel = self._by_id.get(note_id) or self._by_id.get(f'path:{note_id}')
        if not rel:
            raise KeyError('note not found')
        path = self._resolve(rel)
        text = path.read_text(encoding='utf-8', errors='replace')
        if _sha(text) != expected_revision:
            raise PermissionError('revision conflict: the note changed since it was read')
        meta, old_body = _parse_frontmatter(text)
        new_body = old_body if body is None else body
        meta['updated_at'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        meta.update(meta_updates or {})
        new_text = _frontmatter_text(meta) + '\n' + new_body.strip() + '\n'
        self._atomic_write(path, new_text, expect_missing=False)
        entry = self._entry_for(path, vault_root())
        with self._lock:
            if entry:
                self._index[rel] = entry
            self._scanned_at = time.time()
        self.store.emit('memory.note_updated', {'note_id': note_id, 'path': rel}, origin='memory_service')
        return {'note_id': note_id, 'path': rel, 'revision': _sha(new_text)}

    def _atomic_write(self, path: Path, text: str, expect_missing: bool) -> None:
        # A read-only existing note is human-locked territory: a rename would
        # bypass the file's own permission, so honour it and fail loudly.
        if path.exists():
            if not os.access(path, os.W_OK):
                raise PermissionError('note is read-only (human-locked)')
            if expect_missing:
                raise ValueError('note already exists')
        tmp = path.with_name(path.name + f'.tmp-{os.getpid()}')
        with tmp.open('w', encoding='utf-8') as file:
            file.write(text)
        tmp.replace(path)

    # ------------------------------------------------------------------ graph

    def graph(self, note_id: str) -> dict:
        note = self.get_note(note_id)
        outgoing = []
        with self._lock:
            entries = list(self._index.values())
        for link in note['outgoing_links']:
            target = next((e for e in entries
                           if e['path'] == link or e['title'] == link or Path(e['path']).stem == link), None)
            outgoing.append({'link': link, 'note_id': target['note_id'] if target else None,
                             'path': target['path'] if target else None})
        by_project: dict[str, list[str]] = {}
        for e in entries:
            if e['project_id']:
                by_project.setdefault(e['project_id'], []).append(e['path'])
        return {
            'note_id': note_id, 'path': note['path'], 'title': note['title'],
            'outgoing': outgoing, 'backlinks': note['backlinks'],
            'projects': {k: v[:20] for k, v in by_project.items()},
        }


def add_memory_routes(app, runtime) -> None:
    """Register /memory/* routes on the FastAPI app."""
    memory: MemoryService = runtime.memory

    @app.get('/api/memory/health')
    def memory_health():
        return memory.health()

    @app.get('/api/memory/search')
    def memory_search(q: str = '', limit: int = 20):
        return {'results': memory.search(q, limit)}

    @app.get('/api/memory/reindex')
    def memory_reindex():
        return memory.reindex()

    @app.get('/api/memory/graph')
    def memory_graph(note_id: str = ''):
        if not note_id:
            raise ValueError('note_id is required')
        try:
            return memory.graph(note_id)
        except KeyError as exc:
            from fastapi import HTTPException
            raise HTTPException(404, str(exc))

    @app.get('/api/memory/notes/{note_id}')
    def memory_get_note(note_id: str):
        try:
            return memory.get_note(note_id)
        except KeyError:
            from fastapi import HTTPException
            raise HTTPException(404, 'note not found')

    @app.post('/api/memory/notes')
    def memory_create_note(payload: dict):
        try:
            return memory.create_note(
                str(payload.get('folder') or ''), str(payload.get('title') or ''),
                str(payload.get('body') or ''), payload.get('meta') or {},
                str(payload.get('origin') or 'hermes_research'))
        except (ValueError, RuntimeError) as exc:
            from fastapi import HTTPException
            raise HTTPException(400, str(exc))

    @app.patch('/api/memory/notes/{note_id}')
    def memory_patch_note(note_id: str, payload: dict):
        try:
            return memory.patch_note(
                note_id, str(payload.get('expected_revision') or ''),
                payload.get('body'), payload.get('meta'))
        except KeyError:
            from fastapi import HTTPException
            raise HTTPException(404, 'note not found')
        except PermissionError as exc:
            from fastapi import HTTPException
            raise HTTPException(409, str(exc))
        except (ValueError, RuntimeError) as exc:
            from fastapi import HTTPException
            raise HTTPException(400, str(exc))
