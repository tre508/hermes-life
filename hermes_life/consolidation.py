"""Memory consolidation service (hermeshaobsidianexpansion.md §6A.6).

Periodically associates related memories, identifies recurring themes,
reduces redundancy, and marks outdated understanding. Follows the same
threading pattern as DecisionEngine and Autonomy.

Consolidation never deletes data — it supersedes, merges, or archives.
All actions are logged as events for user inspection.
"""
import json
import threading
from datetime import datetime, timezone, timedelta
from uuid import uuid4
from .store import now

# Kinds that can be consolidated (superseded/merged).
CONSOLIDATABLE_EPISODIC_KINDS = frozenset({
    'significant_conversation', 'shared_discovery', 'milestone',
    'unfinished_discussion', 'lesson_learned', 'humorous_exchange',
    'important_decision',
})
CONSOLIDATABLE_RELATIONAL_CATEGORIES = frozenset({
    'shared_reference', 'conversational_dynamic', 'collaborative_pattern',
    'evolving_understanding', 'shared_humour', 'recurring_theme',
})

# Minimum age (days) before a memory is eligible for consolidation.
MIN_AGE_DAYS = 1


class MemoryConsolidation:
    """Periodic memory consolidation — association, dedup, theme detection.

    Designed for API control (configure, trigger, status), following the same
    threaded-loop pattern as DecisionEngine.
    """

    def __init__(self, store):
        self.store = store
        self.stop_event = threading.Event()
        self.worker = None

    # ------------------------------------------------------------------- settings

    def settings(self):
        with self.store.lock:
            row = self.store.connection.execute(
                'SELECT * FROM consolidation_settings WHERE id=1'
            ).fetchone()
            base = dict(row) if row else {}
            # Defaults for a row that exists but may have partial values
            return {
                'enabled': bool(base.get('enabled', False)),
                'interval_seconds': int(base.get('interval_seconds', 21600)),
                'last_run': base.get('last_run'),
                'next_run': base.get('next_run'),
                'last_error': base.get('last_error'),
                'total_consolidated': int(base.get('total_consolidated', 0)),
            }

    def configure(self, enabled, interval=None):
        if interval is not None and not 3600 <= interval <= 86400:
            raise ValueError('Consolidation interval must be 3600–86400 seconds')
        with self.store.lock:
            if interval is None:
                self.store.connection.execute(
                    'UPDATE consolidation_settings SET enabled=? WHERE id=1',
                    (int(enabled),))
            else:
                self.store.connection.execute(
                    'UPDATE consolidation_settings SET enabled=?,interval_seconds=? WHERE id=1',
                    (int(enabled), interval))
            self.store.connection.commit()
        self.store.emit('consolidation.configured',
                        {'enabled': enabled, 'interval': interval})
        return self.settings()

    # ------------------------------------------------------------------- tick

    def tick(self, force=False):
        """One consolidation pass.

        Returns a dict describing what happened so the API and loop can report it.
        """
        cfg = self.settings()
        if not cfg['enabled'] and not force:
            return {'action': 'paused'}

        # Cooldown check — skip if next_run hasn't elapsed (unless forced)
        if not force and cfg.get('next_run'):
            try:
                next_dt = datetime.fromisoformat(cfg['next_run'])
                if datetime.now(timezone.utc) < next_dt:
                    return {'action': 'rest',
                            'reason': 'next consolidation in '
                                      f'{(next_dt - datetime.now(timezone.utc)).seconds}s'}
            except (ValueError, TypeError):
                pass

        if not self.store.connected():
            return {'action': 'error', 'reason': 'database not connected'}

        try:
            # Run the three consolidation passes
            ep_result = self._consolidate_episodic()
            rel_result = self._consolidate_relational()
            theme_result = self._identify_recurring_themes()

            total = (ep_result.get('actioned', 0)
                     + rel_result.get('actioned', 0)
                     + theme_result.get('themes_found', 0))

            # Update settings
            cutoff = now()
            interval = cfg['interval_seconds']
            next_dt = datetime.now(timezone.utc) + timedelta(seconds=interval)

            with self.store.lock:
                self.store.connection.execute(
                    '''UPDATE consolidation_settings
                       SET last_run=?, next_run=?, last_error=NULL,
                           total_consolidated=total_consolidated+?
                       WHERE id=1''',
                    (cutoff, next_dt.isoformat(), total))
                self.store.connection.commit()

            result = {
                'action': 'consolidated',
                'episodic': ep_result,
                'relational': rel_result,
                'themes': theme_result,
                'total_actioned': total,
            }
            self.store.emit('consolidation.completed', result)
            return result

        except Exception as exc:
            err_msg = f'{type(exc).__name__}: {exc}'
            with self.store.lock:
                self.store.connection.execute(
                    'UPDATE consolidation_settings SET last_error=?,last_run=? WHERE id=1',
                    (err_msg[:500], now()))
                self.store.connection.commit()
            self.store.emit('consolidation.error', {'error': err_msg})
            return {'action': 'error', 'reason': err_msg}

    # ------------------------------------------------------------------- passes

    def _consolidate_episodic(self):
        """Pass 1: Find and merge duplicate/redundant episodic memories.

        Two memories are considered candidates for consolidation when they share
        the same kind AND have significant keyword overlap in their summaries.
        """
        actioned = 0  # number of memories superseded or merged
        details = []

        with self.store.lock:
            rows = self.store.connection.execute(
                '''SELECT id, kind, summary, retrieval_triggers, context, significance,
                          created_at
                   FROM hl_episodic_memories
                   WHERE status='active'
                   ORDER BY kind, created_at ASC'''
            ).fetchall()

        if len(rows) < 2:
            return {'actioned': 0, 'details': []}

        # Group by kind for pairwise comparison within each group
        by_kind: dict[str, list[dict]] = {}
        for r in rows:
            k = str(r['kind'])
            by_kind.setdefault(k, []).append(dict(r))

        for kind, group in by_kind.items():
            if kind not in CONSOLIDATABLE_EPISODIC_KINDS:
                continue
            if len(group) < 2:
                continue

            # Compare each pair within the same kind
            to_supersede: set[str] = set()
            for i in range(len(group)):
                if group[i]['id'] in to_supersede:
                    continue
                for j in range(i + 1, len(group)):
                    if group[j]['id'] in to_supersede:
                        continue
                    score = self._keyword_overlap(
                        group[i]['summary'] + ' ' + str(group[i].get('context', '')),
                        group[j]['summary'] + ' ' + str(group[j].get('context', '')),
                    )
                    if score >= 0.55:
                        # Keep the older one (more established), supersede the newer
                        older = group[i]
                        newer = group[j]
                        self._supersede_episodic(newer['id'], older['id'],
                                                  f'Consolidation: merged duplicate {kind} '
                                                  f'(similarity {score:.0%})')
                        to_supersede.add(newer['id'])
                        actioned += 1
                        details.append({
                            'action': 'superseded',
                            'kind': kind,
                            'kept': older['id'],
                            'removed': newer['id'],
                            'similarity': round(score, 2),
                        })

        return {'actioned': actioned, 'details': details}

    def _consolidate_relational(self):
        """Pass 2: Merge duplicate relational memories (same category, overlapping triggers)."""
        actioned = 0
        details = []

        with self.store.lock:
            rows = self.store.connection.execute(
                '''SELECT id, category, title, retrieval_triggers, context
                   FROM hl_relational_memories
                   WHERE status='active'
                   ORDER BY category, reinforced_count DESC'''
            ).fetchall()

        if len(rows) < 2:
            return {'actioned': 0, 'details': []}

        by_cat: dict[str, list[dict]] = {}
        for r in rows:
            c = str(r['category'])
            by_cat.setdefault(c, []).append(dict(r))

        for cat, group in by_cat.items():
            if cat not in CONSOLIDATABLE_RELATIONAL_CATEGORIES:
                continue
            if len(group) < 2:
                continue

            to_supersede: set[str] = set()
            for i in range(len(group)):
                if group[i]['id'] in to_supersede:
                    continue
                for j in range(i + 1, len(group)):
                    if group[j]['id'] in to_supersede:
                        continue
                    score = self._trigger_overlap(
                        json.loads(group[i].get('retrieval_triggers', '[]')),
                        json.loads(group[j].get('retrieval_triggers', '[]')),
                    )
                    if score >= 0.60:
                        # Keep the one with more reinforcements
                        older = group[i] if group[i].get('reinforced_count', 1) >= group[j].get('reinforced_count', 1) else group[j]
                        newer = group[j] if older['id'] == group[i]['id'] else group[i]
                        self._supersede_relational(newer['id'], older['id'],
                                                    f'Consolidation: merged {cat} '
                                                    f'(trigger overlap {score:.0%})')
                        to_supersede.add(newer['id'])
                        actioned += 1
                        details.append({
                            'action': 'superseded',
                            'category': cat,
                            'kept': older['id'],
                            'removed': newer['id'],
                            'similarity': round(score, 2),
                        })

        return {'actioned': actioned, 'details': details}

    def _identify_recurring_themes(self):
        """Pass 3: Identify recurring themes across episodic memories of the same kind.

        Rather than creating new memory records directly, this logs observations
        that the user can review and optionally promote.
        """
        themes_found = 0
        observations = []

        with self.store.lock:
            rows = self.store.connection.execute(
                '''SELECT id, kind, summary, context, retrieval_triggers, created_at
                   FROM hl_episodic_memories
                   WHERE status='active'
                   ORDER BY kind, created_at ASC'''
            ).fetchall()

        if len(rows) < 3:
            return {'themes_found': 0, 'observations': []}

        by_kind: dict[str, list[dict]] = {}
        for r in rows:
            k = str(r['kind'])
            by_kind.setdefault(k, []).append(dict(r))

        for kind, group in by_kind.items():
            # Look for groups of 3+ with shared keywords in summaries
            word_map: dict[str, list[str]] = {}
            for mem in group:
                text = (str(mem.get('summary', '')) + ' ' + str(mem.get('context', ''))).lower()
                # Extract significant words (4+ chars, not common stopwords)
                stopwords = {'this', 'that', 'with', 'from', 'have', 'been', 'were',
                             'what', 'when', 'where', 'which', 'about', 'into',
                             'their', 'them', 'then', 'they', 'just', 'also', 'could',
                             'said', 'there', 'more', 'some', 'would', 'other', 'than',
                             'very', 'after', 'well', 'even', 'still', 'such', 'because'}
                words = {w for w in text.split() if len(w) >= 4 and w not in stopwords}
                for w in words:
                    word_map.setdefault(w, []).append(mem['id'])

            # Any word shared by 3+ distinct memories suggests a recurring theme
            for word, mem_ids in word_map.items():
                unique = set(mem_ids)
                if len(unique) >= 3:
                    themes_found += 1
                    observations.append({
                        'theme_keyword': word,
                        'kind': kind,
                        'memory_ids': sorted(unique)[:10],  # cap for readability
                        'count': len(unique),
                    })

            # Log the top themes as events if any were found
            if observations:
                top = sorted(observations, key=lambda o: -o['count'])[:5]
                self.store.emit('consolidation.themes_found', {
                    'kind': kind,
                    'themes': top,
                })

        return {'themes_found': themes_found, 'observations': observations[:20]}

    # ------------------------------------------------------------------- helpers

    def _keyword_overlap(self, text_a, text_b):
        """Jaccard-style similarity on keyword tokens between two texts."""
        stop = {'the', 'and', 'this', 'that', 'with', 'from', 'have', 'been',
                'were', 'what', 'when', 'where', 'which', 'into', 'their',
                'them', 'then', 'they', 'just', 'also', 'could', 'said',
                'there', 'more', 'some', 'would', 'other', 'than', 'very',
                'after', 'well', 'even', 'still', 'such', 'was', 'are',
                'has', 'had', 'but', 'not', 'for', 'all', 'its', 'how',
                'about', 'your', 'you', 'our', 'one', 'two', 'new', 'hermes',
                'task', 'please', 'make', 'use', 'using', 'does', 'done',
                'now', 'then', 'can', 'will', 'should', 'may', 'need'}
        set_a = {w.lower().strip('.,!?;:()[]{}"\'-') for w in text_a.split()
                 if len(w.strip('.,!?;:()[]{}"\'-')) >= 3
                 and w.lower().strip('.,!?;:()[]{}"\'-') not in stop}
        set_b = {w.lower().strip('.,!?;:()[]{}"\'-') for w in text_b.split()
                 if len(w.strip('.,!?;:()[]{}"\'-')) >= 3
                 and w.lower().strip('.,!?;:()[]{}"\'-') not in stop}
        if not set_a or not set_b:
            return 0.0
        intersection = set_a & set_b
        union = set_a | set_b
        return len(intersection) / len(union) if union else 0.0

    def _trigger_overlap(self, triggers_a, triggers_b):
        """Jaccard similarity on retrieval trigger lists."""
        set_a = {str(t).lower() for t in triggers_a}
        set_b = {str(t).lower() for t in triggers_b}
        if not set_a or not set_b:
            return 0.0
        intersection = set_a & set_b
        union = set_a | set_b
        return len(intersection) / len(union) if union else 0.0

    def _supersede_episodic(self, old_id, new_id, rationale):
        with self.store.lock:
            self.store.connection.execute(
                '''UPDATE hl_episodic_memories
                   SET status='superseded', superseded_by=?, updated_at=?
                   WHERE id=? AND status='active' ''',
                (new_id, now(), old_id))
            self.store.connection.commit()

    def _supersede_relational(self, old_id, new_id, rationale):
        with self.store.lock:
            self.store.connection.execute(
                '''UPDATE hl_relational_memories
                   SET status='superseded', superseded_by=?, updated_at=?
                   WHERE id=? AND status='active' ''',
                (new_id, now(), old_id))
            self.store.connection.commit()

        # Also merge retrieval triggers from the superseded into the kept memory
        with self.store.lock:
            old_row = self.store.connection.execute(
                'SELECT retrieval_triggers FROM hl_relational_memories WHERE id=?',
                (old_id,)).fetchone()
            new_row = self.store.connection.execute(
                'SELECT retrieval_triggers FROM hl_relational_memories WHERE id=?',
                (new_id,)).fetchone()
            if old_row and new_row:
                old_triggers = set(json.loads(old_row['retrieval_triggers']))
                new_triggers = set(json.loads(new_row['retrieval_triggers']))
                merged = sorted(old_triggers | new_triggers)
                new_count = min(int(new_row.get('reinforced_count', 1)) + 1, 999)
                self.store.connection.execute(
                    '''UPDATE hl_relational_memories
                       SET retrieval_triggers=?, reinforced_count=?,
                           last_reinforced_at=?, updated_at=?
                       WHERE id=?''',
                    (json.dumps(merged), new_count, now(), now(), new_id))
                self.store.connection.commit()

    # --------------------------------------------------------------- lifecycle

    def start(self):
        if self.worker and self.worker.is_alive():
            return
        self.stop_event.clear()
        self.worker = threading.Thread(
            target=self.loop, daemon=True, name='hermes-life-consolidation')
        self.worker.start()

    def stop(self):
        self.stop_event.set()
        if self.worker:
            self.worker.join(timeout=3)

    def loop(self):
        while not self.stop_event.wait(30):  # check every 30s, but only runs on interval
            try:
                self.tick()
            except Exception:
                pass  # Errors are stored in consolidation_settings and emitted as events


# =============================================================================
# API routes
# =============================================================================

def add_consolidation_routes(app, runtime):
    """Register /api/consolidation/* endpoints on the FastAPI app."""
    consolidation: MemoryConsolidation = runtime.consolidation

    @app.get('/api/consolidation/status')
    def consolidation_status():
        return consolidation.settings()

    @app.put('/api/consolidation/configure')
    def consolidation_configure(payload: dict):
        enabled = bool(payload.get('enabled', True))
        interval = payload.get('interval_seconds')
        if interval is not None:
            interval = int(interval)
        return consolidation.configure(enabled, interval)

    @app.post('/api/consolidation/run')
    def consolidation_run():
        return consolidation.tick(force=True)