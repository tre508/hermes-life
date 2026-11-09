/** Phase 4.13.1r: replaces legacy Discover presentation within its own tab.
 *
 * HL-UI-STATE-001: the displayed lifecycle comes from the backend resolver (`workflow` on every
 * record), not from the record's own `state` column. Approval is not completion, and a finding
 * whose downstream work finished leaves the attention view without being deleted.
 */
import './phase41301-rework.css';
import { makeRefresh } from './refresh-feedback.ts';
type R=Record<string,unknown>;
const $=(id:string)=>document.getElementById(id);
const val=(x:unknown)=>String(x??'');
const text=(x:unknown)=>typeof x==='string'?x:'';
const state=(r:R)=>text(r.state).toLowerCase()||'unknown';
const when=(x:unknown)=>{if(!x)return 'Time unavailable';const d=new Date(val(x));return Number.isFinite(d.getTime())?d.toLocaleString(): 'Time unavailable'};
const records=(data:unknown,fields:string[]):R[]=>{if(Array.isArray(data))return data as R[];if(data&&typeof data==='object')for(const k of fields){const a=(data as R)[k];if(Array.isArray(a))return a as R[]}return []};
const node=(tag:string,cls='',t?:string)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(t!==undefined)n.textContent=t;return n};
const btn=(name:string,fn:()=>void)=>{const b=node('button','',name) as HTMLButtonElement;b.type='button';b.addEventListener('click',fn);return b};
const endpoint=async(path:string,method='GET')=>{const res=await fetch('/api'+path,{method});const raw=await res.text();if(!res.ok)throw Error(`${method} ${path}: ${res.status} ${raw.slice(0,250)}`);return raw?JSON.parse(raw):{}};
/** Which machine the backend actually drives; /health is outside /api, so it needs a plain fetch. */
const workerInfo=async():Promise<{target?:string;guest_home?:string;transport?:string}|null>=>{try{const res=await fetch('/health');return res.ok?await res.json().then((h:{worker?:{target?:string;guest_home?:string;transport?:string}})=>h?.worker??null):null}catch{return null}};
const stamp=(r:R)=>text(r.updated_at)||text(r.created_at);
const order=(a:R,b:R)=>Date.parse(stamp(b)) - Date.parse(stamp(a))||0;
// ---- workflow status (HL-UI-STATE-001) -------------------------------------
const wf=(r:R)=>(r.workflow&&typeof r.workflow==='object'?r.workflow as R:null);
const stage=(r:R)=>text(wf(r)?.stage)||'in_progress';
const wfStatus=(r:R)=>text(wf(r)?.status)||text(r.state)||'Unknown';
const wfReason=(r:R)=>text(wf(r)?.reason);
const wfNext=(r:R)=>text(wf(r)?.next_action)||'none';
const superseded=(r:R)=>wfStatus(r)==='Superseded';
/** 'Attention' = the two stages where a human still has to act: proposed and in flight. */
const active=(r:R)=>['active','in_progress'].includes(stage(r));
const SEEN='hermes-life:discover:last-seen:v2';
type Filter='attention'|'new'|'planning'|'build'|'history'|'all';
function common(a:Element,b:Element){let p:Element|null=a;while(p&&!p.contains(b))p=p.parentElement;return p}
function install(){
 const ids=['decision-scan','discovery-scan','discovery-list','curiosity-list'];
 if(ids.some(id=>!$(id)))return false;
 const scanButton=$('decision-scan')!,discovery=$('discovery-list')!,curiosity=$('curiosity-list')!;
 let panel=common(scanButton,discovery);if(panel)panel=common(panel,curiosity);
 // Never replace the entire page or its navigation, even if markup has changed.
 if(!panel||panel===document.body||panel===document.documentElement||panel.querySelector('#game,canvas,#chat-panel,#chat-input')){
   console.warn('UI-413-01r: Discover boundary uncertain; keeping original interface.');return true;
 }
 if(panel.querySelector('#hl413r'))return true;
 const wrapper=node('section','hl413r') as HTMLElement;wrapper.id='hl413r';wrapper.setAttribute('aria-label','Discover dashboard');
 const originals=Array.from(panel.children) as HTMLElement[];
 originals.forEach(c=>{c.classList.add('hl413r-legacy');c.setAttribute('aria-hidden','true')});
 panel.append(wrapper);
 let filter:Filter='attention',ds:R[]=[],qs:R[]=[],scanTime='',scanResult:R|null=null,notice='';
 let seen='';try{seen=localStorage.getItem(SEEN)||''}catch{}
 const unseen=(r:R)=>!!stamp(r)&&(!seen||Date.parse(stamp(r))>Date.parse(seen))&&stage(r)!=='history';
 const qualityCheck=(r:R)=>{
   const quality=r.quality as string|undefined;
   if(quality==='excluded'||quality==='missing')return false;
   if(quality==='eligible')return true;
   // Fallback for records without quality field (legacy records)
   const path=text(r.path).toLowerCase();
   const parts=path.split('/');const filename=parts[parts.length-1]||'';
   if(parts.some(p=>['tests','__tests__','fixtures','node_modules','.venv','dist','build'].includes(p))||filename.startsWith('test_')||/\.(test|spec)\.(ts|js)$/.test(filename))return false;
   const note=text(r.note).trim();
   if(note.includes('{item[')||note.includes('INSERT INTO discoveries')||note.includes('${'))return false;
   return /^(?:#|\/\/|\/\*|\*)\s*(?:TODO|FIXME)\b/i.test(note);
 };
 const pick=(r:R)=>filter==='all'?true
   :filter==='new'?(unseen(r)&&qualityCheck(r))
   :filter==='attention'?(active(r)&&qualityCheck(r))
   :filter==='history'?(stage(r)==='history'||!qualityCheck(r))
   :(stage(r)===filter&&qualityCheck(r));
const toolbar=node('div','hl413r-toolbar');
const top=node('div','hl413r-top');const heading=node('div');const workerLine=node('p','hl413r-muted','');
heading.append(node('h2','', 'Discover'),node('p','hl413r-muted','Independent discovery · Findings, decisions and history'),workerLine);
// Say which worker executes this, from the backend itself: an empty line beats a wrong claim.
void workerInfo().then(w=>{if(!w)return;workerLine.textContent=w.transport==='ssh'&&w.target?`Executed on the coding worker ${w.target} · ${w.guest_home??''}`:'Executed locally on this machine';});
const status=node('span','hl413r-status','Loading');top.append(heading,status);
const metrics=node('div','hl413r-metrics');const meta=node('p','hl413r-muted');
const actions=node('div','hl413r-actions');const sections=node('div','hl413r-sections');const message=node('div','hl413r-message');
const advanced=node('details','hl413r-advanced');const advSummary=node('summary','', 'Schedule & technical details');const advBody=node('div','hl413r-advanced-body');advanced.append(advSummary,advBody);
wrapper.append(top,metrics,meta,toolbar,actions,message,sections,advanced);
const refresh=makeRefresh({
 load:async()=>{const [d,q]=await Promise.all([endpoint('/discoveries'),endpoint('/curiosity/workflow')]);return {d,q}},
 apply:(data)=>{const {d,q}=data as {d:unknown,q:unknown};ds=records(d,['discoveries','items','records']);qs=records(q,['curiosity','questions','items','records'])},
 count:(data)=>{const {d,q}=data as {d:unknown,q:unknown};return records(d,['discoveries','items','records']).length+records(q,['curiosity','questions','items','records']).length},
 noun:'findings & questions',
 onChange:()=>render(),
});
function render(){
 status.textContent=refresh.phase==='loading'?'Updating…':refresh.phase==='error'?'Connection error':'Discovery dashboard';
 status.dataset.state=refresh.phase==='error'?'error':refresh.phase==='loading'?'loading':'ok';
 const counts={attention:ds.filter(r=>active(r)&&qualityCheck(r)).length,
   planning:ds.filter(r=>stage(r)==='planning'&&qualityCheck(r)).length,
   build:ds.filter(r=>stage(r)==='build'&&qualityCheck(r)).length,
   history:ds.filter(r=>stage(r)==='history').length,
   superseded:ds.filter(superseded).length,
   questions:qs.filter(pick).length,
   unseen:[...ds,...qs].filter(r=>unseen(r)).length};
 metrics.replaceChildren();
 const shown:[string,string][]=[['Total findings',String(ds.length)],['Needs attention',String(counts.attention)],
   ['Superseded',String(counts.superseded)],['Unseen',String(counts.unseen)],
   ['Questions',String(counts.questions)],['Not investigable',String(ds.filter(r=>active(r)&&!qualityCheck(r)).length)]];
 for(const [k,v] of shown){
  const m=node('div','hl413r-metric');
  if(k==='Needs attention'||k==='Superseded'||k==='Unseen'||k==='Questions'){
   const target:Filter=k==='Unseen'?'new':k==='Superseded'?'history':k==='Questions'?'all':'attention';
   const b=btn(`${v} ${k} · View`,()=>{filter=target;render();const groups=Array.from(sections.querySelectorAll<HTMLElement>('.hl413r-group'));(k==='Questions'?groups[1]:groups[0])?.scrollIntoView({behavior:'smooth',block:'start'})});
   b.className='hl413r-metric-button';m.append(b);
  }else{m.append(node('strong','',v),node('span','',k))}
  metrics.append(m)
 }
 const notInvestigable=ds.filter(r=>active(r)&&!qualityCheck(r)).length;
 const feedback=refresh.statusText();
 meta.textContent=`${feedback||'Not refreshed yet'} · Checked ${when(refresh.checkedAt||refresh.loadedAt)} · ${notInvestigable} active finding${notInvestigable===1?'':'s'} excluded by the quality gate (documentation or template markers) · Last scan: ${when(scanTime)}${scanResult?' · '+val(scanResult.found??'?')+' found, '+val(scanResult.new??'?')+' new':''}`;
 toolbar.replaceChildren();
 for(const [f,label,count] of [['attention','Attention',counts.attention],['new','Unseen',counts.unseen],['planning','Planning',counts.planning],['build','Build',counts.build],['history','History',counts.history],['all','All',ds.length]] as [Filter,string,number][]){
   const b=btn(`${label} (${count})`,()=>{filter=f;render()});b.setAttribute('aria-pressed',String(filter===f));toolbar.append(b)
 }
 const mark=btn('Mark new as seen',()=>{seen=new Date().toISOString();try{localStorage.setItem(SEEN,seen)}catch{}render()});mark.disabled=!counts.unseen;toolbar.append(mark);
 const refreshButton=btn(refresh.label(),()=>void refresh.run());refreshButton.disabled=refresh.phase==='loading';actions.replaceChildren(scanButton_(),refreshButton,btn('Run decision now',()=>void decision()));
 message.textContent=refresh.error?`Unable to refresh Discover records: ${refresh.error} — showing the previous data.`:notice;message.className='hl413r-message'+(refresh.error?' error':'');
 sections.replaceChildren();if(refresh.phase==='error'&&!ds.length&&!qs.length){sections.append(node('div','hl413r-empty','Records could not be loaded. Existing findings have not been cleared.'));return}
 for(const [title,items,curiosityMode] of [['Findings',ds,false],['Curiosity questions',qs,true]] as const){
  // A superseded record is already displayed once as its finding: do not list its question again.
  const results=items.filter(r=>pick(r)&&!(curiosityMode&&superseded(r))).sort(order);
  const box=node('section','hl413r-group');
  const hidden=curiosityMode?items.filter(r=>pick(r)&&superseded(r)).length:0;
  box.append(node('h3','',`${title} (${results.length})${hidden?'  ·  '+hidden+' superseded duplicate'+(hidden===1?'':'s')+' shown under Findings':''}`));
  if(!results.length)box.append(node('div','hl413r-empty',filter==='history'?'No archived records in this view.':filter==='new'?'No unseen records in this view.':'Nothing needs attention in this view.'));
  for(const r of results){const card=node('article','hl413r-card'+(superseded(r)?' hl413r-card-superseded':''));
  const head=node('div','hl413r-card-head');
  head.append(node('strong','',curiosityMode?text(r.question)||'Question':text(r.note)||text(r.proposed_prompt)||'Finding'),
    node('span','hl413r-chip hl413r-chip-'+stage(r),wfStatus(r)));
  card.append(head,node('p','hl413r-muted',`${curiosityMode?text(r.category)||'Curiosity':text(r.project)||'Unknown project'}${r.path?' · '+text(r.path)+(r.line?':'+val(r.line):''):''} · Updated: ${when(stamp(r))}`));
  if(wfReason(r))card.append(node('p','hl413r-muted',wfReason(r)));
  if(r.rationale)card.append(node('p','hl413r-muted',text(r.rationale)));
  const buttons=node('div','hl413r-card-actions');
  if(curiosityMode){
    const quality=text(r.quality),qualityReason=text(r.quality_reason);
    const investigation=text(r.investigation_status);
    card.append(node('p','hl413r-muted',`Investigation: ${investigation || 'not started'}${r.goal_id||r.discovery_goal_id?' · Goal '+val(r.discovery_goal_id||r.goal_id).slice(0,8):''}${quality==='excluded'?' · Needs review: '+qualityReason:''}`));
    if(r.can_investigate===true&&stage(r)==='active'){buttons.append(btn('Investigate',()=>void investigate(r)))}
    if(r.task_id){buttons.append(btn('View findings',()=>window.dispatchEvent(new CustomEvent('hermes:open-task',{detail:{id:val(r.task_id)}}))))}
    if(r.plan_id){buttons.append(btn('View plan',()=>openTab('Planning')))}
    if(r.workflow&&wfNext(r)==='start_build'){buttons.append(btn('Start build',()=>openTab('Planning')))}
    if(wfNext(r)==='open_review'){buttons.append(btn('Review candidate',()=>openTab('Build')))}
    for(const command of ['open','deferred','dismissed']){
      const button=btn(command==='open'?'Reopen':command==='deferred'?'Defer':'Dismiss',()=>void mutate('curiosity',r,command));
      button.disabled=!r.id||command===state(r);buttons.append(button)
    }
  }else{
    for(const command of ['approve','defer','dismiss']){
      const button=btn(command,()=>void mutate('discoveries',r,command));button.disabled=!r.id||state(r)===command;buttons.append(button)
    }
  }
  card.append(buttons);box.append(card)
 }
 sections.append(box)
 }
 advBody.replaceChildren();const interval=$('decision-scan-interval') as HTMLInputElement|null;
 const schedule=node('p','hl413r-muted',`Scheduled discovery controls remain configured in the existing backend${interval?' · Interval: '+interval.value+' seconds':''}.`);
 const raw=node('pre','',scanResult?JSON.stringify(scanResult,null,2):'No scan result captured by this browser.');advBody.append(schedule,raw);
}
function openTab(label:string){
 const target=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(x=>x.textContent?.trim()===label&&!x.closest('#chat-panel'));
 target?.click();
}
function scanButton_(){return btn('Scan VM projects',()=>void scan())}
async function mutate(kind:string,r:R,action:string){notice=`Updating ${action}…`;render();try{await endpoint(`/${kind}/${encodeURIComponent(val(r.id))}/${action}`,'POST');notice=`${action} saved`;await refresh.run()}catch(e){notice=val(e);render()}}
async function investigate(r:R){
 if(!window.confirm('Approve a read-only investigation for this question?'))return;
 notice='Creating linked read-only investigation…';render();
 try{const result=await endpoint(`/curiosity/${encodeURIComponent(val(r.id))}/investigate`,'POST') as R;
     notice='Investigation requested · Goal '+val(result.goal_id).slice(0,8);await refresh.run();}
 catch(e){notice='Investigation rejected: '+val(e);render()}
}
async function scan(){notice='Scanning VM projects…';render();try{const x=await endpoint('/discoveries/scan','POST') as R;scanResult=x;scanTime=new Date().toISOString();notice='Scan complete';await refresh.run()}catch(e){notice='Scan failed: '+val(e);render()}}
async function decision(){notice='Running independent decision…';render();try{const x=await endpoint('/decisions/scan','POST') as R;scanResult=x;scanTime=new Date().toISOString();notice='Decision completed';await refresh.run()}catch(e){notice='Decision failed: '+val(e);render()}}
render();void refresh.run();window.setInterval(()=>{if(!document.contains(wrapper))return;void refresh.run()},30000);
return true;
}
let attempts=0;const tick=()=>{if(install()||++attempts>30)clearInterval(timer)};
const timer=window.setInterval(tick,300);tick();
