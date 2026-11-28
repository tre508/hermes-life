/** Chat composer attachments (user brief hermashauigoalexplained.md §5):
 *  the chat is NOT pre-attached to any project, and attaching a hosted file or
 *  directory does NOT require registering it as a project. The ＋ Attach button
 *  opens a menu (Browse the host…, Images…, Paste image, URL…) and each pick
 *  becomes a chip above the composer; on send the chips compose into a reference
 *  block prepended to the prompt. File/folder chips are PATH references — the
 *  worker has real filesystem reach and reads them with its tools, mirroring the
 *  CLI. The host picker browses through /api/fs/list, which serves only paths
 *  inside the configured permitted roots, so the affordance adds reach beyond a
 *  registered project but never beyond the deployment's boundary.
 *  Images and pasted images upload WITHOUT any registered project (policy
 *  decision 2026-11-27, review.md D6): the server stores them under
 *  <primary permitted root>/hermes-uploads/<date>/ and the returned absolute
 *  host path becomes an ordinary file reference chip.
 *
 *  Contract used by hermes-chat.ts:
 *    initChatAttach()      — wire the menu once (idempotent, safe on re-import)
 *    chatAttachmentBlock() — the block to prepend to the current prompt ('' if none)
 *    clearChatAttachments()— after a successful send.
 */
type Chip={kind:'file'|'folder'|'url';value:string;uploaded?:boolean};

const chips:Chip[]=[];
let wired=false;

function el<T extends HTMLElement>(id:string):T|null{return document.getElementById(id) as T|null}

function renderChips(){
  const host=el('hc-attach-chips');
  if(!host)return;
  if(!chips.length){host.replaceChildren();host.hidden=true;persistChips();return}
  host.hidden=false;
  host.replaceChildren(...chips.map((c,i)=>{
    const chip=document.createElement('span');chip.className='hc-attach-chip';chip.dataset.kind=c.kind;
    if(c.uploaded)chip.dataset.uploaded='true'; // HA-037: provenance is visible
    const glyph=document.createElement('span');glyph.className='hc-attach-chip-glyph';glyph.textContent=c.uploaded?'⬆':c.kind==='file'?'📄':c.kind==='folder'?'📁':'🔗';glyph.setAttribute('aria-hidden','true');
    const label=document.createElement('span');label.className='hc-attach-chip-label';label.textContent=c.value;label.title=c.value+' — click to preview';
    label.addEventListener('click',(e)=>{e.stopPropagation();showChipPreview(c,label)}); // HA-039
    const rm=document.createElement('button');rm.type='button';rm.className='hc-attach-chip-rm';rm.textContent='✕';
    rm.setAttribute('aria-label','Remove '+c.value);rm.title='Remove';
    rm.onclick=(e)=>{e.stopPropagation();chips.splice(i,1);renderChips()};
    chip.append(glyph,label,rm);
    return chip;
  }));
  persistChips(); // HA-038: chips survive reloads and conversation switches
}

/** A small prompt dialog for one path/URL value. Resolves the trimmed value or
 *  null on cancel. A real <dialog> keeps Escape/ focustrap for free. */
function askValue(title:string,placeholder:string,validate?:(v:string)=>string|null):Promise<string|null>{
  return new Promise(resolve=>{
    const dlg=document.createElement('dialog');dlg.className='hc-attach-dialog';
    dlg.innerHTML='<form method="dialog"><h3></h3><input type="text" spellcheck="false" autocomplete="off"><p class="hc-attach-dialog-err" role="alert"></p><div class="hc-attach-dialog-row"><button type="button" class="hc-attach-cancel">Cancel</button><button type="submit" class="hc-attach-ok">Add</button></div></form>';
    (dlg.querySelector('h3') as HTMLElement).textContent=title;
    const input=dlg.querySelector('input') as HTMLInputElement;input.placeholder=placeholder;
    const err=dlg.querySelector('.hc-attach-dialog-err') as HTMLElement;
    const ok=dlg.querySelector('.hc-attach-ok') as HTMLButtonElement;
    (dlg.querySelector('.hc-attach-cancel') as HTMLButtonElement).onclick=()=>{dlg.close()};
    dlg.addEventListener('close',()=>{dlg.remove();resolve(null)});
    (dlg.querySelector('form') as HTMLFormElement).addEventListener('submit',ev=>{
      ev.preventDefault();
      const v=input.value.trim();
      const problem=validate?validate(v):null;
      if(problem){err.textContent=problem;return}
      dlg.removeEventListener('close',closed);
      dlg.close();dlg.remove();resolve(v);
    });
    const closed=()=>{};
    document.body.append(dlg);input.focus();
    ok.dataset.ready='1';
  });
}

/** Absolute-path validation: the worker reads host paths, so a relative guess
 *  would silently reference nothing. Require the leading slash up front. */
const absPath=(v:string)=>v.startsWith('/')?null:'Use an absolute path (starts with /) — the worker reads host paths.';
const nonEmpty=(v:string)=>v?null:'Enter a value.';

async function addUrl(){
  const v=await askValue('Attach a URL','https://…',nonEmpty);
  if(!v)return;
  if(chips.some(c=>c.kind==='url'&&c.value===v))return;
  chips.push({kind:'url',value:v});renderChips();
}

/* ---- §5: the hosted-filesystem picker ---------------------------------------
 *  Registration and attachment are separate operations (user brief §5): a file
 *  or directory can be attached WITHOUT first becoming a project. This browses
 *  the host one level at a time through /api/fs/list, which enforces the same
 *  configured-root containment the project reader uses — so the picker offers
 *  more reach than a registered project, never more than the deployment allows.
 *  Registered projects appear as shortcuts; anything under a permitted root is
 *  reachable by navigating. */

type FsEntry={name:string;path:string;type:'dir'|'file';size?:number|null};
type FsListing={path:string;parent:string|null;roots:string[];entries:FsEntry[]};

async function fsList(path?:string):Promise<FsListing>{
  const r=await fetch('/api/fs/list'+(path?'?path='+encodeURIComponent(path):''));
  if(!r.ok){let detail='';try{detail=(await r.json() as {detail?:string}).detail||''}catch{}
    throw new Error(detail||('HTTP '+r.status))}
  return await r.json() as FsListing;
}

function fmtSize(n?:number|null):string{
  if(typeof n!=='number')return '';
  if(n<1024)return n+' B';
  if(n<1024*1024)return (n/1024).toFixed(1)+' KB';
  return (n/1048576).toFixed(1)+' MB';
}

function shortName(p:string):string{
  const bits=p.split('/').filter(Boolean);
  return bits.length?bits[bits.length-1]:p;
}

function openHostPicker():Promise<void>{
  return new Promise(resolve=>{
    const dlg=document.createElement('dialog');dlg.className='hc-fs-picker';
    dlg.innerHTML='<div class="hc-fs-head"><strong>Attach from the hosted computer</strong>'+
      '<button type="button" class="hc-fs-close" aria-label="Close">✕</button></div>'+
      '<div class="hc-fs-bar"><button type="button" class="hc-fs-up" title="Go up one level">↑ Up</button>'+
      '<input class="hc-fs-path" type="text" spellcheck="false" autocomplete="off" aria-label="Current directory"></div>'+
      '<div class="hc-fs-shortcuts"></div>'+
      '<div class="hc-fs-list" role="listbox" aria-multiselectable="true"></div>'+
      '<p class="hc-fs-note" role="status"></p>'+
      '<div class="hc-fs-foot"><span class="hc-fs-count">Nothing selected</span>'+
      '<button type="button" class="hc-fs-cancel">Cancel</button>'+
      '<button type="button" class="hc-fs-add" disabled>Attach</button></div>';

    const listEl=dlg.querySelector('.hc-fs-list') as HTMLElement;
    const pathEl=dlg.querySelector('.hc-fs-path') as HTMLInputElement;
    const noteEl=dlg.querySelector('.hc-fs-note') as HTMLElement;
    const countEl=dlg.querySelector('.hc-fs-count') as HTMLElement;
    const upEl=dlg.querySelector('.hc-fs-up') as HTMLButtonElement;
    const addEl=dlg.querySelector('.hc-fs-add') as HTMLButtonElement;
    const scEl=dlg.querySelector('.hc-fs-shortcuts') as HTMLElement;
    const picked=new Map<string,'dir'|'file'>();
    let shortcutsBuilt=false;

    const paintPicked=()=>{
      countEl.textContent=picked.size?picked.size+' selected':'Nothing selected';
      addEl.disabled=!picked.size;
      addEl.textContent=picked.size?'Attach '+picked.size:'Attach';
    };

    const mkShortcut=(label:string,path:string,title:string)=>{
      const b=document.createElement('button');b.type='button';b.className='hc-fs-shortcut';
      b.textContent=label;b.title=title;b.onclick=()=>void go(path);return b;
    };

    // Registered projects are a SHORTCUT, not a requirement — the roots are the
    // real boundary, and every directory beneath them is reachable by navigating.
    async function buildShortcuts(roots:string[]){
      const bits=roots.map(r=>mkShortcut('⌂ '+shortName(r),r,'Permitted root: '+r));
      try{
        const r=await fetch('/api/projects');
        if(r.ok){
          const d=await r.json() as {projects?:{name:string;host_path:string}[]};
          for(const p of (d.projects||[]))bits.push(mkShortcut('▣ '+p.name,p.host_path,'Registered project: '+p.host_path));
        }
      }catch{/* shortcuts are optional; the browser still works without them */}
      scEl.replaceChildren(...bits);
    }

    function row(e:FsEntry):HTMLElement{
      const wrap=document.createElement('div');wrap.className='hc-fs-row';wrap.dataset.type=e.type;
      const box=document.createElement('input');box.type='checkbox';box.className='hc-fs-check';
      box.checked=picked.has(e.path);box.setAttribute('aria-label','Select '+e.name);
      const sync=()=>{if(box.checked)picked.set(e.path,e.type);else picked.delete(e.path);paintPicked()};
      box.onchange=sync;
      const glyph=document.createElement('span');glyph.className='hc-fs-glyph';
      glyph.setAttribute('aria-hidden','true');glyph.textContent=e.type==='dir'?'📁':'📄';
      const name=document.createElement('button');name.type='button';name.className='hc-fs-name';
      name.textContent=e.name;
      name.title=e.type==='dir'?'Open '+e.path:'Select '+e.path;
      name.onclick=()=>{if(e.type==='dir')void go(e.path);else{box.checked=!box.checked;sync()}};
      const meta=document.createElement('span');meta.className='hc-fs-meta';
      meta.textContent=e.type==='dir'?'folder':fmtSize(e.size);
      wrap.append(box,glyph,name,meta);
      return wrap;
    }

    async function go(path?:string){
      noteEl.textContent='Loading…';
      try{
        const data=await fsList(path);
        pathEl.value=data.path;
        upEl.disabled=!data.parent;
        upEl.dataset.parent=data.parent||'';
        noteEl.textContent=data.entries.length?'':'This folder has nothing attachable.';
        listEl.replaceChildren(...data.entries.map(row));
        if(!shortcutsBuilt){shortcutsBuilt=true;void buildShortcuts(data.roots)}
      }catch(err){
        // Never fail silently: the refusal reason (outside the permitted roots,
        // not a directory) is the useful part.
        noteEl.textContent='Cannot list that folder — '+(err as Error).message;
      }
    }

    const finish=()=>{if(dlg.open)dlg.close();else{dlg.remove();resolve()}};
    (dlg.querySelector('.hc-fs-close') as HTMLButtonElement).onclick=finish;
    (dlg.querySelector('.hc-fs-cancel') as HTMLButtonElement).onclick=finish;
    dlg.addEventListener('cancel',ev=>{ev.preventDefault();finish()}); // Escape
    dlg.addEventListener('close',()=>{dlg.remove();resolve()});
    upEl.onclick=()=>{const p=upEl.dataset.parent;if(p)void go(p)};
    pathEl.addEventListener('keydown',ev=>{
      if(ev.key!=='Enter')return;
      ev.preventDefault();
      const v=pathEl.value.trim();
      const problem=absPath(v);
      if(problem){noteEl.textContent=problem;return}
      void go(v);
    });
    addEl.onclick=()=>{
      for(const [p,type] of picked){
        const kind:Chip['kind']=type==='dir'?'folder':'file';
        if(!chips.some(c=>c.value===p))chips.push({kind,value:p});
      }
      renderChips();finish();
    };

    paintPicked();
    document.body.append(dlg);dlg.showModal();
    void go();
  });
}

/** Images (file picker or paste) upload WITHOUT any registered project (policy
 *  decision 2026-11-27, review.md D6): the server picks the destination inside
 *  the permitted root (<root>/hermes-uploads/<date>/) and returns the absolute
 *  host path, which becomes an ordinary file reference chip — the worker reads
 *  it with its file tools, exactly like a browsed attachment. No permission is
 *  granted and no task is submitted by uploading. */
async function uploadImage(file:File){
  const buf=await file.arrayBuffer();
  let binary='';const bytes=new Uint8Array(buf);
  // Chunked String.fromCharCode — spread on a large file overflows the call stack.
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  const r=await fetch('/api/fs/upload',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:file.name,content_base64:btoa(binary)})});
  if(!r.ok){let detail='';try{detail=JSON.stringify(await r.json())}catch{}alert('Upload failed: HTTP '+r.status+' '+detail);return}
  const data=await r.json() as {path?:string};
  const stored=data.path||file.name;
  if(!chips.some(c=>c.value===stored)){chips.push({kind:'file',value:stored,uploaded:true});renderChips()}
}

function imageInput(){
  const input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=true;
  input.onchange=()=>{
    const list=input.files;
    if(!list)return;
    for(let i=0;i<list.length;i++)void uploadImage(list[i]);
  };
  input.click();
}

async function pasteImage(){
  // Read whatever image is on the clipboard right now (the menu click already
  // consumed the user's gesture, so the read permission is the only gate).
  const items=navigator.clipboard.read?await navigator.clipboard.read().catch(()=>[]):[];
  for(const item of items)for(const type of item.types)if(type.startsWith('image/')){
    void item.getType(type).then(b=>void uploadImage(new File([b],'pasted-image.'+type.split('/')[1],{type})));
    return;
  }
  alert('No image on the clipboard — use Images… to pick a file instead.');
}

export function initChatAttach(){
  const btn=el('hc-attach');
  if(!btn||wired)return;
  wired=true;
  const menu=document.createElement('div');menu.id='hc-attach-menu';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','Attach to message');
  const item=(label:string,glyph:string,fn:()=>void,attrs:{[k:string]:string}={})=>{
    const b=document.createElement('button');b.type='button';b.className='hc-attach-item';b.setAttribute('role','menuitem');
    const g=document.createElement('span');g.className='hc-attach-item-glyph';g.textContent=glyph;g.setAttribute('aria-hidden','true');
    const l=document.createElement('span');l.textContent=label;
    b.append(g,l);for(const k of Object.keys(attrs))b.setAttribute(k,attrs[k]);
    b.onclick=()=>{close();fn()};
    return b;
  };
  menu.append(
    item('Browse the host…','🗂',()=>void openHostPicker()),
    item('Artifacts…','📦',()=>void openArtifactsPicker()),
    item('Images…','🖼️',imageInput),
    item('Paste image','📋',()=>void pasteImage()),
    item('URL…','🔗',()=>void addUrl()),
  );
  const tip=document.createElement('p');tip.className='hc-attach-tip';tip.textContent='💡 Type @ to reference files inline';
  menu.append(tip);
  btn.after(menu);
  const close=()=>{menu.hidden=true;btn.setAttribute('aria-expanded','false')};
  btn.setAttribute('aria-haspopup','menu');btn.setAttribute('aria-expanded','false');
  btn.onclick=(ev)=>{ev.stopPropagation();const open=!menu.hidden;menu.hidden=open;btn.setAttribute('aria-expanded',String(!open))};
  document.addEventListener('click',(ev)=>{if(!menu.hidden&&!menu.contains(ev.target as Node)&&ev.target!==btn)close()});
  document.addEventListener('keydown',(ev)=>{if(ev.key==='Escape'&&!menu.hidden)close()});
  mountScopeChip();
  mountAttachMode();
  restoreChips(); // HA-038: chips are per-conversation and survive reloads
  window.addEventListener('hc-conversation-changed',()=>restoreChips());
}

/** The block prepended to the prompt on send. File/folder refs are stated as
 *  host paths the worker can open with its tools (mode-A language, without the
 *  project wrapper); URLs are plain references. */
export function chatAttachmentBlock():string{
  if(!chips.length)return '';
  // HA-037: uploads are distinguished from references to original hosted
  // resources (spec §4.2) — both are ordinary host paths for the worker.
  const uploaded=chips.filter(c=>c.kind!=='url'&&c.uploaded).map(c=>c.value);
  const hosted=chips.filter(c=>c.kind!=='url'&&!c.uploaded).map(c=>c.value);
  const urls=chips.filter(c=>c.kind==='url').map(c=>c.value);
  const lines:string[]=[];
  const intro='Their contents are NOT included; read them with your file tools as needed.';
  if(uploaded.length)lines.push('[Uploaded files]\nAttached by the user and stored under hermes-uploads/. '+intro+'\n'+uploaded.map(p=>'- '+p).join('\n'));
  if(hosted.length)lines.push('[Host references]\nThe file(s)/folder(s) below were attached by the user. '+intro+'\n'+hosted.map(p=>'- '+p).join('\n'));
  if(urls.length)lines.push('[Linked references]\n'+urls.map(u=>'- '+u).join('\n'));
  return lines.join('\n\n');
}

export function clearChatAttachments(){chips.length=0;renderChips()}

/** D9 (review.md): Projects-side "Send file reference to chat". The path
 *  becomes an ordinary reference chip above the canonical composer — it is
 *  included with the NEXT message and NEVER sends anything by itself. */
export function addExternalRef(value:string){
  if(!chips.some(c=>c.value===value)){chips.push({kind:'file',value});renderChips()}
}

// ── HA-008: per-conversation @project scope ────────────────────────────────
// The scope is an explicit user choice, remembered per conversation (spec
// §4.4: "switching projects must not silently change a conversation's scope").
// The Projects tab selection NEVER writes this map implicitly — only the chip
// below does. Contract: phase412-project-ui.ts reads getConversationScope()
// when composing the @project line instead of its own live IDE selection.
const SCOPE_MAP_KEY='hermes-life-project-by-conversation';
const SCOPE_CONV_KEY='hermes-life-chat-conversation';

function scopeMap():Record<string,string>{
  try{const p=JSON.parse(localStorage.getItem(SCOPE_MAP_KEY)||'{}');return p&&typeof p==='object'?p as Record<string,string>:{}}catch{return{}}
}
export function getConversationScope():string{
  const cid=localStorage.getItem(SCOPE_CONV_KEY)||'';
  return scopeMap()[cid]||'';
}
export function setConversationScope(slug:string|null):void{
  const cid=localStorage.getItem(SCOPE_CONV_KEY)||'';
  const map=scopeMap();
  if(slug)map[cid]=slug;else delete map[cid];
  try{localStorage.setItem(SCOPE_MAP_KEY,JSON.stringify(map))}catch{/* storage unavailable */}
}

function renderScopeChip():void{
  const sel=el<HTMLSelectElement>('hc-scope');
  if(!sel)return;
  const cur=getConversationScope();
  sel.replaceChildren(new Option('@project: none',''));
  void fetch('/api/projects').then(r=>r.ok?r.json():{projects:[]}).then((d:{projects?:{name:string}[]})=>{
    for(const p of d.projects||[])sel.append(new Option('@project '+p.name,p.name));
    sel.value=(d.projects||[]).some(p=>p.name===cur)?cur:'';
  }).catch(()=>{/* keep the bare chip when the project list is unavailable */});
}

/** HA-008: mount the scope chip into the composer tools row (idempotent). */
export function mountScopeChip():void{
  const tools=document.querySelector('.hc-composer-tools');
  if(!tools)return;
  let chip=el<HTMLSelectElement>('hc-scope');
  if(!chip){
    chip=document.createElement('select');
    chip.id='hc-scope';chip.className='hc-scope';
    chip.title='Project scope for THIS conversation — an explicit choice; switching the Projects tab never changes it';
    tools.append(chip);
  }
  if(!chip.dataset.wired){
    chip.dataset.wired='1';
    chip.addEventListener('change',()=>{setConversationScope(chip.value||null);chip.blur()});
    chip.addEventListener('focus',()=>renderScopeChip());
    window.addEventListener('hc-conversation-changed',()=>renderScopeChip());
  }
  renderScopeChip();
}

// ── HA-038: chips persist per conversation (drafts already did; chips must) ──
const CHIPS_KEY='hermes...hips';
function persistChips():void{
  try{
    const map=JSON.parse(localStorage.getItem(CHIPS_KEY)||'{}') as Record<string,Chip[]>;
    const cid=localStorage.getItem(SCOPE_CONV_KEY)||'';
    if(chips.length)map[cid]=chips.map(c=>({...c}));else delete map[cid];
    localStorage.setItem(CHIPS_KEY,JSON.stringify(map));
  }catch{/* storage unavailable */}
}
function restoreChips():void{
  try{
    const map=JSON.parse(localStorage.getItem(CHIPS_KEY)||'{}') as Record<string,Chip[]>;
    const saved=map[localStorage.getItem(SCOPE_CONV_KEY)||'']||[];
    chips.length=0;chips.push(...saved.map(c=>({...c})));
  }catch{/* keep what we have */}
  renderChips();
}

// ── HA-039: chip preview popover (thumbnail/text where a reader exists) ────
async function resolveProject(value:string):Promise<{name:string;path:string}|null>{
  try{
    const d=await fetch('/api/projects').then(r=>r.ok?r.json():null) as {projects?:{name:string;host_path:string}[]}|null;
    for(const p of d?.projects||[]){
      const root=p.host_path.replace(/\/+$/,'');
      if(value===root||value.startsWith(root+'/'))return {name:p.name,path:value.slice(root.length+1)||'.'};
    }
  }catch{/* fall through to the honest fallback */}
  return null;
}
function showChipPreview(c:Chip,anchor:HTMLElement):void{
  document.querySelector('.hc-chip-preview')?.remove();
  const pop=document.createElement('div');pop.className='hc-chip-preview';
  const title=document.createElement('strong');title.textContent=c.kind==='url'?c.value:shortName(c.value);
  const meta=document.createElement('p');meta.className='hc-chip-preview-meta';
  meta.textContent=(c.kind==='url'?'URL':c.kind==='folder'?'Host folder':c.uploaded?'Uploaded file (stored under hermes-uploads/)':'Host file reference')+' — '+c.value;
  const body=document.createElement('div');body.className='hc-chip-preview-body';
  pop.append(title,meta,body);
  const close=()=>{pop.remove();document.removeEventListener('click',onDoc,true)};
  const onDoc=(ev:MouseEvent)=>{if(!pop.contains(ev.target as Node))close()};
  if(c.kind!=='url'){
    const openBtn=document.createElement('button');openBtn.type='button';openBtn.textContent='Open in Projects';
    openBtn.onclick=()=>{window.dispatchEvent(new CustomEvent('hermes:projects:open-file',{detail:{path:c.value}}));close()};
    pop.append(openBtn);
    void (async()=>{
      const pr=await resolveProject(c.value);
      if(!pr){body.textContent='Preview unavailable here — open it in Projects.';return}
      try{
        const r=await fetch(`/api/projects/${encodeURIComponent(pr.name)}/file?path=${encodeURIComponent(pr.path)}&preview=1&raw=1`);
        if(!r.ok)throw new Error('HTTP '+r.status);
        const f=await r.json() as {binary?:boolean;image?:boolean;content_base64?:string;content?:string;size?:number};
        if(f.binary&&f.image&&f.content_base64){
          const img=document.createElement('img');img.className='hc-chip-preview-img';img.alt=c.value;
          img.src='data:image/*;base64,'+f.content_base64;body.append(img);
        }else if(f.binary){body.textContent='Binary file — no text preview. Size '+(f.size??0)+' bytes.'}
        else{const pre=document.createElement('pre');pre.textContent=(f.content||'').slice(0,500);body.append(pre)}
      }catch{body.textContent='Preview unavailable here — open it in Projects.'}
    })();
  }else{body.textContent='Linked resource — opens in the browser when sent.'}
  const chipEl=anchor.closest('.hc-attach-chip');
  if(chipEl)chipEl.after(pop);else document.body.append(pop);
  setTimeout(()=>document.addEventListener('click',onDoc,true),0);
}

// ── Artifacts… picker: recent generated files from the durable event store ──
function openArtifactsPicker():Promise<void>{
  return new Promise(resolve=>{
    const dlg=document.createElement('dialog');dlg.className='hc-fs-picker';
    dlg.innerHTML='<div class="hc-fs-head"><strong>Generated artifacts (recent file activity)</strong>'+
      '<button type="button" class="hc-fs-close" aria-label="Close">✕</button></div>'+
      '<div class="hc-fs-list" role="listbox"></div>'+
      '<p class="hc-fs-note" role="status">Loading…</p>'+
      '<div class="hc-fs-foot"><span class="hc-fs-count">Click a file to attach it</span>'+
      '<button type="button" class="hc-fs-cancel">Done</button></div>';
    const listEl=dlg.querySelector('.hc-fs-list') as HTMLElement;
    const noteEl=dlg.querySelector('.hc-fs-note') as HTMLElement;
    const finish=()=>{dlg.remove();resolve()};
    (dlg.querySelector('.hc-fs-close') as HTMLButtonElement).onclick=finish;
    (dlg.querySelector('.hc-fs-cancel') as HTMLButtonElement).onclick=finish;
    dlg.addEventListener('cancel',ev=>{ev.preventDefault();finish()});
    void (async()=>{
      try{
        const [evRes,prRes]=await Promise.all([fetch('/api/events?tail=300'),fetch('/api/projects')]);
        const events=evRes.ok?await evRes.json() as {type?:string;payload?:{project?:string;path?:string}}[]:[];
        const projects=prRes.ok?((await prRes.json() as {projects?:{name:string;host_path:string}[]}).projects||[]):[];
        const seen=new Set<string>();const rows:{abs:string;label:string}[]=[];
        for(let i=events.length-1;i>=0;i--){
          const e=events[i];
          if(e.type!=='file.changed')continue;
          const rel=e.payload?.path;const proj=e.payload?.project;
          if(!rel)continue;
          const p=projects.find(x=>x.name===proj);
          const abs=p?p.host_path.replace(/\/+$/,'')+'/'+rel:'';
          if(!abs||seen.has(abs))continue;
          seen.add(abs);rows.push({abs,label:(proj||'?')+' · '+rel});
        }
        noteEl.textContent=rows.length?'':'No generated files recorded yet — they appear here after the agent or the IDE writes files.';
        listEl.replaceChildren(...rows.map(r=>{
          const b=document.createElement('button');b.type='button';b.className='hc-fs-name';b.textContent=r.label;b.title=r.abs;
          b.onclick=()=>{if(!chips.some(c=>c.value===r.abs))chips.push({kind:'file',value:r.abs});renderChips();finish()};
          return b;
        }));
      }catch(err){noteEl.textContent='Cannot list recent artifacts — '+(err as Error).message}
    })();
    document.body.append(dlg);dlg.showModal();
  });
}

// ── Workspace access mode control (moved out of the IDE stage, HA-011) ──────
// Contract with phase412-project-ui.ts attachMode(name): the same
// localStorage map {projectSlug:'A'|'B'|'C'}, keyed by the conversation's
// scope project ('' when unscoped). Default 'A'.
const MODE_KEY='hermes...ode';
type AttachMode='A'|'B'|'C';
function modeMap():Record<string,AttachMode>{
  try{const m=JSON.parse(localStorage.getItem(MODE_KEY)||'{}');return m&&typeof m==='object'?m as Record<string,AttachMode>:{}}catch{return{}}
}
export function getAttachMode():AttachMode{return modeMap()[getConversationScope()||'']||'A'}
export function setAttachMode(m:AttachMode):void{
  const map=modeMap();map[getConversationScope()||'']=m;
  try{localStorage.setItem(MODE_KEY,JSON.stringify(map))}catch{/* storage unavailable */}
}
function mountAttachMode():void{
  const tools=document.querySelector('#hc-tools-popover')||document.querySelector('.hc-composer-tools');
  if(!tools)return;
  let sel=el<HTMLSelectElement>('hc-attach-mode');
  if(!sel){
    sel=document.createElement('select');
    sel.id='hc-attach-mode';sel.className='hc-scope';
    sel.title='Workspace access mode for attachments — how file references are composed into the message';
    sel.append(new Option('Mode A: access','A'),new Option('Mode B: manifest','B'),new Option('Mode C: inline','C'));
    tools.append(sel);
  }
  if(!sel.dataset.wired){
    sel.dataset.wired='1';
    sel.addEventListener('change',()=>{setAttachMode(sel.value as AttachMode);sel.blur()});
    sel.addEventListener('focus',()=>{sel.value=getAttachMode()});
    window.addEventListener('hc-conversation-changed',()=>{sel.value=getAttachMode()});
  }
  sel.value=getAttachMode();
}
