/** Phase 4.15: compact project picker, isolated workspace drawer, unchanged approval API. */
import './phase415-workspace.css';
import {attachProjectEditor,type EditorPrefs} from './project-editor-lib.ts';
// D9 (review.md): Projects → Chat actions. A file reference becomes a chip
// above the canonical composer; it never sends anything by itself.
import {addExternalRef,getConversationScope} from './chat-attach.ts';
// HA-040: .md previews render through the existing safe Markdown renderer.
import {renderHermesMarkdown} from './chat-markdown.ts';
type Project = {name:string;host_path:string;remote_path:string|null;commit_hash:string|null};
type Review = {review_id:string;project:string;base_commit:string;sha256:string;diff:string;confirmation_required:string};
const key='hermes-life-active-project';
// The Project workspace has its OWN independent selection — NOT tied to the
// current conversation. The conversation→project map is only a convenience
// so @project references in chat know which project the user is working on.
const PROJECT_GLOBAL_KEY='hermes-life-project-global';
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
const SVG_PATHS:Record<string,string>={
  explorer:'<path d="M3.5 4.5A1.5 1.5 0 015 3h4.086a1.5 1.5 0 011.06.44l1.415 1.413a1.5 1.5 0 001.06.44H16.5A1.5 1.5 0 0118 6.793v8.707A1.5 1.5 0 0116.5 17h-12A1.5 1.5 0 013 15.5V4.5z"/>',
  search:'<circle cx="9" cy="9" r="5.5"/><path d="M13.5 13.5l4 4"/>',
  scm:'<circle cx="6" cy="5" r="2"/><circle cx="14" cy="13" r="2"/><path d="M6 7v3a4 4 0 004 4h4"/>',
  more:'<path d="M10 4v12M4 10h12"/>',
  settings:'<circle cx="10" cy="10" r="3"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.5 4.5l1.5 1.5M14 14l1.5 1.5M4.5 15.5l1.5-1.5M14 6l1.5-1.5"/>',
};
function svgIcon(id:string):SVGSVGElement{
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg') as unknown as SVGSVGElement;
  svg.setAttribute('width','22');svg.setAttribute('height','22');
  svg.setAttribute('viewBox','0 0 20 20');
  svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');
  svg.setAttribute('stroke-width','1.5');
  svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
  const p=SVG_PATHS[id];
  if(p)svg.innerHTML=p;
  return svg;
}
function setup():boolean{
  const panel=document.getElementById('hc-panel');const form=document.getElementById('hc-form');const input=document.getElementById('hc-input') as HTMLTextAreaElement|null;
  if(!panel)return false;
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
  const browseBtn=button('Browse…','hc415-register-btn');browseBtn.id='hc415-browse-path';browseBtn.title='Pick a directory from your machine — will pre-fill the project name';
  browseBtn.onclick=()=>void nativeOpenFolder();
  const createBtn=button('＋ Create','hc415-register-btn');createBtn.title='Create a brand-new project from the name above — makes the directory, seeds a README, and registers it. Git is optional: tick the checkbox to also initialize a repository (needed for sync/review).';
  const createGit=document.createElement('input');createGit.type='checkbox';createGit.id='hc415-create-git';
  const createGitLabel=document.createElement('label');createGitLabel.htmlFor='hc415-create-git';createGitLabel.textContent='git';createGitLabel.title='Also initialize a git repository (needed for sync/review). Leave unticked for a plain folder.';
  createRow.append(regPath,browseBtn,createGit,createGitLabel,createBtn);
  registerPanel.append(regHead,regList,regRow,createRow);
  // Empty state for the content column: honest about what opens here.
  const stageEmpty=document.createElement('div');stageEmpty.id='hc415-stage-empty';
  stage.append(head,status,reviewPanel,stageEmpty);
  // Context-aware empty state (spec phase 2 §7): the editor must say something
  // TRUE about the current workspace instead of showing every user the same
  // instructions. Two honest states — no workspace selected, and a workspace
  // loaded with no file open. Never tell the user to select a file that cannot
  // exist yet, and never advertise attachment controls before a workspace can
  // receive them.
  function renderStageEmpty(){
    const hasWorkspace=!!choice();
    stageEmpty.replaceChildren();
    const title=document.createElement('strong');title.className='hc415-empty-title';
    const hint=document.createElement('p');hint.className='hc415-empty-hint';
    if(!hasWorkspace){
      title.textContent='No workspace selected';
      hint.textContent='Open a folder to browse its files here — registered projects, a new directory and recent workspaces all live in the workspace dialog.';
      const cta=button('Open Folder…','hc415-empty-cta');
      cta.id='hc415-empty-open';
      cta.title='Choose a registered project, register a directory, or create one';
      cta.onclick=()=>void nativeOpenFolder();
      stageEmpty.append(title,hint,cta);
    }else{
      title.textContent='No file open';
      hint.textContent=`Workspace "${choice()}" is loaded. Select a file in the Explorer to open it here — ＋ Attach in the preview header or the row's ⊕ attaches it to the conversation.`;
      stageEmpty.append(title,hint);
    }
  }

  // HL-CHAT-006: file-context sidebar — DOM shell only; behaviour wired below.
  // HL-CHAT-006 2.3: attachment modes. A = workspace access (paths only, Hermesha inspects
  // with tools — the default for development conversations). B = manifest attachment
  // (path/type/size/mtime references, contents retrievable). C = full contents inlined.
  const sidebar=document.createElement('aside');sidebar.id='hc415-file-sidebar';sidebar.setAttribute('aria-label','Project files');
  const sbHead=document.createElement('header');sbHead.className='hc415-side-head';
  const sbTitle=document.createElement('strong');sbTitle.textContent='Project files';
  sbHead.append(sbTitle);
  const sbStatus=document.createElement('div');sbStatus.id='hc415-file-status';sbStatus.setAttribute('role','status');
  const sbTree=document.createElement('nav');sbTree.id='hc415-file-tree';sbTree.setAttribute('aria-label','Project file tree');
  // Host version label — compact, in the sidebar footer, not in a full attachment card.
  const sbVer=document.createElement('span');sbVer.id='hc415-host-ver';sbVer.textContent='';sbVer.title='Git version of the host workspace';
  // HA-011: the attachment MODE control lives in the chat composer (another
  // workstream) — this side only READS the shared map (localStorage JSON
  // {projectSlug:'A'|'B'|'C'}), keyed by the conversation's scope project or ''
  // for unscoped. The mode still shapes what the submit injection composes.
  const MODE_KEY='hermes-life-chat-attach-mode';
  type AttachMode='A'|'B'|'C';
  let modeMap:Record<string,AttachMode>={};
  function attachMode(scope:string):AttachMode{
    try{modeMap=JSON.parse(localStorage.getItem(MODE_KEY)||'{}') as Record<string,AttachMode>}catch{modeMap={}}
    return modeMap[scope||'']||'A'}
  const sbPreview=document.createElement('pre');sbPreview.id='hc415-file-preview';sbPreview.tabIndex=0;sbPreview.hidden=true;
  // HA-040: .md renders through the safe Markdown renderer in this companion
  // view; the raw source stays in sbPreview behind a Source/Preview toggle.
  const sbMd=document.createElement('div');sbMd.id='hc415-md-view';sbMd.hidden=true;
  let mdRendered=true;
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
  // HA-040: Preview/SOURCE toggle — .md only; the default view is the rendered
  // preview and the button flips to the raw source (and back).
  const sbViewToggle=button('Source','hc415-preview-btn');sbViewToggle.id='hc415-md-toggle';
  sbViewToggle.title='Toggle between the rendered Markdown preview and the raw source';sbViewToggle.hidden=true;
  const sbEditBtn=button('✎ Edit','hc415-preview-btn');sbEditBtn.title='Edit this file in place — saves to the project workspace (uncommitted; Review changes shows the diff)';
  const sbSaveBtn=button('Save','hc415-preview-btn');sbSaveBtn.hidden=true;
  const sbCancelBtn=button('Cancel','hc415-preview-btn');sbCancelBtn.hidden=true;
  // Soft delete (user decision, 2026-11-25): the control sits where the eyes are
  // (the opened file's header) and MOVES the file to <project>/.trash/ — the
  // confirm names the file so a glance can't destroy the wrong thing.
  const sbDeleteBtn=button('🗑 Delete','hc415-preview-delete');sbDeleteBtn.title='Move this file to the project .trash (recoverable)';
  // D9: the editor's selection goes to the chat composer as TEXT — reviewed
  // there, never auto-sent from here.
  const sbSendSel=button('Send selection','hc415-preview-btn');sbSendSel.hidden=true;sbSendSel.title='Place the editor selection into the chat composer (not sent automatically)';
  const sbPreviewClose=button('×','hc415-preview-close');sbPreviewClose.title='Close the file preview';
  sbPreviewHead.append(sbPreviewPath,sbAttachToggle,sbViewToggle,sbSendSel,sbEditBtn,sbSaveBtn,sbCancelBtn,sbDeleteBtn,sbPreviewClose);
  const sbEditor=document.createElement('textarea');sbEditor.id='hc415-file-editor';sbEditor.spellcheck=false;sbEditor.hidden=true;sbEditor.setAttribute('aria-label','File editor');
  // CodeMirror 6 (2026-11-27): editing moves to a real editor lib — syntax
  // highlighting by extension, wrap/font/theme prefs that apply live. The
  // textarea stays connected as the pinned bridge (tests pin its id) but is
  // never the visible surface; the lib host below is. The hidden textareas's
  // value mirrors the lib so anything still reading it sees the same text.
  const EDITOR_PREFS_KEY='hermes-life-editor-prefs';
  function readEditorPrefs():EditorPrefs{
    let p:Partial<EditorPrefs>={};
    try{p=JSON.parse(localStorage.getItem(EDITOR_PREFS_KEY)||'{}') as Partial<EditorPrefs>}catch{p={}}
    const fontSize=typeof p.fontSize==='number'&&p.fontSize>=9&&p.fontSize<=24?p.fontSize:13;
    return {fontSize,wrap:p.wrap===true,dark:p.dark!==false};
  }
  let editorPrefs=readEditorPrefs();
  function saveEditorPrefs(){localStorage.setItem(EDITOR_PREFS_KEY,JSON.stringify(editorPrefs))}
  const editorLib=document.createElement('div');editorLib.id='hc415-editor-lib';editorLib.hidden=true;
  const projectEditor=attachProjectEditor(editorLib,()=>editorPrefs);
  const cmGet=()=>projectEditor.get();
  const cmSet=(v:string)=>projectEditor.set(v,openFileState?.path||'');
  sbPreviewWrap.append(sbPreviewHead,sbPreview,sbMd,sbEditor,editorLib);
  // HA-011: the always-on attachment meter is UNMOUNTED (spec §4.3 forbids a
  // permanent attachment panel in the IDE); the contextual attach toggles stay.
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
  // Spec §6.440-448: the activity bar is the workspace's navigation rail, with
  // monochrome SVG icons (currentColor) — consistent across every platform.
  const VIEWS:[string,string][]=[['explorer','Explorer'],['search','Search'],['scm','Source control']];
  const activityBtns:Record<string,HTMLButtonElement>={};
  for(const [vid,label] of VIEWS){
    const b=document.createElement('button');b.type='button';b.className='hc415-activity-btn';
    b.dataset.view=vid;b.title=label;b.setAttribute('aria-label',label);
    b.setAttribute('aria-pressed','false');b.append(svgIcon(vid));
    activityBtns[vid]=b;activity.append(b);
  }
  const activitySpacer=document.createElement('span');activitySpacer.className='hc415-activity-spacer';
  const activityMore=document.createElement('button');activityMore.type='button';activityMore.className='hc415-activity-btn';
  activityMore.title='Workspace — register a directory, create a project, open another folder';
  activityMore.setAttribute('aria-label','Workspace actions');
  activityMore.append(svgIcon('more'));
  // Spec §4 diagram: the settings gear sits at the BOTTOM of the rail, separate
  // from the view icons. It opens the settings view — editor prefs that apply live.
  const activitySettings=document.createElement('button');activitySettings.type='button';activitySettings.className='hc415-activity-btn';
  activitySettings.dataset.view='settings';activitySettings.title='Settings';
  activitySettings.setAttribute('aria-label','Settings');activitySettings.setAttribute('aria-pressed','false');
  activitySettings.append(svgIcon('settings'));
  activity.append(activitySpacer,activityMore,activitySettings);

  const viewExplorer=document.createElement('section');viewExplorer.id='hc415-view-explorer';viewExplorer.className='hc415-view';
  const viewSearch=document.createElement('section');viewSearch.id='hc415-view-search';viewSearch.className='hc415-view';
  const viewScm=document.createElement('section');viewScm.id='hc415-view-scm';viewScm.className='hc415-view';
  const viewSettings=document.createElement('section');viewSettings.id='hc415-view-settings';viewSettings.className='hc415-view';
  // Settings rows (spec §4 ⚙): editor prefs that apply to the CodeMirror view
  // IMMEDIATELY via compartments (no rebuild, no cursor loss) and persist in
  // localStorage — a settings menu that actually works, not a stub.
  function settingsRow(name:string,control:HTMLElement,hint?:string):HTMLElement{
    const row=document.createElement('div');row.className='hc415-set-row';
    const label=document.createElement('label');label.className='hc415-set-name';label.textContent=name;
    if(control.id)label.htmlFor=control.id;if(hint)label.title=hint;
    row.append(label,control);return row;
  }
  const setFontSize=document.createElement('input');setFontSize.type='number';setFontSize.id='hc415-set-font';
  setFontSize.min='9';setFontSize.max='24';setFontSize.step='1';setFontSize.value=String(editorPrefs.fontSize);
  setFontSize.title='Editor font size (9–24) — applies immediately';
  setFontSize.onchange=()=>{const v=Number(setFontSize.value);
    if(Number.isFinite(v)){editorPrefs.fontSize=Math.min(24,Math.max(9,Math.round(v)));setFontSize.value=String(editorPrefs.fontSize);saveEditorPrefs();projectEditor.refresh()}};
  const setWrap=document.createElement('input');setWrap.type='checkbox';setWrap.id='hc415-set-wrap';setWrap.checked=editorPrefs.wrap;
  setWrap.onchange=()=>{editorPrefs.wrap=setWrap.checked;saveEditorPrefs();projectEditor.refresh()};
  const setDark=document.createElement('select');setDark.id='hc415-set-theme';
  setDark.append(new Option('Dark (One Dark)','dark'),new Option('Light','light'));setDark.value=editorPrefs.dark?'dark':'light';
  setDark.onchange=()=>{editorPrefs.dark=setDark.value==='dark';saveEditorPrefs();projectEditor.refresh()};
  viewSettings.append(
    settingsRow('Font size',setFontSize,'Applies to the file editor immediately; stored in this browser.'),
    settingsRow('Word wrap',setWrap),
    settingsRow('Theme',setDark));
  // Search filters the ALREADY-RENDERED tree by path: no second data source, no refetch.
  const searchInput=document.createElement('input');searchInput.id='hc415-search';searchInput.type='search';searchInput.autocomplete='off';
  searchInput.placeholder='Filter files by path…';searchInput.setAttribute('aria-label','Filter project files');
  const searchNote=document.createElement('div');searchNote.id='hc415-search-note';searchNote.className='hc415-tree-note';
  // D12: content results beneath the label filter — a real Search view. Hits
  // come from the backend walk (same denylist/caps as the tree) and open the
  // file on click.
  const searchResults=document.createElement('div');searchResults.id='hc415-search-results';
  viewSearch.append(searchInput,searchNote,searchResults);
  const scmBody=document.createElement('div');scmBody.id='hc415-scm-body';viewScm.append(scmBody);
  const views=document.createElement('div');views.id='hc415-views';
  // The tree and the attachment list MOVE into their views. Without these two
  // appends the containers exist and the handlers run against detached nodes:
  // every chip reports "310 files" while the explorer shows nothing at all.
  viewExplorer.append(sbTree);
  views.append(viewExplorer,viewSearch,viewScm,viewSettings);

  const viewTools=document.createElement('div');viewTools.className='hc415-view-tools';
  const collapseAll=button('⌄','hc415-icon-btn');collapseAll.id='hc415-collapse-all';collapseAll.title='Collapse all folders';
  // D16 (review.md): the explorer's Upload was lost in the 2026-11-26 redesign —
  // restored. Local files land IN the selected workspace via the same PUT write
  // endpoint the editor uses (uncommitted host write; Review changes shows the
  // diff). Text uploads go through UTF-8 decode; binary uploads are refused
  // client-side; an existing file is never overwritten without a named confirm.
  const uploadBtn=button('⬆','hc415-icon-btn');uploadBtn.id='hc415-upload';uploadBtn.title='Upload local files into this workspace';
  const sbInput=document.createElement('input') as HTMLInputElement;sbInput.type='file';sbInput.multiple=true;sbInput.hidden=true;
  function looksBinary(buf:ArrayBuffer):boolean{
    const bytes=new Uint8Array(buf.slice(0,8192));
    if(bytes.includes(0))return true;
    try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);return false}catch{return true}
  }
  uploadBtn.onclick=()=>{if(!choice())return setStatus('Select a project first — uploads write into its workspace');sbInput.click()};
  sbInput.onchange=async()=>{
    const list=sbInput.files;if(!list||!list.length)return;
    for(const f of Array.from(list)){
      if(f.size>MAX_UPLOAD_BYTES){setStatus(f.name+' is too large to upload ('+f.size.toLocaleString()+' bytes; limit '+MAX_UPLOAD_BYTES.toLocaleString()+')');continue}
      const buf=await f.arrayBuffer();
      if(looksBinary(buf)){setStatus(f.name+' looks binary — refused (edit it in a real editor and sync, or attach it to a message)');continue}
      if(treeData?.entries.some(e=>e.path===f.name)&&!window.confirm(f.name+' already exists in the workspace — overwrite it?'))continue;
      try{
        await putFile(f.name,new TextDecoder().decode(buf));
        setStatus('Uploaded '+f.name+' into the workspace — uncommitted; Review changes shows the diff');
      }catch(e){setStatus(errText(e))}
    }
    sbInput.value='';
    await loadTree();
  };
  viewTools.append(refresh,collapseAll,uploadBtn,sbInput);
  sbHead.append(viewTools);
  const sideFoot=document.createElement('div');sideFoot.id='hc415-side-foot';sideFoot.append(sbStatus,sbVer);
  sidebar.append(sbHead,views,sideFoot);

  const mainCol=document.createElement('div');mainCol.id='hc415-main';
  const editorHead=document.createElement('div');editorHead.id='hc415-editor-head';
  const tabStrip=document.createElement('div');tabStrip.id='hc415-tabs';tabStrip.setAttribute('role','tablist');tabStrip.setAttribute('aria-label','Open files');
  const editorTools=document.createElement('div');editorTools.className='hc415-editor-tools';
  editorHead.append(tabStrip,editorTools);
  const bottom=document.createElement('div');bottom.id='hc415-bottom';
  const bottomTabs=document.createElement('div');bottomTabs.id='hc415-bottom-tabs';bottomTabs.setAttribute('role','tablist');
  const bottomBody=document.createElement('div');bottomBody.id='hc415-bottom-body';
  const bottomPaneTerminal=document.createElement('div');bottomPaneTerminal.className='hc415-bottom-pane';bottomPaneTerminal.id='hc415-pane-terminal';
  const bottomPaneChanges=document.createElement('div');bottomPaneChanges.className='hc415-bottom-pane';bottomPaneChanges.id='hc415-pane-changes';
  const bottomPaneOutput=document.createElement('div');bottomPaneOutput.className='hc415-bottom-pane';bottomPaneOutput.id='hc415-pane-output';
  // Spec §4 diagram + §6.452-456: Terminal | Changes | Output. Terminal is an
  // HONEST empty state — the backend exposes files/sync/review but no exec/PTY
  // endpoint, and the spec scopes terminals to "where supported by the existing
  // system" (§7: terminals are proposed enhancements, not confirmed
  // capabilities). Output is a real log stream: every status line plus agent
  // task events, timestamped, capped.
  const BOTTOM_TABS:[string,string][]=[['terminal','Terminal'],['changes','Changes'],['output','Output']];
  const bottomBtns:Record<string,HTMLButtonElement>={};
  for(const [bid,label] of BOTTOM_TABS){
    const b=button(label,'hc415-bottom-tab');b.dataset.pane=bid;b.setAttribute('role','tab');bottomBtns[bid]=b;bottomTabs.append(b);
  }
  const bottomToggle=button('⌄','hc415-icon-btn');bottomToggle.id='hc415-bottom-toggle';bottomToggle.title='Collapse or expand this panel';
  bottomTabs.append(bottomToggle);
  // Terminal pane: WebSocket-connected shell. One PTY per connection.
  const termContainer=document.createElement('div');termContainer.id='hc415-terminal-container';
  const termOutput=document.createElement('pre');termOutput.id='hc415-terminal-output';termOutput.tabIndex=-1;
  termOutput.setAttribute('aria-label','Terminal output');
  const termInputRow=document.createElement('div');termInputRow.id='hc415-terminal-input-row';
  const termPrompt=document.createElement('span');termPrompt.className='hc415-terminal-prompt';termPrompt.textContent='$';
  const termInput=document.createElement('input');termInput.id='hc415-terminal-input';
  termInput.type='text';termInput.spellcheck=false;termInput.autocomplete='off';
  termInput.setAttribute('aria-label','Terminal input');
  termInputRow.append(termPrompt,termInput);
  termContainer.append(termOutput,termInputRow);
  // Terminal WebSocket connection — lazy: connects on first keystroke or tab focus.
  let termWs:WebSocket|null=null;
  let termBuf='';
  function termConnect(){
    if(termWs)return;
    const proto=location.protocol==='https:'?'wss:':'ws:';
    const url=`${proto}//${location.host}/ws/terminal`;
    try{
      const ws=new WebSocket(url);
      ws.onopen=()=>{termWs=ws;termOutput.dataset.connected='true';termBuf='';termInput.disabled=false;termInput.focus()};
      ws.onmessage=(ev:MessageEvent)=>{
        const text=String(ev.data);
        termBuf+=text;
        if(termBuf.length>50000)termBuf=termBuf.slice(-30000);
        // Simple ANSI stripping for display — keep it functional
        const clean=termBuf.replace(/\x1b\[[0-9;]*[a-zA-Z]/g,'')
          .replace(/\x1b\][0-9;]*(\x1b\\|\x07)/g,'')
          .replace(/\x1b[[()][0-9]*/g,'')
          .replace(/\x1b[DEH]/g,'')
          .replace(/\x1b\[[0-9]+[JK]/g,'\n')
          .replace(/\r/g,'');
        termOutput.textContent=clean;
        termOutput.scrollTop=termOutput.scrollHeight;
      };
      ws.onclose=()=>{termWs=null;termInput.disabled=true;termOutput.dataset.connected='';setTimeout(termConnect,3000)};
      ws.onerror=()=>{termWs=null;termInput.disabled=true};
    }catch(e){termInput.disabled=true;termOutput.textContent='[Terminal unavailable: '+String(e)+']'}
  }
  function termSend(){
    const val=termInput.value;
    if(!val||!termWs)return;
    termWs.send(val+'\n');
    termInput.value='';
  }
  termInput.disabled=true;
  termInput.onkeydown=(e:KeyboardEvent)=>{if(e.key==='Enter')termSend()};
  // Connect when the terminal pane becomes visible
  function maybeConnect(){if(!bottomPaneTerminal.hidden&&!termWs)termConnect()}
  bottomPaneTerminal.append(termContainer);
  // are recorded below. Timestamps make "what did the agent just do" answerable.
  const outLabel=document.createElement('div');outLabel.id='hc415-output-label';outLabel.textContent='Agent activity & output';
  const log=document.createElement('ol');log.id='hc415-log';log.setAttribute('aria-label','Activity log');
  bottomPaneOutput.append(outLabel,log);
  bottomBody.append(bottomPaneTerminal,bottomPaneChanges,bottomPaneOutput);
  bottom.append(bottomTabs,bottomBody);
  // the stage keeps only the editor surface: the summary goes to Source control,
  // the diff to the bottom panel, and sync/review become compact editor tools.
  scmBody.append(info);editorTools.append(actions);
  bottomPaneChanges.append(reviewPanel);
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
    activitySettings.setAttribute('aria-pressed',String(which==='settings'));
    viewExplorer.hidden=which!=='explorer';viewSearch.hidden=which!=='search';
    viewScm.hidden=which!=='scm';
    viewSettings.hidden=which!=='settings';
    sbTitle.textContent=which==='explorer'?'EXPLORER':which==='search'?'SEARCH':which==='scm'?'SOURCE CONTROL':'SETTINGS';
    if(which==='search')searchInput.focus();
    if(which==='scm')renderIdeChips();
  }
  for(const [vid] of VIEWS)activityBtns[vid].onclick=()=>setIdeView(vid);
  activitySettings.onclick=()=>setIdeView('settings');
  function setBottomTab(which:string){
    for(const [bid] of BOTTOM_TABS)bottomBtns[bid].setAttribute('aria-selected',String(bid===which));
    bottomPaneTerminal.hidden=which!=='terminal';bottomPaneChanges.hidden=which!=='changes';bottomPaneOutput.hidden=which!=='output';
    if(which==='terminal')maybeConnect();
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
    // D12: content search (debounced) — needs a workspace and ≥2 characters.
    if(contentSearchTimer)clearTimeout(contentSearchTimer);
    searchResults.replaceChildren();
    if(!q||q.length<2||!choice())return;
    contentSearchTimer=window.setTimeout(()=>void contentSearch(q),350);
  };
  let contentSearchTimer:number|undefined;
  async function contentSearch(q:string){
    searchResults.replaceChildren(searchNoteEl('Searching “'+q+'”…'));
    try{
      const data=await api<{query:string;hits:{path:string;line:number;text:string}[];scanned:number;truncated:boolean;skipped_oversize:number}>(
        `/api/projects/${encodeURIComponent(choice())}/search?q=${encodeURIComponent(q)}`);
      if(searchInput.value.trim()!==q)return; // the user moved on
      if(!data.hits.length){
        searchResults.replaceChildren(searchNoteEl(`No content matches “${q}” — ${data.scanned} text file(s) searched`+(data.skipped_oversize?`, ${data.skipped_oversize} too large to search`:'')+'.'));
        return;
      }
      const rows=data.hits.map(h=>{
        const b=button(h.path+':'+h.line,'hc415-search-hit');
        b.title=h.text;
        const snip=document.createElement('span');snip.className='hc415-search-snippet';snip.textContent=h.text;
        b.append(snip);
        b.onclick=()=>void openFile(h.path);
        return b;
      });
      const note=searchNoteEl(data.hits.length+' hit(s) in '+data.scanned+' file(s)'+(data.truncated?' (stopped at the result cap)':'')+(data.skipped_oversize?` — ${data.skipped_oversize} file(s) skipped as too large`:''+'.'));
      searchResults.replaceChildren(note,...rows);
    }catch(e){
      searchResults.replaceChildren(searchNoteEl('Search unavailable: '+errText(e)));
    }
  }
  function searchNoteEl(text:string){const d=document.createElement('div');d.className='hc415-tree-note';d.textContent=text;return d}

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
  // HA-043: Recent Workspaces — an MRU list at the TOP of the dialog (last ~5
  // opened workspaces, localStorage-persisted); clicking one selects it.
  const RECENT_KEY='hermes-life-recent-workspaces';
  const wsRecent=document.createElement('div');wsRecent.id='hc415-ws-recent';
  const wsRecentHead=document.createElement('h4');wsRecentHead.textContent='Recent Workspaces';
  const wsRecentList=document.createElement('div');wsRecentList.id='hc415-ws-recent-list';
  wsRecent.append(wsRecentHead,wsRecentList);
  wsSelect.insertBefore(wsRecent,wsList);
  function recentList():string[]{
    try{const v=JSON.parse(localStorage.getItem(RECENT_KEY)||'[]') as unknown;return Array.isArray(v)?v.filter((x):x is string=>typeof x==='string').slice(0,5):[]}catch{return[]}}
  function rememberRecent(name:string):void{
    if(!name)return;
    const list=[name,...recentList().filter(n=>n!==name)].slice(0,5);
    try{localStorage.setItem(RECENT_KEY,JSON.stringify(list))}catch{/* storage unavailable */}
  }
  function renderRecent():void{
    const names=recentList();
    wsRecent.hidden=!names.length;
    wsRecentList.replaceChildren(...names.map(n=>{
      const b=button(n,'hc415-ws-recent-item');b.title='Open workspace '+n;
      b.onclick=()=>{closeWsSelect();if(choice()!==n)selectProject(n)};
      return b}));
  }
  // The overlay covers the PROJECT workspace (#project-focus-host carries
  // position:relative, the same containing-block role #hc-panel had before
  // this dialog was moved out of the chat panel). The Project workspace owns
  // its own workspace selector — it is NOT a child of the chat panel.
  (projectSlot||panel).append(wsSelect);

  // PROJECT TAB mount: the rail and the stage fill #project-focus-host, the
  // chat's own host keeps #hermes-chat-root — one workspace, two tabs.
  const projectHost=document.getElementById('project-focus-host');
  const view=document.createElement('div');view.id='hc415-project-view';
  stage.append(sbPreviewWrap);
  view.append(activity,sidebar,mainCol);
  // D13-3: resizable explorer sidebar — a drag grip that resizes the view's
  // grid column, width persisted per browser.
  const sidebarGrip=document.createElement('div');sidebarGrip.id='hc415-sidebar-grip';
  sidebarGrip.title='Drag to resize the explorer sidebar';sidebarGrip.setAttribute('role','separator');
  sidebarGrip.setAttribute('aria-orientation','vertical');
  sidebar.after(sidebarGrip);
  const SIDEBAR_W_KEY='hermes-life-ide-sidebar-w';
  const applySidebarW=(w:number)=>{view.style.gridTemplateColumns=`48px ${Math.min(640,Math.max(180,w))}px minmax(0,1fr)`};
  try{const w=Number(localStorage.getItem(SIDEBAR_W_KEY));if(Number.isFinite(w)&&w>=180&&w<=640)applySidebarW(w)}catch{}
  sidebarGrip.addEventListener('pointerdown',(e)=>{
    e.preventDefault();
    const startX=e.clientX,startW=sidebar.getBoundingClientRect().width;
    const move=(ev:PointerEvent)=>applySidebarW(startW+(ev.clientX-startX));
    const up=(ev:PointerEvent)=>{
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);
      const w=Math.min(640,Math.max(180,startW+(ev.clientX-startX)));
      try{localStorage.setItem(SIDEBAR_W_KEY,String(w))}catch{/* storage unavailable */}
    };
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
  });
  // HA-042: resizable bottom panel — a drag grip ABOVE the bottom tabs, modelled
  // on the sidebar grip; the height persists per browser.
  const bottomGrip=document.createElement('div');bottomGrip.id='hc415-bottom-grip';
  bottomGrip.title='Drag to resize the bottom panel';bottomGrip.setAttribute('role','separator');
  bottomGrip.setAttribute('aria-orientation','horizontal');
  bottom.insertBefore(bottomGrip,bottomTabs);
  const BOTTOM_H_KEY='hermes-life-ide-bottom-h';
  const applyBottomH=(h:number)=>{bottom.style.flex='0 0 '+Math.min(720,Math.max(80,h))+'px'};
  try{const h=Number(localStorage.getItem(BOTTOM_H_KEY));if(Number.isFinite(h)&&h>=80&&h<=720)applyBottomH(h)}catch{}
  bottomGrip.addEventListener('pointerdown',(e)=>{
    e.preventDefault();
    const startY=e.clientY,startH=bottom.getBoundingClientRect().height;
    const move=(ev:PointerEvent)=>applyBottomH(startH-(ev.clientY-startY));
    const up=(ev:PointerEvent)=>{
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);
      const h=Math.min(720,Math.max(80,startH-(ev.clientY-startY)));
      try{localStorage.setItem(BOTTOM_H_KEY,String(h))}catch{/* storage unavailable */}
    };
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
  });
  // D13-6: read-only split pane — a second document visible beside the editor
  // while it stays writable. Opened from the context menu; closed from its own ✕.
  const splitPane=document.createElement('section');splitPane.id='hc415-split';splitPane.hidden=true;
  const splitHead=document.createElement('header');splitHead.className='hc415-split-head';
  const splitPath=document.createElement('code');splitPath.className='hc415-split-path';
  const splitClose=button('×','hc415-split-close');splitClose.title='Close the split pane';splitClose.setAttribute('aria-label','Close split pane');
  const splitBody=document.createElement('pre');splitBody.id='hc415-split-body';splitBody.tabIndex=0;
  splitHead.append(splitPath,splitClose);splitPane.append(splitHead,splitBody);
  splitClose.onclick=()=>{splitPane.hidden=true;splitBody.textContent='';splitPath.textContent=''};
  mainCol.insertBefore(splitPane,bottom);
  (projectHost||panel).append(view);
  // Spec phase 2 §9: ONE application-wide status bar. The workspace row is not a
  // second bar — it is reparented into the app status strip so workspace, repo,
  // sync and agent state all report from one place. Reparenting the live element
  // (not rebuilding it) keeps every handler and keeps one source of truth.
  document.getElementById('status-ide-slot')?.append(ideStatus);

  /** The in-IDE status bar: workspace · version · files. Derived from the
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
    let workspace='General chat',version='no version',files='no tree',synced='no workspace selected';
    try{const p=current();if(p){workspace=p.name;synced=p.remote_path?'work machine synced':'work machine unsynced'}}catch{}
    try{version=branchLabel()?('branch '+branchLabel()+(hostVer?.dirty?' (dirty)':'')):(sbVer.textContent||'no version')}catch{}
    try{files=treeData?treeData.entries.length+' files':'no tree'}catch{}
    // HA-011: the mode is composer-owned per conversation scope — the bar
    // summarises the IDE workspace, not chat state.
    const chips:[string,string][]=[['workspace',workspace],['version',version],['files',files]];
    ideChips.replaceChildren(...chips.map(([k,v])=>{
      const s=document.createElement('span');s.className='hc415-chip';s.dataset.kind=k;s.textContent=v;return s;
    }));
    ideActions.textContent=synced;
  }
  bottom.setAttribute('data-collapsed',''); // default collapsed — the user expands it when needed
  setIdeView('explorer');setBottomTab('changes');
  let projectTab=false;
  // Chat and Projects are two EQUAL top-level workspaces now (user brief
  // hermashauigoalexplained.md §2/§3) — Projects is NOT a pane inside the chat.
  // Each has its own workspace section, so switching is NAVIGATION owned by the
  // nav rail and the header; this no longer shows or hides sibling hosts.
  function showProjectTab(on:boolean){
    projectTab=on;
    if(!on)return;
    window.dispatchEvent(new CustomEvent('hermes:open-projects'));
    if(!choice())void load();
    void refreshFileContext();
  }
  // Tab button event listeners removed — the DOM tab buttons no longer exist.

  // File-context sidebar toggles show the project view; the one presentation
  // is the IDE workspace (phase 1 un-nests the IDE from the chat/project tabs).
  function showSidebar(open:boolean){if(open)showProjectTab(true)}

  let projects:Project[]=[];let selected=(localStorage.getItem(PROJECT_GLOBAL_KEY)||projectByConversation()[conversationIdNow()]||localStorage.getItem(key)||'');let activeReview:Review|null=null;let busy=false;
  function choice(){return picker.value}
  function current(){return projects.find(p=>p.name===choice())}
  function clearReview(){activeReview=null;confirmation.value='';reviewPanel.hidden=true;reviewMeta.textContent='';diff.textContent=''}
  /** One timestamped line in the Output pane's log; capped so a long session
   *  can't grow the DOM without bound. */
  function logLine(s:string){
    const li=document.createElement('li');const t=document.createElement('time');
    t.textContent=new Date().toTimeString().slice(0,8);
    li.append(t,document.createTextNode(s));
    log.append(li);
    while(log.childElementCount>200)log.firstElementChild?.remove();
    log.scrollTop=log.scrollHeight;
  }
  function setStatus(s:string){status.textContent=s;try{logLine(s)}catch{}}
  function renderHint(){const p=current();info.textContent=p?`${p.name} · ${p.remote_path||'Work-machine workspace not synchronized'}`:'Select a registered project to synchronize or review changes.';sbVer.textContent=choice()?verLabel():'';renderIdeChips()}
  function setBusy(value:boolean){busy=value;refresh.disabled=value;sync.disabled=value;reviewBtn.disabled=value;applyBtn.disabled=value;regBtn.disabled=value;createBtn.disabled=value}
  function openDrawer(){showProjectTab(true)}
  // Phase 1: no drawer header or tab bar — openDrawer activates the project view directly.
  async function load(){try{
    const data=await api<{projects:Project[]}>('/api/projects');projects=data.projects;
    picker.replaceChildren(new Option('General chat',''));for(const p of projects)picker.append(new Option(p.name,p.name));
    picker.value=projects.some(p=>p.name===selected)?selected:'';selected=choice();renderHint();renderSelector();renderProjectList();
    if(!projects.length)setStatus('No projects registered — pick one below under "Register a project directory".');
  }catch(e){setStatus('Project list unavailable: '+errText(e));info.textContent='Connection error'}
  void loadRoots();}
  // The Project workspace owns its own selection (PROJECT_GLOBAL_KEY). The
  // conversation→project map is also written so @project references in chat
  // know which project the user is working on — but the conversation map is
  // never the authority for what the Projects tab shows.
  // D3/HA-005: an explicit open-file request (from chat) outranks tab restore.
  // Declared here because selectProject runs at module init (line ~654) — a
  // later `let` would be a temporal-dead-zone crash on that path.
  let pendingOpen:string|null=null;
  function selectProject(name:string,fromOpenFile=false){
    picker.value=name;selected=choice();
    rememberRecent(name); // HA-043: Recent Workspaces (MRU) records opened workspaces
    // HA-008: the conversation→project scope map is written ONLY by the
    // composer's explicit scope chip (chat-attach.ts) — an IDE selection must
    // never silently re-scope a conversation (spec §4.4). A USER-driven
    // selection also drops a stale open-file request; the open-file handler's
    // own call (fromOpenFile=true) keeps it.
    if(!fromOpenFile)pendingOpen=null;
    localStorage.setItem(PROJECT_GLOBAL_KEY,name);
    clearReview();renderHint();
    setStatus(selected?'Selected '+selected:'General chat');void refreshFileContext().then(restoreOpenDocs);
    renderStageEmpty();
    renderSelector();
  }
  picker.onchange=()=>selectProject(choice());
  // The Project workspace owns its own selection — independent of which
  // conversation is active. The conversation→project map is written by
  // selectProject() so @project references in chat work, but switching
  // conversations never changes what the Projects tab shows. The user's
  // project choice in the IDE stays until they explicitly change it.
  window.addEventListener('hc-conversation-changed',()=>{
    // no-op: the Projects tab keeps its independent selection
  });
  {const wanted=localStorage.getItem(PROJECT_GLOBAL_KEY)||'';if(wanted&&wanted!==choice())selectProject(wanted);}
  renderStageEmpty();
  // Live link to chat (user brief, 2026-11-25): when a chat task finishes, a
  // file it edited must appear in an OPEN editor the way a CLI edit does — the
  // editor reloads through the normal open path when the file's mtime moved.
  // An in-progress edit is never clobbered, and the tree refreshes too so new
  // files the task created show up without a manual reload.
  window.addEventListener('hc-task-finished',()=>{
    logLine('Agent task finished — refreshing workspace state');
    const state=openFileState;const name=choice();
    if(!name)return;
    void load();
    if(!state)return;
    void (async()=>{
      try{
        const f=await api<FileData>(`/api/projects/${encodeURIComponent(name)}/file?path=${encodeURIComponent(state.path)}&preview=1`);
        if(!f.mtime||openFileState?.path!==state.path)return;
        if(Math.abs(f.mtime-(state.mtime||0))<=0.001)return;
        if(!editorLib.hidden)return; // a human is editing in the editor lib — never pull the file from under them
        void openFile(state.path);
      }catch{/* the file may have been deleted by the task; the tree refresh above reflects it */}
    })();
  });
  // ── D1: live file-change events (spec §4.4 "shared file change events") ────
  // Subscribes to the EXISTING `hermes:event` fan-out (main.v2 dispatches one
  // DOM event per stream record). Replayed history is tagged `historical` and
  // IGNORED: a page-load replay must never trigger refresh loops — the tree
  // already loads fresh on mount. The handler never invents state: it re-reads
  // the tree / file through the normal fetch paths.
  let treeRefreshTimer:number|undefined;
  window.addEventListener('hermes:event',((ev:Event)=>{
    const evt=(ev as CustomEvent<{type?:string;payload?:{project?:string;path?:string;change?:string};historical?:boolean}>).detail;
    if(!evt||evt.type!=='file.changed'||evt.historical)return;
    const p=evt.payload||{};
    const name=choice();
    // Project-scoped events: refresh the tree (debounced — a write burst is one
    // repaint). Uploads carry project:'' and only matter if the path matches an
    // open doc (it cannot — uploads live outside projects).
    if(p.project===name&&name){
      if(treeRefreshTimer)clearTimeout(treeRefreshTimer);
      treeRefreshTimer=window.setTimeout(()=>{void loadTree()},300);
    }
    const st=openFileState;
    if(!p.path||!openDocs.includes(p.path))return;
    const isActive=st?.path===p.path;
    if(p.change==='deleted'){
      logLine(p.path+' was deleted on the host — closing its tab');
      const i=openDocs.indexOf(p.path);
      if(i>=0)openDocs.splice(i,1);
      dirtyDocs.delete(p.path);conflictDocs.delete(p.path);delete dirtyBuffers[p.path];
      persistOpenDocs();
      if(isActive)closePreview();else renderTabs();
      return;
    }
    if(dirtyDocs.has(p.path)){
      // D4/HA-013: NEVER pull a file out from under unsaved edits — the
      // conflict flag covers ANY open dirty doc, not just the active one.
      if(!conflictDocs.has(p.path)){conflictDocs.add(p.path);renderTabs()}
      logLine('Conflict: '+p.path+' changed on the host while you have unsaved edits — save will refuse until you reload');
      setStatus('Conflict: '+p.path+' changed on the host while you have unsaved edits. Reload or save carefully — Review changes shows the host diff.');
      return;
    }
    if(isActive&&(editorLib.hidden||!projectEditor.hasFocus()))void openFile(p.path);
  }) as EventListener);
  // ── D3: chat file links open the right resource in Projects ────────────────
  // A chat-side file reference (absolute host path, or a workspace-relative
  // path from the attachment header) resolves to a registered project by
  // host_path prefix; the workspace switches and the file opens through the
  // normal open path. An unresolvable path opens Projects and SAYS SO — never
  // a fabricated selection.
  window.addEventListener('hermes:projects:open-file',((ev:Event)=>{
    const raw=(ev as CustomEvent<{path?:string}>).detail?.path;
    const path=typeof raw==='string'?raw.trim():'';
    if(!path)return;
    const absolute=path.startsWith('/');
    let target:string|null=null;
    if(absolute){
      for(const pr of projects){
        const root=pr.host_path.replace(/\/+$/,'');
        if(path===root||path.startsWith(root+'/')){target=pr.name;break}
      }
    }
    window.dispatchEvent(new CustomEvent('hermes:open-projects'));
    if(!absolute){
      // Workspace-relative (the attachment header's form): the CURRENT workspace.
      if(!choice())return setStatus('Cannot open '+path+' — no workspace is selected in Projects');
      // HA-005: open DIRECTLY — setting pendingOpen here had no consumer on
      // this path (restoreOpenDocs only runs after a project switch/mount).
      void openFile(path);
      return;
    }
    if(!target)return setStatus(path+' is not inside a registered workspace — register its directory to open it here');
    const root=projects.find(pr=>pr.name===target)!.host_path.replace(/\/+$/,'');
    const rel=path.slice(root.length+1);
    if(choice()!==target){
      // Cross-project: the workspace context must load first — selectProject
      // chains restoreOpenDocs, which consumes pendingOpen before anything
      // else (HA-005), so the file opens once the workspace is live.
      pendingOpen=rel;
      selectProject(target,true);
      return;
    }
    void openFile(rel);
  }) as EventListener);
  // Native "Open Folder" via the File System Access API. Picks a directory from
  // the user's machine, converts its name to a valid project slug, and pre-fills
  // the registration form so the user only needs to provide the server path.
  async function nativeOpenFolder(){
    try{
      let dirName='';
      // Use showDirectoryPicker() if available (modern browsers)
      if('showDirectoryPicker' in window){
        const handle=await (window as any).showDirectoryPicker();
        dirName=handle.name;
      }else{
        // Fallback: webkitdirectory input
        const input=document.createElement('input');
        input.type='file';input.webkitdirectory=true;input.style.display='none';
        document.body.append(input);
        const files=await new Promise<FileList>((res,rej)=>{
          input.onchange=()=>{if(input.files?.length)res(input.files);else rej(new Error('No folder selected'));};
          input.click();
        });
        document.body.removeChild(input);
        // Extract directory name from the first file's webkitRelativePath
        const first=files[0];
        dirName=first.webkitRelativePath.split('/')[0];
      }
      // Convert to a valid project slug
      const slug=slugify(dirName)||'my-project';
      // Pre-fill the registration form and open the workspace dialog
      regName.value=slug;
      regPath.value='';
      chosenRoot='';
      // Highlight the matching root candidate if one exists
      for(const o of Array.from(regList.children) as HTMLElement[]){
        o.classList.toggle('hc415-chosen',false);
      }
      openWsSelect();
      regName.focus();
      setStatus('Pick a server path for "'+slug+'" — or choose from the list, then click Register');
    }catch(e){
      if(String(e).includes('abort')||String(e).includes('AbortError')||String(e).includes('cancel'))return;
      setStatus('Folder picker: '+errText(e));
      // Fallback: open the workspace dialog directly
      openWsSelect();
    }
  }

  // HL-CHAT-006 2.1: workspace selector overlay behaviour.
  function renderSelectorLabel(){
    const p=current();
    selectorBtn.textContent='Project: '+(p?p.name:'General chat');
    selectorBtn.classList.toggle('hc415-ws-active',!!p);
  }
  function renderSelector(){
    renderSelectorLabel();
    renderRecent();
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
  type TreeData={root:string;count:number;truncated:boolean;entries:TreeEntry[];host_version?:{commit:string;dirty:boolean}|null;scm?:Record<string,string>};
  type FileData={path:string;size:number;mtime?:number;mode:string;truncated:boolean;binary?:boolean;image?:boolean;content_base64?:string;content:string;host_version?:{commit:string;dirty:boolean}|null};
  const ATT_KEY='hermes-life-chat-attachments';
  let treeData:TreeData|null=null;let attached=new Set<string>();let expanded=new Set<string>();
  renderTree(); // show empty-state guidance ("No workspace selected" + Open Folder) in the file tree
  let hostVer:{commit:string;dirty:boolean;branch?:string}|null=null;
  function verLabel(){return hostVer?`host @ ${hostVer.commit} (${hostVer.dirty?'dirty':'clean'})`:'host version unknown'}
  // D13: the status/version chips show branch@commit when git reports one.
  function branchLabel(){return hostVer?.branch?`${hostVer.branch}@${hostVer.commit}`:hostVer?hostVer.commit:''}
  let attachMap:Record<string,string[]>={};
  try{attachMap=JSON.parse(localStorage.getItem(ATT_KEY)||'{}') as Record<string,string[]>}catch{attachMap={}}
  // HA-011: attachment state renders only in context (row toggles + preview-head
  // toggle), so there is no meter to repaint — just the version label and chips.
  function loadAttached(){attached=new Set(attachMap[choice()]||[]);renderHint()}
  function saveAttached(){const name=choice();if(name){attachMap[name]=[...attached];localStorage.setItem(ATT_KEY,JSON.stringify(attachMap))}renderHint()}
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
    // D13-2: per-file source-control decoration (M = modified, U = untracked)
    // from the tree payload's git-status map — presentation only.
    const scm=treeData?.scm?.[node.path];
    if(scm)row.dataset.scm=scm;
    // D13-5: every row is a drag source; directory rows are drop targets that
    // move the dragged entry there through the D2 move endpoint.
    row.draggable=true;
    row.addEventListener('dragstart',(e:DragEvent)=>{e.dataTransfer?.setData('text/hermes-path',node.path);e.dataTransfer&&(e.dataTransfer.effectAllowed='move')});
    const icon=document.createElement('span');icon.className='hc415-tree-icon';
    icon.textContent=node.isDir?(expanded.has(node.path)?'▾':'▸'):fileGlyph(node.path);
    const label=document.createElement('span');label.className='hc415-tree-label';label.textContent=node.name;
    row.append(icon,label);
    if(scm){const mark=document.createElement('span');mark.className='hc415-scm-mark';mark.textContent=scm;mark.title=scm==='M'?'Modified (uncommitted)':'Untracked';row.append(mark)}
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
      // D13-5: dropping onto a directory moves the dragged entry into it.
      row.addEventListener('dragover',(e:DragEvent)=>{e.preventDefault();e.dataTransfer&&(e.dataTransfer.dropEffect='move');row.classList.add('hc415-drop-target')});
      row.addEventListener('dragleave',()=>row.classList.remove('hc415-drop-target'));
      row.addEventListener('drop',(e:DragEvent)=>{
        e.preventDefault();e.stopPropagation();row.classList.remove('hc415-drop-target');
        const src=e.dataTransfer?.getData('text/hermes-path');
        if(!src||src===node.path||src.startsWith(node.path+'/'))return;
        void moveToDir(src,node.path);
      });
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
      // D2: the dir menu is also the create door — siblings land inside it.
      items.push(item('New file here…',()=>void newEntry(path,'file')));
      items.push(item('New folder here…',()=>void newEntry(path,'folder')));
      items.push(item('Rename / Move…',()=>void renameEntry(path)));
    }else{
      items.push(item('Open',()=>{void openFile(path)}));
      items.push(item(attached.has(path)?'Detach':'Attach',()=>{void toggleFile(path)}));
      // D2: create as a sibling of this file; rename/move covers the same-dir case.
      items.push(item('New file…',()=>void newEntry(parentOf(path),'file')));
      items.push(item('New folder…',()=>void newEntry(parentOf(path),'folder')));
      items.push(item('Rename / Move…',()=>void renameEntry(path)));
      // D13-6: a read-only second pane beside the writable editor.
      items.push(item('Open in split view',()=>void openSplit(path)));
      // D9: the file reference lands in the chat composer as a chip — the
      // composer decides when to send, never this menu.
      items.push(item('Send file reference to chat',()=>{
        // HA-045: the worker contract is absolute host paths — resolve the
        // tree-relative path against the workspace before chipping it.
        const w=current();const abs=w&&w.host_path?w.host_path.replace(/\/+$/,'')+'/'+path:path;
        addExternalRef(abs);setStatus(abs+' attached to the chat composer — review and send there')}));
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
  // ── D2: create / rename / move (context menu + prompt dialog) ──────────────
  // The explorer could only delete; the spec's §4.3 "creation, rename/move/
  // delete" needs the other half. The server routes (POST /{name}/dir, POST
  // /{name}/move) enforce the same containment + denylist as every write; the
  // target is never silently overwritten.
  function promptDialog(title:string,value:string):Promise<string|null>{
    return new Promise(resolve=>{
      const dlg=document.createElement('dialog');dlg.className='hc415-prompt';
      dlg.innerHTML='<form method="dialog"><h3></h3><input type="text" spellcheck="false" autocomplete="off"><p class="hc415-prompt-err" role="alert"></p><div class="hc415-prompt-row"><button type="button" class="hc415-prompt-cancel">Cancel</button><button type="submit" class="hc415-prompt-ok">OK</button></div></form>';
      (dlg.querySelector('h3') as HTMLElement).textContent=title;
      const input=dlg.querySelector('input') as HTMLInputElement;input.value=value;input.title='Workspace-relative path';
      (dlg.querySelector('.hc415-prompt-cancel') as HTMLButtonElement).onclick=()=>dlg.close();
      dlg.addEventListener('close',()=>{dlg.remove();resolve(null)});
      (dlg.querySelector('form') as HTMLFormElement).addEventListener('submit',(ev)=>{
        ev.preventDefault();
        const v=input.value.trim();
        if(!v)return;
        dlg.close();dlg.remove();resolve(v);
      });
      document.body.append(dlg);dlg.showModal();input.select();
    });
  }
  const parentOf=(p:string)=>p.includes('/')?p.slice(0,p.lastIndexOf('/')):'';
  const joinPath=(dir:string,name:string)=>dir?dir+'/'+name:name;
  /** After a rename/move/delete, no client state may keep pointing at the old
   *  path: open tabs under it close, dirty marks drop, attachments prune. */
  function pruneUnder(prefix:string){
    const hit=(p:string)=>p===prefix||p.startsWith(prefix+'/');
    for(const d of [...openDocs])if(hit(d)){dirtyDocs.delete(d);openDocs.splice(openDocs.indexOf(d),1)}
    for(const a of [...attached])if(hit(a))attached.delete(a);
    saveAttached();persistOpenDocs();
    if(openFileState&&hit(openFileState.path))closePreview();
    else renderTabs();
  }
  async function newEntry(dir:string,kind:'file'|'folder'){
    const name=await promptDialog((kind==='file'?'New file':'New folder')+(dir?' in '+dir:' in the workspace root'),'');
    if(!name)return;
    const p=joinPath(dir,name);
    try{
      if(kind==='file')await putFile(p,'');
      else await post(`/api/projects/${encodeURIComponent(choice())}/dir`,{path:p});
      await loadTree();
      if(kind==='file')void openFile(p); // a new file opens ready to edit
      setStatus('Created '+p);
    }catch(e){setStatus(errText(e))}
  }
  async function renameEntry(path:string){
    const to=await promptDialog('Rename or move '+path+' to:',path);
    if(!to||to===path)return;
    try{
      await post(`/api/projects/${encodeURIComponent(choice())}/move`,{source:path,target:to});
      pruneUnder(path);
      await loadTree();
      setStatus('Moved '+path+' → '+to);
    }catch(e){setStatus(errText(e))}
  }
  /** D13-5: drag-and-drop move — drop on a directory row moves the entry there
   *  through the SAME endpoint and pruning rules as Rename/Move. */
  async function moveToDir(path:string,dir:string){
    const name=path.split('/').pop()||path;
    const to=joinPath(dir,name);
    if(to===path)return;
    try{
      await post(`/api/projects/${encodeURIComponent(choice())}/move`,{source:path,target:to});
      pruneUnder(path);
      await loadTree();
      setStatus('Moved '+path+' → '+to);
    }catch(e){setStatus(errText(e))}
  }
  /** D13-6: open a document in the read-only split pane. */
  async function openSplit(path:string){
    if(!choice())return setStatus('Select a project first');
    try{
      const f=await api<FileData>(`/api/projects/${encodeURIComponent(choice())}/file?path=${encodeURIComponent(path)}&preview=1`);
      splitBody.textContent=f.binary?'Binary file — not shown in the split pane':f.content+(f.truncated?'\n\n[Truncated preview — the full file opens writable via Open.]':'');
      splitPath.textContent=path;
      splitPane.hidden=false;
      setStatus('Split view: '+path+' (read-only)');
    }catch(e){setStatus(errText(e))}
  }
  function renderTree(){
    if(!treeData){
      // With no workspace the explorer has nothing to list, so it offers the ONE
      // action that resolves it (the brief's "Open Folder") instead of a dead
      // end. This is also where the workspace dialog earns its keep: registering
      // a directory is now a door here, not a permanent wall of buttons.
      sbTree.replaceChildren(treeNote(choice()?'Loading file tree…':'No workspace selected.'));
      if(!choice()){const cta=button('Open Folder…','');cta.id='hc415-open-folder';cta.title='Choose a registered project, register a directory, or create one';cta.onclick=nativeOpenFolder;sbTree.append(cta)}
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
    try{treeData=await api<TreeData>(`/api/projects/${encodeURIComponent(name)}/tree`);hostVer=treeData.host_version||null;renderTree();renderHint();if(treeData.count)setStatus(`Loaded ${treeData.count} files from ${name} — ${verLabel()}`)}
    catch(e){resetTree();setStatus('File tree unavailable: '+errText(e))}
  }
  async function refreshFileContext(){loadAttached();await loadTree()}
  // --- write path: in-place edit and upload (PUT /api/projects/{name}/file) ---
  const MAX_UPLOAD_BYTES=1_000_000; // mirrors the server's MAX_WRITE_BYTES
  async function putFile(path:string,content:string,expected_mtime?:number){
    return await api<{path:string;size:number;mtime:number;created:boolean;host_version:{commit:string;dirty:boolean;branch?:string}|null}>(
      `/api/projects/${encodeURIComponent(choice())}/file`,
      {method:'PUT',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({path,content,...(expected_mtime===undefined?{}:{expected_mtime})})});
  }
  let openFileState:{path:string;mtime?:number;image?:boolean}|null=null;
  // The editor's open-document LIST. `openFileState` stays "the active document"
  // so every existing reader (preview, save, attach toggle) keeps working
  // unchanged; the list is what the tab strip renders. One source of truth each:
  // the list is the model, the strip is its view.
  let openDocs:string[]=[];
  // D4: unsaved-edit tracking. A doc enters the set on the first USER keystroke
  // (projectEditor.onChange — programmatic set() never marks dirty) and leaves
  // it on Save (the edit became a host write) or Cancel (the edit is discarded).
  // The tab strip shows the dot; external-change reloads refuse dirty docs.
  const dirtyDocs=new Set<string>();
  // D1: docs an external change collided with (changed on host while dirty) —
  // cleared when the user saves or reloads the doc.
  const conflictDocs=new Set<string>();
  // HA-013: unsaved editor content per path (content + the mtime it was based
  // on). Switching tabs stashes and restores these buffers — unsaved edits are
  // the user's work and are NEVER silently discarded or refetched over.
  const dirtyBuffers:Record<string,{content:string;mtime:number}>={};
  projectEditor.onChange(()=>{
    const p=openFileState?.path;
    if(!p)return;
    if(!dirtyDocs.has(p)){dirtyDocs.add(p);renderTabs()}
  });
  // D5: open tabs + active doc survive a reload. The dirty set deliberately does
  // NOT persist — unsaved CONTENT lives only in the live editor, so claiming a
  // restored tab was dirty would be a lie; §6 preservation across VIEW switches
  // is already covered by the module state surviving the (hidden) DOM.
  const OPEN_DOCS_KEY='hermes-life-project-open-docs';
  // D5: per-doc scroll positions across tab switches (in-memory: the DOM — and
  // with it the scroll surfaces — survives workspace switches; this map only
  // covers the re-fetch a tab switch performs).
  const scrollPos:Record<string,number>={};
  function scrollSurface():HTMLElement|null{
    return editorLib.hidden?sbPreview:(editorLib.querySelector('.cm-scroller') as HTMLElement|null);
  }
  function captureScroll(){const p=openFileState?.path;if(!p)return;const s=scrollSurface();if(s)scrollPos[p]=s.scrollTop}
  function persistOpenDocs(){
    try{localStorage.setItem(OPEN_DOCS_KEY,JSON.stringify({project:choice(),docs:openDocs,active:openFileState?.path||''}))}catch{/* storage unavailable */}
  }
  function restoreOpenDocs(){
    // D3/HA-005: an explicit open-file request (from chat) outranks EVERYTHING —
    // consumed BEFORE the saved-tabs guard so it fires even with no persisted
    // tab state (the old placement sat behind that guard and never ran).
    if(pendingOpen){const t=pendingOpen;pendingOpen=null;void openFile(t);return}
    type SavedDocs={project?:string;docs?:string[];active?:string};
    let saved:SavedDocs|null=null;
    try{saved=JSON.parse(localStorage.getItem(OPEN_DOCS_KEY)||'null') as SavedDocs|null}catch{saved=null}
    if(!saved||!Array.isArray(saved.docs)||saved.project!==choice()||!saved.docs.length)return;
    openDocs=[...saved.docs];
    const active=typeof saved.active==='string'&&openDocs.includes(saved.active)?saved.active:openDocs[0];
    void openFile(active);
  }
  function previewReadMode(){
    if(!openFileState){sbPreviewWrap.hidden=true;return}
    sbEditor.hidden=true;editorLib.hidden=true;sbPreview.hidden=false;
    sbEditBtn.hidden=!!openFileState?.image;sbSaveBtn.hidden=true;sbCancelBtn.hidden=true;sbSendSel.hidden=true;
    paintMdView();
  }
  /** HA-040: .md previews render through the safe renderer by default, with a
   *  Source/Preview toggle; every other file keeps the raw <pre>, and a renderer
   *  failure falls back to the raw text view instead of a blank pane. */
  function paintMdView(){
    const md=/\.md$/i.test(openFileState?.path||'');
    sbViewToggle.hidden=!md;sbViewToggle.textContent=mdRendered?'Source':'Preview';
    sbMd.hidden=true;sbPreview.hidden=false;
    if(!md||!mdRendered)return;
    try{renderHermesMarkdown(sbMd,sbEditor.value);sbMd.hidden=false;sbPreview.hidden=true}
    catch{sbMd.hidden=true;sbPreview.hidden=false}
  }
  sbViewToggle.onclick=()=>{mdRendered=!mdRendered;paintMdView()};
  function closePreview(){openFileState=null;openDocs=[];dirtyDocs.clear();sbPreviewWrap.hidden=true;stageEmpty.hidden=false;renderStageEmpty();renderTabs();persistOpenDocs()}
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
      const dirty=dirtyDocs.has(p);
      const conflict=conflictDocs.has(p);
      const tab=document.createElement('div');tab.className='hc415-tab';tab.dataset.active=String(on);
      if(dirty)tab.dataset.dirty='true';
      if(conflict)tab.dataset.conflict='true';
      tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(on));
      const name=p.split('/').pop()||p;
      const icon=document.createElement('span');icon.className='hc415-tab-icon';icon.textContent=fileGlyph(p);
      const label=document.createElement('span');label.className='hc415-tab-label';
      const mark=conflict?'⚠ ':dirty?'● ':'';
      label.textContent=mark+name;
      label.title=p+(conflict?' — changed on the host while you have unsaved edits':dirty?' — unsaved changes':'');
      tab.title=label.title;
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
   *  which is what makes closing feel like an editor instead of a reset.
   *  D4: a dirty tab asks before its unsaved edits are discarded. */
  function closeDoc(path:string){
    const i=openDocs.indexOf(path);
    if(i<0)return;
    if(dirtyDocs.has(path)&&!window.confirm(path+' has unsaved changes — discard them?'))return;
    dirtyDocs.delete(path);delete dirtyBuffers[path];
    openDocs.splice(i,1);persistOpenDocs();
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
    // HA-013: stash the OUTGOING dirty buffer before anything can replace it —
    // switching tabs must never silently discard unsaved edits.
    const outgoing=openFileState?.path;
    if(outgoing&&dirtyDocs.has(outgoing))dirtyBuffers[outgoing]={content:cmGet(),mtime:openFileState?.mtime??0};
    // HA-013: a dirty buffer IS the document — restore it verbatim instead of
    // re-fetching the host copy over the user's work.
    const stash=dirtyBuffers[path];
    if(dirtyDocs.has(path)&&stash){
      captureScroll();
      if(!openDocs.includes(path))openDocs.push(path);
      persistOpenDocs();
      openFileState={path,mtime:stash.mtime,image:false};
      sbPreviewPath.textContent=path+' · unsaved edits';
      cmSet(stash.content);
      sbPreview.hidden=true;sbEditor.hidden=true;editorLib.hidden=false;sbMd.hidden=true;sbViewToggle.hidden=true;
      sbEditBtn.hidden=true;sbSaveBtn.hidden=false;sbCancelBtn.hidden=false;sbSendSel.hidden=false;
      renderTabs();renderBreadcrumb();
      const want=scrollPos[path];if(want!==undefined){const s=scrollSurface();if(s)s.scrollTop=want}
      setStatus('Restored unsaved edits for '+path+' — not yet saved to the host');
      return;
    }
    setStatus('Opening '+path+'…');
    captureScroll(); // D5: remember where the outgoing doc was scrolled
    // Register in CLICK order, before the fetch: three opens in a row would
    // otherwise list their tabs in whatever order the responses happened to land
    // (measured: opening a, b, c produced tabs b, c, a).
    if(!openDocs.includes(path))openDocs.push(path);
    persistOpenDocs();
    try{
      // preview=1: the stage tolerates big files (truncated honestly) and
      // binary files (metadata only) instead of a 409 wall.
      const f=await api<FileData>(`/api/projects/${encodeURIComponent(choice())}/file?path=${encodeURIComponent(path)}&preview=1&raw=1`);
      if(f.host_version)hostVer=f.host_version;
      openFileState={path:f.path,mtime:f.mtime,image:!!(f.binary&&f.image&&f.content_base64)};
      sbPreviewPath.textContent=f.path+(f.size?' · '+f.size.toLocaleString()+' bytes':'');
      if(f.binary&&f.image&&f.content_base64){
        // D13-4: a real image preview instead of the binary dead end. Same
        // containment-checked read, bytes as a data URL; no fallback text needed.
        const mime=(()=>{const e=(f.path.split('.').pop()||'').toLowerCase();
          return e==='svg'?'image/svg+xml':e==='jpg'?'image/jpeg':e==='ico'?'image/x-icon':'image/'+e})();
        const img=document.createElement('img');img.className='hc415-image-preview';
        img.src=`data:${mime};base64,${f.content_base64}`;img.alt=f.path;
        sbPreview.replaceChildren(img);
        sbEditor.value='';
        sbEditBtn.hidden=true; // an image has nothing to edit as text
      }else if(f.binary){
        sbPreview.textContent='Binary file — not rendered as text. Size '+f.size.toLocaleString()+' bytes. Attach it (mode A workspace access) and Hermesha can inspect it with its own tools.';
        sbEditor.value='';
      }else{
        sbPreview.textContent=f.content;
        sbEditor.value=f.content;
        mdRendered=true; // HA-040: .md opens on the rendered preview by default
        if(f.truncated)sbPreview.textContent+='\n\n[Showing the first 200,000 bytes of '+f.size.toLocaleString()+' — the rest is available to Hermesha through workspace access (mode A), not inline.]';
      }
      sbPreviewWrap.hidden=false;stageEmpty.hidden=true;previewReadMode();syncPreviewAttach();renderTabs();
      const want=scrollPos[path]; // D5: a tab switch restores the doc's last scroll
      if(want!==undefined){const s=scrollSurface();if(s)s.scrollTop=want}
      setStatus('Opened '+f.path+(f.truncated?' (truncated preview)':'')+' — '+verLabel());
    }catch(e){
      // A failed open must not leave a tab behind for a file that never loaded.
      const at=openDocs.indexOf(path);
      if(at>=0&&openFileState?.path!==path)openDocs.splice(at,1);
      renderTabs();setStatus(errText(e));
    }
  }
  sbEditBtn.onclick=()=>{if(!openFileState)return;
    sbPreview.hidden=true;sbEditor.hidden=true;editorLib.hidden=false;sbMd.hidden=true;sbViewToggle.hidden=true;
    cmSet(sbPreview.textContent||'');
    sbEditBtn.hidden=true;sbSaveBtn.hidden=false;sbCancelBtn.hidden=false;sbSendSel.hidden=false;projectEditor.focus()};
  // D9: selection → composer. Appends after any existing draft text and fires
  // `input` so the chat's own autogrow runs; the message is NOT sent.
  sbSendSel.onclick=()=>{
    const sel=projectEditor.selection();
    if(!sel.trim())return setStatus('Nothing selected — select text in the editor first');
    const input=document.getElementById('hc-input') as HTMLTextAreaElement|null;
    if(!input)return setStatus('The chat composer is not available');
    input.value=input.value?(input.value.endsWith('\n')?'':input.value+'\n')+sel:sel;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.focus();
    setStatus('Selection placed in the chat composer — review and send it there');
  };
  sbCancelBtn.onclick=()=>{ // D4: cancel discards the edits, so the doc is clean
    const p=openFileState?.path;
    if(p){
      delete dirtyBuffers[p];
      if(dirtyDocs.delete(p))renderTabs();
      // HA-013: after discarding a restored buffer the host copy is the truth —
      // re-fetch through the normal open path instead of showing stale bytes.
      if(p===openFileState?.path&&!conflictDocs.has(p)){void openFile(p);return}
    }
    previewReadMode();
  };
  sbSaveBtn.onclick=async()=>{
    const state=openFileState;if(!state||!choice())return;
    sbSaveBtn.disabled=true;setStatus('Saving '+state.path+'…');
    try{
      const res=await putFile(state.path,cmGet(),state.mtime);
      if(res.host_version)hostVer=res.host_version;
      openFileState={path:state.path,mtime:res.mtime};
      sbPreview.textContent=cmGet();sbEditor.value=cmGet();
      sbPreviewPath.textContent=state.path+' · '+res.size.toLocaleString()+' bytes';
      dirtyDocs.delete(state.path);conflictDocs.delete(state.path);delete dirtyBuffers[state.path];renderTabs(); // D4: saved = clean
      previewReadMode();persistOpenDocs();
      setStatus('Saved '+state.path+' — uncommitted; Workspace ▸ Review changes shows the diff');
      renderHint();
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
  // The workspace status row reports only while Projects is the workspace on
  // screen (user brief §6: a compact workspace status bar). One signal, sent by
  // the module that owns navigation — not re-derived from the DOM here.
  window.addEventListener('hermes:workspace-shown',((ev:Event)=>{
    const ws=String((ev as CustomEvent<{workspace?:string}>).detail?.workspace||'');
    ideStatus.hidden=ws!=='projects';
  }) as EventListener);
  ideStatus.hidden=true;
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
      // HA-006: refresh even without the event (belt and braces) — clean docs
      // reload through openFile; dirty docs are protected by the buffer stash.
      void load();
      const st=openFileState;
      if(st&&!dirtyDocs.has(st.path))void openFile(st.path);
    }catch(e){clearReview();setStatus(errText(e))}finally{setBusy(false)}
  };
  // Capture runs before the original Hermes chat submit handler. An explicit @project wins.
  // Guard: the chat module (hermes-chat.ts) may not have loaded — the Project tab
  // works independently of the chat composer (§6.370). If form/input aren't available,
  // the @project injection feature is simply skipped.
  if(form&&input)form.addEventListener('submit',(ev)=>{
    if(input.dataset.hc415Injected==='1'){delete input.dataset.hc415Injected;return}
    // HA-008: scope comes from the conversation's EXPLICIT choice (the
    // composer scope chip), never the live IDE selection (spec §4.4).
    const name=projectByConversation()[conversationIdNow()]||'';
    if(!name)return;const value=input.value.trim();if(!value||/^@project\s+\S+/i.test(value))return;
    // SSHFS architecture: /file reads the host path directly; attachment modes do not
    // depend on the (legacy) work-machine sync state. Surface a hint instead of blocking.
    if(!current()?.remote_path)setStatus('Note: work-machine sync not registered — attachments still read the host workspace.');
    const paths=[...attached].sort();
    if(!paths.length){input.value=`@project ${name}\n${input.value}`;return}
    // HL-CHAT-006 2.3: compose per attachment mode, then resubmit.
    ev.preventDefault();ev.stopImmediatePropagation();
    const m=attachMode(name);
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
      for(const h of [...new Set(hits)].sort((a,b)=>a.localeCompare(b))){
        // D3: a consulted file is a real host path — clicking it opens the
        // corresponding resource in Projects (workspace-relative → the current
        // workspace; the Projects side owns the resolution).
        const li=document.createElement('li');
        const open=button(h,'hc415-consulted-link');
        open.title='Open '+h+' in Projects';
        open.onclick=()=>window.dispatchEvent(new CustomEvent('hermes:projects:open-file',{detail:{path:h}}));
        li.append(open);ul.append(li);
      }
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
  if(choice())void refreshFileContext().then(restoreOpenDocs);
  return true;
}
try{
  if(!setup()){
    const observer=new MutationObserver(()=>{try{if(setup())observer.disconnect()}catch(e){(window as any).__hc415err=String((e as Error)?.stack||e)}});observer.observe(document.documentElement,{childList:true,subtree:true});
  }
}catch(e){(window as any).__hc415err=String((e as Error)?.stack||e)}
