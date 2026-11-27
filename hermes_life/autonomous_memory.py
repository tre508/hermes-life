"""Autonomous episodic and relational memory formation (hermeshaobsidianexpansion.md §6A.5).

Evaluates conversation turns after completion and proposes episodic/relational
memory records without requiring the user to explicitly request storage.

Hooks into Runtime.run_task() alongside vault_memory.extract_completed().
"""
import json
import os
import re
import uuid
from pathlib import Path

from .conversation_recall import stamp, tokens

PRIVATE = re.compile(r'(?i)(?:password\s*[:=]|api[_ -]?key\s*[:=]|bearer\s+[a-z0-9]|sk-[a-z0-9]|private[_ -]?key|-----BEGIN .*PRIVATE KEY-----)')

#: Episodic kinds deemed significant enough for autonomous formation.
AUTO_EPISODIC_KINDS = (
    'significant_conversation', 'shared_discovery', 'milestone',
    'unfinished_discussion', 'lesson_learned', 'humorous_exchange',
    'important_decision',
)

#: Relational categories that can be detected conversationally.
AUTO_RELATIONAL_CATEGORIES = (
    'shared_reference', 'conversational_dynamic', 'collaborative_pattern',
    'evolving_understanding', 'shared_humour', 'recurring_theme',
)


def _compact(text):
    return ' '.join(str(text).split())


def _parse_json(text):
    text = text.strip()
    if text.startswith('```'):
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text, flags=re.I).strip()
    return json.loads(text)


# --------------------------------------------------------------------------- formation prompts

_EPISODIC_PROMPT = """You are a memory formation service. Your only job is to evaluate a conversation
exchange and determine whether it produced something worth remembering as an
episodic memory — a significant experience, discovery, milestone, unfinished
discussion, lesson, humorous exchange, or important decision.

Rules:
- Only propose memories that are clearly supported by the conversation text.
- Do NOT fabricate significance where none exists.
- Most routine exchanges produce nothing durable — return empty in that case.
- The summary must be factual and grounded in the exchange, not dramatic.
- Max 3 candidates. Quality over quantity.
- Return ONLY valid JSON, no other text.

EXISTING EPISODIC MEMORIES:
{existing}

USER MESSAGE:
{user_text}

ASSISTANT RESPONSE:
{assistant_text}

Respond with a JSON object in this exact schema:
{{
  "candidates": [
    {{
      "kind": "significant_conversation|shared_discovery|milestone|unfinished_discussion|lesson_learned|humorous_exchange|important_decision",
      "title": "short descriptive title",
      "summary": "concise factual summary of what happened (20-400 chars)",
      "context": "narrative context of the exchange",
      "significance": "why this matters or is worth remembering",
      "retrieval_triggers": ["keyword1", "keyword2", ...],
      "emotional_context": "optional emotional tone"
    }}
  ]
}}

If nothing is worth remembering as an episodic memory, return {{"candidates": []}}.
"""



_RELATIONAL_PROMPT = """You are a relational memory formation service. Your only job is to evaluate
a conversation exchange and detect whether it reveals or reinforces a
relational pattern: shared references, conversational dynamics, collaborative
patterns, evolving understanding, shared humour, or recurring themes.

Rules:
- Only propose memories that are clearly supported by the conversation text.
- Do NOT fabricate rapport where none exists.
- Most routine exchanges produce nothing durable — return empty in that case.
- Max 2 candidates. Quality over quantity.
- Return ONLY valid JSON, no other text.

EXISTING RELATIONAL MEMORIES:
{existing}

USER MESSAGE:
{user_text}

ASSISTANT RESPONSE:
{assistant_text}

Respond with a JSON object in this exact schema:
{{
  "candidates": [
    {{
      "category": "shared_reference|conversational_dynamic|collaborative_pattern|evolving_understanding|shared_humour|recurring_theme",
      "title": "short descriptive title",
      "context": "description of the relational pattern (20+ chars)",
      "significance": "why this matters for the conversational relationship",
      "retrieval_triggers": ["keyword1", "keyword2", ...],
      "reinforce_existing_id": "optional: id of an existing relational memory this reinforces"
    }}
  ]
}}

If nothing worth remembering relationally, return {{"candidates": []}}.
"""


# ======================================================================= AutonomousMemory

class AutonomousMemory:
    """Autonomous formation of episodic and relational memories after conversation turns.

    Hooks into Runtime.run_task() alongside the existing VaultMemory extraction.
    Each extracted memory is validated and stored via the existing EpisodicMemory
    and RelationalMemory classes, then mirrored to the Obsidian vault.
    """

    def __init__(self, store, episodic_memory, relational_memory, adapter=None):
        self.store = store
        self.episodic = episodic_memory
        self.relational = relational_memory
        self.adapter = adapter
        #: Track processed tasks so each task is evaluated at most once.
        #: Cleared periodically; the DB is the durable source of truth.
        self._processed: set[str] = set()

    # ---- read conversation turn (parallels VaultMemory._read) ----

    def _read_turn(self, conversation_id, task_id):
        """Read the most recent user+assistant turn for a completed task."""
        with self.store.lock:
            db = self.store.connection
            task = db.execute('SELECT state FROM tasks WHERE id=?', (task_id,)).fetchone()
            if not task or task['state'] != 'completed':
                return None
            user = db.execute('''SELECT t.id, t.content FROM hl_conversation_turns t
                WHERE t.conversation_id=? AND t.task_id=? AND t.role='user'
                AND NOT EXISTS(SELECT 1 FROM hl_turn_revisions r WHERE r.original_turn_id=t.id)
                ORDER BY t.id DESC LIMIT 1''',
                (conversation_id, task_id)).fetchone()
            if not user:
                return None
            assistant = db.execute('''SELECT content FROM hl_conversation_turns
                WHERE conversation_id=? AND task_id=? AND role='assistant'
                ORDER BY id DESC LIMIT 1''',
                (conversation_id, task_id)).fetchone()
            return dict(user), (assistant['content'] if assistant else '')

    def _existing_episodic(self):
        """Load recent active episodic memories for dedup/context."""
        with self.store.lock:
            rows = self.store.connection.execute(
                '''SELECT id, title, summary, kind, retrieval_triggers
                   FROM hl_episodic_memories WHERE status='active'
                   ORDER BY created_at DESC LIMIT 80'''
            ).fetchall()
        return [dict(r) for r in rows]

    def _existing_relational(self):
        """Load recent active relational memories for dedup/reinforce."""
        with self.store.lock:
            rows = self.store.connection.execute(
                '''SELECT id, category, title, context, retrieval_triggers,
                          reinforced_count
                   FROM hl_relational_memories WHERE status='active'
                   ORDER BY last_reinforced_at DESC LIMIT 80'''
            ).fetchall()
        return [dict(r) for r in rows]

    # ---- episodic formation ----

    def _propose_episodic(self, user_text, assistant_text, existing):
        """Ask the analysis adapter to propose episodic memory candidates."""
        if self.adapter is None:
            return []
        old = [{'id': e['id'], 'title': e['title'][:100],
                'summary': e['summary'][:300], 'kind': e['kind']}
               for e in existing[:30]]
        prompt = _EPISODIC_PROMPT.format(
            existing=json.dumps(old, ensure_ascii=False),
            user_text=json.dumps(user_text[:3000], ensure_ascii=False),
            assistant_text=json.dumps(assistant_text[:2000], ensure_ascii=False),
        )
        response = self.adapter.run(prompt, lambda *_: None)
        try:
            obj = _parse_json(response.get('result', ''))
        except (json.JSONDecodeError, ValueError):
            return []
        if not isinstance(obj, dict):
            return []
        items = obj.get('candidates', [])
        if not isinstance(items, list):
            return []
        return [item for item in items if isinstance(item, dict)]

    def _store_episodic(self, candidate, conversation_id, source_turn_id):
        """Validate and store an episodic candidate. Returns stored id or None."""
        kind = candidate.get('kind', '')
        if kind not in AUTO_EPISODIC_KINDS:
            return None
        title = _compact(candidate.get('title', ''))[:200]
        summary = _compact(candidate.get('summary', ''))
        if not title or not (20 <= len(summary) <= 4000):
            return None
        context = _compact(candidate.get('context', ''))[:2000] or None
        significance = _compact(candidate.get('significance', ''))[:1000] or None
        triggers = candidate.get('retrieval_triggers')
        if isinstance(triggers, list):
            triggers = [str(t) for t in triggers if isinstance(t, (str, int))][:20]
        else:
            triggers = None
        emotional = _compact(candidate.get('emotional_context', ''))[:500] or None
        try:
            result = self.episodic.record(
                title=title, summary=summary, kind=kind,
                context=context, significance=significance,
                retrieval_triggers=triggers,
                emotional_context=emotional,
                conversation_id=conversation_id,
                source_turn_id=source_turn_id,
            )
            return result['id']
        except (ValueError, TypeError):
            return None

    # ---- relational formation ----

    def _propose_relational(self, user_text, assistant_text, existing):
        """Ask the analysis adapter to propose relational memory candidates."""
        if self.adapter is None:
            return []
        old = [{'id': e['id'], 'category': e['category'],
                'title': e['title'][:100], 'context': e['context'][:300],
                'reinforced_count': e['reinforced_count']}
               for e in existing[:30]]
        prompt = _RELATIONAL_PROMPT.format(
            existing=json.dumps(old, ensure_ascii=False),
            user_text=json.dumps(user_text[:3000], ensure_ascii=False),
            assistant_text=json.dumps(assistant_text[:2000], ensure_ascii=False),
        )
        response = self.adapter.run(prompt, lambda *_: None)
        try:
            obj = _parse_json(response.get('result', ''))
        except (json.JSONDecodeError, ValueError):
            return []
        if not isinstance(obj, dict):
            return []
        items = obj.get('candidates', [])
        if not isinstance(items, list):
            return []
        return [item for item in items if isinstance(item, dict)]

    def _store_relational(self, candidate, conversation_id):
        """Validate and store a relational candidate, handling reinforce vs new."""
        category = candidate.get('category', '')
        if category not in AUTO_RELATIONAL_CATEGORIES:
            return None
        title = _compact(candidate.get('title', ''))[:200]
        context = _compact(candidate.get('context', ''))
        if not title or not context or len(context) < 20:
            return None
        significance = _compact(candidate.get('significance', ''))[:1000] or None
        triggers = candidate.get('retrieval_triggers')
        if isinstance(triggers, list):
            triggers = [str(t) for t in triggers if isinstance(t, (str, int))][:20]
        else:
            triggers = None
        reinforce_id = candidate.get('reinforce_existing_id', '')

        # If the candidate names an existing memory to reinforce
        if reinforce_id:
            try:
                existing = self.relational.get(reinforce_id)
                if existing and existing['status'] == 'active':
                    self.relational.reinforce(reinforce_id, triggers)
                    return {'id': reinforce_id, 'action': 'reinforced'}
            except (KeyError, ValueError):
                pass  # fall through to creating new

        # Check for strong similarity with existing active memories
        if not reinforce_id:
            for existing in self._existing_relational():
                if existing['status'] != 'active':
                    continue
                e_title = existing.get('title', '').lower()
                e_context = existing.get('context', '').lower()
                if (title.lower() == e_title or
                        context.lower()[:100] == e_context[:100]):
                    try:
                        self.relational.reinforce(existing['id'], triggers)
                        return {'id': existing['id'], 'action': 'reinforced'}
                    except (KeyError, ValueError):
                        pass

        # Create new
        try:
            result = self.relational.record(
                category=category, title=title, context=context,
                significance=significance,
                retrieval_triggers=triggers,
                origin_conversation_id=conversation_id,
            )
            return {'id': result['id'], 'action': 'created'}
        except (ValueError, TypeError):
            return None

    # ---- main extract method ----

    def extract_completed(self, conversation_id, task_id):
        """Evaluate a completed task for episodic and relational memory formation.

        Called from Runtime.run_task() after vault_memory.extract_completed().
        Returns count of memories formed.
        """
        # Skip if already processed or no adapter
        if task_id in self._processed or self.adapter is None:
            return 0
        if not conversation_id:
            return 0

        # Read the turn
        data = self._read_turn(conversation_id, task_id)
        if not data:
            return 0
        user_row, assistant_text = data
        user_text = user_row['content']

        # Skip very short or private messages
        if len(user_text) < 40 or len(user_text) > 6000:
            self._processed.add(task_id)
            return 0
        if PRIVATE.search(user_text):
            self._processed.add(task_id)
            return 0

        formed = 0

        # Episodic
        try:
            existing_ep = self._existing_episodic()
            ep_candidates = self._propose_episodic(user_text, assistant_text, existing_ep)
            for cand in ep_candidates[:3]:
                result = self._store_episodic(cand, conversation_id, user_row['id'])
                if result:
                    formed += 1
        except Exception as exc:
            self.store.emit('autonomous_memory.episodic_failed',
                            {'task_id': task_id, 'error': type(exc).__name__}, task_id)

        # Relational
        try:
            existing_rel = self._existing_relational()
            rel_candidates = self._propose_relational(user_text, assistant_text, existing_rel)
            for cand in rel_candidates[:2]:
                result = self._store_relational(cand, conversation_id)
                if result:
                    formed += 1
        except Exception as exc:
            self.store.emit('autonomous_memory.relational_failed',
                            {'task_id': task_id, 'error': type(exc).__name__}, task_id)

        # Record the run
        self._processed.add(task_id)
        # Limit the in-memory set to avoid unbounded growth
        if len(self._processed) > 1000:
            self._processed = set(list(self._processed)[-500:])

        if formed:
            self.store.emit('autonomous_memory.formation',
                            {'task_id': task_id, 'memories_formed': formed}, task_id)

        return formed


# ======================================================================= API routes

def add_autonomous_memory_routes(app, runtime):
    """Register autonomous memory endpoints."""
    autonomous: AutonomousMemory = runtime.autonomous_memory

    @app.get('/api/autonomous-memory/status')
    def autonomous_memory_status():
        return {
            'adapter_available': autonomous.adapter is not None,
            'processed_count': len(autonomous._processed),
        }

    @app.post('/api/autonomous-memory/extract')
    def autonomous_memory_extract(payload: dict):
        """Manually trigger extraction for a completed task."""
        conversation_id = payload.get('conversation_id', '') or None
        task_id = payload.get('task_id', '') or None
        if not conversation_id or not task_id:
            from fastapi import HTTPException
            raise HTTPException(422, 'conversation_id and task_id are required')
        try:
            count = autonomous.extract_completed(conversation_id, task_id)
            return {'memories_formed': count}
        except Exception as exc:
            from fastapi import HTTPException
            raise HTTPException(500, str(exc))

    @app.get('/api/autonomous-memory/stats')
    def autonomous_memory_stats():
        """Aggregate stats on what's been formed."""
        with runtime.store.lock:
            db = runtime.store.connection
            ep_count = db.execute(
                "SELECT COUNT(*) FROM hl_episodic_memories WHERE status='active'"
            ).fetchone()[0]
            rel_count = db.execute(
                "SELECT COUNT(*) FROM hl_relational_memories WHERE status='active'"
            ).fetchone()[0]
            ep_by_kind = dict(db.execute(
                'SELECT kind, COUNT(*) FROM hl_episodic_memories WHERE status="active" GROUP BY kind'
            ).fetchall())
            rel_by_cat = dict(db.execute(
                'SELECT category, COUNT(*) FROM hl_relational_memories WHERE status="active" GROUP BY category'
            ).fetchall())
        return {
            'episodic': {'total': ep_count, 'by_kind': ep_by_kind},
            'relational': {'total': rel_count, 'by_category': rel_by_cat},
        }