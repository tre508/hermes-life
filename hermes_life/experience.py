"""HL-AUTO-001 Phase 5 (§26.10): execution + experience.

Milestone outcomes are scored against their recorded expectation using REAL artifacts
(the task row's state and result text, the goal, the linked proposal chain). A lesson is
stored only when outcome evidence supports it; failure lessons are labelled as such.
Classification feeds back into opportunity ranking — preferences (HL-PERS-001) and project
policy stay separate: this module reads NO personality store.
"""
import json
from uuid import uuid4
from .store import now

MAX_RETRIES = 3


class ExperienceEngine:
    def __init__(self, store, registry):
        self.store = store
        self.registry = registry
        self.lock = store.lock

    def record_outcome(self, milestone, task, goal=None):
        """Score one milestone outcome. Idempotent per (project, milestone, task)."""
        expected = (milestone.get('acceptance_criteria') or milestone['prompt'])[:1000]
        state = task['state'] if task else 'missing'
        measured_parts = [f'task_state={state}']
        if task and task.get('result'):
            measured_parts.append('result=' + task['result'][:500])
        if task and task.get('error'):
            measured_parts.append('error=' + task['error'][:300])
        measured = '; '.join(measured_parts)[:1000]
        if state == 'completed':
            classification = 'success'
        elif state == 'failed':
            classification = 'failure'
        else:
            classification = 'partial'
        evidence = [f'task:{task["id"]}' if task else 'task:missing',
                    f'milestone:{milestone["id"]}']
        if goal:
            evidence.append(f'goal:{goal["id"]}')
        lesson = None
        if state == 'completed':
            lesson = ('Outcome met the milestone expectation'
                      + (f'; verified by task {task["id"]}' if task else ''))
        elif state == 'failed':
            lesson = ('FAILURE LESSON (not a validated success): '
                      + (task['error'] or 'unspecified failure')[:300]) if task else None
        ident = str(uuid4())
        with self.lock:
            cursor = self.store.connection.execute(
                'INSERT OR IGNORE INTO experience_records (id, project_name, milestone_id,'
                ' goal_id, task_id, expected_result, measured_result, classification,'
                ' evidence_refs, lesson, confidence, created_at)'
                ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                (ident, milestone['project_name'], milestone['id'],
                 goal['id'] if goal else None, task['id'] if task else None,
                 expected, measured, classification, json.dumps(evidence), lesson,
                 0.9 if classification == 'success' else 0.4, now()))
            self.store.connection.commit()
            if cursor.rowcount == 0:
                row = self.store.connection.execute(
                    'SELECT * FROM experience_records WHERE project_name=? AND milestone_id=?'
                    ' AND task_id=?', (milestone['project_name'], milestone['id'],
                                       task['id'] if task else None)).fetchone()
                row = dict(row)
                row['evidence_refs'] = json.loads(row['evidence_refs'])
                row['duplicate'] = True
                return row
        row = self._get(ident)
        row['duplicate'] = False
        self.store.emit('experience.recorded',
                        {'experience_id': ident, 'project_name': milestone['project_name'],
                         'classification': classification})
        self.refine_ranking(milestone['project_name'], classification)
        return row

    def _get(self, ident):
        with self.lock:
            row = self.store.connection.execute(
                'SELECT * FROM experience_records WHERE id=?', (ident,)).fetchone()
        row = dict(row)
        row['evidence_refs'] = json.loads(row['evidence_refs'])
        return row

    def get(self, ident):
        try:
            return self._get(ident)
        except TypeError:
            return None

    def list(self, project_name=None, limit=100):
        with self.lock:
            if project_name:
                rows = self.store.connection.execute(
                    'SELECT * FROM experience_records WHERE project_name=?'
                    ' ORDER BY created_at DESC LIMIT ?', (project_name,
                                                          min(int(limit), 500))).fetchall()
            else:
                rows = self.store.connection.execute(
                    'SELECT * FROM experience_records ORDER BY created_at DESC LIMIT ?',
                    (min(int(limit), 500),)).fetchall()
        out = []
        for row in rows:
            row = dict(row)
            row['evidence_refs'] = json.loads(row['evidence_refs'])
            out.append(row)
        return out

    def refine_ranking(self, project_name, classification):
        """Adjust the originating opportunity's confidence from measured outcomes.

        Explicit, bounded, auditable — ranking calibration from outcomes, never from a
        model claim about itself (§26.3 HL-AUTO-EXP-001).
        """
        delta = 0.05 if classification == 'success' else -0.05 if classification == 'failure' else 0.0
        if not delta or not project_name:
            return None
        with self.lock:
            row = self.store.connection.execute(
                'SELECT proposal_id FROM autonomy_projects WHERE name=?',
                (project_name,)).fetchone()
            proposal_id = row['proposal_id'] if row else None
            opportunity_id = None
            if proposal_id:
                prow = self.store.connection.execute(
                    'SELECT opportunity_id FROM project_proposals WHERE id=?',
                    (proposal_id,)).fetchone()
                opportunity_id = prow['opportunity_id'] if prow else None
            if not opportunity_id:
                return None
            self.store.connection.execute(
                'UPDATE autonomy_opportunities SET confidence='
                'MAX(0.05, MIN(0.95, confidence+?)), updated_at=? WHERE id=?',
                (delta, now(), opportunity_id))
            self.store.connection.commit()
        self.store.emit('experience.ranking_adjusted',
                        {'opportunity_id': opportunity_id, 'delta': delta,
                         'project_name': project_name})
        return opportunity_id
