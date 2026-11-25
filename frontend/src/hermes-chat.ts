import './hermes-chat.css';
import './chat-upgrade.css';
import './chat-clarity.css';
import { renderHermesMarkdown } from './chat-markdown';
import { gateLogout, gateRegisterPasskey } from './gate';
import { groupThreads } from './thread-groups';
import { toolAction, resultSummary, hasMoreDetail, formatDuration } from './trace-format';

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
 <header class="hc-head"><div class="hc-brand"><span class="hc-logo" aria-hidden="true">✦</span><div class="hc-brand-copy"><strong id="hc-thread-title">New conversation</strong><small id="hc-state">Hermesha · connected</small></div></div><span class="hc-actions" aria-hidden="true"></span></header>
 <main id="hc-messages" aria-live="polite"><div class="hc-empty">Start a conversation with Hermes.<br>Messages and tasks share the same thread.</div><button id="hc-jump-latest" type="button" title="Jump to the latest messages" hidden>↓ Latest</button></main>
 <div id="hc-progress" hidden><span id="hc-progress-label">Hermes is working…</span><button id="hc-details">Activity ▾</button><button id="hc-stop" type="button" title="Stop current task">Stop</button></div>
 <div id="hc-events" hidden></div>
 <div id="hc-feedback" role="status"></div>
 <form id="hc-form"><div class="hc-composer-box"><textarea id="hc-input" rows="1" placeholder="Ask Hermesha to build, explain, fix, or research…" aria-label="Message Hermesha"></textarea><div class="hc-composer-tools"><button id="hc-attach" type="button" title="Browse project files and attach them"><span aria-hidden="true">＋</span> Attach</button><span id="hc-project-slot" class="hc-project-slot"></span></div><div class="hc-composer-actions"><button id="hc-model-button" type="button" aria-haspopup="dialog" aria-expanded="false" title="Change the chat model — provider and catalogue inside"><span id="hc-model-button-label">Worker default</span><span class="hc-caret" aria-hidden="true"> ▾</span></button><button id="hc-usage-chip" type="button" aria-haspopup="dialog" aria-expanded="false" title="Context, tokens and session cost — click for the detail panel"><span id="hc-usage-chip-label">Context unavailable</span></button><button id="hc-send" type="submit" title="Send message (Enter) · Shift+Enter adds a new line"><span aria-hidden="true">➤</span> Send</button></div></div></form>
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
// assistant turn. A reload clears the live capture — but the CLI session store
// records every step, so /api/chat/trace rehydrates finished turns from there.
type TraceEntry={kind:'tool';label:string;args:unknown;result?:string;startedAt:number;ms?:number};
type TraceStep={kind:'thought';text:string}|{kind:'text';text:string}|TraceEntry;
// Reasoning interleaves: the CLI shows a thinking block, then the call it produced,
// then the next block. Consecutive reasoning deltas merge into the open thought
// block; a tool call closes it and the next delta starts a new one.
const traces=new Map<string,{steps:TraceStep[];open:boolean}>();
function traceOf(taskId:string){let t=traces.get(taskId);if(!t){t={steps:[],open:true};traces.set(taskId,t);if(traces.size>30){const oldest=traces.keys().next().value;if(oldest)traces.delete(oldest);}}return t;}
function toolName(p:Record<string,unknown>):string{return String(p.tool??p.name??p.function_name??'tool');}
/** The tool's ARGUMENTS stay structured; they are turned into a readable
 *  statement at render time (trace-format.toolAction) instead of being
 *  serialised here as the JSON blob the transcript used to show. */
function toolArgs(p:Record<string,unknown>):unknown{return p.arguments??p.input??p.args??p.params??null;}
function toolResultRaw(p:Record<string,unknown>):string{const raw=p.text??p.output??p.result??p.content??p;const s=typeof raw==='string'?raw:JSON.stringify(raw);return s||'';}
/* In-flow trace (the CLI transcript's shape): each reasoning block and tool
   call is its OWN element inside the message flow, appended as it arrives and
   updated in place. Nothing accumulates in a block at the bottom — the thread
   reads like the CLI: thought, call, call, narration, answer. */
let flowEls=new Map<number,HTMLElement>();let flowTask='';let flowBox:HTMLElement|null=null;
function clearFlow(){flowEls.clear();flowTask='';flowBox=null;}
/* The live trace lives in ONE wrapper placed immediately before the answer
   bubble (or at the end while the answer has not started). A wrapper — rather
   than elements appended straight into the thread — is what lets the trace be
   REPLACED wholesale: the worker's stream carries tool activity and answer text
   but does NOT label its reasoning, so the live capture is a wall of tool rows.
   The CLI store has the interleaved transcript, and re-reading it means
   swapping the whole trace, not patching it step by step. */
function ensureFlowBox():HTMLElement{
 if(flowBox&&flowBox.isConnected)return flowBox;
 flowBox=document.createElement('div');flowBox.className='hc-trace-flow';
 const anchor=liveBubble&&liveBubble.isConnected?liveBubble:null;
 if(anchor)anchor.before(flowBox);else messages.append(flowBox);
 return flowBox;
}
function traceSummary(t:{steps:TraceStep[];open:boolean}):string{
 const tools=t.steps.filter((s):s is TraceEntry=>s.kind==='tool');
 const n=tools.length;
 const lastTool=tools[n-1];
 const last=lastTool?toolAction(lastTool.label,lastTool.args).text:'';
 const thought=t.steps.some(s=>s.kind==='thought');
 return thought&&!n?'💭 Thinking…':last?`Working — ${last}${n>1?` · ${n} steps`:''}`:'💭 Reasoning & tool activity';
}
/* Chat audit §15 / PHASE49_TRACE: one readable STATEMENT per tool call, the way
   the Hermes CLI prints it — `$ cd /x && ls`, `read hermes_life/app.py` — with a
   summarised result line and the full output behind a disclosure. The wire
   payload is never shown raw: it is the event format, not something a person
   reads. */
/* One in-flow element per step. Live sync updates existing elements in place
   (a tool row gains its ✓ and result when the result event lands; a thought
   block grows as deltas stream). Done re-attach builds a fresh fragment —
   those steps are final and go straight into the thread after their turn. */
function renderTraceInto(host:HTMLElement,t:{steps:TraceStep[]},live:boolean):void{
 // Numbered continuously across the whole turn — a thought block does NOT
 // restart the count. Restarting per block made every row read "1." in the
 // common case (one call, think, one call), which looks broken.
 let toolIdx=0;
 t.steps.forEach((step,i)=>{
  if(step.kind==='thought'){
   let d=flowEls.get(i) as HTMLDetailsElement|null;
   if(!d||!d.isConnected||!d.classList.contains('hc-trace-thought')){
    const stick=followBottom();
    d=document.createElement('details');d.className='hc-trace-thought';d.open=true;
    host.append(d);flowEls.set(i,d);
    if(stick)messages.scrollTop=messages.scrollHeight;
   }
   let s=d.querySelector('summary') as HTMLElement|null;
   if(!s){s=document.createElement('summary');d.prepend(s);}
   s.textContent='💭 '+step.text.split('\n')[0].slice(0,90)+(step.text.length>90?'…':'');
   let b=d.querySelector('.hc-body') as HTMLElement|null;
   if(!b){b=document.createElement('div');b.className='hc-body';d.append(b);}
   renderHermesMarkdown(b,step.text);
   return;
  }
  if(step.kind==='text'){
   // Mid-turn narration the CLI spoke between calls — muted, not a bubble.
   let n=flowEls.get(i);
   if(!n||!n.isConnected||n.className!=='hc-trace-note'){n=document.createElement('div');n.className='hc-trace-note';host.append(n);flowEls.set(i,n);}
   n.textContent=step.text;return;
  }
  // Tool step: one row, numbered in call order across the whole turn.
  toolIdx++;
  const act=toolAction(step.label,step.args);
  let row=flowEls.get(i);
  if(!row||!row.isConnected||row.className!=='hc-tool'){
   const stick=followBottom();
   row=document.createElement('div');row.className='hc-tool';
   const line=document.createElement('div');line.className='hc-tool-line';
   const status=document.createElement('span');status.className='hc-tool-status hc-tool-live';status.textContent='●';
   const num=document.createElement('span');num.className='hc-tool-num';num.textContent=String(toolIdx)+'.';
   const pill=document.createElement('span');pill.className='hc-tool-name';pill.textContent=act.name;
   const cmd=document.createElement('code');cmd.className='hc-tool-cmd';cmd.textContent=act.text;
   line.append(status,num,pill,cmd);row.append(line);
   host.append(row);flowEls.set(i,row);
   if(stick)messages.scrollTop=messages.scrollHeight;
  }
  const line=row.querySelector('.hc-tool-line')!;
  const status=line.querySelector('.hc-tool-status')!;
  status.className='hc-tool-status'+(step.ms===undefined?' hc-tool-live':'');
  status.textContent=step.ms===undefined?'●':'✓';
  row.querySelector('.hc-tool-num')!.textContent=String(toolIdx)+'.';
  row.querySelector('.hc-tool-name')!.textContent=act.name;
  row.querySelector('.hc-tool-cmd')!.textContent=act.text;
  let ms=line.querySelector('.hc-tool-ms');
  if(step.ms!==undefined){if(!ms){ms=document.createElement('span');ms.className='hc-tool-ms';line.append(ms);}ms.textContent=formatDuration(step.ms);}
  else ms?.remove();
  const summary=step.result?resultSummary(step.result):null;
  let out=row.querySelector('.hc-tool-out');
  if(summary){
   if(!out){out=document.createElement('div');row.append(out);}
   out.className='hc-tool-out'+(summary.startsWith('failed · ')?' hc-tool-failed':'');
   out.textContent='→ '+summary;
  }else out?.remove();
  let more=row.querySelector('.hc-tool-more');
  if(step.result&&hasMoreDetail(step.result)){
   if(!more){more=document.createElement('details');more.className='hc-tool-more';const s2=document.createElement('summary');s2.textContent='output';const pre=document.createElement('pre');pre.className='hc-tool-result';more.append(s2,pre);row.append(more);}
   (more.querySelector('pre') as HTMLElement).textContent=step.result;
  }else more?.remove();
 });
}
/** A finished turn's trace as a detached fragment for insertion after its
    bubble in the thread. Fresh elements — these steps are final. */
function traceFragment(t:{steps:TraceStep[]}):DocumentFragment{
 const saved=new Map(flowEls);flowEls=new Map();
 const box=document.createElement('div');
 renderTraceInto(box,t,false);
 const frag=document.createDocumentFragment();
 while(box.firstChild)frag.append(box.firstChild);
 flowEls=saved;
 return frag;
}
function refreshTrace(taskId:string,redraw=false):void{
 const t=traceOf(taskId);
 if(flowTask!==taskId){flowEls.clear();flowTask=taskId;}
 const box=ensureFlowBox();
 // A re-hydrated trace REPLACES the live capture: the steps are a different
 // list (the reasoning the stream never labelled), so patching element by
 // element would leave stale rows behind.
 if(redraw){box.replaceChildren();flowEls=new Map();}
 renderTraceInto(box,t,true);
 const stick=followBottom();if(stick)messages.scrollTop=messages.scrollHeight;
 // The progress line says what is happening right now, not just "working".
 const label=el('hc-progress-label');
 if(label&&!el('hc-progress').hidden)label.textContent=traceSummary(t);
}
function showExplicitThought(taskId:string,delta:string):void {
 if(taskId!==activeTask||!delta)return;
 const t=traceOf(taskId);
 const last=t.steps[t.steps.length-1];
 // Interleave (the CLI's shape): consecutive deltas extend the open thought
 // block; after a tool call the next delta starts a NEW block before it.
 // The CLI shows the model's extended thinking as full prose; the rolling
 // window threw that away. Keep the start, cap at a runaway guard only.
 if(last&&last.kind==='thought')last.text=(last.text+delta).slice(0,200000);
 else t.steps.push({kind:'thought',text:delta.slice(0,200000)});
 if(t.steps.length>400)t.steps.splice(0,t.steps.length-400);
 refreshTrace(taskId);
}
/** Durable traces: a finished turn whose live capture is gone (reload, other
 *  device) gets its steps back from the CLI session store via the backend —
 *  the same interleaved shape, so reasoning still sits between the calls. */
function hydrateTrace(taskId:string,force=false):void{
 const live=traces.get(taskId);
 if(live&&!force)return; // one fetch per task per page load unless explicitly refreshed
 const placeholder:{steps:TraceStep[];open:boolean}={steps:[],open:false};
 traces.set(taskId,placeholder);
 // The live capture stays the fallback: if the store has nothing yet (the turn
 // has not written its transcript, or the read fails) we must not blank a trace
 // that is already on screen.
 const restore=()=>{if(live&&!placeholder.steps.length&&traces.get(taskId)===placeholder)traces.set(taskId,live);};
 void fetch('/api/chat/trace/'+encodeURIComponent(taskId))
  .then(r=>r.ok?r.json():null)
  .then((data:{steps?:unknown}|null)=>{
   if(!data||!Array.isArray(data.steps)){restore();return;}
   const steps:TraceStep[]=[];
   for(const raw of data.steps as Array<Record<string,unknown>>){
    if(raw.kind==='thought'&&typeof raw.text==='string'&&raw.text.trim())steps.push({kind:'thought',text:raw.text});
    else if(raw.kind==='text'&&typeof raw.text==='string'&&raw.text.trim())steps.push({kind:'text',text:raw.text});
    else if(raw.kind==='tool')steps.push({kind:'tool',label:String(raw.label||'tool'),args:raw.args??null,
     result:typeof raw.result==='string'?raw.result:undefined,startedAt:0,
     ms:typeof raw.ms==='number'?raw.ms:undefined});
   }
   if(!steps.length){restore();return;}
   placeholder.steps=steps;
   // A live turn redraws its own trace in place (the wrapper sits before the
   // answer bubble); a finished thread is redrawn whole.
   if(activeTask===taskId)refreshTrace(taskId,true);
   else if(!activeTask)void render();
  })
  .catch(restore);
}
function hasExplicitThoughtMarker(payload:Record<string,unknown>):boolean {
 // Only explicit public runtime annotations qualify, never guessed from prose.
 const marker=String(payload.channel??payload.content_type??payload.message_type??'').toLowerCase();
 return ['thought','thinking','reasoning','analysis','commentary'].includes(marker);
}


// HL-CHAT-002: provider/model choice is a per-turn override, not a global worker mutation.
// V2 chat audit §3/#13/#14/#17/#18: the composer is THREE areas — text entry, a tools
// row, an action row. Model configuration and usage detail live behind two compact
// controls on the action row; the dashboard rows are gone. The <select>s stay in the
// DOM as hidden state holders (the phase412 picker pattern) so every change-handler
// and persistence path keeps working untouched.
const modelBar=document.createElement('div'); modelBar.id='hc-model-controls'; modelBar.hidden=true;
modelBar.innerHTML=`<label class="hc-hidden-control">Provider <select id="hc-provider" aria-label="Chat provider" tabindex="-1"><option value="">Default</option></select></label>
<label class="hc-hidden-control">Model <select id="hc-model" aria-label="Chat model" tabindex="-1"><option value="">Worker default</option></select></label>`;
const composerBox=panel.querySelector('.hc-composer-box')!;
composerBox.append(modelBar);
// ONE model selector (audit #13): provider, catalogue and context windows behind a
// single control. Pricing appears only when the catalogue reports it — never invented.
const modelPopover=document.createElement('div');modelPopover.id='hc-model-popover';modelPopover.hidden=true;modelPopover.setAttribute('role','dialog');modelPopover.setAttribute('aria-label','Chat model selection');
composerBox.append(modelPopover);
const retryModels=document.createElement('button');retryModels.type='button';retryModels.id='hc-retry-models';retryModels.textContent='↻ Reload catalogue';retryModels.title='Reload provider and model catalog';modelPopover.append(retryModels);
retryModels.onclick=()=>void initializeChatModels();
// The usage chip (audit #14/#15/#16): one compact line — occupied context and session
// cost — with the full meter, token totals, balance and the breakdown note behind it.
// Same records, same element ids, new home.
const usagePopover=document.createElement('div');usagePopover.id='hc-usage-popover';usagePopover.hidden=true;usagePopover.setAttribute('role','dialog');usagePopover.setAttribute('aria-label','Usage details');
usagePopover.innerHTML=`<div class="hc-usage-meter"><span class="hc-metric" id="hc-context-label">Context: unavailable</span><progress id="hc-context-bar" max="100" value="0" hidden></progress></div>
<div class="hc-usage-grid"><span class="hc-metric" id="hc-tokens-label" title="Input + output tokens of the most recent request">Tokens: unavailable</span><span class="hc-metric" id="hc-cost-label">Cost: unavailable</span><span class="hc-metric" id="hc-balance-label">Balance: unavailable</span></div>
<div class="hc-context-details" id="hc-context-details">
<div class="hc-context-details-row"><span>Component</span><span>Tokens</span></div>
<div class="hc-context-details-row"><span>System instructions</span><span class="hc-unavailable">unavailable</span></div>
<div class="hc-context-details-row"><span>Conversation history</span><span class="hc-unavailable">unavailable</span></div>
<div class="hc-context-details-row"><span>Retrieved memory</span><span class="hc-unavailable">unavailable</span></div>
<div class="hc-context-details-row"><span>Project knowledge</span><span class="hc-unavailable">unavailable</span></div>
<div class="hc-context-details-row"><span>Tool content</span><span class="hc-unavailable">unavailable</span></div>
<div class="hc-context-details-row hc-context-details-note">The runtime does not report a per-component breakdown; only the measured total above is shown.</div>
</div>`;
composerBox.append(usagePopover);
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
 updateModelButtonLabel();
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
// V2 audit #13: the model button shows the ACTIVE model; the popover groups the real
// catalogue by provider with each model's context window. "Worker default" clears the
// override — the same state the hidden selects hold.
function updateModelButtonLabel(){
 const option=chatModel().selectedOptions[0];
 el('hc-model-button-label').textContent=option&&option.value?option.textContent||'Worker default':'Worker default';
}
function renderModelPopover(){
 modelPopover.replaceChildren();
 const none=document.createElement('button');none.type='button';none.className='hc-popover-model';
 none.textContent='Worker default — no override';
 if(!chatModel().value)none.classList.add('hc-popover-selected');
 none.onclick=()=>{chatProvider().value='';chatModel().value='';saveChatSelection();refreshModelChoices();updateModelButtonLabel();closePopovers();};
 modelPopover.append(none);
 const providers=[...new Set(allowedChatModels.map(x=>x.provider))];
 if(!providers.length){
   const note=document.createElement('p');note.className='hc-popover-empty';
   note.textContent='No models configured · backend HERMES_LIFE_CHAT_MODELS';
   modelPopover.append(note);
 }
 for(const provider of providers){
   const group=document.createElement('div');group.className='hc-popover-group';
   const head=document.createElement('div');head.className='hc-popover-group-head';head.textContent=provider;
   group.append(head);
   for(const choice of allowedChatModels.filter(x=>x.provider===provider)){
     const row=document.createElement('button');row.type='button';
     row.className='hc-popover-model'+(chatProvider().value===provider&&chatModel().value===choice.model?' hc-popover-selected':'');
     const name=document.createElement('span');name.className='hc-popover-model-name';name.textContent=choice.label;
     const meta=document.createElement('span');meta.className='hc-popover-model-meta';
     meta.textContent=choice.context_window?`${fmtTokens(choice.context_window)} window`:'window unknown';
     row.append(name,meta);
     row.onclick=()=>{chatProvider().value=provider;refreshModelChoices();chatModel().value=choice.model;saveChatSelection();updateModelButtonLabel();void refreshChatBalance();closePopovers();};
     group.append(row);
   }
   modelPopover.append(group);
 }
 modelPopover.append(retryModels);
}
// One popover at a time; outside clicks and Escape close both (audit #17's rule —
// the action row stays a compact strip, not an always-open panel).
const modelButton=el('hc-model-button'),usageChip=el('hc-usage-chip');
function closePopovers(){
 modelPopover.hidden=true;usagePopover.hidden=true;
 modelButton.setAttribute('aria-expanded','false');usageChip.setAttribute('aria-expanded','false');
}
modelButton.onclick=()=>{const wasOpen=!modelPopover.hidden;closePopovers();if(!wasOpen){renderModelPopover();modelPopover.hidden=false;modelButton.setAttribute('aria-expanded','true');}};
usageChip.onclick=()=>{const wasOpen=!usagePopover.hidden;closePopovers();if(!wasOpen){usagePopover.hidden=false;usageChip.setAttribute('aria-expanded','true');}};
document.addEventListener('click',(ev)=>{
 const target=ev.target as Node;
 if(!modelPopover.hidden&&!modelPopover.contains(target)&&!modelButton.contains(target))closePopovers();
 else if(!usagePopover.hidden&&!usagePopover.contains(target)&&!usageChip.contains(target))closePopovers();
});
document.addEventListener('keydown',(ev)=>{if(ev.key==='Escape')closePopovers();});
async function refreshChatUsage(taskId:string){
 const context=el('hc-context-label'),cost=el('hc-cost-label'),tokens=el('hc-tokens-label'),progress=el('hc-context-bar') as HTMLProgressElement;
 const chip=el('hc-usage-chip-label');
 context.textContent='Context: unavailable';cost.textContent='Cost: unavailable';tokens.textContent='Tokens: unavailable';
 chip.textContent='Context unavailable';chip.title='';
 context.title='';cost.title='';tokens.title='';
 progress.hidden=true;progress.className='';
 if(!taskId)return;
 try{
   const record=await request<{model?:string;provider?:string;context_window?:number;input_tokens?:number;output_tokens?:number;turn_input_tokens?:number;context_anchor_tokens?:number;api_call_count?:number;estimated_cost_usd?:number;cost_source?:string;model_source?:string}>(`/api/chat/usage/${encodeURIComponent(taskId)}`);
   // HL-CHAT-004: context utilization (occupied window) vs token consumption (spend) are different measurements.
   // The CLI's `_usage_anchor` is the size of the LAST request's prompt — the context
   // actually occupied, and the only figure a meter should be drawn from. The stream's
   // counters are cumulative across a turn's calls, so they are the fallbacks, and
   // input_tokens is the session's total spend.
   const anchored=typeof record.context_anchor_tokens==='number'?record.context_anchor_tokens:null;
   const occupied=anchored!==null?anchored:(typeof record.turn_input_tokens==='number'?record.turn_input_tokens:record.input_tokens);
   // A window resolved from the worker's configuration must never read as if the
   // runtime had reported the model for this turn.
   const provenance=record.model_source==='worker_config'
     ?" The model is the worker's configured default — the runtime did not name one for this turn."
     :'';
   const calls=typeof record.api_call_count==='number'?` across ${record.api_call_count.toLocaleString()} calls`:'';
   const basis=anchored!==null
     ?"This is the last request's prompt — the context actually occupied."
     :`This turn sent ${(occupied||0).toLocaleString()} input tokens${calls} (the runtime's cumulative counter, so it can exceed one window).`;
   if(typeof record.context_window!=='number'&&typeof occupied==='number'){
      // Tokens are known but the window is not: the runtime only names the model
      // when it was overridden, so a "Worker default" run leaves it unknown.
      context.title='The runtime did not report which model ran, so its context window is unknown — pick a model to have this measured';
   }
   if(typeof occupied==='number'&&typeof record.context_window==='number'&&record.context_window>0){
      // The runtime's counter accumulates across every call inside a turn (the
      // agentic loop), so a turn CAN exceed the window — one real row reads 2.9M
      // input against a 1.0M window. A utilisation percentage is meaningless
      // there, so state the figures instead of drawing a clamped, lying bar.
      if(occupied>record.context_window){
         context.textContent=`Context: ${fmtTokens(occupied)} input · window ${fmtTokens(record.context_window)}`;
         chip.textContent=`Context ${fmtTokens(occupied)} input`;chip.title=context.title;
         context.title=basis+' More than the model\'s '+record.context_window.toLocaleString()+' token window, so it cannot be shown as one utilisation figure.'+provenance;
      } else {
         const ratio=Math.min(100,100*occupied/record.context_window);
         context.textContent=`Context: ${fmtTokens(occupied)} / ${fmtTokens(record.context_window)} — ${ratio.toFixed(0)}%`;
         context.title=basis+' Against the model\'s '+record.context_window.toLocaleString()+' token window.'+provenance;
         chip.textContent=`Context ${ratio.toFixed(0)}%`;chip.title=context.title;
         progress.value=ratio;progress.hidden=false;
         // HL-CHAT-004 thresholds: 0-69% mint, 70-89% amber, 90-100% coral.
         progress.className=ratio>=90?'crit':ratio>=70?'warn':'ok';
      }
   }
   if(typeof record.input_tokens==='number'||typeof record.output_tokens==='number'){
      const total=(record.input_tokens||0)+(record.output_tokens||0);
      tokens.textContent=`Tokens: ${fmtTokens(total)}`;
      tokens.title=typeof record.input_tokens==='number'&&typeof record.output_tokens==='number'
        ?`Session total: ${record.input_tokens.toLocaleString()} input + ${record.output_tokens.toLocaleString()} output${record.model?` · ${record.model}`:''}`
        :'Session usage (partial report)';
   }
   if(typeof record.estimated_cost_usd==='number'){
      cost.textContent=`Session: $${record.estimated_cost_usd.toFixed(2)}`;
      const SOURCES:{[k:string]:string}={
        provider_actual:'Actual spend reported by the provider',
        provider_models_api:"Priced by the Hermes CLI from the provider's own model list",
        provider_rates:"Derived on the host from the provider's published per-token rates (the runtime reports no price)",
      };
      cost.title=(SOURCES[record.cost_source||'']||'Reported by the runtime')
        +(typeof record.api_call_count==='number'?` · ${record.api_call_count.toLocaleString()} API calls this turn`:'');
      if(chip.textContent!=='Context unavailable')chip.textContent+=` · $${record.estimated_cost_usd.toFixed(2)}`;
      else chip.textContent=`$${record.estimated_cost_usd.toFixed(2)} session`;
      if(!chip.title)chip.title=cost.title;
   }
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
function clearStream(){liveTask='';liveText='';liveBubble=null;clearFlow();}
// PHASE48_SCROLL: preserve position on refresh; follow on completion/open.
let hcRenderGeneration=0;
async function render(forceBottom=false){
  const generation=++hcRenderGeneration;
  const thread=conversationId;
  paintThreadTitle();
  // The project panel keeps its selection per conversation — announce which
  // conversation is open so it can follow (General chat unless that thread
  // carries a project). The listener ignores no-op switches.
  window.dispatchEvent(new CustomEvent('hc-conversation-changed',{detail:conversationId}));
  const topBefore=messages.scrollTop;
  const follow=forceBottom||followBottom()||messages.querySelector('.hc-empty')!==null||messages.childElementCount===0;
  const restore=()=>{requestAnimationFrame(()=>{
    if(generation!==hcRenderGeneration||thread!==conversationId)return;
    messages.scrollTop=follow?messages.scrollHeight:topBefore;
  });};
  // Do not clear while the HTTP request is in flight.
  if(!conversationId){messages.innerHTML='<div class="hc-empty">Start a conversation with Hermes.<br>Messages and tasks share the same thread.</div>';void refreshChatUsage('');return;}
  try{
    const data=await request<{turns:Turn[]}>(`/api/conversations/${encodeURIComponent(thread)}`);
    if(generation!==hcRenderGeneration||thread!==conversationId)return;
    messages.replaceChildren();
    if(!data.turns.length){messages.textContent='No messages yet.';return;}
    for(const t of data.turns)addBubble(t.role,t.content,t.created_at,t.task_id,t.id);
    // The metrics describe the THREAD, so opening one has to populate them. This
    // refresh previously ran only on submit and on task completion, so an existing
    // thread showed "unavailable" even for a task that did hold tokens: the turns
    // carry task_id, which is all the usage endpoint needs.
    const newestTask=[...data.turns].reverse().find(t=>t.task_id)?.task_id;
    void refreshChatUsage(activeTask||newestTask||'');
    // Re-attach reasoning/tool traces under their assistant turns: the live
    // capture when this session saw the turn, otherwise rehydrated from the
    // CLI session store (durable across reloads).
    // Re-attach reasoning/tool traces under their assistant turns: the live
    // capture when this session saw the turn, otherwise rehydrated from the
    // CLI session store (durable across reloads). In-flow: each turn's steps
    // are inserted directly after that turn's bubble, CLI-transcript style.
    for(const t of data.turns){
     if(t.role!=='assistant'||!t.task_id)continue;
     let tr=traces.get(t.task_id);
     if(!tr){hydrateTrace(t.task_id);continue}
     if(!tr.steps.length)continue;
     // Both the user's and the assistant's bubble carry the task id, so a bare
     // [data-task-id] selector matches the USER bubble first. Anchor on the
     // assistant bubble: the trace belongs between the prompt and the answer
     // (user · reasoning · tool calls · answer), never above the prompt.
     const taskId:string=t.task_id;
     const sel=(cls:string)=>messages.querySelector(`article.${cls}[data-task-id="${CSS.escape(taskId)}"]`);
     const answer=sel('assistant'),prompt=sel('user');
     const frag=traceFragment(tr);
     if(answer)answer.before(frag);
     else if(prompt)prompt.after(frag);
     else messages.append(frag);
    }
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
      // Two-line row (V2 audit #10): title line, then a date+time meta line — the
      // timestamp is information, not a right-aligned afterthought.
      when.textContent=isNaN(d.getTime())?'':d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' · '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
      btn.append(name,when);
      if(t.id===conversationId)btn.setAttribute('aria-current','true');
      btn.onclick=()=>{conversationId=t.id;localStorage.setItem(stored,t.id);clearStream();activeTask='';restoreChatSelection();paintThreadTitle();void render(true);void refreshThreads()};
      nav.append(btn);
    }
  }
}
async function refreshThreads(){try{const data=await request<{conversations:Conversation[]}>('/api/conversations');threadCache=data.conversations||[];for(const t of threadCache)threadTitles.set(t.id,t.title||'');renderThreadList();paintThreadTitle()}catch(err){feedback.textContent=String(err)}}
async function pollTask(){if(!activeTask)return;try{const t=await request<Task>('/api/tasks/'+encodeURIComponent(activeTask));activeState=t.state;state('Task '+t.state);const running=['queued','running','pending'].includes(t.state);setRunning(running);if(!running){const finishedId=activeTask;activeTask='';await renderFinished(finishedId);void refreshChatUsage(finishedId);}}catch(err){feedback.textContent=String(err)}}
async function renderFinished(taskId=''){
 clearStream();await render(true);
 // The live capture only ever held the tool rows (the worker's stream labels no
 // reasoning), so re-read the turn's trace from the CLI store now that it is
 // whole: the reasoning then sits between the calls, exactly as in the CLI.
 if(taskId)hydrateTrace(taskId,true);
}
function eventItem(e:Evt){if(e.task_id!==activeTask)return;if(e.sequence<=lastSeq)return;lastSeq=e.sequence;if(e.type==='hermes.text'){const delta=e.payload?.text;if(typeof delta==='string'){if(hasExplicitThoughtMarker(e.payload))showExplicitThought(e.task_id||'',delta);else streamBubble(e.task_id||'',delta);}return;}
if(e.type==='hermes.tool_use'||e.type==='hermes.tool_result'){const p=e.payload||{};const t=traceOf(e.task_id||'');if(e.type==='hermes.tool_use')t.steps.push({kind:'tool',label:toolName(p),args:toolArgs(p),startedAt:Date.parse(e.timestamp)||Date.now()});else{for(let i=t.steps.length-1;i>=0;i--){const st=t.steps[i];if(st.kind==='tool'){st.result=toolResultRaw(p);const done=Date.parse(e.timestamp);if(Number.isFinite(done)&&st.startedAt)st.ms=Math.max(0,done-st.startedAt);break}}}if(activeTask)refreshTrace(e.task_id||'');}
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
// V2 audit #11: account controls are global-header furniture, not chat furniture —
// the topbar already owns Logout (main.v2.ts) and now hosts Passkey enrolment too.
// HL-AUTH-003: passkey enrolment. The button appears while the gate is
// enabled and the session is live, and STAYS visible after the first
// enrolment so additional devices (1Password etc.) can register too —
// each device gets its own credential in the store.
void (async()=>{
  const passkeyBtn=document.getElementById('topbar-passkey') as HTMLButtonElement|null;
  if(!passkeyBtn)return;
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
// V2 audit #30: while a task streams, scrolling up unpins the follow (followBottom's
// sticky window); this chip brings you back without hunting for the scrollbar.
const jumpLatest=el('hc-jump-latest') as HTMLButtonElement;
messages.addEventListener('scroll',()=>{jumpLatest.hidden=followBottom();},{passive:true});
jumpLatest.onclick=()=>{messages.scrollTop=messages.scrollHeight;jumpLatest.hidden=true;};
el('hc-details').onclick=()=>el('hc-events').hidden=!el('hc-events').hidden;
// V2 audit #15/#16: the breakdown table lives inside the usage popover, always shown
// there — the old meter-click toggle is gone with the dashboard row.
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
/* V2 audit #19/#41: the project pill is gone — the ONE project control is
   phase412's selector, which mounts itself into the composer's tools row. */
const byClassOrId=(id:string)=>document.getElementById(id)||document.querySelector<HTMLElement>('.'+id);
el('hc-attach').onclick=()=>{byClassOrId('hc415-files-button')?.click()};
/* Audit §9F: the same control stops a run in flight. */
(el('hc-send') as HTMLButtonElement).addEventListener('click',ev=>{
  if((el('hc-send') as HTMLButtonElement).dataset.mode==='stop'){ev.preventDefault();el('hc-stop').click();}
});
setInterval(()=>{if(activeTask)void pollTask()},1500);
// The worker streams tool activity and answer text but labels no reasoning, so
// the live capture can only ever be a wall of tool rows. Re-read the turn's
// transcript from the CLI store while it runs (one SSH round trip, throttled)
// so the reasoning appears BETWEEN the calls during the task, not just after.
let traceReadAt=0;
setInterval(()=>{if(!activeTask)return;const now=Date.now();if(now-traceReadAt<15000)return;traceReadAt=now;hydrateTrace(activeTask,true);},5000);
