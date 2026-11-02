"""Identity is fixed by design; only task outcomes may accumulate as experience.

The previous version of this file asserted a mutable profile (get_profile /
update_profile / instructions / narrate) that no longer exists: personality is
now the fixed PERSONA plus reflective_runs-derived experience, and the event ->
room mapping moved to world.reduce_event.
"""
import sqlite3
from hermes_life.personality import PERSONA, Personality, PersonalityAdapter, task_context
from hermes_life.schema import migrate
from hermes_life.store import Store
from hermes_life.world import reduce_event


def seeded(path):
    store = Store(path)
    migrate(store.connection)
    return store


def test_identity_is_fixed_and_reports_experience_count(tmp_path):
    profile = Personality(seeded(tmp_path / 'life.db')).get()
    assert profile['name'] == 'Hermes'
    assert profile['persona'] == PERSONA
    assert profile['mode'] == 'fixed-with-reflection'
    assert profile['experience_count'] == 0


def test_experience_comes_from_reflective_runs(tmp_path):
    store = seeded(tmp_path / 'life.db')
    with store.lock:
        store.connection.execute(
            'INSERT INTO reflective_runs (created_at,category,status,terms_json,evidence_json,lesson)'
            ' VALUES (?,?,?,?,?,?)',
            ('now', 'testing', 'completed', '[]', '[]',
             'Verify the outcome before claiming success.'))
        store.connection.commit()
    personality = Personality(store)
    assert personality.get()['experience_count'] == 1
    rows = personality.experiences(5)
    assert len(rows) == 1 and rows[0]['status'] == 'completed'
    # The limit is clamped, never "give me everything".
    assert personality.experiences(0) == []


def test_task_context_labels_the_persona_block():
    text = task_context({'persona': PERSONA})
    assert PERSONA in text
    assert text.startswith('[Hermes Life persona: fixed identity]')
    assert text.endswith('[/Hermes Life persona]\n\n')


def test_adapter_forwards_transport_for_vm_gated_stages():
    """Discovery/investigation/formulation/implementation read .transport and
    ._ssh_base() off the outermost adapter; the wrappers must not swallow them."""
    class Delegate:
        transport = 'ssh'
        def _ssh_base(self): return ['ssh', 'guest']
        def available(self): return True
        def run(self, prompt, callback): return {'result': prompt}

    adapter = PersonalityAdapter(Delegate(), None)
    assert adapter.transport == 'ssh'
    assert adapter._ssh_base() == ['ssh', 'guest']


def test_world_reducer_maps_events_to_rooms():
    current = {'room': 'rest', 'activity': 'idle'}
    assert reduce_event({'type': 'hermes.tool_use'}, current) == ('workshop', 'coding')
    assert reduce_event({'type': 'hermes.tool_result'}, current) == ('laboratory', 'reviewing')
    assert reduce_event({'type': 'task.completed'}, current) == ('archive', 'recording')
    assert reduce_event({'type': 'task.failed'}, current) == ('archive', 'failed')
    assert reduce_event({'type': 'unknown'}, current) == ('rest', 'idle')
