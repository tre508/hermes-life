/** Phase 4.15: compact project picker, isolated workspace drawer, unchanged approval API. */
import './phase415-workspace.css';
type Project = {name:string;host_path:string;remote_path:string|null;commit_hash:string|null};
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
  const filesBtn=button('🗂 Files','hc415-files-button');filesBtn.title='Browse project files and attach them to the conversation';
  const hint=document.createElement('span');hint.id='hc415-project-hint';hint.setAttribute('role','status');
  bar.append(pickerLabel,picker,filesBtn,workspaceButton,hint);form.parentElement?.insertBefore(bar,form);

  const drawer=document.createElement('section');drawer.id='hc415-workspace-drawer';drawer.hidden=true;drawer.setAttribute('role','dialog');drawer.setAttribute('aria-modal','true');drawer.setAttribute('aria-label','Project workspace and code review');
  const head=document.createElement('header');head.className='hc415-drawer-head';
  const title=document.createElement('strong');title.textContent='Project workspace';
  const close=button('✕ Close','hc415-close');head.append(title,close);
  const info=document.createElement('p');info.id='hc415-info';
  const actions=document.createElement('div');actions.className='hc415-actions';
  const refresh=button('Refresh projects');const sync=button('Sync to work machine');const reviewBtn=button('Review changes');
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

  // HL-CHAT-006: file-context sidebar — DOM shell only; behaviour wired below.
  const sidebar=document.createElement('aside');sidebar.id='hc415-file-sidebar';sidebar.hidden=true;sidebar.setAttribute('aria-label','Project files');
  const sbHead=document.createElement('header');sbHead.className='hc415-side-head';
  const sbTitle=document.createElement('strong');sbTitle.textContent='Files';
  const sbHide=button('◀ Hide','hc415-side-hide');sbHide.title='Hide file sidebar';
  sbHead.append(sbTitle,sbHide);
  const sbStatus=document.createElement('div');sbStatus.id='hc415-file-status';sbStatus.setAttribute('role','status');
  const sbTree=document.createElement('nav');sbTree.id='hc415-file-tree';sbTree.setAttribute('aria-label','Project file tree');
  const sbAttach=document.createElement('section');sbAttach.id='hc415-attachments';
  const sbAttachHead=document.createElement('h4');
  const sbAttachCount=document.createElement('span');sbAttachCount.textContent='Attachments (0)';
  const sbClear=button('Clear all','hc415-attach-clear');sbClear.title='Remove all attachments';
  sbClear.onclick=()=>{if(!attached.size)return;attached.clear();saveAttached();renderTree();setStatus('All attachments removed')};
  sbAttachHead.append(sbAttachCount,sbClear);
  const sbAttachList=document.createElement('ul');sbAttachList.id='hc415-attach-list';
  sbAttach.append(sbAttachHead,sbAttachList);
  const sbPreview=document.createElement('pre');sbPreview.id='hc415-file-preview';sbPreview.tabIndex=0;sbPreview.hidden=true;
  const sbMeter=document.createElement('div');sbMeter.id='hc415-file-meter';sbMeter.setAttribute('role','status');
  sidebar.append(sbHead,sbStatus,sbTree,sbAttach,sbPreview,sbMeter);panel.append(sidebar);

  // Keep the popup attached to the chat panel; it is visible only when deliberately opened.
  const expand=button('⤢ Expand','hc415-expand');expand.title='Expand or restore chat';
  const headActions=panel.querySelector('.hc-head .hc-actions');headActions?.prepend(expand);
  // HL-CHAT-005: expand cycles float -> wide -> full-window workspace; Restore returns to float.
  type ChatMode='float'|'wide'|'full';
  let mode:ChatMode='float';
  const storedMode=(()=>{const v=localStorage.getItem('hermes-life-chat-mode');return v==='wide'||v==='full'?v:(localStorage.getItem('hermes-life-chat-expanded')==='1'?'wide':'float')})();
  function applyMode(next:ChatMode){
    const scroller=document.getElementById('hc-messages');
    const atBottom=!scroller||scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<40;
    if(mode==='full'&&next!=='full'){document.body.classList.remove('hc415-fullscreen-open');chatPanel.removeEventListener('keydown',onPanelKey)}
    mode=next;
    chatPanel.classList.toggle('hc415-expanded',next==='wide');
    chatPanel.classList.toggle('hc415-fullscreen',next==='full');
    expand.textContent=next==='full'?'⤡ Restore':next==='wide'?'⤢ Fullscreen':'⤢ Expand';
    expand.title=next==='full'?'Restore floating chat':next==='wide'?'Open full-window workspace':'Expand chat';
    expand.setAttribute('aria-pressed',String(next!=='float'));
    localStorage.setItem('hermes-life-chat-mode',next);
    localStorage.setItem('hermes-life-chat-expanded',next==='float'?'0':'1');
    if(next==='full'){document.body.classList.add('hc415-fullscreen-open');chatPanel.addEventListener('keydown',onPanelKey);
      sidebar.hidden=localStorage.getItem('hermes-life-chat-sidebar')==='0'||!choice()}
    if(atBottom&&scroller)scroller.scrollTop=scroller.scrollHeight;
  }
  function onPanelKey(e:KeyboardEvent){if(e.key==='Escape'&&mode==='full'){e.preventDefault();applyMode('float')}}
  applyMode(storedMode);
  expand.onclick=()=>applyMode(mode==='float'?'wide':mode==='wide'?'full':'float');

  let projects:Project[]=[];let selected=localStorage.getItem(key)||'';let activeReview:Review|null=null;let busy=false;
  function choice(){return picker.value}
  function current(){return projects.find(p=>p.name===choice())}
  function clearReview(){activeReview=null;confirmation.value='';reviewPanel.hidden=true;reviewMeta.textContent='';diff.textContent=''}
  function setStatus(s:string){status.textContent=s}
  function renderHint(){const p=current();const base=!p?'General chat':p.remote_path?'Synced':'Not synced';hint.textContent=attached.size?`${base} · ${attached.size} attached`:base;info.textContent=p?`${p.name} · ${p.remote_path||'Work-machine workspace not synchronized'}`:'Select a registered project to synchronize or review changes.'}
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
  picker.onchange=()=>{selected=choice();localStorage.setItem(key,selected);clearReview();renderHint();setStatus(selected?'Selected '+selected:'General chat');void refreshFileContext()};
  // HL-CHAT-006: file-context manager behaviour.
  type TreeEntry={path:string;size:number;type:'file'};
  type TreeData={root:string;count:number;truncated:boolean;entries:TreeEntry[]};
  type FileData={path:string;size:number;mode:string;truncated:boolean;content:string};
  const ATT_KEY='hermes-life-chat-attachments';
  let treeData:TreeData|null=null;let attached=new Set<string>();let expanded=new Set<string>();
  let attachMap:Record<string,string[]>={};
  try{attachMap=JSON.parse(localStorage.getItem(ATT_KEY)||'{}') as Record<string,string[]>}catch{attachMap={}}
  function loadAttached(){attached=new Set(attachMap[choice()]||[]);renderAttachments()}
  function saveAttached(){const name=choice();if(name){attachMap[name]=[...attached];localStorage.setItem(ATT_KEY,JSON.stringify(attachMap))}renderAttachments()}
  function renderAttachments(){
    sbAttachCount.textContent=`Attachments (${attached.size})`;
    sbAttachList.replaceChildren(...[...attached].sort().map(p=>{
      const li=document.createElement('li');
      const span=document.createElement('span');span.textContent=p;span.title=p;
      const rm=button('×','hc415-attach-remove');rm.title='Remove '+p;rm.setAttribute('aria-label','Remove '+p);
      rm.onclick=()=>{attached.delete(p);saveAttached();renderTree()};
      li.append(span,rm);return li}));
    let chars=0;for(const p of attached){const e=treeData?.entries.find(t=>t.path===p);chars+=e&&e.size?e.size:0}
    sbMeter.textContent=attached.size?`≈ ${Math.ceil(chars/4).toLocaleString()} tokens attached`:'No files attached';
    renderHint();
  }
  type TreeNode={name:string;path:string;size:number|null;children:TreeNode[];isDir:boolean};
  function buildTree(entries:TreeEntry[]):TreeNode[]{
    const root:TreeNode={name:'',path:'',size:null,children:[],isDir:true};
    for(const e of [...entries].sort((a,b)=>a.path.localeCompare(b.path))){
      let node=root;const parts=e.path.split('/');
      parts.forEach((part,i)=>{
        const isFile=i===parts.length-1;const path=parts.slice(0,i+1).join('/');
        let child=node.children.find(c=>c.name===part);
        if(!child){child={name:part,path,size:isFile?e.size:null,children:[],isDir:!isFile};node.children.push(child)}
        node=child;
      });
    }
    const sortNode=(n:TreeNode)=>{n.children.sort((a,b)=>a.isDir===b.isDir?a.name.localeCompare(b.name):(a.isDir?-1:1));n.children.forEach(sortNode)};
    sortNode(root);return root.children;
  }
  function treeNote(text:string){const d=document.createElement('div');d.className='hc415-tree-note';d.textContent=text;return d}
  function treeNode(node:TreeNode,depth:number):HTMLElement{
    const wrap=document.createElement('div');wrap.className='hc415-tree-node';
    const row=document.createElement('button');row.type='button';
    row.className='hc415-tree-row'+(node.isDir?' hc415-tree-dir':' hc415-tree-file');
    row.style.paddingLeft=`${8+depth*14}px`;row.title=node.path;
    const icon=document.createElement('span');icon.className='hc415-tree-icon';
    icon.textContent=node.isDir?(expanded.has(node.path)?'▾':'▸'):(attached.has(node.path)?'✓':'·');
    const label=document.createElement('span');label.className='hc415-tree-label';label.textContent=node.name;
    row.append(icon,label);
    if(node.isDir){
      row.setAttribute('aria-expanded',String(expanded.has(node.path)));
      const st=dirState(node);
      row.classList.toggle('hc415-attached',st==='all');
      row.setAttribute('aria-pressed',st==='all'?'true':'mixed');
      const attach=button(st==='all'?'✓':st==='mixed'?'◍':'⊕','hc415-dir-attach');
      attach.title=(st==='none'?'Attach all files under ':'Detach all files under ')+node.path;
      attach.setAttribute('aria-label',attach.title);
      if(st!=='none')attach.classList.add('hc415-attached');
      attach.onclick=(ev)=>{ev.stopPropagation();void toggleFolder(node)};
      row.append(attach);
      row.onclick=()=>{if(expanded.has(node.path))expanded.delete(node.path);else expanded.add(node.path);renderTree()};
    }else{
      row.classList.toggle('hc415-attached',attached.has(node.path));
      row.setAttribute('aria-pressed',String(attached.has(node.path)));
      row.onclick=()=>{void toggleFile(node.path)};
    }
    wrap.append(row);
    if(node.isDir&&expanded.has(node.path))for(const c of node.children)wrap.append(treeNode(c,depth+1));
    return wrap;
  }
  function renderTree(){
    if(!treeData){sbTree.replaceChildren(treeNote(choice()?'Loading file tree…':'Select a project to browse its files.'));return}
    sbTree.replaceChildren(...buildTree(treeData.entries).map(n=>treeNode(n,0)));
    if(treeData.truncated)sbTree.append(treeNote('Tree truncated at 3000 entries.'));
  }
  async function toggleFile(path:string){
    if(attached.has(path)){attached.delete(path);saveAttached();renderTree();return}
    setStatus('Reading '+path+'…');
    try{
      const f=await api<FileData>(`/api/projects/${encodeURIComponent(choice())}/file?path=${encodeURIComponent(path)}`);
      attached.add(path);saveAttached();renderTree();
      sbPreview.hidden=false;sbPreview.textContent=f.content;sbPreview.setAttribute('aria-label','Preview of '+path);
      setStatus('Attached '+path+(f.truncated?' (truncated)':''));
    }catch(e){setStatus(errText(e))}
  }
  function dirState(node:TreeNode):'all'|'none'|'mixed'{
    const files:string[]=[];
    const walk=(n:TreeNode)=>{for(const c of n.children){if(c.isDir)walk(c);else files.push(c.path)}};
    walk(node);
    if(!files.length)return 'none';
    let all=true,none=true;
    for(const f of files){if(attached.has(f))none=false;else all=false}
    return all?'all':none?'none':'mixed';
  }
  function toggleFolder(node:TreeNode){
    const files:string[]=[];
    const walk=(n:TreeNode)=>{for(const c of n.children){if(c.isDir)walk(c);else files.push(c.path)}};
    walk(node);
    if(!files.length)return setStatus('No files under '+node.path);
    const st=dirState(node);
    if(st==='all'){for(const f of files)attached.delete(f)}else{for(const f of files)attached.add(f)}
    saveAttached();renderTree();
    setStatus((st==='all'?'Detached ':'Attached ')+files.length+' file(s) under '+node.path);
  }
  function resetTree(){treeData=null;expanded=new Set();sbPreview.hidden=true;renderTree()}
  async function loadTree(){
    const name=choice();if(!name){resetTree();return}
    try{treeData=await api<TreeData>(`/api/projects/${encodeURIComponent(name)}/tree`);renderTree();renderAttachments();if(treeData.count)setStatus(`Loaded ${treeData.count} files from ${name}`)}
    catch(e){resetTree();setStatus('File tree unavailable: '+errText(e))}
  }
  async function refreshFileContext(){loadAttached();await loadTree()}
  sbHide.onclick=()=>{localStorage.setItem('hermes-life-chat-sidebar','0');sidebar.hidden=true};
  filesBtn.onclick=()=>{localStorage.setItem('hermes-life-chat-sidebar','1');if((mode as ChatMode)!=='full')applyMode('full');sidebar.hidden=false;void refreshFileContext()};
  refresh.onclick=()=>{if(!busy)void load()};
  sync.onclick=async()=>{const name=choice();if(!name)return setStatus('Select a project first');setBusy(true);clearReview();setStatus('Synchronizing committed Git contents…');try{
    await post(`/api/projects/${encodeURIComponent(name)}/sync`);setStatus('Synchronized work-machine workspace: '+name);await load();
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
  form.addEventListener('submit',(ev)=>{
    if(input.dataset.hc415Injected==='1'){delete input.dataset.hc415Injected;return}
    const name=choice();if(!name)return;const value=input.value.trim();if(!value||/^@project\s+\S+/i.test(value))return;
    if(!current()?.remote_path){ev.preventDefault();ev.stopImmediatePropagation();setStatus('Project not synced. Open Workspace and click Sync to work machine.');openDrawer();return}
    const paths=[...attached].sort();
    if(!paths.length){input.value=`@project ${name}\n${input.value}`;return}
    // HL-CHAT-006: inline attached file contents above the prompt, then resubmit.
    ev.preventDefault();ev.stopImmediatePropagation();
    void (async()=>{
      setStatus('Attaching '+paths.length+' file(s)…');
      const parts:string[]=[];const dropped:string[]=[];let total=0;
      for(const p of paths){
        let f:FileData|null=null;
        try{f=await api<FileData>(`/api/projects/${encodeURIComponent(name)}/file?path=${encodeURIComponent(p)}`)}
        catch(e){dropped.push(p+' ('+errText(e)+')');continue}
        if(!f)continue;
        if(total+f.content.length>300_000){dropped.push(p+' (context budget)');continue}
        total+=f.content.length;parts.push('--- '+p+' ---\n'+f.content);
      }
      const block='[Attached project files — '+name+']\n'+parts.join('\n\n')+(dropped.length?'\n[Not attached: '+dropped.join('; ')+']':'');
      input.value=`@project ${name}\n${block}\n\n${value}`;
      input.dataset.hc415Injected='1';
      form.dispatchEvent(new Event('submit',{cancelable:true}));
    })();
  },{capture:true});
  void load();loadAttached();
  if((mode as ChatMode)==='full'&&!sidebar.hidden&&choice())void refreshFileContext();
  return true;
}
if(!setup()){
  const observer=new MutationObserver(()=>{if(setup())observer.disconnect()});observer.observe(document.documentElement,{childList:true,subtree:true});
}
