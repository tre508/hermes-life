"""HL-AUTO-001 Phase 2 exit gate: opportunity + learning.

Fixtures yield provenance-backed opportunities and verified skill records; unchanged
sources cannot spin an infinite loop (§26.10 Phase 2).
"""
from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.autonomy_policy import AutonomyPolicy
from hermes_life.initiative import InitiativeEngine
from hermes_life.opportunities import OpportunityRegistry
from hermes_life.schema import migrate
from hermes_life.store import Store, now


class FakeAdapter:
    def available(self):return True
    def run(self,prompt,callback,task_id=None):
        callback('hermes.result',{'text':prompt})
        return {'result':prompt,'session_id':'fake'}
    def cancel(self, task_id):
        return True


def _engine(tmp_path):
    store = Store(tmp_path / 'auto.db')
    migrate(store.connection)
    policy = AutonomyPolicy(store)
    registry = OpportunityRegistry(store, policy)
    return store, registry, InitiativeEngine(store, policy, registry)


def _seed_failed_task(store, task_id, prompt, error):
    stamp = now()
    with store.lock:
        store.connection.execute(
            'INSERT INTO tasks (id, prompt, state, created_at, updated_at, error)'
            ' VALUES (?,?,?,?,?,?)', (task_id, prompt, 'failed', stamp, stamp, error))
        store.connection.commit()


def _seed_completed_task(store, task_id, prompt):
    stamp = now()
    with store.lock:
        store.connection.execute(
            'INSERT INTO tasks (id, prompt, state, created_at, updated_at, result)'
            ' VALUES (?,?,?,?,?,?)', (task_id, prompt, 'completed', stamp, stamp, 'ok'))
        store.connection.commit()


def test_failed_task_fixture_yields_traceable_opportunity_and_objective(tmp_path):
    store, _, engine = _engine(tmp_path)
    _seed_failed_task(store, 't1', 'Deploy the worker', 'SSH tunnel refused')
    outcome = engine.detect()
    assert outcome['created'] == 1 and outcome['objectives_new'] == 1
    opportunity = engine.registry.list()[0]
    assert opportunity['source_type'] == 'task_outcome'
    assert 'task:t1' in opportunity['evidence_refs'], 'provenance must be traceable'
    objective = engine.objectives()[0]
    assert objective['gap_source'] == 'failed_task'
    assert 'task:t1' in objective['evidence_refs']


def test_repeated_failures_reinforce_without_duplicating(tmp_path):
    store, _, engine = _engine(tmp_path)
    _seed_failed_task(store, 't1', 'Deploy the worker', 'SSH tunnel refused')
    _seed_failed_task(store, 't2', 'Deploy the worker', 'SSH tunnel refused')
    first = engine.detect()
    assert first['created'] == 1
    second = engine.detect()
    # Same evidence re-scanned: nothing new is created — no infinite loop.
    assert second['created'] == 0 and second['objectives_new'] == 0
    assert len(engine.registry.list()) == 1
    assert len(engine.objectives()) == 1


def test_unchanged_sources_cannot_spin_a_loop(tmp_path):
    store, _, engine = _engine(tmp_path)
    _seed_failed_task(store, 't1', 'Deploy the worker', 'SSH tunnel refused')
    engine.detect()
    for _ in range(5):
        outcome = engine.detect()
        assert outcome['created'] == 0 and outcome['updated'] == 0
    assert engine.settings()['last_scan'] is not None


def test_repeated_workflow_fixture_yields_opportunity(tmp_path):
    store, _, engine = _engine(tmp_path)
    stamp = now()
    with store.lock:
        for i, state in enumerate(('completed', 'completed')):
            store.connection.execute(
                'INSERT INTO goals (id, title, prompt, state, priority, created_at, updated_at)'
                ' VALUES (?,?,?,?,?,?,?)',
                (f'g{i}', 'Weekly report', 'compile the weekly report', state, 50,
                 stamp, stamp))
        store.connection.commit()
    outcome = engine.detect()
    assert outcome['created'] >= 1
    opportunity = [o for o in engine.registry.list()
                   if o['source_type'] == 'repeated_workflow'][0]
    assert 'goal:g0' in opportunity['evidence_refs']
    # Re-running the scan on unchanged goals adds nothing.
    assert engine.detect()['created'] == 0


def test_correction_fixture_yields_opportunity(tmp_path):
    store, _, engine = _engine(tmp_path)
    with store.lock:
        store.connection.execute(
            "INSERT INTO hl_memories (id, content, kind, created_at, updated_at)"
            " VALUES ('m1', 'Prefer ripgrep over grep', 'preference', ?, ?)", (now(), now()))
        store.connection.execute(
            'INSERT INTO hl_memory_corrections (memory_id, action, actor, rationale,'
            ' created_at) VALUES (?,?,?,?,?)',
            ('m1', 'supersede', 'user', 'Actually prefers ag', now()))
        store.connection.commit()
    engine.detect()
    opportunity = [o for o in engine.registry.list()
                   if o['source_type'] == 'user_correction'][0]
    assert 'correction:1' in opportunity['evidence_refs']


def test_skill_verification_requires_a_completed_task(tmp_path):
    store, _, engine = _engine(tmp_path)
    _seed_failed_task(store, 't1', 'Deploy the worker', 'SSH tunnel refused')
    engine.detect()
    objective = engine.objectives()[0]
    # A failed task cannot verify a skill.
    try:
        engine.record_exercise(objective['id'], 't1', 'passed')
        raised = False
    except ValueError:
        raised = True
    assert raised
    _seed_completed_task(store, 't2', 'Exercise: SSH tunnel setup drills')
    evidence = engine.record_exercise(objective['id'], 't2', 'passed',
                                      evidence='pytest exercises::ssh_tunnel PASSED',
                                      exercise_ref='exercises/ssh-tunnel')
    assert evidence['duplicate'] is False
    assert engine.get_objective(objective['id'])['status'] == 'verified'
    skills = engine.skills()
    assert len(skills) == 1 and skills[0]['passes'] == 1
    # Same task re-recorded is idempotent, not double-counted.
    again = engine.record_exercise(objective['id'], 't2', 'passed')
    assert again['duplicate'] is True
    assert engine.skills()[0]['exercises'] == 1
    # A missing task is refused outright.
    try:
        engine.record_exercise(objective['id'], 'no-such-task', 'passed')
        raised = False
    except ValueError:
        raised = True
    assert raised


def test_ranking_is_weighted_and_configurable(tmp_path):
    store, _, engine = _engine(tmp_path)
    _seed_failed_task(store, 't1', 'Deploy the worker', 'SSH tunnel refused')
    engine.detect()
    ranked = engine.ranked()
    assert ranked and ranked[0]['score'] > 0
    assert 'score_breakdown' in ranked[0]
    # Weights are configurable and inspectable; zeroing novelty is honored.
    engine.configure_weights({'novelty': 0.0})
    settings = engine.settings()
    assert settings['weights']['novelty'] == 0.0
    try:
        engine.configure_weights({'magic': 1.0})
        raised = False
    except ValueError:
        raised = True
    assert raised


def test_phase2_api_surface_and_restart(tmp_path):
    db = tmp_path / 'api.db'
    with TestClient(create_app(database=db, adapter=FakeAdapter())) as client:
        # Seed evidence through the real record stores, then scan through the API.
        runtime = client.app.state.runtime
        stamp = now()
        with runtime.store.lock:
            runtime.store.connection.execute(
                'INSERT INTO tasks (id, prompt, state, created_at, updated_at, error)'
                " VALUES ('tx', 'deploy worker', 'failed', ?, ?, 'SSH refused')",
                (stamp, stamp))
            runtime.store.connection.commit()
        scanned = client.post('/api/opportunities/scan').json()
        assert scanned['created'] >= 1 and scanned['objectives_new'] >= 1
        objective_id = client.get('/api/learning/objectives').json()['objectives'][0]['id']
        # Completion evidence must exist before a skill is verified.
        with runtime.store.lock:
            runtime.store.connection.execute(
                'INSERT INTO tasks (id, prompt, state, created_at, updated_at, result)'
                " VALUES ('ty', 'exercise', 'completed', ?, ?, 'passed')", (stamp, stamp))
            runtime.store.connection.commit()
        exercise = client.post(f'/api/learning/objectives/{objective_id}/exercise', json={
            'task_id': 'ty', 'result': 'passed', 'evidence': 'tests passed'}).json()
        assert exercise['result'] == 'passed'
        assert client.get('/api/skills').json()['skills'][0]['skill']
        assert client.get('/api/opportunities/ranked').json()['opportunities']
        rejected = client.post(f'/api/learning/objectives/{objective_id}/exercise', json={
            'task_id': 'missing', 'result': 'passed'})
        assert rejected.status_code == 422
    with TestClient(create_app(database=db, adapter=FakeAdapter())) as restored:
        objectives = restored.get('/api/learning/objectives').json()['objectives']
        assert any(o['status'] == 'verified' for o in objectives)
        assert restored.get('/api/skills').json()['skills']
        # Re-scan after restart on unchanged data: still no new records.
        assert restored.post('/api/opportunities/scan').json()['created'] == 0
