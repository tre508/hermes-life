"""HL-AUTO-004: an approval scope must be a capability, not a label.

A scope is expressed by which adapter chain a call site holds, and is enforced on
the guest by an explicit session toolset pin — never by prompt text. These tests are
hermetic. The live measurements, and the limits of what this CLI surface can
enforce, are recorded in FIX.md FIX-001.
"""
import subprocess
import threading

import pytest

from hermes_life.app import Runtime
from hermes_life.hermes_adapter import (GUEST_HERMES, PROFILES, READ_ONLY_TOOLSETS,
                                        HermesAdapter, HermesError, remote_script)
from hermes_life.schema import migrate


class FakeAdapter:
    transport = 'ssh'

    def available(self): return True
    def run(self, prompt, callback, task_id=None): return {'result': 'ok', 'session_id': 's'}
    def cancel(self, task_id):
        return True


class Recorder:
    """Stands in for one capability chain so a test can prove which one was used."""
    def __init__(self): self.calls = []
    def run(self, prompt, callback, task_id=None):
        self.calls.append(prompt)
        return {'result': 'recorded', 'session_id': 's'}
    def cancel(self, task_id):
        return True


def _runtime(tmp_path):
    runtime = Runtime(tmp_path / 'scope.db', FakeAdapter())
    with runtime.store.lock:
        migrate(runtime.store.connection)
    return runtime


def _seed(store, task_id='t', formulation_state='approved', goal_id='g'):
    """Seed the durable lineage the scope is derived from."""
    with store.lock:
        con = store.connection
        con.execute('INSERT INTO tasks(id,prompt,state,created_at,updated_at) VALUES(?,?,?,?,?)',
                    (task_id, 'Inspect the marker', 'completed', 'now', 'now'))
        con.execute('INSERT INTO goals(id,title,prompt,state,priority,created_at,updated_at,task_id) '
                    'VALUES(?,?,?,?,?,?,?,?)',
                    (goal_id, 'Investigate', 'Inspect', 'completed', 40, 'now', 'now', task_id))
        con.execute('INSERT INTO formulated_goals(id,discovery_id,title,action,rationale,acceptance,'
                    'prompt,priority,state,goal_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                    ('f', 'd', 'Investigate', 'research', 'why', '["a"]', 'p', 40,
                     formulation_state, goal_id, 'now', 'now'))
        con.commit()


def _events(runtime, kind):
    return [e for e in runtime.store.events(0) if e['type'] == kind]


# --- the capability itself ---------------------------------------------------

def test_read_only_scope_pins_a_toolset_without_shell_or_code_execution():
    script = remote_script('read_only')
    assert '-t ' + READ_ONLY_TOOLSETS in script
    # The pin is what removes the capability, so the default must not carry it.
    assert ' -t ' not in remote_script('interactive')
    for capability in ('terminal', 'code_execution', 'delegate_task'):
        assert capability not in script


def test_read_only_keeps_the_transport_shape_of_the_default_profile():
    script = remote_script('read_only')
    # Only the toolset pin may differ: prompt still arrives over stdin into a guest
    # temp file, still streamed as JSONL, still cleaned up on exit.
    for fragment in ('cat > "$prompt_file"', '--format stream-json',
                     "trap 'rm -f \"$prompt_file\"' EXIT", 'umask 077'):
        assert fragment in script
    assert GUEST_HERMES + ' chat --query-file "$prompt_file"' in script
    # The pin is the *only* difference from the default profile.
    assert script.replace(' -t ' + READ_ONLY_TOOLSETS, '') == remote_script('interactive')


@pytest.mark.parametrize('profile', sorted(PROFILES))
def test_every_profile_script_is_valid_shell(profile):
    proc = subprocess.run(['sh', '-n'], input=remote_script(profile),
                          text=True, capture_output=True, timeout=20)
    assert proc.returncode == 0, proc.stderr


def test_unknown_profile_is_rejected():
    with pytest.raises(ValueError):
        remote_script('root')
    with pytest.raises(ValueError):
        HermesAdapter(profile='root')


# --- fail closed ------------------------------------------------------------

def test_read_only_refuses_the_local_transport(monkeypatch):
    """The legacy local transport cannot apply the pin, so it must not run."""
    monkeypatch.setattr(HermesAdapter, 'available', lambda self: True)
    adapter = HermesAdapter(transport='local', profile='read_only')
    with pytest.raises(HermesError, match='requires the isolated VM transport'):
        adapter.run('prompt', lambda *_: None)


def test_interactive_local_transport_still_runs(monkeypatch):
    monkeypatch.setattr(HermesAdapter, 'available', lambda self: True)
    captured = {}
    def fake_execute(self, command, prompt_stdin, event_callback, task_id=None):
        captured['command'] = list(command)
        return {'result': 'ok'}
    monkeypatch.setattr(HermesAdapter, '_execute', fake_execute)
    assert HermesAdapter(transport='local').run('hello', lambda *_: None) == {'result': 'ok'}
    assert captured['command'][0] == 'hermes'


# --- scope selection --------------------------------------------------------

def test_runtime_holds_one_chain_per_capability_scope(tmp_path):
    runtime = Runtime(tmp_path / 'chains.db')
    assert set(runtime.adapters) == set(PROFILES)
    assert runtime.adapter is runtime.adapters['interactive']
    # The scope reaches the real adapter that builds the guest script.
    assert runtime.adapters['read_only'].delegate.delegate.profile == 'read_only'


def test_scope_follows_the_approval_not_the_prompt_text(tmp_path):
    runtime = _runtime(tmp_path)
    _seed(runtime.store)
    assert runtime.task_scope('t') == 'read_only'
    for state in ('proposed', 'deferred', 'dismissed'):
        with runtime.store.lock:
            runtime.store.connection.execute('UPDATE formulated_goals SET state=?', (state,))
            runtime.store.connection.commit()
        assert runtime.task_scope('t') == 'interactive'
    with runtime.store.lock:
        runtime.store.connection.execute('DELETE FROM formulated_goals')
        runtime.store.connection.commit()
    assert runtime.task_scope('t') == 'interactive'


def test_read_only_task_records_its_scope_and_uses_the_restricted_chain(tmp_path):
    runtime = _runtime(tmp_path)
    _seed(runtime.store)
    recorder = Recorder()
    runtime.adapters['read_only'] = recorder  # type: ignore[assignment]  # test double
    runtime.active.acquire()          # run_task releases the slot its caller owns
    runtime.run_task('t')
    assert recorder.calls, 'the read-only chain was not the one invoked'
    task = runtime.store.task('t')
    assert task is not None and task['result'] == 'recorded'
    assert _events(runtime, 'task.started')[-1]['payload']['scope'] == 'read_only'


def test_manual_task_keeps_the_interactive_chain(tmp_path):
    runtime = _runtime(tmp_path)
    with runtime.store.lock:
        runtime.store.connection.execute(
            'INSERT INTO tasks(id,prompt,state,created_at,updated_at) VALUES(?,?,?,?,?)',
            ('m', 'say hi', 'queued', 'now', 'now'))
        runtime.store.connection.commit()
    recorder = Recorder()
    runtime.adapters['interactive'] = recorder  # type: ignore[assignment]  # test double
    runtime.active.acquire()
    runtime.run_task('m')
    assert recorder.calls
    assert _events(runtime, 'task.started')[-1]['payload']['scope'] == 'interactive'


def test_read_only_workspace_context_does_not_authorise_edits(tmp_path):
    runtime = _runtime(tmp_path)
    with runtime.store.lock:
        runtime.store.connection.execute(
            "INSERT INTO hl_projects(name,host_path,vm_path,commit_hash) "
            "VALUES('demo','/tmp/demo','/home/hermes/workspaces/demo/abc','abc')")
        runtime.store.connection.commit()
    workspace = runtime.project_workspaces
    assert 'READ-ONLY' in workspace.context('demo', read_only=True)
    assert 'You may investigate, modify' not in workspace.context('demo', read_only=True)
    assert 'You may investigate, modify' in workspace.context('demo')
