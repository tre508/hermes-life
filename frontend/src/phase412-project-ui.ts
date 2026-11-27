/** Phase 4.15: compact project picker, isolated workspace drawer, unchanged approval API. */
import './phase415-workspace.css';
type Project = {name:string;host_path:string;remote_path:string|null;commit_hash:string|null};
type Review = {review_id:string;project:string;base_commit:string;sha256:string;diff:string;confirmation_required:string};
const key='hermes-life-active-project';
// General chat is the DEFAULT for a new conversation: the project choice is
// remembered PER CONVERSATION, not globally — a fresh thread never inherits the
// last project. The legacy single-value key seeds the first conversation only.
const CONV_PROJECT_KEY='hermes-life-project-by-conversation';
const CHAT_CONVERSATION_KEY='hermes-life-chat-conversation';
function conversationIdNow():string{return localStorage.getItem(CHAT_CONVERSATION_KEY)||''}
function projectByConversation():Record<string,string>{
  try{const parsed=JSON.parse(localStorage.getItem(CONV_PROJECT_KEY)||'{}');return parsed&&typeof parsed==='object'?parsed:{}}catch{return{}}}
function rememberProjectForConversation(slug:string):void{
  const map=projectByConversation();const cid=conversationIdNow();
  if(slug)map[cid]=slug;else delete map[cid];
  localStorage.setItem(CONV_PROJECT_KEY,JSON.stringify(map));}
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
  // HL-CHAT-006 2.1: the <select> stays in the DOM as the state holder but is visually hidden;
  // the visible control is the workspace selector button + overlay below.
  const pickerLabel=document.createElement('label');pickerLabel.htmlFor='hc-project-picker';pickerLabel.textContent='Project';pickerLabel.className='hc415-visually-hidden';
  const picker=document.createElement('select');picker.id='hc-project-picker';picker.setAttribute('aria-label','Coding project');picker.className='hc415-visually-hidden';picker.tabIndex=-1;picker.setAttribute('aria-hidden','true');
  // ONE authoritative project control: this selector opens the workspace dialog
  // but is itself visually hidden (see mount comment below).
  const selectorBtn=button('Project: General chat','hc415-ws-selector hc415-visually-hidden');selectorBtn.id='hc415-ws-selector';
  selectorBtn.title='Select the working directory for this conversation';selectorBtn.setAttribute('aria-haspopup','dialog');selectorBtn.setAttribute('aria-expanded','false');
  selectorBtn.tabIndex=-1; // selection UI is the workspace dialog; the button stays only as a programmatic handle
  const filesBtn=button('🗂 Files','hc415-files-button');filesBtn.title='Browse project files and attach them to the conversation';
  // ＋ Attach already opens the Project tab, so a second visible Files button would be
  // redundant (audit #19) — but the World composer's handoff clicks this button by id,
  // and a detached node is not findable: keep it connected, out of sight.
  filesBtn.className='hc415-files-button hc415-visually-hidden';filesBtn.tabIndex=-1;
  // User redesign 2026-11-25: the chat composer carries NO project control —
  // "the chat should not be pre-attached to any project or directory". These
  // controls therefore mount INSIDE the Project tab (kept connected but out of
  // sight: the World composer's handoffs click them by id, and a detached node
  // is not findable). The selector button still opens the workspace dialog.
  const projectSlot=document.getElementById('project-focus-host');
  (projectSlot||panel).append(pickerLabel,picker,selectorBtn,filesBtn);

  // The workspace drawer and the in-chat Files sidebar are RETIRED: the Conversations
  // workspace now has Chat | Project tabs, and the Project tab mirrors the chat's
  // two-column anatomy — the file rail in the thread-list slot, the file stage in the
  // conversation slot (user redesign, 2026-11-25). Element ids are unchanged so every
  // existing rule, handler and test keeps resolving; only the mount points moved.
  const stage=document.createElement('section');stage.id='hc415-stage';stage.setAttribute('aria-label','Project files');
  // V2 audit: the stage is the CONTENT column (the conversation slot) — the file
  // preview lives here, and the project's actions are its header toolbar. The old
  // drawer header ("Project workspace" + a back-to-chat button) is gone: the tabs
  // above the panel already do that switching.
  const head=document.createElement('header');head.className='hc415-stage-head';
  const info=document.createElement('p');info.id='hc415-info';
  const actions=document.createElement('div');actions.className='hc415-actions';
  const refresh=button('↻','hc415-refresh');refresh.title='Refresh projects';
  const sync=button('Sync to work machine');const reviewBtn=button('Review changes');
  head.append(info,actions);actions.append(refresh,sync,reviewBtn);
  const status=document.createElement('div');status.id='hc415-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const reviewPanel=document.createElement('section');reviewPanel.id='hc415-review';reviewPanel.hidden=true;
  const reviewHeading=document.createElement('h3');reviewHeading.textContent='Proposed host changes';
  const reviewMeta=document.createElement('div');reviewMeta.className='hc415-review-meta';
  const diff=document.createElement('pre');diff.className='hc415-diff';diff.tabIndex=0;
  const confirmationLabel=document.createElement('label');confirmationLabel.htmlFor='hc415-confirmation';confirmationLabel.textContent='Approval phrase';
  const confirmation=document.createElement('input');confirmation.id='hc415-confirmation';confirmation.autocomplete='off';confirmation.spellcheck=false;
  const applyBtn=button('Apply reviewed changes to host','hc415-apply');
  reviewPanel.append(reviewHeading,reviewMeta,diff,confirmationLabel,confirmation,applyBtn);
  // Registered projects, selectable right in the drawer: the sync/review actions above
  // answer "Select a project first" until one is chosen, and nothing here showed the list.
  const projectList=document.createElement('div');projectList.id='hc415-project-list';projectList.setAttribute('role','listbox');projectList.setAttribute('aria-label','Registered projects');
  // Registration: POST /api/projects always existed but nothing in the UI called it, so
  // with zero projects registered every control here was a dead end. Offer the
  // directories under the allowed roots as one-click candidates instead of a
  // free-text path. Git is OPTIONAL (VS Code-style): any directory registers,
  // and a git badge marks which ones support sync/review.
  const registerPanel=document.createElement('section');registerPanel.id='hc415-register';
  const regHead=document.createElement('h4');regHead.textContent='Register a project directory';
  const regList=document.createElement('div');regList.id='hc415-register-list';
  const regRow=document.createElement('div');regRow.className='hc415-register-row';
  const regName=document.createElement('input');regName.id='hc415-register-name';regName.maxLength=48;regName.autocomplete='off';regName.spellcheck=false;regName.placeholder='project-name (lowercase, digits, hyphens)';
  const regBtn=button('Register','hc415-register-btn');regBtn.title='Register a directory as a chat workspace (any directory under an allowed root; git optional — sync/review need a repository)';
  regRow.append(regName,regBtn);
  // Beyond the candidate chips: paste any directory under an allowed root, or
  // create a brand-new project from just a name (directory + optional git + README).
  const createRow=document.createElement('div');createRow.className='hc415-register-row';
  const regPath=document.createElement('input');regPath.id='hc415-register-path';regPath.maxLength=1024;regPath.autocomplete='off';regPath.spellcheck=false;regPath.placeholder='…or paste a directory path under an allowed root';
  const createBtn=button('＋ Create','hc415-register-btn');createBtn.title='Create a brand-new project from the name above — makes the directory, seeds a README, and registers it. Git is optional: tick the checkbox to also initialize a repository (needed for sync/review).';
  const createGit=document.createElement('input');createGit.type='checkbox';createGit.id='hc415-create-git';
  const createGitLabel=document.createElement('label');createGitLabel.htmlFor='hc415-create-git';createGitLabel.textContent='git';createGitLabel.title='Also initialize a git repository (needed for sync/review). Leave unticked for a plain folder.';
  createRow.append(regPath,createGit,createGitLabel,createBtn);
  registerPanel.append(regHead,regList,regRow,createRow);
  // Empty state for the content column: honest about what opens here.
  const stageEmpty=document.createElement('div');stageEmpty.id='hc415-stage-empty';
  stageEmpty.textContent='Select a file from the rail to open it here — attach it with ＋ Attach in the preview header or the row\'s ⊕. Review changes shows what the workspace would apply.';
  stage.append(head,status,reviewPanel,stageEmpty);

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
  const sidebar=document.createElement('aside');sidebar.id='hc415-file-sidebar';sidebar.setAttribute('aria-label','Project files');
  const sbHead=document.createElement('header');sbHead.className='hc415-side-head';
  const sbTitle=document.createElement('strong');sbTitle.textContent='Project files';
  sbHead.append(sbTitle);
  const sbStatus=document.createElement('div');sbStatus.id='hc415-file-status';sbStatus.setAttribute('role','status');
  const sbTree=document.createElement('nav');sbTree.id='hc415-file-tree';sbTree.setAttribute('aria-label','Project file tree');
  const sbAttach=document.createElement('section');sbAttach.id='hc415-attachments';
  const sbAttachHead=document.createElement('h4');
  const sbAttachCount=document.createElement('span');sbAttachCount.textContent='Attachments (0)';
  const sbUpload=button('⬆ Upload','hc415-attach-clear');sbUpload.title='Upload local text files into the project workspace — they then behave like any project file';
  const sbInput=document.createElement('input');sbInput.type='file';sbInput.multiple=true;sbInput.id='hc415-file-input';sbInput.className='hc415-visually-hidden';sbInput.tabIndex=-1;sbInput.setAttribute('aria-hidden','true');
  const sbClear=button('Clear all','hc415-attach-clear');sbClear.title='Remove all attachments';
  sbClear.onclick=()=>{if(!attached.size)return;attached.clear();saveAttached();renderTree();setStatus('All attachments removed')};
  const sbSelectAll=button('Select all','hc415-attach-clear');sbSelectAll.title='Attach every file in the tree';
  sbSelectAll.onclick=()=>{if(!treeData)return setStatus('Load a project tree first');let n=0;for(const e of treeData.entries)if(!attached.has(e.path)){attached.add(e.path);n++}if(n){saveAttached();renderTree()}setStatus(n?`Attached ${n} more file(s)`:'Every tree file is already attached')};
  sbAttachHead.append(sbAttachCount,sbUpload,sbSelectAll,sbClear);
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
  // Open/edit like an editor: the preview gets a header (path + Edit/Save/Cancel/Close)
  // and a textarea; saving writes the project workspace via PUT (uncommitted host change).
  const sbPreviewWrap=document.createElement('section');sbPreviewWrap.id='hc415-preview';sbPreviewWrap.hidden=true;
  const sbPreviewHead=document.createElement('header');sbPreviewHead.className='hc415-preview-head';
  const sbPreviewPath=document.createElement('code');sbPreviewPath.id='hc415-preview-path';
  // The attach control lives where the user's eyes already are: the opened file's
  // header. The row's ⊕ still works, but the preview is the surface people act on
  // after opening a file — "click opens, then attach here" reads as one flow.
  const sbAttachToggle=button('＋ Attach','hc415-preview-attach');
  sbAttachToggle.title='Attach this file to the next message';
  const sbEditBtn=button('✎ Edit','hc415-preview-btn');sbEditBtn.title='Edit this file in place — saves to the project workspace (uncommitted; Review changes shows the diff)';
  const sbSaveBtn=button('Save','hc415-preview-btn');sbSaveBtn.hidden=true;
  const sbCancelBtn=button('Cancel','hc415-preview-btn');sbCancelBtn.hidden=true;
  // Soft delete (user decision, 2026-11-25): the control sits where the eyes are
  // (the opened file's header) and MOVES the file to <project>/.trash/ — the
  // confirm names the file so a glance can't destroy the wrong thing.
  const sbDeleteBtn=button('🗑 Delete','hc415-preview-delete');sbDeleteBtn.title='Move this file to the project .trash (recoverable)';
  const sbPreviewClose=button('×','hc415-preview-close');sbPreviewClose.title='Close the file preview';
  sbPreviewHead.append(sbPreviewPath,sbAttachToggle,sbEditBtn,sbSaveBtn,sbCancelBtn,sbDeleteBtn,sbPreviewClose);
  const sbEditor=document.createElement('textarea');sbEditor.id='hc415-file-editor';sbEditor.spellcheck=false;sbEditor.hidden=true;sbEditor.setAttribute('aria-label','File editor');
  sbPreviewWrap.append(sbPreviewHead,sbPreview,sbEditor);
  const sbMeter=document.createElement('div');sbMeter.id='hc415-file-meter';sbMeter.setAttribute('role','status');
  // The rail's thread-list analog: project identity first (registered list +
  // registration), then the file tree as the main list, attachments as its composer.
  // ─────────────────────── IDE shell (2026-11-25) ────────────────────────────
  // The Project tab is a WORKSPACE, not a dashboard. This rail previously stacked
  // ~25 permanently exposed controls — 2 workspace chips, 11 directory chips, two
  // text inputs, Register/Create, Upload/Select-all/Clear-all, three mode buttons
  // and a commit line — into a ~300px column, while the editor column sat empty.
  //
  // Every element and id below SURVIVES; only the MOUNT POINTS move (append moves
  // a connected node), so every CSS rule, handler, delegation and structural test
  // keeps resolving. Registration + directory discovery leave the rail for the
  // Workspace dialog; the rail shows ONE view at a time behind an activity bar.
  const activity=document.createElement('nav');activity.id='hc415-activity';
  activity.setAttribute('aria-label','Project views');
  const VIEWS:[string,string,string][]=[['explorer','🗂','Explorer'],['search','⌕','Search'],['scm','⑂','Source control'],['attachments','📎','Attachments']];
  const activityBtns:Record<string,HTMLButtonElement>={};
  for(const [vid,icon,label] of VIEWS){
    const b=button(icon,'hc415-activity-btn');b.dataset.view=vid;b.title=label;b.setAttribute('aria-label',label);
    b.setAttribute('aria-pressed','false');activityBtns[vid]=b;activity.append(b);
  }
  const activitySpacer=document.createElement('span');activitySpacer.className='hc415-activity-spacer';
  const activityMore=button('⋯','hc415-activity-btn');
  activityMore.title='Workspace — register a directory, create a project, open another folder';
  activityMore.setAttribute('aria-label','Workspace actions');
  activity.append(activitySpacer,activityMore);

  const viewExplorer=document.createElement('section');viewExplorer.id='hc415-view-explorer';viewExplorer.className='hc415-view';
  const viewSearch=document.createElement('section');viewSearch.id='hc415-view-search';viewSearch.className='hc415-view';
  const viewScm=document.createElement('section');viewScm.id='hc415-view-scm';viewScm.className='hc415-view';
  const viewAttachments=document.createElement('section');viewAttachments.id='hc415-view-attachments';viewAttachments.className='hc415-view';
  // Search filters the ALREADY-RENDERED tree by path: no second data source, no refetch.
  const searchInput=document.createElement('input');searchInput.id='hc415-search';searchInput.type='search';searchInput.autocomplete='off';
  searchInput.placeholder='Filter files by path…';searchInput.setAttribute('aria-label','Filter project files');
  const searchNote=document.createElement('div');searchNote.id='hc415-search-note';searchNote.className='hc415-tree-note';
  viewSearch.append(searchInput,searchNote);
  const scmBody=document.createElement('div');scmBody.id='hc415-scm-body';viewScm.append(scmBody);
  const views=document.createElement('div');views.id='hc415-views';
  // The tree and the attachment list MOVE into their views. Without these two
  // appends the containers exist and the handlers run against detached nodes:
  // every chip reports "310 files" while the explorer shows nothing at all.
  viewExplorer.append(sbTree);viewAttachments.append(sbAttach);
  views.append(viewExplorer,viewSearch,viewScm,viewAttachments);

  const viewTools=document.createElement('div');viewTools.className='hc415-view-tools';
  const collapseAll=button('⌄','hc415-icon-btn');collapseAll.id='hc415-collapse-all';collapseAll.title='Collapse all folders';
  viewTools.append(refresh,collapseAll);
  sbHead.append(viewTools);
  const sideFoot=document.createElement('div');sideFoot.id='hc415-side-foot';sideFoot.append(sbStatus,sbInput);
  sidebar.append(sbHead,views,sideFoot);

  const mainCol=document.createElement('div');mainCol.id='hc415-main';
  const editorHead=document.createElement('div');editorHead.id='hc415-editor-head';
  const tabStrip=document.createElement('div');tabStrip.id='hc415-tabs';tabStrip.setAttribute('role','tablist');tabStrip.setAttribute('aria-label','Open files');
  const editorTools=document.createElement('div');editorTools.className='hc415-editor-tools';
  editorHead.append(tabStrip,editorTools);
  const bottom=document.createElement('div');bottom.id='hc415-bottom';
  const bottomTabs=document.createElement('div');bottomTabs.id='hc415-bottom-tabs';bottomTabs.setAttribute('role','tablist');
  const bottomBody=document.createElement('div');bottomBody.id='hc415-bottom-body';
  const bottomPaneChanges=document.createElement('div');bottomPaneChanges.className='hc415-bottom-pane';bottomPaneChanges.id='hc415-pane-changes';
  const bottomPaneActivity=document.createElement('div');bottomPaneActivity.className='hc415-bottom-pane';bottomPaneActivity.id='hc415-pane-activity';
  const BOTTOM_TABS:[string,string][]=[['changes','Changes'],['activity','Activity']];
  const bottomBtns:Record<string,HTMLButtonElement>={};
  for(const [bid,label] of BOTTOM_TABS){
    const b=button(label,'hc415-bottom-tab');b.dataset.pane=bid;b.setAttribute('role','tab');bottomBtns[bid]=b;bottomTabs.append(b);
  }
  const bottomToggle=button('⌄','hc415-icon-btn');bottomToggle.id='hc415-bottom-toggle';bottomToggle.title='Collapse or expand this panel';
  bottomTabs.append(bottomToggle);
  bottomBody.append(bottomPaneChanges,bottomPaneActivity);
  bottom.append(bottomTabs,bottomBody);
  // the stage keeps only the editor surface: the summary goes to Source control,
  // the diff to the bottom panel, and sync/review become compact editor tools.
  scmBody.append(info);editorTools.append(actions);
  bottomPaneChanges.append(reviewPanel);bottomPaneActivity.append(status);
  // Breadcrumb row: the active document's path as segments, between the tabs and
  // the editor (the editor's own idea of "where am I", not the explorer's).
  const breadcrumb=document.createElement('div');breadcrumb.id='hc415-breadcrumb';breadcrumb.hidden=true;
  mainCol.append(editorHead,breadcrumb,stage,bottom);

  const ideStatus=document.createElement('div');ideStatus.id='hc415-ide-status';
  const ideChips=document.createElement('div');ideChips.id='hc415-ide-chips';
  const ideActions=document.createElement('div');ideActions.id='hc415-ide-actions';
  ideStatus.append(ideChips,ideActions);

  function setIdeView(which:string){
    for(const [vid] of VIEWS)activityBtns[vid].setAttribute('aria-pressed',String(vid===which));
    viewExplorer.hidden=which!=='explorer';viewSearch.hidden=which!=='search';
    viewScm.hidden=which!=='scm';viewAttachments.hidden=which!=='attachments';
    sbTitle.textContent=which==='explorer'?'EXPLORER':which==='search'?'SEARCH':which==='scm'?'SOURCE CONTROL':'ATTACHMENTS';
    if(which==='search')searchInput.focus();
    if(which==='scm')renderIdeChips();
  }
  for(const [vid] of VIEWS)activityBtns[vid].onclick=()=>setIdeView(vid);
  function setBottomTab(which:string){
    for(const [bid] of BOTTOM_TABS)bottomBtns[bid].setAttribute('aria-selected',String(bid===which));
    bottomPaneChanges.hidden=which!=='changes';bottomPaneActivity.hidden=which!=='activity';
  }
  for(const [bid] of BOTTOM_TABS)bottomBtns[bid].onclick=()=>setBottomTab(bid);
  bottomToggle.onclick=()=>bottom.toggleAttribute('data-collapsed');
  collapseAll.onclick=()=>{expanded=new Set();renderTree()};
  // Filter the rendered rows in place. Directories stay visible so the hierarchy
  // keeps its shape; a file row that does not match is hidden.
  searchInput.oninput=()=>{
    const q=searchInput.value.trim().toLowerCase();
    let files=0,shown=0;
    for(const row of Array.from(sbTree.querySelectorAll<HTMLElement>('.hc415-tree-node > *'))){
      const isDir=row.classList.contains('hc415-tree-dir');
      const label=(row.querySelector('.hc415-tree-label')?.textContent||'').toLowerCase();
      if(!isDir)files++;
      const hit=!q||label.includes(q);
      row.toggleAttribute('data-filtered',!hit&&!isDir);
      if(hit&&!isDir)shown++;
    }
    searchNote.textContent=!q?'':shown?shown+' of '+files+' files':'No file matches “'+searchInput.value.trim()+'”.';
  };

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
  // The dialog is the WORKSPACE HUB: the registered list and the registration /
  // creation controls live here now instead of permanently in the rail. That is
  // what removes ~18 always-visible controls from the sidebar. No id changes —
  // tests/project-files-ui.test.ts pins hc415-register-list/name/path by name.
  wsSelect.append(wsHead,wsList,wsInfo,registerPanel,projectList,wsActions);
  // The overlay covers the chat panel (#hc-panel is position:absolute, so it is
  // the containing block for the overlay's inset:0). Without this append the
  // selector button had no reachable General-chat option — the reported bug.
  panel.append(wsSelect);

  // PROJECT TAB mount: the rail and the stage fill #project-focus-host, the
  // chat's own host keeps #hermes-chat-root — one workspace, two tabs.
  const projectHost=document.getElementById('project-focus-host');
  const view=document.createElement('div');view.id='hc415-project-view';
  stage.append(sbPreviewWrap,sbMeter);
  view.append(activity,sidebar,mainCol,ideStatus);
  (projectHost||panel).append(view);

  /** The in-IDE status bar: workspace · version · files · mode. Derived from the
   *  same state the panels render, so the bar cannot disagree with what it
   *  summarises — and so it needs no new fetch. */
  function renderIdeChips(){
    // DEFENSIVE ON PURPOSE. This shell is declared ~260 lines ABOVE the state it
    // summarises, and `void load()` runs at the end of setup() — so a re-entrant
    // or early call can arrive while those `let` bindings are still in their
    // temporal dead zone, where reading one THROWS instead of yielding undefined
    // (measured: `Cannot access 'treeData' before initialization` bubbled up
    // through load() and killed the whole project list). A summary bar must never
    // be able to break the workspace it is describing, so every read is guarded.
    let workspace='General chat',version='no version',files='no tree',mode='A',synced='no workspace selected';
    try{const p=current();if(p){workspace=p.name;synced=p.remote_path?'work machine synced':'work machine unsynced'}}catch{}
    try{version=sbVer.textContent||'no version'}catch{}
    try{files=treeData?treeData.entries.length+' files':'no tree'}catch{}
    try{mode=attachMode()}catch{}
    const chips:[string,string][]=[['workspace',workspace],['version',version],['files',files],['mode','mode '+mode]];
    ideChips.replaceChildren(...chips.map(([k,v])=>{
      const s=document.createElement('span');s.className='hc415-chip';s.dataset.kind=k;s.textContent=v;return s;
    }));
    ideActions.textContent=synced;
  }
  setIdeView('explorer');setBottomTab('changes');
  let projectTab=false;
  function showProjectTab(on:boolean){
    projectTab=on;
    const chatHost=document.getElementById('chat-focus-host');
    const tabChat=document.getElementById('conv-tab-chat') as HTMLButtonElement|null;
    const tabProject=document.getElementById('conv-tab-project') as HTMLButtonElement|null;
    if(!chatHost||!projectHost||!tabChat||!tabProject)return;
    chatHost.hidden=on;projectHost.hidden=!on;
    tabChat.classList.toggle('active',!on);tabChat.setAttribute('aria-selected',String(!on));
    tabProject.classList.toggle('active',on);tabProject.setAttribute('aria-selected',String(on));
    if(on){if(!choice())void load();void refreshFileContext();}
  }
  document.getElementById('conv-tab-chat')?.addEventListener('click',()=>showProjectTab(false));
  document.getElementById('conv-tab-project')?.addEventListener('click',()=>showProjectTab(true));

  // Chat audit §8: the floating assistant is retired, so there is no float/wide/
  // fullscreen mode machine and no Expand control. The single presentation is
  // the Conversations workspace; the file-context sidebar (HL-CHAT-006) is just
  // a column that opens and closes inside it.
  // Entry points all land on the Project tab now: there is no sidebar toggle to
  // persist and no overlay for Escape to close — the tab bar and the composer
  // buttons switch surfaces directly.
  function showSidebar(open:boolean){if(open)showProjectTab(true)}

  let projects:Project[]=[];let selected=(projectByConversation()[conversationIdNow()]||localStorage.getItem(key)||'');let activeReview:Review|null=null;let busy=false;
  function choice(){return picker.value}
  function current(){return projects.find(p=>p.name===choice())}
  function clearReview(){activeReview=null;confirmation.value='';reviewPanel.hidden=true;reviewMeta.textContent='';diff.textContent=''}
  function setStatus(s:string){status.textContent=s}
  function renderHint(){refreshModeUI();const p=current();info.textContent=p?`${p.name} · ${p.remote_path||'Work-machine workspace not synchronized'}`:'Select a registered project to synchronize or review changes.';renderIdeChips()}
  function setBusy(value:boolean){busy=value;refresh.disabled=value;sync.disabled=value;reviewBtn.disabled=value;applyBtn.disabled=value;regBtn.disabled=value;createBtn.disabled=value}
  function openDrawer(){showProjectTab(true)}
  // The stage's back-to-chat button is gone with the drawer header — the tabs switch.
  async function load(){try{
    const data=await api<{projects:Project[]}>('/api/projects');projects=data.projects;
    picker.replaceChildren(new Option('General chat',''));for(const p of projects)picker.append(new Option(p.name,p.name));
    picker.value=projects.some(p=>p.name===selected)?selected:'';selected=choice();renderHint();renderSelector();renderProjectList();
    if(!projects.length)setStatus('No projects registered — pick one below under "Register a project directory".');
  }catch(e){setStatus('Project list unavailable: '+errText(e));info.textContent='Connection error'}
  void loadRoots();}
  // HL-CHAT-006 2.1: one shared selection path used by both the hidden <select> and the overlay.
  function selectProject(name:string){
    picker.value=name;selected=choice();
    rememberProjectForConversation(name);
    localStorage.setItem(key,name); // kept for the first-conversation seed only
    clearReview();renderHint();
    setStatus(selected?'Selected '+selected:'General chat');void refreshFileContext();
    renderSelector();
  }
  picker.onchange=()=>selectProject(choice());
  // The chat module announces conversation switches; the project choice follows
  // the conversation. A conversation KNOWN to the map gets its stored project;
  // a BRAND-NEW conversation starts at General chat — the user redesign
  // (2026-11-25) removed the carry-forward: the chat is never pre-attached to a
  // project, the choice is only ever explicit (Project tab or @slug).
  let lastSeenConversation=conversationIdNow();
  window.addEventListener('hc-conversation-changed',(ev)=>{
    const cid=String((ev as CustomEvent).detail||'');
    if(cid===lastSeenConversation)return;
    const map=projectByConversation();
    const wanted=Object.prototype.hasOwnProperty.call(map,cid)?(map[cid]||''):'';
    lastSeenConversation=cid;
    if(wanted!==choice())selectProject(wanted);
  });
  {const wanted=projectByConversation()[conversationIdNow()]||'';if(wanted&&wanted!==choice())selectProject(wanted);}
  // Live link to chat (user brief, 2026-11-25): when a chat task finishes, a
  // file it edited must appear in an OPEN editor the way a CLI edit does — the
  // editor reloads through the normal open path when the file's mtime moved.
  // An in-progress edit is never clobbered, and the tree refreshes too so new
  // files the task created show up without a manual reload.
  window.addEventListener('hc-task-finished',()=>{
    const state=openFileState;const name=choice();
    if(!name)return;
    void load();
    if(!state)return;
    void (async()=>{
      try{
        const f=await api<FileData>(`/api/projects/${encodeURIComponent(name)}/file?path=${encodeURIComponent(state.path)}&preview=1`);
        if(!f.mtime||openFileState?.path!==state.path)return;
        if(Math.abs(f.mtime-(state.mtime||0))<=0.001)return;
        if(!sbEditor.hidden)return; // a human is editing — never pull the file from under them
        void openFile(state.path);
      }catch{/* the file may have been deleted by the task; the tree refresh above reflects it */}
    })();
  });
  // HL-CHAT-006 2.1: workspace selector overlay behaviour.
  function renderSelectorLabel(){
    const p=current();
    selectorBtn.textContent='Project: '+(p?p.name:'General chat');
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
  selectorBtn.onclick=openWsSelect; // the overlay IS the workspace selector; the Project tab is the files button's job
  // The activity bar's ⋯ is the contextual door to the same dialog: register a
  // directory, create a project, or switch workspace — none of it permanent UI.
  activityMore.onclick=openWsSelect;
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
  type FileData={path:string;size:number;mtime?:number;mode:string;truncated:boolean;binary?:boolean;content:string;host_version?:{commit:string;dirty:boolean}|null};
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
  // Tree rows are div[role=button], not <button>: a file row carries its own attach
  // toggle, and a <button> cannot legally nest inside a <button>.
  function treeNode(node:TreeNode,depth:number):HTMLElement{
    const wrap=document.createElement('div');wrap.className='hc415-tree-node';
    const row=document.createElement('div');
    row.className='hc415-tree-row'+(node.isDir?' hc415-tree-dir':' hc415-tree-file');
    row.tabIndex=0;row.setAttribute('role','button');
    row.addEventListener('keydown',(e:KeyboardEvent)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();row.click()}});
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
      // VS Code-like: clicking the name OPENS the file (preview + edit); attaching is
      // the explicit ⊕/✓ control, so opening a file no longer doubles as attaching it.
      const attach=button(attached.has(node.path)?'✓':'⊕','hc415-dir-attach');
      attach.title=(attached.has(node.path)?'Detach ':'Attach ')+node.path;
      attach.setAttribute('aria-label',attach.title);
      if(attached.has(node.path))attach.classList.add('hc415-attached');
      attach.onclick=(ev)=>{ev.stopPropagation();void toggleFile(node.path)};
      row.append(attach);
      row.onclick=()=>{void openFile(node.path)};
    }
    wrap.append(row);
    if(node.isDir&&expanded.has(node.path))for(const c of node.children)wrap.append(treeNode(c,depth+1));
    return wrap;
  }
  // ── row context menu (delegated — no per-row wiring) ───────────────────────
  // The brief asked for "context menus, not permanently bordered buttons". Every
  // action here already exists on the row, but a row is ~60-250px wide; the menu
  // is where the rest goes. It reads the path from the row's OWN title (set in
  // treeNode) rather than a parallel map, so a menu can never act on a different
  // file than the row it was opened from.
  const rowMenu=document.createElement('div');rowMenu.id='hc415-rowmenu';rowMenu.hidden=true;rowMenu.setAttribute('role','menu');
  document.body.append(rowMenu); // fixed-position: body, never inside the scrolled tree
  function closeRowMenu(){rowMenu.hidden=true;rowMenu.replaceChildren()}
  function openRowMenu(x:number,y:number,path:string,isDir:boolean){
    const item=(label:string,fn:()=>void):HTMLButtonElement=>{
      const b=button(label,'');b.className='hc415-menu-item';b.setAttribute('role','menuitem');
      b.onclick=()=>{closeRowMenu();fn()};return b};
    const items:HTMLButtonElement[]=[];
    if(isDir){
      const open=expanded.has(path);
      items.push(item(open?'Collapse':'Expand',()=>{open?expanded.delete(path):expanded.add(path);renderTree()}));
    }else{
      items.push(item('Open',()=>{void openFile(path)}));
      items.push(item(attached.has(path)?'Detach':'Attach',()=>{void toggleFile(path)}));
    }
    items.push(item('Copy path',()=>{
      const w=navigator.clipboard?.writeText(path);
      if(w)void w.then(()=>setStatus('Copied '+path),()=>setStatus('Copy blocked — '+path));
      else setStatus('Copy unavailable — '+path);
    }));
    rowMenu.replaceChildren(...items);
    rowMenu.hidden=false;
    // keep the menu inside the viewport (it opens where the pointer is)
    const w=rowMenu.offsetWidth||180,h=rowMenu.offsetHeight||120;
    rowMenu.style.left=Math.max(4,Math.min(x,innerWidth-w-8))+'px';
    rowMenu.style.top=Math.max(4,Math.min(y,innerHeight-h-8))+'px';
    items[0].focus();
  }
  sbTree.addEventListener('contextmenu',(e)=>{
    const row=(e.target as HTMLElement|null)?.closest('.hc415-tree-row') as HTMLElement|null;
    if(!row||!row.title)return;
    e.preventDefault();
    openRowMenu(e.clientX,e.clientY,row.title,row.classList.contains('hc415-tree-dir'));
  });
  document.addEventListener('click',(e)=>{if(!rowMenu.hidden&&!(e.target as HTMLElement|null)?.closest('#hc415-rowmenu'))closeRowMenu()});
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&!rowMenu.hidden){e.stopPropagation();closeRowMenu()}});
  sbTree.addEventListener('scroll',()=>{if(!rowMenu.hidden)closeRowMenu()});
  function renderTree(){
    if(!treeData){
      // With no workspace the explorer has nothing to list, so it offers the ONE
      // action that resolves it (the brief's "Open Folder") instead of a dead
      // end. This is also where the workspace dialog earns its keep: registering
      // a directory is now a door here, not a permanent wall of buttons.
      sbTree.replaceChildren(treeNote(choice()?'Loading file tree…':'No workspace selected.'));
      if(!choice()){const cta=button('Open Folder…','');cta.id='hc415-open-folder';cta.title='Choose a registered project, register a directory, or create one';cta.onclick=openWsSelect;sbTree.append(cta)}
      return}
    sbTree.replaceChildren(...buildTree(treeData.entries).map(n=>treeNode(n,0)));
    if(treeData.truncated)sbTree.append(treeNote('Tree truncated at 3000 entries.'));
  }
  async function toggleFile(path:string){
    if(attached.has(path)){attached.delete(path);saveAttached();renderTree();return}
    setStatus('Reading '+path+'…');
    try{
      const f=await api<FileData>(`/api/projects/${encodeURIComponent(choice())}/file?path=${encodeURIComponent(path)}`);
      attached.add(path);saveAttached();renderTree();
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
  function resetTree(){treeData=null;expanded=new Set();hostVer=null;closePreview();renderTree()}
  async function loadTree(){
    const name=choice();if(!name){resetTree();return}
    try{treeData=await api<TreeData>(`/api/projects/${encodeURIComponent(name)}/tree`);hostVer=treeData.host_version||null;renderTree();renderAttachments();if(treeData.count)setStatus(`Loaded ${treeData.count} files from ${name} — ${verLabel()}`)}
    catch(e){resetTree();setStatus('File tree unavailable: '+errText(e))}
  }
  async function refreshFileContext(){loadAttached();await loadTree()}
  // --- write path: in-place edit and upload (PUT /api/projects/{name}/file) ---
  const MAX_UPLOAD_BYTES=1_000_000; // mirrors the server's MAX_WRITE_BYTES
  async function putFile(path:string,content:string,expected_mtime?:number){
    return await api<{path:string;size:number;mtime:number;created:boolean;host_version:{commit:string;dirty:boolean}|null}>(
      `/api/projects/${encodeURIComponent(choice())}/file`,
      {method:'PUT',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({path,content,...(expected_mtime===undefined?{}:{expected_mtime})})});
  }
  let openFileState:{path:string;mtime?:number}|null=null;
  // The editor's open-document LIST. `openFileState` stays "the active document"
  // so every existing reader (preview, save, attach toggle) keeps working
  // unchanged; the list is what the tab strip renders. One source of truth each:
  // the list is the model, the strip is its view.
  let openDocs:string[]=[];
  function previewReadMode(){
    if(!openFileState){sbPreviewWrap.hidden=true;return}
    sbEditor.hidden=true;sbPreview.hidden=false;
    sbEditBtn.hidden=false;sbSaveBtn.hidden=true;sbCancelBtn.hidden=true;
  }
  function closePreview(){openFileState=null;openDocs=[];sbPreviewWrap.hidden=true;stageEmpty.hidden=false;renderTabs()}
  const GLYPHS:Record<string,string>={md:'▤',ts:'⟨⟩',tsx:'⟨⟩',js:'⟨⟩',py:'⌘',css:'♪',json:'{}',sh:'⌗',html:'◇',png:'▣',jpg:'▣',svg:'▣',txt:'≡'};
  function fileGlyph(p:string):string{return GLYPHS[(p.split('.').pop()||'').toLowerCase()]||'·'}
  /** Breadcrumb for the ACTIVE document: its path as segments, last one emphasised.
   *  Every segment carries a title so a truncated path stays readable on hover. */
  function renderBreadcrumb(){
    const p=openFileState?.path;
    breadcrumb.replaceChildren();
    if(!p){breadcrumb.hidden=true;return}
    breadcrumb.hidden=false;
    const parts=p.split('/');
    parts.forEach((seg,i)=>{
      if(i){const s=document.createElement('span');s.className='hc415-crumb-sep';s.textContent='›';breadcrumb.append(s)}
      const c=document.createElement('span');c.className='hc415-crumb';c.textContent=seg;
      c.title=parts.slice(0,i+1).join('/');c.dataset.last=String(i===parts.length-1);
      breadcrumb.append(c);
    });
  }
  /** The editor tab strip: one tab per open document (openDocs), in open order.
   *  Clicking a tab makes it active by re-opening it — which refreshes its mtime
   *  through the same code path a fresh open takes, so a tab can never show stale
   *  content. ✕ closes only that tab. Empty list hides the strip entirely. */
  function renderTabs(){
    renderBreadcrumb();
    if(!openDocs.length){tabStrip.replaceChildren();tabStrip.hidden=true;return}
    tabStrip.hidden=false;
    const active=openFileState?.path;
    tabStrip.replaceChildren(...openDocs.map(p=>{
      const on=p===active;
      const tab=document.createElement('div');tab.className='hc415-tab';tab.dataset.active=String(on);
      tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(on));
      const name=p.split('/').pop()||p;
      const icon=document.createElement('span');icon.className='hc415-tab-icon';icon.textContent=fileGlyph(p);
      const label=document.createElement('span');label.className='hc415-tab-label';label.textContent=name;label.title=p;
      const close=document.createElement('button');close.type='button';close.className='hc415-tab-close';close.textContent='✕';
      close.title='Close '+name;close.setAttribute('aria-label','Close '+name);
      close.onclick=(e)=>{e.stopPropagation();closeDoc(p)};
      tab.append(icon,label,close);
      if(!on)tab.onclick=()=>{void openFile(p)};
      return tab;
    }));
  }
  /** Close one document. Closing the ACTIVE tab hands the editor to the tab that
   *  slid into its place (the neighbour to the right, else the new last one) —
   *  which is what makes closing feel like an editor instead of a reset. */
  function closeDoc(path:string){
    const i=openDocs.indexOf(path);
    if(i<0)return;
    openDocs.splice(i,1);
    if(openFileState?.path!==path){renderTabs();return}
    const next=openDocs[Math.min(i,openDocs.length-1)];
    if(next)void openFile(next);else closePreview();
  }
  // The preview header's attach toggle mirrors the OPEN file's attachment state.
  function syncPreviewAttach(){
    const p=openFileState?.path;
    if(!p){sbAttachToggle.hidden=true;return}
    sbAttachToggle.hidden=false;
    const on=attached.has(p);
    sbAttachToggle.textContent=on?'✓ Attached':'＋ Attach';
    sbAttachToggle.classList.toggle('hc415-attached',on);
    sbAttachToggle.title=(on?'Detach ':'Attach ')+p+(on?' from the next message':' into the next message');
  }
  async function openFile(path:string){
    if(!choice())return setStatus('Select a project first — Workspace ▸ lists and registers directories');
    setStatus('Opening '+path+'…');
    // Register in CLICK order, before the fetch: three opens in a row would
    // otherwise list their tabs in whatever order the responses happened to land
    // (measured: opening a, b, c produced tabs b, c, a).
    if(!openDocs.includes(path))openDocs.push(path);
    try{
      // preview=1: the stage tolerates big files (truncated honestly) and
      // binary files (metadata only) instead of a 409 wall.
      const f=await api<FileData>(`/api/projects/${encodeURIComponent(choice())}/file?path=${encodeURIComponent(path)}&preview=1`);
      if(f.host_version)hostVer=f.host_version;
      openFileState={path:f.path,mtime:f.mtime};
      sbPreviewPath.textContent=f.path+(f.size?' · '+f.size.toLocaleString()+' bytes':'');
      if(f.binary){
        sbPreview.textContent='Binary file — not rendered as text. Size '+f.size.toLocaleString()+' bytes. Attach it (mode A workspace access) and Hermesha can inspect it with its own tools.';
        sbEditor.value='';
      }else{
        sbPreview.textContent=f.content;
        sbEditor.value=f.content;
        if(f.truncated)sbPreview.textContent+='\n\n[Showing the first 200,000 bytes of '+f.size.toLocaleString()+' — the rest is available to Hermesha through workspace access (mode A), not inline.]';
      }
      sbPreviewWrap.hidden=false;stageEmpty.hidden=true;previewReadMode();syncPreviewAttach();renderTabs();
      setStatus('Opened '+f.path+(f.truncated?' (truncated preview)':'')+' — '+verLabel());
    }catch(e){
      // A failed open must not leave a tab behind for a file that never loaded.
      const at=openDocs.indexOf(path);
      if(at>=0&&openFileState?.path!==path)openDocs.splice(at,1);
      renderTabs();setStatus(errText(e));
    }
  }
  sbEditBtn.onclick=()=>{if(!openFileState)return;
    sbPreview.hidden=true;sbEditor.hidden=false;sbEditor.value=sbPreview.textContent||'';
    sbEditBtn.hidden=true;sbSaveBtn.hidden=false;sbCancelBtn.hidden=false;sbEditor.focus()};
  sbCancelBtn.onclick=previewReadMode;
  sbSaveBtn.onclick=async()=>{
    const state=openFileState;if(!state||!choice())return;
    sbSaveBtn.disabled=true;setStatus('Saving '+state.path+'…');
    try{
      const res=await putFile(state.path,sbEditor.value,state.mtime);
      if(res.host_version)hostVer=res.host_version;
      openFileState={path:state.path,mtime:res.mtime};
      sbPreview.textContent=sbEditor.value;
      sbPreviewPath.textContent=state.path+' · '+res.size.toLocaleString()+' bytes';
      previewReadMode();
      setStatus('Saved '+state.path+' — uncommitted; Workspace ▸ Review changes shows the diff');
      renderAttachments();
    }catch(e){setStatus(errText(e))}
    finally{sbSaveBtn.disabled=false}
  };
  sbPreviewClose.onclick=closePreview;
  // Soft delete: named confirm, then DELETE /api/projects/{name}/file moves the
  // file into the project's .trash/. The preview closes and the tree reloads so
  // the row disappears; the status line says where it went.
  sbDeleteBtn.onclick=async()=>{
    const state=openFileState;const name=choice();
    if(!state||!name)return;
    if(!window.confirm('Move "'+state.path+'" to the project .trash? You can restore it from the folder later.'))return;
    sbDeleteBtn.disabled=true;setStatus('Deleting '+state.path+'…');
    try{
      const res=await api<{deleted:string;trash:string}>(`/api/projects/${encodeURIComponent(name)}/file?path=${encodeURIComponent(state.path)}`,{method:'DELETE'});
      setStatus('Moved to '+res.trash);
      closePreview();
      attached.delete(state.path);saveAttached();
      await load();
    }catch(e){setStatus(errText(e))}
    finally{sbDeleteBtn.disabled=false}
  };
  sbAttachToggle.onclick=()=>{const p=openFileState?.path;if(!p)return;void toggleFile(p).then(syncPreviewAttach)};
  // Upload: local text files become files IN the selected project workspace, then
  // attach exactly like anything else in the tree.
  sbUpload.onclick=()=>{if(!choice())return setStatus('Select a project first — Workspace ▸ lists and registers directories');sbInput.click()};
  sbInput.onchange=async()=>{
    const list=sbInput.files;const files:File[]=[];
    for(let i=0;list&&i<list.length;i++)files.push(list[i]);
    sbInput.value='';
    if(!files.length)return;
    if(!choice())return setStatus('Select a project first');
    setStatus('Uploading '+files.length+' file(s) into '+choice()+'…');
    const existing=new Set((treeData?.entries||[]).map(e=>e.path));
    const errors:string[]=[];let saved=0;
    for(const f of files){
      try{
        if(f.size>MAX_UPLOAD_BYTES)throw new Error(f.name+' exceeds the 1 MB upload limit');
        const buf=new Uint8Array(await f.arrayBuffer());
        if(buf.subarray(0,4096).includes(0))throw new Error(f.name+' looks binary — text files only');
        if(existing.has(f.name)&&!window.confirm(f.name+' already exists in the project. Overwrite it?')){errors.push(f.name+' skipped');continue}
        await putFile(f.name,new TextDecoder().decode(buf));
        existing.add(f.name);attached.add(f.name);saved++;
      }catch(e){errors.push(errText(e))}
    }
    if(saved){saveAttached()}
    await loadTree();renderAttachments();
    setStatus((saved?`Uploaded ${saved} file(s) into ${choice()}`:'Nothing uploaded')+(errors.length?' — '+errors.join('; '):''));
  };
  // --- registration: choose a Git repository under the allowed root, name it, register ---
  const slugify=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  let chosenRoot='';
  function renderProjectList(){
    projectList.replaceChildren(...projects.map(p=>{
      const b=button((choice()===p.name?'◉ ':'○ ')+p.name,'hc415-project-select');
      b.title=p.host_path+(choice()===p.name?' (current workspace)':'');
      b.onclick=()=>{selectProject(p.name);renderProjectList()};return b}));
  }
  async function loadRoots(){
    try{
      const data=await api<{roots:{name:string;path:string;registered:boolean;git?:boolean}[]}>('/api/projects/roots');
      const buttons=(data.roots||[]).map(r=>{
        const b=button((r.registered?'✓ ':'')+r.name+(r.git===false?' ◦plain':''),'hc415-register-option');
        b.title=r.path+(r.git===false?' — plain directory (no git; sync/review unavailable)':'');b.disabled=r.registered;
        b.onclick=()=>{chosenRoot=r.path;regName.value=slugify(r.name);
          for(const o of Array.from(regList.children) as HTMLElement[])o.classList.toggle('hc415-chosen',o===b)};
        return b});
      regList.replaceChildren(...buttons);
    }catch(e){
      const note=document.createElement('div');note.className='hc415-tree-note';
      note.textContent='Directory list unavailable: '+errText(e);regList.replaceChildren(note);
    }
  }
  regBtn.onclick=async()=>{
    const name=regName.value.trim();
    const pasted=regPath.value.trim();
    const root=pasted||chosenRoot;
    if(!root)return setStatus('Choose a directory from the list, or paste a path first');
    if(!/^[a-z][a-z0-9-]{1,47}$/.test(name))return setStatus('Project name must be lowercase letters, digits and hyphens, starting with a letter');
    regBtn.disabled=true;setStatus('Registering '+name+'…');
    try{
      await post('/api/projects',{name,host_path:root});
      selected=name;
      await load();selectProject(name);renderProjectList();await loadRoots();
      setStatus('Registered '+name+' — its file tree is now browsable');
    }catch(e){setStatus(errText(e))}
    finally{regBtn.disabled=false}
  };
  createBtn.onclick=async()=>{
    const name=regName.value.trim();
    if(!/^[a-z][a-z0-9-]{1,47}$/.test(name))return setStatus('Project name must be lowercase letters, digits and hyphens, starting with a letter');
    createBtn.disabled=true;setStatus('Creating '+name+'…');
    try{
      await post('/api/projects/create',{name,git:createGit.checked});
      await load();selectProject(name);renderProjectList();await loadRoots();
      setStatus('Created '+name+' — directory and README are ready'+(createGit.checked?' (git repository initialized)':' (plain folder — no git; sync/review unavailable)'));
    }catch(e){setStatus(errText(e))}
    finally{createBtn.disabled=false}
  };
  filesBtn.onclick=()=>showProjectTab(true);
  refresh.onclick=()=>{if(!busy){void load();renderProjectList();void loadRoots()}};
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
          try{const f=await api<FileData>(`/api/projects/${encodeURIComponent(name)}/file?path=${encodeURIComponent(p)}&preview=1`);
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
        try{f=await api<FileData>(`/api/projects/${encodeURIComponent(name)}/file?path=${encodeURIComponent(p)}&preview=1`)}
        catch(e){dropped.push(p+' ('+errText(e)+')');continue}
        if(!f)continue;
        if(total+f.content.length>budget){dropped.push(p+` (${(f.content.length/4|0).toLocaleString()} est. tokens — exceeds remaining model context capacity)`);continue}
        if(f.host_version)hostVer=f.host_version;
        // preview=1 truncates over-limit files honestly: inline what fits and
        // say so, instead of silently attaching a cut file or refusing it.
        const tail=f.truncated?`\n[Truncated inline at ${f.content.length.toLocaleString()} of ${f.size.toLocaleString()} bytes — the full file is available through workspace access (mode A).]`:'';
        total+=f.content.length;parts.push('--- '+p+' ---\n'+f.content+tail);
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
  if(choice())void refreshFileContext();
  return true;
}
try{
  if(!setup()){
    const observer=new MutationObserver(()=>{try{if(setup())observer.disconnect()}catch(e){(window as any).__hc415err=String((e as Error)?.stack||e)}});observer.observe(document.documentElement,{childList:true,subtree:true});
  }
}catch(e){(window as any).__hc415err=String((e as Error)?.stack||e)}
