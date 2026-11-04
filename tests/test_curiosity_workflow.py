"""HL-FLOW-003: focused regressions for legacy false positives and idempotent investigation."""
import sqlite3
from types import SimpleNamespace
from threading import RLock

from hermes_life.curiosity_workflow import finding_quality, investigate, list_workflow


def test_quality_excludes_templates_and_fixtures():
    assert finding_quality({'path': 'hermes_life/tests/test_decision.py',
                            'note': '# FIXME: broken'})[0] == 'excluded'
    assert finding_quality({'path': 'hermes_life/discovery.py',
                            'note': "f'near line {item[\'line\']}'"})[0] == 'excluded'
    assert finding_quality({'path': 'hermes_life/discovery.py',
                            'note': "con.execute('INSERT INTO discoveries TODO')"})[0] == 'excluded'
    assert finding_quality({'path': 'DESIGN.md', 'note': '# TODO: fake'})[0] == 'excluded'
    assert finding_quality({'path': 'main.py', 'note': '# TODO: add tests'})[0] == 'eligible'


class FakeDiscovery:
    def __init__(self, store): self.store, self.calls = store, 0
    def transition(self, ident, action):
        self.calls += 1
        with self.store.lock:
            self.store.connection.execute("UPDATE discoveries SET state='approved', goal_id='goal1' WHERE id=?", (ident,))
            self.store.connection.commit()
        return {'id': ident, 'goal_id': 'goal1'}


class FakeStore:
    def __init__(self):
        self.lock = RLock()
        self.connection = sqlite3.connect(':memory:')
        self.connection.row_factory = sqlite3.Row
        self.events = []
        self.connection.executescript('''
          CREATE TABLE curiosity(id TEXT, discovery_id TEXT, state TEXT, updated_at TEXT, question TEXT, category TEXT, priority INT, rationale TEXT, created_at TEXT);
          CREATE TABLE discoveries(id TEXT, project TEXT, path TEXT, line INT, note TEXT, state TEXT, goal_id TEXT);
          CREATE TABLE goals(id TEXT, state TEXT, task_id TEXT);
          CREATE TABLE formulated_goals(id TEXT, discovery_id TEXT);
          CREATE TABLE investigation_plans(id TEXT, formulation_id TEXT, state TEXT);
          INSERT INTO curiosity VALUES('c1','d1','open','2026-01-01','question','research',40,'', '2026-01-01');
          INSERT INTO discoveries VALUES('d1','demo','main.py',2,'# TODO: add tests','proposed',NULL);
        ''')
    def emit(self, name, payload): self.events.append((name, payload))


def test_investigate_reuses_linked_goal():
    store = FakeStore()
    disc = FakeDiscovery(store)
    rt = SimpleNamespace(store=store)
    first = investigate(rt, disc, 'c1')
    second = investigate(rt, disc, 'c1')
    assert first['goal_id'] == second['goal_id'] == 'goal1'
    assert disc.calls == 1
    item = list_workflow(rt)[0]
    assert item['discovery_goal_id'] == 'goal1'
    assert item['investigation_status'] == 'linked'


def test_false_positive_cannot_be_executed():
    store = FakeStore()
    store.connection.execute("UPDATE discoveries SET path='tests/test_thing.py'")
    store.connection.commit()
    disc = FakeDiscovery(store)
    try: investigate(SimpleNamespace(store=store), disc, 'c1')
    except ValueError as exc: assert 'Not eligible' in str(exc)
    else: assert False, 'Expected refusal'
    assert disc.calls == 0
