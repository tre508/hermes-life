/** Chat composer attachments — Hermes-Desktop-style (user brief, 2026-11-25):
 *  the chat is NOT pre-attached to any project. The ＋ Attach button opens a
 *  menu (Files…, Folders…, Images…, Paste image, URL…) and each pick becomes a
 *  chip above the composer; on send the chips compose into a reference block
 *  prepended to the prompt. Files/folders/URLs are PATH references — the worker
 *  has real filesystem reach and reads them with its tools, mirroring the CLI.
 *  Images need the project upload endpoint (PUT /api/projects/{name}/file), so
 *  those two items stay disabled until THIS conversation has an explicit
 *  project chosen in the Project tab — never a global fallback.
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

function addChip(kind:Chip['kind']){return async()=>{
  let v:string|null=null;
  if(kind==='url')v=await askValue('Attach a URL','https://…',nonEmpty);
  else v=await askValue(kind==='file'?'Attach a file':'Attach a folder','/absolute/path/…',absPath);
  if(!v)return;
  if(chips.some(c=>c.kind===kind&&c.value===v))return;
  chips.push({kind,value:v});renderChips();
}}

/** Images (file picker or paste) upload into the conversation's project
 *  workspace via the existing PUT endpoint — the same path the Project tab's
 *  Upload button uses. Without an explicit project there is nowhere to put an
 *  image, so the menu items are disabled with that reason in the tooltip. */
function conversationProject():string{
  try{
    const cid=localStorage.getItem('hermes-life-chat-conversation')||'';
    const map=JSON.parse(localStorage.getItem('hermes-life-project-by-conversation')||'{}');
    return (cid&&map&&typeof map==='object'&&typeof map[cid]==='string')?map[cid]:'';
  }catch{return ''}
}

async function uploadImage(file:File){
  const project=conversationProject();
  if(!project){alert('Choose a project for this conversation in the Project tab first — images upload into the project workspace.');return}
  const buf=await file.arrayBuffer();
  let binary='';const bytes=new Uint8Array(buf);
  // Chunked String.fromCharCode — spread on a large file overflows the call stack.
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  const r=await fetch(`/api/projects/${encodeURIComponent(project)}/file`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:file.name,content_base64:btoa(binary)})});
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

function refreshImageItems(menu:HTMLElement){
  const has=!!conversationProject();
  const items=menu.querySelectorAll<HTMLElement>('[data-needs-project]');
  for(let i=0;i<items.length;i++){
    const item=items[i];
    item.classList.toggle('hc-attach-disabled',!has);
    item.title=has?'':'Choose a project for this conversation in the Project tab first — images upload into the project workspace.';
  }
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
    item('Files…','📄',()=>void addChip('file')()),
    item('Folders…','📁',()=>void addChip('folder')()),
    item('Images…','🖼️',imageInput,{'data-needs-project':'1'}),
    item('Paste image','📋',()=>void pasteImage(),{'data-needs-project':'1'}),
    item('URL…','🔗',()=>void addChip('url')()),
  );
  const tip=document.createElement('p');tip.className='hc-attach-tip';tip.textContent='💡 Type @ to reference files inline';
  menu.append(tip);
  btn.after(menu);
  const close=()=>{menu.hidden=true;btn.setAttribute('aria-expanded','false')};
  btn.setAttribute('aria-haspopup','menu');btn.setAttribute('aria-expanded','false');
  btn.onclick=(ev)=>{ev.stopPropagation();const open=!menu.hidden;menu.hidden=open;btn.setAttribute('aria-expanded',String(!open));if(!open)refreshImageItems(menu)};
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
