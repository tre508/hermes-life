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
  const bar=document.createElement('section');bar.id='hc-project-workspace';bar.setAttribute('aria-label','Coding project');
  // HL-CHAT-006 2.1: the <select> stays in the DOM as the state holder but is visually hidden;
  // the visible control is the workspace selector button + overlay below.
  const pickerLabel=document.createElement('label');pickerLabel.htmlFor='hc-project-picker';pickerLabel.textContent='Project';pickerLabel.className='hc415-visually-hidden';
  const picker=document.createElement('select');picker.id='hc-project-picker';picker.setAttribute('aria-label','Coding project');picker.className='hc415-visually-hidden';picker.tabIndex=-1;picker.setAttribute('aria-hidden','true');
  const selectorBtn=button('Workspace: General chat','hc415-ws-selector');selectorBtn.id='hc415-ws-selector';
  selectorBtn.title='Select the working directory for this conversation';selectorBtn.setAttribute('aria-haspopup','dialog');selectorBtn.setAttribute('aria-expanded','false');
  const workspaceButton=button('Workspace ▸','hc415-workspace-button');workspaceButton.setAttribute('aria-haspopup','dialog');
  const filesBtn=button('🗂 Files','hc415-files-button');filesBtn.title='Browse project files and attach them to the conversation';
  const hint=document.createElement('span');hint.id='hc415-project-hint';hint.setAttribute('role','status');
  bar.append(pickerLabel,picker,selectorBtn,filesBtn,workspaceButton,hint);form.parentElement?.insertBefore(bar,form);

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
  // HL-CHAT-006 2.3: attachment modes. A = workspace access (paths only, Hermesha inspects
  // with tools — the default for development conversations). B = manifest attachment
  // (path/type/size/mtime references, contents retrievable). C = full contents inlined.
  const MODE_KEY='hermes-life-chat-attach-mode';
  type AttachMode='A'|'B'|'C';
  let modeMap:Record<string,AttachMode>={};
  try{modeMap=JSON.parse(localStorage.getItem(MODE_KEY)||'{}') as Record<string,AttachMode>}catch{modeMap={}}
  function attachMode():AttachMode{return modeMap[choice()]||'A'}
  function setMode(m:AttachMode){const n=choice();if(!n)return;modeMap[n]=m;localStorage.setItem(MODE_KEY,JSON.stringify(modeMap));refreshModeUI();renderAttachments();setStatus('Attachment mode '+(m==='A'?'A — workspace access':m==='B'?'B — manifest attachment':'C — inline contents'))}
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
  const sbSelectAll=button('Select all','hc415-attach-clear');sbSelectAll.title='Attach every file in the tree';
  sbSelectAll.onclick=()=>{if(!treeData)return setStatus('Load a project tree first');let n=0;for(const e of treeData.entries)if(!attached.has(e.path)){attached.add(e.path);n++}if(n){saveAttached();renderTree()}setStatus(n?`Attached ${n} more file(s)`:'Every tree file is already attached')};
  sbAttachHead.append(sbAttachCount,sbSelectAll,sbClear);
  const sbAttachList=document.createElement('ul');sbAttachList.id='hc415-attach-list';
  const sbModeRow=document.createElement('div');sbModeRow.id='hc415-attach-mode';sbModeRow.setAttribute('role','group');sbModeRow.setAttribute('aria-label','Attachment mode');
  const sbModeLabel=document.createElement('span');sbModeLabel.className='hc415-mode-label';sbModeLabel.textContent='Mode:';
  const modeBtns:Record<AttachMode,HTMLButtonElement>={
    A:button('A Access','hc415-mode-btn'),B:button('B Manifest','hc415-mode-btn'),C:button('C Inline','hc415-mode-btn')};
  (['A','B','C'] as AttachMode[]).forEach(m=>{const b=modeBtns[m];
    b.title=m==='A'?'Mode A — workspace access: list paths only; Hermesha inspects files with its tools (default).'
      :m==='B'?'Mode B — manifest attachment: paths, type, size and modification time; contents retrievable on request.'
      :'Mode C — inline: full file contents are included in the next request (context-checked).';
    b.setAttribute('aria-pressed','false');b.onclick=()=>setMode(m);});
  sbModeRow.append(sbModeLabel,modeBtns.A,modeBtns.B,modeBtns.C);
  function refreshModeUI(){const m=attachMode();for(const k of ['A','B','C'] as AttachMode[])modeBtns[k].setAttribute('aria-pressed',String(k===m))}
  refreshModeUI();
  sbAttach.append(sbAttachHead,sbAttachList,sbModeRow);
  const sbVer=document.createElement('span');sbVer.id='hc415-host-ver';sbVer.textContent='';sbVer.title='Git version of the host workspace the attached files were read from';
  sbAttach.append(sbVer);
  const sbPreview=document.createElement('pre');sbPreview.id='hc415-file-preview';sbPreview.tabIndex=0;sbPreview.hidden=true;
  const sbMeter=document.createElement('div');sbMeter.id='hc415-file-meter';sbMeter.setAttribute('role','status');
  sidebar.append(sbHead,sbStatus,sbTree,sbAttach,sbPreview,sbMeter);panel.append(sidebar);

  // HL-CHAT-006 2.1: SELECT WORKSPACE overlay — General Chat + registered projects,
  // with Host (authoritative NUC repo) and Worker (execution workspace) paths labeled separately.
  const wsSelect=document.createElement('section');wsSelect.id='hc415-ws-select';wsSelect.hidden=true;wsSelect.setAttribute('role','dialog');wsSelect.setAttribute('aria-modal','true');wsSelect.setAttribute('aria-label','Select workspace');
  const wsHead=document.createElement('header');wsHead.className='hc415-ws-head';
  const wsTitle=document.createElement('strong');wsTitle.textContent='SELECT WORKSPACE';
  const wsClose=button('✕ Close','hc415-ws-close');wsHead.append(wsTitle,wsClose);
  const wsList=document.createElement('div');wsList.id='hc415-ws-list';wsList.setAttribute('role','radiogroup');wsList.setAttribute('aria-label','Available workspaces');
  const wsInfo=document.createElement('div');wsInfo.id='hc415-ws-info';
  const wsActions=document.createElement('div');wsActions.className='hc415-ws-actions';
  const wsBrowse=button('Browse registered projects','hc415-ws-browse');wsBrowse.id='hc415-ws-browse';wsBrowse.title='Open the project workspace drawer';
  const wsExplorer=button('Open File Explorer','hc415-ws-explorer');wsExplorer.id='hc415-ws-explorer';wsExplorer.title='Browse and attach files from the selected project';
  wsActions.append(wsBrowse,wsExplorer);
  wsSelect.append(wsHead,wsList,wsInfo,wsActions);panel.append(wsSelect);

  // Chat audit §8: the floating assistant is retired, so there is no float/wide/
  // fullscreen mode machine and no Expand control. The single presentation is
  // the Conversations workspace; the file-context sidebar (HL-CHAT-006) is just
  // a column that opens and closes inside it.
  function sidebarWanted():boolean{return localStorage.getItem('hermes-life-chat-sidebar')!=='0'&&!!choice()}
  function showSidebar(open:boolean,persist=true){
    if(persist)localStorage.setItem('hermes-life-chat-sidebar',open?'1':'0');
    sidebar.hidden=!open;
    if(open)void refreshFileContext();
  }
  // Escape closes the sidebar, matching the Hide button.
  chatPanel.addEventListener('keydown',(e:KeyboardEvent)=>{if(e.key==='Escape'&&!sidebar.hidden){e.preventDefault();showSidebar(false)}});
  showSidebar(sidebarWanted(),false);

  let projects:Project[]=[];let selected=localStorage.getItem(key)||'';let activeReview:Review|null=null;let busy=false;
  function choice(){return picker.value}
  function current(){return projects.find(p=>p.name===choice())}
  function clearReview(){activeReview=null;confirmation.value='';reviewPanel.hidden=true;reviewMeta.textContent='';diff.textContent=''}
  function setStatus(s:string){status.textContent=s}
  function renderHint(){refreshModeUI();const p=current();const base=!p?'General chat':p.remote_path?'Synced':'Not synced';hint.textContent=attached.size?`${base} · ${attached.size} attached`:base;info.textContent=p?`${p.name} · ${p.remote_path||'Work-machine workspace not synchronized'}`:'Select a registered project to synchronize or review changes.'}
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
    picker.value=projects.some(p=>p.name===selected)?selected:'';selected=choice();renderHint();renderSelector();
    if(!projects.length)setStatus('No projects registered. Register a project through the project manager API.');
  }catch(e){setStatus('Project list unavailable: '+errText(e));hint.textContent='Connection error'}}
  // HL-CHAT-006 2.1: one shared selection path used by both the hidden <select> and the overlay.
  function selectProject(name:string){
    picker.value=name;selected=choice();localStorage.setItem(key,selected);clearReview();renderHint();
    setStatus(selected?'Selected '+selected:'General chat');void refreshFileContext();
    renderSelector();
  }
  picker.onchange=()=>selectProject(choice());
  // HL-CHAT-006 2.1: workspace selector overlay behaviour.
  function renderSelectorLabel(){
    const p=current();
    selectorBtn.textContent='Working Directory: '+(p?p.name:'General chat');
    selectorBtn.classList.toggle('hc415-ws-active',!!p);
  }
  function renderSelector(){
    renderSelectorLabel();
    const sel=(name:string,label:string)=>{const b=button((choice()===name?'◉ ':'○ ')+label,'hc415-ws-option');b.setAttribute('role','radio');b.setAttribute('aria-checked',String(choice()===name));b.onclick=()=>{closeWsSelect();if(choice()!==name)selectProject(name)};return b};
    wsList.replaceChildren(sel('','General chat'),...projects.map(p=>sel(p.name,p.name)));
    const p=current();
    const rows:[string,string][]=p
      ?[['Current workspace',p.name],['Host (authoritative repository)',p.host_path],['Worker (execution workspace)',p.remote_path||'Not synchronized — open Workspace ▸ to sync']]
      :[['Current workspace','General chat'],['Host','—'],['Worker','—']];
    wsInfo.replaceChildren(...rows.map(([k,v])=>{
      const row=document.createElement('div');row.className='hc415-ws-info-row';
      const kEl=document.createElement('span');kEl.className='hc415-ws-info-key';kEl.textContent=k;
      const vEl=document.createElement('span');vEl.className='hc415-ws-info-val';vEl.textContent=v;vEl.title=v;
      row.append(kEl,vEl);return row}));
    wsExplorer.disabled=!p;
  }
  function openWsSelect(){renderSelector();wsSelect.hidden=false;selectorBtn.setAttribute('aria-expanded','true');wsClose.focus()}
  function closeWsSelect(){wsSelect.hidden=true;selectorBtn.setAttribute('aria-expanded','false')}
  selectorBtn.onclick=()=>wsSelect.hidden?openWsSelect():closeWsSelect();
  wsClose.onclick=closeWsSelect;
  wsSelect.addEventListener('keydown',(e:KeyboardEvent)=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeWsSelect();return}
    if(e.key==='Tab'){
      const controls=Array.from(wsSelect.querySelectorAll<HTMLElement>('button:not([disabled])')).filter(n=>n.getClientRects().length>0);
      if(!controls.length)return;const first=controls[0],last=controls[controls.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
    }
  });
  wsBrowse.onclick=()=>{closeWsSelect();openDrawer()};
  wsExplorer.onclick=()=>{if(!choice())return;closeWsSelect();filesBtn.click()};
  // HL-CHAT-006: file-context manager behaviour.
  type TreeEntry={path:string;size:number;type:'file'};
  type TreeData={root:string;count:number;truncated:boolean;entries:TreeEntry[];host_version?:{commit:string;dirty:boolean}|null};
  type FileData={path:string;size:number;mtime?:number;mode:string;truncated:boolean;content:string;host_version?:{commit:string;dirty:boolean}|null};
  const ATT_KEY='hermes-life-chat-attachments';
  let treeData:TreeData|null=null;let attached=new Set<string>();let expanded=new Set<string>();
  let hostVer:{commit:string;dirty:boolean}|null=null;
  function verLabel(){return hostVer?`host @ ${hostVer.commit} (${hostVer.dirty?'dirty':'clean'})`:'host version unknown'}
  let attachMap:Record<string,string[]>={};
  try{attachMap=JSON.parse(localStorage.getItem(ATT_KEY)||'{}') as Record<string,string[]>}catch{attachMap={}}
  function loadAttached(){attached=new Set(attachMap[choice()]||[]);renderAttachments()}
  function saveAttached(){const name=choice();if(name){attachMap[name]=[...attached];localStorage.setItem(ATT_KEY,JSON.stringify(attachMap))}renderAttachments()}
  function renderAttachments(){
    refreshModeUI();
    sbAttachCount.textContent=`Attachments (${attached.size})`;
    sbAttachList.replaceChildren(...[...attached].sort().map(p=>{
      const li=document.createElement('li');
      const span=document.createElement('span');span.textContent=p;span.title=p;
      const rm=button('×','hc415-attach-remove');rm.title='Remove '+p;rm.setAttribute('aria-label','Remove '+p);
      rm.onclick=()=>{attached.delete(p);saveAttached();renderTree()};
      li.append(span,rm);return li}));
    let chars=0;for(const p of attached){const e=treeData?.entries.find(t=>t.path===p);chars+=e&&e.size?e.size:0}
    const m=attachMode();
    sbVer.textContent=choice()?verLabel():'';
    sbMeter.textContent=!attached.size?'No files attached'
      :m==='A'?`${attached.size} file(s) available via workspace access (no contents in request)`
      :m==='B'?`${attached.size} file(s) in manifest — ≈ ${Math.ceil((chars+attached.size*80)/4).toLocaleString()} manifest tokens`
      :`≈ ${Math.ceil(chars/4).toLocaleString()} tokens attached (inline)`;
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
  function resetTree(){treeData=null;expanded=new Set();hostVer=null;sbPreview.hidden=true;renderTree()}
  async function loadTree(){
    const name=choice();if(!name){resetTree();return}
    try{treeData=await api<TreeData>(`/api/projects/${encodeURIComponent(name)}/tree`);hostVer=treeData.host_version||null;renderTree();renderAttachments();if(treeData.count)setStatus(`Loaded ${treeData.count} files from ${name} — ${verLabel()}`)}
    catch(e){resetTree();setStatus('File tree unavailable: '+errText(e))}
  }
  async function refreshFileContext(){loadAttached();await loadTree()}
  sbHide.onclick=()=>showSidebar(false);
  filesBtn.onclick=()=>showSidebar(true);
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
    // SSHFS architecture: /file reads the host path directly; attachment modes do not
    // depend on the (legacy) work-machine sync state. Surface a hint instead of blocking.
    if(!current()?.remote_path)setStatus('Note: work-machine sync not registered — attachments still read the host workspace.');
    const paths=[...attached].sort();
    if(!paths.length){input.value=`@project ${name}\n${input.value}`;return}
    // HL-CHAT-006 2.3: compose per attachment mode, then resubmit.
    ev.preventDefault();ev.stopImmediatePropagation();
    const m=attachMode();
    const dispatch=(block:string)=>{input.value=`@project ${name}\n${block}\n\n${value}`;input.dataset.hc415Injected='1';form.dispatchEvent(new Event('submit',{cancelable:true}))};
    if(m==='A'){
      attachUsage={mode:'A',files:paths.length,occupied:0,estimate:0};renderCtxRow();
      dispatch(`[Workspace access — ${name} · mode A]\nAttached at ${verLabel()}. The ${paths.length} file(s) below are available in the working directory. Their contents are NOT included here; inspect them with your file tools as needed.\n`+paths.map(p=>'- '+p).join('\n'));
      return;
    }
    if(m==='B'){
      void (async()=>{
        setStatus('Building attachment manifest…');
        const rows:string[]=[];const missing:string[]=[];
        for(const p of paths){
          try{const f=await api<FileData>(`/api/projects/${encodeURIComponent(name)}/file?path=${encodeURIComponent(p)}`);
            if(f.host_version)hostVer=f.host_version;
            rows.push(`${p} | ${f.mode||'file'} | ${f.size} bytes | modified ${f.mtime?new Date(f.mtime*1000).toISOString().replace('T',' ').slice(0,19):'unknown'}`);
          }catch(e){missing.push(p+' ('+errText(e)+')')}
        }
        const block=`[Attached folder manifest — ${name} · mode B]\nAttached at ${verLabel()}.\nContents are not inlined. Each listed file exists in the host working directory; request its contents when needed.\npath | type | size | modified\n`+rows.join('\n')+(missing.length?`\n[Unavailable: ${missing.join('; ')}]`:'');
        attachUsage={mode:'B',files:paths.length,occupied:0,estimate:Math.ceil(block.length/4)};renderCtxRow();
        dispatch(block);
      })();
      return;
    }
    // Mode C — inline full contents with an explicit context-capacity check.
    void (async()=>{
      setStatus('Attaching '+paths.length+' file(s)…');
      const win=await contextWindow();
      // Chars budget: half the model window when known (reserve for history, prompt and
      // answer); otherwise the historical 300 KB fallback. tokens ≈ chars/4.
      const budget=win?Math.floor(win*4*0.5):300_000;
      const parts:string[]=[];const dropped:string[]=[];let total=0;
      for(const p of paths){
        let f:FileData|null=null;
        try{f=await api<FileData>(`/api/projects/${encodeURIComponent(name)}/file?path=${encodeURIComponent(p)}`)}
        catch(e){dropped.push(p+' ('+errText(e)+')');continue}
        if(!f)continue;
        if(total+f.content.length>budget){dropped.push(p+` (${(f.content.length/4|0).toLocaleString()} est. tokens — exceeds remaining model context capacity)`);continue}
        if(f.host_version)hostVer=f.host_version;
        total+=f.content.length;parts.push('--- '+p+' ---\n'+f.content);
      }
      const capNote=win?`Context check: ${Math.ceil(total/4).toLocaleString()} est. tokens of ${win.toLocaleString()} window tokens (50% attach budget).`
        :'Context check: selected model reports no context window — using 300 KB fallback budget.';
      const block='[Attached project files — '+name+' · mode C]\nAttached at '+verLabel()+'.\n'+capNote+'\n'+parts.join('\n\n')
        +(dropped.length?'\n[Cannot fit in context: '+dropped.join('; ')+']':'');
      if(dropped.length)setStatus(`${dropped.length} file(s) exceeded the model context capacity — see the note in the message.`);
      attachUsage={mode:'C',files:parts.length,occupied:Math.ceil(total/4),estimate:0};renderCtxRow();
      dispatch(block);
    })();
  },{capture:true});
  // HL-CHAT-006 2.3: resolve the selected chat model's context window for Mode C checks.
  let modelCache:{provider:string;model:string;context_window:number|null}[]|null=null;
  async function contextWindow():Promise<number|null>{
    try{
      if(!modelCache)modelCache=(await api<{models:{provider:string;model:string;context_window:number|null}[]}>('/api/chat/models')).models||[];
      const provider=localStorage.getItem('hl-chat-provider')||'';
      const model=localStorage.getItem('hl-chat-model')||'';
      const hit=modelCache.find(x=>x.provider===provider&&x.model===model);
      return hit&&hit.context_window?hit.context_window:null;
    }catch{return null}
  }
  // HL-CHAT-006 §4: attached-contents accounting in the context-meter details.
  // Mode A/B attachments occupy 0 context (contents never enter the request);
  // Mode C contents count fully once composed (doc rule, enforced here).
  let attachUsage:{mode:AttachMode;files:number;occupied:number;estimate:number}|null=null;
  function ensureCtxRow(){
    const details=document.getElementById('hc-context-details');if(!details)return;
    if(document.getElementById('hc415-ctx-row'))return;
    const row=document.createElement('div');row.className='hc-context-details-row';row.id='hc415-ctx-row';
    const label=document.createElement('span');label.textContent='Attached file contents';
    const val=document.createElement('span');val.id='hc415-ctx-attach';
    row.append(label,val);
    const note=details.querySelector('.hc-context-details-note');
    details.insertBefore(row,note);
    renderCtxRow();
  }
  function renderCtxRow(){
    const val=document.getElementById('hc415-ctx-attach');if(!val)return;
    val.textContent=!attachUsage?'0 — no files composed into the last request'
      :attachUsage.mode==='C'?`${attachUsage.occupied.toLocaleString()} est. tokens inlined (${attachUsage.files} file(s) · mode C)`
      :`0 occupied — mode ${attachUsage.mode} (${attachUsage.files} file(s)${attachUsage.estimate?`, manifest ≈ ${attachUsage.estimate.toLocaleString()} tokens`:''})`;
    const row=document.getElementById('hc415-ctx-row');
    if(row)row.title='HL-CHAT-006 rule: files available via workspace access (A) or manifest (B) occupy no model context until their contents are inlined (C).';
  }
  // HL-CHAT-006 §3: "Files consulted" — after each assistant response, scan the
  // response text for the exact paths the preceding user bubble's attachment
  // header listed, and render a Files consulted footer listing the hits.
  // Reflects referenced files only — not merely files made available.
  let consultedObserver:MutationObserver|null=null;
  function consultRecord(bubble:Element):{name:string;paths:string[]}|null{
    let prev=bubble.previousElementSibling;
    while(prev&&!(prev.classList.contains('hc-bubble')&&prev.classList.contains('user')))prev=prev.previousElementSibling;
    if(!prev)return null;
    const text=prev.querySelector('.hc-body')?.textContent||'';
    const mA=text.match(/\[Workspace access — (.+?) · mode A\]/);
    const mB=text.match(/\[Attached folder manifest — (.+?) · mode B\]/);
    const mC=text.match(/\[Attached project files — (.+?) · mode C\]/);
    const m=mA||mB||mC;if(!m)return null;
    const paths:string[]=[];
    if(mA){
      for(const line of text.slice(mA.index).split('\n').slice(1)){
        if(!line.trim())break; // blank line separates the block from the user's own message
        const mm=line.match(/^- (.+)$/);if(!mm)continue; // prose lines (e.g. "Attached at host @ …") are not paths
        paths.push(mm[1].trim());
      }
    }else if(mB){
      // Anchor on the "modified\n" column-header terminator so the slice starts
      // at the first row; slice after just "modified" would begin at the newline
      // and break the loop on an empty first line.
      const at=text.indexOf('modified\n',mB.index);
      if(at>=0)for(const line of text.slice(at+'modified\n'.length).split('\n')){
        if(!line.trim())break;
        const p=line.split('|')[0].trim();if(p)paths.push(p);
      }
    }else{
      for(const mm of text.matchAll(/^--- (.+?) ---$/gm))paths.push(mm[1]);
    }
    return {name:m[1],paths:[...new Set(paths)]};
  }
  function markConsulted(){
    const msgs=document.getElementById('hc-messages');if(!msgs)return;
    for(const bubble of Array.from(msgs.querySelectorAll('article.hc-bubble.assistant')) as HTMLElement[]){
      if(bubble.classList.contains('hc-streaming'))continue;
      if(bubble.dataset.hc415Consulted==='1')continue;
      bubble.dataset.hc415Consulted='1';
      const rec=consultRecord(bubble);if(!rec||!rec.paths.length)continue;
      const body=bubble.querySelector('.hc-body');if(!body)continue;
      const text=body.textContent||'';
      const hits=rec.paths.slice().sort((a,b)=>b.length-a.length).filter(p=>text.includes(p));
      if(!hits.length)continue;
      const foot=document.createElement('div');foot.className='hc415-consulted';
      const head=document.createElement('strong');head.textContent='Files consulted';
      const ul=document.createElement('ul');
      for(const h of [...new Set(hits)].sort((a,b)=>a.localeCompare(b))){const li=document.createElement('li');li.textContent=h;ul.append(li)}
      foot.append(head,ul);bubble.append(foot);
    }
  }
  function startWatchers():boolean{
    ensureCtxRow();
    const msgs=document.getElementById('hc-messages');if(!msgs)return false;
    if(!consultedObserver){
      consultedObserver=new MutationObserver(()=>{try{markConsulted()}catch(e){(window as any).__hc415err=String((e as Error)?.stack||e)}});
      consultedObserver.observe(msgs,{childList:true,subtree:true,characterData:true});
    }
    markConsulted();
    return true;
  }
  if(!startWatchers()){
    const w=new MutationObserver(()=>{try{if(startWatchers())w.disconnect()}catch(e){(window as any).__hc415err=String((e as Error)?.stack||e)}});
    w.observe(document.documentElement,{childList:true,subtree:true});
  }
  void load();loadAttached();
  if(!sidebar.hidden&&choice())void refreshFileContext();
  return true;
}
try{
  if(!setup()){
    const observer=new MutationObserver(()=>{try{if(setup())observer.disconnect()}catch(e){(window as any).__hc415err=String((e as Error)?.stack||e)}});observer.observe(document.documentElement,{childList:true,subtree:true});
  }
}catch(e){(window as any).__hc415err=String((e as Error)?.stack||e)}
