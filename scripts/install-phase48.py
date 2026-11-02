#!/usr/bin/env python3
"""Targeted Hermes Life chat scroll and world activity patch, based on Phase 4.7 layout."""
from pathlib import Path
import shutil
import datetime
import re
import subprocess

root=Path(__file__).resolve().parents[1]
chat=root/'frontend/src/hermes-chat.ts'
main=root/'frontend/src/main.ts'
for p in (chat,main):
    if not p.is_file(): raise SystemExit(f'Missing: {p}')
c=chat.read_text(); m=main.read_text()
if 'PHASE48_SCROLL' in c or 'PHASE48_ACTIVITY' in m:
    raise SystemExit('Phase 4.8 already present or partially installed. No changes made.')

# Keep entire history-building block unchanged except for scroll lifecycle.
render_pattern=r'(?m)^async function render\(\)\{messages\.replaceChildren\(\);.*$'
match=re.search(render_pattern,c)
if not match or c.count('async function render(){')!=1:
    raise SystemExit('Chat render implementation no longer matches Phase 4.7. No changes made.')
old_render=match.group()
required=['data.turns','addBubble(t.role,t.content,t.created_at,t.task_id,t.id)','streamBubble(activeTask,text)','void pollTask()']
if not all(x in old_render for x in required):
    raise SystemExit('Current render includes unexpected differences; no changes made.')
# Preserve original history reconstruction, including streamed-bubble restoration and revision IDs.
body=old_render[len('async function render(){messages.replaceChildren();'):]
new_render='''// PHASE48_SCROLL: preserve position on refresh; follow on completion/open.
let hcRenderGeneration=0;
async function render(forceBottom=false){
  const generation=++hcRenderGeneration;
  const thread=conversationId;
  const topBefore=messages.scrollTop;
  const follow=forceBottom||followBottom()||messages.querySelector('.hc-empty')!==null||messages.childElementCount===0;
  const restore=()=>{requestAnimationFrame(()=>{
    if(generation!==hcRenderGeneration||thread!==conversationId)return;
    messages.scrollTop=follow?messages.scrollHeight:topBefore;
  });};
  // Do not clear while the HTTP request is in flight.
  if(!conversationId){messages.innerHTML='<div class="hc-empty">Start a conversation with Hermes.<br>Messages and tasks share the same thread.</div>';return;}
  try{
    const data=await request<{turns:Turn[]}>(`/api/conversations/${encodeURIComponent(thread)}`);
    if(generation!==hcRenderGeneration||thread!==conversationId)return;
    messages.replaceChildren();
    if(!data.turns.length){messages.textContent='No messages yet.';return;}
    for(const t of data.turns)addBubble(t.role,t.content,t.created_at,t.task_id,t.id);
    if(activeTask&&liveTask===activeTask&&liveText){const text=liveText;clearStream();streamBubble(activeTask,text);}
    const last=data.turns[data.turns.length-1];
    if(last.role==='user'&&last.task_id&&!['completed','failed','stopped'].includes(activeState)){
      activeTask=last.task_id;void pollTask();
    }
    restore();
  }catch(err){feedback.textContent='History unavailable: '+String(err)}
}'''
c=c.replace(old_render,new_render,1)
finish_pattern=r'async function renderFinished\(\)\{\s*clearStream\(\);\s*await render\(\);\s*requestAnimationFrame\(\(\) => \{\s*messages\.scrollTop = messages\.scrollHeight;\s*\}\);\s*\}'
if not re.search(finish_pattern,c):raise SystemExit('Completion handler unexpected; no changes made.')
c=re.sub(finish_pattern,'async function renderFinished(){clearStream();await render(true);}',c,count=1)
# Opening and switching should reveal latest message, while rerender preserves manually-scrolled history.
c=c.replace('nav.hidden=true;clearStream();activeTask=\'\';void render()','nav.hidden=true;clearStream();activeTask=\'\';void render(true)')
c=c.replace('panel.hidden=false','panel.hidden=false') # no-op; retain existing structure
c=c.replace('if(!panel.hidden){void render();void refreshThreads();','if(!panel.hidden){void render(true);void refreshThreads();')

old='''  if(kind==='hermes.tool_use'){
    // Event schemas vary by runtime. Show a tool name only when explicitly supplied.
    const tool=[payload.tool_name,payload.tool,payload.name].find(v=>typeof v==='string' && /^[\\w.:-]{1,64}$/.test(v as string));
    updateHermesStatus(tool?`Using tool: ${tool}`:'Using Hermes tools');return;
  }
  if(kind==='hermes.tool_result'){updateHermesStatus('Tool returned · reviewing result');return;}
  if(kind==='hermes.result'){updateHermesStatus('Hermes produced a response','completed');return;}
  if(kind==='hermes.system'){updateHermesStatus('Hermes runtime active');return;}'''
if m.count(old)!=1:
    raise SystemExit('World event display differs from expected Phase 4.6 code; no changes made.')
new='''  // PHASE48_ACTIVITY: only observable execution events and public assistant output.
  if(kind==='hermes.tool_use'){
    const tool=[payload.tool_name,payload.tool,payload.name].find(v=>typeof v==='string' && /^[\\w.:-]{1,64}$/.test(v as string));
    const inputs=payload.input??payload.arguments??payload.parameters;
    const detail=typeof inputs==='string'?inputs:inputs&&typeof inputs==='object'?JSON.stringify(inputs):'';
    const compact=detail.replace(/\\s+/g,' ').slice(0,105);
    updateHermesStatus(`Tool: ${tool||'Hermes tool'}${compact?' · '+compact:''}`);return;
  }
  if(kind==='hermes.tool_result'){
    const tool=[payload.tool_name,payload.tool,payload.name].find(v=>typeof v==='string');
    updateHermesStatus(tool?`Finished: ${tool}`:'Tool finished · processing output');return;
  }
  if(kind==='hermes.text'){
    // Genuine emitted assistant text, not private model reasoning.
    const delta=typeof payload.text==='string'?payload.text:'';
    if(delta){
      hcVisibleOutput=(hcVisibleOutput+delta).slice(-400);
      const compact=hcVisibleOutput.replace(/\\s+/g,' ').trim();
      updateHermesStatus('Responding · '+compact.slice(-125));
    }
    return;
  }
  if(kind==='hermes.result'){updateHermesStatus('Hermes response finished','completed');return;}
  if(kind==='hermes.system'){updateHermesStatus('Hermes runtime active');return;}'''
m=m.replace(old,new,1)
# Reset streamed display once new task starts; do not splice raw text with previous task.
if "if(kind==='task.started'){updateHermesStatus('Task started · Hermes is working','running');return;}" not in m:
    raise SystemExit('Unexpected task lifecycle handler; no changes made.')
m=m.replace("if(kind==='task.started'){updateHermesStatus('Task started · Hermes is working','running');return;}","if(kind==='task.started'){hcVisibleOutput='';updateHermesStatus('Task started · Hermes is working','running');return;}",1)
anchor='// Phase 4.6: public execution activity, NOT private chain-of-thought.'
if anchor not in m:raise SystemExit('Status banner anchor missing; no changes made.')
m=m.replace(anchor,'let hcVisibleOutput=\'\';\n'+anchor,1)

now=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
for p in (chat,main):shutil.copy2(p,p.with_name(p.name+'.before-phase48-'+now))
chat.write_text(c);main.write_text(m)
print('Phase 4.8 applied: chat scroll retention and live observable Hermes activity.')
print('Backups saved alongside files. Restart Vite and refresh the browser.')
