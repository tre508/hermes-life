"""Global search aggregate — HERMESHA spec §2/§3/§5.

ONE read-only endpoint that answers "where is X?" across the Hermes work graph,
the canonical conversation store, the vault and the reference library. It
invents no records, ranks what exists, and reports a degraded source explicitly
rather than pretending it returned nothing (spec §5/§12).

Design:
  * every source is a bounded SQL LIKE query (or an existing service search),
    never a full-table load;
  * scoring is a small pure function so it is unit-testable without a database;
  * results carry a `deeplink` the frontend maps onto its existing navigation
    intents — this module never invents a second navigation path.
"""
from __future__ import annotations

MAX_LIMIT = 50
MIN_QUERY = 2
_PER_SOURCE = 20

# kind -> the frontend navigation intent that opens it. Workview names mirror
# navigation-state.ts's WorkView union.
_DEEPLINK: dict[str, dict] = {
    'task': {'intent': 'openTask', 'args': {'destination': 'work'}},
    'goal': {'intent': 'openWorkView', 'args': {'workView': 'goals', 'selection': {'kind': 'goal'}}},
    'discovery': {'intent': 'openWorkView', 'args': {'workView': 'discover', 'selection': {'kind': 'discovery'}}},
    'plan': {'intent': 'openWorkView', 'args': {'workView': 'planning', 'selection': {'kind': 'plan'}}},
    'run': {'intent': 'openWorkView', 'args': {'workView': 'build', 'selection': {'kind': 'build'}}},
    'project': {'intent': 'openWorkView', 'args': {'workView': 'projects', 'selection': {'kind': 'project'}}},
    'conversation': {'intent': 'openWorkspace', 'args': {'workspace': 'conversations'}},
    'memory': {'intent': 'openWorkspace', 'args': {'workspace': 'knowledge'}},
    'note': {'intent': 'openNote', 'args': {}},
    'library': {'intent': 'openWorkspace', 'args': {'workspace': 'knowledge'}},
}


def score(query: str, *fields: object) -> float:
    """Deterministic relevance: exact > prefix > substring, earlier fields weigh more.

    Pure and side-effect free so it can be unit-tested without a database.
    """
    q = query.lower()
    total = 0.0
    for i, field in enumerate(fields):
        if field is None:
            continue
        text = str(field).lower()
        weight = max(0.5, 1.5 - i * 0.25)
        if text == q:
            total += 3.0 * weight
        elif text.startswith(q):
            total += 2.0 * weight
        elif q in text:
            total += 1.0 * weight
    return round(total, 4)


def excerpt(query: str, text: object, width: int = 160) -> str:
    """A window of `text` around the first case-insensitive hit of `query`."""
    body = str(text or '').replace('\n', ' ').strip()
    if not body:
        return ''
    pos = body.lower().find(query.lower())
    if pos < 0:
        return body[:width] + ('…' if len(body) > width else '')
    start = max(0, pos - width // 3)
    end = min(len(body), start + width)
    return ('…' if start else '') + body[start:end] + ('…' if end < len(body) else '')


def _like(query: str) -> str:
    escaped = query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    return f'%{escaped}%'


class SearchService:
    def __init__(self, runtime):
        self.runtime = runtime
        self.store = runtime.store

    # ------------------------------------------------------------------ plumbing

    def _rows(self, sql: str, params: list) -> list[dict]:
        with self.store.lock:
            return [dict(r) for r in self.store.connection.execute(sql, params).fetchall()]

    def _item(self, kind: str, ident: str, title: str, body: object, *,
              project_id: str | None = None, source: str = 'work_graph',
              extra: dict | None = None, fields: tuple = ()) -> dict:
        deeplink = {k: dict(v) if isinstance(v, dict) else v for k, v in _DEEPLINK[kind].items()}
        args = deeplink['args']
        if kind == 'task':
            args['taskId'] = ident
        elif kind in ('conversation',):
            args['conversationId'] = ident
        elif kind == 'note':
            args['noteId'] = ident
        elif 'selection' in args:
            args['selection']['id'] = ident
        item = {
            'kind': kind,
            'id': ident,
            'title': title,
            'excerpt': excerpt('', ''),
            'project_id': project_id,
            'source': source,
            'score': 0.0,
            'deeplink': deeplink,
        }
        if extra:
            item.update(extra)
        return item

    # ------------------------------------------------------------------ sources

    def _tasks(self, q: str, project_id: str | None) -> list[dict]:
        if project_id:
            return []
        rows = self._rows(
            "SELECT id,prompt,state,created_at FROM tasks WHERE prompt LIKE ? ESCAPE '\\' "
            "ORDER BY created_at DESC LIMIT ?", [_like(q), _PER_SOURCE])
        out = []
        for r in rows:
            item = self._item('task', r['id'], r['prompt'][:90], r['prompt'], fields=(r['prompt'],))
            item['state'] = r['state']
            item['excerpt'] = excerpt(q, r['prompt'])
            item['score'] = score(q, r['prompt'])
            out.append(item)
        return out

    def _goals(self, q: str, project_id: str | None) -> list[dict]:
        if project_id:
            return []
        rows = self._rows(
            "SELECT id,title,prompt,state,created_at FROM goals "
            "WHERE title LIKE ? ESCAPE '\\' OR prompt LIKE ? ESCAPE '\\' "
            "ORDER BY created_at DESC LIMIT ?", [_like(q), _like(q), _PER_SOURCE])
        out = []
        for r in rows:
            item = self._item('goal', r['id'], r['title'], r['prompt'], fields=(r['title'], r['prompt']))
            item['state'] = r['state']
            item['excerpt'] = excerpt(q, r['prompt'])
            item['score'] = score(q, r['title'], r['prompt'])
            out.append(item)
        return out

    def _discoveries(self, q: str, project_id: str | None) -> list[dict]:
        sql = ("SELECT id,project,note,proposed_prompt,rationale,state,created_at FROM discoveries "
               "WHERE (note LIKE ? ESCAPE '\\' OR proposed_prompt LIKE ? ESCAPE '\\' "
               "OR rationale LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\')")
        params: list = [_like(q), _like(q), _like(q), _like(q)]
        if project_id:
            sql += ' AND project = ?'
            params.append(project_id)
        sql += ' ORDER BY created_at DESC LIMIT ?'
        params.append(_PER_SOURCE)
        out = []
        for r in self._rows(sql, params):
            item = self._item('discovery', r['id'], r['note'][:90] or r['proposed_prompt'][:90],
                              r['rationale'], project_id=r['project'],
                              fields=(r['note'], r['proposed_prompt'], r['rationale']))
            item['state'] = r['state']
            item['excerpt'] = excerpt(q, r['proposed_prompt'] or r['note'])
            item['score'] = score(q, r['note'], r['proposed_prompt'], r['rationale'])
            out.append(item)
        return out

    def _plans(self, q: str, project_id: str | None) -> list[dict]:
        if project_id:
            return []
        rows = self._rows(
            "SELECT p.id AS id, p.report AS report, p.created_at AS created_at, "
            "       f.title AS title, f.action AS action "
            "FROM investigation_plans p LEFT JOIN formulated_goals f ON f.id = p.formulation_id "
            "WHERE f.title LIKE ? ESCAPE '\\' OR f.action LIKE ? ESCAPE '\\' OR p.report LIKE ? ESCAPE '\\' "
            "ORDER BY p.created_at DESC LIMIT ?", [_like(q), _like(q), _like(q), _PER_SOURCE])
        out = []
        for r in rows:
            title = r['title'] or f"Plan {r['id'][:8]}"
            item = self._item('plan', r['id'], title, r['report'], fields=(r['title'], r['action']))
            item['excerpt'] = excerpt(q, r['report'])
            item['score'] = score(q, r['title'], r['action'])
            out.append(item)
        return out

    def _runs(self, q: str, project_id: str | None) -> list[dict]:
        sql = ("SELECT id,project,state,created_at FROM implementation_runs "
               "WHERE (project LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\' OR response LIKE ? ESCAPE '\\')")
        params: list = [_like(q), _like(q), _like(q)]
        if project_id:
            sql += ' AND project = ?'
            params.append(project_id)
        sql += ' ORDER BY created_at DESC LIMIT ?'
        params.append(_PER_SOURCE)
        out = []
        for r in self._rows(sql, params):
            item = self._item('run', r['id'], f"Run {r['id'][:8]} · {r['project']}", r['project'],
                              project_id=r['project'], fields=(r['project'], r['id']))
            item['state'] = r['state']
            item['score'] = score(q, r['project'], r['id'])
            out.append(item)
        return out

    def _projects(self, q: str, project_id: str | None) -> list[dict]:
        sql = ("SELECT id,name,origin,status,remote_path,created_at FROM autonomy_projects "
               "WHERE (name LIKE ? ESCAPE '\\' OR remote_path LIKE ? ESCAPE '\\')")
        params: list = [_like(q), _like(q)]
        if project_id:
            sql += ' AND name = ?'
            params.append(project_id)
        sql += ' ORDER BY created_at DESC LIMIT ?'
        params.append(_PER_SOURCE)
        out = []
        for r in self._rows(sql, params):
            item = self._item('project', r['id'], r['name'], r['remote_path'], project_id=r['name'],
                              fields=(r['name'], r['remote_path']))
            item['state'] = r['status']
            item['origin'] = r['origin']
            item['score'] = score(q, r['name'], r['remote_path'])
            out.append(item)
        return out

    def _milestones(self, q: str, project_id: str | None) -> list[dict]:
        sql = ("SELECT id,project_name,title,prompt,state FROM project_milestones "
               "WHERE (title LIKE ? ESCAPE '\\' OR prompt LIKE ? ESCAPE '\\')")
        params: list = [_like(q), _like(q)]
        if project_id:
            sql += ' AND project_name = ?'
            params.append(project_id)
        sql += ' ORDER BY order_index LIMIT ?'
        params.append(_PER_SOURCE)
        out = []
        for r in self._rows(sql, params):
            item = self._item('project', r['id'], f"{r['title']} · {r['project_name']}",
                              r['prompt'], project_id=r['project_name'], fields=(r['title'], r['prompt']))
            item['state'] = r['state']
            item['score'] = score(q, r['title'], r['prompt'])
            out.append(item)
        return out

    def _conversations(self, q: str, project_id: str | None) -> list[dict]:
        if project_id:
            return []
        out = []
        for r in self._rows(
                "SELECT id,title,updated_at FROM hl_conversations WHERE title LIKE ? ESCAPE '\\' "
                "ORDER BY updated_at DESC LIMIT ?", [_like(q), _PER_SOURCE]):
            item = self._item('conversation', r['id'], r['title'] or 'Conversation', '', source='conversations',
                              fields=(r['title'],))
            item['score'] = score(q, r['title'])
            out.append(item)
        for r in self._rows(
                "SELECT t.id AS id, t.conversation_id AS conversation_id, t.role AS role, "
                "       t.content AS content FROM hl_conversation_turns t "
                "WHERE t.content LIKE ? ESCAPE '\\' ORDER BY t.id DESC LIMIT ?", [_like(q), _PER_SOURCE]):
            item = self._item('conversation', r['conversation_id'],
                              f"{r['role'].title()} message", r['content'], source='conversations',
                              fields=(r['content'],))
            item['excerpt'] = excerpt(q, r['content'])
            item['score'] = score(q, r['content']) - 0.1  # a turn hit ranks just under a thread-title hit
            out.append(item)
        return out

    def _memories(self, q: str, project_id: str | None) -> list[dict]:
        if project_id:
            return []
        out = []
        for r in self._rows(
                "SELECT id,content,kind,created_at FROM hl_memories "
                "WHERE content LIKE ? ESCAPE '\\' AND status = 'active' "
                "ORDER BY created_at DESC LIMIT ?", [_like(q), _PER_SOURCE]):
            item = self._item('memory', r['id'], f"Memory · {r['kind']}", r['content'], fields=(r['content'],))
            item['excerpt'] = excerpt(q, r['content'])
            item['score'] = score(q, r['content'])
            out.append(item)
        return out

    def _vault(self, q: str, limit: int) -> list[dict]:
        out = []
        for r in self.runtime.memory.search(q, limit):
            ident = r.get('note_id') or r.get('path') or ''
            item = self._item('note', ident, r.get('title') or r.get('path') or 'Note',
                              r.get('excerpt'), project_id=r.get('project_id'), source='vault',
                              fields=(r.get('title'),))
            item['excerpt'] = r.get('excerpt') or ''
            item['score'] = score(q, r.get('title')) + 0.5  # an authored note is strong evidence
            out.append(item)
        return out

    def _library(self, q: str, limit: int) -> list[dict]:
        out = []
        for r in self.runtime.knowledge_library.search(q, limit):
            ident = f"{r.get('source_id')}:{r.get('page')}"
            item = self._item('library', ident, r.get('title') or 'Library source', r.get('content'),
                              source='library', fields=(r.get('title'), r.get('content')))
            item['excerpt'] = excerpt(q, r.get('content'))
            item['url'] = r.get('url')
            item['score'] = score(q, r.get('title')) + float(r.get('score') or 0)
            out.append(item)
        return out

    # ------------------------------------------------------------------ aggregate

    def search(self, q: str = '', limit: int = 20, scopes: list[str] | None = None,
               project_id: str | None = None) -> dict:
        query = (q or '').strip()
        if len(query) < MIN_QUERY:
            return {'query': query, 'results': [], 'groups': {}, 'degraded': []}
        limit = max(1, min(int(limit or 20), MAX_LIMIT))
        wanted = set(scopes) if scopes else None
        results: list[dict] = []
        degraded: list[str] = []

        sources = [
            ('task', self._tasks), ('goal', self._goals), ('discovery', self._discoveries),
            ('plan', self._plans), ('run', self._runs), ('project', self._projects),
            ('milestone', self._milestones), ('conversation', self._conversations),
            ('memory', self._memories),
        ]
        for kind, fn in sources:
            if wanted and kind not in wanted:
                continue
            try:
                results.extend(fn(query, project_id))
            except Exception as exc:  # a broken source degrades, never kills the search
                degraded.append(f'{kind}: {exc}')

        if not wanted or 'note' in wanted:
            try:
                health = self.runtime.memory.health()
                if isinstance(health, dict) and health.get('reachable') is False:
                    degraded.append('vault: unreachable')
            except Exception as exc:
                degraded.append(f'vault: {exc}')
            try:
                results.extend(self._vault(query, limit))
            except Exception as exc:
                degraded.append(f'vault: {exc}')
        if not wanted or 'library' in wanted:
            try:
                results.extend(self._library(query, limit))
            except Exception as exc:
                degraded.append(f'library: {exc}')

        results.sort(key=lambda r: (-r['score'], r['kind'], str(r['id'])))
        results = results[:limit]
        groups: dict[str, int] = {}
        for r in results:
            groups[r['kind']] = groups.get(r['kind'], 0) + 1
        return {'query': query, 'results': results, 'groups': groups, 'degraded': degraded}


def add_search_routes(app, runtime) -> None:
    """Register /search on the FastAPI app (spec §2/§3/§5)."""
    search = SearchService(runtime)

    @app.get('/api/search')
    def global_search(q: str = '', limit: int = 20, scopes: str = '', project_id: str = ''):
        scope_list = [s.strip() for s in scopes.split(',') if s.strip()] or None
        return search.search(q, limit=limit, scopes=scope_list, project_id=project_id or None)
