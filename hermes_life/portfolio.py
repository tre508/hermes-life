"""HL-AUTO-001 Phase 4 (§26.10): portfolio orchestration on the single existing scheduler.

This module owns NO execution loop. `select_next()` returns at most one bounded next action
per call and hands it to the existing goal queue, so `Autonomy.tick` remains the only
scheduler (HL-FLOW-002). A milestone's goal_id is its lease: one milestone has at most one
live goal, and restart reconciliation resolves in-progress rows against the actual goal
state instead of re-enqueuing them.
"""
import json
from uuid import uuid4
from .store import now
from .experience import MAX_RETRIES

MILESTONE_STATES = ('pending', 'ready', 'in_progress', 'completed', 'blocked', 'failed',
                    'cancelled')
#: Background portfolio goals run at a priority below ordinary user goals (default 50+),
#: so a direct user request is always selected first by Autonomy.tick.
BACKGROUND_PRIORITY = 30
DEFAULT_ESTIMATE_SECONDS = 1800.0


class PortfolioEngine:
    def __init__(self, store, policy, bootstrapper):
        self.store = store
        self.policy = policy
        self.bootstrapper = bootstrapper
        self.lock = store.lock
        # Injected by create_app: the existing Autonomy instance, for goal enqueue/cancel.
        self.autonomy = None
        # Injected by create_app: ExperienceEngine for outcome scoring (Phase 5).
        self.experience = None  # injected by create_app: the existing Autonomy instance

    # -- milestone records --------------------------------------------------------
    def add_milestone(self, project_name, title, prompt, order_index=0, dependency_ids=None,
                      acceptance_criteria=None, estimated_seconds=DEFAULT_ESTIMATE_SECONDS):
        project = self.bootstrapper.project(project_name)
        if project is None:
            raise ValueError(f'Unknown project: {project_name}')
        if project['status'] not in ('active', 'initializing'):
            raise ValueError(f"Project is '{project['status']}'; milestones can only be"
                             ' added to an active project')
        deps = dependency_ids or []
        if not isinstance(deps, list) or not all(isinstance(d, str) for d in deps):
            raise ValueError('dependency_ids must be a list of milestone ids')
        ident = str(uuid4())
        stamp = now()
        initial_state, blocker = 'pending', None
        with self.lock:
            for dep in deps:
                row = self.store.connection.execute(
                    'SELECT project_name, state FROM project_milestones WHERE id=?',
                    (dep,)).fetchone()
                if row is None or row['project_name'] != project_name:
                    raise ValueError(f'Dependency {dep} is not a milestone of {project_name}')
                if row['state'] != 'completed':
                    initial_state, blocker = 'blocked', f'Waiting on milestone {dep}'
            self.store.connection.execute(
                'INSERT INTO project_milestones (id, project_name, title, prompt, order_index,'
                ' dependency_ids, acceptance_criteria, estimated_seconds, state, blocker,'
                ' created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                (ident, project_name, title[:300], prompt[:4000], order_index,
                 json.dumps(deps), acceptance_criteria, float(estimated_seconds),
                 initial_state, blocker, stamp, stamp))
            self.store.connection.commit()
        self.store.emit('milestone.created', {'milestone_id': ident,
                                              'project_name': project_name,
                                              'title': title})
        return self.get_milestone(ident)

    def _row(self, ident):
        with self.lock:
            row = self.store.connection.execute(
                'SELECT * FROM project_milestones WHERE id=?', (ident,)).fetchone()
        return dict(row) if row else None

    def get_milestone(self, ident):
        row = self._row(ident)
        if row:
            row['dependency_ids'] = json.loads(row['dependency_ids'])
            row['checkpoint'] = json.loads(row['checkpoint']) if row['checkpoint'] else None
        return row

    def milestones(self, project_name=None, state=None, limit=200):
        with self.lock:
            if project_name:
                rows = self.store.connection.execute(
                    'SELECT * FROM project_milestones WHERE project_name=?'
                    ' ORDER BY order_index, created_at LIMIT ?',
                    (project_name, min(int(limit), 500))).fetchall()
            else:
                rows = self.store.connection.execute(
                    'SELECT * FROM project_milestones ORDER BY created_at DESC LIMIT ?',
                    (min(int(limit), 500),)).fetchall()
        out = []
        for row in rows:
            row = dict(row)
            row['dependency_ids'] = json.loads(row['dependency_ids'])
            row['checkpoint'] = json.loads(row['checkpoint']) if row['checkpoint'] else None
            if state is None or row['state'] == state:
                out.append(row)
        return out

    def _set(self, ident, state=None, goal_id=..., blocker=..., checkpoint=...):
        with self.lock:
            sets, values = ['updated_at=?'], [now()]
            if state is not None:
                sets.append('state=?')
                values.append(state)
            if goal_id is not ...:
                sets.append('goal_id=?')
                values.append(goal_id)
            if blocker is not ...:
                sets.append('blocker=?')
                values.append(blocker)
            if checkpoint is not ...:
                sets.append('checkpoint=?')
                values.append(json.dumps(checkpoint) if checkpoint is not None else None)
            values.append(ident)
            self.store.connection.execute(
                f'UPDATE project_milestones SET {", ".join(sets)} WHERE id=?', values)
            self.store.connection.commit()
        return self.get_milestone(ident)

    # -- selection ----------------------------------------------------------------
    def _dependencies_satisfied(self, milestone):
        for dep in milestone['dependency_ids']:
            dep_row = self._row(dep)
            if dep_row is None or dep_row['state'] != 'completed':
                return False, dep
        return True, None

    def select_next(self):
        """Choose ONE bounded next action across the portfolio, or explain why not.

        Returns (milestone_or_None, reason). Enqueues the milestone's goal through the
        existing Autonomy queue at background priority — user requests outrank it.
        """
        if self.autonomy is None:
            return None, 'scheduler not wired'
        if not self.autonomy.settings()['enabled']:
            return None, 'autonomy disabled'
        for project in self.bootstrapper.projects():
            if project['status'] != 'active':
                continue
            for milestone in self.milestones(project['name']):
                if milestone['state'] not in ('pending', 'ready'):
                    # A dependency-blocked milestone becomes eligible as soon as its
                    # dependencies are actually completed (covers restart cases too).
                    if not (milestone['state'] == 'blocked'
                            and str(milestone['blocker'] or '').startswith('Waiting on milestone')
                            and self._dependencies_satisfied(milestone)[0]):
                        continue
                if milestone['goal_id']:
                    continue  # leased: one live goal per milestone
                satisfied, dep = self._dependencies_satisfied(milestone)
                if not satisfied:
                    self._set(milestone['id'], state='blocked',
                              blocker=f'Waiting on milestone {dep}')
                    continue
                estimate = milestone['estimated_seconds'] or DEFAULT_ESTIMATE_SECONDS
                budget = self.policy.check_budget('time_seconds', estimate,
                                                  project['name'])
                if budget.get('enforced') and not budget['allowed']:
                    self._set(milestone['id'], state='blocked',
                              blocker=budget['reason'])
                    continue
                goal = self.autonomy.add(
                    title=f"[{project['name']}] {milestone['title']}",
                    prompt=milestone['prompt'], priority=BACKGROUND_PRIORITY)
                updated = self._set(milestone['id'], state='in_progress',
                                    goal_id=goal['id'])
                self.store.emit('milestone.started',
                                {'milestone_id': milestone['id'],
                                 'project_name': project['name'], 'goal_id': goal['id']})
                return updated, 'selected'
        return None, 'no eligible milestone'

    def on_goal_complete(self, goal_id, status):
        """Milestone lifecycle at the goal-completion boundary (idempotent)."""
        with self.lock:
            row = self.store.connection.execute(
                'SELECT id, state FROM project_milestones WHERE goal_id=?', (goal_id,)).fetchone()
        if row is None:
            return None
        if status == 'completed':
            milestone = self._set(row['id'], state='completed', checkpoint={'result': 'passed'})
            # Unblock dependents whose dependencies are now all completed.
            for candidate in self.milestones():
                if candidate['state'] != 'blocked' or not candidate['blocker']:
                    continue
                if not str(candidate['blocker']).startswith('Waiting on milestone'):
                    continue
                satisfied, _ = self._dependencies_satisfied(candidate)
                if satisfied:
                    self._set(candidate['id'], state='ready', blocker=None)
                    self.store.emit('milestone.ready', {'milestone_id': candidate['id']})
        else:
            milestone = self._set(row['id'], state='blocked',
                                  blocker=f'Goal finished as {status}; review and retry')
        # A project whose last open milestone is done may be marked completed later; the
        # portfolio state stays explicit rather than inferred.
        if self.experience is not None and goal_id:
            try:
                goal = self.autonomy.get(goal_id) if self.autonomy else None
                task = self.store.task(goal['task_id']) if goal and goal.get('task_id') else None
                if task is not None:
                    self.experience.record_outcome(milestone, task, goal)
            except Exception as exc:
                self.store.emit('experience.error', {'error': str(exc)[:300]})
        self.store.emit('milestone.' + ('completed' if status == 'completed' else 'blocked'),
                        {'milestone_id': row['id'], 'goal_id': goal_id})
        return milestone

    def retry_milestone(self, ident):
        """Bounded revision: requeue a blocked milestone within MAX_RETRIES attempts."""
        milestone = self.get_milestone(ident)
        if milestone is None:
            return None
        if milestone['state'] != 'blocked':
            raise ValueError(f"Milestone is '{milestone['state']}', not blocked")
        if milestone['goal_id'] and self.autonomy:
            goal = self.autonomy.get(milestone['goal_id'])
            if goal and goal['state'] in ('pending', 'running'):
                raise ValueError('Milestone goal is still live; cancel it before retrying')
        checkpoint = dict(milestone['checkpoint'] or {})
        attempts = int(checkpoint.get('attempts', 0))
        if attempts >= MAX_RETRIES:
            raise ValueError('Bounded retries exhausted; the blocker needs human review')
        checkpoint['attempts'] = attempts + 1
        updated = self._set(ident, state='ready', goal_id=None, blocker=None,
                            checkpoint=checkpoint)
        self.store.emit('milestone.retried', {'milestone_id': ident, 'attempts': attempts + 1})
        return updated

    # -- restart reconciliation ---------------------------------------------------
    def reconcile(self):
        """Resolve every in_progress milestone against the ACTUAL goal state. Never
        enqueues a duplicate: a leased milestone with a live goal stays untouched; a
        milestone whose goal vanished or is terminal is returned to the queue or marked."""
        reconciled = {'requeued': 0, 'completed': 0, 'blocked': 0}
        for milestone in self.milestones():
            if milestone['state'] != 'in_progress' or not milestone['goal_id']:
                continue
            goal = self.autonomy.get(milestone['goal_id']) if self.autonomy else None
            if goal is None:
                self._set(milestone['id'], state='ready', goal_id=None,
                          blocker='Restart recovery: goal record missing; requeued')
                reconciled['requeued'] += 1
            elif goal['state'] == 'completed':
                self._set(milestone['id'], state='completed', checkpoint={'result': 'passed'})
                reconciled['completed'] += 1
            elif goal['state'] in ('failed', 'cancelled'):
                self._set(milestone['id'], state='blocked', blocker=f'Goal {goal["state"]}')
                reconciled['blocked'] += 1
            # 'pending'/'running' goals are still live: leave the lease alone.
        if any(reconciled.values()):
            self.store.emit('portfolio.reconciled', reconciled)
        return reconciled

    # -- user controls ------------------------------------------------------------
    def pause(self, project_name):
        project = self.bootstrapper.set_project_state(project_name, 'paused')
        if project is None:
            raise ValueError(f'Unknown project: {project_name}')
        return project

    def resume(self, project_name):
        project = self.bootstrapper.set_project_state(project_name, 'active')
        if project is None:
            raise ValueError(f'Unknown project: {project_name}')
        return project

    def cancel(self, project_name):
        """Cancel a project: stop queued background goals and cancel open milestones."""
        project = self.bootstrapper.set_project_state(project_name, 'cancelled')
        if project is None:
            raise ValueError(f'Unknown project: {project_name}')
        for milestone in self.milestones(project_name):
            if milestone['state'] in ('pending', 'ready', 'blocked'):
                self._set(milestone['id'], state='cancelled', blocker='Project cancelled')
            elif milestone['state'] == 'in_progress' and milestone['goal_id']:
                try:
                    self.autonomy.cancel(milestone['goal_id'])
                except ValueError:
                    pass  # goal already terminal
                self._set(milestone['id'], state='cancelled', blocker='Project cancelled')
        self.store.emit('project.cancelled', {'project_name': project_name})
        return self.bootstrapper.project(project_name)
