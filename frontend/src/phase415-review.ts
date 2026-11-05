/** HL-FLOW-005: one coherent Planning/Build status, evidence and approval surface. */
import './phase415-review.css';
type Rec=Record<string,unknown>;
const $=(id:string)=>document.getElementById(id);
const s=(x:unknown)=>typeof x==='string'?x:String(x??'');
const list=(x:unknown):Rec[]=>Array.isArray(x)?x as Rec[]:(x&&typeof x==='object'?((x as Rec).items as Rec[]||[]):[]);
const node=(tag:string,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n};
const btn=(label:string,cb:()=>void)=>{const b=node('button',label) as HTMLButtonElement;b.type='button';b.addEventListener('click',cb);return b};
const stamp=(x:unknown)=>{const d=new Date(s(x));return Number.isFinite(d.getTime())?d.toLocaleString():'Unknown'};
async function api(path:string,method='GET',body?:unknown):Promise<unknown>{
 const res=await fetch('/api'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const raw=await res.text();let parsed:unknown;try{parsed=JSON.parse(raw)}catch{parsed=raw}
 if(!res.ok){let detail=parsed;if(parsed&&typeof parsed==='object'&&'detail' in parsed)detail=(parsed as Rec).detail;throw new Error(`${res.status}: ${s(detail).slice(0,500)}`)}
 return parsed;
}
const report=(p:Rec):Rec=>{try{const v=typeof p.report==='string'?JSON.parse(p.report):p.report;return v&&typeof v==='object'&&!Array.isArray(v)?v as Rec:{}}catch{return {}}};
const arr=(x:unknown):string[]=>Array.isArray(x)?x.map(s):[];
function bullets(parent:HTMLElement,title:string,values:string[]){if(!values.length)return;parent.append(node('h4',title));const ul=node('ul');values.forEach(v=>ul.append(node('li',v)));parent.append(ul)}
function status(run?:Rec,decision?:Rec){
 if(decision){const d=s(decision.decision);return d==='accepted'?'Accepted for separate application':d==='rejected'?'Rejected':'Revision requested'}
 if(!run)return 'Approved · implementation not started';
 const st=s(run.state);
 return ({preparing:'Preparing isolated workspace',testing_baseline:'Testing original baseline',implementing:'Hermes is editing candidate',evaluating:'Running independent evaluation',candidate_passed:'Candidate passed · awaiting human review',candidate_failed:'Candidate tests failed',evaluation_error:'Test environment/evaluator error',failed:'Implementation failed'} as Record<string,string>)[st]||st;
}
const busyStates=new Set(['preparing','testing_baseline','implementing','evaluating']);
let plans:Rec[]=[],runs:Rec[]=[],decisionMap=new Map<string,Rec>(),revisionMap=new Map<string,Rec>(),last='',error='',loading=false;
let reviewRun:Rec|null=null,reviewData:Rec|null=null,revisionData:Rec|null=null,reviewError='',decisionMessage='',requestBusy=false;
let editingPlanId:string|null=null; // track which plan's input is being edited
function track(plan:Rec){return runs.find(r=>s(r.plan_id)===s(plan.id))}
function stateMessage(plan:Rec){const r=track(plan);const d=r?decisionMap.get(s(r.id)):undefined;
 if(s(plan.state)==='proposed')return 'Awaiting your plan approval. No coding has started.';
 if(!r)return 'Approved, but no implementation has started. Starting a candidate requires a project and an explicit request.';
 if(busyStates.has(s(r.state)))return 'Hermes is currently working. This status is refreshed automatically.';
 if(d)return 'Review decision recorded. Original project and host were not modified.';
 if(s(r.state)==='candidate_passed')return 'Independent candidate tests passed; review the code diff and each acceptance criterion.';
 if(s(r.state)==='evaluation_error')return 'Evaluation could not complete. Inspect the test runner and reevaluate the candidate.';
 if(s(r.state)==='candidate_failed')return 'Tests ran and failed. Inspect evidence or request a revision.';
 return s(r.error)||'Execution stopped; open Build for full details.';
}
function showTask(id:string){window.dispatchEvent(new CustomEvent('hermes:open-task',{detail:{id}}))}
function renderPlanning(){const root=$('hl415-planning');if(!root)return;root.replaceChildren();
 const head=node('div','','hl415-head');head.append(node('h2','Plans & implementation status'),btn('Refresh',()=>void refresh()));root.append(head);
 root.append(node('p',error||`${plans.length} plans · ${runs.length} implementation runs · Refreshed ${stamp(last)}`,'hl415-caption'));
 if(!plans.length){root.append(node('p',loading?'Loading plans…':'No investigation plans found.','hl415-status'));return}
 for(const p of plans){const r=track(p);const d=r?decisionMap.get(s(r.id)):undefined;const spec=report(p);
  const card=node('article','','hl415-card');const top=node('div','','hl415-row');top.append(node('strong',s(spec.summary).slice(0,200)||`Plan ${s(p.id).slice(0,8)}`),node('span',status(r,d),'hl415-chip'));card.append(top);
  card.append(node('p',`Plan ${s(p.id).slice(0,8)} · Created ${stamp(p.created_at)} · Approved ${p.approved_at?stamp(p.approved_at):'No'} · ${r?'Run '+s(r.id).slice(0,8):'No run'}`,'hl415-caption'));
  card.append(node('p',stateMessage(p),'hl415-status'));
  const details=document.createElement('details');details.append(node('summary','Actual plan: steps, evidence & acceptance criteria'));
  bullets(details,'Implementation steps',arr(spec.steps));bullets(details,'Acceptance criteria',arr(spec.acceptance_criteria));bullets(details,'Evidence',arr(spec.evidence));bullets(details,'Risks',arr(spec.risks));card.append(details);
  const actions=node('div','','hl415-actions');
  if(p.task_id)actions.append(btn('Investigation answer',()=>showTask(s(p.task_id))));
  if(s(p.state)==='proposed')actions.append(btn('Approve plan',()=>{details.open=true;if(!confirm('Approve this plan? Approval authorizes isolated implementation only; it does not modify host source.'))return;void action(`/investigation-plans/${encodeURIComponent(s(p.id))}/approve`,'POST')}));
  if(s(p.state)==='approved'&&!r){
    const wrap=node('div','','hl415-actions');
    const input=node('input') as HTMLInputElement;
    input.type='text';
    input.placeholder='VM project name (e.g. hermes-life-test)';
    input.setAttribute('aria-label','VM project name');
    const planId=s(p.id);
    // If this plan was being edited, restore its value
    if(editingPlanId===planId && input.dataset.savedValue){
      input.value=input.dataset.savedValue;
    }
    input.addEventListener('focus',()=>{editingPlanId=planId});
    input.addEventListener('input',()=>{
      input.dataset.savedValue=input.value;
    });
    input.addEventListener('blur',()=>{
      input.dataset.savedValue=input.value;
      if(editingPlanId===planId) editingPlanId=null;
    });
    const b=btn('Start isolated implementation',()=>{
      if(!input.value.trim())return alert('Enter a VM project name.');
      if(!confirm(`Start approved implementation in VM project ${input.value.trim()}?`))return;
      b.disabled=true;void api(`/implementations/from-plan/${encodeURIComponent(planId)}`,'POST',{project:input.value.trim()}).then(()=>void refresh()).catch(e=>{error=s(e);renderAll()}).finally(()=>{b.disabled=false});
    });
    wrap.append(input,b);
    card.append(wrap)
  }
  if(r)actions.append(btn('View in Build',()=>{document.querySelector<HTMLButtonElement>('[data-tab="build"]')?.click();document.getElementById('hl415-run-'+s(r.id))?.scrollIntoView({block:'nearest'});if(!document.getElementById('hl415-run-'+s(r.id)))openReview(r)}));
  card.append(actions);root.append(card);
 }
}
function executionSteps(st:string){const stages=['Prepare','Baseline','Implement','Evaluate','Review'];const idx=({preparing:0,testing_baseline:1,implementing:2,evaluating:3,candidate_passed:4,candidate_failed:4,evaluation_error:4,failed:4} as Record<string,number>)[st]??4;
 const row=node('div','','hl415-progress');stages.forEach((label,i)=>row.append(node('span',label,i===idx?'current':'')));return row}
function renderBuild(){const root=$('hl415-build');if(!root)return;root.replaceChildren();const head=node('div','','hl415-head');head.append(node('h2','Build · candidate evaluations'),btn('Refresh',()=>void refresh()));root.append(head);
 root.append(node('p',`${runs.length} implementation runs · Refreshed ${stamp(last)} · Host changes require separate application`,'hl415-caption'));
 if(!runs.length){root.append(node('p','No candidate runs yet. Approve a plan in Planning and start its isolated implementation.','hl415-status'));return}
 for(const run of runs){const d=decisionMap.get(s(run.id));const revisions=revisionMap.get(s(run.id));const attempts=Array.isArray(revisions?.attempts)?revisions!.attempts as Rec[]:[];const card=node('article','','hl415-card');card.id='hl415-run-'+s(run.id);
  const top=node('div','','hl415-row');top.append(node('strong',s(run.project)),node('span',status(run,d),'hl415-chip'));card.append(top);
  card.append(executionSteps(s(run.state)));if(attempts.length){const a=attempts[0];card.append(node('p',`Latest revision #${s(a.attempt)}: ${s(a.state)} · ${stamp(a.updated_at)}`,'hl415-status'));if(a.error)card.append(node('p',s(a.error),'hl415-error'))}
  card.append(node('p',`Run ${s(run.id)} · Plan ${s(run.plan_id).slice(0,8)} · Started ${stamp(run.created_at)} · Updated ${stamp(run.updated_at)}`,'hl415-caption'));
  if(run.error)card.append(node('p',s(run.error),'hl415-error'));
  const test=node('details');test.append(node('summary','Test results & Hermes report'));
  for(const key of ['baseline_json','candidate_json'] as const){let parsed:Rec={};try{parsed=JSON.parse(s(run[key]||'{}')) as Rec}catch{};
   test.append(node('h4',key==='baseline_json'?'Baseline tests':'Candidate tests'));
   test.append(node('p',`Status: ${s(parsed.status||'not evaluated')} · Exit: ${s(parsed.exit_code)} · Interpreter: ${s(parsed.python)}`,'hl415-caption'));
   test.append(node('pre',s(parsed.output)||'No test output'));
  }
  test.append(node('h4','Hermes implementation response'));test.append(node('pre',s(run.response)||'Not available'));card.append(test);
  const actions=node('div','','hl415-actions');actions.append(btn('Review candidate changes',()=>void openReview(run)));
  if(!d&&['candidate_passed','candidate_failed','evaluation_error'].includes(s(run.state)))actions.append(btn('Reevaluate tests',()=>void action(`/implementations/${encodeURIComponent(s(run.id))}/reevaluate`,'POST')));
  card.append(actions);root.append(card);
 }
}
async function action(path:string,method:string,body?:unknown){error='';try{await api(path,method,body);await refresh()}catch(e){error=s(e);renderAll()}}
async function openReview(run:Rec){reviewRun=run;reviewData=null;revisionData=null;reviewError='';decisionMessage='';renderReview();try{const [review,revisions]=await Promise.all([api(`/implementations/${encodeURIComponent(s(run.id))}/review`),api(`/implementations/${encodeURIComponent(s(run.id))}/revisions`)]);reviewData=review as Rec;revisionData=revisions as Rec}catch(e){reviewError=s(e)}renderReview()}
function renderReview(){let root=$('hl415-review');if(!root){root=node('section','','hl415');root.id='hl415-review';const anchor=$('hl415-build');if(anchor)anchor.insertAdjacentElement('afterend',root);else document.body.append(root)}
 root.replaceChildren();if(!reviewRun){root.hidden=true;return}root.hidden=false;
 const head=node('div','','hl415-head');head.append(node('h2','Candidate review — '+s(reviewRun.project)),btn('Close review',()=>{reviewRun=null;renderReview()}));root.append(head);
 if(reviewError)root.append(node('p',reviewError,'hl415-error'));
 if(!reviewData){root.append(node('p','Loading live VM snapshot and approval criteria…','hl415-status'));return}
 const data=reviewData;const run=data.run as Rec;const candidate=data.candidate as Rec;const baseline=data.baseline as Rec;const plan=data.plan as Rec;const snapshot=data.snapshot as Rec|null;const previous=data.decision as Rec|null;
 root.append(node('p',`Candidate tests: ${s(candidate?.status||run?.state)} · Baseline: ${s(baseline?.status||'unknown')} · ${s(snapshot?.changed_files??0)} changed files`,'hl415-status'));
 if(s(baseline?.status)!=='passed')root.append(node('p','Baseline test evaluation did not pass. Confirm behavioral equivalence separately before acceptance.','hl415-error'));
 const attempts=Array.isArray(revisionData?.attempts)?revisionData!.attempts as Rec[]:[];
 if(attempts.length){const latest=attempts[0];root.append(node('p',`Revision attempt ${s(latest.attempt)} · ${s(latest.state)} · ${stamp(latest.updated_at)}`,'hl415-status'));if(latest.error)root.append(node('p',s(latest.error),'hl415-error'));if(latest.test_json){let evidence:Rec={};try{evidence=JSON.parse(s(latest.test_json)) as Rec}catch{}root.append(node('pre',s(evidence.output)||'No test output'))}}
 if(!previous&&attempts.length&&['tests_failed','evaluation_error','error'].includes(s(attempts[0].state))){
  const history=Array.isArray(revisionData?.review_history)?revisionData!.review_history as Rec[]:[];
  if(history.some(h=>s(h.decision)==='revision_requested'))
   root.append(node('p','The previous revision request is closed after failed attempts. You can Reject this candidate or explicitly Request a new revision with updated feedback.','hl415-status'));
 }
 if(previous){root.append(node('p',`Decision recorded: ${s(previous.decision)} · ${stamp(previous.decided_at)}`,'hl415-good'));
   if(s(previous.decision)==='revision_requested'&&attempts.length&&['tests_failed','evaluation_error','error'].includes(s(attempts[0].state))){root.append(btn('Retry isolated revision',()=>{if(!confirm('Retry the stored revision request in another isolated staging workspace?'))return;void api(`/implementations/${encodeURIComponent(s(run.id))}/revisions/retry`,'POST').then(()=>void openReview(run)).catch(e=>{reviewError=s(e);renderReview()})}))}
   root.append(node('p','Revision requests run automatically in the VM. Original projects and host remain unchanged.','hl415-caption'));return}
 if(!snapshot){root.append(node('p','No candidate workspace available for review.','hl415-error'));return}
 const details=document.createElement('details');details.open=true;details.append(node('summary',`Changed files (${s(snapshot.changed_files)}) & diff`));
 const fileNames=Array.isArray(snapshot.files)?snapshot.files as Rec[]:[];const files=node('ul');fileNames.forEach(f=>files.append(node('li',`${s(f.change)}: ${s(f.path)}`)));details.append(files,node('pre',s(snapshot.diff)||'No readable diff'));root.append(details);
 const criteria=arr(plan.acceptance_criteria);root.append(node('h3','Verify acceptance criteria'));
 const marks:HTMLInputElement[]=[];
 if(!criteria.length)root.append(node('p','This plan defines no acceptance criteria. Acceptance is unavailable.','hl415-error'));
 for(const line of criteria){const label=node('label','','hl415-check');const check=document.createElement('input');check.type='checkbox';marks.push(check);label.append(check,node('span',line));root.append(label)}
 const feedback=node('textarea') as HTMLTextAreaElement;feedback.placeholder='Review findings, reason for rejection or requested revision';feedback.setAttribute('aria-label','Review feedback');root.append(feedback);
 const actions=node('div','','hl415-actions');for(const [decision,title] of [['accepted','Accept candidate'],['rejected','Reject candidate'],['revision_requested','Request revision']] as const){const b=btn(title,()=>{
  if(requestBusy)return;
  if(decision==='accepted'&&(s(run.state)!=='candidate_passed'||!criteria.length||!marks.every(x=>x.checked))){reviewError='Accept requires passing tests and explicit confirmation of every criterion.';renderReview();return}
  if(decision!=='accepted'&&!feedback.value.trim()){reviewError='Provide feedback for rejection or revision.';root.append(node('p',reviewError,'hl415-error'));return}
  if(!confirm(`${title}? Request revision starts an isolated VM attempt automatically. It does not apply changes to the host.`))return;
  requestBusy=true;b.disabled=true;void api(`/implementations/${encodeURIComponent(s(run.id))}/review`,'POST',{
    decision,snapshot_sha256:s(snapshot.snapshot_sha256),criteria:marks.map(x=>x.checked),feedback:feedback.value
  }).then(async()=>{decisionMessage=`${title} recorded`;await refresh();await openReview(run)}).catch(e=>{reviewError=s(e);root.append(node('p',reviewError,'hl415-error'))}).finally(()=>{requestBusy=false;b.disabled=false});
 });if(decision==='accepted'&&s(run.state)!=='candidate_passed')b.disabled=true;actions.append(b)}
 root.append(actions);if(decisionMessage)root.append(node('p',decisionMessage,'hl415-good'));
}
function renderAll(){renderPlanning();renderBuild()}
async function refresh(){if(loading)return;loading=true;error='';try{
 const result=await Promise.all([api('/investigation-plans'),api('/implementations')]);plans=list(result[0]);runs=list(result[1]);
 // Fetch review decisions, do not fetch expensive VM diffs until requested.
 decisionMap=new Map();revisionMap=new Map();await Promise.all(runs.map(async r=>{const id=encodeURIComponent(s(r.id));try{const [decision,revisions]=await Promise.all([api(`/implementations/${id}/review-state`),api(`/implementations/${id}/revisions`)]);const obj=decision as Rec|null;if(obj?.decision)decisionMap.set(s(r.id),obj);revisionMap.set(s(r.id),revisions as Rec)}catch{}}));
 last=new Date().toISOString();
 }catch(e){error=s(e)}finally{loading=false;renderAll()}}
function mount(){if($('hl415-planning'))return true;
 const plansLegacy=$('hl413-plans')||$('plans-list');const buildLegacy=$('implementations-list');if(!plansLegacy||!buildLegacy)return false;
 const planning=node('section','','hl415');planning.id='hl415-planning';plansLegacy.insertAdjacentElement('beforebegin',planning);
 const build=node('section','','hl415');build.id='hl415-build';buildLegacy.insertAdjacentElement('beforebegin',build);
 // Keep old nodes alive for legacy handlers but hide their obsolete presentation.
 (plansLegacy as HTMLElement).style.display='none';buildLegacy.style.display='none';
 void refresh();window.setInterval(()=>{if(document.contains(planning))void refresh()},5000);return true;
}
let attempts=0;const timer=window.setInterval(()=>{if(mount()||++attempts>60)window.clearInterval(timer)},250);mount();

// FLOW-006: refresh open reviews only while a revision is queued or running.
setInterval(()=>{if(reviewRun&&revisionData){const a=(revisionData.attempts as Rec[]|undefined)||[];if(a.length&&['queued','running'].includes(s(a[0].state)))void openReview(reviewRun)}},5000);
