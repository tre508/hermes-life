"""Durable reasoning/tool traces: the CLI session store is the record of record.

The chat renders reasoning interleaved with tool calls from the worker's own
transcript (hermes_adapter._trace_steps). These tests pin the mapping rules and
the /api/chat/trace route contract.
"""
import json

import pytest
from fastapi.testclient import TestClient

from hermes_life.hermes_adapter import _trace_steps
from hermes_life.app import create_app


class _TraceAdapter:
    def __init__(self, steps):
        self._steps = steps

    def available(self):
        return True

    def session_trace(self, session_id):
        return self._steps

    def run(self, prompt, callback, task_id=None):
        return {'result': 'ok', 'session_id': 'fake-session'}


def _row(role, content='', reasoning=None, tool_calls=None, tool_name=None,
         timestamp=None, tool_call_id=None):
    return {'role': role, 'content': content, 'reasoning': reasoning,
            'tool_calls': tool_calls, 'tool_name': tool_name,
            'timestamp': timestamp, 'tool_call_id': tool_call_id}


def test_reasoning_interleaves_with_tool_calls():
    rows = [
        _row('assistant', reasoning='Plan the approach.',
             tool_calls=json.dumps([{'id': 'c1', 'function': {
                 'name': 'terminal', 'arguments': json.dumps({'command': 'ls'})}}]),
             timestamp=100.0),
        _row('tool', tool_call_id='c1',
             content=json.dumps({'output': 'file.txt'}), timestamp=102.5),
        _row('assistant', reasoning='Now read the file.',
             tool_calls=json.dumps([{'id': 'c2', 'function': {
                 'name': 'read_file', 'arguments': json.dumps({'path': 'x'})}}]),
             timestamp=103.0),
        _row('tool', tool_call_id='c2',
             content=json.dumps({'content': 'the text'}), timestamp=104.0),
        _row('assistant', content='The final answer.', timestamp=105.0),
    ]
    steps = _trace_steps(rows)
    assert [s['kind'] for s in steps] == ['thought', 'tool', 'thought', 'tool']
    assert steps[0]['text'] == 'Plan the approach.'
    assert steps[1]['label'] == 'terminal'
    assert steps[1]['result'] == 'file.txt'
    assert steps[1]['ms'] == pytest.approx(2.5)
    assert steps[3]['result'] == 'the text'
    # The answer belongs to the bubble, not the trace.
    assert all('final answer' not in json.dumps(s) for s in steps)


def test_one_shot_reasoning_on_the_final_row_is_a_thought_step():
    # The tool-less shape: user prompt, then ONE assistant row carrying both
    # the reasoning and the final answer (regression 2026-11-26 — new single-turn
    # conversations rendered with no trace at all because the mapper broke at
    # final_index before reading that row's reasoning).
    rows = [
        _row('user', content='how would they recover files?', timestamp=1.0),
        _row('assistant', reasoning='Think about recovery options…',
             content='The final answer text.', timestamp=2.0),
    ]
    steps = _trace_steps(rows)
    assert [s['kind'] for s in steps] == ['thought']
    assert steps[0]['text'] == 'Think about recovery options…'
    # The answer text itself must still stay out of the trace.
    assert all('final answer' not in json.dumps(s) for s in steps)


def test_unmatched_result_attaches_in_call_order():
    rows = [
        _row('assistant', tool_calls=json.dumps([
            {'id': 'a', 'function': {'name': 'one', 'arguments': '{}'}},
            {'id': 'b', 'function': {'name': 'two', 'arguments': '{}'}}]), timestamp=1.0),
        _row('tool', tool_call_id='b', content=json.dumps({'output': 'second'}), timestamp=2.0),
        _row('tool', tool_call_id='a', content=json.dumps({'output': 'first'}), timestamp=3.0),
    ]
    steps = _trace_steps(rows)
    assert [s['result'] for s in steps] == ['first', 'second']


def test_narration_between_calls_is_a_step():
    rows = [
        _row('assistant', content='Checking the schema first.',
             tool_calls=json.dumps([{'id': 'c', 'function': {'name': 'terminal', 'arguments': '{}'}}]),
             timestamp=1.0),
        _row('tool', tool_call_id='c', content='ok', timestamp=2.0),
        _row('assistant', content='Done, here is the summary.', timestamp=3.0),
    ]
    steps = _trace_steps(rows)
    assert [s['kind'] for s in steps] == ['text', 'tool']
    assert steps[0]['text'] == 'Checking the schema first.'


def test_malformed_rows_are_skipped():
    rows = [
        _row('assistant', reasoning='think', tool_calls='not json', timestamp=1.0),
        _row('tool', content=json.dumps({'output': 'orphan'})),  # result with no pending call
        _row('assistant', content='answer', timestamp=2.0),
    ]
    steps = _trace_steps(rows)
    assert [s['kind'] for s in steps] == ['thought']


def test_empty_and_garbage_inputs_yield_no_steps():
    assert _trace_steps([]) == []
    assert _trace_steps([_row('user', content='hello')]) == []


class _NoTraceAdapter:
    """An adapter from before the trace feature — the route must not 500."""

    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        return {'result': 'ok', 'session_id': 'fake-session'}


def _completed_task(client):
    response = client.post('/api/tasks', json={'prompt': 'Say hello'})
    assert response.status_code == 202
    task_id = response.json()['id']
    for _ in range(200):
        if client.get(f'/api/tasks/{task_id}').json()['state'] == 'completed':
            break
    return task_id


def test_trace_route_serves_adapter_steps(tmp_path):
    steps = [{'kind': 'thought', 'text': 'Thinking.'},
             {'kind': 'tool', 'label': 'terminal', 'args': {'command': 'ls'}, 'result': 'out'}]
    client = TestClient(create_app(database=tmp_path / 'life.db', adapter=_TraceAdapter(steps)))
    client.__enter__()
    task_id = _completed_task(client)
    data = client.get(f'/api/chat/trace/{task_id}').json()
    assert data['steps'] == steps
    assert data['session_id']
    client.__exit__(None, None, None)


def test_trace_route_tolerates_an_adapter_without_the_feature(tmp_path):
    client = TestClient(create_app(database=tmp_path / 'life.db', adapter=_NoTraceAdapter()))
    client.__enter__()
    task_id = _completed_task(client)
    data = client.get(f'/api/chat/trace/{task_id}').json()
    assert data['steps'] == []
    client.__exit__(None, None, None)


def test_trace_route_unknown_task_is_404(tmp_path):
    client = TestClient(create_app(database=tmp_path / 'life.db', adapter=_NoTraceAdapter()))
    client.__enter__()
    assert client.get('/api/chat/trace/nope').status_code == 404
    client.__exit__(None, None, None)