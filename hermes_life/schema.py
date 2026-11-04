"""Explicit, versioned schema setup and single-owner restart recovery."""
from .store import now

SCHEMA_VERSION = 19
DDL = r'''

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY, prompt TEXT NOT NULL, state TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                result TEXT, error TEXT, session_id TEXT
            );
            CREATE TABLE IF NOT EXISTS events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                id TEXT NOT NULL UNIQUE, task_id TEXT,
                type TEXT NOT NULL, timestamp TEXT NOT NULL, payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS agent_state (
                id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL,
                current_task TEXT, updated_at TEXT NOT NULL
            );
            INSERT OR IGNORE INTO agent_state VALUES (1, 'idle', NULL, '');
            CREATE TABLE IF NOT EXISTS world_state (
                id INTEGER PRIMARY KEY CHECK(id=1),
                room TEXT NOT NULL, activity TEXT NOT NULL,
                agent_x INTEGER NOT NULL, agent_y INTEGER NOT NULL,
                last_sequence INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );
            INSERT OR IGNORE INTO world_state VALUES
                (1, 'rest', 'idle', 0, 0, 0, '');
            

                CREATE TABLE IF NOT EXISTS autonomy_settings (
                  id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0
                );
                INSERT OR IGNORE INTO autonomy_settings(id,enabled) VALUES(1,0);
                CREATE TABLE IF NOT EXISTS goals (
                  id TEXT PRIMARY KEY, title TEXT NOT NULL, prompt TEXT NOT NULL,
                  state TEXT NOT NULL, priority INTEGER NOT NULL, created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL, task_id TEXT, error TEXT
                );
            

    CREATE TABLE IF NOT EXISTS discoveries (
     id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE,
     project TEXT NOT NULL, path TEXT NOT NULL, line INTEGER NOT NULL,
     note TEXT NOT NULL, proposed_prompt TEXT NOT NULL,
     rationale TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'proposed',
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL, goal_id TEXT
    );
   

    CREATE TABLE IF NOT EXISTS decision_settings (
      id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0,
      scan_interval_seconds INTEGER NOT NULL DEFAULT 3600, last_scan TEXT,
      last_error TEXT
    );
    INSERT OR IGNORE INTO decision_settings(id,enabled) VALUES (1,0);
    CREATE TABLE IF NOT EXISTS curiosity (
      id TEXT PRIMARY KEY, discovery_id TEXT NOT NULL UNIQUE, question TEXT NOT NULL,
      category TEXT NOT NULL, priority INTEGER NOT NULL, state TEXT NOT NULL,
      rationale TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
   

                CREATE TABLE IF NOT EXISTS formulated_goals (
                  id TEXT PRIMARY KEY, discovery_id TEXT NOT NULL UNIQUE,
                  title TEXT NOT NULL, action TEXT NOT NULL,
                  rationale TEXT NOT NULL, acceptance TEXT NOT NULL,
                  prompt TEXT NOT NULL, priority INTEGER NOT NULL,
                  state TEXT NOT NULL, goal_id TEXT,
                  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
            
'''

def migrate(connection):
    version = connection.execute('PRAGMA user_version').fetchone()[0]
    if version > SCHEMA_VERSION:
        raise RuntimeError(f'Database schema {version} is newer than supported {SCHEMA_VERSION}')
    if version < 1:
        connection.executescript(DDL)
        connection.execute('PRAGMA user_version=1')
        connection.commit()
    if version < 2:
        _upgrade_to_v2(connection)
    if version < 3:
        _upgrade_to_v3(connection)
    if version < 4:
        _upgrade_to_v4(connection)
    if version < 5:
        _upgrade_to_v5(connection)
    if version < 6:
        _upgrade_to_v6(connection)
    if version < 7:
        _upgrade_to_v7(connection)
    if version < 8:
        _upgrade_to_v8(connection)
    if version < 9:
        _upgrade_to_v9(connection)
    if version < 10:
        _upgrade_to_v10(connection)
    if version < 11:
        _upgrade_to_v11(connection)
    if version < 12:
        _upgrade_to_v12(connection)
    if version < 13:
        _upgrade_to_v13(connection)
    if version < 14:
        _upgrade_to_v14(connection)
    if version < 15:
        _upgrade_to_v15(connection)
    if version < 16:
        _upgrade_to_v16(connection)
    if version < 17:
        _upgrade_to_v17(connection)
    if version < 18:
        _upgrade_to_v18(connection)
    if version < 19:
        _upgrade_to_v19(connection)
    # Repair partially-applied v4 installations without touching earlier data.
    has_personality = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_personality'"
    ).fetchone()
    if not has_personality:
        _upgrade_to_v4(connection)
        connection.execute('PRAGMA user_version=19')
        connection.commit()
    else:
        connection.execute("""INSERT OR IGNORE INTO agent_personality
            VALUES (1, 'Hermes', 'curious', 80, 75, 60, 'concise', '')""")
        connection.commit()

def _upgrade_to_v2(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS investigation_plans (
      id TEXT PRIMARY KEY, formulation_id TEXT NOT NULL UNIQUE,
      task_id TEXT NOT NULL, report TEXT NOT NULL, created_at TEXT NOT NULL
    )""")
    connection.execute('PRAGMA user_version=2')
    connection.commit()

def _upgrade_to_v3(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS implementation_runs (
      id TEXT PRIMARY KEY, plan_id TEXT NOT NULL UNIQUE, project TEXT NOT NULL,
      state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      candidate_path TEXT, baseline_path TEXT, baseline_json TEXT,
      candidate_json TEXT, response TEXT, error TEXT,
      applied_at TEXT, apply_sha256 TEXT
    )""")
    connection.execute('PRAGMA user_version=3')
    connection.commit()

def _upgrade_to_v4(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS agent_personality (
        id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL,
        temperament TEXT NOT NULL, curiosity INTEGER NOT NULL,
        persistence INTEGER NOT NULL, caution INTEGER NOT NULL,
        communication_style TEXT NOT NULL, updated_at TEXT NOT NULL
    )""")
    connection.execute("""INSERT OR IGNORE INTO agent_personality
        VALUES (1, 'Hermes', 'curious', 80, 75, 60, 'concise', '')""")
    connection.execute('PRAGMA user_version=4')
    connection.commit()

def _upgrade_to_v5(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS persona_experiences (
        id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT NOT NULL,
        note TEXT NOT NULL, created_at TEXT NOT NULL
    )""")
    connection.execute('PRAGMA user_version=5')
    connection.commit()

def _upgrade_to_v6(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS reflective_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL, category TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('completed','failed')),
        terms_json TEXT NOT NULL, evidence_json TEXT NOT NULL,
        lesson TEXT NOT NULL
    )""")
    connection.execute('CREATE INDEX IF NOT EXISTS idx_reflective_runs_category ON reflective_runs(category, id)')
    connection.execute('PRAGMA user_version=6')
    connection.commit()

def recover_interrupted(connection):
    stamp = now()
    connection.execute("UPDATE tasks SET state='interrupted', updated_at=? WHERE state IN ('running','queued')", (stamp,))
    connection.execute("UPDATE goals SET state='interrupted', updated_at=? WHERE state='running'", (stamp,))
    connection.execute("UPDATE agent_state SET state='idle', current_task=NULL, updated_at=? WHERE id=1", (stamp,))
    connection.commit()


def _upgrade_to_v7(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS technical_lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, created_at TEXT NOT NULL,
        category TEXT NOT NULL, topic TEXT NOT NULL, lesson TEXT NOT NULL,
        applicability TEXT NOT NULL, evidence_excerpt TEXT NOT NULL,
        evidence_sha256 TEXT NOT NULL, evidence_kind TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('supported','unverified')),
        reuse_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (run_id) REFERENCES reflective_runs(id)
    )""")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_technical_lessons_category ON technical_lessons(category, id)")
    connection.execute("""CREATE TABLE IF NOT EXISTS lesson_reuse (
        lesson_id INTEGER NOT NULL, run_id INTEGER NOT NULL, outcome TEXT NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY(lesson_id, run_id)
    )""")
    connection.execute('PRAGMA user_version=7')
    connection.commit()


def _upgrade_to_v8(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS technical_lesson_evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_id INTEGER NOT NULL REFERENCES technical_lessons(id),
        run_id INTEGER REFERENCES reflective_runs(id),
        excerpt TEXT NOT NULL, evidence_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(lesson_id,run_id,evidence_sha256)
    )""")
    connection.execute("""CREATE TABLE IF NOT EXISTS lesson_application (
        lesson_id INTEGER NOT NULL REFERENCES technical_lessons(id),
        run_id INTEGER NOT NULL REFERENCES reflective_runs(id),
        excerpt TEXT NOT NULL, evidence_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(lesson_id,run_id)
    )""")
    # Backfill pre-existing source evidence without modifying lessons or reuse counts.
    connection.execute("""INSERT OR IGNORE INTO technical_lesson_evidence
        (lesson_id,run_id,excerpt,evidence_sha256,created_at)
        SELECT id,run_id,evidence_excerpt,evidence_sha256,created_at
        FROM technical_lessons WHERE state='supported' AND evidence_sha256<>''""")
    # One-time conservative merge of existing supported duplicates.
    # Keep the oldest lesson ID, preserve distinct exposure records and source evidence.
    from .technical_memory import equivalent
    rows = connection.execute("SELECT id,lesson FROM technical_lessons WHERE state='supported' ORDER BY id").fetchall()
    canonical=[]
    for current in rows:
        duplicate=next((r for r in canonical if equivalent({'lesson':r[1]},{'lesson':current[1]})),None)
        if duplicate is None:
            canonical.append(current)
            continue
        keep,remove=duplicate[0],current[0]
        connection.execute("""INSERT OR IGNORE INTO technical_lesson_evidence
            (lesson_id,run_id,excerpt,evidence_sha256,created_at)
            SELECT ?,run_id,excerpt,evidence_sha256,created_at
            FROM technical_lesson_evidence WHERE lesson_id=?""",(keep,remove))
        connection.execute("""INSERT OR IGNORE INTO lesson_reuse (lesson_id,run_id,outcome,created_at)
            SELECT ?,run_id,outcome,created_at FROM lesson_reuse WHERE lesson_id=?""",(keep,remove))
        connection.execute('DELETE FROM technical_lesson_evidence WHERE lesson_id=?',(remove,))
        connection.execute('DELETE FROM lesson_reuse WHERE lesson_id=?',(remove,))
        connection.execute('DELETE FROM technical_lessons WHERE id=?',(remove,))
        connection.execute("UPDATE technical_lessons SET reuse_count=(SELECT COUNT(*) FROM lesson_reuse WHERE lesson_id=?) WHERE id=?",(keep,keep))
    connection.execute('PRAGMA user_version=8')
    connection.commit()


def _upgrade_to_v9(connection):
    """Consolidate existing equivalent findings and preserve every evidence trail."""
    from .technical_memory import equivalent
    rows = connection.execute(
        "SELECT id,lesson FROM technical_lessons WHERE state='supported' ORDER BY id"
    ).fetchall()
    canonical = []
    for current in rows:
        duplicate = next((r for r in canonical if equivalent({'lesson':r[1]}, {'lesson':current[1]})), None)
        if duplicate is None:
            canonical.append(current)
            continue
        keep, remove = duplicate[0], current[0]
        connection.execute("""INSERT OR IGNORE INTO technical_lesson_evidence
            (lesson_id,run_id,excerpt,evidence_sha256,created_at)
            SELECT ?,run_id,excerpt,evidence_sha256,created_at
            FROM technical_lesson_evidence WHERE lesson_id=?""", (keep,remove))
        connection.execute("""INSERT OR IGNORE INTO lesson_reuse
            (lesson_id,run_id,outcome,created_at)
            SELECT ?,run_id,outcome,created_at FROM lesson_reuse WHERE lesson_id=?""", (keep,remove))
        connection.execute("""INSERT OR IGNORE INTO lesson_application
            (lesson_id,run_id,excerpt,evidence_sha256,created_at)
            SELECT ?,run_id,excerpt,evidence_sha256,created_at
            FROM lesson_application WHERE lesson_id=?""", (keep,remove))
        connection.execute('DELETE FROM technical_lesson_evidence WHERE lesson_id=?',(remove,))
        connection.execute('DELETE FROM lesson_reuse WHERE lesson_id=?',(remove,))
        connection.execute('DELETE FROM lesson_application WHERE lesson_id=?',(remove,))
        connection.execute('DELETE FROM technical_lessons WHERE id=?',(remove,))
        connection.execute("""UPDATE technical_lessons SET reuse_count=(
            SELECT COUNT(*) FROM lesson_reuse WHERE lesson_id=?) WHERE id=?""",(keep,keep))
    connection.execute('PRAGMA user_version=9')
    connection.commit()


def _upgrade_to_v10(connection):
    # Contradictions are claims accompanied by observable tool results, not
    # automatic truth judgments. Each distinct run counts at most once.
    connection.execute("""CREATE TABLE IF NOT EXISTS technical_lesson_challenges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_id INTEGER NOT NULL REFERENCES technical_lessons(id),
        run_id INTEGER NOT NULL REFERENCES reflective_runs(id),
        claim TEXT NOT NULL, evidence_excerpt TEXT NOT NULL,
        evidence_sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(lesson_id,run_id,evidence_sha256)
    )""")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_lesson_challenges_lesson ON technical_lesson_challenges(lesson_id)")
    connection.execute('PRAGMA user_version=10')
    connection.commit()


def _upgrade_to_v11(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS technical_lesson_resolutions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_id INTEGER NOT NULL REFERENCES technical_lessons(id),
        challenge_max_id INTEGER NOT NULL,
        verdict TEXT NOT NULL CHECK(verdict IN ('upheld','retired')),
        rationale TEXT NOT NULL,
        verification_run_id INTEGER NOT NULL REFERENCES reflective_runs(id),
        verification_excerpt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(lesson_id,challenge_max_id)
    )""")
    connection.execute('PRAGMA user_version=11')
    connection.commit()


def _upgrade_to_v12(connection):
    # Plan-approval gate (spec 8.6 / HL-FLOW-001): implementation must not start
    # from an unapproved plan. Pre-existing plans are treated as awaiting approval.
    # Self-sufficient: create the table if an earlier partial install lacked it.
    connection.execute("""CREATE TABLE IF NOT EXISTS investigation_plans (
      id TEXT PRIMARY KEY, formulation_id TEXT NOT NULL UNIQUE,
      task_id TEXT NOT NULL, report TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'proposed', approved_at TEXT,
      created_at TEXT NOT NULL
    )""")
    columns = {r[1] for r in connection.execute('PRAGMA table_info(investigation_plans)').fetchall()}
    if 'state' not in columns:
        connection.execute("ALTER TABLE investigation_plans ADD COLUMN state TEXT NOT NULL DEFAULT 'proposed'")
    if 'approved_at' not in columns:
        connection.execute("ALTER TABLE investigation_plans ADD COLUMN approved_at TEXT")
    connection.execute("UPDATE investigation_plans SET state='proposed' WHERE state IS NULL OR state=''")
    connection.execute('PRAGMA user_version=12')
    connection.commit()


def _upgrade_to_v13(connection):
    # FIX-002: Add applied_at and apply_sha256 columns to implementation_runs
    columns = {r[1] for r in connection.execute('PRAGMA table_info(implementation_runs)').fetchall()}
    if 'applied_at' not in columns:
        connection.execute("ALTER TABLE implementation_runs ADD COLUMN applied_at TEXT")
    if 'apply_sha256' not in columns:
        connection.execute("ALTER TABLE implementation_runs ADD COLUMN apply_sha256 TEXT")
    connection.execute('PRAGMA user_version=13')
    connection.commit()


def _upgrade_to_v14(connection):
    # No new tables; v13 added applied_at and apply_sha256 to implementation_runs
    connection.execute('PRAGMA user_version=14')
    connection.commit()


def _upgrade_to_v15(connection):
    # FIX-001 scope enforcement: no schema change, just version bump for tracking
    connection.execute('PRAGMA user_version=15')
    connection.commit()


def _upgrade_to_v16(connection):
    # FIX-002 apply_to_host: no schema change beyond v13, version bump for tracking
    connection.execute('PRAGMA user_version=16')
    connection.commit()


def _upgrade_to_v17(connection):
    # FIX-005: Directed study subsystem (HL-STUDY-001..004)
    connection.execute("""CREATE TABLE IF NOT EXISTS study_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uri TEXT NOT NULL,
        title TEXT,
        sha256 TEXT,
        pages_total INTEGER NOT NULL,
        pages_indexed INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'pdf',
        registered_at TEXT NOT NULL
    )""")
    connection.execute("""CREATE TABLE IF NOT EXISTS study_units (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL REFERENCES study_sources(id),
        ordinal INTEGER NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_page INTEGER NOT NULL,
        end_page INTEGER NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('not_queued','queued','running','completed','failed','blocked')) DEFAULT 'not_queued',
        goal_id TEXT,
        report_path TEXT,
        checks_path TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_id, ordinal)
    )""")
    connection.execute('CREATE INDEX IF NOT EXISTS idx_study_units_source_state ON study_units(source_id, state)')
    connection.execute('PRAGMA user_version=17')
    connection.commit()


def _upgrade_to_v18(connection):
    # FIX-006: Event envelope linking fields (HL-EVENT-001, HL-EVENT-002)
    # Add nullable columns for workflow traceability
    columns = {r[1] for r in connection.execute('PRAGMA table_info(events)').fetchall()}
    new_columns = [
        ('project_id', 'TEXT'),
        ('goal_id', 'TEXT'),
        ('discovery_id', 'TEXT'),
        ('formulation_id', 'TEXT'),
        ('plan_id', 'TEXT'),
        ('run_id', 'TEXT'),
        ('attempt_id', 'TEXT'),
        ('origin', 'TEXT NOT NULL DEFAULT \'unknown\''),
        ('correlation_id', 'TEXT'),
        ('error', 'TEXT'),
    ]
    for col_name, col_type in new_columns:
        if col_name not in columns:
            connection.execute(f'ALTER TABLE events ADD COLUMN {col_name} {col_type}')
    # Indexes for common query patterns
    connection.execute('CREATE INDEX IF NOT EXISTS idx_events_goal_id ON events(goal_id)')
    connection.execute('CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id)')
    connection.execute('CREATE INDEX IF NOT EXISTS idx_events_plan_id ON events(plan_id)')
    connection.execute('CREATE INDEX IF NOT EXISTS idx_events_project_id ON events(project_id)')
    connection.execute('CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events(correlation_id)')
    connection.execute('PRAGMA user_version=18')
    connection.commit()


def _upgrade_to_v19(connection):
    # FIX-010: Add environment provenance, duration_ms, and directory to implementation_evaluations
    # The table may not exist yet (created lazily by _ensure_evaluation_history), so create it if needed.
    tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if 'implementation_evaluations' not in tables:
        connection.execute("""CREATE TABLE IF NOT EXISTS implementation_evaluations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            evaluated_at TEXT NOT NULL,
            previous_state TEXT NOT NULL,
            resulting_state TEXT NOT NULL,
            baseline_json TEXT,
            candidate_json TEXT,
            environment_json TEXT,
            duration_ms INTEGER,
            directory TEXT,
            FOREIGN KEY (run_id) REFERENCES implementation_runs(id)
        )""")
    else:
        columns = {r[1] for r in connection.execute('PRAGMA table_info(implementation_evaluations)').fetchall()}
        new_columns = [
            ('environment_json', 'TEXT'),
            ('duration_ms', 'INTEGER'),
            ('directory', 'TEXT'),
        ]
        for col_name, col_type in new_columns:
            if col_name not in columns:
                connection.execute(f'ALTER TABLE implementation_evaluations ADD COLUMN {col_name} {col_type}')
    connection.execute('PRAGMA user_version=19')
    connection.commit()
