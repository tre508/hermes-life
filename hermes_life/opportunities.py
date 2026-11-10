"""HL-AUTO-001 Phase 1 shared registries (§26.6): opportunities, proposals, decisions.

Model-generated opportunities are hypotheses: they carry source_type, evidence_refs and
confidence, and nothing here executes work. Proposals are versioned records, never approved
work. Decisions store user-visible rationale summaries, not fabricated internal reasoning.
"""
import json
from uuid import uuid4
from .store import now
from .autonomy_policy import PolicyDenied

SOURCE_TYPES = ('task_outcome', 'user_correction', 'repeated_workflow', 'skill_gap',
                'project_signal', 'explicit_interest')
OPPORTUNITY_STATUSES = ('candidate', 'dismissed', 'proposed', 'ineligible')


class OpportunityRegistry:
    def __init__(self, store, policy):
        self.store = store
        self.policy = policy
        self.lock = store.lock

    # -- opportunities ------------------------------------------------------------
    def ingest(self, source_type, title, problem, evidence_refs=None, benefit_hypothesis=None,
               confidence=0.5, dedupe_key=None, project_id=None):
        """Register an evidence-backed opportunity hypothesis. Idempotent on dedupe_key."""
        if source_type not in SOURCE_TYPES:
            raise ValueError('Unknown opportunity source type')
        title = (title or '').strip()
        problem = (problem or '').strip()
        if not title or not problem:
            raise ValueError('An opportunity requires a title and a problem statement')
        if len(problem) > 4000:
            raise ValueError('Problem statement too long')
        if not isinstance(evidence_refs, list) or not evidence_refs:
            raise ValueError('An opportunity requires at least one evidence reference;'
                             ' unobserved model claims are not accepted')
        if not 0 <= float(confidence) <= 1:
            raise ValueError('Confidence must be between 0 and 1')
        key = (dedupe_key or '').strip()
        if not key:
            raise ValueError('A stable dedupe key is required to suppress duplicates')
        ident = str(uuid4())
        stamp = now()
        with self.lock:
            cursor = self.store.connection.execute(
                'INSERT OR IGNORE INTO autonomy_opportunities (id, source_type, title, problem,'
                ' benefit_hypothesis, evidence_refs, confidence, dedupe_key, status, project_id,'
                ' created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                (ident, source_type, title[:300], problem, benefit_hypothesis,
                 json.dumps(evidence_refs), float(confidence), key, 'candidate', project_id,
                 stamp, stamp))
            self.store.connection.commit()
            if cursor.rowcount == 0:
                existing = self.store.connection.execute(
                    'SELECT * FROM autonomy_opportunities WHERE dedupe_key=?', (key,)).fetchone()
                row = dict(existing)
                row['duplicate'] = True
                return row
            row = self.store.connection.execute(
                'SELECT * FROM autonomy_opportunities WHERE id=?', (ident,)).fetchone()
        row = dict(row)
        row['duplicate'] = False
        self.store.emit('opportunity.recorded',
                        {'opportunity_id': ident, 'source_type': source_type,
                         'title': title, 'confidence': float(confidence)})
        return row

    def get(self, ident):
        with self.lock:
            row = self.store.connection.execute(
                'SELECT * FROM autonomy_opportunities WHERE id=?', (ident,)).fetchone()
        if not row:
            return None
        row = dict(row)
        row['evidence_refs'] = json.loads(row['evidence_refs'])
        return row

    def list(self, status=None, limit=100):
        with self.lock:
            if status:
                rows = self.store.connection.execute(
                    'SELECT * FROM autonomy_opportunities WHERE status=?'
                    ' ORDER BY created_at DESC LIMIT ?', (status, min(int(limit), 500))).fetchall()
            else:
                rows = self.store.connection.execute(
                    'SELECT * FROM autonomy_opportunities ORDER BY created_at DESC LIMIT ?',
                    (min(int(limit), 500),)).fetchall()
        out = []
        for row in rows:
            row = dict(row)
            row['evidence_refs'] = json.loads(row['evidence_refs'])
            out.append(row)
        return out

    def dismiss(self, ident, reason):
        if not (reason or '').strip():
            raise ValueError('A dismissal requires a reason')
        with self.lock:
            row = self.store.connection.execute(
                "UPDATE autonomy_opportunities SET status='dismissed', updated_at=? WHERE id=?"
                " AND status IN ('candidate','proposed')", (now(), ident))
            self.store.connection.commit()
        if not row.rowcount:
            row = self.store.connection.execute(
                'SELECT status FROM autonomy_opportunities WHERE id=?', (ident,)).fetchone()
            if row is None:
                return None
            raise ValueError(f"Opportunity is '{row['status']}' and cannot be dismissed")
        self.store.emit('opportunity.dismissed', {'opportunity_id': ident})
        return self.get(ident)

    # -- proposals ----------------------------------------------------------------
    def propose(self, ident, title, specification, feasibility=None, estimated_cost=None,
                acceptance_criteria=None):
        """Create a versioned proposal for an opportunity. Policy-gated; never auto-approved."""
        opportunity = self.get(ident)
        if opportunity is None:
            return None
        self.policy.require('propose_project')
        spec = (specification or '').strip()
        if len(spec) < 20:
            raise ValueError('A proposal requires a real specification')
        with self.lock:
            row = self.store.connection.execute(
                'SELECT MAX(version) AS v FROM project_proposals WHERE opportunity_id=?',
                (ident,)).fetchone()
            version = (row['v'] or 0) + 1
            proposal_id = str(uuid4())
            stamp = now()
            self.store.connection.execute(
                'INSERT INTO project_proposals (id, opportunity_id, version, title,'
                ' specification, feasibility, estimated_cost, acceptance_criteria,'
                ' policy_snapshot, status, created_at, updated_at)'
                ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                (proposal_id, ident, version, (title or opportunity['title'])[:300], spec,
                 feasibility, estimated_cost, acceptance_criteria,
                 json.dumps(self.policy.settings()), 'awaiting_approval', stamp, stamp))
            self.store.connection.execute(
                "UPDATE autonomy_opportunities SET status='proposed', updated_at=? WHERE id=?",
                (stamp, ident))
            self.store.connection.commit()
        self.store.emit('proposal.created', {'proposal_id': proposal_id,
                                             'opportunity_id': ident, 'version': version})
        return self.get_proposal(proposal_id)

    def get_proposal(self, proposal_id):
        with self.lock:
            row = self.store.connection.execute(
                'SELECT * FROM project_proposals WHERE id=?', (proposal_id,)).fetchone()
        if not row:
            return None
        row = dict(row)
        row['policy_snapshot'] = json.loads(row['policy_snapshot'] or '{}')
        return row

    def proposals(self, opportunity_id=None, limit=100):
        with self.lock:
            if opportunity_id:
                rows = self.store.connection.execute(
                    'SELECT * FROM project_proposals WHERE opportunity_id=? ORDER BY version',
                    (opportunity_id,)).fetchall()
            else:
                rows = self.store.connection.execute(
                    'SELECT * FROM project_proposals ORDER BY created_at DESC LIMIT ?',
                    (min(int(limit), 500),)).fetchall()
        out = []
        for row in rows:
            row = dict(row)
            row['policy_snapshot'] = json.loads(row['policy_snapshot'] or '{}')
            out.append(row)
        return out

    def decide_proposal(self, proposal_id, approve, actor='user', rationale=None):
        """Approve or reject a proposal. Approval records WHO authorized it — it never starts
        execution; project bootstrap (Phase 3) checks the grant again before any write."""
        rationale = (rationale or '').strip()
        if not rationale:
            raise ValueError('A proposal decision requires a recorded rationale')
        with self.lock:
            row = self.store.connection.execute(
                'SELECT status FROM project_proposals WHERE id=?', (proposal_id,)).fetchone()
            if row is None:
                return None
            if row['status'] != 'awaiting_approval':
                raise ValueError(f"Proposal is '{row['status']}', not awaiting approval")
            state = 'approved' if approve else 'rejected'
            self.store.connection.execute(
                'UPDATE project_proposals SET status=?, updated_at=? WHERE id=?',
                (state, now(), proposal_id))
            self.store.connection.commit()
        self.store.emit('proposal.' + state, {'proposal_id': proposal_id, 'actor': actor})
        return self.get_proposal(proposal_id)

    # -- decisions ----------------------------------------------------------------
    def decide(self, opportunity_id, action, scores=None, rationale=None, disposition='recorded'):
        """Persist one initiative-selection decision with an explicit, user-visible rationale."""
        if action not in ('learn', 'propose_project', 'resume_existing', 'no_action', 'blocked'):
            raise ValueError('Unknown decision action')
        rationale = (rationale or '').strip()
        if not rationale:
            raise ValueError('A decision requires a user-visible rationale')
        if scores is not None and not isinstance(scores, dict):
            raise ValueError('Scores must be a mapping')
        ident = str(uuid4())
        with self.lock:
            if opportunity_id is not None and self.get(opportunity_id) is None:
                raise ValueError('Opportunity does not exist')
            self.store.connection.execute(
                'INSERT INTO autonomy_decisions (id, opportunity_id, action, scores,'
                ' policy_version, rationale, disposition, created_at) VALUES (?,?,?,?,?,?,?,?)',
                (ident, opportunity_id, action,
                 json.dumps(scores) if scores is not None else None,
                 self.policy.settings()['policy_version'], rationale.strip()[:1000],
                 disposition, now()))
            self.store.connection.commit()
        self.store.emit('autonomy.decision', {'decision_id': ident, 'action': action,
                                              'opportunity_id': opportunity_id})
        return self.get_decision(ident)

    def get_decision(self, decision_id):
        with self.lock:
            row = self.store.connection.execute(
                'SELECT * FROM autonomy_decisions WHERE id=?', (decision_id,)).fetchone()
        if not row:
            return None
        row = dict(row)
        row['scores'] = json.loads(row['scores']) if row['scores'] else None
        return row

    def decisions(self, limit=100):
        with self.lock:
            rows = self.store.connection.execute(
                'SELECT * FROM autonomy_decisions ORDER BY created_at DESC LIMIT ?',
                (min(int(limit), 500),)).fetchall()
        out = []
        for row in rows:
            row = dict(row)
            row['scores'] = json.loads(row['scores']) if row['scores'] else None
            out.append(row)
        return out
