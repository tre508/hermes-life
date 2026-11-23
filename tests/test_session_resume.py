"""convo-redesign.md §10 — continuing a conversation's Hermes CLI session.

The CLI supports ``hermes chat --resume <id|latest>``; Hermes Life already
records the session id the CLI reports on exit onto ``tasks.session_id``. These
tests cover the two pieces that were missing: the command builders accepting a
resume target, and resolving a conversation's most recent session.

They are hermetic — no worker, no CLI. The live behaviour (that a resumed
session really carries its earlier turns) is verified against the real worker.
"""
import subprocess
import time

import pytest
from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.conversation_memory import ConversationMemory
from hermes_life.hermes_adapter import _agent_command, remote_script
from hermes_life.schema import migrate
from hermes_life.store import Store


# ---------------------------------------------------------------- command builders

def test_no_resume_flag_by_default():
    """Existing behaviour is untouched when no session is given."""
    assert '--resume' not in _agent_command()
    assert '--resume' not in remote_script('interactive')


def test_resume_flag_is_added_for_the_guest_command():
    command = _agent_command(resume='session-abc123')
    assert '--resume session-abc123' in command


def test_resume_is_added_to_the_guest_script():
    script = remote_script('interactive', resume='session-abc123')
    assert '--resume session-abc123' in script
    # The prompt is still read from the guest-side file, not the command line.
    assert '--query-file "$prompt_file"' in script


def test_resume_is_quoted_so_a_title_cannot_inject_shell():
    # `--resume` also accepts a session *title*, so the value is not always a
    # bare uuid. It must survive as a single shell word.
    script = remote_script('interactive', resume='my session; rm -rf /tmp/x')
    assert 'rm -rf' in script.split('--resume')[1]      # present as data
    proc = subprocess.run(['sh', '-n'], input=script, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    assert '--resume \'my session; rm -rf /tmp/x\'' in script


def test_resume_composes_with_toolsets_provider_and_model():
    script = remote_script('read_only', provider='openrouter', model='m/x', resume='s1')
    assert '--resume s1' in script
    assert ' -t file,web,vision' in script
    assert '--provider openrouter' in script
    assert '--model m/x' in script


# ---------------------------------------------------------------- session resolution

@pytest.fixture()
def conversations(tmp_path):
    store = Store(str(tmp_path / 'hl.sqlite3'))
    migrate(store.connection)
    return store, ConversationMemory(store)


def _task_with_session(store, task_id, session_id, created_at):
    store.connection.execute(
        'INSERT INTO tasks (id,prompt,state,created_at,updated_at,session_id) VALUES (?,?,?,?,?,?)',
        (task_id, 'p', 'completed', created_at, created_at, session_id))
    store.connection.commit()


def test_returns_the_most_recent_session_in_the_conversation(conversations):
    store, memory = conversations
    cid = memory.add_user_turn('first', None, 't1')
    _task_with_session(store, 't1', 'sess-1', '2026-01-01T00:00:00')
    memory.add_user_turn('second', cid, 't2')
    _task_with_session(store, 't2', 'sess-2', '2026-01-02T00:00:00')

    assert memory.latest_session_id(cid, exclude_task='t3') == 'sess-2'


def test_excludes_the_task_being_run_so_a_task_never_resumes_itself(conversations):
    store, memory = conversations
    cid = memory.add_user_turn('only', None, 't1')
    _task_with_session(store, 't1', 'sess-1', '2026-01-01T00:00:00')

    assert memory.latest_session_id(cid, exclude_task='t1') is None


def test_ignores_tasks_without_a_recorded_session(conversations):
    store, memory = conversations
    cid = memory.add_user_turn('no session', None, 't1')
    _task_with_session(store, 't1', '', '2026-01-01T00:00:00')

    assert memory.latest_session_id(cid) is None


def test_unknown_and_empty_conversations_resolve_to_none(conversations):
    _, memory = conversations
    assert memory.latest_session_id(None) is None
    assert memory.latest_session_id('') is None
    assert memory.latest_session_id('11111111-2222-3333-4444-555555555555') is None


def test_sessions_do_not_leak_across_conversations(conversations):
    store, memory = conversations
    a = memory.add_user_turn('a', None, 't1')
    _task_with_session(store, 't1', 'sess-a', '2026-01-01T00:00:00')
    b = memory.add_user_turn('b', None, 't2')
    _task_with_session(store, 't2', 'sess-b', '2026-01-02T00:00:00')

    assert memory.latest_session_id(a) == 'sess-a'
    assert memory.latest_session_id(b) == 'sess-b'


# ---------------------------------------------------------------- run_task wiring

class StrictAdapter:
    """Accepts ONLY the documented adapter signature — no **kwargs.

    run_task must not pass `resume` when there is nothing to resume. An
    unconditional `resume=None` raises TypeError here, which the runner swallows
    into a failed task: a silent, total regression that no unit test of the
    builders would catch.
    """
    def __init__(self): self.prompts = []

    def available(self): return True

    def run(self, prompt, callback, task_id=None):
        self.prompts.append(prompt)
        return {'result': 'ok', 'session_id': 'sess-x'}

    def cancel(self, task_id): return True


class ResumeRecordingAdapter(StrictAdapter):
    """Same, but tolerant enough to record the resume target when it is passed."""
    def __init__(self):
        super().__init__()
        self.resumes = []

    def run(self, prompt, callback, task_id=None, **kwargs):
        self.resumes.append(kwargs.get('resume'))
        return super().run(prompt, callback, task_id)


def _run_to_terminal(client, task_id, attempts=60):
    state = 'queued'
    for _ in range(attempts):
        state = client.get(f'/api/tasks/{task_id}').json()['state']
        if state not in ('queued', 'running'):
            return state
        time.sleep(0.1)
    return state


def test_a_task_completes_against_a_strict_adapter(tmp_path):
    """The default path must not change the adapter call shape at all."""
    adapter = StrictAdapter()
    with TestClient(create_app(database=tmp_path / 'life.db', adapter=adapter)) as client:
        created = client.post('/api/tasks', json={'prompt': 'do a thing'})
        assert created.status_code in (200, 202), created.text
        assert _run_to_terminal(client, created.json()['id']) == 'completed'
        assert adapter.prompts and 'do a thing' in adapter.prompts[0]


def test_an_explicit_resume_target_reaches_the_adapter(tmp_path):
    adapter = ResumeRecordingAdapter()
    with TestClient(create_app(database=tmp_path / 'life.db', adapter=adapter)) as client:
        created = client.post('/api/tasks',
                              json={'prompt': 'continue', 'resume_session_id': 'sess-prev'})
        assert created.status_code in (200, 202), created.text
        assert _run_to_terminal(client, created.json()['id']) == 'completed'
        # The task run is the first call; later calls are Hermes Life's own
        # internal passes (memory extraction, reflection), which must NOT resume.
        assert adapter.resumes[0] == 'sess-prev', adapter.resumes
        assert all(r is None for r in adapter.resumes[1:]), adapter.resumes


def test_a_follow_up_without_the_flag_does_not_resume(tmp_path, monkeypatch):
    """HERMES_LIFE_RESUME_SESSIONS is off by default, so nothing is resumed."""
    monkeypatch.delenv('HERMES_LIFE_RESUME_SESSIONS', raising=False)
    adapter = ResumeRecordingAdapter()
    with TestClient(create_app(database=tmp_path / 'life.db', adapter=adapter)) as client:
        first = client.post('/api/tasks', json={'prompt': 'first'})
        assert _run_to_terminal(client, first.json()['id']) == 'completed'
        cid = client.get(f"/api/tasks/{first.json()['id']}").json().get('conversation_id')
        assert cid, 'a task must be linked to a conversation'
        second = client.post('/api/tasks', json={'prompt': 'second', 'conversation_id': cid})
        assert _run_to_terminal(client, second.json()['id']) == 'completed'
        # Two task runs happened (plus internal passes) and not one of them
        # resumed a session while the flag is off.
        assert len(adapter.resumes) >= 2, adapter.resumes
        assert all(r is None for r in adapter.resumes), adapter.resumes
