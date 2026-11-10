"""HL-AUTO-001 Phase 5 exit gate: execution + experience.

A milestone is implemented (through the existing goal/task engine), its outcome is scored
against the recorded expectation using real task artifacts, failures get bounded retries,
and outcome classification feeds back into opportunity ranking.
"""
import time

from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.autonomy_policy import AutonomyPolicy
from hermes_life.bootstrap import ProjectBootstrapper
from hermes_life.experience import ExperienceEngine
from hermes_life.opportunities import OpportunityRegistry
from hermes_life.portfolio import PortfolioEngine
from hermes_life.schema import migrate
from hermes_life.store import Store, now


class StubAutonomy:
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
        raise ValueError('Only pending/interrupted goals can be cancelled')


def _world(tmp_path, project='alpha'):
    store = Store(tmp_path / 'auto.db')
    migrate(store.connection)
    policy = AutonomyPolicy(store)
    registry = OpportunityRegistry(store, policy)
    bootstrapper = ProjectBootstrapper(store, policy, ssh=lambda script: 'ok\n')
    experience = ExperienceEngine(store, registry)
    portfolio = PortfolioEngine(store, policy, bootstrapper)
    portfolio.autonomy = StubAutonomy()
    portfolio.experience = experience
    with store.lock:
        store.connection.execute(
            'INSERT INTO autonomy_projects (id, name, origin, proposal_id, vm_path, status,'
            ' created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
            ('proj-1', project, 'autonomous', None, f'/home/hermes/experiments/{project}',
             'active', now(), now()))
        store.connection.commit()
    return store, registry, experience, portfolio


def _seed_task(store, task_id, state, result=None, error=None):
    stamp = now()
    with store.lock:
        store.connection.execute(
            'INSERT INTO tasks (id, prompt, state, created_at, updated_at, result, error)'
            ' VALUES (?,?,?,?,?,?,?)', (task_id, 'milestone work', state, stamp, stamp,
                                        result, error))
        store.connection.commit()


def test_success_outcome_scored_against_expectation_with_artifacts(tmp_path):
    store, registry, experience, portfolio = _world(tmp_path)
    milestone = portfolio.add_milestone('alpha', 'Ship CLI',
                                        'Build the export CLI',
                                        acceptance_criteria='CLI runs and prints help')
    _seed_task(store, 't-ok', 'completed', result='CLI built; pytest 4 passed')
    record = experience.record_outcome(milestone, store.task('t-ok'),
                                       goal={'id': 'goal-1'})
    assert record['classification'] == 'success'
    assert record['expected_result'] == 'CLI runs and prints help'
    assert 'CLI built; pytest 4 passed' in record['measured_result']
    assert 'task:t-ok' in record['evidence_refs'] and 'milestone:' + milestone['id'] in record['evidence_refs']
    assert record['lesson'] and 'task t-ok' in record['lesson']
    # Idempotent: re-scoring the same artifacts does not duplicate.
    again = experience.record_outcome(milestone, store.task('t-ok'), goal={'id': 'goal-1'})
    assert again['duplicate'] is True
    assert len(experience.list()) == 1


def test_failure_outcome_is_labelled_and_refines_ranking(tmp_path):
    store, registry, experience, portfolio = _world(tmp_path)
    policy = AutonomyPolicy(store)
    policy.configure(mode='suggest', allowlist=[])
    # Chain the project to an opportunity so ranking refinement is observable.
    opportunity = registry.ingest('repeated_workflow', 'Automate exports',
                                  'Exports rebuilt by hand', evidence_refs=['task:e1'],
                                  dedupe_key='export-tool')
    proposal = registry.propose(opportunity['id'], 'Export tool',
                                'A bounded CLI export tool for weekly summaries')
    registry.decide_proposal(proposal['id'], True, rationale='ok')
    with store.lock:
        store.connection.execute(
            'UPDATE autonomy_projects SET proposal_id=? WHERE name=?',
            (proposal['id'], 'alpha'))
        store.connection.commit()
    before = registry.get(opportunity['id'])['confidence']
    milestone = portfolio.add_milestone('alpha', 'Ship CLI', 'Build the export CLI')
    _seed_task(store, 't-bad', 'failed', error='ImportError: no module named cli')
    record = experience.record_outcome(milestone, store.task('t-bad'))
    assert record['classification'] == 'failure'
    assert record['lesson'].startswith('FAILURE LESSON')
    after = registry.get(opportunity['id'])['confidence']
    assert after < before, 'a measured failure must lower the opportunity ranking'
    # A success on the same project raises it again, bounded.
    _seed_task(store, 't-good', 'completed', result='fixed')
    experience.record_outcome(milestone, store.task('t-good'))
    recovered = registry.get(opportunity['id'])['confidence']
    assert recovered == round(min(0.95, after + 0.05), 4)


def test_bounded_retries_then_human_review(tmp_path):
    store, registry, experience, portfolio = _world(tmp_path)
    milestone = portfolio.add_milestone('alpha', 'Ship CLI', 'Build the export CLI')
    _seed_task(store, 't1', 'failed', error='boom')
    milestone = portfolio._set(milestone['id'], state='in_progress', goal_id='g1')
    milestone = portfolio.on_goal_complete('g1', 'failed')
    assert milestone['state'] == 'blocked'
    for attempt in range(3):
        retried = portfolio.retry_milestone(milestone['id'])
        assert retried['state'] == 'ready'
        assert retried['checkpoint']['attempts'] == attempt + 1
        # simulate the retry failing again
        portfolio._set(milestone['id'], state='in_progress',
                       goal_id=f'g-retry-{attempt}')
        milestone = portfolio.on_goal_complete(f'g-retry-{attempt}', 'failed')
        assert milestone['state'] == 'blocked'
    try:
        portfolio.retry_milestone(milestone['id'])
        raised = False
    except ValueError as exc:
        raised = 'exhausted' in str(exc)
    assert raised, 'after MAX_RETRIES the blocker must require human review'
    # A still-live goal must not be retried underneath itself.
    m2 = portfolio.add_milestone('alpha', 'Other', 'Other work')
    portfolio._set(m2['id'], state='blocked', blocker='waiting', goal_id='g-live')
    portfolio.autonomy.goals['g-live'] = {'id': 'g-live', 'state': 'running'}
    try:
        portfolio.retry_milestone(m2['id'])
        raised = False
    except ValueError as exc:
        raised = 'still live' in str(exc)
    assert raised


def test_phase5_end_to_end_and_restart(tmp_path):
    db = tmp_path / 'api.db'
    with TestClient(create_app(database=db, adapter=FakeAdapter())) as client:
        client.put('/api/autonomy', json={'enabled': True})
        runtime = client.app.state.runtime
        with runtime.store.lock:
            runtime.store.connection.execute(
                'INSERT INTO autonomy_projects (id, name, origin, vm_path, status,'
                ' created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
                ('proj-1', 'gamma', 'autonomous', '/home/hermes/experiments/gamma',
                 'active', now(), now()))
            runtime.store.connection.commit()
        created = client.post('/api/autonomy/projects/gamma/milestones', json={
            'title': 'Implement export tool', 'prompt': 'Implement and test the export tool',
            'acceptance_criteria': 'export tool works'}).json()
        deadline = time.time() + 15
        while time.time() < deadline:
            states = client.get('/api/autonomy/projects/gamma/milestones').json()['milestones'][0]['state']
            if states == 'completed':
                break
            time.sleep(0.3)
        assert states == 'completed'
        experiences = client.get('/api/autonomy/experiences').json()['experiences']
        assert len(experiences) == 1
        record = experiences[0]
        assert record['classification'] == 'success'
        assert record['task_id'] and record['goal_id'] and record['milestone_id']
        assert record['expected_result'] == 'export tool works'
        # The task artifact is real and fetchable.
        task = client.get(f"/api/tasks/{record['task_id']}").json()
        assert task['state'] == 'completed'
    with TestClient(create_app(database=db, adapter=FakeAdapter())) as restored:
        experiences = restored.get('/api/autonomy/experiences').json()['experiences']
        assert len(experiences) == 1, 'experience records survive restart without duplicates'
        milestones = restored.get('/api/autonomy/projects/gamma/milestones').json()['milestones']
        assert milestones[0]['state'] == 'completed'


class FakeAdapter:
    def available(self):return True
    def run(self,prompt,callback,task_id=None):
        callback('hermes.result',{'text':prompt})
        return {'result':'export tool works; tests passed','session_id':'fake'}
    def cancel(self, task_id):
        return True
