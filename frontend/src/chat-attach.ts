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
type Chip={kind:'file'|'folder'|'url';value:string};

const chips:Chip[]=[];
let wired=false;

function el<T extends HTMLElement>(id:string):T|null{return document.getElementById(id) as T|null}

function renderChips(){
  const host=el('hc-attach-chips');
  if(!host)return;
  if(!chips.length){host.replaceChildren();host.hidden=true;return}
  host.hidden=false;
  host.replaceChildren(...chips.map((c,i)=>{
    const chip=document.createElement('span');chip.className='hc-attach-chip';chip.dataset.kind=c.kind;
    const glyph=document.createElement('span');glyph.className='hc-attach-chip-glyph';glyph.textContent=c.kind==='file'?'📄':c.kind==='folder'?'📁':'🔗';glyph.setAttribute('aria-hidden','true');
    const label=document.createElement('span');label.className='hc-attach-chip-label';label.textContent=c.value;label.title=c.value;
    const rm=document.createElement('button');rm.type='button';rm.className='hc-attach-chip-rm';rm.textContent='✕';
    rm.setAttribute('aria-label','Remove '+c.value);rm.title='Remove';
    rm.onclick=(e)=>{e.stopPropagation();chips.splice(i,1);renderChips()};
    chip.append(glyph,label,rm);
    return chip;
  }));
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
  if(!chips.some(c=>c.value===stored)){chips.push({kind:'file',value:stored});renderChips()}
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
}

/** The block prepended to the prompt on send. File/folder refs are stated as
 *  host paths the worker can open with its tools (mode-A language, without the
 *  project wrapper); URLs are plain references. */
export function chatAttachmentBlock():string{
  if(!chips.length)return '';
  const files=chips.filter(c=>c.kind!=='url').map(c=>c.value);
  const urls=chips.filter(c=>c.kind==='url').map(c=>c.value);
  const lines:string[]=[];
  if(files.length)lines.push('[Attached references]\nThe file(s)/folder(s) below were attached by the user. Their contents are NOT included; read them with your file tools as needed.\n'+files.map(p=>'- '+p).join('\n'));
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
