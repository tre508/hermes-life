import './hermes-chat';
import Phaser from 'phaser';
import './style.css';

// Display version is frontend-only; no backend protocol change.
const versionPill=document.querySelector<HTMLElement>('header .pill');
if(versionPill) versionPill.textContent='WORLD / 0.3.11';

type EventRecord = {sequence:number; id:string; task_id:string|null; type:string;timestamp:string;payload:Record<string,unknown>};
type WorldState = {room:string;activity:string;agent_x:number;agent_y:number;last_sequence:number};
// A single shared starship bridge with six functional stations, not room cards.
const mapRooms = [
  {id:'control',label:'PLANNING',x:300,y:238,w:200,h:112,description:'The command chair: goals and decisions.',px:400,py:297},
  {id:'library',label:'LIBRARY',x:272,y:89,w:127,h:98,description:'Science: documentation and research.',px:338,py:191},
  {id:'workshop',label:'STUDIO',x:408,y:89,w:128,h:98,description:'Engineering: code and tools.',px:469,py:191},
  {id:'archive',label:'ARCHIVE',x:38,y:156,w:166,h:115,description:'Historical records and memory.',px:189,py:282},
  {id:'laboratory',label:'TEST LAB',x:594,y:156,w:166,h:115,description:'Diagnostics and verification.',px:614,py:282},
  {id:'rest',label:'LOUNGE',x:299,y:346,w:201,h:54,description:'Rest and reflection between tasks.',px:402,py:365}
] as const;
type RoomId = typeof mapRooms[number]['id'];
const centers = Object.fromEntries(mapRooms.map(r=>[r.id,{x:r.px,y:r.py}])) as Record<RoomId,{x:number,y:number}>;
const $ = (id:string) => document.getElementById(id)!;
let hcVisibleOutput='';
// Phase 4.6: public execution activity, NOT private chain-of-thought.
// Use only confirmed backend events. No inferred agent thoughts or simulated output.
const hermesStatus=document.createElement('div');
hermesStatus.className='hermes-live-status';
hermesStatus.setAttribute('role','status');
hermesStatus.setAttribute('aria-live','polite');
hermesStatus.dataset.phase='idle';
hermesStatus.textContent='Hermes is ready for a task';
$('game').appendChild(hermesStatus);
function updateHermesStatus(text:string,phase='running'){
  hermesStatus.textContent=text.slice(0,180);
  hermesStatus.dataset.phase=phase;
}
function eventStatus(evt:EventRecord){
  const kind=evt.type;
  const payload=evt.payload||{};
  if(kind==='task.queued'){updateHermesStatus('Task queued · waiting to start','queued');return;}
  if(kind==='task.started'){hcVisibleOutput='';updateHermesStatus('Task started · Hermes is working','running');return;}
  if(kind==='task.completed'){updateHermesStatus('Task completed · result available','completed');return;}
  if(kind==='task.failed'){updateHermesStatus('Task failed · check the task result','failed');return;}
  // PHASE48_ACTIVITY: only observable execution events and public assistant output.
  if(kind==='hermes.tool_use'){
    const tool=[payload.tool_name,payload.tool,payload.name].find(v=>typeof v==='string' && /^[\w.:-]{1,64}$/.test(v as string));
    const inputs=payload.input??payload.arguments??payload.parameters;
    const detail=typeof inputs==='string'?inputs:inputs&&typeof inputs==='object'?JSON.stringify(inputs):'';
    const compact=detail.replace(/\s+/g,' ').slice(0,105);
    updateHermesStatus(`Tool: ${tool||'Hermes tool'}${compact?' · '+compact:''}`);return;
  }
  if(kind==='hermes.tool_result'){
    const tool=[payload.tool_name,payload.tool,payload.name].find(v=>typeof v==='string');
    updateHermesStatus(tool?`Finished: ${tool}`:'Tool finished · processing output');return;
  }
  if(kind==='hermes.text'){
    // Genuine emitted assistant text, not private model reasoning.
    const delta=typeof payload.text==='string'?payload.text:'';
    if(delta){
      hcVisibleOutput=(hcVisibleOutput+delta).slice(-400);
      const compact=hcVisibleOutput.replace(/\s+/g,' ').trim();
      updateHermesStatus('Responding · '+compact.slice(-125));
    }
    return;
  }
  if(kind==='hermes.result'){updateHermesStatus('Hermes response finished','completed');return;}
  if(kind==='hermes.system'){updateHermesStatus('Hermes runtime active');return;}
}

// Phase 3.6: one viewport, one operations panel at a time.
const showOps=(view:string)=>{
  document.querySelectorAll<HTMLElement>('.ops-view').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  document.querySelectorAll<HTMLButtonElement>('[data-ops-tab]').forEach(el=>{
    const chosen=el.dataset.opsTab===view;el.classList.toggle('active',chosen);el.setAttribute('aria-pressed',String(chosen));
  });
};
document.querySelectorAll<HTMLButtonElement>('[data-ops-tab]').forEach(el=>el.addEventListener('click',()=>showOps(el.dataset.opsTab||'overview')));
$('studio-open-activity').addEventListener('click',()=>showOps('activity'));
$('overview-open-goals').addEventListener('click',()=>showOps('goals'));
showOps('overview');
type Persona = {name:string;persona:string;mode:string;experience_count:number};
let persona:Persona={name:'Hermes',persona:'',mode:'fixed-with-experience',experience_count:0};
async function loadPersona(){
 try {
  const response=await fetch('/api/personality');
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  persona=await response.json();
  $('persona-display').textContent=persona.name;
  $('persona-experience').textContent=`${persona.experience_count} recorded runs`;
  $('persona-feedback').textContent='Core identity loaded from host.';
 } catch(e){ $('persona-feedback').textContent='Persona unavailable: '+String(e); }
}
void loadPersona();
function updateStudio(room:string,activity:string){
 const titles:Record<string,string>={control:'Planning room',library:'Research library',workshop:'Engineering studio',archive:'Memory archive',laboratory:'Testing lab',rest:'Cozy lounge'};
 const moods:Record<string,string>={coding:'Focused',planning:'Thoughtful',researching:'Curious',reviewing:'Analytical',evaluating:'Analytical',recording:'Reflective',failed:'Concerned',idle:'Relaxed'};
 $('studio-status').textContent=(titles[room]||room)+' · '+activity;
 $('studio-detail').textContent=activity==='recording'?'Saving an outcome':activity==='coding'?'Using development tools':activity==='researching'?'Gathering evidence':'Agent activity synchronized with Hermes';
 $('persona-mood').textContent=moods[activity]||'Observant';
 $('persona-narrative').textContent=(persona.name||'Hermes')+' is '+(activity==='recording'?'archiving what happened':activity==='coding'?'working through a task':activity==='researching'?'investigating a question':activity==='planning'?'choosing the next action':activity==='failed'?'reviewing a setback':'observing the studio')+'.';
}

let selectedTask:string|null = null;
let lastSequence = 0;
const roomDestinations:Record<RoomId,string>={control:'planning',library:'discovery',workshop:'build',archive:'activity',laboratory:'build',rest:'overview'};
let selectedRoom:RoomId|null=null;
function openRoomDetails(roomId:RoomId){
 const r=mapRooms.find(v=>v.id===roomId);if(!r)return;
 selectedRoom=roomId;
 $('world-room-title').textContent=r.label;
 $('world-room-description').textContent=r.description;
 $('room-info').textContent=`${r.label}: ${r.description}`;
 $('world-room-open').textContent='Open '+({control:'Planning',library:'Discover',workshop:'Build',archive:'Activity',laboratory:'Build',rest:'Overview'}[roomId])+' workspace';
 $('world-room-panel').hidden=false;
}
$('world-room-close').addEventListener('click',()=>{$('world-room-panel').hidden=true;});
$('world-room-open').addEventListener('click',()=>{if(selectedRoom)showOps(roomDestinations[selectedRoom]);});

let scene:WorldScene;
type TaskRecord = {id:string;prompt:string;state:string;result:string|null;error:string|null;session_id:string|null;created_at:string};
let viewedTaskId:string|null=null;
let followLive=true;
function setFollowLive(enabled:boolean){
  followLive=enabled;
  const button=$('response-follow');
  button.textContent=enabled?'Following live':'Follow live';
  button.setAttribute('aria-pressed',String(enabled));
  $('response-source').textContent=enabled?'Latest agent activity':'History selection';
}
$('response-follow').addEventListener('click',()=>{setFollowLive(true);void syncLatestTask();});
let pendingRefresh:ReturnType<typeof setTimeout>|undefined;
let requestGeneration=0;
let currentAnswer = '';
function renderAnswer(source:string){
  currentAnswer=source;
  $('response-text').textContent=source;
  const root=$('response-rich');root.replaceChildren();
  const lines=source.replace(/\r\n/g,'\n').split('\n');
  let i=0;
  const addInline=(el:HTMLElement,value:string)=>{
    const pattern=/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;let pos=0;let match:RegExpExecArray|null;
    while((match=pattern.exec(value))!==null){
      if(match.index>pos)el.append(document.createTextNode(value.slice(pos,match.index)));
      const raw=match[0];const item=document.createElement(raw.startsWith('`')?'code':'strong');
      item.textContent=raw.startsWith('`')?raw.slice(1,-1):raw.slice(2,-2);el.append(item);pos=pattern.lastIndex;
    }
    if(pos<value.length)el.append(document.createTextNode(value.slice(pos)));
  };
  while(i<lines.length){
    const line=lines[i];if(!line.trim()){i++;continue;}
    if(/^\s*```/.test(line)){
      const code=document.createElement('pre');code.className='answer-code';i++;
      const block:string[]=[];while(i<lines.length&&!/^\s*```/.test(lines[i]))block.push(lines[i++]);
      if(i<lines.length)i++;const inner=document.createElement('code');inner.textContent=block.join('\n');code.append(inner);root.append(code);continue;
    }
    const heading=line.match(/^\s{0,3}(#{1,4})\s+(.+)/);
    if(heading){const el=document.createElement(heading[1].length<=2?'h3':'h4');addInline(el,heading[2]);root.append(el);i++;continue;}
    if(/^\s*[-*]\s+/.test(line)||/^\s*\d+[.)]\s+/.test(line)){
      const ordered=/^\s*\d+[.)]\s+/.test(line);const list=document.createElement(ordered?'ol':'ul');
      while(i<lines.length&&(ordered?/^\s*\d+[.)]\s+/:/^\s*[-*]\s+/).test(lines[i])){
        const li=document.createElement('li');addInline(li,lines[i].replace(ordered?/^\s*\d+[.)]\s+/:/^\s*[-*]\s+/,''));list.append(li);i++;
      }root.append(list);continue;
    }
    if(/^\s*---+\s*$/.test(line)){root.append(document.createElement('hr'));i++;continue;}
    const block:string[]=[line.trim()];i++;
    while(i<lines.length&&lines[i].trim()&&!/^(\s*```|\s{0,3}#{1,4}\s|\s*[-*]\s+|\s*\d+[.)]\s+)/.test(lines[i]))block.push(lines[i++].trim());
    const para=document.createElement('p');addInline(para,block.join(' '));root.append(para);
  }
  if(!root.children.length){const p=document.createElement('p');p.textContent='No response available.';root.append(p);}
}
function setResponseTab(tab:string){
  for(const name of ['answer','tools','history']){
    const selected=name===tab;
    $(`response-${name==='answer'?'answer':name==='tools'?'tools':'history'}-panel`).hidden=!selected;
    const btn=document.querySelector<HTMLButtonElement>(`[data-response-tab="${name}"]`);
    if(btn){btn.classList.toggle('active',selected);btn.setAttribute('aria-selected',String(selected));}
  }
}
document.querySelectorAll<HTMLButtonElement>('[data-response-tab]').forEach(b=>b.addEventListener('click',()=>setResponseTab(b.dataset.responseTab||'answer')));
$('response-raw-toggle').addEventListener('change',()=>{
  const checked=( $('response-raw-toggle') as HTMLInputElement).checked;
  $('response-text').hidden=!checked;$('response-rich').hidden=checked;
});
$('response-copy').addEventListener('click',()=>void navigator.clipboard.writeText(currentAnswer));
$('response-expand').addEventListener('click',()=>{
  const expanded=$('response-workspace').classList.toggle('expanded');
  $('response-expand').textContent=expanded?'Collapse':'Expand';
});

const toolEntries=new Map<string,EventRecord[]>();
function describePayload(payload:Record<string,unknown>):string{
  try{return JSON.stringify(payload,null,2)}catch{return String(payload)}
}
function renderTools(id:string){
  const container=$('tool-events');container.replaceChildren();
  const entries=toolEntries.get(id)||[];
  $('tool-count').textContent=String(entries.length);
  for(const evt of entries){
    const div=document.createElement('div');div.className='tool-entry';
    const heading=document.createElement('strong');heading.textContent=evt.type;
    const value=document.createElement('span');value.textContent=describePayload(evt.payload);
    div.append(heading,value);container.append(div);
  }
}
async function loadTask(id:string){
  viewedTaskId=id;
  const generation=++requestGeneration;
  $('response-id').textContent=id;
  try{
    const response=await fetch(`/api/tasks/${encodeURIComponent(id)}`);
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const task=await response.json() as TaskRecord;
    if(generation!==requestGeneration)return;
    $('response-status').textContent=task.state;
    renderAnswer(task.result ?? (task.state==='failed'?'Task failed without a response.':task.state==='completed'?'Task completed without response text.':'Hermes is working; awaiting response…')); 
    const error=$('response-error');error.hidden=!task.error;error.textContent=task.error||'';
    renderTools(id);
    document.querySelectorAll<HTMLButtonElement>('.history-entry').forEach(btn=>btn.setAttribute('aria-current',String(btn.dataset.taskId===id)));
  }catch(err){if(generation===requestGeneration)$('response-status').textContent=`Cannot load: ${String(err)}`}
}
async function refreshHistory(){
  try{
    const response=await fetch('/api/tasks');if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const tasks=await response.json() as TaskRecord[];
    const list=$('task-history');list.replaceChildren();
    if(!tasks.length)list.textContent='No previous tasks.';
    for(const task of tasks){
      const btn=document.createElement('button');btn.type='button';btn.className='history-entry';btn.dataset.taskId=task.id;
      btn.setAttribute('aria-current',String(task.id===viewedTaskId));
      const state=document.createElement('span');state.className='state';state.textContent=task.state;
      const prompt=document.createElement('span');prompt.textContent=task.prompt.length>90?task.prompt.slice(0,90)+'…':task.prompt;
      const date=document.createElement('small');date.textContent=new Date(task.created_at).toLocaleString()+' · '+task.id.slice(0,8);
      btn.append(state,prompt,date);btn.addEventListener('click',()=>{setFollowLive(false);setResponseTab('answer');void loadTask(task.id);});list.append(btn);
    }
    // The response panel follows real task activity, never a generic history selection.
    if(!viewedTaskId) { $('response-status').textContent='No task observed'; $('response-id').textContent='—'; }
  }catch(err){$('task-history').textContent=`History unavailable: ${String(err)}`}
}
function scheduleTaskRefresh(evt:EventRecord){
  if(!evt.task_id)return;
  // Autonomous goal tasks also generate task.* events; follow those like manual submissions.
  if(followLive && (evt.type==='task.queued'||evt.type==='task.started'||evt.type==='task.completed'||evt.type==='task.failed')){
    if(viewedTaskId!==evt.task_id) {setResponseTab('answer');void loadTask(evt.task_id);}
  }
  if(evt.type==='hermes.tool_use'||evt.type==='hermes.tool_result'){
    const existing=toolEntries.get(evt.task_id)||[];
    existing.push(evt);toolEntries.set(evt.task_id,existing);
    if(viewedTaskId===evt.task_id)renderTools(evt.task_id);
  }
  if(viewedTaskId===evt.task_id && (evt.type==='task.started'||evt.type==='task.completed'||evt.type==='task.failed')){
    // Completion event is emitted after the task record is updated.
    clearTimeout(pendingRefresh);pendingRefresh=setTimeout(()=>void loadTask(evt.task_id!),100);
  }
  if(evt.type==='task.queued'||evt.type==='task.completed'||evt.type==='task.failed'){
    void refreshHistory();
  }
}


function appendEvent(evt:EventRecord){
  if(evt.sequence <= lastSequence) return;
  lastSequence = evt.sequence;
  if(evt.task_id){ selectedTask = evt.task_id; latestEventTaskId=evt.task_id; }
  scheduleTaskRefresh(evt);
  const item=document.createElement('div');item.className='event';
  const title=document.createElement('span');title.textContent=`#${evt.sequence}  ${evt.type}`;
  const details=document.createElement('em');details.textContent=new Date(evt.timestamp).toLocaleTimeString()+' · '+(evt.task_id||'system');
  item.append(title,details);$('events').prepend(item);
  while($('events').childElementCount>100) $('events').lastElementChild?.remove();
  $('task').textContent=selectedTask?.slice(0,8)||'—';
  eventStatus(evt);
  // The visual projection is never interpreted as task completion; backend remains authoritative.
  const detail=JSON.stringify(evt.payload||{}).toLowerCase();
  const room = evt.type==='goal.selected'||evt.type==='autonomy.resumed'||evt.type==='task.queued'?'control':
    evt.type==='task.completed'||evt.type==='task.failed'?'archive':
    /pytest|test_suite|benchmark|evaluation|verify|ctest/.test(detail)?'laboratory':
    /read_file|read.*file|search|docs|web|browse|grep/.test(detail)?'library':
    /memory|archive|history/.test(detail)?'archive':
    /write_file|edit_file|apply_patch|git|compile|build/.test(detail)?'workshop':
    evt.type==='hermes.system'?'library':evt.type==='hermes.tool_use'?'workshop':
    evt.type==='hermes.tool_result'||evt.type==='hermes.result'?'laboratory':null;
  if(room && scene){ const activity=evt.type==='task.completed'?'recording':evt.type==='task.failed'?'failed':evt.type==='task.queued'?'planning':evt.type==='hermes.system'?'researching':evt.type==='hermes.result'?'evaluating':evt.type==='hermes.tool_result'?'reviewing':'coding';scene.moveTo(room,activity); $('studio-detail').textContent=({control:'Choosing the next goal',library:'Reading and researching',workshop:'Working with code and tools',archive:'Recording the latest outcome',laboratory:'Checking evidence and tests',rest:'Waiting for work'} as Record<string,string>)[room]; }
}
class WorldScene extends Phaser.Scene {
  private hero!:Phaser.GameObjects.Container;
  private motion?:Phaser.Tweens.Tween;
  private room:RoomId='rest';
  private activity='idle';
  private walking=false;
  private pendingPath:Phaser.Math.Vector2[]=[];
  private heroGraphic!:Phaser.GameObjects.Graphics;
  private pulse=0;
  private roomHighlight!:Phaser.GameObjects.Graphics;
  private glow!:Phaser.GameObjects.Graphics;
  private ambient!:Phaser.GameObjects.Graphics;
  private hoverGraphics!:Phaser.GameObjects.Graphics;
  private narration!:Phaser.GameObjects.Text;
  private labelTexts=new Map<RoomId,Phaser.GameObjects.Text>();
  private hoverRoom:RoomId|null=null;
  private facing=1;
  constructor(){super('WorldScene')}
  private panel(g:Phaser.GameObjects.Graphics,x:number,y:number,w:number,h:number,color=0x111c29){
    g.fillStyle(0x9a866f);g.fillRoundedRect(x-5,y-5,w+10,h+12,7);
    g.fillStyle(0x352c38);g.fillRoundedRect(x,y,w,h,5);
    g.fillStyle(color);g.fillRect(x+7,y+8,w-14,h-17);
    for(let i=0;i<Math.max(2,Math.floor((w-30)/26));i++){
      const px=x+15+i*26;
      g.fillStyle([0x70bfc4,0xc7ab7b,0xb5a1cc,0x93d5b7][i%4],.9);
      g.fillRect(px,y+17,12,3+(i%3)*5);
      g.fillStyle(0x9db6ca);g.fillRect(px,y+36,18,2);
      g.fillStyle(0x495f72);g.fillRect(px,y+41,9,3);
    }
  }
  create(){
    const g=this.add.graphics();
    // Starfield, curved viewing dome, one continuous command deck.
    g.fillStyle(0x0a111f);g.fillRect(0,0,800,425);
    for(let i=0;i<85;i++){
      const x=(i*127+19)%800,y=(i*73+11)%129;
      g.fillStyle(i%5===0?0xb9d0d9:0x667c8c,.35+(i%4)*.12);g.fillRect(x,y,1+(i%11===0?1:0),1);
    }
    g.fillStyle(0x6a5c55);g.fillEllipse(400,240,1010,505);
    g.fillStyle(0xd2c3a0);g.fillEllipse(400,153,945,255);
    g.fillStyle(0x75665e);g.fillEllipse(400,235,925,350);
    g.fillStyle(0x293742);g.fillEllipse(400,293,835,300);
    g.fillStyle(0x4b5a60);g.fillEllipse(400,311,700,256);
    g.fillStyle(0x9a7071);g.fillEllipse(400,317,410,204);
    g.lineStyle(10,0x8c654d);g.strokeEllipse(400,315,415,205);
    g.lineStyle(3,0xc69b78);g.strokeEllipse(400,315,435,225);
    // Upper wall sweeping across the rear, one continuous panoramic instrument strip.
    g.fillStyle(0x8d7862);g.fillRoundedRect(65,97,670,114,17);
    g.fillStyle(0x2b2c36);g.fillRoundedRect(190,105,419,87,8);
    for(let x=205;x<600;x+=45){
      g.fillStyle(0x101e2b);g.fillRect(x,112,41,66);
      for(let k=0;k<5;k++){
        g.fillStyle([0xa1dae0,0xdec08d,0x9fa4df,0x96d7ae][(k+x)%4]);
        g.fillRect(x+5,119+k*10,(k*13+x)%27+6,2);
      }
    }
    // Deck perspective: segmented floor tiles constrained to the walkable bridge.
    g.lineStyle(1,0x9eb3ab,.16);
    for(let y=210;y<=410;y+=19){
      const half=160+(y-210)*1.42;
      g.lineBetween(Math.max(25,400-half),y,Math.min(775,400+half),y);
    }
    for(let x=90;x<=710;x+=31)g.lineBetween(400+(x-400)*.43,208,x,410);
    // Side diagnostic walls: built into the bridge rather than floating cards.
    for(const [x,flip] of [[27,false],[610,true]] as const){
      const w=163;g.fillStyle(0xaba089);g.fillRoundedRect(x,150,w,119,8);
      g.fillStyle(0x545568);g.fillRoundedRect(x+8,160,w-16,97,4);
      for(let c=0;c<5;c++)for(let row=0;row<3;row++){
        g.fillStyle((c+row)%3===0?0x739bad:0x8c8b92);g.fillRect(x+15+c*28,168+row*24,23,18);
        g.fillStyle(0x182532);g.fillRect(x+17+c*28,172+row*24,18,3);
      }
      g.fillStyle(flip?0x8ee2d1:0xe8cc9c);g.fillRect(x+20,263,114,3);
    }
    // Trim, vents and structural beams give the curved deck layered depth.
    for(const x of [76,112,148,652,688,724]){
      g.fillStyle(0x27313e,.7);g.fillRoundedRect(x,83,8,43,3);
      g.fillStyle(0xd6bf9e,.5);g.fillRect(x+2,83,2,33);
    }
    g.lineStyle(3,0xdfc69b,.48);g.beginPath();g.arc(400,105,340,Math.PI*1.09,Math.PI*1.91);g.strokePath();
    // Bridge control consoles surround the command chair.
    this.panel(g,269,91,128,72,0x142d3b);
    this.panel(g,407,91,128,72,0x192c3c);
    g.fillStyle(0x8e7770);g.fillRoundedRect(285,266,230,67,18);
    g.fillStyle(0x433943);g.fillRoundedRect(308,276,184,36,10);
    g.fillStyle(0xb4a18c);g.fillRoundedRect(325,295,47,50,9);g.fillRoundedRect(429,295,47,50,9);
    g.fillStyle(0x617884);g.fillRect(335,299,25,8);g.fillRect(439,299,25,8);
    // Command chair and forward helm stations.
    g.fillStyle(0xb7a68c);g.fillRoundedRect(378,302,47,38,8);
    g.fillStyle(0x503d43);g.fillRoundedRect(385,310,32,28,5);
    for(const x of [205,504]){
      g.fillStyle(0xc7b59d);g.fillRoundedRect(x,350,92,28,7);
      g.fillStyle(0x1a2c39);g.fillRect(x+7,349,77,11);
      for(let i=0;i<8;i++){g.fillStyle(i%2?0x93e0d2:0xc3b2d5);g.fillRect(x+12+i*9,352,6,3);}
      g.fillStyle(0x8bafa9);g.fillRoundedRect(x+19,378,16,18,3);g.fillRoundedRect(x+59,378,16,18,3);
    }
    // Tiny desk details and console hardware are decorative and never clickable.
    for(const x of [300,438]){
      g.fillStyle(0x0d2129);g.fillRoundedRect(x,165,62,10,2);
      for(let k=0;k<8;k++){g.fillStyle(k%3===0?0xe8c98d:0x71cdbb);g.fillRect(x+5+k*7,168,4,2);}
    }
    for(const x of [90,671]){
      g.fillStyle(0x29363d);g.fillRect(x-10,271,36,6);
      g.fillStyle(0xb4dbd3,.8);g.fillRect(x-4,272,16,2);
    }
    // Animated ambient lights and mouse highlights are drawn in their own layers.
    this.ambient=this.add.graphics().setDepth(2);
    this.hoverGraphics=this.add.graphics().setDepth(6);
    this.glow=this.add.graphics().setDepth(3);
    this.roomHighlight=this.add.graphics().setDepth(5);
    const labelPositions:Record<RoomId,{x:number,y:number}>={
      control:{x:400,y:282},library:{x:336,y:171},workshop:{x:470,y:171},
      archive:{x:102,y:278},laboratory:{x:694,y:278},rest:{x:401,y:399}
    };
    for(const r of mapRooms){
      const lp=labelPositions[r.id];
      const label=this.add.text(lp.x,lp.y,r.label,{fontFamily:'monospace',fontSize:'10px',fontStyle:'bold',color:'#f5e7d0',backgroundColor:'#263846',padding:{x:6,y:3}}).setOrigin(.5).setDepth(7);
      this.labelTexts.set(r.id,label);
      const zone=this.add.zone(r.x+r.w/2,r.y+r.h/2,r.w,r.h).setInteractive({useHandCursor:true});
      zone.on('pointerdown',()=>openRoomDetails(r.id));
      zone.on('pointerover',()=>{this.hoverRoom=r.id;this.hoverGraphics.clear().lineStyle(2,0xe5d5ad,.95).strokeRoundedRect(r.x+2,r.y+2,r.w-4,r.h-4,7);label.setColor('#fff3bf');});
      zone.on('pointerout',()=>{if(this.hoverRoom===r.id)this.hoverRoom=null;this.hoverGraphics.clear();label.setColor('#f5e7d0');});
    }
    this.narration=this.add.text(400,18,'Hermes is taking a break between tasks.',{fontFamily:'monospace',fontSize:'12px',color:'#e1f5e7',backgroundColor:'#102332e8',padding:{x:12,y:7},wordWrap:{width:660}}).setOrigin(.5,0).setDepth(15).setVisible(false);
    this.hero=this.add.container(0,0);
    this.heroGraphic=this.add.graphics();this.hero.add(this.heroGraphic);this.hero.setDepth(10);
    this.hero.setPosition(centers.rest.x,centers.rest.y);
    this.time.addEvent({delay:180,loop:true,callback:()=>this.animateHero()});
    this.add.text(12,409,'HERMES LIFE  /  LIVE BRIDGE TELEMETRY',{fontFamily:'monospace',fontSize:'10px',color:'#c4d5c8'});
    scene=this;void hydrate();
  }
  private animateHero(){
    this.pulse++;
    const h=this.heroGraphic;h.clear();
    const bob=this.walking?(this.pulse%2?0:2):Math.round(Math.sin(this.pulse*.32));
    const working=!this.walking && !['idle','waiting'].includes(this.activity);
    // Shadow, feet, torso, expressive head and swinging arms: readable at 1x scale.
    h.fillStyle(0x051923,.45);h.fillEllipse(0,26,29,7);
    h.fillStyle(0x314a60);h.fillRect(-8,15+bob,7,9);h.fillRect(2,15+bob,7,9);
    h.fillStyle(0xa2d6d0);h.fillRoundedRect(-12,-15+bob,24,29,4);
    h.fillStyle(0x25475a);h.fillRect(-9,-11+bob,18,13);
    h.fillStyle(working&&this.pulse%4===0?0xf7cc85:0x99ffcc);
    h.fillRect(-6,-7+bob,4,4);h.fillRect(3,-7+bob,4,4);
    h.fillStyle(0x6f96a4);h.fillRect(-8,1+bob,16,2);
    const swing=this.walking?(this.pulse%2?3:-3):working?(this.pulse%3===0?2:-1):0;
    h.fillStyle(0x8bc4bb);h.fillRect(-15,-2+bob+swing,4,14);h.fillRect(11,-2+bob-swing,4,14);
    h.fillStyle(0xe4b88c);h.fillRect(-14,11+bob+swing,3,3);h.fillRect(12,11+bob-swing,3,3);
    h.fillStyle(0xb6e0d5);h.fillRect(-10,-18+bob,20,4);
    // Status light uses the actual activity, not a synthetic timer-generated task.
    h.fillStyle(this.activity==='failed'?0xe69b89:working?0x8df6c3:0xadc3cf);
    h.fillCircle(0,8+bob,3);
    this.glow.clear();const r=mapRooms.find(v=>v.id===this.room);
    if(r){this.glow.fillStyle(0x98e6cd,this.pulse%5<3?.17:.07);this.glow.fillCircle(r.px,r.py,31);}
    this.ambient.clear();
    // Bridge panel indicators: varying brightness only, no claimed VM actions.
    for(let i=0;i<12;i++){
      const x=209+i*33;
      this.ambient.fillStyle(i%4===this.pulse%4?0x92ffe4:0x5c9fa7,i%4===this.pulse%4?.9:.3);
      this.ambient.fillRect(x,187,16,2);
    }
    for(let i=0;i<6;i++){
      this.ambient.fillStyle(i===this.pulse%6?0xf3d49b:0x81bdb7,.65);
      this.ambient.fillRect(216+i*12,355,7,2);
      this.ambient.fillRect(520+i*12,355,7,2);
    }
  }
  private walkNext(){
    const next=this.pendingPath.shift();if(!next){this.walking=false;this.motion=undefined;return;}
    const distance=Phaser.Math.Distance.Between(this.hero.x,this.hero.y,next.x,next.y);
    if(distance<2){this.hero.setPosition(next.x,next.y);this.walkNext();return;}
    this.walking=true;this.facing=next.x>=this.hero.x?1:-1;
    this.motion=this.tweens.add({targets:this.hero,x:next.x,y:next.y,
      duration:Math.max(120,distance*3),ease:'Linear',onComplete:()=>this.walkNext()});
  }
  moveTo(roomName:string,activity:string,immediate=false){
    if(!(roomName in centers))return;
    const room=roomName as RoomId;this.room=room;this.activity=activity;
    const target=mapRooms.find(r=>r.id===room)!;
    this.roomHighlight.clear().lineStyle(3,0xa8e8c5,.9).strokeRoundedRect(target.x,target.y,target.w,target.h,7);
    $('room').textContent=target.label;$('activity').textContent=activity;updateStudio(room,activity);
    const narrationByActivity:Record<string,string>={coding:'working on code at Engineering',planning:'mapping the next steps at Command',researching:'checking sources at Science',reviewing:'reviewing findings at Records',evaluating:'running checks at Diagnostics',recording:'saving the latest outcome in Records',failed:'reviewing an unsuccessful run',idle:'taking a break in the Lounge',waiting:'waiting for the next task'};
    this.narration.setText(`${persona.name||'Hermes'} is ${narrationByActivity[activity]||activity+' at '+target.label.toLowerCase()}.`);
    this.motion?.stop();this.pendingPath=[];
    const to=centers[room];
    if(immediate){this.walking=false;this.hero.setPosition(to.x,to.y);return;}
    // Use a shared deck lane; no diagonal cuts through instrumentation.
    const laneY=287;
    this.pendingPath=[new Phaser.Math.Vector2(this.hero.x,laneY),
      new Phaser.Math.Vector2(to.x,laneY),new Phaser.Math.Vector2(to.x,to.y)];
    this.walkNext();
  }
}
new Phaser.Game({type:Phaser.AUTO,parent:'game',width:800,height:425,backgroundColor:'#142734',pixelArt:true,scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_HORIZONTALLY},scene:[WorldScene]});
async function hydrate(){
  try {
    const state = await fetch('/api/world/state').then(r=>{if(!r.ok)throw Error('API offline');return r.json() as Promise<WorldState>});
    scene.moveTo(state.room,state.activity,true);
    // Load an initial history slice and replay chronological events, then stream after the last received cursor.
    const history = await fetch('/api/events?after=0&limit=500').then(r=>r.json() as Promise<EventRecord[]>);
    for(const event of history){ appendHistorical(event); }
    scene.moveTo(state.room,state.activity,true);
    await refreshHistory();
    await syncLatestTask();
    connect();
  } catch(e){$('connection').textContent='API unavailable — retrying';setTimeout(hydrate,3000)}
}
function appendHistorical(evt:EventRecord){
  if(evt.sequence<=lastSequence)return;
  lastSequence=evt.sequence;
  if(evt.task_id && evt.type.startsWith('task.'))latestEventTaskId=evt.task_id;
  const item=document.createElement('div'); item.className='event';
  const title=document.createElement('span');title.textContent=`#${evt.sequence}  ${evt.type}`;
  const details=document.createElement('em');details.textContent=new Date(evt.timestamp).toLocaleTimeString()+' · '+(evt.task_id||'system');
  item.append(title,details);$('events').prepend(item);
  while($('events').childElementCount>100)$('events').lastElementChild?.remove();
  if(evt.task_id && (evt.type==='hermes.tool_use'||evt.type==='hermes.tool_result')){
    const entries=toolEntries.get(evt.task_id)||[];entries.push(evt);toolEntries.set(evt.task_id,entries);
  }
}
async function syncLatestTask(){
  if(!followLive)return;
  try{
    const stateResponse=await fetch('/api/agent/state');
    if(stateResponse.ok){
      const state=await stateResponse.json() as {current_task?:string|null};
      if(state.current_task){await loadTask(state.current_task);return;}
    }
    // On reconnect/reload show the latest *recorded activity* clearly labeled,
    // not an arbitrary task selected from the history list.
    if(latestEventTaskId){await loadTask(latestEventTaskId);}
  }catch(err){console.warn('Unable to synchronize latest task',err)}
}
let latestEventTaskId:string|null=null;
let socket:WebSocket|null=null;let retryDelay=1000;
function connect(){
  socket?.close();
  const protocol=location.protocol==='https:'?'wss':'ws';
  const ws=new WebSocket(`${protocol}://${location.host}/ws/events?after=${lastSequence}`);socket=ws;
  ws.onopen=()=>{$('connection').textContent='● LIVE';$('connection').style.color='#87e7ba';retryDelay=1000};
  ws.onmessage=e=>{try{appendEvent(JSON.parse(e.data) as EventRecord)}catch(err){console.error('Malformed event',err)}};
  ws.onclose=()=>{if(socket!==ws)return;$('connection').textContent='● Reconnecting';$('connection').style.color='#f1ba79';setTimeout(connect,retryDelay);retryDelay=Math.min(retryDelay*2,15000)};
  ws.onerror=()=>ws.close();
}
$('task-form').addEventListener('submit',async e=>{
  e.preventDefault();const prompt=($('prompt') as HTMLTextAreaElement).value.trim();if(!prompt)return;
  try{
    const response=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,conversation_id:localStorage.getItem('hermes-life-conversation-id')})});
    const body=await response.json();if(!response.ok)throw Error(body.detail||response.statusText);
    if(body.conversation_id)localStorage.setItem('hermes-life-conversation-id',body.conversation_id);
    $('task-feedback').textContent=`Task accepted: ${body.id}`;($('prompt') as HTMLTextAreaElement).value='';
    setFollowLive(true);void loadTask(body.id);void refreshHistory();
  }catch(error){$('task-feedback').textContent=String(error)}
});

$('refresh-history').addEventListener('click',()=>void refreshHistory());
// Status polling handles missed WebSocket messages and task updates after disconnection.
setInterval(()=>{if(viewedTaskId && ['queued','running'].includes($('response-status').textContent||''))void loadTask(viewedTaskId)},3000);

// Phase 4.4: non-destructive Evidence tab / expanded world layout.
import { installWorldFirstLayout } from './phase44-layout';
import './phase44-layout.css';
installWorldFirstLayout();

// Phase 4.5: bounded dashboard / world sizing fix.
import './phase45-world-layout.css';

// Phase 4.6: live Hermes activity banner and high-DPI world rendering.
import './phase46-world-status.css';

// PHASE412_PROJECT_PICKER
import './phase412-project-ui';

// UI-413-01 replacement view
import './phase41301-rework';

// UI-413-02: open a task in the existing Evidence response viewer.
window.addEventListener('hermes:open-task', (ev: Event) => {
  const id = (ev as CustomEvent<{id:string}>).detail?.id;
  if (!id) return;
  setFollowLive(false);
  void loadTask(id);
  // The tab click uses existing dashboard navigation, not a new viewer.
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  const evidence = tabs.find(b => b.textContent?.trim() === 'Evidence' &&
    !b.closest('#response-workspace') && !b.closest('#chat-panel'));
  if (evidence) evidence.click();
  document.getElementById('response-workspace')?.scrollIntoView({block:'nearest'});
});
import './phase41302-workflow';

import './phase415-review';
