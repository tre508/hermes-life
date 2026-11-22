import './hermes-chat.css';
import './chat-upgrade.css';
import './chat-clarity.css';
import { renderHermesMarkdown } from './chat-markdown';
import { gateLogout, gateRegisterPasskey } from './gate';

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
 <header class="hc-head"><div class="hc-brand"><span class="hc-logo" aria-hidden="true">✦</span><div class="hc-brand-copy"><strong>Hermes</strong><small id="hc-state">Connected to Hermes Life</small></div></div><div class="hc-actions"><button id="hc-new" type="button" title="New conversation"><span class="hc-action-icon" aria-hidden="true">＋</span> New Chat</button><button id="hc-history" type="button" title="Conversation history"><span class="hc-action-icon" aria-hidden="true">☷</span> Threads</button><button id="hc-logout" type="button" title="Log out — return to the entrance gate"><span class="hc-action-icon" aria-hidden="true">⏻</span> Logout</button><button id="hc-passkey" type="button" title="Register a passkey on this device for passwordless unlock" hidden><span class="hc-action-icon" aria-hidden="true">🔑</span> Passkey</button><button id="hc-close" type="button" title="Close chat"><span class="hc-action-icon" aria-hidden="true">×</span> Close</button></div></header>
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

// HL-CHAT-002B: visual roles are based on actual event provenance.
// Do not infer private model thoughts from ordinary assistant text.
function makeHermeshaLabel(kind:'response'|'thought'):HTMLElement {
 const label=document.createElement('div');
 label.className='hc-message-role hc-message-role--'+kind;
 const icon=document.createElement('span');icon.setAttribute('aria-hidden','true');
 icon.textContent=kind==='thought'?'💭':'✨';
 const name=document.createElement('strong');
 name.textContent=kind==='thought'?"Hermesha's Thoughts":"Hermesha's Response";
 label.append(icon,name); return label;
}
let thoughtTask='';let thoughtText='';let thoughtBody:HTMLElement|null=null;
function showExplicitThought(taskId:string,delta:string):void {
 if(taskId!==activeTask||!delta)return;
 const stick=followBottom();
 if(thoughtTask!==taskId){thoughtTask=taskId;thoughtText='';thoughtBody=null;}
 if(!thoughtBody||!thoughtBody.isConnected){
   const section=document.createElement('article');section.className='hc-bubble assistant hc-thought';
   section.dataset.thoughtTask=taskId;
   thoughtBody=document.createElement('div');thoughtBody.className='hc-body';
   section.append(makeHermeshaLabel('thought'),thoughtBody);messages.append(section);
 }
 thoughtText+=delta;
 renderHermesMarkdown(thoughtBody,thoughtText);
 if(stick)messages.scrollTop=messages.scrollHeight;
}
function hasExplicitThoughtMarker(payload:Record<string,unknown>):boolean {
 // Only explicit public runtime annotations qualify, never guessed from prose.
 const marker=String(payload.channel??payload.content_type??payload.message_type??'').toLowerCase();
 return ['thought','thinking','reasoning','analysis','commentary'].includes(marker);
}


// HL-CHAT-002: provider/model choice is a per-turn override, not a global worker mutation.
const modelBar=document.createElement('div'); modelBar.id='hc-model-controls';
// HL-CHAT-004 §2.7: primary controls stacked — provider/model row, context meter row, usage row.
modelBar.innerHTML=`<div class="hc-model-row">
<label>Provider <select id="hc-provider" aria-label="Chat provider"><option value="">Default</option></select></label>
<label>Model <select id="hc-model" aria-label="Chat model"><option value="">Worker default</option></select></label>
</div>
<div class="hc-context-row" id="hc-context-row" title="Occupied context window of the selected model — click for details">
<span class="hc-metric" id="hc-context-label">Context: unavailable</span>
<progress id="hc-context-bar" max="100" value="0" hidden></progress>
</div>
<div class="hc-context-details" id="hc-context-details" hidden>
<div class="hc-context-details-row"><span>Component</span><span>Tokens</span></div>
<div class="hc-context-details-row"><span>System instructions</span><span class="hc-unavailable">unavailable</span></div>
<div class="hc-context-details-row"><span>Conversation history</span><span class="hc-unavailable">unavailable</span></div>
<div class="hc-context-details-row"><span>Retrieved memory</span><span class="hc-unavailable">unavailable</span></div>
<div class="hc-context-details-row"><span>Project knowledge</span><span class="hc-unavailable">unavailable</span></div>
<div class="hc-context-details-row"><span>Tool content</span><span class="hc-unavailable">unavailable</span></div>
<div class="hc-context-details-row hc-context-details-note">The runtime does not report a per-component breakdown; only the measured total above is shown.</div>
</div>
<div class="hc-usage-row">
<span class="hc-metric" id="hc-tokens-label" title="Input + output tokens of the most recent request">Tokens: unavailable</span>
<span class="hc-metric" id="hc-cost-label">Cost: unavailable</span>
<span class="hc-metric" id="hc-balance-label">Balance: unavailable</span>
</div>`;
panel.querySelector('.hc-head')?.after(modelBar);
const retryModels=document.createElement('button');retryModels.type='button';retryModels.id='hc-retry-models';retryModels.textContent='↻ Models';retryModels.title='Reload provider and model catalog';modelBar.append(retryModels);
retryModels.onclick=()=>void initializeChatModels();
type ChatModel={provider:string;model:string;label:string;context_window:number|null};
let allowedChatModels:ChatModel[]=[];
const chatProvider=()=>el('hc-provider') as HTMLSelectElement;
const chatModel=()=>el('hc-model') as HTMLSelectElement;
function chatModelSelection():{provider?:string;model?:string}{
 const provider=chatProvider().value,model=chatModel().value;
 return provider&&model?{provider,model}:{};
}
// HL-CHAT-004: selection belongs to the conversation; different conversations may use different models.
function chatSelKey(kind:'provider'|'model'){return conversationId?`hl-chat-${kind}:${conversationId}`:`hl-chat-${kind}`;}
function saveChatSelection(){
 localStorage.setItem('hl-chat-provider',chatProvider().value);
 localStorage.setItem('hl-chat-model',chatModel().value);
 if(conversationId){localStorage.setItem(chatSelKey('provider'),chatProvider().value);localStorage.setItem(chatSelKey('model'),chatModel().value);}
}
function restoreChatSelection(){
 const scopedP=conversationId?localStorage.getItem(chatSelKey('provider')):null;
 const scopedM=conversationId?localStorage.getItem(chatSelKey('model')):null;
 const p=scopedP??localStorage.getItem('hl-chat-provider')??'';
 const m=scopedM??localStorage.getItem('hl-chat-model')??'';
 if(p&&Array.from(chatProvider().options).some(x=>x.value===p))chatProvider().value=p;
 refreshModelChoices();
 if(m&&Array.from(chatModel().options).some(x=>x.value===m))chatModel().value=m;
}
// HL-CHAT-004: compact token formatting (42.8K), exactly like the spec's example.
function fmtTokens(n:number){return n>=1000?(n/1000).toFixed(1).replace(/\.0$/,'')+'K':String(n);}
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
   chatProvider().replaceChildren(new Option('Default',''));
   allowedChatModels=data.models||[];
   el('hc-context-label').textContent=allowedChatModels.length?'Context: unavailable':'No models configured · backend HERMES_LIFE_CHAT_MODELS';
   const providers=[...new Set(allowedChatModels.map(x=>x.provider))];
   for(const provider of providers){const option=document.createElement('option');option.value=provider;option.textContent=provider;chatProvider().append(option);}
   restoreChatSelection();
   chatProvider().onchange=()=>{saveChatSelection();localStorage.removeItem('hl-chat-model');refreshModelChoices();};
   chatModel().onchange=()=>{saveChatSelection();void refreshChatBalance();};
 }catch(err){el('hc-context-label').textContent='Model API error: '+String(err).slice(0,100);}
}
async function refreshChatUsage(taskId:string){
 const context=el('hc-context-label'),cost=el('hc-cost-label'),tokens=el('hc-tokens-label'),progress=el('hc-context-bar') as HTMLProgressElement;
 context.textContent='Context: unavailable';cost.textContent='Cost: unavailable';tokens.textContent='Tokens: unavailable';
 progress.hidden=true;progress.className='';
 if(!taskId)return;
 try{
   const record=await request<{model?:string;provider?:string;context_window?:number;input_tokens?:number;output_tokens?:number;estimated_cost_usd?:number}>(`/api/chat/usage/${encodeURIComponent(taskId)}`);
   // HL-CHAT-004: context utilization (occupied window) vs token consumption (spend) are different measurements.
   if(typeof record.input_tokens==='number'&&typeof record.context_window==='number'&&record.context_window>0){
      const ratio=Math.min(100,100*record.input_tokens/record.context_window);
      context.textContent=`Context: ${fmtTokens(record.input_tokens)} / ${fmtTokens(record.context_window)} — ${ratio.toFixed(0)}%`;
      progress.value=ratio;progress.hidden=false;
      // HL-CHAT-004 thresholds: 0-69% mint, 70-89% amber, 90-100% coral.
      progress.className=ratio>=90?'crit':ratio>=70?'warn':'ok';
   }
   if(typeof record.input_tokens==='number'||typeof record.output_tokens==='number'){
      const total=(record.input_tokens||0)+(record.output_tokens||0);
      tokens.textContent=`Tokens: ${fmtTokens(total)}`;
      tokens.title=typeof record.input_tokens==='number'&&typeof record.output_tokens==='number'
        ?`Last request: ${record.input_tokens.toLocaleString()} input + ${record.output_tokens.toLocaleString()} output${record.model?` · ${record.model}`:''}`
        :'Last request usage (partial report)';
   }
   if(typeof record.estimated_cost_usd==='number')cost.textContent=`Session: $${record.estimated_cost_usd.toFixed(2)}`;
 }catch { /* model override may not have been selected; telemetry unavailable */ }
}
async function refreshChatBalance(){
 const host=el('hc-balance-label');
 const provider=chatProvider().value;
 if(!provider){host.textContent='Local — no API balance';return;}
 host.textContent='Balance: checking…';
 try{
   const result=await request<{available:boolean;remaining?:number;reason?:string}>(`/api/chat/balance?provider=${encodeURIComponent(provider)}`);
   if(result.available&&typeof result.remaining==='number'){host.textContent=`Balance: $${result.remaining.toFixed(2)} remaining`;host.title='Provider-reported available credit';}
   else if(/API not configured/i.test(result.reason||'')){host.textContent='Balance not supported';}
   else if(/key not configured/i.test(result.reason||'')){host.textContent='Balance not configured';}
   else {host.textContent='Balance temporarily unavailable';host.title=result.reason||'';}
 }catch { host.textContent='Balance temporarily unavailable'; /* no fabricated balance */ }
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
 if(role==='assistant')section.append(makeHermeshaLabel('response'));
 section.append(body,meta,actions);if(taskId)section.dataset.taskId=taskId;messages.append(section);if(stick)messages.scrollTop=messages.scrollHeight;
}
function streamBubble(taskId:string,delta:string){
 if(taskId!==activeTask||!delta)return;
 const stick=followBottom();
 if(liveTask!==taskId){liveTask=taskId;liveText='';liveBubble=null;}
 if(!liveBubble||!liveBubble.isConnected){
   const section=document.createElement('article');section.className='hc-bubble assistant hc-streaming';section.dataset.streamTask=taskId;
   const body=document.createElement('div');body.className='hc-body';body.setAttribute('aria-label','Hermes response streaming');
   section.append(makeHermeshaLabel('response'),body);messages.append(section);liveBubble=body;
 }
 liveText+=delta;renderHermesMarkdown(liveBubble,liveText);
 if(stick)messages.scrollTop=messages.scrollHeight;
}
function clearStream(){liveTask='';liveText='';liveBubble=null;thoughtTask='';thoughtText='';thoughtBody=null;}
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
async function refreshThreads(){try{const data=await request<{conversations:Conversation[]}>('/api/conversations');const nav=el('hc-threads');nav.replaceChildren();for(const t of data.conversations){const b=document.createElement('button');b.textContent=t.title||'Conversation';b.title=t.updated_at;b.onclick=()=>{conversationId=t.id;localStorage.setItem(stored,t.id);nav.hidden=true;clearStream();activeTask='';restoreChatSelection();void render(true)};nav.append(b)}}catch(err){feedback.textContent=String(err)}}
async function pollTask(){if(!activeTask)return;try{const t=await request<Task>('/api/tasks/'+encodeURIComponent(activeTask));activeState=t.state;state('Task '+t.state);const running=['queued','running','pending'].includes(t.state);setRunning(running);if(!running){const finishedId=activeTask;activeTask='';await renderFinished();void refreshChatUsage(finishedId);}}catch(err){feedback.textContent=String(err)}}
async function renderFinished(){clearStream();await render(true);}
function eventItem(e:Evt){if(e.task_id!==activeTask)return;if(e.sequence<=lastSeq)return;lastSeq=e.sequence;if(e.type==='hermes.text'){const delta=e.payload?.text;if(typeof delta==='string'){if(hasExplicitThoughtMarker(e.payload))showExplicitThought(e.task_id||'',delta);else streamBubble(e.task_id||'',delta);}return;}const events=el('hc-events');const d=document.createElement('div');d.textContent=`${new Date(e.timestamp).toLocaleTimeString()} · ${e.type} · ${JSON.stringify(e.payload).slice(0,550)}`;events.append(d);while(events.childElementCount>120)events.firstElementChild?.remove();events.scrollTop=events.scrollHeight;if(e.type==='task.completed'||e.type==='task.failed'||e.type==='task.cancelled'){void pollTask()}else if(e.type==='task.started')state('Hermes is executing');}
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
    restoreChatSelection();
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
el('hc-logout').onclick=()=>{void gateLogout();};
// HL-AUTH-002: one-time passkey enrolment. The button only appears while the
// gate is enabled, the session is live, and no credential is registered yet.
void (async()=>{
  const passkeyBtn=el('hc-passkey') as HTMLButtonElement;
  try{
    const st=await fetch('/api/entrance/status').then(r=>r.json());
    if(st.enabled&&st.authenticated&&!st.passkey_available)passkeyBtn.hidden=false;
  }catch{/* gate status unknown: keep the enrol button hidden */}
  passkeyBtn.onclick=async()=>{
    passkeyBtn.disabled=true;
    try{await gateRegisterPasskey();passkeyBtn.hidden=true;state('Passkey registered on this device');}
    catch(e){state(e instanceof Error?e.message:'Passkey registration failed');passkeyBtn.disabled=false;}
  };
})();
el('hc-new').onclick=()=>{if(activeTask&&['queued','running'].includes(activeState)){feedback.textContent='Finish the active task before starting another conversation.';return;}conversationId='';localStorage.removeItem(stored);activeTask='';pendingRevision=null;void render();state('New conversation')};
el('hc-history').onclick=()=>{const nav=el('hc-threads');nav.hidden=!nav.hidden;if(!nav.hidden)void refreshThreads()};
el('hc-details').onclick=()=>el('hc-events').hidden=!el('hc-events').hidden;
// HL-CHAT-004 §2.4: clicking the context meter toggles the expanded details panel.
el('hc-context-row').onclick=()=>{const d=el('hc-context-details');d.hidden=!d.hidden;};
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
