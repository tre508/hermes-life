"""HA-030 — memory provenance and yield: extraction must record how sure it is, reasonable
candidates must stop dying in the validators, and the correction flow must actually write rows.

The live database drove these bounds (156 extraction runs): of 129 candidates, 50 died as
evidence_not_verbatim, 51 task lessons as task_lesson_evidence and 24 as invalid_lengths;
confidence was NULL on every stored memory; hl_memory_corrections was empty despite a full API;
and the episodic/relational stores sat at 2/1 rows with no recorded reason for anything else.
Each test pins one part of the fix: provenance is populated at write from a documented
heuristic, a decorated quote still counts as verbatim while a paraphrase does not, the loosened
bounds admit reasonable material but not junk, episodic and relational candidates from real
task evidence now land in their stores with honest rejection accounting, and a correction
writes an hl_memory_corrections row and marks the memory.

The modules under test are constructed directly over a minimal fake store (the
tests/test_project_file_ops.py pattern); the one HTTP test exercises the real correction route
because that is the flow being proven.
"""
import json
import sqlite3
import threading

from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.autonomous_memory import AutonomousMemory
from hermes_life.conversation_recall import Recall
from hermes_life.extended_memory import EpisodicMemory, RelationalMemory
from hermes_life.vault_memory import VaultMemory, evidence_confidence

USER = ('Please always use ripgrep instead of grep for repo searches, it is much faster on '
        'big trees.')
ANSWER = 'Done — the suite ran and all 120 tests passed; the fix was verified end to end.'
LONG_USER = (USER + ' Also always run the full test suite before you say a change is done, '
             'and never skip it.')
OLD = 'Prefer verbose explanations with exhaustive background.'
NEW = 'Prefer terse answers that lead with the answer.'


class FakeStore:
    """Minimal store per tests/test_project_file_ops.py — what the memory managers touch."""

    def __init__(self):
        self.lock = threading.RLock()
        self.connection = sqlite3.connect(':memory:')
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript(
            'CREATE TABLE tasks (id TEXT PRIMARY KEY, prompt TEXT, state TEXT,'
            ' created_at TEXT, updated_at TEXT);'
            'CREATE TABLE hl_conversation_turns (id INTEGER PRIMARY KEY AUTOINCREMENT,'
            ' conversation_id TEXT, task_id TEXT, role TEXT, content TEXT, created_at TEXT);'
            'CREATE TABLE hl_turn_revisions (id TEXT PRIMARY KEY, conversation_id TEXT,'
            ' original_turn_id INTEGER, revised_content TEXT, task_id TEXT, created_at TEXT);')
        self.events: list[tuple[str, dict]] = []

    def emit(self, kind, payload, task_id=None, **links):
        self.events.append((kind, payload))


class Scripted:
    """Extraction adapter that answers with a canned proposal object."""

    def __init__(self, result):
        self.result = result

    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        return {'result': json.dumps(self.result)}

    def cancel(self, task_id):
        return True


class FormationAdapter:
    """Answers the episodic and relational formation prompts with canned candidates."""

    def __init__(self, episodic=(), relational=()):
        self.episodic = list(episodic)
        self.relational = list(relational)

    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        if 'EXISTING EPISODIC MEMORIES' in prompt:
            return {'result': json.dumps({'candidates': self.episodic})}
        return {'result': json.dumps({'candidates': self.relational})}

    def cancel(self, task_id):
        return True


class IdleAdapter:
    """A worker that answers nothing: the correction flow is the behaviour under test."""

    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        return {'result': 'ok', 'session_id': 's'}

    def cancel(self, task_id):
        return True


def seed_turn(store, task_id='t1', user=USER, answer=ANSWER):
    with store.lock:
        con = store.connection
        con.execute("INSERT INTO tasks(id,prompt,state,created_at,updated_at)"
                    " VALUES(?,'x','completed','1','1')", (task_id,))
        for role, content, when in (('user', user, '1'), ('assistant', answer, '2')):
            con.execute('INSERT INTO hl_conversation_turns(conversation_id,task_id,role,content,created_at)'
                        " VALUES('c1',?,?,?,?)", (task_id, role, content, when))
        con.commit()


def run_extraction(tmp_path, result, user=USER, answer=ANSWER, task_id='t1'):
    """VaultMemory over the fake store; returns (store, count of memories stored)."""
    store = FakeStore()
    seed_turn(store, task_id, user, answer)
    vault = VaultMemory(store, Recall(store), adapter=Scripted(result))
    vault.vault = tmp_path / 'no-vault-here'
    return store, vault.extract_completed('c1', task_id)


def run_note(store, task_id='t1'):
    row = store.connection.execute(
        'SELECT note FROM hl_memory_extraction_runs WHERE task_id=?', (task_id,)).fetchone()
    return json.loads(row['note'])


def autonomous(tmp_path, episodic=(), relational=(), user=USER, answer=ANSWER, task_id='t1'):
    store = FakeStore()
    seed_turn(store, task_id, user, answer)
    memory = AutonomousMemory(store, EpisodicMemory(store), RelationalMemory(store),
                              adapter=FormationAdapter(episodic, relational))
    return store, memory


def formation_summary(store, task_id='t1'):
    matches = [payload for kind, payload in store.events
               if kind == 'autonomous_memory.formation_summary' and payload['task_id'] == task_id]
    assert matches, 'no formation summary was recorded'
    return matches[-1]


# ---- provenance at write ----------------------------------------------------

def test_extraction_populates_confidence_and_origin_at_write(tmp_path):
    result = {'candidates': [
        {'kind': 'preference', 'memory': 'Prefer ripgrep over grep for repository searches.',
         'evidence': 'always use ripgrep instead of grep for repo searches, it is much faster '
                     'on big trees',
         'origin': 'explicit', 'relation': 'new'},
        {'kind': 'workflow', 'memory': 'Run the full test suite before calling a change done.',
         'evidence': 'never skip it', 'origin': 'inferred', 'relation': 'new'},
    ]}
    store, made = run_extraction(tmp_path, result, user=LONG_USER)
    assert made == 2
    rows = {r['content']: dict(r) for r in store.connection.execute('SELECT * FROM hl_memories')}
    explicit = rows['Prefer ripgrep over grep for repository searches.']
    inferred = rows['Run the full test suite before calling a change done.']
    assert explicit['origin'] == 'explicit' and explicit['evidence_excerpt']
    assert inferred['origin'] == 'inferred'
    for row in (explicit, inferred):
        assert row['confidence'] is not None, 'confidence must be populated at write'
        assert 0.30 <= row['confidence'] <= 0.95
    assert explicit['confidence'] > inferred['confidence'], \
        'a user statement with a self-supporting quote must outrank an inference on a short one'


def test_the_confidence_heuristic_is_bounded_and_never_certain():
    assert evidence_confidence('explicit', 'x' * 80, 'c') == 0.90
    assert evidence_confidence('explicit', 'short quote', 'c') == 0.80
    assert evidence_confidence('inferred', 'x' * 80, 'c') == 0.65
    assert evidence_confidence('inferred', 'short quote', 'c') == 0.55
    assert evidence_confidence('inferred', '', '') == 0.55


# ---- validator tuning against the recorded rejection breakdown --------------

def test_a_decorated_quote_is_still_verbatim_but_a_paraphrase_is_not(tmp_path):
    result = {'candidates': [
        {'kind': 'preference', 'memory': 'Prefer ripgrep over grep for repository searches.',
         'evidence': '\u201calways use ripgrep instead of grep for repo searches\u201d',
         'origin': 'explicit', 'relation': 'new'},
        {'kind': 'workflow', 'memory': 'Search the repository with ripgrep at all times.',
         'evidence': 'ripgrep is much faster than grep everywhere',
         'origin': 'explicit', 'relation': 'new'},
    ]}
    store, made = run_extraction(tmp_path, result)
    assert made == 1, 'a curly-quoted verbatim quote is decoration, not a paraphrase'
    note = run_note(store)
    assert note['stored'] == 1
    assert note['rejected'] == {'evidence_not_verbatim': 1}, \
        'a reworded quote must still be rejected — verbatim is the quality gate'
    row = store.connection.execute('SELECT evidence_excerpt FROM hl_memories').fetchone()
    assert 'always use ripgrep instead of grep for repo searches' in row['evidence_excerpt']


def test_loosened_length_bounds_admit_reasonable_material_but_not_junk(tmp_path):
    sentence = ('Prefer ripgrep over grep for repository searches because it respects '
                'gitignore rules and is dramatically faster on large codebases.')
    long_statement = ' '.join([sentence] * 5)
    assert 600 < len(long_statement) <= 1000, 'the fixture must exceed the old 600-char ceiling'
    result = {'candidates': [
        {'kind': 'preference', 'memory': long_statement,
         'evidence': 'much faster', 'origin': 'explicit', 'relation': 'new'},
        {'kind': 'preference', 'memory': 'Use rg.', 'evidence': 'much faster',
         'origin': 'explicit', 'relation': 'new'},
    ]}
    store, made = run_extraction(tmp_path, result)
    assert made == 1, 'a long statement with a short verbatim quote is reasonable material'
    note = run_note(store)
    assert note['stored'] == 1
    assert note['rejected'] == {'invalid_lengths': 1}, 'junk stays rejected and stays counted'
    row = store.connection.execute('SELECT content, confidence FROM hl_memories').fetchone()
    assert row['content'] == long_statement and row['confidence'] is not None


def test_a_task_lesson_accepts_a_short_summary_and_a_decorated_quote(tmp_path):
    result = {'candidates': [], 'task_lesson': {
        'summary': 'All 120 tests pass', 'evidence': '"120 tests passed"'}}
    store, made = run_extraction(tmp_path, result)
    assert made == 0, 'a task lesson is filed for review, never stored outright'
    review = store.connection.execute('SELECT * FROM hl_memory_reviews').fetchone()
    assert review['reason'] == 'task lesson awaiting verification'
    assert review['candidate'] == 'All 120 tests pass'
    assert run_note(store)['reviews'] == 1


def test_a_task_lesson_with_paraphrased_evidence_is_still_rejected(tmp_path):
    result = {'candidates': [], 'task_lesson': {
        'summary': 'Verified the build and the suite', 'evidence': 'the build passed all checks'}}
    store, made = run_extraction(tmp_path, result)
    assert made == 0
    assert store.connection.execute('SELECT COUNT(*) FROM hl_memory_reviews').fetchone()[0] == 0
    assert run_note(store)['rejected'] == {'task_lesson_evidence': 1}


# ---- episodic / relational yield with honest accounting --------------------

EPISODIC = {'kind': 'shared_discovery', 'title': 'ripgrep migration discovery',
            'summary': 'We found that ripgrep respects gitignore and cut repo search time '
                       'dramatically on big trees.',
            'context': 'The user asked for faster repo searches during the task.',
            'significance': 'A shared discovery that changed the daily workflow.',
            'retrieval_triggers': ['ripgrep', 'search']}
RELATIONAL = {'category': 'collaborative_pattern', 'title': 'Verify before claiming done',
              'context': 'The user and assistant established a pattern of re-running the checks '
                         'before declaring a change finished.',
              'significance': 'Builds trust in reported results.',
              'retrieval_triggers': ['verify']}


def test_autonomous_formation_stores_episodic_and_relational_from_task_evidence(tmp_path):
    bad = {'kind': 'not-a-kind', 'title': 'noise', 'summary': 'noise' * 10}
    store, memory = autonomous(tmp_path, episodic=[EPISODIC, bad], relational=[RELATIONAL])
    assert memory.extract_completed('c1', 't1') == 2
    assert store.connection.execute('SELECT COUNT(*) FROM hl_episodic_memories').fetchone()[0] == 1
    assert store.connection.execute('SELECT COUNT(*) FROM hl_relational_memories').fetchone()[0] == 1
    summary = formation_summary(store)
    assert summary['episodic']['candidates'] == 2 and summary['episodic']['stored'] == 1
    assert summary['episodic']['rejected'] == {'invalid_kind': 1}, \
        'a rejected candidate must be counted, not silently dropped'
    assert summary['relational']['stored'] == 1 and summary['relational']['reinforced'] == 0
    assert summary['relational']['rejected'] == {}


def test_a_second_task_still_forms_relational_memory_and_trims_long_summaries(tmp_path):
    """Regression: with one relational row present, the dedup pass used to raise KeyError on a
    column its query never returned and silently killed the whole relational batch."""
    store, memory = autonomous(tmp_path, episodic=[EPISODIC], relational=[RELATIONAL])
    memory.extract_completed('c1', 't1')

    other = dict(EPISODIC, title='Extraction pipeline rebuilt',
                 summary='We verified the rebuilt extraction pipeline end to end. ' * 90)
    assert len(other['summary']) > 4000
    second = dict(RELATIONAL, title='Evidence before conclusions',
                  context='The user and assistant keep grounding every claim in re-checked '
                          'evidence before accepting it.')
    seed_turn(store, 't2')
    memory.adapter = FormationAdapter([other], [second])
    assert memory.extract_completed('c1', 't2') == 2

    rows = [dict(r) for r in store.connection.execute('SELECT title, summary FROM hl_episodic_memories')]
    assert {row['title'] for row in rows} == {'ripgrep migration discovery',
                                              'Extraction pipeline rebuilt'}
    trimmed = next(row for row in rows if row['title'] == 'Extraction pipeline rebuilt')
    assert 3990 <= len(trimmed['summary']) <= 4000, \
        'an over-long summary is trimmed to the store ceiling, not discarded'
    assert store.connection.execute('SELECT COUNT(*) FROM hl_relational_memories').fetchone()[0] == 2
    summary = formation_summary(store, 't2')
    assert summary['relational']['stored'] == 1, 'a new pattern must form beside an existing one'
    assert not [e for e in store.events if e[0] == 'autonomous_memory.relational_failed']


# ---- the correction flow ---------------------------------------------------

def test_the_supersede_path_writes_an_audit_row_and_marks_the_memory():
    store = FakeStore()
    recall = Recall(store)
    old = recall.remember(OLD, 'preference', origin='explicit')
    new = recall.remember(NEW, 'preference', supersedes=old['id'], origin='explicit',
                          rationale='the user restated their preference', decided_by='gayzer')
    correction = recall.record_correction(old['id'], 'supersede', 'gayzer',
                                          'the user restated their preference', new['id'])
    with store.lock:
        row = store.connection.execute(
            'SELECT * FROM hl_memory_corrections WHERE id=?', (correction['id'],)).fetchone()
        marked = store.connection.execute(
            'SELECT status, superseded_by FROM hl_memories WHERE id=?', (old['id'],)).fetchone()
    assert row is not None, 'a correction must write an hl_memory_corrections row'
    assert (row['action'], row['actor'], row['new_memory_id']) == ('supersede', 'gayzer', new['id'])
    assert row['rationale'] == 'the user restated their preference'
    assert marked['status'] == 'superseded' and marked['superseded_by'] == new['id']


def test_the_correction_route_writes_an_audit_row_and_marks_the_memory(tmp_path):
    client = TestClient(create_app(database=tmp_path / 'life.db', adapter=IdleAdapter()))
    client.__enter__()
    response = client.post('/api/memories', json={'content': OLD, 'kind': 'preference'})
    assert response.status_code == 201, response.text
    memory_id = response.json()['id']

    response = client.post(f'/api/personality/profile/{memory_id}/correct',
                           json={'action': 'supersede', 'new_content': NEW,
                                 'rationale': 'the user restated their preference',
                                 'actor': 'gayzer'})
    assert response.status_code == 200, response.text
    replacement = response.json()['new_memory_id']

    runtime = getattr(client.app, 'state').runtime
    with runtime.store.lock:
        correction = runtime.store.connection.execute(
            'SELECT * FROM hl_memory_corrections').fetchone()
        old = runtime.store.connection.execute(
            'SELECT status, superseded_by FROM hl_memories WHERE id=?', (memory_id,)).fetchone()
    assert correction is not None, 'the correction flow must not leave hl_memory_corrections empty'
    assert (correction['memory_id'], correction['action'], correction['actor']) == \
        (memory_id, 'supersede', 'gayzer')
    assert correction['new_memory_id'] == replacement
    assert old['status'] == 'superseded' and old['superseded_by'] == replacement
    assert [row['content'] for row in client.get('/api/personality/profile').json()['profile']] == [NEW]
