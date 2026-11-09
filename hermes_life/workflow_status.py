"""HL-UI-STATE-001: one read-only resolver for the whole workflow chain.

Discover, Goals, Planning and Build must agree about where a piece of work actually is.
The authority is the persisted chain

    discovery -> curiosity -> formulation -> goal -> task -> plan -> run -> verification -> review

and nothing here writes to it: a discovery is never mutated just to change its label, and a
finished investigation does not have to be re-labelled in SQLite to leave the Active view.
Approval is not completion — a finding stays in the workflow until its downstream work ends.
"""
import json

from .discovery import Discovery
from .store import now

STAGES = ('active', 'in_progress', 'planning', 'build', 'history')

#: Canonical selection inside a duplicate group: the furthest-along record wins, and an
#: explicit human decision outranks work that has not been decided on yet.
PROGRESS_RANK = {'active': 1, 'in_progress': 2, 'planning': 3, 'build': 4,
                 'decided': 5, 'integrated': 6}

#: Run state -> (stage, status label, what the user should do next).
RUN_STATES = {
    'preparing': ('build', 'Building', 'await'),
    'testing_baseline': ('build', 'Testing baseline', 'await'),
    'implementing': ('build', 'Building', 'await'),
    'evaluating': ('build', 'Testing', 'await'),
    'candidate_passed': ('build', 'Awaiting review', 'open_review'),
    'candidate_failed': ('build', 'Candidate tests failed', 'open_review'),
    'evaluation_error': ('build', 'Blocked: evaluation error', 'open_review'),
    'failed': ('build', 'Build failed', 'open_review'),
    'interrupted': ('build', 'Interrupted', 'open_review'),
}

REVIEW_DECISIONS = {
    'accepted': ('history', 'Completed', 'none'),
    'rejected': ('history', 'Rejected', 'none'),
    'revision_requested': ('build', 'Revision in progress', 'await'),
}

DISMISSED_DISCOVERY_STATES = ('dismissed', 'deferred', 'superseded')


class WorkflowStatus:
    """Derive display state from the chain. Read-only by construction."""

    def __init__(self, runtime):
        self.runtime = runtime
        self.store = runtime.store

    # ------------------------------------------------------------------ reading

    def _rows(self):
        """Every record the chain needs, in one pass. No writes, no locks held long."""
        with self.store.lock:
            con = self.store.connection
            data = {
                'discoveries': [dict(r) for r in con.execute('SELECT * FROM discoveries')],
                'curiosity': [dict(r) for r in con.execute('SELECT * FROM curiosity')],
                'formulations': [dict(r) for r in con.execute('SELECT * FROM formulated_goals')],
                'goals': [dict(r) for r in con.execute('SELECT * FROM goals')],
                'tasks': [dict(r) for r in con.execute('SELECT * FROM tasks')],
                'plans': [dict(r) for r in con.execute('SELECT * FROM investigation_plans')],
                'runs': [dict(r) for r in con.execute('SELECT * FROM implementation_runs')],
                'reviews': [dict(r) for r in con.execute('SELECT * FROM implementation_reviews')],
            }
            try:
                data['verifications'] = [dict(r) for r in con.execute(
                    'SELECT v.run_id, v.disposition, v.blocker, v.attempt FROM verification_runs v '
                    'WHERE v.attempt = (SELECT MAX(attempt) FROM verification_runs WHERE run_id = v.run_id)')]
            except Exception:
                data['verifications'] = []
        return data

    @staticmethod
    def _index(data):
        plans_by_formulation = {}
        for plan in data['plans']:
            current = plans_by_formulation.get(plan['formulation_id'])
            if current is None or plan['created_at'] > current['created_at']:
                plans_by_formulation[plan['formulation_id']] = plan
        runs_by_plan = {}
        for run in data['runs']:
            current = runs_by_plan.get(run['plan_id'])
            if current is None or (run.get('created_at') or '') > (current.get('created_at') or ''):
                runs_by_plan[run['plan_id']] = run
        formulations_by_discovery = {}
        for formulation in data['formulations']:
            if formulation['discovery_id'] not in formulations_by_discovery:
                formulations_by_discovery[formulation['discovery_id']] = formulation
        curiosity_by_discovery = {}
        for row in data['curiosity']:
            key = row.get('discovery_id')
            if key and key not in curiosity_by_discovery:
                curiosity_by_discovery[key] = row
        return {
            'goals': {r['id']: r for r in data['goals']},
            'tasks': {r['id']: r for r in data['tasks']},
            'plans_by_formulation': plans_by_formulation,
            'runs_by_plan': runs_by_plan,
            'formulations_by_discovery': formulations_by_discovery,
            'curiosity_by_discovery': curiosity_by_discovery,
            'reviews': {r['run_id']: r for r in data['reviews']},
            'verifications': {r['run_id']: r for r in data['verifications']},
        }

    # ------------------------------------------------------------------ deriving

    @staticmethod
    def _derive(discovery, index):
        """The chain-derived status of one discovery, before duplicate grouping."""
        chain = {
            'discovery_id': discovery['id'],
            'curiosity_id': None,
            'formulation_id': None,
            'goal_id': discovery.get('goal_id'),
            'task_id': None,
            'plan_id': None,
            'run_id': None,
            'verification': None,
        }
        curiosity = index['curiosity_by_discovery'].get(discovery['id'])
        if curiosity:
            chain['curiosity_id'] = curiosity['id']
        state = (discovery.get('state') or '').lower()
        if state in DISMISSED_DISCOVERY_STATES:
            return {**chain, 'stage': 'history', 'status': state.capitalize(),
                    'reason': 'finding was ' + state + ' by a human action',
                    'next_action': 'none', 'verification': None}
        if state != 'approved':
            return {**chain, 'stage': 'active', 'status': 'Proposed',
                    'reason': 'awaiting a decision on this finding',
                    'next_action': 'approve_finding', 'verification': None}
        formulation = index['formulations_by_discovery'].get(discovery['id'])
        if formulation:
            chain['formulation_id'] = formulation['id']
        goal_id = (formulation or {}).get('goal_id') or discovery.get('goal_id')
        chain['goal_id'] = goal_id
        goal = index['goals'].get(goal_id) if goal_id else None
        task = index['tasks'].get(goal['task_id']) if goal and goal.get('task_id') else None
        if task:
            chain['task_id'] = task['id']
        plan = index['plans_by_formulation'].get(formulation['id']) if formulation else None
        run = index['runs_by_plan'].get(plan['id']) if plan else None
        review = index['reviews'].get(run['id']) if run else None
        verification = index['verifications'].get(run['id']) if run else None
        if plan:
            chain['plan_id'] = plan['id']
        if run:
            chain['run_id'] = run['id']
        if verification:
            chain['verification'] = {'disposition': verification.get('disposition'),
                                    'blocker': verification.get('blocker'),
                                    'attempt': verification.get('attempt')}
        # Terminal human decisions first: they outrank any in-flight state.
        if review:
            stage, status, action = REVIEW_DECISIONS.get(
                review['decision'], ('history', str(review['decision']).capitalize(), 'none'))
            return {**chain, 'stage': stage, 'status': status,
                    'reason': 'review decision recorded: ' + str(review['decision']),
                    'next_action': action, 'verification': chain['verification']}
        if run:
            stage, status, action = RUN_STATES.get(
                (run.get('state') or '').lower(), ('build', str(run.get('state')), 'open_review'))
            detail = status + (' · verification ' + str(verification.get('disposition'))
                               if verification and verification.get('disposition') else '')
            return {**chain, 'stage': stage, 'status': detail,
                    'reason': 'candidate run is ' + str(run.get('state'))
                              + ((' · ' + str(run.get('error'))[:200]) if run.get('error') else ''),
                    'next_action': action, 'verification': chain['verification']}
        if plan:
            if (plan.get('state') or '') == 'drafting':
                return {**chain, 'stage': 'planning', 'status': 'Drafting the plan',
                        'reason': 'the plan is being drafted; there is nothing to approve yet',
                        'next_action': 'await', 'verification': None}
            if (plan.get('state') or '') == 'approved':
                return {**chain, 'stage': 'planning', 'status': 'Awaiting build',
                        'reason': 'the plan is approved; no implementation run has started',
                        'next_action': 'start_build', 'verification': None}
            return {**chain, 'stage': 'planning', 'status': 'Plan ready',
                    'reason': 'a plan exists and awaits approval',
                    'next_action': 'approve_plan', 'verification': None}
        # No plan. Either the investigation is still running, or it finished without one.
        if goal:
            goal_state = (goal.get('state') or '').lower()
            if goal_state in ('pending', 'queued'):
                return {**chain, 'stage': 'in_progress', 'status': 'Queued',
                        'reason': 'the investigation goal is queued',
                        'next_action': 'await', 'verification': None}
            if goal_state in ('running',):
                return {**chain, 'stage': 'in_progress', 'status': 'Investigating',
                        'reason': 'the investigation is executing',
                        'next_action': 'await', 'verification': None}
            if goal_state in ('failed', 'interrupted', 'cancelled'):
                return {**chain, 'stage': 'in_progress', 'status': 'Investigation ' + goal_state,
                        'reason': 'the investigation did not complete: '
                                  + str(goal.get('error') or goal_state)[:200],
                        'next_action': 'review_investigation', 'verification': None}
            if (task or {}).get('state') == 'completed' or goal_state == 'completed':
                detail = 'Investigation complete'
                if formulation and (formulation.get('state') or '') != 'approved':
                    reason = ('the investigation finished but its formulation is '
                              + str(formulation.get('state')) + '; no plan was generated')
                else:
                    reason = 'the investigation finished and no plan was generated for it'
                return {**chain, 'stage': 'in_progress', 'status': detail,
                        'reason': reason, 'next_action': 'review_investigation',
                        'verification': None}
        return {**chain, 'stage': 'in_progress', 'status': 'Queued',
                'reason': 'approved; its investigation has not started yet',
                'next_action': 'await', 'verification': None}

    @staticmethod
    def _group_duplicates(annotations):
        """Same underlying issue (canonical fingerprint) => one actionable record.

        Display-only: nothing is dismissed here, the group just stops offering the same work
        several times, and the non-canonical members stay reachable in History.
        """
        groups = {}
        for record in annotations.values():
            groups.setdefault(record.get('fingerprint'), []).append(record)

        def rank(record):
            stage = record['stage']
            if stage == 'history' and record['status'] in ('Completed', 'Rejected'):
                return PROGRESS_RANK['integrated' if record['status'] == 'Completed' else 'decided']
            if stage == 'history':
                return PROGRESS_RANK['decided']
            return PROGRESS_RANK.get(stage, 0)

        for key, members in groups.items():
            if key is None or len(members) < 2:
                for member in members:
                    member['duplicate_of'] = None
                    member['group_size'] = len(members)
                continue
            canonical = sorted(members, key=lambda r: (-rank(r), r.get('created_at') or ''))[0]
            for member in members:
                member['group_size'] = len(members)
                member['duplicate_of'] = None if member is canonical else canonical['discovery_id']
                if member is canonical:
                    continue
                member['own_stage'] = member['stage']
                member['own_status'] = member['status']
                if member['stage'] == 'history' and member['status'] in ('Completed', 'Rejected', 'Dismissed'):
                    continue
                member['stage'] = 'history'
                member['status'] = 'Superseded'
                member['reason'] = ('duplicate of ' + str(canonical['discovery_id'])[:8]
                                    + ' (' + str(canonical['status']) + ')')
                member['next_action'] = 'none'

    def snapshot(self):
        """Annotations for every record kind, plus stage counts. Never writes."""
        data = self._rows()
        index = self._index(data)
        discoveries = {}
        for discovery in data['discoveries']:
            annotation = self._derive(discovery, index)
            # Group by the canonical identity (project + path + normalised note), not by the
            # stored column: 19 legacy rows carry a line-numbered fingerprint that bypasses
            # both the dedup contract and the insert-time uniqueness check.
            annotation['fingerprint'] = Discovery.fingerprint(
                discovery.get('project') or '', discovery.get('path') or '', discovery.get('note') or '')
            annotation['stored_fingerprint'] = discovery.get('fingerprint')
            annotation['created_at'] = discovery.get('created_at')
            annotation['project'] = discovery.get('project')
            annotation['path'] = discovery.get('path')
            annotation['own_stage'] = annotation['stage']
            annotation['own_status'] = annotation['status']
            annotation['duplicate_of'] = None
            annotation['group_size'] = 1
            discoveries[discovery['id']] = annotation
        self._group_duplicates(discoveries)

        curiosity = {}
        for row in data['curiosity']:
            parent = discoveries.get(row.get('discovery_id'))
            if parent:
                annotation = dict(parent)
                annotation['curiosity_id'] = row['id']
                annotation['curiosity_state'] = row.get('state')
            else:
                annotation = {'curiosity_id': row['id'], 'curiosity_state': row.get('state'),
                              'stage': 'active' if (row.get('state') or '') == 'open' else 'in_progress',
                              'status': 'Open question' if (row.get('state') or '') == 'open'
                                        else str(row.get('state')).capitalize(),
                              'reason': 'question has no discovery lineage',
                              'next_action': 'none', 'duplicate_of': None, 'group_size': 1,
                              'own_stage': 'active', 'own_status': 'Open question'}
            curiosity[row['id']] = annotation

        goals = {}
        for goal in data['goals']:
            annotation = self._derive_goal(goal, discoveries, index)
            goals[goal['id']] = annotation
        plans = {}
        for plan in data['plans']:
            annotation = self._derive_plan(plan, discoveries)
            plans[plan['id']] = annotation
        runs = {}
        for run in data['runs']:
            annotation = self._derive_run(run, index)
            runs[run['id']] = annotation
        counts = {stage: sum(1 for a in discoveries.values() if a['stage'] == stage) for stage in STAGES}
        counts['superseded'] = sum(1 for a in discoveries.values() if a['status'] == 'Superseded')
        counts['needs_attention'] = counts['active'] + counts['in_progress']
        return {'generated_at': now(), 'counts': counts, 'discoveries': discoveries,
                'curiosity': curiosity, 'goals': goals, 'plans': plans, 'runs': runs}

    @staticmethod
    def _derive_goal(goal, discoveries, index):
        owned = [a for a in discoveries.values() if a.get('goal_id') == goal['id']]
        if owned:
            best = sorted(owned, key=lambda a: (-PROGRESS_RANK.get(a['stage'], 0),
                                                a.get('created_at') or ''))[0]
            return {'stage': best['stage'], 'status': best['status'], 'reason': best['reason'],
                    'next_action': best['next_action'], 'discovery_id': best['discovery_id'],
                    'duplicate_of': best.get('duplicate_of'), 'group_size': best.get('group_size', 1)}
        state = (goal.get('state') or '').lower()
        if state == 'completed':
            return {'stage': 'in_progress', 'status': 'Investigation complete',
                    'reason': 'goal finished; no discovery is linked to it',
                    'next_action': 'review_investigation', 'discovery_id': None,
                    'duplicate_of': None, 'group_size': 1}
        if state in ('running', 'queued', 'pending'):
            return {'stage': 'in_progress', 'status': 'Investigating' if state == 'running' else 'Queued',
                    'reason': 'goal is ' + state, 'next_action': 'await', 'discovery_id': None,
                    'duplicate_of': None, 'group_size': 1}
        return {'stage': 'history' if state in ('failed', 'cancelled', 'interrupted') else 'in_progress',
                'status': 'Investigation ' + state if state else 'Unknown',
                'reason': 'goal is ' + (state or 'unknown'), 'next_action': 'review_investigation',
                'discovery_id': None, 'duplicate_of': None, 'group_size': 1}

    @staticmethod
    def _derive_plan(plan, discoveries):
        owned = [a for a in discoveries.values() if a.get('plan_id') == plan['id']]
        if owned:
            best = sorted(owned, key=lambda a: (-PROGRESS_RANK.get(a['stage'], 0),
                                                a.get('created_at') or ''))[0]
            return {'stage': best['stage'], 'status': best['status'], 'reason': best['reason'],
                    'next_action': best['next_action'], 'discovery_id': best['discovery_id'],
                    'run_id': best.get('run_id'), 'verification': best.get('verification'),
                    'duplicate_of': best.get('duplicate_of'), 'group_size': best.get('group_size', 1)}
        approved = (plan.get('state') or '') == 'approved'
        if (plan.get('state') or '') == 'drafting':
            return {'stage': 'planning', 'status': 'Drafting the plan',
                    'reason': 'plan is drafting', 'next_action': 'await',
                    'discovery_id': None, 'run_id': None, 'verification': None,
                    'duplicate_of': None, 'group_size': 1}
        return {'stage': 'planning', 'status': 'Awaiting build' if approved else 'Plan ready',
                'reason': 'plan is ' + str(plan.get('state')), 'next_action':
                    'start_build' if approved else 'approve_plan', 'discovery_id': None,
                'run_id': None, 'verification': None, 'duplicate_of': None, 'group_size': 1}

    @staticmethod
    def _derive_run(run, index):
        stage, status, action = RUN_STATES.get((run.get('state') or '').lower(),
                                               ('build', str(run.get('state')), 'open_review'))
        review = index['reviews'].get(run['id'])
        verification = index['verifications'].get(run['id'])
        if review:
            stage, status, action = REVIEW_DECISIONS.get(
                review['decision'], ('history', str(review['decision']).capitalize(), 'none'))
        return {'stage': stage, 'status': status, 'reason': 'run is ' + str(run.get('state')),
                'next_action': action, 'plan_id': run.get('plan_id'),
                'verification': {'disposition': verification.get('disposition'),
                                 'blocker': verification.get('blocker')} if verification else None,
                'duplicate_of': None, 'group_size': 1}

    # ------------------------------------------------------------------ consuming

    def annotate(self, kind, rows, snapshot=None):
        """Attach the resolver's verdict to a list of API rows, verbatim otherwise."""
        snap = snapshot or self.snapshot()
        table = snap.get(kind) or {}
        annotated = []
        for row in rows:
            record = dict(row)
            record['workflow'] = table.get(str(row.get('id'))) or {
                'stage': 'in_progress', 'status': 'Untracked', 'next_action': 'none',
                'reason': 'no workflow record matches this row'}
            annotated.append(record)
        return annotated
