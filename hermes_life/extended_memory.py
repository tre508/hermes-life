"""Episodic and relational memory layers (hermeshaobsidianexpansion.md §6A.2).

Episodic memory records meaningful experiences: significant conversations,
shared discoveries, milestones, unfinished discussions, with temporal and
narrative context.

Relational memory tracks the evolving conversational relationship: shared
humour, recurring references, collaborative patterns, established dynamics.
Each time a reference recurs its reinforcement count increases.
"""
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .conversation_recall import stamp, tokens

WORDS = re.compile(r"[a-z0-9][a-z0-9_./+-]{2,}", re.I)
STOP = set('the and that this with have from your you are was were for into about what when where which how can will should would then also they them been had does did all not but its just use using make more less now our one two new task hermes please'.split())

VAULT_ENV = 'HERMES_LIFE_OBSIDIAN_VAULT'
VAULT_DEFAULT = '/run/media/gayzer/black/obsidian/hermes'

_KINDS_EPISODIC = ('significant_conversation', 'shared_discovery', 'milestone',
                   'unfinished_discussion', 'lesson_learned', 'humorous_exchange',
                   'important_decision', 'opinion_change', 'personal_milestone')
_KINDS_RELATIONAL = ('shared_reference', 'conversational_dynamic',
                     'collaborative_pattern', 'evolving_understanding',
                     'shared_humour', 'recurring_theme')
STATUSES = ('active', 'superseded', 'archived')

# --------------------------------------------------------------------------- vault folders

FOLDERS_EPISODIC = {
    'significant_conversation': 'Significant-Conversations',
    'shared_discovery': 'Shared-Experiences',
    'milestone': 'Milestones',
    'unfinished_discussion': 'Unfinished-Discussions',
    'lesson_learned': 'Lessons-Learned',
    'humorous_exchange': 'Shared-Experiences',
    'important_decision': 'Significant-Conversations',
    'opinion_change': 'Milestones',
    'personal_milestone': 'Milestones',
}

FOLDERS_RELATIONAL = {
    'shared_reference': 'Shared-Humour',
    'conversational_dynamic': 'Conversational-History',
    'collaborative_pattern': 'Collaborative-Patterns',
    'evolving_understanding': 'Evolving-Understanding',
    'shared_humour': 'Shared-Humour',
    'recurring_theme': 'Recurring-References',
}

# --------------------------------------------------------------------------- schema

SCHEMA = """
CREATE TABLE IF NOT EXISTS hl_episodic_memories (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    context TEXT,
    significance TEXT,
    kind TEXT NOT NULL,
    retrieval_triggers TEXT NOT NULL DEFAULT '[]',
    emotional_context TEXT,
    source_turn_id INTEGER,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','archived')),
    superseded_by TEXT,
    created_at TEXT NOT NULL,
    significant_at TEXT,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hl_episodic_status ON hl_episodic_memories(status, created_at);
CREATE INDEX IF NOT EXISTS idx_hl_episodic_kind ON hl_episodic_memories(kind);
CREATE INDEX IF NOT EXISTS idx_hl_episodic_conversation ON hl_episodic_memories(conversation_id);

CREATE TABLE IF NOT EXISTS hl_relational_memories (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    context TEXT,
    significance TEXT,
    retrieval_triggers TEXT NOT NULL DEFAULT '[]',
    related_memory_ids TEXT NOT NULL DEFAULT '[]',
    origin_conversation_id TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','archived')),
    superseded_by TEXT,
    created_at TEXT NOT NULL,
    reinforced_count INTEGER NOT NULL DEFAULT 1,
    last_reinforced_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hl_relational_status ON hl_relational_memories(status, last_reinforced_at);
CREATE INDEX IF NOT EXISTS idx_hl_relational_category ON hl_relational_memories(category);
CREATE INDEX IF NOT EXISTS idx_hl_relational_triggers ON hl_relational_memories(retrieval_triggers);
"""

# --------------------------------------------------------------------------- helper

def _triggers_from_text(text):
    """Extract meaningful trigger keywords from text."""
    return sorted(t for t in tokens(text) if len(t) >= 3)[:20]

# ======================================================================= EpisodicMemory

class EpisodicMemory:
    """Records and retrieves significant conversational experiences."""

    def __init__(self, store):
        self.store = store
        with store.lock:
            store.connection.executescript(SCHEMA)
            store.connection.commit()
        self.vault = Path(os.environ.get(VAULT_ENV, VAULT_DEFAULT)).expanduser()
        self.base = self.vault / 'Hermes-Life' / '70-Episodic-Memory'

    # ---- CRUD ----

    def record(self, title, summary, kind='significant_conversation',
               context=None, significance=None,
               retrieval_triggers=None, emotional_context=None,
               conversation_id=None, source_turn_id=None,
               significant_at=None):
        """Store an episodic memory with its narrative context."""
        if kind not in _KINDS_EPISODIC:
            raise ValueError(f'Unsupported episodic kind: {kind}')
        summary = summary.strip()
        if not (20 <= len(summary) <= 4000):
            raise ValueError('Summary must be between 20 and 4000 characters')
        ident = str(uuid.uuid4())
        triggers = json.dumps(retrieval_triggers or _triggers_from_text(summary + ' ' + (context or '')))
        now_val = stamp()
        sig_at = significant_at or now_val
        with self.store.lock:
            self.store.connection.execute("""INSERT INTO hl_episodic_memories
                (id,conversation_id,title,summary,context,significance,kind,
                 retrieval_triggers,emotional_context,source_turn_id,
                 status,created_at,significant_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (ident, conversation_id, title.strip()[:200], summary,
                 (context or '').strip()[:2000] or None,
                 (significance or '').strip()[:1000] or None,
                 kind, triggers,
                 (emotional_context or '').strip()[:500] or None,
                 source_turn_id, 'active', now_val, sig_at, now_val))
            self.store.connection.commit()
        self._mirror(ident)
        self.store.emit('memory.episodic_created', {
            'id': ident, 'kind': kind, 'title': title[:80],
        }, origin='extended_memory')
        return {'id': ident, 'kind': kind, 'title': title[:200]}

    def get(self, ident):
        with self.store.lock:
            row = self.store.connection.execute(
                'SELECT * FROM hl_episodic_memories WHERE id=?', (ident,)
            ).fetchone()
            if row is None:
                raise KeyError('episodic memory not found')
            return dict(row)

    def list(self, limit=50, kind=None, status='active'):
        with self.store.lock:
            params = [status]
            kind_clause = ''
            if kind:
                kind_clause = ' AND kind=?'
                params.append(kind)
            rows = self.store.connection.execute(
                f'SELECT * FROM hl_episodic_memories WHERE status=?{kind_clause} ORDER BY significant_at DESC LIMIT ?',
                params + [min(max(int(limit), 1), 200)]
            ).fetchall()
            return [dict(r) for r in rows]

    def supersede(self, ident, replacement_id=None, rationale=None):
        with self.store.lock:
            row = self.store.connection.execute(
                'SELECT id FROM hl_episodic_memories WHERE id=? AND status="active"',
                (ident,)
            ).fetchone()
            if row is None:
                raise ValueError('Episodic memory not found or not active')
            now_val = stamp()
            self.store.connection.execute(
                'UPDATE hl_episodic_memories SET status="superseded", superseded_by=?, updated_at=? WHERE id=?',
                (replacement_id, now_val, ident))
            self.store.connection.commit()
        return {'id': ident, 'status': 'superseded'}

    # ---- retrieval ----

    def relevant_context(self, prompt, limit=4):
        """Ranked episodic memories relevant to the current prompt.

        Returns list of dicts with the memory context formatted for injection.
        """
        query = tokens(prompt)
        if len(query) < 2:
            return []
        with self.store.lock:
            rows = self.store.connection.execute(
                """SELECT id, title, summary, context, significance, kind,
                          retrieval_triggers, significant_at, created_at
                   FROM hl_episodic_memories WHERE status='active'
                   ORDER BY significant_at DESC LIMIT 500"""
            ).fetchall()
        scored = []
        for row in rows:
            triggers = set(json.loads(row['retrieval_triggers'])) if row['retrieval_triggers'] else set()
            # Score from triggers (direct match) + summary/context token overlap
            trigger_overlap = len(query & triggers)
            content_overlap = len(query & tokens(row['summary'] + ' ' + (row['context'] or '')))
            total = trigger_overlap * 4 + content_overlap  # triggers are stronger signal
            if total >= 3:
                scored.append((total, dict(row)))
        scored.sort(key=lambda x: -x[0])
        return scored[:limit]

    def format_context(self, entries):
        """Format episodic memories as injected context."""
        if not entries:
            return ''
        lines = ['[Episodic memory — previous shared experiences, reference context]']
        for _, entry in entries:
            lines.append(f"- {entry['title']} ({entry['kind']}): {entry['summary'][:400]}")
            if entry.get('significance'):
                lines.append(f"  Significance: {entry['significance'][:300]}")
        lines.append('[/Episodic memory]')
        return '\n'.join(lines) + '\n\n'

    # ---- Obsidian mirror ----

    def _mirror(self, ident):
        """Mirror an episodic memory to the vault."""
        if not self.vault.is_dir():
            return 'vault_unavailable'
        try:
            entry = self.get(ident)
        except KeyError:
            return 'missing'
        folder_name = FOLDERS_EPISODIC.get(entry['kind'], 'Other')
        dest = self.base / folder_name
        dest.mkdir(parents=True, exist_ok=True)
        path = dest / (ident + '.md')
        if path.exists():
            return 'exists'
        triggers = json.loads(entry['retrieval_triggers']) if entry['retrieval_triggers'] else []
        lines = [
            '---',
            f'hermes_memory_id: "{ident}"',
            f'kind: episodic_memory',
            f'episodic_kind: "{entry["kind"]}"',
            f'title: "{entry["title"]}"',
            f'status: "{entry["status"]}"',
            f'created_at: "{entry["created_at"]}"',
            f'significant_at: "{entry.get("significant_at") or entry["created_at"]}"',
            '---',
            '',
            f'# {entry["title"]}',
            '',
            entry['summary'],
        ]
        if entry.get('context'):
            lines.extend(['', '## Context', '', entry['context']])
        if entry.get('significance'):
            lines.extend(['', '## Significance', '', entry['significance']])
        if triggers:
            lines.extend(['', '## Triggers', '', ', '.join(triggers)])
        text = '\n'.join(lines) + '\n'
        tmp = dest / (ident + '.tmp')
        tmp.write_text(text, encoding='utf-8')
        tmp.replace(path)
        return 'written'


# ======================================================================= RelationalMemory

class RelationalMemory:
    """Tracks the evolving conversational relationship between user and assistant.

    Each relational memory has a reinforcement count — every time a reference
    recurs, the count increases and the trigger keywords are broadened.
    """

    def __init__(self, store):
        self.store = store
        with store.lock:
            store.connection.executescript(SCHEMA)
            store.connection.commit()
        self.vault = Path(os.environ.get(VAULT_ENV, VAULT_DEFAULT)).expanduser()
        self.base = self.vault / 'Hermes-Life' / '75-Relational-Memory'

    # ---- CRUD ----

    def record(self, category, title, context=None, significance=None,
               retrieval_triggers=None, related_memory_ids=None,
               origin_conversation_id=None):
        """Create a new relational memory."""
        if category not in _KINDS_RELATIONAL:
            raise ValueError(f'Unsupported relational category: {category}')
        context = (context or '').strip()
        if not context or len(context) < 20:
            raise ValueError('Context must be at least 20 characters')
        ident = str(uuid.uuid4())
        triggers = json.dumps(retrieval_triggers or _triggers_from_text(context))
        related = json.dumps(related_memory_ids or [])
        now_val = stamp()
        with self.store.lock:
            self.store.connection.execute("""INSERT INTO hl_relational_memories
                (id,category,title,context,significance,retrieval_triggers,
                 related_memory_ids,origin_conversation_id,status,
                 created_at,reinforced_count,last_reinforced_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (ident, category, title.strip()[:200], context,
                 (significance or '').strip()[:1000] or None,
                 triggers, related, origin_conversation_id,
                 'active', now_val, 1, now_val, now_val))
            self.store.connection.commit()
        self._mirror(ident)
        self.store.emit('memory.relational_created', {
            'id': ident, 'category': category, 'title': title[:80],
        }, origin='extended_memory')
        return {'id': ident, 'category': category, 'title': title[:200]}

    def reinforce(self, ident, additional_triggers=None):
        """Increment reinforcement count and optionally expand triggers."""
        with self.store.lock:
            row = self.store.connection.execute(
                'SELECT id,retrieval_triggers,reinforced_count FROM hl_relational_memories WHERE id=? AND status="active"',
                (ident,)
            ).fetchone()
            if row is None:
                raise ValueError('Relational memory not found or not active')
            now_val = stamp()
            triggers = set(json.loads(row['retrieval_triggers']) if row['retrieval_triggers'] else [])
            if additional_triggers:
                triggers.update(additional_triggers)
            self.store.connection.execute(
                'UPDATE hl_relational_memories SET reinforced_count=reinforced_count+1, retrieval_triggers=?, last_reinforced_at=?, updated_at=? WHERE id=?',
                (json.dumps(sorted(triggers)), now_val, now_val, ident))
            self.store.connection.commit()
        return {'id': ident, 'reinforced_count': row['reinforced_count'] + 1}

    def get(self, ident):
        with self.store.lock:
            row = self.store.connection.execute(
                'SELECT * FROM hl_relational_memories WHERE id=?', (ident,)
            ).fetchone()
            if row is None:
                raise KeyError('relational memory not found')
            return dict(row)

    def list(self, limit=50, category=None, status='active'):
        with self.store.lock:
            params = [status]
            kind_clause = ''
            if category:
                kind_clause = ' AND category=?'
                params.append(category)
            rows = self.store.connection.execute(
                f'SELECT * FROM hl_relational_memories WHERE status=?{kind_clause} ORDER BY last_reinforced_at DESC LIMIT ?',
                params + [min(max(int(limit), 1), 200)]
            ).fetchall()
            return [dict(r) for r in rows]

    def supersede(self, ident, replacement_id=None, rationale=None):
        with self.store.lock:
            row = self.store.connection.execute(
                'SELECT id FROM hl_relational_memories WHERE id=? AND status="active"',
                (ident,)
            ).fetchone()
            if row is None:
                raise ValueError('Relational memory not found or not active')
            now_val = stamp()
            self.store.connection.execute(
                'UPDATE hl_relational_memories SET status="superseded", superseded_by=?, updated_at=? WHERE id=?',
                (replacement_id, now_val, ident))
            self.store.connection.commit()
        return {'id': ident, 'status': 'superseded'}

    # ---- retrieval ----

    def relevant_context(self, prompt, limit=4):
        """Ranked relational memories relevant to the current prompt.

        Uses trigger keyword matching + content overlap, boosted by
        reinforcement count (frequently-referenced patterns rank higher).
        """
        query = tokens(prompt)
        if len(query) < 2:
            return []
        with self.store.lock:
            rows = self.store.connection.execute(
                """SELECT id, category, title, context, significance,
                          retrieval_triggers, reinforced_count, last_reinforced_at
                   FROM hl_relational_memories WHERE status='active'
                   ORDER BY last_reinforced_at DESC LIMIT 500"""
            ).fetchall()
        scored = []
        for row in rows:
            triggers = set(json.loads(row['retrieval_triggers']) if row['retrieval_triggers'] else set())
            trigger_overlap = len(query & triggers)
            content_overlap = len(query & tokens(row['context'] + ' ' + (row['significance'] or '')))
            total = trigger_overlap * 5 + content_overlap * 2
            if total >= 3:
                # Boost frequently-reinforced patterns
                reinforcement_boost = min(row['reinforced_count'], 10) * 0.5
                scored.append((total + reinforcement_boost, dict(row)))
        scored.sort(key=lambda x: -x[0])
        return scored[:limit]

    def format_context(self, entries):
        """Format relational memories as injected context."""
        if not entries:
            return ''
        lines = ['[Relational memory — conversational patterns and shared references]']
        for _, entry in entries:
            count = entry['reinforced_count']
            freq = f' (reinforced {count}x)' if count > 1 else ''
            lines.append(f"- {entry['title']} ({entry['category']}{freq}): {entry['context'][:400]}")
        lines.append('[/Relational memory]')
        return '\n'.join(lines) + '\n\n'

    def _mirror(self, ident):
        """Mirror a relational memory to the vault."""
        if not self.vault.is_dir():
            return 'vault_unavailable'
        try:
            entry = self.get(ident)
        except KeyError:
            return 'missing'
        folder_name = FOLDERS_RELATIONAL.get(entry['category'], 'Other')
        dest = self.base / folder_name
        dest.mkdir(parents=True, exist_ok=True)
        path = dest / (ident + '.md')
        if path.exists():
            return 'exists'
        triggers = json.loads(entry['retrieval_triggers']) if entry['retrieval_triggers'] else []
        related = json.loads(entry['related_memory_ids']) if entry['related_memory_ids'] else []
        lines = [
            '---',
            f'hermes_memory_id: "{ident}"',
            f'kind: relational_memory',
            f'relational_category: "{entry["category"]}"',
            f'title: "{entry["title"]}"',
            f'reinforced_count: {entry["reinforced_count"]}',
            f'status: "{entry["status"]}"',
            f'created_at: "{entry["created_at"]}"',
            '---',
            '',
            f'# {entry["title"]}',
            '',
            entry['context'],
        ]
        if entry.get('significance'):
            lines.extend(['', '## Significance', '', entry['significance']])
        if triggers:
            lines.extend(['', '## Retrieval Triggers', '', ', '.join(triggers)])
        if related:
            lines.extend(['', '## Related Memories', ''] + [f'- {mid}' for mid in related])
        text = '\n'.join(lines) + '\n'
        tmp = dest / (ident + '.tmp')
        tmp.write_text(text, encoding='utf-8')
        tmp.replace(path)
        return 'written'


# ======================================================================= API routes

def add_extended_memory_routes(app, runtime):
    """Register /api/memory/episodic/* and /api/memory/relational/* routes."""
    episodic: EpisodicMemory = runtime.episodic_memory
    relational: RelationalMemory = runtime.relational_memory

    # ---- episodic ----

    @app.get('/api/memory/episodic')
    def list_episodic(limit: int = 50, kind: str = '', status: str = 'active'):
        return {'memories': episodic.list(limit, kind or None, status)}

    @app.get('/api/memory/episodic/{memory_id}')
    def get_episodic(memory_id: str):
        try:
            return episodic.get(memory_id)
        except KeyError:
            from fastapi import HTTPException
            raise HTTPException(404, 'episodic memory not found')

    @app.post('/api/memory/episodic')
    def create_episodic(payload: dict):
        try:
            return episodic.record(
                title=str(payload.get('title', '')),
                summary=str(payload.get('summary', '')),
                kind=str(payload.get('kind', 'significant_conversation')),
                context=payload.get('context'),
                significance=payload.get('significance'),
                retrieval_triggers=payload.get('retrieval_triggers'),
                emotional_context=payload.get('emotional_context'),
                conversation_id=payload.get('conversation_id'),
                significant_at=payload.get('significant_at'),
            )
        except (ValueError, TypeError) as exc:
            from fastapi import HTTPException
            raise HTTPException(422, str(exc))

    @app.post('/api/memory/episodic/{memory_id}/supersede')
    def supersede_episodic(memory_id: str, payload: dict = {}):
        try:
            return episodic.supersede(memory_id, payload.get('replacement_id'), payload.get('rationale'))
        except (ValueError, KeyError) as exc:
            from fastapi import HTTPException
            raise HTTPException(400, str(exc))

    # ---- relational ----

    @app.get('/api/memory/relational')
    def list_relational(limit: int = 50, category: str = '', status: str = 'active'):
        return {'memories': relational.list(limit, category or None, status)}

    @app.get('/api/memory/relational/{memory_id}')
    def get_relational(memory_id: str):
        try:
            return relational.get(memory_id)
        except KeyError:
            from fastapi import HTTPException
            raise HTTPException(404, 'relational memory not found')

    @app.post('/api/memory/relational')
    def create_relational(payload: dict):
        try:
            return relational.record(
                category=str(payload.get('category', '')),
                title=str(payload.get('title', '')),
                context=payload.get('context'),
                significance=payload.get('significance'),
                retrieval_triggers=payload.get('retrieval_triggers'),
                related_memory_ids=payload.get('related_memory_ids'),
                origin_conversation_id=payload.get('origin_conversation_id'),
            )
        except (ValueError, TypeError) as exc:
            from fastapi import HTTPException
            raise HTTPException(422, str(exc))

    @app.post('/api/memory/relational/{memory_id}/reinforce')
    def reinforce_relational(memory_id: str, payload: dict = {}):
        try:
            return relational.reinforce(memory_id, payload.get('additional_triggers'))
        except (ValueError, KeyError) as exc:
            from fastapi import HTTPException
            raise HTTPException(400, str(exc))

    @app.post('/api/memory/relational/{memory_id}/supersede')
    def supersede_relational(memory_id: str, payload: dict = {}):
        try:
            return relational.supersede(memory_id, payload.get('replacement_id'), payload.get('rationale'))
        except (ValueError, KeyError) as exc:
            from fastapi import HTTPException
            raise HTTPException(400, str(exc))

    # ---- unified context (for calling from compose_prompt) ----

    @app.get('/api/memory/context')
    def memory_context(q: str = ''):
        """Unified context from ALL memory layers for a given query."""
        if not q:
            return {'episodic': [], 'relational': [], 'semantic': []}
        ep = episodic.relevant_context(q)
        rel = relational.relevant_context(q)
        sem = runtime.recall.relevant_context(q)
        return {
            'episodic': [{'id': e[1]['id'], 'title': e[1]['title'], 'summary': e[1]['summary'][:300]} for e in ep],
            'relational': [{'id': r[1]['id'], 'title': r[1]['title'], 'context': r[1]['context'][:300]} for r in rel],
            'semantic': [{'id': s['memory_id'] or '', 'text': s['text'][:300]} for s in sem],
        }