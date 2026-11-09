"""HL-PERS-001 §5F / §7 #8, #9 — the learned profile must be inspectable, correctable and auditable.

The audit's gap was that every route existed but nothing reached them, `correct` could only supersede or
delete without saying who or why, and a reviewed duplicate could only be accepted or rejected. These tests
pin the behaviour through the real HTTP surface, including the one that matters most: after a correction,
the next prompt assembled for the worker must carry the corrected statement and drop the old one.
"""
import json
import time

from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.conversation_recall import Recall
from hermes_life.schema import migrate
from hermes_life.store import Store
from hermes_life.vault_memory import VaultMemory

OLD = 'Prefer verbose explanations with exhaustive background.'
NEW = 'Prefer terse answers that lead with the answer.'
STATEMENT = 'Always find the actual root cause before suggesting fixes.'


class CapturingAdapter:
    """Records every prompt the worker would receive, and answers extraction in its own protocol."""

    def __init__(self):
        self.prompts = []

    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        self.prompts.append(prompt)
        if 'candidates' in prompt:
            return {'result': json.dumps({'candidates': [], 'task_lesson': {}})}
        return {'result': 'Test complete', 'session_id': 'fake-session'}

    def cancel(self, task_id):
        return True


def running(tmp_path, name='life.db'):
    adapter = CapturingAdapter()
    client = TestClient(create_app(database=tmp_path / name, adapter=adapter))
    client.__enter__()
    return client, adapter


def remember(client, content, kind='preference'):
    response = client.post('/api/memories', json={'content': content, 'kind': kind})
    assert response.status_code == 201, response.text
    return response.json()['id']


def run_task(client, prompt='Do the thing'):
    """Submit a task and wait for it, so the assembled prompt is what the worker really got."""
    response = client.post('/api/tasks', json={'prompt': prompt})
    assert response.status_code == 202, response.text
    task_id = response.json()['id']
    for _ in range(300):
        if client.get(f'/api/tasks/{task_id}').json()['state'] in ('completed', 'failed'):
            break
        time.sleep(.02)
    else:
        raise AssertionError('task never finished')
    # Let the post-task extraction pass finish; it must not reintroduce the retired statement either.
    time.sleep(.15)
    return task_id


def corrections(client, memory_id=None):
    query = f'?memory_id={memory_id}' if memory_id else ''
    return client.get(f'/api/memory-corrections{query}').json()['corrections']


def seed_review(client, existing_memory_id, candidate='Prefer short replies that get to the point.'):
    """A pending review row, inserted through the application's own connection."""
    runtime = client.app.state.runtime
    with runtime.store.lock:
        cursor = runtime.store.connection.execute(
            'INSERT INTO hl_memory_reviews(task_id,candidate,existing_memory_id,reason,evidence_excerpt,origin)'
            " VALUES('t1',?,?,'contradiction','get to the point','explicit')",
            (candidate, existing_memory_id))
        runtime.store.connection.commit()
        return cursor.lastrowid


def test_a_correction_must_say_who_and_why(tmp_path):
    client, _ = running(tmp_path)
    memory_id = remember(client, OLD)
    correct = lambda payload: client.post(f'/api/personality/profile/{memory_id}/correct', json=payload)
    assert correct({'action': 'delete'}).status_code == 422, 'no rationale'
    assert correct({'action': 'delete', 'rationale': 'x'}).status_code == 422, 'rationale too short'
    assert correct({'action': 'archive', 'rationale': 'not an action'}).status_code == 422
    assert client.get('/api/personality/profile').json()['profile'][0]['content'] == OLD
    assert corrections(client) == []


def test_the_next_prompt_carries_the_correction_and_drops_the_old_statement(tmp_path):
    client, adapter = running(tmp_path)
    memory_id = remember(client, OLD)

    response = client.post(f'/api/personality/profile/{memory_id}/correct',
                           json={'action': 'supersede', 'new_content': NEW,
                                 'rationale': 'the user restated their preference', 'actor': 'gayzer'})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['action'] == 'superseded' and body['merged_into'] is None
    assert body['correction']['actor'] == 'gayzer'
    assert body['correction']['rationale'] == 'the user restated their preference'

    profile = client.get('/api/personality/profile').json()['profile']
    assert [row['content'] for row in profile] == [NEW]
    assert profile[0]['origin'] == 'explicit' and profile[0]['decided_by'] == 'gayzer'

    assert [(row['action'], row['actor']) for row in corrections(client, memory_id)] == [('supersede', 'gayzer')]

    run_task(client)
    assert any(NEW in prompt for prompt in adapter.prompts), 'the correction never reached a prompt'
    assert all(OLD not in prompt for prompt in adapter.prompts), 'the retired statement still reaches the model'


def test_delete_invalidates_without_inventing_a_replacement(tmp_path):
    client, adapter = running(tmp_path)
    memory_id = remember(client, OLD)
    response = client.post(f'/api/personality/profile/{memory_id}/correct',
                           json={'action': 'delete', 'rationale': 'no longer true', 'actor': 'gayzer'})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['action'] == 'deleted' and body['merged_into'] is None
    assert body['correction'] == corrections(client, memory_id)[0]

    assert client.get('/api/personality/profile').json()['profile'] == [], 'delete must not invent a replacement'
    run_task(client)
    assert all(OLD not in prompt for prompt in adapter.prompts)
    assert len(corrections(client)) == 1


def test_merge_retires_a_duplicate_in_favour_of_the_memory_it_duplicates(tmp_path):
    client, _ = running(tmp_path)
    keep = remember(client, NEW)
    duplicate = remember(client, 'Prefer short replies that front-load the answer.')

    response = client.post(f'/api/personality/profile/{duplicate}/correct',
                           json={'action': 'merge', 'merge_into': keep,
                                 'rationale': 'the same preference in different words', 'actor': 'gayzer'})
    assert response.status_code == 200, response.text
    assert response.json()['action'] == 'merged' and response.json()['merged_into'] == keep

    profile = client.get('/api/personality/profile').json()['profile']
    assert [row['id'] for row in profile] == [keep], 'the surviving memory must be untouched'
    assert corrections(client, duplicate)[0]['new_memory_id'] == keep


def test_merge_refuses_a_missing_self_or_inactive_target(tmp_path):
    client, _ = running(tmp_path)
    first = remember(client, NEW)
    second = remember(client, 'Prefer short replies that front-load the answer.')
    merge = lambda target: client.post(f'/api/personality/profile/{second}/correct',
                                       json={'action': 'merge', 'merge_into': target,
                                             'rationale': 'same thing said twice'})
    assert merge('').status_code == 422, 'an empty target must be refused'
    assert client.post(f'/api/personality/profile/{second}/correct',
                       json={'action': 'merge', 'rationale': 'same thing said twice'}).status_code == 422
    assert merge(second).status_code == 422, 'a memory cannot be merged into itself'
    assert merge('no-such-memory').status_code == 409
    assert client.post(f'/api/personality/profile/{first}/correct',
                       json={'action': 'delete', 'rationale': 'retired'}).status_code == 200
    assert merge(first).status_code == 409, 'a retired memory is not a merge target'


def test_extraction_files_a_review_with_its_evidence_and_origin(tmp_path):
    """The review surface can only be inspected if the candidate's support is stored with it."""
    store = Store(tmp_path / 'life.db')
    migrate(store.connection)
    existing = Recall(store).remember(OLD, 'preference')
    with store.lock:
        con = store.connection
        con.execute("INSERT INTO tasks(id,prompt,state,created_at,updated_at) VALUES('t1','x','completed','1','1')")
        for role, content, stamp in (('user', STATEMENT, '1'), ('assistant', 'Understood.', '2')):
            con.execute('INSERT INTO hl_conversation_turns(conversation_id,task_id,role,content,created_at)'
                        " VALUES('c1','t1',?,?,?)", (role, content, stamp))
        con.commit()

    class Contradicting:
        transport = 'ssh'

        def available(self):
            return True

        def run(self, prompt, callback, task_id=None):
            return {'result': json.dumps({'candidates': [
                {'kind': 'preference', 'memory': 'Prefer short replies that get to the point.',
                 'evidence': 'the actual root cause', 'origin': 'explicit',
                 'relation': 'contradiction', 'existing_id': existing['id']}]})}

        def cancel(self, task_id):
            return True

    vault = VaultMemory(store, Recall(store), adapter=Contradicting())
    vault.vault = tmp_path / 'no-vault-here'
    assert vault.extract_completed('c1', 't1') == 0, 'a contradiction is reviewed, not stored'

    review = store.connection.execute('SELECT * FROM hl_memory_reviews').fetchone()
    assert review['reason'] == 'contradiction'
    assert review['existing_memory_id'] == existing['id']
    assert review['evidence_excerpt'] == 'the actual root cause' and review['origin'] == 'explicit'


def test_a_duplicate_candidate_can_be_merged_but_must_be_justified(tmp_path):
    client, _ = running(tmp_path)
    memory_id = remember(client, OLD)
    review_id = seed_review(client, memory_id)
    resolve = lambda payload: client.post(f'/api/memory-reviews/{review_id}/resolve', json=payload)

    assert resolve({'decision': 'merge'}).status_code == 422, 'a merge must state a reason'
    assert resolve({'decision': 'perhaps'}).status_code == 422
    response = resolve({'decision': 'merge', 'rationale': 'same preference, shorter wording', 'actor': 'gayzer'})
    assert response.status_code == 200, response.text
    assert response.json()['status'] == 'merge'

    # Merging keeps the memory: nothing replaced, nothing added.
    assert [row['content'] for row in client.get('/api/personality/profile').json()['profile']] == [OLD]
    review = next(row for row in client.get('/api/memory-reviews').json()['reviews'] if row['id'] == review_id)
    assert review['resolved_by'] == 'gayzer'
    assert review['resolution_rationale'] == 'same preference, shorter wording'
    assert [(row['action'], row['memory_id']) for row in corrections(client)] == [('merge', memory_id)]
    assert resolve({'decision': 'reject'}).status_code == 409, 'a resolved review stays resolved'


def test_a_review_merge_needs_a_memory_to_merge_into(tmp_path):
    client, _ = running(tmp_path)
    review_id = seed_review(client, None)
    assert client.post(f'/api/memory-reviews/{review_id}/resolve',
                       json={'decision': 'merge', 'rationale': 'nothing to merge into'}).status_code == 409
