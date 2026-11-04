/** Phase 4.12: chat project selection and exact-diff approval UI. */
type Project = {name:string; host_path:string; vm_path:string|null; commit_hash:string|null};
type Review = {review_id:string;project:string;base_commit:string;sha256:string;diff:string;confirmation_required:string};
const storeKey='hermes-life-active-project';
const safeText=(err:unknown)=>String(err instanceof Error?err.message:err);
async function api<T>(path:string, init?:RequestInit):Promise<T>{
  const r=await fetch(path,init);
  if(!r.ok){let detail='';try{detail=JSON.stringify(await r.json())}catch{}throw new Error(`HTTP ${r.status}: ${detail}`)}
  return await r.json() as T;
}
function post<T>(path:string,payload?:unknown){return api<T>(path,{method:'POST',headers:{'Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});}
function setup(){
  const panel=document.getElementById('hc-panel');
  const form=document.getElementById('hc-form');
  const input=document.getElementById('hc-input') as HTMLTextAreaElement|null;
  if(!panel||!form||!input)return false;
  if(document.getElementById('hc-project-workspace'))return true;
  const box=document.createElement('section');box.id='hc-project-workspace';
  box.style.cssText='padding:8px 14px;border-top:1px solid rgba(128,128,128,.28);font-size:12px;display:grid;gap:7px';
  const line=document.createElement('div');line.style.cssText='display:flex;align-items:center;gap:8px;flex-wrap:wrap';
  const label=document.createElement('label');label.htmlFor='hc-project-picker';label.textContent='Coding project';
  const picker=document.createElement('select');picker.id='hc-project-picker';picker.style.cssText='max-width:210px;padding:5px';
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh';
  const sync=document.createElement('button');sync.type='button';sync.textContent='Sync';
  const reviewBtn=document.createElement('button');reviewBtn.type='button';reviewBtn.textContent='Review changes';
  [refresh,sync,reviewBtn].forEach(b=>b.style.cssText='font-size:12px;padding:5px 7px');
  line.append(label,picker,refresh,sync,reviewBtn);
  const status=document.createElement('div');status.id='hc-project-status';status.setAttribute('role','status');
  const reviewPanel=document.createElement('div');reviewPanel.hidden=true;reviewPanel.style.cssText='display:grid;gap:8px';
  const diff=document.createElement('pre');diff.style.cssText='overflow:auto;white-space:pre;max-height:260px;max-width:100%;border:1px solid rgba(128,128,128,.3);padding:8px;font-size:11px';
  const confirmation=document.createElement('input');confirmation.placeholder='Type approval phrase';confirmation.autocomplete='off';confirmation.style.cssText='width:100%;padding:6px';
  const applyBtn=document.createElement('button');applyBtn.type='button';applyBtn.textContent='Apply reviewed changes to host';
  reviewPanel.append(diff,confirmation,applyBtn);
  box.append(line,status,reviewPanel);
  form.parentElement?.insertBefore(box,form);
  let selected=localStorage.getItem(storeKey)||'';
  let activeReview:Review|null=null;
  let projects:Project[]=[];
  function choice(){return picker.value}
  function clearReview(){activeReview=null;reviewPanel.hidden=true;confirmation.value=''}
  function report(s:string){status.textContent=s}
  async function load(){
    try{
      const response=await api<{projects:Project[]}>('/api/projects');projects=response.projects;
      picker.replaceChildren();const none=new Option('No project','');picker.append(none);
      projects.forEach(p=>picker.append(new Option(`${p.name}${p.vm_path?'':' (not synced)'}`,p.name)));
      picker.value=projects.some(p=>p.name===selected)?selected:'';
      selected=choice();report(selected?'Project: '+selected:'General chat (no project)');
    }catch(e){report('Project list unavailable: '+safeText(e))}
  }
  picker.addEventListener('change',()=>{selected=choice();localStorage.setItem(storeKey,selected);clearReview();report(selected?'Selected '+selected:'General chat')});
  refresh.onclick=()=>void load();
  sync.onclick=async()=>{const name=choice();if(!name)return report('Select a registered project');sync.disabled=true;clearReview();report('Synchronizing committed Git contents…');try{await post(`/api/projects/${encodeURIComponent(name)}/sync`);report('Workspace synchronized: '+name);await load()}catch(e){report(safeText(e))}finally{sync.disabled=false}};
  reviewBtn.onclick=async()=>{const name=choice();if(!name)return report('Select a project');clearReview();report('Loading VM diff…');try{
    activeReview=await post<Review>(`/api/projects/${encodeURIComponent(name)}/review`);
    diff.textContent=`Base: ${activeReview.base_commit}\nSHA-256: ${activeReview.sha256}\n\n${activeReview.diff}`;
    confirmation.placeholder=activeReview.confirmation_required;reviewPanel.hidden=false;
    report('Review exact diff. Apply requires typing '+activeReview.confirmation_required);
  }catch(e){report(safeText(e))}};
  applyBtn.onclick=async()=>{const r=activeReview;if(!r)return;if(confirmation.value!==r.confirmation_required){report('Type exactly: '+r.confirmation_required);return}
    if(!window.confirm(`Apply this reviewed diff to the host repository for ${r.project}? It will modify host files without committing.`))return;
    applyBtn.disabled=true;report('Revalidating and applying…');try{const result=await post<{status:string}>(`/api/projects/${encodeURIComponent(r.project)}/apply`,{review_id:r.review_id,confirmation:confirmation.value});clearReview();report('Applied to host working tree (not committed or deployed): '+result.status)}catch(e){clearReview();report(safeText(e))}finally{applyBtn.disabled=false}
  };
  // Capture before Hermes chat's submit handler: retains existing conversation/task/memory behavior.
  form.addEventListener('submit',(ev)=>{
    const name=choice();if(!name)return;
    const value=input.value.trim();if(!value)return;
    if(/^@project\s+\S+/i.test(value))return; // explicit selection wins
    const p=projects.find(p=>p.name===name);
    if(!p?.vm_path){ev.preventDefault();ev.stopImmediatePropagation();report('Selected project is not synchronized. Click Sync first.');return}
    input.value=`@project ${name}\n${input.value}`;
  },{capture:true});
  void load();return true;
}
if(!setup()){
  const obs=new MutationObserver(()=>{if(setup())obs.disconnect()});
  obs.observe(document.documentElement,{childList:true,subtree:true});
}
