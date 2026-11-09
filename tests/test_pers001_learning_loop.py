"""HL-PERS-001 §7 #12 / §9 — the learning loop, end to end, through the product's own surface.

The audit's coverage finding was that nothing exercised extraction, consolidation, retrieval, prompt
assembly and post-task learning together, and that `tasks` recorded no personality provenance — so
"the profile adapted future behaviour" could not be demonstrated even after the fact. This walks the whole
loop against a real database and a real vault:

    task 1 states a preference → extraction stores it with its evidence → retrieval selects it for a
    related prompt and not for an unrelated one → a *fresh* app on the same database injects it into
    task 2's prompt → a correction supersedes it, the newer statement wins and the older one disappears
    from later prompts → the vault note is written and then marked invalid.

Every "it was told this" claim is cross-checked against the provenance the run recorded.
"""
import hashlib
import json
import os
import time

from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.personality import PERSONA

STATEMENT = 'Always find the actual root cause before suggesting fixes.'
EVIDENCE = 'find the actual root cause before suggesting fixes'
STORED = 'Prefer identifying the root cause from verifiable evidence before proposing a fix.'
CORRECTED = 'Prefer stating the root cause in the first line, then the fix.'
UNRELATED = 'Bake a chocolate cake for the team lunch.'


class Scripted:
    """Answers the extraction pass in its own protocol and records every prompt the worker would see."""

    def __init__(self, candidates=None):
        self.prompts = []
        self.candidates = candidates or []

    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        self.prompts.append(prompt)
        if 'candidates' in prompt:
            return {'result': json.dumps({'candidates': self.candidates, 'task_lesson': {}})}
        return {'result': 'Task complete.', 'session_id': 'scripted'}

    def cancel(self, task_id):
        return True


def candidate(**overrides):
    payload = {'kind': 'preference', 'memory': STORED, 'evidence': EVIDENCE,
               'origin': 'explicit', 'relation': 'new'}
    payload.update(overrides)
    return payload


def app_on(tmp_path, vault, candidates=None, name='life.db'):
    # The app resolves its vault from the environment; conftest points every test at a disposable one.
    os.environ['HERMES_LIFE_OBSIDIAN_VAULT'] = str(vault)
    adapter = Scripted(candidates)
    client = TestClient(create_app(database=tmp_path / name, adapter=adapter))
    client.__enter__()
    return client, adapter


def submit(client, prompt):
    response = client.post('/api/tasks', json={'prompt': prompt})
    assert response.status_code == 202, response.text
    task_id = response.json()['id']
    for _ in range(300):
        if client.get(f'/api/tasks/{task_id}').json()['state'] in ('completed', 'failed'):
            break
        time.sleep(.02)
    else:
        raise AssertionError('task never finished')
    # The post-task learning pass runs after completion, in its own thread.
    for _ in range(200):
        if client.get(f'/api/tasks/{task_id}').json()['state'] == 'completed':
            break
        time.sleep(.01)
    time.sleep(.2)
    return task_id


def memories(client):
    return client.get('/api/personality/profile').json()['profile']


def retrieved(client, prompt):
    return client.get('/api/personality/profile/relevant', params={'prompt': prompt}).json()['context']


def test_a_stated_preference_is_learned_then_reaches_a_later_task(tmp_path):
    vault = tmp_path / 'vault'
    vault.mkdir()
    client, adapter = app_on(tmp_path, vault, [candidate()])

    # 1. Extraction: the stated preference is stored with the verbatim support that justified it.
    submit(client, STATEMENT)
    stored = [row for row in memories(client) if row['content'] == STORED]
    assert stored, f'nothing was learned: {adapter.prompts[-1][:120]}'
    assert stored[0]['evidence_excerpt'] == EVIDENCE and stored[0]['origin'] == 'explicit'

    # 2. Retrieval selects it for a related prompt and excludes an unrelated one (§7 #4).
    assert STORED in retrieved(client, 'identify the root cause from verifiable evidence')
    assert STORED not in retrieved(client, UNRELATED)

    # 3. Persistence: a fresh app on the same database still injects it (§7 #1, #5).
    fresh, fresh_adapter = app_on(tmp_path, vault)
    task_id = submit(fresh, 'Please fix the failing build.')
    assert any(STORED in prompt for prompt in fresh_adapter.prompts), 'a later task was not told the preference'

    # 4. Provenance: the run records the persona and every memory that reached the prompt, so the
    #    adaptation is a measurable claim rather than an inference from behaviour (§7 #5, #9).
    recorded = fresh.get(f'/api/tasks/{task_id}').json()
    assert recorded['applied_persona_sha256'] == hashlib.sha256(PERSONA.encode()).hexdigest()
    assert stored[0]['id'] in json.loads(recorded['applied_memory_ids'])
    assert json.loads(recorded['applied_lesson_ids']) == []


def test_the_recorded_lessons_are_the_ones_that_were_injected(tmp_path):
    vault = tmp_path / 'vault'
    vault.mkdir()
    client, _ = app_on(tmp_path, vault)
    runtime = getattr(client.app, 'state').runtime
    with runtime.store.lock:
        runtime.store.connection.execute(
            'INSERT INTO technical_lessons(id,category,topic,lesson,applicability,evidence_excerpt,'
            'evidence_sha256,evidence_kind,state,reuse_count,created_at)'
            " VALUES(7,'coding','root cause analysis','Find the root cause before proposing a fix.',"
            "'root cause analysis on failing builds','pytest output showed two identical comments',"
            "'sha','tool_output','supported',0,'t')")
        runtime.store.connection.commit()

    recorded = client.get(f'/api/tasks/{submit(client, STATEMENT)}').json()
    assert json.loads(recorded['applied_lesson_ids']) == [7], 'a supported lesson matching the task was not recorded'
    other = client.get(f'/api/tasks/{submit(client, UNRELATED)}').json()
    assert json.loads(other['applied_lesson_ids']) == [], 'an unrelated task must not claim the lesson'


def test_a_correction_changes_what_later_tasks_are_told(tmp_path):
    vault = tmp_path / 'vault'
    vault.mkdir()
    client, adapter = app_on(tmp_path, vault, [candidate()])
    submit(client, STATEMENT)
    memory_id = next(row['id'] for row in memories(client) if row['content'] == STORED)

    # The mirror has the memory, and it is current.
    note = vault / 'Hermes-Life' / 'Memory' / 'Auto' / 'Preferences' / f'{memory_id}.md'
    assert note.is_file() and 'status: "active"' in note.read_text()

    response = client.post(f'/api/personality/profile/{memory_id}/correct',
                           json={'action': 'supersede', 'new_content': CORRECTED,
                                 'rationale': 'the corrected wording is what the user wants', 'actor': 'gayzer'})
    assert response.status_code == 200, response.text

    # 5. The correction is durable, wins over the old statement, and is recorded as the reason.
    assert [row['content'] for row in memories(client)] == [CORRECTED]
    already = len(adapter.prompts)
    task_id = submit(client, 'Fix the failing build and state the cause.')
    later = adapter.prompts[already:]
    assert any(CORRECTED in prompt for prompt in later), 'the corrected statement never reached a prompt'
    assert all(STORED not in prompt for prompt in later), 'the retired statement still reaches the model'
    recorded = json.loads(client.get(f'/api/tasks/{task_id}').json()['applied_memory_ids'])
    surviving = next(row['id'] for row in memories(client))
    assert recorded == [surviving], 'the run must name the corrected memory, not the retired one'

    # 6. The vault follows: the retired note says so, and the replacement note is current (§7 #7).
    assert 'status: "superseded"' in note.read_text()
    replacement_note = vault / 'Hermes-Life' / 'Memory' / 'Auto' / 'Preferences' / f'{surviving}.md'
    assert 'status: "active"' in replacement_note.read_text()
