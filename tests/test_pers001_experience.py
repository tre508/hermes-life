"""HL-PERS-001 §2 layer 2 / §3 Experience collection — an experience is a terminal task outcome.

"Experience" is the store the spec's second personality layer counts. It must reflect work the user can
see the outcome of — a completed, failed or cancelled task — and nothing else. Internal analysis passes
(criteria compilation, adjudication, memory extraction) and reflections are diagnostics and must not
inflate it. These tests are hermetic: a fake delegate stands in for the worker.
"""
from hermes_life.app import Runtime
from hermes_life.schema import migrate


class FakeAdapter:
    transport = 'ssh'

    def __init__(self, error=None):
        self.error = error
        self.prompts = []

    def available(self): return True
    def _ssh_base(self): return ['ssh', 'guest']

    def run(self, prompt, callback, task_id=None):
        self.prompts.append(prompt)
        if self.error:
            raise self.error
        return {'result': 'ok', 'session_id': 's'}

    def cancel(self, task_id):
        return True


def _runtime(tmp_path, adapter=None):
    runtime = Runtime(tmp_path / 'experience.db', adapter or FakeAdapter())
    with runtime.store.lock:
        migrate(runtime.store.connection)
    return runtime


def _enqueue(runtime, ident, prompt='do the thing'):
    with runtime.store.lock:
        runtime.store.connection.execute(
            'INSERT INTO tasks(id,prompt,state,created_at,updated_at) VALUES(?,?,?,?,?)',
            (ident, prompt, 'queued', 'now', 'now'))
        runtime.store.connection.commit()


def _run(runtime, ident):
    runtime.active.acquire()          # run_task releases the slot its caller owns
    runtime.run_task(ident)


def test_two_terminal_tasks_are_two_experiences(tmp_path):
    runtime = _runtime(tmp_path)
    for ident in ('a', 'b'):
        _enqueue(runtime, ident)
        _run(runtime, ident)
    assert runtime.personality.get()['experience_count'] == 2
    assert [row['state'] for row in runtime.personality.experiences(5)] == ['completed', 'completed']


def test_a_failed_task_is_recorded_as_a_failed_experience(tmp_path):
    runtime = _runtime(tmp_path, FakeAdapter(error=RuntimeError('worker exploded')))
    _enqueue(runtime, 'f')
    _run(runtime, 'f')
    rows = runtime.personality.experiences(5)
    assert len(rows) == 1
    assert rows[0]['state'] == 'failed'
    assert 'worker exploded' in rows[0]['note']


def test_internal_passes_do_not_add_experience(tmp_path):
    runtime = _runtime(tmp_path)
    _enqueue(runtime, 'a')
    _run(runtime, 'a')
    # A persona-free analysis pass (the judge/extractor chain) is one of the internal calls that used to
    # be counted as experience simply because a run had happened.
    runtime.analysis_adapters['read_only'].run('judge this', lambda *_: None)
    assert runtime.personality.get()['experience_count'] == 1
    with runtime.store.lock:
        runs = runtime.store.connection.execute('SELECT COUNT(*) FROM reflective_runs').fetchone()[0]
    assert runs == 1, 'the analysis pass must not create a reflective run either'


def test_a_cancelled_task_counts_once_even_if_recorded_twice(tmp_path):
    runtime = _runtime(tmp_path)
    _enqueue(runtime, 'c')
    runtime.record_experience('c', 'cancelled', 'Cancelled by user')
    runtime.record_experience('c', 'cancelled', 'Cancelled by user')   # idempotent: one row per task
    assert runtime.personality.get()['experience_count'] == 1
    assert runtime.personality.experiences(5)[0]['state'] == 'cancelled'


def test_experience_rows_name_their_task_and_goal(tmp_path):
    runtime = _runtime(tmp_path)
    _enqueue(runtime, 'g')
    with runtime.store.lock:
        runtime.store.connection.execute(
            "INSERT INTO goals(id,title,prompt,state,priority,created_at,updated_at,task_id)"
            " VALUES('goal','Investigate','Inspect','running',40,'now','now','g')")
        runtime.store.connection.commit()
    _run(runtime, 'g')
    row = runtime.personality.experiences(5)[0]
    assert row['task_id'] == 'g' and row['goal_id'] == 'goal'


def test_experience_failure_never_changes_the_task_state(tmp_path, monkeypatch):
    """Bookkeeping must not turn a completed task into a failed one."""
    runtime = _runtime(tmp_path)
    _enqueue(runtime, 'a')

    def boom(*args, **kwargs):
        raise RuntimeError('experience store unavailable')

    monkeypatch.setattr(runtime.personality, 'record_experience', boom)
    _run(runtime, 'a')                                   # recording raises; the task must still complete
    task = runtime.store.task('a')
    assert task is not None and task['state'] == 'completed'
    kinds = [e['type'] for e in runtime.store.events(0)]
    assert 'experience.record_failed' in kinds
