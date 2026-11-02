import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


def now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path):
        path = Path(path).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(str(path), check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.connection.execute('PRAGMA journal_mode=WAL')
            self.connection.executescript('''
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
            ''')
            self.connection.execute("UPDATE tasks SET state='interrupted', updated_at=? WHERE state IN ('running','queued')", (now(),))
            self.connection.execute("UPDATE agent_state SET state='idle',current_task=NULL,updated_at=? WHERE id=1", (now(),))
            self.connection.commit()

    def create_task(self, prompt):
        ident = str(uuid4())
        timestamp = now()
        with self.lock:
            self.connection.execute('INSERT INTO tasks (id,prompt,state,created_at,updated_at) VALUES (?,?,?,?,?)',
                                    (ident, prompt, 'queued', timestamp, timestamp))
            self.connection.commit()
        return self.task(ident)

    def task(self, ident):
        with self.lock:
            row = self.connection.execute('SELECT * FROM tasks WHERE id=?', (ident,)).fetchone()
            return dict(row) if row else None

    def tasks(self):
        with self.lock:
            return [dict(r) for r in self.connection.execute('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100')]

    def update_task(self, ident, state, **fields):
        allowed = {k:v for k,v in fields.items() if k in {'result','error','session_id'}}
        cols = ['state=?','updated_at=?'] + [f'{k}=?' for k in allowed]
        vals = [state, now(), *allowed.values(), ident]
        with self.lock:
            self.connection.execute(f"UPDATE tasks SET {','.join(cols)} WHERE id=?", vals)
            self.connection.commit()

    def set_agent(self, state, task_id=None):
        with self.lock:
            self.connection.execute('UPDATE agent_state SET state=?,current_task=?,updated_at=? WHERE id=1',
                                    (state, task_id, now()))
            self.connection.commit()

    def agent(self):
        with self.lock:
            return dict(self.connection.execute('SELECT state,current_task,updated_at FROM agent_state WHERE id=1').fetchone())

    def emit(self, kind, payload, task_id=None):
        evt = {'id':str(uuid4()),'type':kind,'timestamp':now(),'task_id':task_id,'payload':payload}
        with self.lock:
            cur = self.connection.execute('INSERT INTO events (id,task_id,type,timestamp,payload) VALUES (?,?,?,?,?)',
                                          (evt['id'],task_id,kind,evt['timestamp'],json.dumps(payload)))
            self.connection.commit()
            evt['sequence'] = cur.lastrowid
        return evt

    def events(self, after=0, limit=200):
        with self.lock:
            rows = self.connection.execute('SELECT * FROM events WHERE sequence>? ORDER BY sequence LIMIT ?',
                                           (after, min(limit,500))).fetchall()
            return [{**dict(r), 'payload':json.loads(r['payload'])} for r in rows]

    def world(self):
        with self.lock:
            return dict(self.connection.execute(
                'SELECT room,activity,agent_x,agent_y,last_sequence,updated_at FROM world_state WHERE id=1'
            ).fetchone())

    def set_world(self, room, activity, x, y, last_sequence=0):
        with self.lock:
            self.connection.execute(
                'UPDATE world_state SET room=?,activity=?,agent_x=?,agent_y=?,last_sequence=?,updated_at=? WHERE id=1',
                (room, activity, x, y, last_sequence, now()))
            self.connection.commit()
        return self.world()
