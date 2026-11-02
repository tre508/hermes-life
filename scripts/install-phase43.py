#!/usr/bin/env python3
"""Install additive Phase 4.3 recall/revision support on Phase 4.0+4.2."""
from pathlib import Path
import shutil, datetime, ast
root=Path(__file__).resolve().parents[1]
app=root/'hermes_life/app.py'
convo=root/'hermes_life/conversation_memory.py'
front=root/'frontend/src/hermes-chat.ts'
asset=root/'scripts/phase43-assets/conversation_recall.py'
for f in (app,convo,front,asset):
    if not f.is_file():raise SystemExit(f'Missing required file: {f}')
a=app.read_text(); c=convo.read_text(); f=front.read_text()
if 'self.recall = Recall(self.store)' in a:raise SystemExit('Phase 4.3 already installed; no changes made.')
anchors=[
 'from .conversation_memory import ConversationMemory',
 'self.conversations = ConversationMemory(self.store)',
 "context = self.conversations.context(conversation_id, ident) if conversation_id else ''",
 "result = self.adapter.run(context + self.store.task(ident)['prompt'], on_event)",
 '    conversation_id: str | None = None',
 'task = runtime.store.create_task(payload.prompt)',
 "cid = runtime.conversations.add_user_turn(payload.prompt,payload.conversation_id,task['id'])",
 "    @app.get('/api/conversations/{conversation_id}')",
]
for x in anchors:
    if x not in a:raise SystemExit(f'Incompatible backend; missing: {x}')
if "type Turn={role:'user'|'assistant'" not in f or "const note=role==='assistant'?" not in f:raise SystemExit('Incompatible Phase 4.2 chat file; no changes made.')
a=a.replace('from .conversation_memory import ConversationMemory','from .conversation_memory import ConversationMemory\nfrom .conversation_recall import Recall',1)
a=a.replace('    conversation_id: str | None = None','    conversation_id: str | None = None\n    revision_of: int | None = None\n    revision_text: str | None = None',1)
a=a.replace('self.conversations = ConversationMemory(self.store)','self.conversations = ConversationMemory(self.store)\n        self.recall = Recall(self.store)',1)
a=a.replace("result = self.adapter.run(context + self.store.task(ident)['prompt'], on_event)","recall = self.recall.retrieve(self.store.task(ident)['prompt'], conversation_id) if conversation_id else ''\n            result = self.adapter.run(recall + context + self.store.task(ident)['prompt'], on_event)",1)
# Prevalidate revisions before locking/task creation, prevent silent reuse across conversations.
a=a.replace("        if not runtime.adapter.available():\n            raise HTTPException(503, 'Hermes CLI unavailable')", "        if payload.revision_of is not None:\n            if not payload.conversation_id or not payload.revision_text:\n                raise HTTPException(422, 'Revision requires conversation_id and revision_text')\n            if not runtime.recall.revisable(payload.conversation_id, payload.revision_of):\n                raise HTTPException(409, 'Original turn not found or already revised')\n        if not runtime.adapter.available():\n            raise HTTPException(503, 'Hermes CLI unavailable')",1)
a=a.replace("cid = runtime.conversations.add_user_turn(payload.prompt,payload.conversation_id,task['id'])", "cid = runtime.conversations.add_user_turn(payload.prompt,payload.conversation_id,task['id'])\n            if payload.revision_of is not None:\n                runtime.recall.assert_revision(cid, payload.revision_of, payload.revision_text, task['id'])",1)
needle="    @app.get('/api/tasks')"
new_endpoints='''    @app.get('/api/conversations/{conversation_id}/revisions')
    def conversation_revisions(conversation_id: str):
        return {'revisions':runtime.recall.revisions(conversation_id)}

    @app.get('/api/memories')
    def memories(limit: int = 100):
        return {'memories':runtime.recall.list(limit)}

    @app.post('/api/memories', status_code=201)
    def remember(payload: dict):
        try:
            return runtime.recall.remember(payload.get('content',''), payload.get('kind','decision'),
                payload.get('conversation_id'), payload.get('turn_id'), payload.get('supersedes'))
        except (TypeError, ValueError) as exc:
            raise HTTPException(422,str(exc))

'''
if needle not in a:raise SystemExit('Task endpoint anchor missing')
a=a.replace(needle,new_endpoints+needle,1)
# Expose stable IDs in the turn list to support linked revision records.
# Superseded originals remain in immutable history but are excluded from active
# conversation prompt context after a linked revision is submitted.
c=c.replace("WHERE conversation_id=? AND (task_id IS NULL OR task_id != ?) ORDER BY id DESC LIMIT ?", "WHERE conversation_id=? AND (task_id IS NULL OR task_id != ?) AND NOT EXISTS (SELECT 1 FROM hl_turn_revisions v WHERE v.original_turn_id=hl_conversation_turns.id) ORDER BY id DESC LIMIT ?")
c=c.replace("'SELECT role,content,created_at,task_id FROM hl_conversation_turns WHERE conversation_id=? ORDER BY id'", "'SELECT id,role,content,created_at,task_id FROM hl_conversation_turns WHERE conversation_id=? ORDER BY id'")
# Explicit revision requests, only sent when user presses Send.
f=f.replace("type Turn={role:'user'|'assistant'", "type Turn={id:number;role:'user'|'assistant'",1)
f=f.replace("let activeTask='';let activeState", "let pendingRevision:{id:number;content:string}|null=null;\nlet activeTask='';let activeState",1)
f=f.replace("function addBubble(role:'user'|'assistant',content:string,at?:string,taskId?:string|null)", "function addBubble(role:'user'|'assistant',content:string,at?:string,taskId?:string|null,turnId?:number)",1)
start=f.index(" const edit=document.createElement('button');edit.textContent='Edit & rerun';")
end=f.index(';actions.append(edit);', start)+len(';actions.append(edit);')
f=f[:start]+''' const edit=document.createElement('button');edit.textContent='Edit & rerun';
 edit.onclick=()=>{if(!turnId){feedback.textContent='Message ID unavailable; refresh first.';return;}
 const revised=window.prompt(role==='assistant'?'Write a correction to this response:':'Revise this instruction:',content);
 if(revised===null||!revised.trim())return;
 pendingRevision={id:turnId,content:revised.trim()};
 const input=el('hc-input') as HTMLTextAreaElement;
 input.value=role==='assistant'?`Correction to Hermes response (my revision is authoritative):\\n${revised}`:`Revised instruction replacing turn ${turnId}:\\n${revised}\\nDo not automatically repeat completed external actions.`;
 input.focus();feedback.textContent='Revision linked to original turn. Review and press Send to execute; original is preserved.';
 };actions.append(edit);'''+f[end:]
f=f.replace("addBubble(t.role,t.content,t.created_at,t.task_id)","addBubble(t.role,t.content,t.created_at,t.task_id,t.id)",1)
f=f.replace("conversationId='';localStorage.removeItem(stored);activeTask='';", "conversationId='';localStorage.removeItem(stored);activeTask='';pendingRevision=null;",1)
f=f.replace("body:JSON.stringify({prompt,conversation_id:conversationId||null})", "body:JSON.stringify({prompt,conversation_id:conversationId||null,...(pendingRevision?{revision_of:pendingRevision.id,revision_text:pendingRevision.content}:{})})",1)
f=f.replace("activeTask=t.id;activeState=t.state;box.value='';", "activeTask=t.id;activeState=t.state;box.value='';pendingRevision=null;",1)
# Extra opt-in memory capture: user decides what is durable, rather than silently mining every turn.
f=f.replace("actions.append(edit);", "actions.append(edit);\n if(role==='user'&&turnId){const keep=document.createElement('button');keep.textContent='Remember';keep.onclick=async()=>{const content=window.prompt('Save lasting memory (edit for accuracy):',body.textContent||'');if(!content)return;try{await request('/api/memories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,kind:'decision',conversation_id:conversationId,turn_id:turnId})});feedback.textContent='Saved durable memory.';}catch(e){feedback.textContent='Memory not saved: '+String(e)}};actions.append(keep);}",1)
# Smoke parse before edits
ast.parse(a);ast.parse(c)
stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
for file in (app,convo,front):shutil.copy2(file,file.with_name(file.name+'.before-phase43-'+stamp))
shutil.copy2(asset,root/'hermes_life/conversation_recall.py')
app.write_text(a);convo.write_text(c);front.write_text(f)
print('Phase 4.3 installed: cross-conversation recall, explicit memories, linked revisions. Restart backend and frontend.')
