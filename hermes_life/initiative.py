"""HL-AUTO-001 Phase 2 (§26.10): evidence ingestion, repeated-pattern and skill-gap detection.

Everything here reads ONLY persisted operational records (tasks, goals, memory corrections)
and produces fingerprint-keyed hypotheses. Unchanged sources yield zero new records on a
re-scan — a repeated scan alone is never counted as progress (§26.4). Skill evidence is
accepted only from a real task that actually ran; a model claim of mastery is refused.
"""
import hashlib
import json
import re
from uuid import uuid4
from .store import now

DEFAULT_WEIGHTS = {'relevance': 0.5, 'evidence': 0.3, 'novelty': 0.2}


def _signature(*parts):
    normalized = '|'.join(' '.join(p.lower().split()) for p in parts)
    return hashlib.sha1(normalized.encode('utf-8')).hexdigest()[:16]


def _normalize_prompt(text):
    # Strip project selectors and collapse whitespace so the same recurring request
    # fingerprints identically regardless of wording drift noise.
    text = re.sub(r'@[\w-]+', '', text or '')
    return ' '.join(text.lower().split())[:200]


class InitiativeEngine:
    def __init__(self, store, policy, registry):
        self.store = store
        self.policy = policy
        self.registry = registry
        self.lock = store.lock

    # -- settings -----------------------------------------------------------------
    def settings(self):
        with self.lock:
            row = self.store.connection.execute(
                'SELECT last_scan, last_error, weights FROM initiative_settings WHERE id=1'
            ).fetchone()
        return {'last_scan': row['last_scan'], 'last_error': row['last_error'],
                'weights': {**DEFAULT_WEIGHTS, **json.loads(row['weights'])}}

    def configure_weights(self, weights):
        if not isinstance(weights, dict):
            raise ValueError('Weights must be a mapping')
        merged = {**DEFAULT_WEIGHTS, **weights}
        for key in merged:
            if key not in DEFAULT_WEIGHTS:
                raise ValueError(f'Unknown weight "{key}"')
        with self.lock:
            self.store.connection.execute(
                'UPDATE initiative_settings SET weights=?, updated_at=? WHERE id=1',
                (json.dumps(merged), now()))
            self.store.connection.commit()
        return self.settings()

    # -- ingestion ----------------------------------------------------------------
    def _ingest(self, source_type, title, problem, evidence_refs, dedupe_key,
                benefit=None, confidence=0.4):
        """Create or reinforce one opportunity. Returns ('created'|'updated', row)."""
        existing = self.registry.ingest(
            source_type, title, problem, evidence_refs=evidence_refs,
            benefit_hypothesis=benefit, confidence=confidence, dedupe_key=dedupe_key)
        if not existing.get('duplicate'):
            return 'created', existing
        # Reinforce, never duplicate — and only on genuinely new evidence. Re-scanning
        # unchanged sources must not inflate confidence or count as progress (§26.4).
        fresh = [ref for ref in evidence_refs
                 if ref not in json.loads(existing['evidence_refs'])]
        if not fresh:
            return 'unchanged', existing
        merged = (json.loads(existing['evidence_refs']) + fresh)[-20:]
        with self.lock:
            self.store.connection.execute(
                '''UPDATE autonomy_opportunities SET
                     confidence=MIN(0.95, confidence+0.1),
                     evidence_refs=?, updated_at=?
                   WHERE id=?''',
                (json.dumps(merged), now(), existing['id']))
            self.store.connection.commit()
        return 'updated', self.registry.get(existing['id'])

    def _failed_tasks(self):
        with self.lock:
            return [dict(r) for r in self.store.connection.execute(
                "SELECT id, prompt, error FROM tasks WHERE state='failed'"
                ' ORDER BY created_at DESC LIMIT 200')]

    def _repeated_workflows(self):
        with self.lock:
            rows = [dict(r) for r in self.store.connection.execute(
                "SELECT prompt, COUNT(*) AS n, MIN(id) AS first_goal FROM goals"
                " WHERE state IN ('completed','failed') GROUP BY prompt HAVING n>1"
                ' ORDER BY n DESC LIMIT 50')]
        return rows

    def _memory_corrections(self):
        with self.lock:
            return [dict(r) for r in self.store.connection.execute(
                'SELECT c.id AS correction_id, c.action, c.rationale, m.kind, m.content'
                ' FROM hl_memory_corrections c JOIN hl_memories m ON m.id=c.memory_id'
                ' ORDER BY c.id DESC LIMIT 100')]

    def detect(self):
        """One bounded ingestion pass over persisted evidence. Idempotent per source."""
        created = updated = 0
        objectives_new = 0
        for task in self._failed_tasks():
            signature = _signature(_normalize_prompt(task['prompt']),
                                   (task['error'] or '')[:120])
            action, _ = self._ingest(
                'task_outcome', 'Recurring failure: ' + (task['error'] or 'unspecified')[:80],
                f"Task {task['id']} failed: {(task['error'] or task['prompt'])[:300]}",
                evidence_refs=[f'task:{task["id"]}'], dedupe_key=f'task_failure:{signature}')
            created += action == 'created'
            updated += action == 'updated'
            objectives_new += self._skill_gap(task, signature)
        for row in self._repeated_workflows():
            signature = _signature(_normalize_prompt(row['prompt']))
            action, _ = self._ingest(
                'repeated_workflow', 'Repeated manual workflow',
                f'The same request was completed {row["n"]} times: '
                f'{_normalize_prompt(row["prompt"])}',
                evidence_refs=[f'goal:{row["first_goal"]}'],
                dedupe_key=f'workflow:{signature}', confidence=0.6)
            created += action == 'created'
            updated += action == 'updated'
        for correction in self._memory_corrections():
            action, _ = self._ingest(
                'user_correction', 'User corrected a learned memory',
                f'{correction["action"]}: {correction["rationale"]}',
                evidence_refs=[f'correction:{correction["correction_id"]}',
                               f'memory_kind:{correction["kind"]}'],
                dedupe_key=f'correction:{correction["correction_id"]}')
            created += action == 'created'
            updated += action == 'updated'
        with self.lock:
            self.store.connection.execute(
                'UPDATE initiative_settings SET last_scan=?, last_error=NULL, updated_at=?'
                ' WHERE id=1', (now(), now()))
            self.store.connection.commit()
        self.store.emit('opportunity.scan', {'created': created, 'updated': updated,
                                             'objectives_new': objectives_new})
        return {'created': created, 'updated': updated, 'objectives_new': objectives_new}

    # -- learning -----------------------------------------------------------------
    def _skill_gap(self, failed_task, signature):
        """A failed task is evidence of a skill gap — one objective per unique failure."""
        with self.lock:
            cursor = self.store.connection.execute(
                'INSERT OR IGNORE INTO learning_objectives (id, skill, gap_source,'
                ' evidence_refs, dedupe_key, status, confidence, created_at, updated_at)'
                ' VALUES (?,?,?,?,?,?,?,?,?)',
                (str(uuid4()), (failed_task['error'] or 'unspecified failure')[:120],
                 'failed_task', json.dumps([f'task:{failed_task["id"]}']),
                 f'gap:{signature}', 'open', 0.4, now(), now()))
            self.store.connection.commit()
        return int(cursor.rowcount > 0)

    def create_objective(self, skill, gap_source, evidence_refs=None, study_resource=None,
                         dedupe_key=None):
        if gap_source not in ('failed_task', 'proposal_requirement', 'explicit_request'):
            raise ValueError('Unknown gap source')
        skill = (skill or '').strip()
        if not skill:
            raise ValueError('A learning objective requires a skill statement')
        key = dedupe_key or f'explicit:{_signature(skill, gap_source)}'
        ident = str(uuid4())
        stamp = now()
        with self.lock:
            cursor = self.store.connection.execute(
                'INSERT OR IGNORE INTO learning_objectives (id, skill, gap_source,'
                ' evidence_refs, dedupe_key, status, study_resource, confidence,'
                ' created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
                (ident, skill[:300], gap_source, json.dumps(evidence_refs or []), key,
                 'open', study_resource, 0.5, stamp, stamp))
            self.store.connection.commit()
            if cursor.rowcount == 0:
                row = self.store.connection.execute(
                    'SELECT * FROM learning_objectives WHERE dedupe_key=?', (key,)).fetchone()
                return dict(row)
        self.store.emit('learning.objective_created', {'objective_id': ident, 'skill': skill})
        return self.get_objective(ident)

    def get_objective(self, ident):
        with self.lock:
            row = self.store.connection.execute(
                'SELECT * FROM learning_objectives WHERE id=?', (ident,)).fetchone()
        if not row:
            return None
        row = dict(row)
        row['evidence_refs'] = json.loads(row['evidence_refs'])
        return row

    def objectives(self, status=None, limit=100):
        with self.lock:
            if status:
                rows = self.store.connection.execute(
                    'SELECT * FROM learning_objectives WHERE status=?'
                    ' ORDER BY updated_at DESC LIMIT ?', (status, min(int(limit), 500))).fetchall()
            else:
                rows = self.store.connection.execute(
                    'SELECT * FROM learning_objectives ORDER BY updated_at DESC LIMIT ?',
                    (min(int(limit), 500),)).fetchall()
        out = []
        for row in rows:
            row = dict(row)
            row['evidence_refs'] = json.loads(row['evidence_refs'])
            out.append(row)
        return out

    def record_exercise(self, objective_id, task_id, result, evidence=None, exercise_ref=None):
        """Store one exercise outcome. Independent verification: 'passed' requires the cited
        task to exist and be completed; a missing or failed task can never verify a skill."""
        if result not in ('passed', 'failed'):
            raise ValueError('Exercise result must be passed or failed')
        with self.lock:
            task = self.store.connection.execute(
                'SELECT state FROM tasks WHERE id=?', (task_id,)).fetchone()
        if task is None:
            raise ValueError('Exercise evidence must cite an existing task')
        if result == 'passed' and task['state'] != 'completed':
            raise ValueError('A skill can only be verified by a completed exercise task')
        ident = str(uuid4())
        with self.lock:
            cursor = self.store.connection.execute(
                'INSERT OR IGNORE INTO skill_evidence (id, objective_id, task_id, exercise_ref,'
                ' result, evidence, created_at) VALUES (?,?,?,?,?,?,?)',
                (ident, objective_id, task_id, exercise_ref, result,
                 (evidence or '')[:1000] or None, now()))
            self.store.connection.commit()
            if cursor.rowcount == 0:
                row = self.store.connection.execute(
                    'SELECT * FROM skill_evidence WHERE objective_id=? AND task_id=?',
                    (objective_id, task_id)).fetchone()
                row = dict(row)
                row['duplicate'] = True
                return row
            if result == 'passed':
                self.store.connection.execute(
                    "UPDATE learning_objectives SET status='verified', updated_at=?"
                    ' WHERE id=? AND status IN (\'open\',\'queued\',\'exercised\')',
                    (now(), objective_id))
            else:
                self.store.connection.execute(
                    "UPDATE learning_objectives SET status='exercised', updated_at=?"
                    ' WHERE id=? AND status IN (\'open\',\'queued\')', (now(), objective_id))
            self.store.connection.commit()
        self.store.emit('learning.exercise_recorded',
                        {'objective_id': objective_id, 'task_id': task_id, 'result': result})
        row = self.store.connection.execute(
            'SELECT * FROM skill_evidence WHERE id=?', (ident,)).fetchone()
        row = dict(row)
        row['duplicate'] = False
        return row

    def skills(self):
        """Verified skills only — demonstrated through exercise evidence, not claimed."""
        with self.lock:
            rows = [dict(r) for r in self.store.connection.execute(
                '''SELECT o.id, o.skill, o.confidence, o.updated_at,
                          COUNT(e.id) AS exercises,
                          SUM(e.result='passed') AS passes
                   FROM learning_objectives o JOIN skill_evidence e ON e.objective_id=o.id
                   WHERE o.status='verified'
                   GROUP BY o.id ORDER BY o.updated_at DESC LIMIT 100''')]
        return rows

    # -- ranking ------------------------------------------------------------------
    def ranked(self, limit=20):
        weights = self.settings()['weights']
        out = []
        for opportunity in self.registry.list('candidate', limit=200):
            evidence_strength = min(1.0, len(opportunity['evidence_refs']) / 3.0)
            score = (weights['relevance'] * opportunity['confidence']
                     + weights['evidence'] * evidence_strength
                     + weights['novelty'] * (1.0 if opportunity['status'] == 'candidate' else 0.0))
            out.append({**opportunity, 'score': round(score, 4),
                        'score_breakdown': {
                            'relevance': round(weights['relevance'] * opportunity['confidence'], 4),
                            'evidence': round(weights['evidence'] * evidence_strength, 4)}})
        out.sort(key=lambda row: row['score'], reverse=True)
        return out[:max(1, min(int(limit), 100))]
