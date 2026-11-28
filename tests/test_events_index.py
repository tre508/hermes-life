"""HA-023: events.task_id is indexed so /api/events?task_id= stops full-scanning.

store.events filters include task_id (store.py) while the v18-era indexes covered
only goal_id/run_id/plan_id/project_id/correlation_id — on the 131k-row live table
every task_id-filtered read scanned the whole log. These tests pin the v43
migration: fresh DB reaches the current version with the index present, a genuine
v42 database migrates with its rows intact, and the query planner actually uses
the index for a task_id-filtered select (the plan is the acceptance criterion).
"""
import sqlite3

import hermes_life.schema as schema_module
from hermes_life.schema import SCHEMA_VERSION, migrate


def _event_indexes(connection):
    return {r[0] for r in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='events'")}


def test_fresh_database_migrates_to_current_version_with_task_id_index(tmp_path):
    conn = sqlite3.connect(tmp_path / 'fresh.db')
    migrate(conn)
    assert conn.execute('PRAGMA user_version').fetchone()[0] == SCHEMA_VERSION
    assert SCHEMA_VERSION >= 43  # HA-023 landed as v43
    assert 'idx_events_task_id' in _event_indexes(conn)
    # Re-running migration (lifespan re-invokes) must be idempotent.
    migrate(conn)
    assert conn.execute('PRAGMA user_version').fetchone()[0] == SCHEMA_VERSION


def test_legacy_v42_database_migrates_with_rows_preserved(tmp_path):
    """A real v42 database (ladder capped at 42, v43 absent as it was then)
    migrates to 43 with every events row intact."""
    path = tmp_path / 'legacy.db'
    conn = sqlite3.connect(path)
    real_version = schema_module.SCHEMA_VERSION
    cap = 42
    removed: dict[str, object] = {}
    try:
        schema_module.SCHEMA_VERSION = cap
        for name, fn in list(vars(schema_module).items()):
            suffix = name[len('_upgrade_to_v'):]
            if name.startswith('_upgrade_to_v') and suffix.isdigit() and int(suffix) > cap:
                removed[name] = fn
                delattr(schema_module, name)
        schema_module._MIGRATIONS = schema_module._build_registry()
        migrate(conn)
    finally:
        schema_module.SCHEMA_VERSION = real_version
        for name, fn in removed.items():
            setattr(schema_module, name, fn)
        schema_module._MIGRATIONS = schema_module._build_registry()
    assert conn.execute('PRAGMA user_version').fetchone()[0] == 42
    assert 'idx_events_task_id' not in _event_indexes(conn)

    # Seed legacy events (direct SQL — the realistic pre-migration state).
    seeded = [(f'legacy-{i}', f'task-{i % 3}') for i in range(25)]
    for ident, task_id in seeded:
        conn.execute(
            "INSERT INTO events (id, task_id, type, timestamp, payload) VALUES (?,?,?,?,?)",
            (ident, task_id, 'hermes.system', '2026-01-01T00:00:00', '{}'))
    conn.commit()

    migrate(conn)
    assert conn.execute('PRAGMA user_version').fetchone()[0] == SCHEMA_VERSION
    assert 'idx_events_task_id' in _event_indexes(conn)
    assert conn.execute('SELECT COUNT(*) FROM events').fetchone()[0] == len(seeded)
    assert conn.execute(
        "SELECT COUNT(*) FROM events WHERE task_id = 'task-1'").fetchone()[0] == \
        sum(1 for _, t in seeded if t == 'task-1')
    # Idempotent on restart.
    migrate(conn)
    assert conn.execute('PRAGMA user_version').fetchone()[0] == SCHEMA_VERSION


def test_task_id_filter_uses_the_index(tmp_path):
    """EXPLAIN QUERY PLAN must show idx_events_task_id for a task_id-filtered
    select — both the plain shape and the exact query store.events builds
    (sequence > ? AND task_id = ? ORDER BY sequence LIMIT ?)."""
    conn = sqlite3.connect(tmp_path / 'plan.db')
    migrate(conn)
    for i in range(100):
        conn.execute(
            "INSERT INTO events (id, task_id, type, timestamp, payload) VALUES (?,?,?,?,?)",
            (f'id-{i}', f'task-{i % 5}', 'hermes.system', '2026-01-01T00:00:00', '{}'))
    conn.commit()

    def plan(query, params):
        return ' | '.join(r[3] for r in conn.execute(
            'EXPLAIN QUERY PLAN ' + query, params).fetchall())

    plain = plan('SELECT * FROM events WHERE task_id = ?', ('task-1',))
    assert 'idx_events_task_id' in plain, plain
    assert 'SCAN events' not in plain, plain

    # The real store.events shape (after/limit path).
    store_shape = plan(
        'SELECT * FROM events WHERE sequence > ? AND task_id = ? ORDER BY sequence LIMIT ?',
        (0, 'task-1', 200))
    assert 'idx_events_task_id' in store_shape, store_shape
    assert 'SCAN events' not in store_shape, store_shape

    # The tail path orders sequence DESC but still filters by task_id.
    tail_shape = plan(
        'SELECT * FROM events WHERE sequence > ? AND task_id = ? ORDER BY sequence DESC LIMIT ?',
        (0, 'task-1', 200))
    assert 'idx_events_task_id' in tail_shape, tail_shape
    assert 'SCAN events' not in tail_shape, tail_shape
