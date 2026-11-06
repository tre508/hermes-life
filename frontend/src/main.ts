import './hermes-chat';
import './style.css';

// Display version is frontend-only; no backend protocol change.
const versionPill=document.querySelector<HTMLElement>('header .pill');
if(versionPill) versionPill.textContent='TOWN / 0.4.0';

type EventRecord = {sequence:number; id:string; task_id:string|null; type:string;timestamp:string;payload:Record<string,unknown>};
// UI-VIS-002: the pixel town replaces the starship bridge. The presentation mapping lives in
// town-model (pure), town-scene (pixel art) and town-view (backend reads + DOM overlays); the
// backend stays the source of truth and this file keeps owning the event stream.
const $ = (id:string) => document.getElementById(id)!;
let hcVisibleOutput='';
// Phase 4.6: public execution activity, NOT private chain-of-thought.
// Use only confirmed backend events. No inferred agent thoughts or simulated output.
const hermesStatus=document.createElement('div');
hermesStatus.className='hermes-live-status';
hermesStatus.setAttribute('role','status');
hermesStatus.setAttribute('aria-live','polite');
hermesStatus.dataset.phase='idle';
hermesStatus.textContent='Hermes is ready for a task';
$('game').appendChild(hermesStatus);
function updateHermesStatus(text:string,phase='running'){
  hermesStatus.textContent=text.slice(0,180);
  hermesStatus.dataset.phase=phase;
}
function eventStatus(evt:EventRecord){
  const kind=evt.type;
  const payload=evt.payload||{};
  if(kind==='task.queued'){updateHermesStatus('Task queued · waiting to start','queued');return;}
  if(kind==='task.started'){hcVisibleOutput='';updateHermesStatus('Task started · Hermes is working','running');return;}
  if(kind==='task.completed'){updateHermesStatus('Task completed · result available','completed');return;}
  if(kind==='task.failed'){updateHermesStatus('Task failed · check the task result','failed');return;}
  // PHASE48_ACTIVITY: only observable execution events and public assistant output.
  if(kind==='hermes.tool_use'){
    const tool=[payload.tool_name,payload.tool,payload.name].find(v=>typeof v==='string' && /^[\w.:-]{1,64}$/.test(v as string));
    const inputs=payload.input??payload.arguments??payload.parameters;
    const detail=typeof inputs==='string'?inputs:inputs&&typeof inputs==='object'?JSON.stringify(inputs):'';
    const compact=detail.replace(/\s+/g,' ').slice(0,105);
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
      const compact=hcVisibleOutput.replace(/\s+/g,' ').trim();
      updateHermesStatus('Responding · '+compact.slice(-125));
    }
    return;
  }
  if(kind==='hermes.result'){updateHermesStatus('Hermes response finished','completed');return;}
  if(kind==='hermes.system'){updateHermesStatus('Hermes runtime active');return;}
}

// Phase 3.6: one viewport, one operations panel at a time.
const showOps=(view:string)=>{
  document.querySelectorAll<HTMLElement>('.ops-view').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  document.querySelectorAll<HTMLButtonElement>('[data-ops-tab]').forEach(el=>{
    const chosen=el.dataset.opsTab===view;el.classList.toggle('active',chosen);el.setAttribute('aria-pressed',String(chosen));
  });
};
document.querySelectorAll<HTMLButtonElement>('[data-ops-tab]').forEach(el=>el.addEventListener('click',()=>showOps(el.dataset.opsTab||'overview')));
$('studio-open-activity').addEventListener('click',()=>showOps('activity'));
$('overview-open-goals').addEventListener('click',()=>showOps('goals'));
showOps('overview');
type Persona = {name:string;persona:string;mode:string;experience_count:number};
let persona:Persona={name:'Hermes',persona:'',mode:'fixed-with-experience',experience_count:0};
async function loadPersona(){
 try {
  const response=await fetch('/api/personality');
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  persona=await response.json();
  $('persona-display').textContent=persona.name;
  $('persona-experience').textContent=`${persona.experience_count} recorded runs`;
  $('persona-feedback').textContent='Core identity loaded from host.';
 } catch(e){ $('persona-feedback').textContent='Persona unavailable: '+String(e); }
}
void loadPersona();

let selectedTask:string|null = null;
let lastSequence = 0;
// Building and resident detail panels are owned by the town view (town-view.ts).
type TaskRecord = {id:string;prompt:string;state:string;result:string|null;error:string|null;session_id:string|null;created_at:string};
let viewedTaskId:string|null=null;
let followLive=true;
function setFollowLive(enabled:boolean){
  followLive=enabled;
  const button=$('response-follow');
  button.textContent=enabled?'Following live':'Follow live';
  button.setAttribute('aria-pressed',String(enabled));
  $('response-source').textContent=enabled?'Latest agent activity':'History selection';
}
$('response-follow').addEventListener('click',()=>{setFollowLive(true);void syncLatestTask();});
let pendingRefresh:ReturnType<typeof setTimeout>|undefined;
let requestGeneration=0;
let currentAnswer = '';
function renderAnswer(source:string){
  currentAnswer=source;
  $('response-text').textContent=source;
  const root=$('response-rich');root.replaceChildren();
  const lines=source.replace(/\r\n/g,'\n').split('\n');
  let i=0;
  const addInline=(el:HTMLElement,value:string)=>{
    const pattern=/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;let pos=0;let match:RegExpExecArray|null;
    while((match=pattern.exec(value))!==null){
      if(match.index>pos)el.append(document.createTextNode(value.slice(pos,match.index)));
      const raw=match[0];const item=document.createElement(raw.startsWith('`')?'code':'strong');
      item.textContent=raw.startsWith('`')?raw.slice(1,-1):raw.slice(2,-2);el.append(item);pos=pattern.lastIndex;
    }
    if(pos<value.length)el.append(document.createTextNode(value.slice(pos)));
  };
  while(i<lines.length){
    const line=lines[i];if(!line.trim()){i++;continue;}
    if(/^\s*```/.test(line)){
      const code=document.createElement('pre');code.className='answer-code';i++;
      const block:string[]=[];while(i<lines.length&&!/^\s*```/.test(lines[i]))block.push(lines[i++]);
      if(i<lines.length)i++;const inner=document.createElement('code');inner.textContent=block.join('\n');code.append(inner);root.append(code);continue;
    }
    const heading=line.match(/^\s{0,3}(#{1,4})\s+(.+)/);
    if(heading){const el=document.createElement(heading[1].length<=2?'h3':'h4');addInline(el,heading[2]);root.append(el);i++;continue;}
    if(/^\s*[-*]\s+/.test(line)||/^\s*\d+[.)]\s+/.test(line)){
      const ordered=/^\s*\d+[.)]\s+/.test(line);const list=document.createElement(ordered?'ol':'ul');
      while(i<lines.length&&(ordered?/^\s*\d+[.)]\s+/:/^\s*[-*]\s+/).test(lines[i])){
        const li=document.createElement('li');addInline(li,lines[i].replace(ordered?/^\s*\d+[.)]\s+/:/^\s*[-*]\s+/,''));list.append(li);i++;
      }root.append(list);continue;
    }
    if(/^\s*---+\s*$/.test(line)){root.append(document.createElement('hr'));i++;continue;}
    const block:string[]=[line.trim()];i++;
    while(i<lines.length&&lines[i].trim()&&!/^(\s*```|\s{0,3}#{1,4}\s|\s*[-*]\s+|\s*\d+[.)]\s+)/.test(lines[i]))block.push(lines[i++].trim());
    const para=document.createElement('p');addInline(para,block.join(' '));root.append(para);
  }
  if(!root.children.length){const p=document.createElement('p');p.textContent='No response available.';root.append(p);}
}
function setResponseTab(tab:string){
  for(const name of ['answer','tools','history']){
    const selected=name===tab;
    $(`response-${name==='answer'?'answer':name==='tools'?'tools':'history'}-panel`).hidden=!selected;
    const btn=document.querySelector<HTMLButtonElement>(`[data-response-tab="${name}"]`);
    if(btn){btn.classList.toggle('active',selected);btn.setAttribute('aria-selected',String(selected));}
  }
}
document.querySelectorAll<HTMLButtonElement>('[data-response-tab]').forEach(b=>b.addEventListener('click',()=>setResponseTab(b.dataset.responseTab||'answer')));
$('response-raw-toggle').addEventListener('change',()=>{
  const checked=( $('response-raw-toggle') as HTMLInputElement).checked;
  $('response-text').hidden=!checked;$('response-rich').hidden=checked;
});
$('response-copy').addEventListener('click',()=>void navigator.clipboard.writeText(currentAnswer));
$('response-expand').addEventListener('click',()=>{
  const expanded=$('response-workspace').classList.toggle('expanded');
  $('response-expand').textContent=expanded?'Collapse':'Expand';
});

const toolEntries=new Map<string,EventRecord[]>();
function describePayload(payload:Record<string,unknown>):string{
  try{return JSON.stringify(payload,null,2)}catch{return String(payload)}
}
function renderTools(id:string){
  const container=$('tool-events');container.replaceChildren();
  const entries=toolEntries.get(id)||[];
  $('tool-count').textContent=String(entries.length);
  for(const evt of entries){
    const div=document.createElement('div');div.className='tool-entry';
    const heading=document.createElement('strong');heading.textContent=evt.type;
    const value=document.createElement('span');value.textContent=describePayload(evt.payload);
    div.append(heading,value);container.append(div);
  }
}
async function loadTask(id:string){
  viewedTaskId=id;
  const generation=++requestGeneration;
  $('response-id').textContent=id;
  try{
    const response=await fetch(`/api/tasks/${encodeURIComponent(id)}`);
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const task=await response.json() as TaskRecord;
    if(generation!==requestGeneration)return;
    $('response-status').textContent=task.state;
    renderAnswer(task.result ?? (task.state==='failed'?'Task failed without a response.':task.state==='completed'?'Task completed without response text.':'Hermes is working; awaiting response…')); 
    const error=$('response-error');error.hidden=!task.error;error.textContent=task.error||'';
    renderTools(id);
    document.querySelectorAll<HTMLButtonElement>('.history-entry').forEach(btn=>btn.setAttribute('aria-current',String(btn.dataset.taskId===id)));
  }catch(err){if(generation===requestGeneration)$('response-status').textContent=`Cannot load: ${String(err)}`}
}
async function refreshHistory(){
  try{
    const response=await fetch('/api/tasks');if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const tasks=await response.json() as TaskRecord[];
    const list=$('task-history');list.replaceChildren();
    if(!tasks.length)list.textContent='No previous tasks.';
    for(const task of tasks){
      const btn=document.createElement('button');btn.type='button';btn.className='history-entry';btn.dataset.taskId=task.id;
      btn.setAttribute('aria-current',String(task.id===viewedTaskId));
      const state=document.createElement('span');state.className='state';state.textContent=task.state;
      const prompt=document.createElement('span');prompt.textContent=task.prompt.length>90?task.prompt.slice(0,90)+'…':task.prompt;
      const date=document.createElement('small');date.textContent=new Date(task.created_at).toLocaleString()+' · '+task.id.slice(0,8);
      btn.append(state,prompt,date);btn.addEventListener('click',()=>{setFollowLive(false);setResponseTab('answer');void loadTask(task.id);});list.append(btn);
    }
    // The response panel follows real task activity, never a generic history selection.
    if(!viewedTaskId) { $('response-status').textContent='No task observed'; $('response-id').textContent='—'; }
  }catch(err){$('task-history').textContent=`History unavailable: ${String(err)}`}
}
function scheduleTaskRefresh(evt:EventRecord){
  if(!evt.task_id)return;
  // Autonomous goal tasks also generate task.* events; follow those like manual submissions.
  if(followLive && (evt.type==='task.queued'||evt.type==='task.started'||evt.type==='task.completed'||evt.type==='task.failed')){
    if(viewedTaskId!==evt.task_id) {setResponseTab('answer');void loadTask(evt.task_id);}
  }
  if(evt.type==='hermes.tool_use'||evt.type==='hermes.tool_result'){
    const existing=toolEntries.get(evt.task_id)||[];
    existing.push(evt);toolEntries.set(evt.task_id,existing);
    if(viewedTaskId===evt.task_id)renderTools(evt.task_id);
  }
  if(viewedTaskId===evt.task_id && (evt.type==='task.started'||evt.type==='task.completed'||evt.type==='task.failed')){
    // Completion event is emitted after the task record is updated.
    clearTimeout(pendingRefresh);pendingRefresh=setTimeout(()=>void loadTask(evt.task_id!),100);
  }
  if(evt.type==='task.queued'||evt.type==='task.completed'||evt.type==='task.failed'){
    void refreshHistory();
  }
}


function appendEvent(evt:EventRecord){
  if(evt.sequence <= lastSequence) return;
  lastSequence = evt.sequence;
  if(evt.task_id){ selectedTask = evt.task_id; latestEventTaskId=evt.task_id; }
  scheduleTaskRefresh(evt);
  const item=document.createElement('div');item.className='event';
  const title=document.createElement('span');title.textContent=`#${evt.sequence}  ${evt.type}`;
  const details=document.createElement('em');details.textContent=new Date(evt.timestamp).toLocaleTimeString()+' · '+(evt.task_id||'system');
  item.append(title,details);$('events').prepend(item);
  while($('events').childElementCount>100) $('events').lastElementChild?.remove();
  $('task').textContent=selectedTask?.slice(0,8)||'—';
  eventStatus(evt);
  // UI-VIS-002: the town maps this event with its own explicit table (town-model). An event it
  // does not know about is reported as unmapped rather than turned into a guessed room, and no
  // event is interpreted as task completion — the backend remains authoritative.
  window.dispatchEvent(new CustomEvent('hermes:event',{detail:evt}));
}
async function hydrate(){
  try {
    // Backend reachability gate. The town reads its own bounded record snapshot (town-view) and
    // deliberately does not adopt a stored sprite position as "current" activity.
    const health = await fetch('/health');
    if(!health.ok)throw Error('API offline');
    // Load the NEWEST events for the activity log, then stream live from that cursor. Reading the
    // oldest 500 instead made the socket replay the entire log (tens of thousands of events) before
    // any live event arrived, so the whole UI — and the town — lagged a minute behind reality.
    const history = await fetch('/api/events?tail=500').then(r=>r.json() as Promise<EventRecord[]>);
    for(const event of history){ appendHistorical(event); }
    await refreshHistory();
    await syncLatestTask();
    connect();
  } catch(e){$('connection').textContent='API unavailable — retrying';setTimeout(hydrate,3000)}
}
function appendHistorical(evt:EventRecord){
  if(evt.sequence<=lastSequence)return;
  lastSequence=evt.sequence;
  if(evt.task_id && evt.type.startsWith('task.'))latestEventTaskId=evt.task_id;
  const item=document.createElement('div'); item.className='event';
  const title=document.createElement('span');title.textContent=`#${evt.sequence}  ${evt.type}`;
  const details=document.createElement('em');details.textContent=new Date(evt.timestamp).toLocaleTimeString()+' · '+(evt.task_id||'system');
  item.append(title,details);$('events').prepend(item);
  while($('events').childElementCount>100)$('events').lastElementChild?.remove();
  if(evt.task_id && (evt.type==='hermes.tool_use'||evt.type==='hermes.tool_result')){
    const entries=toolEntries.get(evt.task_id)||[];entries.push(evt);toolEntries.set(evt.task_id,entries);
  }
}
async function syncLatestTask(){
  if(!followLive)return;
  try{
    const stateResponse=await fetch('/api/agent/state');
    if(stateResponse.ok){
      const state=await stateResponse.json() as {current_task?:string|null};
      if(state.current_task){await loadTask(state.current_task);return;}
    }
    // On reconnect/reload show the latest *recorded activity* clearly labeled,
    // not an arbitrary task selected from the history list.
    if(latestEventTaskId){await loadTask(latestEventTaskId);}
  }catch(err){console.warn('Unable to synchronize latest task',err)}
}
let latestEventTaskId:string|null=null;
let socket:WebSocket|null=null;let retryDelay=1000;
function connect(){
  socket?.close();
  const protocol=location.protocol==='https:'?'wss':'ws';
  const ws=new WebSocket(`${protocol}://${location.host}/ws/events?after=${lastSequence}`);socket=ws;
  ws.onopen=()=>{$('connection').textContent='● LIVE';$('connection').style.color='#87e7ba';retryDelay=1000;
    window.dispatchEvent(new CustomEvent('hermes:connection',{detail:{status:'live'}}))};
  ws.onmessage=e=>{try{appendEvent(JSON.parse(e.data) as EventRecord)}catch(err){console.error('Malformed event',err)}};
  ws.onclose=()=>{if(socket!==ws)return;$('connection').textContent='● Reconnecting';$('connection').style.color='#f1ba79';
    window.dispatchEvent(new CustomEvent('hermes:connection',{detail:{status:'reconnecting'}}));
    setTimeout(connect,retryDelay);retryDelay=Math.min(retryDelay*2,15000)};
  ws.onerror=()=>ws.close();
}
$('task-form').addEventListener('submit',async e=>{
  e.preventDefault();const prompt=($('prompt') as HTMLTextAreaElement).value.trim();if(!prompt)return;
  try{
    const response=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,conversation_id:localStorage.getItem('hermes-life-conversation-id')})});
    const body=await response.json();if(!response.ok)throw Error(body.detail||response.statusText);
    if(body.conversation_id)localStorage.setItem('hermes-life-conversation-id',body.conversation_id);
    $('task-feedback').textContent=`Task accepted: ${body.id}`;($('prompt') as HTMLTextAreaElement).value='';
    setFollowLive(true);void loadTask(body.id);void refreshHistory();
  }catch(error){$('task-feedback').textContent=String(error)}
});

$('refresh-history').addEventListener('click',()=>void refreshHistory());
// Status polling handles missed WebSocket messages and task updates after disconnection.
setInterval(()=>{if(viewedTaskId && ['queued','running'].includes($('response-status').textContent||''))void loadTask(viewedTaskId)},3000);

// Phase 4.4: non-destructive Evidence tab / expanded world layout.
import { installWorldFirstLayout } from './phase44-layout';
import './phase44-layout.css';
installWorldFirstLayout();

// Phase 4.5: bounded dashboard / world sizing fix.
import './phase45-world-layout.css';

// Phase 4.6: live Hermes activity banner and high-DPI world rendering.
import './phase46-world-status.css';

// PHASE412_PROJECT_PICKER
import './phase412-project-ui';

// UI-413-01 replacement view
import './phase41301-rework';

// UI-413-02: open a task in the existing Evidence response viewer.
window.addEventListener('hermes:open-task', (ev: Event) => {
  const id = (ev as CustomEvent<{id:string}>).detail?.id;
  if (!id) return;
  setFollowLive(false);
  void loadTask(id);
  // The tab click uses existing dashboard navigation, not a new viewer.
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  const evidence = tabs.find(b => b.textContent?.trim() === 'Evidence' &&
    !b.closest('#response-workspace') && !b.closest('#chat-panel'));
  if (evidence) evidence.click();
  document.getElementById('response-workspace')?.scrollIntoView({block:'nearest'});
});
import './phase41302-workflow';

// UI-VIS-002: top-down pixel town (replaces the bridge scene).
import { installTown } from './town-view';
installTown();
// The scene used to start this; the town does not own the event layer, so start it here.
void hydrate();

import './phase415-review';
