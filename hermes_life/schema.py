"""Explicit, versioned schema setup and single-owner restart recovery."""
from .store import now

SCHEMA_VERSION = 38
DDL = r'''

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY, prompt TEXT NOT NULL, state TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                result TEXT, error TEXT, session_id TEXT,
                applied_persona_sha256 TEXT, applied_memory_ids TEXT, applied_lesson_ids TEXT
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
    if version < 20:
        _upgrade_to_v20(connection)
    if version < 21:
        _upgrade_to_v21(connection)
    if version < 22:
        _upgrade_to_v22(connection)
    if version < 23:
        _upgrade_to_v23(connection)
    if version < 24:
        _upgrade_to_v24(connection)
    if version < 25:
        _upgrade_to_v25(connection)
    if version < 26:
        _upgrade_to_v26(connection)
    if version < 27:
        _upgrade_to_v27(connection)
    if version < 28:
        _upgrade_to_v28(connection)
    if version < 29:
        _upgrade_to_v29(connection)
    if version < 30:
        _upgrade_to_v30(connection)
    if version < 31:
        _upgrade_to_v31(connection)
    if version < 32:
        _upgrade_to_v32(connection)
    if version < 33:
        _upgrade_to_v33(connection)
    if version < 34:
        _upgrade_to_v34(connection)
    if version < 35:
        _upgrade_to_v35(connection)
    if version < 36:
        _upgrade_to_v36(connection)
    if version < 37:
        _upgrade_to_v37(connection)
    if version < 38:
        _upgrade_to_v38(connection)
    # Repair partially-applied v4 installations without touching earlier data.
    has_personality = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_personality'"
    ).fetchone()
    if not has_personality:
        _upgrade_to_v4(connection)
        # A repair must record the CURRENT version: a stale literal here silently downgrades a
        # database that has already been upgraded past it (found while adding v30).
        connection.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
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
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, goal_id TEXT,
        state TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
    )""")
    connection.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_persona_experiences_task'
                       ' ON persona_experiences(task_id)')
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


def _upgrade_to_v20(connection):
    # FIX-013: implementation_reviews table (from implementation_review.py)
    connection.execute("""CREATE TABLE IF NOT EXISTS implementation_reviews (
        run_id TEXT PRIMARY KEY,
        decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected','revision_requested')),
        evidence_sha256 TEXT NOT NULL,
        criteria_json TEXT NOT NULL,
        feedback TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES implementation_runs(id)
    )""")
    connection.execute('PRAGMA user_version=20')
    connection.commit()


def _upgrade_to_v21(connection):
    # FIX-013: implementation_revisions and implementation_review_history tables (from implementation_revision.py)
    connection.execute("""CREATE TABLE IF NOT EXISTS implementation_revisions (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, attempt INTEGER NOT NULL,
        state TEXT NOT NULL, feedback TEXT NOT NULL, snapshot_sha256 TEXT NOT NULL,
        staging_path TEXT, response TEXT, test_json TEXT, error TEXT, original_run_json TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(run_id,attempt), FOREIGN KEY(run_id) REFERENCES implementation_runs(id)
    )""")
    connection.execute("""CREATE TABLE IF NOT EXISTS implementation_review_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
        decision TEXT NOT NULL, evidence_sha256 TEXT NOT NULL,
        criteria_json TEXT NOT NULL, feedback TEXT NOT NULL,
        decided_at TEXT NOT NULL, archived_at TEXT NOT NULL
    )""")
    connection.execute('PRAGMA user_version=21')
    connection.commit()


def _upgrade_to_v22(connection):
    # FIX-013: hl_projects table (from project_workspaces.py)
    connection.execute("""CREATE TABLE IF NOT EXISTS hl_projects (
        name TEXT PRIMARY KEY, host_path TEXT NOT NULL, spec_path TEXT,
        vm_path TEXT, commit_hash TEXT, synced_at TEXT
    )""")
    connection.execute('PRAGMA user_version=22')
    connection.commit()


def _upgrade_to_v23(connection):
    # FIX-013: Conversation memory tables (from conversation_memory.py)
    connection.execute("""CREATE TABLE IF NOT EXISTS hl_conversations (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'New conversation'
    )""")
    connection.execute("""CREATE TABLE IF NOT EXISTS hl_conversation_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL,
        task_id TEXT, role TEXT NOT NULL CHECK(role IN ('user','assistant')),
        content TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY(conversation_id) REFERENCES hl_conversations(id)
    )""")
    connection.execute('CREATE INDEX IF NOT EXISTS idx_hl_turns_conversation ON hl_conversation_turns(conversation_id,id)')
    connection.execute('CREATE INDEX IF NOT EXISTS idx_hl_turns_task ON hl_conversation_turns(task_id)')
    connection.execute('PRAGMA user_version=23')
    connection.commit()


def _upgrade_to_v24(connection):
    # FIX-013: Vault memory tables (from conversation_recall.py and vault_memory.py)
    # hl_memories and hl_turn_revisions from conversation_recall.py
    connection.execute("""CREATE TABLE IF NOT EXISTS hl_memories (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, kind TEXT NOT NULL,
        source_conversation_id TEXT, source_turn_id INTEGER,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded')),
        superseded_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        evidence_excerpt TEXT, origin TEXT, confidence REAL, expires_at TEXT,
        rationale TEXT, decided_by TEXT
    )""")
    connection.execute('CREATE INDEX IF NOT EXISTS idx_hl_memories_status ON hl_memories(status)')
    connection.execute("""CREATE TABLE IF NOT EXISTS hl_turn_revisions (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
        original_turn_id INTEGER NOT NULL, revised_content TEXT NOT NULL,
        task_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
        FOREIGN KEY(original_turn_id) REFERENCES hl_conversation_turns(id)
    )""")
    # hl_memory_extraction_runs and hl_memory_reviews from vault_memory.py
    connection.execute("""CREATE TABLE IF NOT EXISTS hl_memory_extraction_runs (
        task_id TEXT PRIMARY KEY, state TEXT NOT NULL, note TEXT, completed_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""")
    connection.execute("""CREATE TABLE IF NOT EXISTS hl_memory_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
        candidate TEXT NOT NULL, existing_memory_id TEXT, reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        evidence_excerpt TEXT, origin TEXT, resolution_rationale TEXT, resolved_by TEXT
    )""")
    connection.execute('PRAGMA user_version=24')
    connection.commit()


def _upgrade_to_v25(connection):
    # FIX-013: Knowledge library tables (from knowledge_library.py)
    connection.execute("""CREATE TABLE IF NOT EXISTS library_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'document', sha256 TEXT,
        revision TEXT, status TEXT NOT NULL DEFAULT 'registered',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )""")
    connection.execute("""CREATE TABLE IF NOT EXISTS library_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL REFERENCES library_sources(id),
        page INTEGER NOT NULL CHECK(page>0), ordinal INTEGER NOT NULL,
        content TEXT NOT NULL, sha256 TEXT NOT NULL,
        UNIQUE(source_id,page,ordinal)
    )""")
    connection.execute('CREATE INDEX IF NOT EXISTS idx_library_chunks_source ON library_chunks(source_id,page)')
    connection.execute('PRAGMA user_version=25')
    connection.commit()


def _upgrade_to_v26(connection):
    # FIX-013: implementation_environments table (from implementation.py:_ensure_environment_history)
    connection.execute("""CREATE TABLE IF NOT EXISTS implementation_environments (
        run_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        python_version TEXT,
        interpreter TEXT,
        manifest_json TEXT NOT NULL,
        packages_json TEXT,
        install_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES implementation_runs(id)
    )""")
    connection.execute('PRAGMA user_version=26')
    connection.commit()


def _upgrade_to_v27(connection):
    # FIX-013: implementation_reviews table (from implementation_review.py)
    connection.execute("""CREATE TABLE IF NOT EXISTS implementation_reviews (
        run_id TEXT PRIMARY KEY,
        decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected','revision_requested')),
        evidence_sha256 TEXT NOT NULL,
        criteria_json TEXT NOT NULL,
        feedback TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES implementation_runs(id)
    )""")
    connection.execute('PRAGMA user_version=27')
    connection.commit()


def _upgrade_to_v28(connection):
    # HL-VERIFY-001: independent acceptance verification. verification_plans carries the
    # plan-level deliverable class; verification_criteria holds each criterion verbatim plus
    # its compiled checks; verification_runs/verification_checks record what was executed.
    connection.execute("""CREATE TABLE IF NOT EXISTS verification_plans (
        plan_id TEXT PRIMARY KEY, deliverable_class TEXT NOT NULL, compiled_at TEXT NOT NULL,
        compiler_note TEXT)""")
    connection.execute("""CREATE TABLE IF NOT EXISTS verification_criteria (
        plan_id TEXT NOT NULL, ordinal INTEGER NOT NULL, criterion_text TEXT NOT NULL,
        method TEXT, expected TEXT, evidence_required TEXT, auto_verifiable INTEGER NOT NULL,
        check_json TEXT, created_at TEXT NOT NULL, PRIMARY KEY(plan_id, ordinal))""")
    connection.execute("""CREATE TABLE IF NOT EXISTS verification_runs (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, attempt INTEGER NOT NULL, state TEXT NOT NULL,
        disposition TEXT, deliverable_class TEXT, blocker TEXT, criteria_json TEXT,
        evidence_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(run_id, attempt))""")
    connection.execute("""CREATE TABLE IF NOT EXISTS verification_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, verification_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
        kind TEXT NOT NULL, status TEXT NOT NULL, command TEXT, cwd TEXT, exit_code INTEGER,
        output TEXT, output_sha256 TEXT, detail TEXT, duration_ms INTEGER, created_at TEXT NOT NULL)""")
    connection.execute('PRAGMA user_version=28')
    connection.commit()


def _upgrade_to_v29(connection):
    # HL-VERIFY-001 part D: who requested a revision, and whether verification may request
    # one unattended. NULL decided_by means a human (every row written before this version).
    reviews = {r[1] for r in connection.execute('PRAGMA table_info(implementation_reviews)')}
    if 'decided_by' not in reviews:
        connection.execute('ALTER TABLE implementation_reviews ADD COLUMN decided_by TEXT')
    history = {r[1] for r in connection.execute('PRAGMA table_info(implementation_review_history)')}
    if 'decided_by' not in history:
        connection.execute('ALTER TABLE implementation_review_history ADD COLUMN decided_by TEXT')
    runs = {r[1] for r in connection.execute('PRAGMA table_info(verification_runs)')}
    if runs and 'auto_revision_json' not in runs:
        connection.execute('ALTER TABLE verification_runs ADD COLUMN auto_revision_json TEXT')
    connection.execute('''CREATE TABLE IF NOT EXISTS verification_settings (
        id INTEGER PRIMARY KEY CHECK(id=1), auto_revision INTEGER NOT NULL DEFAULT 1)''')
    connection.execute('INSERT OR IGNORE INTO verification_settings(id,auto_revision) VALUES(1,1)')
    connection.execute('PRAGMA user_version=29')
    connection.commit()


def _upgrade_to_v30(connection):
    # HL-PERS-001 §5B/§5D/§5E: a learned attribute must retain its supporting evidence, its origin
    # (explicit user statement vs model inference) and its validity, and a correction must record who
    # decided it and why. Legacy rows keep NULL origin: unknown is not the same as explicitly stated,
    # and NULL sorts as "not explicit" in the profile ordering.
    columns = {r[1] for r in connection.execute('PRAGMA table_info(hl_memories)')}
    for name, ddl in (('evidence_excerpt', 'TEXT'), ('origin', 'TEXT'), ('confidence', 'REAL'),
                      ('expires_at', 'TEXT'), ('rationale', 'TEXT'), ('decided_by', 'TEXT')):
        if columns and name not in columns:
            connection.execute(f'ALTER TABLE hl_memories ADD COLUMN {name} {ddl}')
    connection.execute('PRAGMA user_version=30')
    connection.commit()


def _upgrade_to_v31(connection):
    # HL-PERS-001 §5F / §3 Consolidation: a correction to a learned memory must record who made it,
    # why, and when — otherwise "corrected" is indistinguishable from "silently dropped". A reviewed
    # candidate must also be mergeable, because a duplicate that adds nothing needs no replacement.
    connection.execute("""CREATE TABLE IF NOT EXISTS hl_memory_corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('supersede','delete','merge')),
        actor TEXT, rationale TEXT, new_memory_id TEXT, created_at TEXT NOT NULL
    )""")
    connection.execute('CREATE INDEX IF NOT EXISTS idx_hl_memory_corrections_memory'
                       ' ON hl_memory_corrections(memory_id, id)')
    columns = {r[1] for r in connection.execute('PRAGMA table_info(hl_memory_reviews)')}
    for name, ddl in (('evidence_excerpt', 'TEXT'), ('origin', 'TEXT'),
                      ('resolution_rationale', 'TEXT'), ('resolved_by', 'TEXT')):
        if columns and name not in columns:
            connection.execute(f'ALTER TABLE hl_memory_reviews ADD COLUMN {name} {ddl}')
    connection.execute('PRAGMA user_version=31')
    connection.commit()


def _upgrade_to_v32(connection):
    # HL-PERS-001 §7 #5 / PA-04: a run must record which personality context it received, or
    # "the profile adapted future behaviour" is unfalsifiable. Implementation evaluations already
    # record their environment; tasks recording nothing was the inconsistency.
    columns = {r[1] for r in connection.execute('PRAGMA table_info(tasks)')}
    for name in ('applied_persona_sha256', 'applied_memory_ids', 'applied_lesson_ids'):
        if columns and name not in columns:
            connection.execute(f'ALTER TABLE tasks ADD COLUMN {name} TEXT')
    connection.execute('PRAGMA user_version=32')
    connection.commit()


def _upgrade_to_v33(connection):
    # HL-PERS-001 §2 layer 2 / §3 Experience: "experience" is a terminal, user-facing task outcome, not
    # an internal adapter call. persona_experiences — the store the spec built for this layer — gains the
    # task/goal it belongs to, and a unique task_id so one task contributes exactly one experience.
    columns = {r[1] for r in connection.execute('PRAGMA table_info(persona_experiences)')}
    if columns:
        for name in ('task_id', 'goal_id'):
            if name not in columns:
                connection.execute(f'ALTER TABLE persona_experiences ADD COLUMN {name} TEXT')
    else:
        connection.execute("""CREATE TABLE IF NOT EXISTS persona_experiences (
            id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, goal_id TEXT,
            state TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL)""")
    connection.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_persona_experiences_task'
                       ' ON persona_experiences(task_id)')
    connection.execute('PRAGMA user_version=33')
    connection.commit()


def _upgrade_to_v34(connection):
    # HL-AUTO-001 Phase 1 (§26.10): shared persistence + policy for autonomous initiative.
    # Versioned opportunity/decision/portfolio records, audit grants and budget accounting.
    # SQLite remains authoritative; dedupe fingerprints and idempotency keys are unique.
    connection.execute("""CREATE TABLE IF NOT EXISTS autonomy_policy_settings (
        id INTEGER PRIMARY KEY CHECK(id=1),
        mode TEXT NOT NULL DEFAULT 'observe'
            CHECK(mode IN ('observe','suggest','guided','independent')),
        allowlist TEXT NOT NULL DEFAULT '[]',
        policy_version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL)""")
    connection.execute("""CREATE TABLE IF NOT EXISTS autonomy_opportunities (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL CHECK(source_type IN
            ('task_outcome','user_correction','repeated_workflow','skill_gap',
             'project_signal','explicit_interest')),
        title TEXT NOT NULL,
        problem TEXT NOT NULL,
        benefit_hypothesis TEXT,
        evidence_refs TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0.5 CHECK(confidence>=0 AND confidence<=1),
        dedupe_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'candidate'
            CHECK(status IN ('candidate','dismissed','proposed','ineligible')),
        project_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
    connection.execute('CREATE INDEX IF NOT EXISTS idx_autonomy_opportunities_status'
                       ' ON autonomy_opportunities(status, created_at)')
    connection.execute("""CREATE TABLE IF NOT EXISTS project_proposals (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL REFERENCES autonomy_opportunities(id),
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        specification TEXT NOT NULL,
        feasibility TEXT, estimated_cost TEXT, acceptance_criteria TEXT,
        policy_snapshot TEXT,
        status TEXT NOT NULL DEFAULT 'draft'
            CHECK(status IN ('draft','awaiting_approval','approved','rejected','superseded')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(opportunity_id, version))""")
    connection.execute("""CREATE TABLE IF NOT EXISTS autonomy_grants (
        id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        project_id TEXT,
        scope TEXT NOT NULL DEFAULT '{}',
        decision TEXT NOT NULL CHECK(decision IN ('granted','denied','expired','revoked')),
        actor TEXT NOT NULL DEFAULT 'system',
        rationale TEXT,
        policy_version INTEGER NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL)""")
    connection.execute('CREATE INDEX IF NOT EXISTS idx_autonomy_grants_action'
                       ' ON autonomy_grants(action_type, decision, created_at)')
    connection.execute("""CREATE TABLE IF NOT EXISTS budget_ledger (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        resource TEXT NOT NULL CHECK(resource IN ('time_seconds','tokens','storage_bytes','concurrency')),
        limit_amount REAL NOT NULL,
        used REAL NOT NULL DEFAULT 0,
        window_start TEXT NOT NULL, window_end TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(project_id, resource, window_start))""")
    connection.execute("""CREATE TABLE IF NOT EXISTS autonomy_decisions (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT REFERENCES autonomy_opportunities(id),
        action TEXT NOT NULL CHECK(action IN
            ('learn','propose_project','resume_existing','no_action','blocked')),
        scores TEXT, policy_version INTEGER NOT NULL,
        rationale TEXT NOT NULL,
        disposition TEXT NOT NULL DEFAULT 'recorded',
        created_at TEXT NOT NULL)""")
    connection.execute('CREATE INDEX IF NOT EXISTS idx_autonomy_decisions_created'
                       ' ON autonomy_decisions(created_at)')
    # Single-row policy settings: seed the default (Observe mode = no background execution).
    connection.execute("""INSERT INTO autonomy_policy_settings (id, updated_at)
        SELECT 1, ? WHERE NOT EXISTS (SELECT 1 FROM autonomy_policy_settings WHERE id=1)""",
        (now(),))
    connection.execute('PRAGMA user_version=34')
    connection.commit()


def _upgrade_to_v35(connection):
    # HL-AUTO-001 Phase 2 (§26.10): opportunity + learning. Skill evidence must come from a
    # real exercise run (task_id), never a claimed expertise; ingestion is fingerprint-keyed
    # so unchanged sources cannot spin an infinite loop.
    connection.execute("""CREATE TABLE IF NOT EXISTS initiative_settings (
        id INTEGER PRIMARY KEY CHECK(id=1),
        last_scan TEXT, last_error TEXT,
        weights TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL)""")
    connection.execute("""INSERT INTO initiative_settings (id, updated_at)
        SELECT 1, ? WHERE NOT EXISTS (SELECT 1 FROM initiative_settings WHERE id=1)""", (now(),))
    connection.execute("""CREATE TABLE IF NOT EXISTS learning_objectives (
        id TEXT PRIMARY KEY,
        skill TEXT NOT NULL,
        gap_source TEXT NOT NULL CHECK(gap_source IN ('failed_task','proposal_requirement','explicit_request')),
        evidence_refs TEXT NOT NULL DEFAULT '[]',
        dedupe_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'open'
            CHECK(status IN ('open','queued','exercised','verified','blocked','dismissed')),
        study_resource TEXT,
        confidence REAL NOT NULL DEFAULT 0.5 CHECK(confidence>=0 AND confidence<=1),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
    connection.execute('CREATE INDEX IF NOT EXISTS idx_learning_objectives_status'
                       ' ON learning_objectives(status, updated_at)')
    connection.execute("""CREATE TABLE IF NOT EXISTS skill_evidence (
        id TEXT PRIMARY KEY,
        objective_id TEXT NOT NULL REFERENCES learning_objectives(id),
        task_id TEXT NOT NULL,
        exercise_ref TEXT,
        result TEXT NOT NULL CHECK(result IN ('passed','failed')),
        evidence TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(objective_id, task_id))""")
    connection.execute('PRAGMA user_version=35')
    connection.commit()


def _upgrade_to_v36(connection):
    # HL-AUTO-001 Phase 3 (§26.10): proposals -> project bootstrap. Autonomous projects are
    # VM identities; host registration/apply stays a separate authorization (§26.7).
    connection.execute("""CREATE TABLE IF NOT EXISTS autonomy_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        origin TEXT NOT NULL CHECK(origin IN ('user','autonomous')),
        proposal_id TEXT REFERENCES project_proposals(id),
        vm_path TEXT NOT NULL,
        spec_sha256 TEXT,
        status TEXT NOT NULL DEFAULT 'initializing'
            CHECK(status IN ('initializing','active','paused','blocked','failed',
                             'cancelled','archived')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
    connection.execute("""CREATE TABLE IF NOT EXISTS project_bootstraps (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL REFERENCES project_proposals(id),
        project_name TEXT NOT NULL,
        vm_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN
            ('initializing','active','rolled_back','failed','recovery_required')),
        steps_done TEXT NOT NULL DEFAULT '[]',
        spec_sha256 TEXT, base_commit TEXT, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(proposal_id))""")
    connection.execute('CREATE INDEX IF NOT EXISTS idx_project_bootstraps_status'
                       ' ON project_bootstraps(status)')
    connection.execute('PRAGMA user_version=36')
    connection.commit()


def _upgrade_to_v37(connection):
    # HL-AUTO-001 Phase 4 (§26.10): portfolio orchestration. Milestones are durable, ordered,
    # dependency-resolvable work items; a milestone's goal is its lease, so one milestone has
    # at most one live goal and restarts reconcile instead of duplicating.
    connection.execute("""CREATE TABLE IF NOT EXISTS project_milestones (
        id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL REFERENCES autonomy_projects(name),
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        dependency_ids TEXT NOT NULL DEFAULT '[]',
        acceptance_criteria TEXT,
        estimated_seconds REAL,
        state TEXT NOT NULL DEFAULT 'pending'
            CHECK(state IN ('pending','ready','in_progress','completed','blocked','failed','cancelled')),
        goal_id TEXT,
        blocker TEXT,
        checkpoint TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
    connection.execute('CREATE INDEX IF NOT EXISTS idx_project_milestones_project'
                       ' ON project_milestones(project_name, state, order_index)')
    connection.execute('PRAGMA user_version=37')
    connection.commit()


def _upgrade_to_v38(connection):
    # HL-AUTO-001 Phase 5 (§26.10): execution + experience. Every milestone outcome is
    # scored against its recorded expectation with links to the real task/run artifacts;
    # lessons require outcome evidence. UNIQUE(project, milestone, task) keeps scoring
    # idempotent across restarts.
    connection.execute("""CREATE TABLE IF NOT EXISTS experience_records (
        id TEXT PRIMARY KEY,
        project_name TEXT,
        milestone_id TEXT REFERENCES project_milestones(id),
        goal_id TEXT, task_id TEXT, run_id TEXT,
        expected_result TEXT NOT NULL,
        measured_result TEXT NOT NULL,
        classification TEXT NOT NULL CHECK(classification IN ('success','failure','partial')),
        evidence_refs TEXT NOT NULL DEFAULT '[]',
        lesson TEXT,
        confidence REAL NOT NULL DEFAULT 0.5 CHECK(confidence>=0 AND confidence<=1),
        created_at TEXT NOT NULL,
        UNIQUE(project_name, milestone_id, task_id))""")
    connection.execute('CREATE INDEX IF NOT EXISTS idx_experience_records_project'
                       ' ON experience_records(project_name, created_at)')
    connection.execute('PRAGMA user_version=38')
    connection.commit()
