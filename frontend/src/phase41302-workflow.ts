/** Phase 4.13.2 — readable Goals and Planning, using existing Hermes Life APIs.
 *
 * HL-UI-STATE-001: status labels come from the backend workflow resolver, and refreshing has a
 * visible lifecycle (loading / updated / up to date / failed) instead of silently re-rendering.
 */
import './phase41302-workflow.css';
import { makeRefresh } from './refresh-feedback.ts';
type Obj=Record<string,unknown>;
type Group='waiting'|'running'|'completed'|'stopped'|'all';
const el=(id:string)=>document.getElementById(id);
const str=(v:unknown)=>typeof v==='string'?v:String(v??'');
const records=(v:unknown,keys:string[]):Obj[]=>{
 if(Array.isArray(v))return v as Obj[];
 if(v&&typeof v==='object')for(const k of keys){const a=(v as Obj)[k];if(Array.isArray(a))return a as Obj[]}
 return [];
};
const txt=(tag:string,text:string,cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n};
const button=(label:string,cb:()=>void)=>{const n=txt('button',label) as HTMLButtonElement;n.type='button';n.addEventListener('click',cb);return n};
const date=(value:unknown)=>{if(!value)return 'Date unavailable';const d=new Date(str(value));return Number.isFinite(d.valueOf())?d.toLocaleString():'Date unavailable'};
async function api(path:string,method='GET'){
 const r=await fetch('/api'+path,{method});const raw=await r.text();let value:unknown;
 try{value=raw?JSON.parse(raw):null}catch{value=raw}
 if(!r.ok)throw new Error(`${r.status}: ${typeof value==='object'&&value&&'detail' in value?str((value as Obj).detail):str(value).slice(0,220)}`);
 return value;
}
// ---- workflow status (HL-UI-STATE-001) -------------------------------------
const wf=(r:Obj)=>(r.workflow&&typeof r.workflow==='object'?r.workflow as Obj:null);
const status=(r:Obj)=>str(wf(r)?.status||r.state||'unknown');
const reason=(r:Obj)=>str(wf(r)?.reason||'');
const nextAction=(r:Obj)=>str(wf(r)?.next_action||'none');
const stage=(r:Obj)=>str(wf(r)?.stage||'in_progress');
const recordState=(r:Obj)=>str(r.state||'unknown').toLowerCase();
function group(r:Obj):Group{
 const s=status(r).toLowerCase();
 if(s.includes('queued'))return 'waiting';
 // A superseded goal is finished work (a later duplicate did it), never "running".
 if(s==='investigation complete'||s==='completed'||s.includes('superseded'))return 'completed';
 if(s.includes('failed')||s.includes('rejected')||s.includes('blocked')||s.includes('interrupted')||s.includes('cancelled'))return 'stopped';
 return 'running';
}
function taskOpen(taskId:string){
 window.dispatchEvent(new CustomEvent('hermes:open-task',{detail:{id:taskId}}));
}
function openTab(label:string){
 const target=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(x=>x.textContent?.trim()===label&&!x.closest('#chat-panel'));
 target?.click();
}
function setBusy(node:HTMLButtonElement,promise:Promise<unknown>,after:()=>void,notify:(msg:string)=>void){
 node.disabled=true;void promise.then(()=>{after()}).catch(e=>notify(str(e))).finally(()=>{node.disabled=false});
}
function setupGoals(){
 const legacy=el('goal-list');if(!legacy||el('hl413-goals'))return false;
 const pane=txt('section','') as HTMLElement;pane.id='hl413-goals';pane.className='hl413-flow';legacy.insertAdjacentElement('beforebegin',pane);
 legacy.hidden=true;legacy.classList.add('hl413-hide-legacy');
 // Default to All: opening on an empty "Waiting" list while 22 goals exist reads as "nothing here".
 let data:Obj[]=[],filter:Group='all',notice='';
 const head=txt('div','', 'hl413-flow-head');const desc=txt('p','');const counters=txt('div','', 'hl413-flow-counts');const tabs=txt('div','','hl413-flow-tabs');
 const statusNode=txt('p','','hl413-flow-meta');const entries=txt('div','','hl413-flow-list');
 pane.append(head,desc,counters,tabs,statusNode,entries);
 // Keep the original goal creation form and handlers, but put them behind a disclosure.
 const form=el('goal-form');if(form&&!form.closest('#hl413-create-goal')){
  const details=document.createElement('details');details.id='hl413-create-goal';details.className='hl413-create';
  details.append(txt('summary','Create a new goal'));form.parentElement?.insertBefore(details,form);details.append(form);
 }
 const refresh=makeRefresh({
  load:()=>api('/goals'), apply:(d)=>{data=records(d,['goals','items'])},
  count:(d)=>records(d,['goals','items']).length, noun:'goals', onChange:()=>render()});
 const groups:[Group,string][]=[['waiting','Waiting'],['running','Running'],['completed','Completed'],['stopped','Failed / stopped'],['all','All']];
 function render(){
  const refreshButton=button(refresh.label(),()=>void refresh.run());refreshButton.disabled=refresh.phase==='loading';
  head.replaceChildren(txt('h2','Goals & execution'),refreshButton);
  desc.textContent='Goals are scheduled work. Status is derived from the linked investigation, plan, candidate and review — not from the record alone.';
  counters.replaceChildren();for(const [kind,label] of groups.slice(0,4)){
   const count=data.filter(x=>group(x)===kind).length;const b=button(`${count}  ${label}`,()=>{filter=kind;render()});
   b.className='hl413-flow-count';b.setAttribute('aria-pressed',String(filter===kind));counters.append(b)
  }
  tabs.replaceChildren();for(const [kind,label] of groups){const b=button(label,()=>{filter=kind;render()});b.className='hl413-flow-filter';b.setAttribute('aria-pressed',String(filter===kind));tabs.append(b)}
  const feedback=refresh.statusText();
  statusNode.textContent=`${notice||feedback||'Not refreshed yet'}${refresh.checkedAt?' · Checked '+date(refresh.checkedAt):''} · ${data.length} total goals`;
  statusNode.dataset.state=refresh.phase==='error'?'error':'ok';
  entries.replaceChildren();
  if(refresh.phase==='error'&&!data.length){entries.append(txt('p','Goals could not be loaded: '+refresh.error,'hl413-flow-empty'));return}
  const selected=data.filter(g=>filter==='all'||group(g)===filter);
  if(!selected.length){entries.append(txt('p','No goals in this status.','hl413-flow-empty'));return}
  for(const goal of selected){
   const card=txt('article','','hl413-flow-card');const first=txt('div','','hl413-flow-card-head');
   first.append(txt('strong',str(goal.title)||'Untitled goal'),txt('span',status(goal),'hl413-flow-chip hl413-flow-chip-'+stage(goal)));
   card.append(first,txt('p',`Priority ${str(goal.priority)} · ${goal.updated_at?'Updated '+date(goal.updated_at):goal.created_at?'Created '+date(goal.created_at):'Timestamp unavailable'} · record state: ${recordState(goal)}`,'hl413-flow-meta'));
   if(reason(goal))card.append(txt('p',reason(goal),'hl413-flow-meta'));
   if(goal.id)card.append(txt('p',`Goal ID: ${str(goal.id)}`,'hl413-flow-id'));
   const actions=txt('div','','hl413-flow-actions');
   if(goal.task_id){actions.append(button('View answer & evidence',()=>taskOpen(str(goal.task_id))))}
   else{actions.append(txt('span','No execution task linked yet.','hl413-flow-meta'))}
   const action=nextAction(goal);
   if(action==='open_review')actions.append(button('Review candidate',()=>openTab('Build')));
   if(action==='start_build'||action==='approve_plan')actions.append(button('Open in Build',()=>openTab('Build')));
   if(['pending','interrupted'].includes(recordState(goal))){const b=button('Cancel',()=>{if(!window.confirm('Cancel this goal?'))return;setBusy(b,api(`/goals/${encodeURIComponent(str(goal.id))}/cancel`,'POST'),()=>void refresh.run(),m=>{notice=m;render()})});actions.append(b)}
   if(['failed','interrupted'].includes(recordState(goal))){const b=button('Retry',()=>{setBusy(b,api(`/goals/${encodeURIComponent(str(goal.id))}/retry`,'POST'),()=>void refresh.run(),m=>{notice=m;render()})});actions.append(b)}
   card.append(actions);entries.append(card);
  }
 }
 render();void refresh.run();window.setInterval(()=>{if(document.contains(pane))void refresh.run()},30000);return true;
}
function setupPlanning(){
 const legacy=el('plans-list');if(!legacy||el('hl413-plans'))return false;
 const pane=txt('section','') as HTMLElement;pane.id='hl413-plans';pane.className='hl413-flow';legacy.insertAdjacentElement('beforebegin',pane);
 // Retain the old plan list for legacy 'Create plan' actions, but move it into disclosure.
 const old=document.createElement('details');old.className='hl413-create';old.append(txt('summary','Manual plan creation / older controls'));
 legacy.parentElement?.insertBefore(old,legacy);old.append(legacy);
 let plans:Obj[]=[],filter:'attention'|'approved'|'all'='attention',notice='';
 const head=txt('div','','hl413-flow-head');const summary=txt('p','','hl413-flow-meta');const tabs=txt('div','','hl413-flow-tabs');const list=txt('div','','hl413-flow-list');
 pane.append(head,summary,tabs,list);
 const refresh=makeRefresh({
  load:()=>api('/investigation-plans'), apply:(d)=>{plans=records(d,['plans','items'])},
  count:(d)=>records(d,['plans','items']).length, noun:'plans', onChange:()=>render()});
 function render(){
  const refreshButton=button(refresh.label(),()=>void refresh.run());refreshButton.disabled=refresh.phase==='loading';
  head.replaceChildren(txt('h2','Investigation plans'),refreshButton);
  const awaiting=plans.filter(p=>status(p)==='Plan ready').length;
  const approved=plans.filter(p=>status(p)==='Awaiting build').length;
  const superseded=plans.filter(p=>status(p)==='Superseded').length;
  const feedback=refresh.statusText();
  summary.textContent=`${notice||feedback||'Not refreshed yet'} · ${awaiting} awaiting approval · ${approved} awaiting build${superseded?' · '+superseded+' superseded':''}${refresh.checkedAt?' · Checked '+date(refresh.checkedAt):''}`;
  summary.dataset.state=refresh.phase==='error'?'error':'ok';
  tabs.replaceChildren();for(const [kind,label] of [['attention','Needs attention'],['approved','Approved'],['all','All plans']] as const){const b=button(label,()=>{filter=kind;render()});b.setAttribute('aria-pressed',String(filter===kind));tabs.append(b)}
  list.replaceChildren();
  if(refresh.phase==='error'&&!plans.length){list.append(txt('p','Plans could not be loaded: '+refresh.error,'hl413-flow-empty'));return}
  const visible=plans.filter(p=>{
    const s=status(p);
    if(filter==='all')return true;
    if(filter==='approved')return s==='Awaiting build'||s==='Completed'||s.startsWith('Awaiting review')||s.startsWith('Building')||s.startsWith('Testing');
    return s==='Plan ready'||s==='Awaiting build'||s.startsWith('Awaiting review');
  });
  if(!visible.length){list.append(txt('p','No plans in this status.','hl413-flow-empty'));return}
  for(const p of visible){const card=txt('article','','hl413-flow-card');let report:Obj={};
   try{const parsed=typeof p.report==='string'?JSON.parse(p.report):p.report;if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))report=parsed as Obj}catch{}
   const top=txt('div','','hl413-flow-card-head');top.append(txt('strong',str(report.summary||'Investigation plan')),txt('span',status(p),'hl413-flow-chip hl413-flow-chip-'+stage(p)));card.append(top);
   card.append(txt('p',`Created ${date(p.created_at)} · Plan ${str(p.id).slice(0,8)} · Investigation task ${str(p.task_id).slice(0,8)} · record state: ${recordState(p)}`,'hl413-flow-meta'));
   if(reason(p))card.append(txt('p',reason(p),'hl413-flow-meta'));
   const details=document.createElement('details');details.className='hl413-flow-details';details.append(txt('summary','Review evidence, steps and acceptance criteria'));
   for(const [key,label] of [['evidence','Evidence'],['steps','Implementation steps'],['acceptance_criteria','Acceptance criteria'],['risks','Risks']] as const){const items=report[key];if(!Array.isArray(items)||!items.length)continue;details.append(txt('h4',label));const ul=document.createElement('ul');for(const item of items)ul.append(txt('li',str(item)));details.append(ul)}
   if(!details.querySelector('ul'))details.append(txt('pre',str(p.report)));
   card.append(details);const actions=txt('div','','hl413-flow-actions');
   if(p.task_id)actions.append(button('View investigation task',()=>taskOpen(str(p.task_id))));
   const action=nextAction(p);
   if(action==='approve_plan'){
    const b=button('Approve plan',()=>{
     if(!details.open){details.open=true;details.scrollIntoView({block:'nearest'});return}
     if(!window.confirm('Approve this investigation plan for candidate implementation? This does not apply any changes to the host.'))return;
     setBusy(b,api(`/investigation-plans/${encodeURIComponent(str(p.id))}/approve`,'POST'),()=>void refresh.run(),m=>{notice=m;render()});
    });actions.append(b)
   }
   if(action==='start_build')actions.append(txt('span','Approved and waiting for its build. Open Build to start it (one click, no project to type).','hl413-flow-meta'));
   if(action==='open_review'||stage(p)==='build')actions.append(txt('span','A candidate exists for this plan: review it in Build.','hl413-flow-meta'));
   if(status(p)==='Superseded')actions.append(txt('span','Superseded by a completed duplicate of the same finding — no work needed.','hl413-flow-meta'));
   card.append(actions);list.append(card);
  }
 }
 render();void refresh.run();window.setInterval(()=>{if(document.contains(pane))void refresh.run()},30000);return true;
}
let tries=0;const install=()=>{const goals=setupGoals(),planning=setupPlanning();if((goals||el('hl413-goals'))&&(planning||el('hl413-plans')))window.clearInterval(timer);else if(++tries>50)window.clearInterval(timer)};
const timer=window.setInterval(install,300);install();
