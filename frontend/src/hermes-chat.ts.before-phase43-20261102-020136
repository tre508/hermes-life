import './hermes-chat.css';

type Turn={role:'user'|'assistant';content:string;created_at:string;task_id:string|null};
type Conversation={id:string;title:string;updated_at:string};
type Task={id:string;state:string;result?:string;error?:string};
type Evt={sequence:number;task_id:string|null;type:string;payload:Record<string,unknown>;timestamp:string};
const stored='hermes-life-chat-conversation';
let conversationId=localStorage.getItem(stored)||'';
let activeTask='';let activeState='idle';let lastSeq=0;let socket:WebSocket|null=null;
const root=document.createElement('div');root.id='hermes-chat-root';
root.innerHTML=`<button id="hc-toggle" aria-label="Open Hermes chat" title="Hermes chat"><span class="hc-sigil" aria-hidden="true">✦</span><span>Chat</span></button>
<section id="hc-panel" role="dialog" aria-label="Hermes conversation" hidden>
 <header class="hc-head"><div class="hc-brand"><span class="hc-logo" aria-hidden="true">✦</span><div class="hc-brand-copy"><strong>Hermes</strong><small id="hc-state">Connected to Hermes Life</small></div></div><div class="hc-actions"><button id="hc-new" type="button" title="New conversation"><span class="hc-action-icon" aria-hidden="true">＋</span> New Chat</button><button id="hc-history" type="button" title="Conversation history"><span class="hc-action-icon" aria-hidden="true">☷</span> Threads</button><button id="hc-close" type="button" title="Close chat"><span class="hc-action-icon" aria-hidden="true">×</span> Close</button></div></header>
 <nav id="hc-threads" aria-label="Previous conversations" hidden></nav>
 <main id="hc-messages" aria-live="polite"><div class="hc-empty">Start a conversation with Hermes.<br>Messages and tasks share the same thread.</div></main>
 <div id="hc-progress" hidden><span id="hc-progress-label">Hermes is working…</span><button id="hc-details">Activity ▾</button></div>
 <div id="hc-events" hidden></div>
 <div id="hc-feedback" role="status"></div>
 <form id="hc-form"><textarea id="hc-input" rows="1" placeholder="Message Hermes…" aria-label="Message Hermes"></textarea><button id="hc-send" type="submit" title="Send message"><span aria-hidden="true">➤</span> Send</button></form>
</section>`;
document.body.append(root);
const el=(id:string)=>document.getElementById(id)!;
const panel=el('hc-panel'),messages=el('hc-messages'),feedback=el('hc-feedback');
function state(text:string){el('hc-state').textContent=text;}
function setRunning(running:boolean){(el('hc-send') as HTMLButtonElement).disabled=running;el('hc-progress').hidden=!running;}
async function request<T>(path:string,options?:RequestInit):Promise<T>{const res=await fetch(path,options);if(!res.ok){let info='';try{info=JSON.stringify(await res.json())}catch{}throw new Error(`HTTP ${res.status} ${info}`)}return await res.json() as T;}
function followBottom(){return messages.scrollHeight-messages.scrollTop-messages.clientHeight<110;}
function addBubble(role:'user'|'assistant',content:string,at?:string,taskId?:string|null){const stick=followBottom();const section=document.createElement('article');section.className='hc-bubble '+role;
 const body=document.createElement('div');body.className='hc-body';body.textContent=content;
 const meta=document.createElement('small');meta.textContent=at?new Date(at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
 const actions=document.createElement('div');actions.className='hc-bubble-actions';const copy=document.createElement('button');copy.textContent='Copy';copy.onclick=()=>void navigator.clipboard.writeText(body.textContent||'');actions.append(copy);
 const edit=document.createElement('button');edit.textContent='Edit & rerun';edit.onclick=()=>{const revised=window.prompt(role==='assistant'?'Correct Hermes response (submitted as your instruction):':'Revise this instruction and rerun:',body.textContent||'');if(revised===null||!revised.trim())return;if(role==='user'&&!window.confirm('Submit a NEW execution using this revised instruction? Completed external actions will not be undone and may repeat.'))return;const note=role==='assistant'?`Correction to an earlier Hermes response (do not treat original as authoritative):\nOriginal response: ${body.textContent}\nMy correction: ${revised}`:`Revised instruction (supersedes earlier user instruction for this turn; do not automatically repeat already-completed external actions):\n${revised}`;(el('hc-input') as HTMLTextAreaElement).value=note;(el('hc-input') as HTMLTextAreaElement).focus();feedback.textContent='Revision prepared. Press Send to submit it as a new task.';};actions.append(edit);
 section.append(body,meta,actions);if(taskId)section.dataset.taskId=taskId;messages.append(section);if(stick)messages.scrollTop=messages.scrollHeight;
}
async function render(){messages.replaceChildren();if(!conversationId){messages.innerHTML='<div class="hc-empty">Start a conversation with Hermes.<br>Messages and tasks share the same thread.</div>';return;}try{const data=await request<{turns:Turn[]}>(`/api/conversations/${encodeURIComponent(conversationId)}`);if(!data.turns.length){messages.textContent='No messages yet.';return;}for(const t of data.turns)addBubble(t.role,t.content,t.created_at,t.task_id);const last=data.turns[data.turns.length-1];if(last.role==='user'&&last.task_id&&!['completed','failed','stopped'].includes(activeState)){activeTask=last.task_id;void pollTask();}}catch(err){feedback.textContent='History unavailable: '+String(err)}}
async function refreshThreads(){try{const data=await request<{conversations:Conversation[]}>('/api/conversations');const nav=el('hc-threads');nav.replaceChildren();for(const t of data.conversations){const b=document.createElement('button');b.textContent=t.title||'Conversation';b.title=t.updated_at;b.onclick=()=>{conversationId=t.id;localStorage.setItem(stored,t.id);nav.hidden=true;activeTask='';void render()};nav.append(b)}}catch(err){feedback.textContent=String(err)}}
async function pollTask(){if(!activeTask)return;try{const t=await request<Task>('/api/tasks/'+encodeURIComponent(activeTask));activeState=t.state;state('Task '+t.state);const running=['queued','running','pending'].includes(t.state);setRunning(running);if(!running){activeTask='';await renderFinished();}}catch(err){feedback.textContent=String(err)}}
async function renderFinished(){await render();}
function eventItem(e:Evt){if(e.task_id!==activeTask)return;if(e.sequence<=lastSeq)return;lastSeq=e.sequence;const events=el('hc-events');const d=document.createElement('div');d.textContent=`${new Date(e.timestamp).toLocaleTimeString()} · ${e.type} · ${JSON.stringify(e.payload).slice(0,550)}`;events.append(d);while(events.childElementCount>120)events.firstElementChild?.remove();events.scrollTop=events.scrollHeight;if(e.type==='task.completed'||e.type==='task.failed'){void pollTask()}else if(e.type==='task.started')state('Hermes is executing');}
function connect(){socket?.close();const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/events?after=${lastSeq}`);socket=ws;ws.onmessage=ev=>{try{eventItem(JSON.parse(ev.data) as Evt)}catch{}};ws.onclose=()=>{if(socket===ws)setTimeout(connect,2500)};}
el('hc-toggle').onclick=()=>{panel.hidden=!panel.hidden;if(!panel.hidden){void render();void refreshThreads();if(!socket||socket.readyState>1)connect()}};
el('hc-close').onclick=()=>panel.hidden=true;
el('hc-new').onclick=()=>{if(activeTask&&['queued','running'].includes(activeState)){feedback.textContent='Finish the active task before starting another conversation.';return;}conversationId='';localStorage.removeItem(stored);activeTask='';void render();state('New conversation')};
el('hc-history').onclick=()=>{const nav=el('hc-threads');nav.hidden=!nav.hidden;if(!nav.hidden)void refreshThreads()};
el('hc-details').onclick=()=>el('hc-events').hidden=!el('hc-events').hidden;
el('hc-form').addEventListener('submit',async ev=>{ev.preventDefault();const box=el('hc-input') as HTMLTextAreaElement;const prompt=box.value.trim();if(!prompt||activeTask)return;feedback.textContent='';setRunning(true);try{const t=await request<Task&{conversation_id:string}>('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,conversation_id:conversationId||null})});conversationId=t.conversation_id;localStorage.setItem(stored,conversationId);activeTask=t.id;activeState=t.state;box.value='';await render();state('Hermes is working');}catch(err){feedback.textContent='Not submitted: '+String(err);setRunning(false)}});
(el('hc-input') as HTMLTextAreaElement).addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();el('hc-form').dispatchEvent(new Event('submit',{cancelable:true}))}});
setInterval(()=>{if(activeTask)void pollTask()},1500);
