/** Phase 4.13.1r: replaces legacy Discover presentation within its own tab. */
import './phase41301-rework.css';
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
const active=(r:R)=>['open','new','proposed','pending','approved','queued','running','investigating'].includes(state(r));
const stamp=(r:R)=>text(r.updated_at)||text(r.created_at);
const order=(a:R,b:R)=>Date.parse(stamp(b)) - Date.parse(stamp(a))||0;
const SEEN='hermes-life:discover:last-seen:v2';
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
 let filter:'active'|'new'|'history'='active',ds:R[]=[],qs:R[]=[],lastRefresh='',scanTime='',scanResult:R|null=null,loading=false,error='',notice='';
 let seen='';try{seen=localStorage.getItem(SEEN)||''}catch{}
 const unseen=(r:R)=>!!stamp(r)&&(!seen||Date.parse(stamp(r))>Date.parse(seen))&&!['dismissed','deferred','completed','resolved'].includes(state(r));
 const qualifies=(r:R)=>{
 if(r.quality==='excluded'||r.quality==='missing')return false;
 if(r.quality==='eligible')return true;
 const path=text(r.path).toLowerCase();
 const parts=path.split('/');const filename=parts[parts.length-1]||'';
 if(parts.some(p=>['tests','__tests__','fixtures','node_modules','.venv','dist','build'].includes(p))||filename.startsWith('test_')||/\.(test|spec)\.(ts|js)$/.test(filename))return false;
 const note=text(r.note).trim();
 if(note.includes('{item[')||note.includes('INSERT INTO discoveries')||note.includes('${'))return false;
 return /^(?:#|\/\/|\/\*|\*)\s*(?:TODO|FIXME)\b/i.test(note);
};
const pick=(r:R)=>filter==='history'?(!active(r)||!qualifies(r)):filter==='new'?(unseen(r)&&qualifies(r)):(active(r)&&qualifies(r));
 const toolbar=node('div','hl413r-toolbar');
 const top=node('div','hl413r-top');const heading=node('div');heading.append(node('h2','', 'Discover'),node('p','hl413r-muted','Independent discovery · Findings, decisions and history'));
 const status=node('span','hl413r-status','Loading');top.append(heading,status);
 const metrics=node('div','hl413r-metrics');const meta=node('p','hl413r-muted');
 const actions=node('div','hl413r-actions');const sections=node('div','hl413r-sections');const message=node('div','hl413r-message');
 const advanced=node('details','hl413r-advanced');const advSummary=node('summary','', 'Schedule & technical details');const advBody=node('div','hl413r-advanced-body');advanced.append(advSummary,advBody);
 wrapper.append(top,metrics,meta,toolbar,actions,message,sections,advanced);
 function render(){
  status.textContent=loading?'Updating…':error?'Connection error':'Discovery dashboard';status.dataset.state=error?'error':loading?'loading':'ok';
  metrics.replaceChildren();const items:[string,string][]=[['Total findings',String(ds.length)],['Active findings',String(ds.filter(r=>active(r)&&qualifies(r)).length)],['Unseen',String([...ds,...qs].filter(r=>unseen(r)&&qualifies(r)).length)],['Questions',String(qs.filter(qualifies).length)]];
  for(const [k,v] of items){
   const m=node('div','hl413r-metric');
   if(k==='Questions'||k==='Unseen'||k==='Active findings'){
    const b=btn(`${v} ${k} · View`,()=>{
      if(k==='Unseen')filter='new';else filter='active';
      render();
      const groups=Array.from(sections.querySelectorAll<HTMLElement>('.hl413r-group'));
      (k==='Questions'?groups[1]:groups[0])?.scrollIntoView({behavior:'smooth',block:'start'});
    });b.className='hl413r-metric-button';m.append(b);
   }else{m.append(node('strong','',v),node('span','',k))}
   metrics.append(m)
  }
  meta.textContent=`Last data refresh: ${when(lastRefresh)} · Last scan: ${when(scanTime)}${scanResult?' · Last scan: '+val(scanResult.found??'?')+' found, '+val(scanResult.new??'?')+' new':''}`;
  toolbar.replaceChildren();for(const [f,label] of [['active','Active'],['new','New'],['history','History']] as const){const b=btn(label,()=>{filter=f;render()});b.setAttribute('aria-pressed',String(filter===f));toolbar.append(b)}
  const mark=btn('Mark new as seen',()=>{seen=new Date().toISOString();try{localStorage.setItem(SEEN,seen)}catch{}render()});mark.disabled=![...ds,...qs].some(unseen);toolbar.append(mark);
  actions.replaceChildren(btn('Scan VM projects',()=>void scan()),btn('Refresh',()=>void refresh()),btn('Run decision now',()=>void decision()));
  message.textContent=error?`Unable to retrieve Discover records: ${error}`:notice;message.className='hl413r-message'+(error?' error':'');
  sections.replaceChildren();if(error){sections.append(node('div','hl413r-empty','Records could not be loaded. Existing findings have not been cleared.'));return}
  for(const [title,items,curiosityMode] of [['Findings',ds,false],['Curiosity questions',qs,true]] as const){
   const results=items.filter(pick).sort(order);const box=node('section','hl413r-group');box.append(node('h3','',`${title} (${results.length})`));
   if(!results.length)box.append(node('div','hl413r-empty',filter==='history'?'No archived records in this view.':filter==='new'?'No unseen records in this view.':'No open records in this view.'));
   for(const r of results){const card=node('article','hl413r-card');const head=node('div','hl413r-card-head');head.append(node('strong','',curiosityMode?text(r.question)||'Question':text(r.note)||text(r.proposed_prompt)||'Finding'),node('span','hl413r-chip',state(r)));
    card.append(head,node('p','hl413r-muted',`${curiosityMode?text(r.category)||'Curiosity':text(r.project)||'Unknown project'}${r.path?' · '+text(r.path)+(r.line?':'+val(r.line):''):''} · Updated: ${when(stamp(r))}`));
    if(r.rationale)card.append(node('p','hl413r-muted',text(r.rationale)));
    const buttons=node('div','hl413r-card-actions');
    if(curiosityMode){
      const quality=text(r.quality),qualityReason=text(r.quality_reason);
      const status=text(r.investigation_status);
      card.append(node('p','hl413r-muted',`Investigation: ${status || 'not started'}${r.goal_id||r.discovery_goal_id?' · Goal '+val(r.discovery_goal_id||r.goal_id).slice(0,8):''}${quality==='excluded'?' · Needs review: '+qualityReason:''}`));
      if(r.can_investigate===true){buttons.append(btn('Investigate',()=>void investigate(r)))}
      if(r.task_id){buttons.append(btn('View findings',()=>window.dispatchEvent(new CustomEvent('hermes:open-task',{detail:{id:val(r.task_id)}}))))}
      if(r.plan_id){buttons.append(btn('View plan',()=>{
        const t=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(x=>x.textContent?.trim()==='Planning'&&!x.closest('#chat-panel'));
        t?.click();
      }))}
      for(const command of ['open','deferred','dismissed']){
        const button=btn(command==='open'?'Reopen':command==='deferred'?'Defer':'Dismiss',()=>void mutate('curiosity',r,command));
        button.disabled=!r.id||command===state(r);buttons.append(button)
      }
    }else{
      for(const command of ['approve','defer','dismiss']){
        const button=btn(command,()=>void mutate('discoveries',r,command));button.disabled=!r.id;buttons.append(button)
      }
    }
    card.append(buttons);box.append(card)}
   sections.append(box)
  }
  advBody.replaceChildren();const interval=$('decision-scan-interval') as HTMLInputElement|null;
  const schedule=node('p','hl413r-muted',`Scheduled discovery controls remain configured in the existing backend${interval?' · Interval: '+interval.value+' seconds':''}.`);
  const raw=node('pre','',scanResult?JSON.stringify(scanResult,null,2):'No scan result captured by this browser.');advBody.append(schedule,raw);
 }
 async function refresh(){loading=true;error='';render();try{const [d,q]=await Promise.all([endpoint('/discoveries'),endpoint('/curiosity/workflow')]);ds=records(d,['discoveries','items','records']);qs=records(q,['curiosity','questions','items','records']);lastRefresh=new Date().toISOString()}catch(e){error=val(e)}finally{loading=false;render()}}
 async function mutate(kind:string,r:R,action:string){notice=`Updating ${action}…`;render();try{await endpoint(`/${kind}/${encodeURIComponent(val(r.id))}/${action}`,'POST');notice=`${action} saved`;await refresh()}catch(e){notice=val(e);render()}}
 async function investigate(r:R){
  if(!window.confirm('Approve a read-only investigation for this question?'))return;
  notice='Creating linked read-only investigation…';render();
  try{const result=await endpoint(`/curiosity/${encodeURIComponent(val(r.id))}/investigate`,'POST') as R;
      notice='Investigation requested · Goal '+val(result.goal_id).slice(0,8);await refresh();}
  catch(e){notice='Investigation rejected: '+val(e);render()}
 }
 async function scan(){notice='Scanning VM projects…';render();try{const x=await endpoint('/discoveries/scan','POST') as R;scanResult=x;scanTime=new Date().toISOString();notice='Scan complete';await refresh()}catch(e){notice='Scan failed: '+val(e);render()}}
 async function decision(){notice='Running independent decision…';render();try{const x=await endpoint('/decisions/scan','POST') as R;scanResult=x;scanTime=new Date().toISOString();notice='Decision completed';await refresh()}catch(e){notice='Decision failed: '+val(e);render()}}
 render();void refresh();window.setInterval(()=>{if(!document.contains(wrapper))return;void refresh()},30000);
 return true;
}
let attempts=0;const tick=()=>{if(install()||++attempts>30)clearInterval(timer)};
const timer=window.setInterval(tick,300);tick();
