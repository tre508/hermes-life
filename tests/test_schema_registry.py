"""Registry-driven migration ladder (schema.py).

The old ladder was 38 hand-maintained `if version < N` gates. These tests pin
the replacement's guarantees: complete registry, no stray upgrade functions,
loud failure on drift, and a dispatcher safety net for upgrades that forget
their own `PRAGMA user_version=N`.
"""
import sqlite3

import pytest

import hermes_life.schema as schema


def test_registry_covers_every_version():
    assert set(schema._MIGRATIONS) == set(range(2, schema.SCHEMA_VERSION + 1))


def test_no_stray_upgrade_functions_beyond_schema_version():
    prefix = '_upgrade_to_v'
    stray = [int(name[len(prefix):]) for name in vars(schema)
             if name.startswith(prefix) and name[len(prefix):].isdigit()
             and int(name[len(prefix):]) not in schema._MIGRATIONS]
    assert stray == []


def test_missing_upgrade_function_fails_at_registry_build(monkeypatch):
    # Simulate adding the next version to SCHEMA_VERSION without defining its
    # function. The probe name is derived from the live constant (HA-009: the
    # hard-coded v41 era broke the moment the ladder passed 41).
    missing = f'_upgrade_to_v{schema.SCHEMA_VERSION + 1}'
    monkeypatch.setattr(schema, 'SCHEMA_VERSION', schema.SCHEMA_VERSION + 1)
    with pytest.raises(RuntimeError, match=missing):
        schema._build_registry()


def test_stray_upgrade_function_fails_at_registry_build(monkeypatch):
    # Simulate defining an upgrade BEYOND SCHEMA_VERSION without bumping it.
    # The probe must sit past the live constant (HA-009: v41 became a real
    # upgrade when the ladder passed 41, so the old probe stopped being stray).
    stray = f'_upgrade_to_v{schema.SCHEMA_VERSION + 1}'
    monkeypatch.setattr(schema, stray, lambda connection: None,
                        raising=False)
    with pytest.raises(RuntimeError, match=stray):
        schema._build_registry()


def test_dispatcher_sets_version_when_upgrade_forgets_its_pragma(monkeypatch):
    """An upgrade that omits its own user_version bump must not leave the
    database silently behind: the ladder stamps the target itself."""
    calls = []

    def forgetful_v2(connection):
        connection.execute('CREATE TABLE IF NOT EXISTS zzz_prove (id INTEGER)')
        calls.append(2)
        # No PRAGMA user_version, no commit — the dispatcher must repair both.

    monkeypatch.setattr(schema, '_MIGRATIONS', {2: forgetful_v2})
    con = sqlite3.connect(':memory:')
    con.execute('PRAGMA user_version=1')
    # agent_personality present so the post-ladder v4 repair takes its no-op path.
    con.execute("""CREATE TABLE agent_personality (
        id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL,
        temperament TEXT NOT NULL, curiosity INTEGER NOT NULL,
        persistence INTEGER NOT NULL, caution INTEGER NOT NULL,
        communication_style TEXT NOT NULL, updated_at TEXT NOT NULL)""")
    schema.migrate(con)
    assert calls == [2]
    assert con.execute('PRAGMA user_version').fetchone()[0] == 2
    assert con.execute(
        "SELECT 1 FROM sqlite_master WHERE name='zzz_prove'").fetchone() == (1,)


def test_real_ladder_fresh_database_is_idempotent():
    con = sqlite3.connect(':memory:')
    schema.migrate(con)
    assert con.execute('PRAGMA user_version').fetchone()[0] == schema.SCHEMA_VERSION
    # Second call on the already-current database: no upgrades, no error.
    schema.migrate(con)
    assert con.execute('PRAGMA user_version').fetchone()[0] == schema.SCHEMA_VERSION


def test_real_ladder_runs_every_registered_upgrade_once():
    # A version-1 database is one the base DDL has been applied to; starting
    # from an empty DB at user_version=1 is not a state the ladder supports
    # (v18 ALTERs `events`, which only DDL creates).
    con = sqlite3.connect(':memory:')
    con.executescript(schema.DDL)
    con.execute('PRAGMA user_version=1')
    con.commit()
    schema.migrate(con)
    assert con.execute('PRAGMA user_version').fetchone()[0] == schema.SCHEMA_VERSION
    # Spot-check tables owned by the first, middle and last upgrades.
    for table in ('investigation_plans', 'library_chunks', 'experience_records'):
        assert con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (table,)).fetchone() == (1,)


def test_v40_renames_vm_path_and_preserves_rows():
    """v40: a pre-40 database with vm_path columns migrates to remote_path."""
    con = sqlite3.connect(':memory:')
    con.execute('CREATE TABLE hl_projects (name TEXT PRIMARY KEY, host_path TEXT,'
                ' spec_path TEXT, vm_path TEXT, commit_hash TEXT, synced_at TEXT)')
    con.execute('CREATE TABLE autonomy_projects (id TEXT PRIMARY KEY, name TEXT,'
                ' vm_path TEXT NOT NULL, status TEXT, created_at TEXT, updated_at TEXT)')
    con.execute('CREATE TABLE project_bootstraps (id TEXT PRIMARY KEY, proposal_id TEXT,'
                ' project_name TEXT, vm_path TEXT, status TEXT, created_at TEXT,'
                ' updated_at TEXT)')
    con.execute("INSERT INTO hl_projects VALUES ('alpha','/srv/alpha',NULL,'/wm/alpha/abc','c0ffee','2026-01-01')")
    con.execute("INSERT INTO autonomy_projects VALUES ('id1','beta','/wm/beta','active','t','t')")
    con.execute("INSERT INTO project_bootstraps VALUES ('b1','p1','gamma','/wm/gamma','active','t','t')")
    schema._upgrade_to_v40(con)
    for table in ('hl_projects', 'autonomy_projects', 'project_bootstraps'):
        cols = {r[1] for r in con.execute(f'PRAGMA table_info({table})').fetchall()}
        assert 'remote_path' in cols and 'vm_path' not in cols, table
    assert con.execute('SELECT remote_path FROM hl_projects').fetchone() == ('/wm/alpha/abc',)
    assert con.execute('SELECT remote_path FROM autonomy_projects').fetchone() == ('/wm/beta',)
    assert con.execute('SELECT remote_path FROM project_bootstraps').fetchone() == ('/wm/gamma',)


def test_v40_is_a_noop_when_remote_path_already_exists():
    con = sqlite3.connect(':memory:')
    con.execute('CREATE TABLE hl_projects (name TEXT PRIMARY KEY, remote_path TEXT)')
    schema._upgrade_to_v40(con)  # fresh installs: nothing to rename
    assert con.execute('SELECT remote_path FROM hl_projects').fetchone() is None
