"""UI-VIS-002: the events endpoint can return the NEWEST events, not only the oldest ones.

Without this a client that wants "recent activity, then live" has to read the whole log from
sequence 0 and then replay tens of thousands of historical events before any live event arrives.
"""
import time

from fastapi.testclient import TestClient

from hermes_life.app import create_app


class FakeAdapter:
    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        callback('hermes.tool_use', {'name': 'test_tool', 'input': {'prompt': prompt}})
        return {'result': 'Test complete', 'session_id': 'fake-session'}

    def cancel(self, task_id):
        return True


def _quiet_log(client, limit=500, tries=60):
    """Read the log until its head stops moving: background subsystems emit on their own."""
    previous = None
    events: list = []
    for _ in range(tries):
        events = client.get(f'/api/events?limit={limit}').json()
        head = events[-1]['sequence'] if events else 0
        if head == previous:
            return events
        previous = head
        time.sleep(.05)
    return events


def test_tail_returns_the_newest_events_in_chronological_order(tmp_path):
    client = TestClient(create_app(database=tmp_path / 'life.db', adapter=FakeAdapter()))
    client.__enter__()
    response = client.post('/api/tasks', json={'prompt': 'Say hello'})
    assert response.status_code == 202
    task_id = response.json()['id']
    for _ in range(200):
        if client.get(f'/api/tasks/{task_id}').json()['state'] == 'completed':
            break
        time.sleep(.01)

    log = _quiet_log(client)
    assert len(log) >= 4

    oldest = client.get('/api/events?limit=2').json()
    newest = client.get('/api/events?tail=2').json()

    assert [e['sequence'] for e in oldest] == [e['sequence'] for e in log[:2]], 'default still oldest-first'
    assert [e['sequence'] for e in newest] == sorted(e['sequence'] for e in newest), 'ascending'
    assert len(newest) == 2
    assert newest[0]['sequence'] > oldest[-1]['sequence']

    # Real-time semantics: the newest event the tail returns is the newest event in the log.
    tail_one = client.get('/api/events?tail=1').json()
    assert [e['sequence'] for e in tail_one] == [log[-1]['sequence']]

    # A tail wider than the log returns the whole log, and nothing changed for existing callers.
    assert [e['sequence'] for e in client.get('/api/events?tail=500').json()] == [e['sequence'] for e in log]
    assert [e['sequence'] for e in client.get('/api/events?limit=3').json()] == [e['sequence'] for e in log[:3]]
    assert client.get('/api/events?tail=0&limit=400').json()[-1]['sequence'] == log[-1]['sequence']
    client.__exit__(None, None, None)
