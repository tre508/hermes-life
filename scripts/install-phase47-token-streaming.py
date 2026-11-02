#!/usr/bin/env python3
"""Phase 4.7: forward real Hermes CLI text deltas into the existing chat."""
from pathlib import Path
import ast
import shutil
import datetime

root = Path(__file__).resolve().parents[1]
adapter = root / 'hermes_life/hermes_adapter.py'
chat = root / 'frontend/src/hermes-chat.ts'
css = root / 'frontend/src/hermes-chat.css'
for p in (adapter, chat, css):
    if not p.is_file():
        raise SystemExit(f'Missing required project file: {p}')
a = adapter.read_text()
f = chat.read_text()
c = css.read_text()
if 'PHASE47_STREAMING' in f:
    raise SystemExit('Phase 4.7 already installed; no files changed.')

# Both original adapter and SSH transport use this event filter.
needle = "('system', 'tool_use', 'tool_result', 'result')"
if needle not in a:
    raise SystemExit('Hermes stream-json event filter not found in adapter: refusing to patch.')
a = a.replace(needle, "('system', 'text', 'tool_use', 'tool_result', 'result')")

needle = "let activeTask='';let activeState='idle';let lastSeq=0;let socket:WebSocket|null=null;"
if needle not in f:
    raise SystemExit('Chat task state signature changed: refusing to patch.')
f = f.replace(needle, needle + "\n// PHASE47_STREAMING: incremental assistant output is never inserted into durable history.\nlet liveTask='';let liveText='';let liveBubble:HTMLElement|null=null;\n", 1)

# Use textContent (never HTML) and preserve user's scroll position when reading history.
needle = "async function render(){messages.replaceChildren();"
if needle not in f:
    raise SystemExit('Chat render() signature changed: refusing to patch.')
f = f.replace(needle, """function streamBubble(taskId:string,delta:string){
 if(taskId!==activeTask||!delta)return;
 const stick=followBottom();
 if(liveTask!==taskId){liveTask=taskId;liveText='';liveBubble=null;}
 if(!liveBubble||!liveBubble.isConnected){
   const section=document.createElement('article');section.className='hc-bubble assistant hc-streaming';section.dataset.streamTask=taskId;
   const body=document.createElement('div');body.className='hc-body';body.setAttribute('aria-label','Hermes response streaming');
   section.append(body);messages.append(section);liveBubble=body;
 }
 liveText+=delta;liveBubble.textContent=liveText;
 if(stick)messages.scrollTop=messages.scrollHeight;
}
function clearStream(){liveTask='';liveText='';liveBubble=null;}
async function render(){messages.replaceChildren();""",1)

# Never re-render intermediate output from the database; it is only persisted after result.
needle = 'async function renderFinished(){await render();}'
if needle not in f:
    raise SystemExit('Chat completion handler changed: refusing to patch.')
f = f.replace(needle, 'async function renderFinished(){clearStream();await render();}', 1)

needle = 'function eventItem(e:Evt){if(e.task_id!==activeTask)return;if(e.sequence<=lastSeq)return;lastSeq=e.sequence;'
if needle not in f:
    raise SystemExit('Chat WebSocket handler changed: refusing to patch.')
f = f.replace(needle, needle + "if(e.type==='hermes.text'){const delta=e.payload?.text;if(typeof delta==='string')streamBubble(e.task_id||'',delta);return;}", 1)

# Reset stream on new task/thread, so late events cannot attach to another task.
needle = "activeTask=t.id;activeState=t.state;box.value='';"
if needle not in f:
    raise SystemExit('Chat task creation handler changed: refusing to patch.')
f = f.replace(needle,"clearStream();activeTask=t.id;activeState=t.state;box.value='';",1)
needle = "activeTask='';void render()"
if needle not in f:
    raise SystemExit('Chat thread reset handlers changed: refusing to patch.')
f = f.replace(needle,"clearStream();activeTask='';void render()")
needle = "activeTask='';void render();state('New conversation')"
# also handles versions that modified the handler but preserved its shape
if needle in f:
    f = f.replace(needle,"clearStream();activeTask='';void render();state('New conversation')",1)

# Render can run from conversation open/poll: restore current deltas after replay.
needle = "for(const t of data.turns)addBubble(t.role,t.content,t.created_at,t.task_id,t.id);"
if needle not in f:
    raise SystemExit('Chat history rendering changed: refusing to patch.')
f = f.replace(needle,needle+"if(activeTask&&liveTask===activeTask&&liveText){const text=liveText;clearStream();streamBubble(activeTask,text);}",1)

c += """
/* PHASE47_STREAMING: live Hermes text, distinct from persisted final message. */
#hc-messages .hc-streaming .hc-body { white-space: pre-wrap; overflow-wrap: anywhere; }
#hc-messages .hc-streaming .hc-body::after { content: '▍'; color: #8fdfc7; animation: hc-caret 1s steps(1,end) infinite; }
@keyframes hc-caret { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { #hc-messages .hc-streaming .hc-body::after { animation: none; } }
"""

ast.parse(a)
now = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
for p in (adapter,chat,css):
    shutil.copy2(p,p.with_name(p.name+f'.before-phase47-{now}'))
adapter.write_text(a)
chat.write_text(f)
css.write_text(c)
print('Phase 4.7 installed: genuine Hermes text deltas -> existing WebSocket -> live chat bubble.')
print('Backups created. Restart Hermes Life backend and frontend.')
