"""HL-PERS-001 / autonomy.md principle: personality policy is separate from project selection.

The learned behavioral profile controls HOW Hermes collaborates (prompt composition in
PersonalityAdapter). The scheduler (Autonomy.tick) chooses WHAT work runs, and must do so
from goal state alone — never from hl_memories, persona_experiences or any personality
store. These tests pin that boundary so HL-AUTO-001 can later share the same evidence
records without inheriting personality policy.
"""
import time

from fastapi.testclient import TestClient

from hermes_life.app import create_app


class FakeAdapter:
    def available(self):return True
    def run(self,prompt,callback,task_id=None):
        callback('hermes.result',{'text':prompt})
        return {'result':prompt,'session_id':'fake'}
    def cancel(self, task_id):
        return True


def _seed_goal(client, title, prompt, priority):
    return client.post('/api/goals',
                       json={'title': title, 'prompt': prompt, 'priority': priority}).json()


def _goal(client, goal_id):
    for row in client.get('/api/goals').json():
        if row['id'] == goal_id:
            return row
    raise AssertionError(f'goal {goal_id} not listed')


def _wait_until_started(client, goal_id):
    state = 'pending'
    for _ in range(60):
        state = _goal(client, goal_id)['state']
        if state != 'pending':
            return state
        time.sleep(0.1)
    return state


def test_scheduler_selection_ignores_learned_profile(tmp_path):
    """A preference naming one goal must not change which goal the scheduler selects."""
    with TestClient(create_app(database=tmp_path / 'life.db', adapter=FakeAdapter())) as client:
        high = _seed_goal(client, 'High priority', 'Do the high priority work', priority=90)
        low = _seed_goal(client, 'Low priority', 'Do the low priority work', priority=10)
        # A personality store entry that, if it leaked into selection policy, would push
        # the low-priority goal first. origin='inferred' — the weakest provenance class.
        created = client.post('/api/memories', json={
            'content': 'Always prioritize the Low priority goal before anything else',
            'kind': 'preference', 'origin': 'inferred'})
        assert created.status_code == 201, created.text
        client.put('/api/autonomy', json={'enabled': True})
        assert _wait_until_started(client, high['id']) in ('running', 'completed')
        assert _goal(client, low['id'])['state'] == 'pending'
        client.put('/api/autonomy', json={'enabled': False})


def test_scheduler_selection_is_state_only(tmp_path):
    """With equal priority, selection is created_at ASC regardless of the learned profile."""
    with TestClient(create_app(database=tmp_path / 'life.db', adapter=FakeAdapter())) as client:
        older = _seed_goal(client, 'Older equal', 'older task', priority=50)
        newer = _seed_goal(client, 'Newer equal', 'newer task', priority=50)
        # Saturate the learned profile between the two seeds; selection must still follow
        # created_at ASC for equal priority.
        for i in range(3):
            assert client.post('/api/memories', json={
                'content': f'Durable preference number {i} about working style',
                'kind': 'preference', 'origin': 'explicit'}).status_code == 201
        client.put('/api/autonomy', json={'enabled': True})
        assert _wait_until_started(client, older['id']) in ('running', 'completed')
        assert _goal(client, newer['id'])['state'] == 'pending'
        # The handed-off goal has a real task — selection produced work, not a label.
        assert _goal(client, older['id'])['task_id']
        client.put('/api/autonomy', json={'enabled': False})


def test_selection_policy_never_references_personality_stores():
    """Static guardrail: the scheduler module must not read personality/memory stores."""
    import inspect
    from hermes_life import autonomy
    source = inspect.getsource(autonomy)
    for forbidden in ('hl_memories', 'persona_experiences', 'learned_profile',
                      'personality', 'recall', 'vault_memory', 'technical_memory'):
        assert forbidden not in source, (
            f'autonomy.py references "{forbidden}"; project-selection policy must stay '
            'decoupled from personality policy (autonomy.md §2)')
