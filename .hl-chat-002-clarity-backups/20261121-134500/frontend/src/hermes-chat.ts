import './hermes-chat.css';
import './chat-upgrade.css';
import { renderHermesMarkdown } from './chat-markdown';

type Turn={id:number;role:'user'|'assistant';content:string;created_at:string;task_id:string|null};
type Conversation={id:string;title:string;updated_at:string};
type Task={id:string;state:string;result?:string;error?:string};
type Evt={sequence:number;task_id:string|null;type:string;payload:Record<string,unknown>;timestamp:string};
const stored='hermes-life-chat-conversation';
let conversationId=localStorage.getItem(stored)||'';
let pendingRevision:{id:number;content:string}|null=null;
let activeTask='';let activeState='idle';let lastSeq=0;let socket:WebSocket|null=null;
// PHASE47_STREAMING: incremental assistant output is never inserted into durable history.
let liveTask='';let liveText='';let liveBubble:HTMLElement|null=null;

const root=document.createElement('div');root.id='hermes-chat-root';
root.innerHTML=`<button id="hc-toggle" aria-label="Open Hermes chat" title="Hermes chat"><span class="hc-sigil" aria-hidden="true">✦</span><span>Chat</span></button>
<section id="hc-panel" role="dialog" aria-label="Hermes conversation" hidden>
 <header class="hc-head"><div class="hc-brand"><span class="hc-logo" aria-hidden="true">✦</span><div class="hc-brand-copy"><strong>Hermes</strong><small id="hc-state">Connected to Hermes Life</small></div></div><div class="hc-actions"><button id="hc-new" type="button" title="New conversation"><span class="hc-action-icon" aria-hidden="true">＋</span> New Chat</button><button id="hc-history" type="button" title="Conversation history"><span class="hc-action-icon" aria-hidden="true">☷</span> Threads</button><button id="hc-close" type="button" title="Close chat"><span class="hc-action-icon" aria-hidden="true">×</span> Close</button></div></header>
 <nav id="hc-threads" aria-label="Previous conversations" hidden></nav>
 <main id="hc-messages" aria-live="polite"><div class="hc-empty">Start a conversation with Hermes.<br>Messages and tasks share the same thread.</div></main>
 <div id="hc-progress" hidden><span id="hc-progress-label">Hermes is working…</span><button id="hc-details">Activity ▾</button><button id="hc-stop" type="button" title="Stop current task">Stop</button></div>
 <div id="hc-events" hidden></div>
 <div id="hc-feedback" role="status"></div>
 <form id="hc-form"><textarea id="hc-input" rows="1" placeholder="Message Hermes…" aria-label="Message Hermes"></textarea><button id="hc-send" type="submit" title="Send message"><span aria-hidden="true">➤</span> Send</button></form>
</section>`;
document.body.append(root);
const el=(id:string)=>document.getElementById(id)!;
const panel=el('hc-panel'),messages=el('hc-messages'),feedback=el('hc-feedback');

// HL-CHAT-002: provider/model choice is a per-turn override, not a global worker mutation.
const modelBar=document.createElement('div'); modelBar.id='hc-model-controls';
modelBar.innerHTML=`<label>Provider <select id="hc-provider" aria-label="Chat provider"><option value="">Default</option></select></label>
<label>Model <select id="hc-model" aria-label="Chat model"><option value="">Worker default</option></select></label>
<span class="hc-metric" id="hc-context-label" title="Last verified input tokens / configured model context">Context: unavailable</span>
<progress id="hc-context-bar" max="100" value="0" hidden></progress>
<span class="hc-metric" id="hc-cost-label">Cost: unavailable</span>
<span class="hc-metric" id="hc-balance-label">Balance: unavailable</span>`;
panel.querySelector('.hc-head')?.after(modelBar);
type ChatModel={provider:string;model:string;label:string;context_window:number|null};
let allowedChatModels:ChatModel[]=[];
const chatProvider=()=>el('hc-provider') as HTMLSelectElement;
const chatModel=()=>el('hc-model') as HTMLSelectElement;
function chatModelSelection():{provider?:string;model?:string}{
 const provider=chatProvider().value,model=chatModel().value;
 return provider&&model?{provider,model}:{};
}
function refreshModelChoices(){
 const provider=chatProvider().value,previous=chatModel().value;
 chatModel().replaceChildren();
 const def=document.createElement('option');def.value='';def.textContent='Worker default';chatModel().append(def);
 for(const choice of allowedChatModels.filter(x=>x.provider===provider)){
   const option=document.createElement('option');option.value=choice.model;option.textContent=choice.label;chatModel().append(option);
 }
 if(Array.from(chatModel().options).some(x=>x.value===previous))chatModel().value=previous;
 chatModel().disabled=!provider;
 void refreshChatBalance();
}
async function initializeChatModels(){
 try{
   const data=await request<{models:ChatModel[]}>('/api/chat/models');
   allowedChatModels=data.models||[];
   const providers=[...new Set(allowedChatModels.map(x=>x.provider))];
   const savedProvider=localStorage.getItem('hl-chat-provider')||'';
   const savedModel=localStorage.getItem('hl-chat-model')||'';
   for(const provider of providers){const option=document.createElement('option');option.value=provider;option.textContent=provider;chatProvider().append(option);}
   if(providers.includes(savedProvider))chatProvider().value=savedProvider;
   refreshModelChoices();
   if(Array.from(chatModel().options).some(x=>x.value===savedModel))chatModel().value=savedModel;
   chatProvider().onchange=()=>{localStorage.setItem('hl-chat-provider',chatProvider().value);localStorage.removeItem('hl-chat-model');refreshModelChoices();};
   chatModel().onchange=()=>{localStorage.setItem('hl-chat-model',chatModel().value);void refreshChatBalance();};
 }catch(err){el('hc-context-label').textContent='Model catalog unavailable';}
}
async function refreshChatUsage(taskId:string){
 const context=el('hc-context-label'),cost=el('hc-cost-label'),progress=el('hc-context-bar') as HTMLProgressElement;
 context.textContent='Context: unavailable';cost.textContent='Cost: unavailable';progress.hidden=true;
 if(!taskId)return;
 try{
   const record=await request<{model?:string;provider?:string;context_window?:number;input_tokens?:number;output_tokens?:number;estimated_cost_usd?:number}>(`/api/chat/usage/${encodeURIComponent(taskId)}`);
   if(typeof record.input_tokens==='number'&&typeof record.context_window==='number'&&record.context_window>0){
      const ratio=100*record.input_tokens/record.context_window;
      context.textContent=`Context ${record.input_tokens.toLocaleString()} / ${record.context_window.toLocaleString()} · ${ratio.toFixed(0)}% (last request)`;
      progress.value=Math.min(100,ratio);progress.hidden=false;
   }
   if(typeof record.estimated_cost_usd==='number')cost.textContent=`Last task: $${record.estimated_cost_usd.toFixed(4)} (estimated)`;
 }catch { /* model override may not have been selected; telemetry unavailable */ }
}
async function refreshChatBalance(){
 const host=el('hc-balance-label'); host.textContent='Balance: unavailable';
 const provider=chatProvider().value;
 if(!provider)return;
 try{
   const result=await request<{available:boolean;remaining?:number;reason?:string}>(`/api/chat/balance?provider=${encodeURIComponent(provider)}`);
   if(result.available&&typeof result.remaining==='number')host.textContent=`Balance: $${result.remaining.toFixed(2)}`;
   else host.title=result.reason||'Unavailable';
 }catch { /* no fabricated balance */ }
}

function state(text:string){el('hc-state').textContent=text;}
function setRunning(running:boolean){(el('hc-send') as HTMLButtonElement).disabled=running;el('hc-progress').hidden=!running;}
async function request<T>(path:string,options?:RequestInit):Promise<T>{const res=await fetch(path,options);if(!res.ok){let info='';try{info=JSON.stringify(await res.json())}catch{}throw new Error(`HTTP ${res.status} ${info}`)}return await res.json() as T;}
function followBottom(){return messages.scrollHeight-messages.scrollTop-messages.clientHeight<110;}
function addBubble(role:'user'|'assistant',content:string,at?:string,taskId?:string|null,turnId?:number){const stick=followBottom();const section=document.createElement('article');section.className='hc-bubble '+role;
 const body=document.createElement('div');body.className='hc-body';if(role==='assistant')renderHermesMarkdown(body, content);else body.textContent=content;
 const meta=document.createElement('small');meta.textContent=at?new Date(at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
 const actions=document.createElement('div');actions.className='hc-bubble-actions';const copy=document.createElement('button');copy.textContent='Copy';copy.onclick=()=>void navigator.clipboard.writeText(content);actions.append(copy);
 const edit=document.createElement('button');edit.textContent='Edit & rerun';
 edit.onclick=()=>{if(!turnId){feedback.textContent='Message ID unavailable; refresh first.';return;}
 const revised=window.prompt(role==='assistant'?'Write a correction to this response:':'Revise this instruction:',content);
 if(revised===null||!revised.trim())return;
 pendingRevision={id:turnId,content:revised.trim()};
 const input=el('hc-input') as HTMLTextAreaElement;
 input.value=role==='assistant'?`Correction to Hermes response (my revision is authoritative):\n${revised}`:`Revised instruction replacing turn ${turnId}:\n${revised}\nDo not automatically repeat completed external actions.`;
 input.focus();feedback.textContent='Revision linked to original turn. Review and press Send to execute; original is preserved.';
 };actions.append(edit);
 if(role==='user'&&turnId){const keep=document.createElement('button');keep.textContent='Remember';keep.onclick=async()=>{const content=window.prompt('Save lasting memory (edit for accuracy):',body.textContent||'');if(!content)return;try{await request('/api/memories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,kind:'decision',conversation_id:conversationId,turn_id:turnId})});feedback.textContent='Saved durable memory.';}catch(e){feedback.textContent='Memory not saved: '+String(e)}};actions.append(keep);}
 section.append(body,meta,actions);if(taskId)section.dataset.taskId=taskId;messages.append(section);if(stick)messages.scrollTop=messages.scrollHeight;
}
function streamBubble(taskId:string,delta:string){
 if(taskId!==activeTask||!delta)return;
 const stick=followBottom();
 if(liveTask!==taskId){liveTask=taskId;liveText='';liveBubble=null;}
 if(!liveBubble||!liveBubble.isConnected){
   const section=document.createElement('article');section.className='hc-bubble assistant hc-streaming';section.dataset.streamTask=taskId;
   const body=document.createElement('div');body.className='hc-body';body.setAttribute('aria-label','Hermes response streaming');
   section.append(body);messages.append(section);liveBubble=body;
 }
 liveText+=delta;renderHermesMarkdown(liveBubble,liveText);
 if(stick)messages.scrollTop=messages.scrollHeight;
}
function clearStream(){liveTask='';liveText='';liveBubble=null;}
// PHASE48_SCROLL: preserve position on refresh; follow on completion/open.
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
    if(last.role==='user'&&last.task_id&&!['completed','failed','cancelled','stopped'].includes(activeState)){
      activeTask=last.task_id;void pollTask();
    }
    restore();
  }catch(err){feedback.textContent='History unavailable: '+String(err)}
}
async function refreshThreads(){try{const data=await request<{conversations:Conversation[]}>('/api/conversations');const nav=el('hc-threads');nav.replaceChildren();for(const t of data.conversations){const b=document.createElement('button');b.textContent=t.title||'Conversation';b.title=t.updated_at;b.onclick=()=>{conversationId=t.id;localStorage.setItem(stored,t.id);nav.hidden=true;clearStream();activeTask='';void render(true)};nav.append(b)}}catch(err){feedback.textContent=String(err)}}
async function pollTask(){if(!activeTask)return;try{const t=await request<Task>('/api/tasks/'+encodeURIComponent(activeTask));activeState=t.state;state('Task '+t.state);const running=['queued','running','pending'].includes(t.state);setRunning(running);if(!running){const finishedId=activeTask;activeTask='';await renderFinished();void refreshChatUsage(finishedId);}}catch(err){feedback.textContent=String(err)}}
async function renderFinished(){clearStream();await render(true);}
function eventItem(e:Evt){if(e.task_id!==activeTask)return;if(e.sequence<=lastSeq)return;lastSeq=e.sequence;if(e.type==='hermes.text'){const delta=e.payload?.text;if(typeof delta==='string')streamBubble(e.task_id||'',delta);return;}const events=el('hc-events');const d=document.createElement('div');d.textContent=`${new Date(e.timestamp).toLocaleTimeString()} · ${e.type} · ${JSON.stringify(e.payload).slice(0,550)}`;events.append(d);while(events.childElementCount>120)events.firstElementChild?.remove();events.scrollTop=events.scrollHeight;if(e.type==='task.completed'||e.type==='task.failed'||e.type==='task.cancelled'){void pollTask()}else if(e.type==='task.started')state('Hermes is executing');}
function connect(){socket?.close();const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/events?after=${lastSeq}`);socket=ws;ws.onmessage=ev=>{try{eventItem(JSON.parse(ev.data) as Evt)}catch{}};ws.onclose=()=>{if(socket===ws)setTimeout(connect,2500)};}
// HL-CONV-001: Hermes Chat is the primary conversational surface. Any
// workspace (Task Board, thread views) can request a hand-off here —
// with the conversation to continue and optional prefill text. If only
// a task_id is known, we resolve its conversation via /api/tasks/{id}.
window.addEventListener('hermes:open-in-chat',(ev:Event)=>{
  const d=((ev as CustomEvent<{conversation_id?:string;task_id?:string;prefill?:string}>).detail||{}) as {conversation_id?:string;task_id?:string;prefill?:string};
  const open=async(convId:string|undefined)=>{
    panel.hidden=false;clearStream();activeTask='';activeState='idle';
    if(convId){conversationId=convId;localStorage.setItem(stored,convId);}
    void render(true);void refreshThreads();
    if(!socket||socket.readyState>1)connect();
    void refreshChatUsage(d.task_id || '');
    if(d.prefill){const box=el('hc-input') as HTMLTextAreaElement;box.value=d.prefill;box.focus();feedback.textContent='Draft opened in Chat — review and press Send.';}
  };
  void open(d.conversation_id);
  if(!d.conversation_id&&d.task_id){void request<Task&{conversation_id?:string}>(`/api/tasks/${encodeURIComponent(d.task_id)}`).then(t=>{if(t.conversation_id){conversationId=t.conversation_id;localStorage.setItem(stored,conversationId);clearStream();activeTask='';void render(true);void refreshThreads();}else{feedback.textContent='This task has no conversation thread yet.';}}).catch(e=>{feedback.textContent=String(e)});}
});
void initializeChatModels();
el('hc-toggle').onclick=()=>{panel.hidden=!panel.hidden;if(!panel.hidden){void render(true);void refreshThreads();if(!socket||socket.readyState>1)connect()}};
el('hc-close').onclick=()=>panel.hidden=true;
el('hc-new').onclick=()=>{if(activeTask&&['queued','running'].includes(activeState)){feedback.textContent='Finish the active task before starting another conversation.';return;}conversationId='';localStorage.removeItem(stored);activeTask='';pendingRevision=null;void render();state('New conversation')};
el('hc-history').onclick=()=>{const nav=el('hc-threads');nav.hidden=!nav.hidden;if(!nav.hidden)void refreshThreads()};
el('hc-details').onclick=()=>el('hc-events').hidden=!el('hc-events').hidden;
el('hc-stop').onclick=async()=>{
  if(!activeTask)return;
  feedback.textContent='Stopping task…';
  try{
    await request('/api/tasks/'+encodeURIComponent(activeTask)+'/cancel',{method:'POST'});
    feedback.textContent='Task stopped';
  }catch(err){
    feedback.textContent='Stop failed: '+String(err);
  }
};
el('hc-form').addEventListener('submit',async ev=>{ev.preventDefault();const box=el('hc-input') as HTMLTextAreaElement;const prompt=box.value.trim();if(!prompt||activeTask)return;feedback.textContent='';setRunning(true);try{const t=await request<Task&{conversation_id:string}>('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,conversation_id:conversationId||null,...chatModelSelection(),...(pendingRevision?{revision_of:pendingRevision.id,revision_text:pendingRevision.content}:{})})});conversationId=t.conversation_id;localStorage.setItem(stored,conversationId);clearStream();activeTask=t.id;activeState=t.state;void refreshChatUsage(t.id);box.value='';pendingRevision=null;await render();state('Hermes is working');}catch(err){feedback.textContent='Not submitted: '+String(err);setRunning(false)}});
(el('hc-input') as HTMLTextAreaElement).addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();el('hc-form').dispatchEvent(new Event('submit',{cancelable:true}))}});
setInterval(()=>{if(activeTask)void pollTask()},1500);
