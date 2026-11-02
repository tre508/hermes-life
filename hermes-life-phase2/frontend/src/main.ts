import Phaser from 'phaser';
import './style.css';

type EventRecord = {sequence:number; id:string; task_id:string|null; type:string;timestamp:string;payload:Record<string,unknown>};
type WorldState = {room:string;activity:string;agent_x:number;agent_y:number;last_sequence:number};
const mapRooms = [
  {id:'control',label:'CONTROL',x:14,y:15,description:'Selecting goals and planning tasks.'},
  {id:'library',label:'LIBRARY',x:282,y:15,description:'Reviewing context and knowledge.'},
  {id:'workshop',label:'WORKSHOP',x:550,y:15,description:'Coding and using Hermes tools.'},
  {id:'archive',label:'ARCHIVE',x:14,y:220,description:'Recording results and experiences.'},
  {id:'laboratory',label:'LABORATORY',x:282,y:220,description:'Evaluating output and tool results.'},
  {id:'rest',label:'REST',x:550,y:220,description:'Waiting for work.'}
] as const;
type RoomId = typeof mapRooms[number]['id'];
const centers = Object.fromEntries(mapRooms.map(r=>[r.id,{x:r.x+108,y:r.y+68}])) as Record<RoomId,{x:number,y:number}>;
const $ = (id:string) => document.getElementById(id)!;
let selectedTask:string|null = null;
let lastSequence = 0;
let scene:WorldScene;
type TaskRecord = {id:string;prompt:string;state:string;result:string|null;error:string|null;session_id:string|null;created_at:string};
let viewedTaskId:string|null=null;
let pendingRefresh:ReturnType<typeof setTimeout>|undefined;
let requestGeneration=0;
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
    $('response-text').textContent=task.result ?? (task.state==='failed'?'Task failed without a response.':task.state==='completed'?'Task completed without response text.':'Hermes is working; awaiting response…');
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
      btn.append(state,prompt,date);btn.addEventListener('click',()=>void loadTask(task.id));list.append(btn);
    }
    if(!viewedTaskId && tasks.length)void loadTask(tasks[0].id);
  }catch(err){$('task-history').textContent=`History unavailable: ${String(err)}`}
}
function scheduleTaskRefresh(evt:EventRecord){
  if(!evt.task_id)return;
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
  if(evt.task_id) selectedTask = evt.task_id;
  scheduleTaskRefresh(evt);
  const item=document.createElement('div');item.className='event';
  const title=document.createElement('span');title.textContent=`#${evt.sequence}  ${evt.type}`;
  const details=document.createElement('em');details.textContent=new Date(evt.timestamp).toLocaleTimeString()+' · '+(evt.task_id||'system');
  item.append(title,details);$('events').prepend(item);
  while($('events').childElementCount>100) $('events').lastElementChild?.remove();
  $('task').textContent=selectedTask?.slice(0,8)||'—';
  // The visual projection is never interpreted as task completion; backend remains authoritative.
  const room = evt.type==='task.queued'?'control':evt.type==='task.started'||evt.type==='hermes.tool_use'?'workshop':evt.type==='hermes.system'?'library':evt.type==='hermes.tool_result'||evt.type==='hermes.result'?'laboratory':evt.type==='task.completed'||evt.type==='task.failed'?'archive':null;
  if(room && scene){ const activity=evt.type==='task.completed'?'recording':evt.type==='task.failed'?'failed':evt.type==='task.queued'?'planning':evt.type==='hermes.system'?'researching':evt.type==='hermes.result'?'evaluating':evt.type==='hermes.tool_result'?'reviewing':'coding';scene.moveTo(room,activity); }
}
class WorldScene extends Phaser.Scene {
  private hero!:Phaser.GameObjects.Container;
  private motion?:Phaser.Tweens.Tween;
  private room:RoomId='rest';
  constructor(){super('WorldScene')}
  create(){
    const g=this.add.graphics();
    g.fillStyle(0x192e3a);g.fillRect(0,0,800,425);
    for(let y=0;y<425;y+=16){for(let x=0;x<800;x+=16){g.fillStyle((x+y)%32===0?0x233b46:0x203641);g.fillRect(x+1,y+1,14,14)}}
    for(const r of mapRooms){
      g.fillStyle(0x395866);g.fillRoundedRect(r.x,r.y,235,172,6);
      g.fillStyle(r.id==='workshop'?0x305f65:r.id==='laboratory'?0x615176:r.id==='rest'?0x4b6359:0x2d4855);g.fillRect(r.x+5,r.y+5,225,162);
      g.fillStyle(0x142632);g.fillRect(r.x+29,r.y+27,83,58);
      g.fillStyle(0x84c9bb);g.fillRect(r.x+36,r.y+34,69,39);
      g.fillStyle(0x294656);g.fillRect(r.x+42,r.y+40,57,27);
      g.fillStyle(0x9be8c4);g.fillRect(r.x+47,r.y+46,30,4);
      g.fillStyle(0x587887);g.fillRect(r.x+47,r.y+56,44,3);
      g.fillStyle(0x132833);g.fillRect(r.x+30,r.y+98,124,14);
      g.fillStyle(0x618491);g.fillRect(r.x+36,r.y+113,112,25);
      this.add.text(r.x+118,r.y+150,r.label,{fontFamily:'monospace',fontSize:'12px',color:'#cce8e1'}).setOrigin(.5);
      const zone=this.add.zone(r.x+117,r.y+86,235,172).setInteractive({useHandCursor:true});
      zone.on('pointerdown',()=>{$('room-info').textContent=`${r.label}: ${r.description}`;});
    }
    this.hero=this.add.container(0,0);
    const h=this.add.graphics();
    h.fillStyle(0x9fd6d3);h.fillRect(-11,-16,22,22);h.fillStyle(0x163846);h.fillRect(-8,-11,16,12);
    h.fillStyle(0x8af5b9);h.fillRect(-5,-7,3,3);h.fillRect(3,-7,3,3);
    h.fillStyle(0xa3b8cb);h.fillRect(-11,7,22,13);h.fillStyle(0x657a91);h.fillRect(-8,20,6,6);h.fillRect(2,20,6,6);
    this.hero.add(h);this.hero.setDepth(10);
    this.hero.setPosition(centers.rest.x,centers.rest.y);
    this.add.text(8,406,'HERMES LIFE • LIVE EVENTS',{fontFamily:'monospace',fontSize:'10px',color:'#a1c9c5'});
    scene=this;
    void hydrate();
  }
  moveTo(roomName:string, activity:string, immediate=false){
    if(!(roomName in centers))return;
    const room=roomName as RoomId;
    this.room=room;
    $('room').textContent=room.toUpperCase();$('activity').textContent=activity;
    this.motion?.stop();const to=centers[room];
    if(immediate){this.hero.setPosition(to.x,to.y);return;}
    this.motion=this.tweens.add({targets:this.hero,x:to.x,y:to.y,duration:650,ease:'Sine.easeInOut'});
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
    connect();
  } catch(e){$('connection').textContent='API unavailable — retrying';setTimeout(hydrate,3000)}
}
function appendHistorical(evt:EventRecord){ appendEvent(evt); }
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
    const response=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});
    const body=await response.json();if(!response.ok)throw Error(body.detail||response.statusText);
    $('task-feedback').textContent=`Task accepted: ${body.id}`;($('prompt') as HTMLTextAreaElement).value='';
    void loadTask(body.id);void refreshHistory();
  }catch(error){$('task-feedback').textContent=String(error)}
});

$('refresh-history').addEventListener('click',()=>void refreshHistory());
// Status polling handles missed WebSocket messages and task updates after disconnection.
setInterval(()=>{if(viewedTaskId)void loadTask(viewedTaskId)},3000);
