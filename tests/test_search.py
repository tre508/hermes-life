"""HERMESHA §2/§3/§5 — global search aggregate.

Covers the pure ranking helpers and the /api/search contract: bounded query
length, cross-source results, project scoping, and explicit degradation when the
vault is unreachable (never a fake empty success).
"""
import pytest
from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.search import score, excerpt


class FakeAdapter:
    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        return {'result': 'ok', 'session_id': 's'}

    def cancel(self, task_id):
        return True


# --------------------------------------------------------------------------- pure helpers

def test_score_prefers_exact_then_prefix_then_substring():
    assert score('ledger', 'ledger') > score('ledger', 'ledger reconciliation')
    assert score('ledger', 'ledger reconciliation') > score('ledger', 'the ledger is here')
    assert score('ledger', 'nothing to see') == 0


def test_score_ignores_none_fields():
    assert score('ledger', None, 'ledger') > 0


def test_excerpt_windows_around_the_hit():
    text = 'x' * 100 + 'needle' + 'y' * 100
    out = excerpt('needle', text, width=40)
    assert 'needle' in out
    assert out.startswith('…') and out.endswith('…')


def test_excerpt_handles_no_hit_and_empty():
    assert excerpt('needle', '') == ''
    assert excerpt('needle', 'short text') == 'short text'


# --------------------------------------------------------------------------- endpoint

@pytest.fixture()
def client(tmp_path):
    app = create_app(database=tmp_path / 'search.db', adapter=FakeAdapter())
    with TestClient(app) as test_client:
        yield test_client


def test_search_route_is_registered(client):
    paths = client.get('/openapi.json').json()['paths']
    assert '/api/search' in paths


def test_short_query_returns_nothing(client):
    body = client.get('/api/search', params={'q': 'a'}).json()
    assert body['results'] == []
    assert body['query'] == 'a'
    assert body['groups'] == {}


def test_finds_a_task_by_prompt(client):
    client.post('/api/tasks', json={'prompt': 'Reconcile the ownership ledger'})
    body = client.get('/api/search', params={'q': 'ownership'}).json()
    assert 'task' in {r['kind'] for r in body['results']}
    task = next(r for r in body['results'] if r['kind'] == 'task')
    assert task['deeplink']['intent'] == 'openTask'
    assert task['deeplink']['args']['destination'] == 'work'
    assert task['deeplink']['args']['taskId']


def test_finds_a_goal_and_maps_to_the_goals_workview(client):
    client.post('/api/goals', json={'title': 'Ownership audit',
                                    'prompt': 'Audit the ownership records', 'priority': 50})
    body = client.get('/api/search', params={'q': 'ownership'}).json()
    goal = next((r for r in body['results'] if r['kind'] == 'goal'), None)
    assert goal is not None
    assert goal['deeplink']['args']['workView'] == 'goals'
    assert goal['deeplink']['args']['selection']['kind'] == 'goal'


def test_results_are_bounded_by_limit(client):
    for i in range(8):
        client.post('/api/tasks', json={'prompt': f'ownership note number {i}'})
    body = client.get('/api/search', params={'q': 'ownership', 'limit': 3}).json()
    assert len(body['results']) <= 3


def test_project_scope_excludes_sources_without_a_project(client):
    client.post('/api/tasks', json={'prompt': 'Reconcile the ownership ledger'})
    client.post('/api/goals', json={'title': 'Ownership audit',
                                    'prompt': 'Audit the ownership records', 'priority': 50})
    body = client.get('/api/search', params={'q': 'ownership', 'project_id': 'no-such-project'}).json()
    assert all(r['kind'] not in ('task', 'goal') for r in body['results'])


def test_unreachable_vault_is_reported_not_hidden(client):
    # conftest points HERMES_LIFE_OBSIDIAN_VAULT at a path that does not exist.
    body = client.get('/api/search', params={'q': 'ownership'}).json()
    assert any(d.startswith('vault') for d in body['degraded'])
