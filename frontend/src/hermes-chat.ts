import './hermes-chat.css';
import './chat-upgrade.css';
import './chat-clarity.css';
import { renderHermesMarkdown } from './chat-markdown';
import { gateLogout, gateRegisterPasskey } from './gate';
import { groupThreads } from './thread-groups';

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
root.innerHTML=`<section id="hc-panel" role="region" aria-label="Hermes conversation">
 <aside id="hc-thread-sidebar" aria-label="Conversation history">
  <div class="hc-thread-head"><strong>Conversations</strong><button id="hc-new" type="button" title="Start a new conversation"><span aria-hidden="true">＋</span> New chat</button></div>
  <input id="hc-thread-filter" type="search" placeholder="Search threads" aria-label="Search conversations" autocomplete="off">
  <nav id="hc-threads" aria-label="Previous conversations"></nav>
 </aside>
 <div class="hc-main">
 <header class="hc-head"><div class="hc-brand"><span class="hc-logo" aria-hidden="true">✦</span><div class="hc-brand-copy"><strong id="hc-thread-title">New conversation</strong><small id="hc-state">Hermesha · connected</small></div></div><div class="hc-actions"><details class="hc-account"><summary title="Account and security"><span class="hc-action-icon" aria-hidden="true">⏻</span> Account</summary><button id="hc-logout" type="button" title="Log out — return to the entrance gate"><span class="hc-action-icon" aria-hidden="true">⏻</span> Logout</button><button id="hc-passkey" type="button" title="Register a passkey on this device for passwordless unlock" hidden><span class="hc-action-icon" aria-hidden="true">🔑</span> Passkey</button></details></div></header>
 <main id="hc-messages" aria-live="polite"><div class="hc-empty">Start a conversation with Hermes.<br>Messages and tasks share the same thread.</div></main>
 <div id="hc-progress" hidden><span id="hc-progress-label">Hermes is working…</span><button id="hc-details">Activity ▾</button><button id="hc-stop" type="button" title="Stop current task">Stop</button></div>
 <div id="hc-events" hidden></div>
 <div id="hc-feedback" role="status"></div>
 <form id="hc-form"><div class="hc-composer-box"><textarea id="hc-input" rows="1" placeholder="Ask Hermesha to build, explain, fix, or research…" aria-label="Message Hermesha"></textarea><div class="hc-composer-tools"><button id="hc-attach" type="button" title="Browse project files and attach them"><span aria-hidden="true">＋</span> Attach</button><button id="hc-composer-workspace" type="button" title="Open the registered-project workspace drawer"><span aria-hidden="true">🗂</span> Workspace</button><span id="hc-composer-hint">Enter to send · Shift+Enter for a new line</span></div><div class="hc-composer-foot"><button id="hc-composer-context" type="button" title="Change the working context"><span aria-hidden="true">◆</span> <span id="hc-composer-context-label">General chat</span></button><button id="hc-composer-model" type="button" title="Change provider and model"><span aria-hidden="true">✦</span> <span id="hc-composer-model-label">Worker default</span></button><button id="hc-send" type="submit" title="Send message"><span aria-hidden="true">➤</span> Send</button></div></div></form>
 </div>
</section>`;
/* Chat audit §8: the floating assistant is RETIRED. There is exactly ONE chat
   presentation — the full-page Conversations workspace — so the single chat
   root mounts straight into #chat-focus-host and never moves again. The
   workspace's own hidden state governs when it is on screen; there is no
   launcher to reveal it and no Close to hide it, so the workspace can never
   become a dead end (the failure mode the old toggle/Close pair created). */
root.classList.add('in-focus-host');
(document.getElementById('chat-focus-host')||document.body).append(root);
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
// PHASE49_TRACE: ChatGPT-style reasoning/tool traces. Transient stream DOM is
// presentation only (PHASE47 rule: never durable history); the trace content
// is kept per task in-memory so render() can re-attach it under the finished
// assistant turn. Reload clears it — durable traces need backend history.
type TraceEntry={label:string;detail:string;result?:string};
const traces=new Map<string,{thought:string;tools:TraceEntry[];open:boolean}>();
function traceOf(taskId:string){let t=traces.get(taskId);if(!t){t={thought:'',tools:[],open:true};traces.set(taskId,t);if(traces.size>30){const oldest=traces.keys().next().value;if(oldest)traces.delete(oldest);}}return t;}
function toolName(p:Record<string,unknown>):string{return String(p.tool??p.name??p.function_name??'tool');}
function toolDetail(p:Record<string,unknown>):string{const raw=p.arguments??p.input??p.args??p.params??p;let s=typeof raw==='string'?raw:JSON.stringify(raw);if(!s||s==='{}')s='';return s.slice(0,260);}
function toolResultText(p:Record<string,unknown>):string{const raw=p.text??p.output??p.result??p.content??p;const s=typeof raw==='string'?raw:JSON.stringify(raw);return (s||'').slice(0,400);}
let traceEl:HTMLDetailsElement|null=null;let traceBody:HTMLElement|null=null;let traceTask='';
function traceSummary(t:{thought:string;tools:TraceEntry[];open:boolean}):string{
 const last=t.tools.length?t.tools[t.tools.length-1].label:'';
 return t.thought&&!t.tools.length?'💭 Reasoning…':last?`Working — ${last}`:'💭 Reasoning & tool activity';
}
function ensureTrace(taskId:string):HTMLDetailsElement{
 if(traceEl&&traceTask===taskId&&traceEl.isConnected)return traceEl;
 const stick=followBottom();
 traceEl=document.createElement('details');traceEl.className='hc-trace';traceEl.dataset.traceTask=taskId;traceEl.open=traces.get(taskId)?.open??true;
 const summary=document.createElement('summary');summary.textContent=traceSummary(traceOf(taskId));
 traceBody=document.createElement('div');traceBody.className='hc-trace-body';
 traceEl.append(summary,traceBody);messages.append(traceEl);traceTask=taskId;
 if(stick)messages.scrollTop=messages.scrollHeight;
 return traceEl;
}
function renderTraceInto(host:HTMLElement,t:{thought:string;tools:TraceEntry[]},live:boolean):void{
 host.replaceChildren();
 if(t.thought){const d=document.createElement('details');d.className='hc-trace-thought';d.open=live;const s=document.createElement('summary');s.textContent='💭 Reasoning';const b=document.createElement('div');b.className='hc-body';renderHermesMarkdown(b,t.thought);d.append(s,b);host.append(d);}
 for(const e of t.tools){const row=document.createElement('div');row.className='hc-tool';const head=document.createElement('div');head.className='hc-tool-head';head.textContent=`🔧 ${e.label}`;row.append(head);if(e.detail){const pre=document.createElement('pre');pre.className='hc-tool-detail';pre.textContent=e.detail;row.append(pre);}if(e.result){const out=document.createElement('pre');out.className='hc-tool-result';out.textContent=e.result;row.append(out);}host.append(row);}
 if(!t.thought&&!t.tools.length)host.append(Object.assign(document.createElement('div'),{textContent:'No tool activity recorded yet.'}));
}
function refreshTrace(taskId:string):void{
 const t=traceOf(taskId);const elx=ensureTrace(taskId);
 const summary=elx.querySelector('summary')!;summary.textContent=traceSummary(t);
 renderTraceInto(traceBody!,t,true);
 const stick=followBottom();if(stick)messages.scrollTop=messages.scrollHeight;
}
function showExplicitThought(taskId:string,delta:string):void {
 if(taskId!==activeTask||!delta)return;
 const t=traceOf(taskId);t.thought=(t.thought+delta).slice(-8000);
 refreshTrace(taskId);
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
// convo-redesign/chat-audit §2: the provider, context and usage block is
// reference material, not conversation. Collapse it behind a disclosure so the
// scroll region gets its height back; the values stay one click away.
const modelDetails=document.createElement('details'); modelDetails.id='hc-model-details';
const modelSummary=document.createElement('summary');
modelSummary.textContent='Model & usage';
modelDetails.append(modelSummary,modelBar);
panel.querySelector('.hc-head')?.after(modelDetails);
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
/** Audit §9F: the composer must switch Send → Stop while a task is running,
 *  instead of disabling itself and leaving Stop buried in the progress strip. */
function setRunning(running:boolean){
  const send=el('hc-send') as HTMLButtonElement;
  send.disabled=false;
  send.dataset.mode=running?'stop':'send';
  send.innerHTML=running?'<span aria-hidden="true">■</span> Stop':'<span aria-hidden="true">➤</span> Send';
  send.title=running?'Stop the running task':'Send message';
  el('hc-progress').hidden=!running;
}
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
function clearStream(){liveTask='';liveText='';liveBubble=null;traceEl=null;traceBody=null;traceTask='';}
// PHASE48_SCROLL: preserve position on refresh; follow on completion/open.
let hcRenderGeneration=0;
async function render(forceBottom=false){
  const generation=++hcRenderGeneration;
  const thread=conversationId;
  paintThreadTitle();
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
    // Re-attach in-memory reasoning/tool traces under their assistant turns.
    for(const t of data.turns){if(t.role!=='assistant'||!t.task_id)continue;const tr=traces.get(t.task_id);if(!tr||(!tr.thought&&!tr.tools.length))continue;const det=document.createElement('details');det.className='hc-trace hc-trace-done';const s=document.createElement('summary');s.textContent=`💭 Reasoning & tool activity (${tr.tools.length} step${tr.tools.length===1?'':'s'})`;const b=document.createElement('div');b.className='hc-trace-body';renderTraceInto(b,tr,false);det.append(s,b);messages.append(det);}
    if(activeTask&&liveTask===activeTask&&liveText){const text=liveText;clearStream();streamBubble(activeTask,text);}
    const last=data.turns[data.turns.length-1];
    if(last.role==='user'&&last.task_id&&!['completed','failed','cancelled','stopped'].includes(activeState)){
      activeTask=last.task_id;void pollTask();
    }
    restore();
  }catch(err){feedback.textContent='History unavailable: '+String(err)}
}
const threadTitles=new Map<string,string>();
/** chat-audit §5: the head must name the thread you are reading, not the product. */
function paintThreadTitle(){const t=el('hc-thread-title');if(!t)return;const known=conversationId?threadTitles.get(conversationId):'';t.textContent=known||(conversationId?`Conversation ${conversationId.slice(0,8)}`:'New conversation');}
/* Chat audit §6: conversation history is primary navigation, not a popover.
   The list is a real column: searchable, grouped by day, and it marks the
   open thread. One fetch fills a cache; the search field filters it locally so
   typing does not re-hit the API on every keystroke. */
let threadCache:Conversation[]=[];
function renderThreadList(){
  const nav=el('hc-threads');
  const groups=groupThreads(threadCache,(el('hc-thread-filter') as HTMLInputElement).value);
  nav.replaceChildren();
  if(!groups.length){
    const p=document.createElement('p');p.className='hc-thread-empty';
    p.textContent=threadCache.length?'No thread matches that search.':'No conversations yet — send a message to start one.';
    nav.append(p);return;
  }
  for(const g of groups){
    const h=document.createElement('h3');h.className='hc-thread-group';h.textContent=g.bucket;nav.append(h);
    for(const t of g.threads){
      const btn=document.createElement('button');
      btn.type='button';btn.className='hc-thread-item';btn.title=t.title||'Conversation';
      const name=document.createElement('span');name.className='hc-thread-name';name.textContent=t.title||'Conversation';
      const when=document.createElement('span');when.className='hc-thread-when';
      const d=new Date(t.updated_at);
      when.textContent=isNaN(d.getTime())?'':d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
      btn.append(name,when);
      if(t.id===conversationId)btn.setAttribute('aria-current','true');
      btn.onclick=()=>{conversationId=t.id;localStorage.setItem(stored,t.id);clearStream();activeTask='';restoreChatSelection();paintThreadTitle();void render(true);void refreshThreads()};
      nav.append(btn);
    }
  }
}
async function refreshThreads(){try{const data=await request<{conversations:Conversation[]}>('/api/conversations');threadCache=data.conversations||[];for(const t of threadCache)threadTitles.set(t.id,t.title||'');renderThreadList();paintThreadTitle()}catch(err){feedback.textContent=String(err)}}
async function pollTask(){if(!activeTask)return;try{const t=await request<Task>('/api/tasks/'+encodeURIComponent(activeTask));activeState=t.state;state('Task '+t.state);const running=['queued','running','pending'].includes(t.state);setRunning(running);if(!running){const finishedId=activeTask;activeTask='';await renderFinished();void refreshChatUsage(finishedId);}}catch(err){feedback.textContent=String(err)}}
async function renderFinished(){clearStream();await render(true);}
function eventItem(e:Evt){if(e.task_id!==activeTask)return;if(e.sequence<=lastSeq)return;lastSeq=e.sequence;if(e.type==='hermes.text'){const delta=e.payload?.text;if(typeof delta==='string'){if(hasExplicitThoughtMarker(e.payload))showExplicitThought(e.task_id||'',delta);else streamBubble(e.task_id||'',delta);}return;}
if(e.type==='hermes.tool_use'||e.type==='hermes.tool_result'){const p=e.payload||{};const t=traceOf(e.task_id||'');if(e.type==='hermes.tool_use')t.tools.push({label:toolName(p),detail:toolDetail(p)});else if(t.tools.length)t.tools[t.tools.length-1].result=toolResultText(p);if(activeTask)refreshTrace(e.task_id||'');}
const events=el('hc-events');const d=document.createElement('div');d.textContent=`${new Date(e.timestamp).toLocaleTimeString()} · ${e.type} · ${JSON.stringify(e.payload).slice(0,550)}`;events.append(d);while(events.childElementCount>120)events.firstElementChild?.remove();events.scrollTop=events.scrollHeight;if(e.type==='task.completed'||e.type==='task.failed'||e.type==='task.cancelled'){void pollTask()}else if(e.type==='task.started')state('Hermes is executing');}
function connect(){socket?.close();const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/events?after=${lastSeq}`);socket=ws;ws.onmessage=ev=>{try{eventItem(JSON.parse(ev.data) as Evt)}catch{}};ws.onclose=()=>{if(socket===ws)setTimeout(connect,2500)};}
// HL-CONV-001: Hermes Chat is the primary conversational surface. Any
// workspace (Task Board, thread views) can request a hand-off here —
// with the conversation to continue and optional prefill text. If only
// a task_id is known, we resolve its conversation via /api/tasks/{id}.
window.addEventListener('hermes:open-in-chat',(ev:Event)=>{
  const d=((ev as CustomEvent<{conversation_id?:string;task_id?:string;prefill?:string;submit?:boolean}>).detail||{}) as {conversation_id?:string;task_id?:string;prefill?:string;submit?:boolean};
  const open=async(convId:string|undefined)=>{
    panel.hidden=false;clearStream();activeTask='';activeState='idle';
    if(convId){conversationId=convId;localStorage.setItem(stored,convId);}
    restoreChatSelection();
    void render(true);void refreshThreads();
    if(!socket||socket.readyState>1)connect();
    void refreshChatUsage(d.task_id || '');
    if(d.prefill){const box=el('hc-input') as HTMLTextAreaElement;box.value=d.prefill;box.focus();if(d.submit){el('hc-form').dispatchEvent(new Event('submit',{cancelable:true}));}else{feedback.textContent='Draft opened in Chat — review and press Send.';}}
  };
  void open(d.conversation_id);
  if(!d.conversation_id&&d.task_id){void request<Task&{conversation_id?:string}>(`/api/tasks/${encodeURIComponent(d.task_id)}`).then(t=>{if(t.conversation_id){conversationId=t.conversation_id;localStorage.setItem(stored,conversationId);clearStream();activeTask='';void render(true);void refreshThreads();}else{feedback.textContent='This task has no conversation thread yet.';}}).catch(e=>{feedback.textContent=String(e)});}
});
void initializeChatModels();
/* The chat is brought to life by its workspace becoming active, never by a
   launcher. Ownership of the refresh path stays here; main.v2 only announces
   the intent, so state never changes hands. */
function openChat(){void render(true);void refreshThreads();if(!socket||socket.readyState>1)connect()}
window.addEventListener('hermes:chat-open',()=>openChat());
el('hc-logout').onclick=()=>{void gateLogout();};
// HL-AUTH-003: passkey enrolment. The button appears while the gate is
// enabled and the session is live, and STAYS visible after the first
// enrolment so additional devices (1Password etc.) can register too —
// each device gets its own credential in the store.
void (async()=>{
  const passkeyBtn=el('hc-passkey') as HTMLButtonElement;
  try{
    const st=await fetch('/api/entrance/status').then(r=>r.json());
    if(st.enabled&&st.authenticated)passkeyBtn.hidden=false;
  }catch{/* gate status unknown: keep the enrol button hidden */}
  passkeyBtn.onclick=async()=>{
    passkeyBtn.disabled=true;
    try{
      const out=await gateRegisterPasskey() as {credentials?:{credential_id:string}[]};
      const n=out&&out.credentials?out.credentials.length:undefined;
      passkeyBtn.hidden=true;state(n?`Passkey registered (${n} credential${n===1?'':'s'} on file)`:'Passkey registered on this device');
    }
    catch(e){state(e instanceof Error?e.message:'Passkey registration failed');passkeyBtn.disabled=false;}
  };
})();
el('hc-new').onclick=()=>{if(activeTask&&['queued','running'].includes(activeState)){feedback.textContent='Finish the active task before starting another conversation.';return;}conversationId='';localStorage.removeItem(stored);activeTask='';pendingRevision=null;void render();state('New conversation')};
el('hc-thread-filter').addEventListener('input',renderThreadList);
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
el('hc-form').addEventListener('submit',async ev=>{ev.preventDefault();const box=el('hc-input') as HTMLTextAreaElement;const prompt=box.value.trim();if(!prompt||activeTask)return;feedback.textContent='';setRunning(true);try{const t=await request<Task&{conversation_id:string}>('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,conversation_id:conversationId||null,...chatModelSelection(),...(pendingRevision?{revision_of:pendingRevision.id,revision_text:pendingRevision.content}:{})})});conversationId=t.conversation_id;localStorage.setItem(stored,conversationId);clearStream();activeTask=t.id;activeState=t.state;void refreshChatUsage(t.id);box.value='';autogrow();pendingRevision=null;await render();state('Hermes is working');}catch(err){feedback.textContent='Not submitted: '+String(err);setRunning(false)}});
(el('hc-input') as HTMLTextAreaElement).addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();el('hc-form').dispatchEvent(new Event('submit',{cancelable:true}))}});
/* Audit §9A/§9B: the composer grows with the prompt instead of staying a
   one-line box, capped so a long prompt can never swallow the conversation. */
function autogrow(){const box=el('hc-input') as HTMLTextAreaElement;box.style.height='auto';const cap=Math.round(window.innerHeight*0.42);box.style.height=Math.min(box.scrollHeight,cap)+'px';}
(el('hc-input') as HTMLTextAreaElement).addEventListener('input',autogrow);
window.addEventListener('resize',()=>autogrow());
/* Audit §9D/§9E + §10: name the working context and the model in the composer,
   delegating to the controls that already own them rather than duplicating
   them. The web UI has no custom-command feature, so no command-menu control is
   offered — the audit's own rule is not to expose capabilities that do not
   exist. */
/* The project-bar controls are created by phase412 with their identifier as a
   CLASS (its `button(label, className)` helper), except the workspace selector,
   which is given a real id. Resolve either, or the chip silently does nothing. */
const byClassOrId=(id:string)=>document.getElementById(id)||document.querySelector<HTMLElement>('.'+id);
el('hc-attach').onclick=()=>{byClassOrId('hc415-files-button')?.click()};
el('hc-composer-workspace').onclick=()=>{byClassOrId('hc415-workspace-button')?.click()};
el('hc-composer-context').onclick=()=>{byClassOrId('hc415-ws-selector')?.click()};
el('hc-composer-model').onclick=()=>{const d=document.getElementById('hc-model-details') as HTMLDetailsElement|null;if(d){d.open=true;d.scrollIntoView({block:'nearest'})}};
function syncComposerLabels(){
  const raw=document.getElementById('hc415-ws-selector')?.textContent||'';
  const ctx=raw.replace(/^\s*(Working Directory|Workspace):\s*/i,'').trim();
  if(ctx)el('hc-composer-context-label').textContent=ctx;
  const sel=document.getElementById('hc-model') as HTMLSelectElement|null;
  const label=(sel?.selectedOptions?.[0]?.textContent||'').trim();
  el('hc-composer-model-label').textContent=label||'Worker default';
}
setInterval(syncComposerLabels,1500);
/* Audit §9F: the same control stops a run in flight. */
(el('hc-send') as HTMLButtonElement).addEventListener('click',ev=>{
  if((el('hc-send') as HTMLButtonElement).dataset.mode==='stop'){ev.preventDefault();el('hc-stop').click();}
});
setInterval(()=>{if(activeTask)void pollTask()},1500);
