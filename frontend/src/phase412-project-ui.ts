/** Phase 4.15: compact project picker, isolated workspace drawer, unchanged approval API. */
import './phase415-workspace.css';
type Project = {name:string;host_path:string;vm_path:string|null;commit_hash:string|null};
type Review = {review_id:string;project:string;base_commit:string;sha256:string;diff:string;confirmation_required:string};
const key='hermes-life-active-project';
const errText=(e:unknown)=>e instanceof Error?e.message:String(e);
async function api<T>(path:string, init?:RequestInit):Promise<T>{
  const r=await fetch(path,init);if(!r.ok){let detail='';try{detail=JSON.stringify(await r.json())}catch{}throw new Error(`HTTP ${r.status}: ${detail}`)}
  return await r.json() as T;
}
function post<T>(path:string,data?:unknown):Promise<T>{return api<T>(path,{method:'POST',headers:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})})}
function button(label:string, className=''):HTMLButtonElement{const b=document.createElement('button');b.type='button';b.textContent=label;b.className=className;return b}
function setup():boolean{
  const panel=document.getElementById('hc-panel');const form=document.getElementById('hc-form');const input=document.getElementById('hc-input') as HTMLTextAreaElement|null;
  if(!panel||!form||!input)return false;
  if(document.getElementById('hc-project-workspace'))return true;
  const chatPanel=panel;
  chatPanel.classList.add('hc415-chat');
  const bar=document.createElement('section');bar.id='hc-project-workspace';bar.setAttribute('aria-label','Coding project');
  const pickerLabel=document.createElement('label');pickerLabel.htmlFor='hc-project-picker';pickerLabel.textContent='Project';
  const picker=document.createElement('select');picker.id='hc-project-picker';picker.setAttribute('aria-label','Coding project');
  const workspaceButton=button('Workspace ▸','hc415-workspace-button');workspaceButton.setAttribute('aria-haspopup','dialog');
  const hint=document.createElement('span');hint.id='hc415-project-hint';hint.setAttribute('role','status');
  bar.append(pickerLabel,picker,workspaceButton,hint);form.parentElement?.insertBefore(bar,form);

  const drawer=document.createElement('section');drawer.id='hc415-workspace-drawer';drawer.hidden=true;drawer.setAttribute('role','dialog');drawer.setAttribute('aria-modal','true');drawer.setAttribute('aria-label','Project workspace and code review');
  const head=document.createElement('header');head.className='hc415-drawer-head';
  const title=document.createElement('strong');title.textContent='Project workspace';
  const close=button('✕ Close','hc415-close');head.append(title,close);
  const info=document.createElement('p');info.id='hc415-info';
  const actions=document.createElement('div');actions.className='hc415-actions';
  const refresh=button('Refresh projects');const sync=button('Sync to VM');const reviewBtn=button('Review changes');
  actions.append(refresh,sync,reviewBtn);
  const status=document.createElement('div');status.id='hc415-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const reviewPanel=document.createElement('section');reviewPanel.id='hc415-review';reviewPanel.hidden=true;
  const reviewHeading=document.createElement('h3');reviewHeading.textContent='Proposed host changes';
  const reviewMeta=document.createElement('div');reviewMeta.className='hc415-review-meta';
  const diff=document.createElement('pre');diff.className='hc415-diff';diff.tabIndex=0;
  const confirmationLabel=document.createElement('label');confirmationLabel.htmlFor='hc415-confirmation';confirmationLabel.textContent='Approval phrase';
  const confirmation=document.createElement('input');confirmation.id='hc415-confirmation';confirmation.autocomplete='off';confirmation.spellcheck=false;
  const applyBtn=button('Apply reviewed changes to host','hc415-apply');
  reviewPanel.append(reviewHeading,reviewMeta,diff,confirmationLabel,confirmation,applyBtn);
  drawer.append(head,info,actions,status,reviewPanel);panel.append(drawer);

  // Keep the popup attached to the chat panel; it is visible only when deliberately opened.
  const expand=button('⤢ Expand','hc415-expand');expand.title='Expand or restore chat';
  const headActions=panel.querySelector('.hc-head .hc-actions');headActions?.prepend(expand);
  let expanded=false;
  const wideStored=localStorage.getItem('hermes-life-chat-expanded')==='1';
  function setExpanded(on:boolean){expanded=on;chatPanel.classList.toggle('hc415-expanded',on);expand.textContent=on?'⤡ Restore':'⤢ Expand';expand.setAttribute('aria-pressed',String(on));localStorage.setItem('hermes-life-chat-expanded',on?'1':'0')}
  setExpanded(wideStored);expand.onclick=()=>setExpanded(!expanded);

  let projects:Project[]=[];let selected=localStorage.getItem(key)||'';let activeReview:Review|null=null;let busy=false;
  function choice(){return picker.value}
  function current(){return projects.find(p=>p.name===choice())}
  function clearReview(){activeReview=null;confirmation.value='';reviewPanel.hidden=true;reviewMeta.textContent='';diff.textContent=''}
  function setStatus(s:string){status.textContent=s}
  function renderHint(){const p=current();hint.textContent=!p?'General chat':p.vm_path?'Synced':'Not synced';info.textContent=p?`${p.name} · ${p.vm_path||'VM workspace not synchronized'}`:'Select a registered project to synchronize or review changes.'}
  function setBusy(value:boolean){busy=value;refresh.disabled=value;sync.disabled=value;reviewBtn.disabled=value;applyBtn.disabled=value}
  function openDrawer(){drawer.hidden=false;renderHint();workspaceButton.setAttribute('aria-expanded','true');close.focus()}
  function closeDrawer(){drawer.hidden=true;workspaceButton.setAttribute('aria-expanded','false');workspaceButton.focus()}
  workspaceButton.onclick=()=>drawer.hidden?openDrawer():closeDrawer();close.onclick=closeDrawer;
  drawer.addEventListener('keydown',(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();closeDrawer();return}
    if(e.key==='Tab'){
      const controls=Array.from(drawer.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')).filter(n=>n.getClientRects().length>0);
      if(!controls.length)return;const first=controls[0],last=controls[controls.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
    }
  });
  async function load(){try{
    const data=await api<{projects:Project[]}>('/api/projects');projects=data.projects;
    picker.replaceChildren(new Option('General chat',''));for(const p of projects)picker.append(new Option(p.name,p.name));
    picker.value=projects.some(p=>p.name===selected)?selected:'';selected=choice();renderHint();
    if(!projects.length)setStatus('No projects registered. Register a project through the project manager API.');
  }catch(e){setStatus('Project list unavailable: '+errText(e));hint.textContent='Connection error'}}
  picker.onchange=()=>{selected=choice();localStorage.setItem(key,selected);clearReview();renderHint();setStatus(selected?'Selected '+selected:'General chat')};
  refresh.onclick=()=>{if(!busy)void load()};
  sync.onclick=async()=>{const name=choice();if(!name)return setStatus('Select a project first');setBusy(true);clearReview();setStatus('Synchronizing committed Git contents…');try{
    await post(`/api/projects/${encodeURIComponent(name)}/sync`);setStatus('Synchronized VM workspace: '+name);await load();
  }catch(e){setStatus(errText(e))}finally{setBusy(false)}};
  reviewBtn.onclick=async()=>{const name=choice();if(!name)return setStatus('Select a project first');setBusy(true);clearReview();setStatus('Loading the exact proposed diff…');try{
    const r=await post<Review>(`/api/projects/${encodeURIComponent(name)}/review`);activeReview=r;
    reviewMeta.textContent=`Base commit: ${r.base_commit} · SHA-256: ${r.sha256}`;
    diff.textContent=r.diff||'(No Git changes reported)';confirmation.placeholder=r.confirmation_required;
    reviewPanel.hidden=false;setStatus('Review the exact diff. Apply requires: '+r.confirmation_required);
  }catch(e){setStatus(errText(e))}finally{setBusy(false)}};
  applyBtn.onclick=async()=>{const r=activeReview;if(!r||busy)return;
    if(confirmation.value!==r.confirmation_required)return setStatus('Type exactly: '+r.confirmation_required);
    if(!window.confirm(`Apply the reviewed diff to ${r.project} on the host? The changes will remain uncommitted.`))return;
    setBusy(true);setStatus('Revalidating review and applying to host…');try{
      const result=await post<{status:string}>(`/api/projects/${encodeURIComponent(r.project)}/apply`,{review_id:r.review_id,confirmation:confirmation.value});
      clearReview();setStatus('Applied to host working tree (not committed or deployed): '+result.status);
    }catch(e){clearReview();setStatus(errText(e))}finally{setBusy(false)}
  };
  // Capture runs before the original Hermes chat submit handler. An explicit @project wins.
  form.addEventListener('submit',(ev)=>{const name=choice();if(!name)return;const value=input.value.trim();if(!value||/^@project\s+\S+/i.test(value))return;
    if(!current()?.vm_path){ev.preventDefault();ev.stopImmediatePropagation();setStatus('Project not synced. Open Workspace and click Sync to VM.');openDrawer();return}
    input.value=`@project ${name}\n${input.value}`;
  },{capture:true});
  void load();return true;
}
if(!setup()){
  const observer=new MutationObserver(()=>{if(setup())observer.disconnect()});observer.observe(document.documentElement,{childList:true,subtree:true});
}
