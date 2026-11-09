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
        self.connection.execute('PRAGMA journal_mode=WAL')

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

    def emit(self, kind, payload, task_id=None, **links):
        """Emit an event with optional linking fields for workflow traceability.

        HL-EVENT-001: Events carry project_id, goal_id, discovery_id, formulation_id,
        plan_id, run_id, attempt_id, origin, correlation_id, error.
        Existing call sites pass only (kind, payload, task_id) and continue working.
        """
        allowed_links = {
            'project_id', 'goal_id', 'discovery_id', 'formulation_id',
            'plan_id', 'run_id', 'attempt_id', 'origin', 'correlation_id', 'error'
        }
        link_values = {k: v for k, v in links.items() if k in allowed_links}
        # Default origin to 'unknown' for backward compatibility
        if 'origin' not in link_values:
            link_values['origin'] = 'unknown'

        evt = {'id': str(uuid4()), 'type': kind, 'timestamp': now(), 'task_id': task_id,
               'payload': json.dumps(payload), **link_values}
        with self.lock:
            cols = ['id', 'task_id', 'type', 'timestamp', 'payload'] + list(link_values.keys())
            placeholders = ','.join(['?'] * len(cols))
            cur = self.connection.execute(
                f'INSERT INTO events ({",".join(cols)}) VALUES ({placeholders})',
                [evt[c] for c in cols]
            )
            self.connection.commit()
            evt['sequence'] = cur.lastrowid
        return evt

    def events(self, after=0, limit=200, tail=None, **filters):
        """Get events after a sequence number, optionally filtered by linking fields.

        HL-EVENT-002: Supports filtering by project_id, goal_id, run_id, plan_id,
        correlation_id, etc. for single-query timelines.

        UI-VIS-002: `tail=N` returns the newest N events instead of the oldest ones after
        `after`. A client that wants "recent activity, then live" would otherwise have to read
        the entire log from sequence 0 and then replay it as if it were live.
        """
        allowed_filters = {
            'project_id', 'goal_id', 'discovery_id', 'formulation_id',
            'plan_id', 'run_id', 'attempt_id', 'correlation_id',
            'task_id',
        }
        where_clauses = ['sequence > ?']
        params = [after]

        for key, value in filters.items():
            if key in allowed_filters and value is not None:
                where_clauses.append(f'{key} = ?')
                params.append(value)

        where = ' AND '.join(where_clauses)
        if tail:
            params.append(min(int(tail), 500))
            query = (f'SELECT * FROM events WHERE {where} ORDER BY sequence DESC LIMIT ?')
        else:
            params.append(min(limit, 500))
            query = (f'SELECT * FROM events WHERE {where} ORDER BY sequence LIMIT ?')

        with self.lock:
            rows = self.connection.execute(query, params).fetchall()
            if tail:
                rows = list(reversed(rows))
            return [{**dict(r), 'payload': json.loads(r['payload'])} for r in rows]

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
