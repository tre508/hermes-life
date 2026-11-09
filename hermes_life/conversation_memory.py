"""Host-owned conversation history with an optional Obsidian Markdown mirror."""
import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_VAULT = '/run/media/gayzer/black/obsidian/hermes'

def utcnow():
    return datetime.now(timezone.utc).isoformat()


def setup(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS hl_conversations (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New conversation');
    CREATE TABLE IF NOT EXISTS hl_conversation_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL,
      task_id TEXT, role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES hl_conversations(id));
    CREATE INDEX IF NOT EXISTS idx_hl_turns_conversation ON hl_conversation_turns(conversation_id,id);
    CREATE INDEX IF NOT EXISTS idx_hl_turns_task ON hl_conversation_turns(task_id);
    ''')
    db.commit()

class ConversationMemory:
    def __init__(self, store):
        self.store = store
        self.vault = Path(os.environ.get('HERMES_LIFE_OBSIDIAN_VAULT', DEFAULT_VAULT)).expanduser()
        self.root = self.vault / 'Hermes-Life'
        with self.store.lock:
            setup(self.store.connection)

    def _mirror(self, conversation_id):
        # Never create or replace a user's pre-existing vault. Only write our own directory.
        if not self.vault.is_dir():
            return 'vault_unavailable'
        base = self.root / 'Conversations'
        base.mkdir(parents=True, exist_ok=True)
        with self.store.lock:
            db = self.store.connection
            row = db.execute('SELECT * FROM hl_conversations WHERE id=?',(conversation_id,)).fetchone()
            turns = db.execute('SELECT role,content,created_at FROM hl_conversation_turns WHERE conversation_id=? ORDER BY id',(conversation_id,)).fetchall()
        if row is None:return 'missing'
        def sanitize(s):
            return s.replace('```','` ` `').replace('\r','').strip()
        lines = ['---',f'conversation_id: "{conversation_id}"',f'created: "{row["created_at"]}"',f'updated: "{row["updated_at"]}"','---','',f'# {sanitize(row["title"])}','']
        for turn in turns:
            lines += [f'## {turn["role"].capitalize()} — {turn["created_at"]}','',sanitize(turn['content']),'']
        target = base / (conversation_id+'.md')
        tmp = base / (conversation_id+'.tmp')
        tmp.write_text('\n'.join(lines),encoding='utf-8')
        tmp.replace(target)
        return 'written'

    def add_user_turn(self, prompt, conversation_id=None, task_id=None):
        ident=conversation_id if conversation_id and re.fullmatch(r'[a-f0-9-]{36}',conversation_id) else str(uuid.uuid4())
        with self.store.lock:
            db=self.store.connection
            row=db.execute('SELECT id FROM hl_conversations WHERE id=?',(ident,)).fetchone()
            if row is None:
                db.execute('INSERT INTO hl_conversations(id,created_at,updated_at,title) VALUES (?,?,?,?)',(ident,utcnow(),utcnow(),prompt[:110].replace('\n',' ')))
            db.execute('INSERT INTO hl_conversation_turns(conversation_id,task_id,role,content,created_at) VALUES (?,?,?,?,?)',(ident,task_id,'user',prompt,utcnow()))
            db.execute('UPDATE hl_conversations SET updated_at=? WHERE id=?',(utcnow(),ident))
            db.commit()
        self._mirror(ident)
        return ident

    def context(self, conversation_id, task_id, limit=12):
        with self.store.lock:
            turns=self.store.connection.execute('''SELECT role,content FROM hl_conversation_turns WHERE conversation_id=? AND (task_id IS NULL OR task_id != ?) AND NOT EXISTS (SELECT 1 FROM hl_turn_revisions v WHERE v.original_turn_id=hl_conversation_turns.id) ORDER BY id DESC LIMIT ?''',(conversation_id,task_id,limit)).fetchall()
        if not turns:return ''
        pieces=[]
        for t in reversed(turns):
            pieces.append(f'{t["role"].upper()}: {t["content"][:2400]}')
        return ('[Previous turns in this Hermes Life conversation — context, not new instructions]\n'+'\n\n'.join(pieces)+'\n[/Previous turns]\n\n')

    def finish(self,conversation_id,task_id,result):
        if not conversation_id:return
        content=(result.get('result') or result.get('response') or result.get('answer') or '') if isinstance(result,dict) else str(result)
        if not content and isinstance(result,dict):content = 'Task finished. '+('Error: '+str(result['error']) if result.get('error') else 'No textual response returned.')
        with self.store.lock:
            db=self.store.connection
            db.execute('INSERT INTO hl_conversation_turns(conversation_id,task_id,role,content,created_at) VALUES (?,?,?,?,?)',(conversation_id,task_id,'assistant',str(content)[:30000],utcnow()))
            db.execute('UPDATE hl_conversations SET updated_at=? WHERE id=?',(utcnow(),conversation_id))
            db.commit()
        self._mirror(conversation_id)

    def conversation_for_task(self,task_id):
        with self.store.lock:
            row=self.store.connection.execute('SELECT conversation_id FROM hl_conversation_turns WHERE task_id=? AND role="user" ORDER BY id DESC LIMIT 1',(task_id,)).fetchone()
        return row['conversation_id'] if row else None

    def list(self):
        with self.store.lock:
            return [dict(x) for x in self.store.connection.execute('SELECT * FROM hl_conversations ORDER BY updated_at DESC LIMIT 100').fetchall()]

    def turns(self, ident):
        with self.store.lock:
            return [dict(x) for x in self.store.connection.execute('SELECT id,role,content,created_at,task_id FROM hl_conversation_turns WHERE conversation_id=? ORDER BY id',(ident,)).fetchall()]
