/** UI-413-01: read-only Discover presentation and existing workflow actions. */
import './phase41301-discover.css';

type Rec = Record<string, unknown>;
type Filter = 'active'|'new'|'history';
const API='/api';
const el=(id:string)=>document.getElementById(id);
const str=(x:unknown)=>typeof x==='string'?x:'';
const state=(r:Rec)=>str(r.state).toLowerCase()||'unknown';
const id=(r:Rec)=>str(r.id);
const stamp=(r:Rec)=>str(r.updated_at)||str(r.created_at);
const escapeText=(value:unknown)=>String(value??'');
function labelTime(value:unknown):string {
  if(!value) return 'Time unavailable';
  const d=new Date(String(value));if(Number.isNaN(d.getTime()))return 'Time unavailable';
  return d.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
}
async function get(path:string):Promise<unknown>{const r=await fetch(API+path);if(!r.ok)throw new Error(`${path}: HTTP ${r.status}`);return r.json()}
async function post(path:string){const r=await fetch(API+path,{method:'POST'});if(!r.ok)throw new Error(`${path}: HTTP ${r.status} — ${await r.text()}`);return r.json()}
function button(text:string,click:()=>void):HTMLButtonElement{const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',click);return b}
function div(cls?:string,text?:string):HTMLDivElement{const d=document.createElement('div');if(cls)d.className=cls;if(text!==undefined)d.textContent=text;return d}
function put(parent:HTMLElement,...children:Node[]){parent.append(...children)}
const KEY='hermes-life:discover:last-seen:v1';
function lastSeen():string {try{return localStorage.getItem(KEY)||''}catch{return ''}}
function saveSeen(v:string){try{localStorage.setItem(KEY,v)}catch{/* storage blocked */}}
function isNew(r:Rec,seen:string){const t=stamp(r);return !!t && (!seen || Date.parse(t)>Date.parse(seen)) && !['dismissed','deferred','completed','resolved'].includes(state(r))}
function active(r:Rec){return ['open','proposed','pending','approved','queued','running','new'].includes(state(r))}
function fromResponse(data:unknown):Rec[]{if(Array.isArray(data))return data as Rec[];if(data && typeof data==='object'){for(const k of ['discoveries','items','records','questions']){const v=(data as Rec)[k];if(Array.isArray(v))return v as Rec[]}}return []}
const root=el('discovery-list');
if(root && el('curiosity-list')){
  const host=div('hl413');
  root.parentElement?.insertBefore(host,root);
  root.classList.add('hl413-hidden');
  el('curiosity-list')?.classList.add('hl413-hidden');
  // Hide only old rendering. Original scan/decision handlers remain registered.
  let filter:Filter='active';let seen=lastSeen();let records:Rec[]=[];let questions:Rec[]=[];
  let refreshAt='';let scanSummary='';let scanAt='';let loading=false;let error='';let feedback='';let lastScanDetails:unknown=null;
  const header=div('hl413-header');const title=div('hl413-title','Discover');
  const meta=div('hl413-meta');const status=div('hl413-status');
  put(header,title,meta,status);
  const toolbar=div('hl413-toolbar');const results=div('hl413-results');const note=div('hl413-note');
  const controls=div('hl413-actions');const details=document.createElement('details');
  const summary=document.createElement('summary');summary.textContent='Technical scan details';const pre=document.createElement('pre');put(details,summary,pre);
  put(host,header,toolbar,controls,note,results,details);
  function render(){
    meta.textContent=`Last refreshed: ${labelTime(refreshAt)} · Latest scan: ${labelTime(scanAt)}`;
    status.textContent=loading?'Refreshing…':error?'Data unavailable':scanSummary||'No scan result recorded in this browser session';
    status.className='hl413-status'+(error?' hl413-error':'');
    toolbar.replaceChildren();
    for(const [f,t] of [['active','Active'],['new','New'],['history','History']] as const){
      const n=button(t,()=>{filter=f;render()});n.setAttribute('aria-pressed',String(filter===f));put(toolbar,n);
    }
    const unseen=records.filter(r=>isNew(r,seen)).length+questions.filter(r=>isNew(r,seen)).length;
    const mark=button(`Mark ${unseen} new as seen`,()=>{seen=new Date().toISOString();saveSeen(seen);render()});mark.disabled=!unseen;put(toolbar,mark);
    controls.replaceChildren(button('Refresh',()=>void refresh()),button('Scan now',()=>void scan()));
    note.textContent=error?`Could not refresh Discover: ${error}`:feedback;
    note.className='hl413-note'+(error?' hl413-error':'');
    pre.textContent=lastScanDetails?JSON.stringify(lastScanDetails,null,2):'No scan response recorded in this browser session.';
    results.replaceChildren();
    if(error){put(results,div('hl413-empty','Discover records are unavailable. Existing records are not assumed empty.'));return}
    const chosen=(items:Rec[])=>items.filter(r=>filter==='history'?!active(r):filter==='new'?isNew(r,seen):active(r));
    const sections:[string,Rec[],boolean][]=[['Discoveries',chosen(records),false],['Curiosity queue',chosen(questions),true]];
    for(const [heading,items,curiosity] of sections){
      const section=div('hl413-section');put(section,div('hl413-section-title',`${heading} · ${items.length}`));
      if(!items.length)put(section,div('hl413-empty',filter==='new'?'No unseen records.':filter==='history'?'No historical records.':'No active records.'));
      const sorted=[...items].sort((a,b)=>Date.parse(stamp(b)||'')-Date.parse(stamp(a)||''));
      for(const r of sorted){
        const card=div('hl413-card');
        const headingText=curiosity?str(r.question):str(r.note)||str(r.rationale)||'Untitled discovery';
        const head=div('hl413-card-head');put(head,div('hl413-card-title',headingText),div('hl413-state',state(r)));
        const metaLine=div('hl413-card-meta');
        const where=curiosity?str(r.category):[str(r.project),str(r.path)+(r.line?`:${r.line}`:'')].filter(Boolean).join(' · ');
        metaLine.textContent=`${where||'Project unavailable'} · Updated: ${labelTime(stamp(r))} · Created: ${labelTime(r.created_at)}`;
        put(card,head,metaLine);
        if(!curiosity && r.rationale)put(card,div('hl413-reason',escapeText(r.rationale)));
        const actions=div('hl413-card-actions');
        const allowed=curiosity?['open','deferred','dismissed']:['approve','defer','dismiss'];
        for(const action of allowed){
          const b=button(action,()=>void act(r,curiosity,action,b));b.disabled=!id(r);put(actions,b)
        }
        put(card,actions);put(section,card)
      }
      put(results,section)
    }
  }
  async function act(r:Rec,curiosity:boolean,action:string,b:HTMLButtonElement){
    b.disabled=true;feedback=`Updating ${id(r)}…`;render();
    try{await post(curiosity?`/curiosity/${encodeURIComponent(id(r))}/${action}`:`/discoveries/${encodeURIComponent(id(r))}/${action}`);feedback=`${action} saved.`;await refresh()}
    catch(e){error='';feedback=String(e);render()}
  }
  async function refresh(){
    loading=true;error='';render();
    try{
      const [ds,qs]=await Promise.all([get('/discoveries'),get('/curiosity')]);
      records=fromResponse(ds);questions=fromResponse(qs);refreshAt=new Date().toISOString();
    }catch(e){error=String(e)}finally{loading=false;render()}
  }
  async function scan(){
    feedback='Running discovery scan…';render();
    try{const data=await post('/decisions/scan');lastScanDetails=data;scanAt=new Date().toISOString();
      const d=data as Rec;scanSummary=`Found: ${d.found??'unknown'} · New: ${d.new??'unknown'} · Questions added: ${d.questions_added??'unknown'}`;
      feedback='Scan completed.';await refresh();
    }catch(e){feedback=`Scan failed: ${String(e)}`;render()}
  }
  // Listen to the existing scan buttons, keeping their backend handlers unchanged.
  for(const name of ['decision-scan','discovery-scan']){
    el(name)?.addEventListener('click',()=>{window.setTimeout(()=>void refresh(),800)})
  }
  // UI refresh reflects remote agent actions without altering the decision schedule.
  window.setInterval(()=>void refresh(),30000);
  void refresh();
}
