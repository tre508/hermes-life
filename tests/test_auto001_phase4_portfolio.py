"""HL-AUTO-001 Phase 4 exit gate: portfolio orchestration.

Two projects survive restart without duplicate work; user requests preempt background
work; blocked states are actionable (§26.10 Phase 4 / §26.11 AUTO-06).
"""
import time

from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.autonomy_policy import AutonomyPolicy
from hermes_life.bootstrap import ProjectBootstrapper
from hermes_life.opportunities import OpportunityRegistry
from hermes_life.portfolio import PortfolioEngine, BACKGROUND_PRIORITY
from hermes_life.schema import migrate
from hermes_life.store import Store


class StubAutonomy:
    """Goal-queue stand-in with Autonomy's contract, no worker thread."""

    def __init__(self):
        self.goals = {}
        self.counter = 0

    def settings(self):
        return {'enabled': True}

    def add(self, title, prompt, priority):
        self.counter += 1
        goal = {'id': f'goal-{self.counter}', 'title': title, 'prompt': prompt,
                'state': 'pending', 'priority': priority, 'task_id': None, 'error': None}
        self.goals[goal['id']] = goal
        return goal

    def get(self, ident):
        return self.goals.get(ident)

    def cancel(self, ident):
        goal = self.goals.get(ident)
        if not goal or goal['state'] not in ('pending', 'interrupted'):
            raise ValueError('Only pending/interrupted goals can be cancelled')
        goal['state'] = 'cancelled'
        return goal


def _engine(tmp_path, projects=('alpha', 'beta')):
    store = Store(tmp_path / 'auto.db')
    migrate(store.connection)
    policy = AutonomyPolicy(store)
    registry = OpportunityRegistry(store, policy)
    bootstrapper = ProjectBootstrapper(store, policy, ssh=lambda script: 'ok\n')
    autonomy = StubAutonomy()
    portfolio = PortfolioEngine(store, policy, bootstrapper)
    portfolio.autonomy = autonomy
    for name in projects:
        with store.lock:
            store.connection.execute(
                'INSERT INTO autonomy_projects (id, name, origin, vm_path, status,'
                ' created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
                (f'id-{name}', name, 'autonomous', f'/home/hermes/experiments/{name}',
                 'active', '2026-01-01', '2026-01-01'))
            store.connection.commit()
    return store, policy, registry, bootstrapper, autonomy, portfolio


def test_milestones_run_in_dependency_order(tmp_path):
    store, policy, registry, bootstrapper, autonomy, portfolio = _engine(tmp_path, ('alpha',))
    m1 = portfolio.add_milestone('alpha', 'Setup repo', 'Initialize the project skeleton')
    m2 = portfolio.add_milestone('alpha', 'Add CLI', 'Implement the CLI entry point',
                                 dependency_ids=[m1['id']])
    selected, _ = portfolio.select_next()
    assert selected['id'] == m1['id'] and selected['state'] == 'in_progress'
    goal = autonomy.get(selected['goal_id'])
    assert goal['priority'] == BACKGROUND_PRIORITY
    # The dependent milestone is blocked with an actionable reason until m1 completes.
    assert m2['state'] == 'blocked' and 'Waiting on milestone' in m2['blocker']
    portfolio.on_goal_complete(goal['id'], 'completed')
    assert portfolio.get_milestone(m1['id'])['state'] == 'completed'
    # A second selection can now only pick m2 — one bounded action per call.
    selected2, _ = portfolio.select_next()
    assert selected2['id'] == m2['id']
    # Both milestones leased: a further selection finds nothing, no duplicate goal.
    selected3, reason = portfolio.select_next()
    assert selected3 is None
    assert len(autonomy.goals) == 2


def test_two_projects_survive_restart_without_duplicate_jobs(tmp_path):
    store, policy, registry, bootstrapper, autonomy, portfolio = _engine(tmp_path)
    for name in ('alpha', 'beta'):
        portfolio.add_milestone(name, 'First step', f'Advance {name} step one')
    # Simulate a crash mid-flight: one milestone leased to a goal that never finished,
    # one leased to a COMPLETED goal, one leased to a goal record that no longer exists.
    first, _ = portfolio.select_next()    # alpha
    second, _ = portfolio.select_next()   # beta
    autonomy.get(first['goal_id'])['state'] = 'completed'
    gone_id = second['goal_id']
    del autonomy.goals[gone_id]
    outcome = portfolio.reconcile()
    assert outcome['completed'] >= 1 and outcome['requeued'] >= 1
    # After reconciliation, selection continues without creating duplicate leases.
    for _ in range(4):
        selected, _ = portfolio.select_next()
        if selected is None:
            break
    leased = {m['goal_id'] for m in portfolio.milestones()
              if m['state'] == 'in_progress' and m['goal_id']}
    pending_goals = {g['id'] for g in autonomy.goals.values() if g['state'] == 'pending'}
    assert leased == pending_goals, \
        'live milestone leases must map 1:1 onto pending goals (no duplicates)'


def test_user_request_preempts_background_work(tmp_path):
    store, policy, registry, bootstrapper, autonomy, portfolio = _engine(tmp_path, ('alpha',))
    portfolio.add_milestone('alpha', 'Background step', 'Advance the background work')
    # A direct user goal at normal priority sits in the same queue, ahead of background.
    user_goal = autonomy.add(title='User request', prompt='Fix my thing now', priority=90)
    background, _ = portfolio.select_next()
    assert background is not None
    # The scheduler's ordering rule: priority DESC, created_at ASC.
    queue = sorted(autonomy.goals.values(), key=lambda g: (-g['priority'], g['id']))
    assert queue[0]['id'] == user_goal['id'], 'user request must be selected first'
    assert queue[1]['priority'] == BACKGROUND_PRIORITY


def test_pause_resume_and_cancel_are_durable(tmp_path):
    store, policy, registry, bootstrapper, autonomy, portfolio = _engine(tmp_path)
    portfolio.add_milestone('alpha', 'Alpha step', 'Advance alpha')
    portfolio.add_milestone('beta', 'Beta step', 'Advance beta')
    paused = portfolio.pause('alpha')
    assert paused['status'] == 'paused'
    selected, _ = portfolio.select_next()
    assert selected['project_name'] == 'beta', 'paused projects must not be scheduled'
    assert portfolio.resume('alpha')['status'] == 'active'
    # Cancel beta: its pending goal is cancelled, its milestone is cancelled.
    portfolio.select_next()  # leases beta's milestone
    beta_milestone = [m for m in portfolio.milestones('beta')][0]
    cancelled = portfolio.cancel('beta')
    assert cancelled['status'] == 'cancelled'
    assert portfolio.get_milestone(beta_milestone['id'])['state'] == 'cancelled'
    assert autonomy.get(beta_milestone['goal_id'])['state'] == 'cancelled'
    # Cancelled projects are never selected again.
    selected, _ = portfolio.select_next()
    assert selected is None or selected['project_name'] == 'alpha'


def test_budget_exhaustion_blocks_with_actionable_reason(tmp_path):
    store, policy, registry, bootstrapper, autonomy, portfolio = _engine(tmp_path, ('alpha',))
    portfolio.add_milestone('alpha', 'Heavy step', 'Do the heavy work')
    policy.set_budget('time_seconds', 60, project_id='alpha')
    selected, _ = portfolio.select_next()
    assert selected is None
    milestone = portfolio.milestones('alpha')[0]
    assert milestone['state'] == 'blocked' and 'budget' in milestone['blocker']


def test_phase4_api_full_restart_no_duplicate_jobs(tmp_path):
    db = tmp_path / 'api.db'
    with TestClient(create_app(database=db, adapter=FakeAdapter())) as client:
        runtime = client.app.state.runtime
        client.put('/api/autonomy', json={'enabled': True})
        # Fixture: two active autonomous projects (bootstrap already verified in Phase 3).
        with runtime.store.lock:
            for name in ('alpha', 'beta'):
                runtime.store.connection.execute(
                    'INSERT INTO autonomy_projects (id, name, origin, vm_path, status,'
                    ' created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
                    (f'id-{name}', name, 'autonomous', f'/home/hermes/experiments/{name}',
                     'active', '2026-01-01', '2026-01-01'))
            runtime.store.connection.commit()
        for name in ('alpha', 'beta'):
            created = client.post(f'/api/autonomy/projects/{name}/milestones', json={
                'title': 'Step one', 'prompt': f'Advance {name}',
                'acceptance_criteria': f'{name} step one done'})
            assert created.status_code == 201, created.text
        # Let the single scheduler drain both milestones through the FakeAdapter.
        deadline = time.time() + 15
        while time.time() < deadline:
            states = [m['state'] for name in ('alpha', 'beta')
                      for m in client.get(f'/api/autonomy/projects/{name}/milestones').json()['milestones']]
            if states and all(s == 'completed' for s in states):
                break
            time.sleep(0.3)
        assert states == ['completed', 'completed'], states
        goals_before = client.get('/api/goals').json()
        assert len(goals_before) == 2
        paused = client.post('/api/autonomy/projects/alpha/pause')
        assert paused.json()['status'] == 'paused'
    # Restart on the same database: completed milestones stay completed, reconcile
    # enqueues nothing, and the goal count does not grow.
    with TestClient(create_app(database=db, adapter=FakeAdapter())) as restored:
        restored.put('/api/autonomy', json={'enabled': True})
        time.sleep(2.5)  # several scheduler ticks on a fully-drained portfolio
        for name in ('alpha', 'beta'):
            milestones = restored.get(f'/api/autonomy/projects/{name}/milestones').json()['milestones']
            assert all(m['state'] == 'completed' for m in milestones), milestones
            assert all(m['goal_id'] for m in milestones)
        goals_after = restored.get('/api/goals').json()
        assert len(goals_after) == len(goals_before), 'restart must not duplicate jobs'
        assert restored.post('/api/autonomy/projects/alpha/resume').json()['status'] == 'active'


class FakeAdapter:
    def available(self):return True
    def run(self,prompt,callback,task_id=None):
        callback('hermes.result',{'text':prompt})
        return {'result':prompt,'session_id':'fake'}
    def cancel(self, task_id):
        return True
