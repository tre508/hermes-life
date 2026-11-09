"""HL-PERS-001 §5B/§5D/§5E — a learned attribute keeps its evidence, its origin, its validity.

The extractor has always validated a verbatim quote and then thrown it away; the profile ordered by
`kind`, so an inferred preference outranked an explicit correction. These tests pin the fix: the
quote is stored, the origin is recorded (unknown provenance is never guessed), and an explicit
statement sorts above an inference.
"""
import json

import pytest

from hermes_life.conversation_recall import Recall
from hermes_life.personality import Personality, task_context
from hermes_life.schema import SCHEMA_VERSION, migrate
from hermes_life.store import Store
from hermes_life.vault_memory import VaultMemory

EVIDENCE = 'find the actual root cause before suggesting fixes'
STATEMENT = 'Always find the actual root cause before suggesting fixes.'
INFERRED = 'Always find the actual root cause quickly.'


def seeded(tmp_path, name='life.db'):
    store = Store(tmp_path / name)
    migrate(store.connection)
    return store


def test_a_pre_v30_database_is_upgraded_and_unknown_provenance_stays_unknown(tmp_path):
    legacy = tmp_path / 'legacy.db'
    con = __import__('sqlite3').connect(legacy)
    con.executescript('''CREATE TABLE hl_memories (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, kind TEXT NOT NULL,
        source_conversation_id TEXT, source_turn_id INTEGER,
        status TEXT NOT NULL DEFAULT 'active', superseded_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);''')
    con.execute("INSERT INTO hl_memories(id,content,kind,status,created_at,updated_at)"
                " VALUES('old','Legacy statement','preference','active','1','1')")
    con.execute('PRAGMA user_version=29')
    con.commit()
    con.close()

    store = Store(legacy)
    migrate(store.connection)

    columns = {r[1] for r in store.connection.execute('PRAGMA table_info(hl_memories)')}
    assert {'evidence_excerpt', 'origin', 'confidence', 'expires_at', 'rationale',
            'decided_by'} <= columns
    assert store.connection.execute('PRAGMA user_version').fetchone()[0] == SCHEMA_VERSION
    row = store.connection.execute("SELECT content,origin FROM hl_memories WHERE id='old'").fetchone()
    assert row['content'] == 'Legacy statement', 'the upgrade must not lose rows'
    assert row['origin'] is None, 'an unknown origin must not be recorded as explicitly stated'


def test_an_explicit_statement_outranks_a_newer_inference(tmp_path):
    store = seeded(tmp_path)
    recall = Recall(store)
    recall.remember('Prefer root-cause analysis over generic troubleshooting commands.', 'preference',
                    origin='explicit', evidence_excerpt=EVIDENCE)
    recall.remember('Prefer long replies with exhaustive background.', 'preference', origin='inferred')

    profile = Personality(store).learned_profile()
    assert [row['origin'] for row in profile] == ['explicit', 'inferred']
    assert profile[0]['evidence_excerpt'] == EVIDENCE


def test_unknown_provenance_is_refused_rather_than_guessed(tmp_path):
    recall = Recall(seeded(tmp_path))
    with pytest.raises(ValueError):
        recall.remember('Prefer something durable here.', 'preference', origin='guess')


def test_the_prompt_labels_who_stated_each_preference(tmp_path):
    store = seeded(tmp_path)
    recall = Recall(store)
    recall.remember('Prefer root-cause analysis over generic troubleshooting commands.', 'preference',
                    origin='explicit')
    recall.remember('Prefer bullet lists in summaries.', 'preference', origin='inferred')

    text = task_context({'persona': 'p'}, Personality(store).learned_profile())
    assert 'Preference (user-stated): Prefer root-cause analysis' in text
    assert 'Preference (inferred): Prefer bullet lists' in text


def test_extraction_stores_the_validated_quote_and_never_upgrades_an_inference(tmp_path):
    store = seeded(tmp_path)
    with store.lock:
        con = store.connection
        con.execute("INSERT INTO tasks(id,prompt,state,created_at,updated_at)"
                    " VALUES('t1','x','completed','1','1')")
        for role, content, stamp in (('user', STATEMENT, '1'), ('assistant', 'Understood.', '2')):
            con.execute('INSERT INTO hl_conversation_turns(conversation_id,task_id,role,content,created_at)'
                        " VALUES('c1','t1',?,?,?)", (role, content, stamp))
        con.commit()

    class Extractor:
        transport = 'ssh'

        def available(self):
            return True

        def run(self, prompt, callback, task_id=None):
            return {'result': json.dumps({'candidates': [
                {'kind': 'preference', 'memory': 'Prefer root-cause analysis before proposing fixes.',
                 'evidence': EVIDENCE, 'origin': 'explicit', 'relation': 'new'},
                {'kind': 'preference', 'memory': 'Prefer stating the root cause in the first line.',
                 'evidence': 'actual root cause', 'origin': 'guess', 'relation': 'new'},
            ]})}

        def cancel(self, task_id):
            return True

    vault = VaultMemory(store, Recall(store), adapter=Extractor())
    vault.vault = tmp_path / 'no-vault-here'  # mirroring stays out of this test

    assert vault.extract_completed('c1', 't1') == 2
    rows = {r['content']: dict(r) for r in store.connection.execute('SELECT * FROM hl_memories')}
    stored = rows['Prefer root-cause analysis before proposing fixes.']
    assert stored['origin'] == 'explicit'
    assert stored['evidence_excerpt'] == EVIDENCE
    # An unrecognised origin falls back to 'inferred': never claim the user said it.
    assert rows['Prefer stating the root cause in the first line.']['origin'] == 'inferred'
