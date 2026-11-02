#!/usr/bin/env python3
"""Non-destructive source integration for Hermes Life Phase 4.0."""
from pathlib import Path
import shutil, datetime
ROOT=Path(__file__).resolve().parents[1]
app=ROOT/'hermes_life/app.py'
front=ROOT/'frontend/src/main.ts'
if not app.exists() or not front.exists():raise SystemExit('Run installer from the Hermes Life project root.')
a=app.read_text();f=front.read_text()
if 'self.conversations = ConversationMemory(self.store)' in a:
    print('Already installed.');raise SystemExit(0)
anchors=['from .personality import Personality, PersonalityAdapter','self.personality = Personality(self.store)','def run_task(self, ident):','result = self.adapter.run(self.store.task(ident)[\'prompt\'], on_event)','self.store.update_task(ident, \'completed\', **result)','self.store.update_task(ident, \'failed\', error=str(exc))','class TaskInput(BaseModel):','task = runtime.store.create_task(payload.prompt)','threading.Thread(target=runtime.run_task,args=(task[\'id\'],),daemon=True).start()']
for marker in anchors:
    if marker not in a:raise SystemExit('Incompatible app.py; missing '+marker)
if 'body:JSON.stringify({prompt})' not in f:raise SystemExit('Incompatible frontend submit handler; no change applied')
stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
for file in (app,front):shutil.copy2(file,file.with_name(file.name+'.before-phase40-'+stamp))
a=a.replace('from .personality import Personality, PersonalityAdapter','from .personality import Personality, PersonalityAdapter\nfrom .conversation_memory import ConversationMemory')
a=a.replace('    prompt: str = Field(min_length=1, max_length=20000)\n\nclass Runtime:', '    prompt: str = Field(min_length=1, max_length=20000)\n    conversation_id: str | None = None\n\nclass Runtime:')
a=a.replace('self.personality = Personality(self.store)','self.personality = Personality(self.store)\n        self.conversations = ConversationMemory(self.store)')
a=a.replace("result = self.adapter.run(self.store.task(ident)['prompt'], on_event)","conversation_id = self.conversations.conversation_for_task(ident)\n            context = self.conversations.context(conversation_id, ident) if conversation_id else ''\n            result = self.adapter.run(context + self.store.task(ident)['prompt'], on_event)")
a=a.replace("self.store.update_task(ident, 'completed', **result)","self.store.update_task(ident, 'completed', **result)\n            if conversation_id: self.conversations.finish(conversation_id, ident, result)")
a=a.replace("self.store.update_task(ident, 'failed', error=str(exc))","self.store.update_task(ident, 'failed', error=str(exc))\n            conversation_id = self.conversations.conversation_for_task(ident)\n            if conversation_id: self.conversations.finish(conversation_id, ident, {'error':str(exc)})")
a=a.replace("task = runtime.store.create_task(payload.prompt)","task = runtime.store.create_task(payload.prompt)\n            cid = runtime.conversations.add_user_turn(payload.prompt,payload.conversation_id,task['id'])\n            task['conversation_id'] = cid")
needle="    @app.get('/api/tasks')"
if needle not in a: raise SystemExit('Missing tasks endpoint')
a=a.replace(needle,"    @app.get('/api/conversations')\n    def conversations():\n        return {'conversations':runtime.conversations.list()}\n\n    @app.get('/api/conversations/{conversation_id}')\n    def conversation(conversation_id: str):\n        return {'conversation_id':conversation_id,'turns':runtime.conversations.turns(conversation_id)}\n\n"+needle)
f=f.replace('body:JSON.stringify({prompt})',"body:JSON.stringify({prompt,conversation_id:localStorage.getItem('hermes-life-conversation-id')})")
f=f.replace("$('task-feedback').textContent=`Task accepted: ${body.id}`;", "if(body.conversation_id)localStorage.setItem('hermes-life-conversation-id',body.conversation_id);\n    $('task-feedback').textContent=`Task accepted: ${body.id}`;")
app.write_text(a);front.write_text(f)
print('Phase 4.0 installed. Vault path is configured with HERMES_LIFE_OBSIDIAN_VAULT. Restart backend/frontend.')
