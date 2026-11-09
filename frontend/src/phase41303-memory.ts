/** HL-PERS-001 §5F / §7 #8, #9 — inspect, correct and invalidate the learned profile.
 *
 * The routes for this already existed; nothing in the product reached them. This surface lists what
 * Hermes has learned (with the evidence and origin behind each memory), what is awaiting review, the
 * technical lessons it has drawn, and why the profile last changed — and it can act on all of it.
 *
 * Two rules it must not break: a correction always carries a reason (the API refuses otherwise), and
 * the outcome is reported on the persona card, so the result is visible where the profile is shown.
 */
import './phase41303-memory.css';
import { makeRefresh } from './refresh-feedback.ts';

type Obj = Record<string,unknown>;
const el = (id:string) => document.getElementById(id);
const str = (v:unknown) => typeof v === 'string' ? v : String(v ?? '');
const rows = (v:unknown, key:string):Obj[] => {
  const value = v && typeof v === 'object' ? (v as Obj)[key] : null;
  return Array.isArray(value) ? value as Obj[] : [];
};
const box = (tag:string, text:string, cls='') => { const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n; };
const button = (label:string, cls:string, act:()=>void) => {
  const n = box('button', label) as HTMLButtonElement; n.type = 'button'; if (cls) n.className = cls;
  n.addEventListener('click', act); return n;
};
const when = (value:unknown) => {
  if (!value) return '';
  const date = new Date(str(value));
  return Number.isFinite(date.valueOf()) ? date.toLocaleString() : str(value);
};
async function api(path:string, method='GET', body?:unknown){
  const init:RequestInit = body === undefined ? {method} : {method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)};
  const response = await fetch('/api'+path, init);
  const raw = await response.text();
  let value:unknown;
  try { value = raw ? JSON.parse(raw) : null } catch { value = raw }
  if (!response.ok) throw new Error(`${response.status}: ${typeof value === 'object' && value && 'detail' in value ? str((value as Obj).detail) : str(value).slice(0,220)}`);
  return value;
}

const ORIGIN = (row:Obj) => str(row.origin) === 'explicit' ? 'stated by the user'
  : str(row.origin) === 'inferred' ? 'inferred by Hermes' : 'origin not recorded';
const actor = () => str((el('memory-correct-actor') as HTMLInputElement | null)?.value).trim() || 'user';

let profile:Obj[] = [], reviews:Obj[] = [], lessons:Obj[] = [], history:Obj[] = [];
let target:Obj|null = null;

function line(label:string, value:string){
  if (!value) return null;
  const node = box('p','','memory-line');
  node.append(box('span', label, 'memory-label'), document.createTextNode(value));
  return node;
}
/** Evidence and origin, or an explicit statement that neither exists. */
function provenance(row:Obj){
  const origin = ORIGIN(row);
  const evidence = str(row.evidence_excerpt);
  return evidence ? `${origin} · evidence: “${evidence}”` : `${origin} · no evidence recorded`;
}
function correctionRow(correction:Obj){
  const node = box('article','','memory-row');
  node.append(box('p', `${str(correction.action)} · ${str(correction.actor)} · ${when(correction.created_at)}`,'memory-meta'));
  node.append(box('p', str(correction.rationale)) as HTMLElement);
  const into = str(correction.new_memory_id);
  if (into) node.append(box('p', `→ ${into.slice(0,8)}`,'memory-meta'));
  return node;
}

function renderProfile(){
  const host = el('memory-profile-list'); if (!host) return;
  host.replaceChildren();
  if (!profile.length) { host.append(box('p','Nothing learned yet — no active memories.','hint')); return }
  for (const memory of profile){
    const node = box('article','','memory-row');
    const head = box('p','','memory-meta');
    head.append(box('span', str(memory.kind), 'memory-kind'), document.createTextNode(correctionNote(memory)));
    node.append(head, box('p', str(memory.content), 'memory-content'));
    node.append(box('p', provenance(memory), 'memory-provenance'));
    const actions = box('div','','memory-actions');
    actions.append(
      button('Replace','memory-action',() => openForm(memory,'supersede')),
      button('Merge…','memory-action',() => openForm(memory,'merge')),
      button('Invalidate','memory-action danger',() => openForm(memory,'delete')));
    node.append(actions);
    host.append(node);
  }
}
function correctionNote(memory:Obj){
  const why = str(memory.rationale), who = str(memory.decided_by);
  return why ? ` · corrected${who ? ' by '+who : ''}: ${why}` : '';
}
function renderReviews(){
  const host = el('memory-review-list'); if (!host) return;
  host.replaceChildren();
  const pending = reviews.filter(row => str(row.status) === 'pending');
  if (!pending.length) { host.append(box('p','No candidates awaiting review.','hint')); return }
  for (const review of pending){
    const node = box('article','','memory-row');
    node.append(box('p', `candidate · ${str(review.reason)}`, 'memory-meta'));
    node.append(box('p', str(review.candidate), 'memory-content'));
    node.append(box('p', review.evidence_excerpt ? `${ORIGIN(review)} · evidence: “${str(review.evidence_excerpt)}”`
      : `${ORIGIN(review)} · no evidence recorded`, 'memory-provenance'));
    if (review.existing_memory_id){
      const existing = profile.find(row => row.id === review.existing_memory_id);
      node.append(box('p', existing ? `Current memory: ${str(existing.content)}` : `Current memory ${str(review.existing_memory_id).slice(0,8)} is no longer active`, 'memory-provenance'));
    }
    const reason = box('input','') as HTMLInputElement;
    reason.placeholder = 'Reason (required to merge)'; reason.maxLength = 500; reason.className = 'memory-reason';
    reason.setAttribute('aria-label','Reason for resolving this review');
    const actions = box('div','','memory-actions');
    const resolve = (decision:string) => () => resolveReview(review, decision, reason.value);
    actions.append(button('Accept','memory-action',resolve('accept')),
                   button('Reject','memory-action',resolve('reject')),
                   button('Merge into current','memory-action',resolve('merge')));
    node.append(reason, actions);
    host.append(node);
  }
}
function renderLessons(){
  const host = el('memory-lesson-list'); if (!host) return;
  host.replaceChildren();
  if (!lessons.length) { host.append(box('p','No technical lessons recorded.','hint')); return }
  for (const lesson of lessons){
    const node = box('article','','memory-row');
    node.append(box('p', `${str(lesson.state)} · reused ${str(lesson.reuse_count)}× · ${str(lesson.evidence_count)} evidence entries`, 'memory-meta'));
    node.append(box('p', str(lesson.lesson), 'memory-content'));
    const detail = [str(lesson.topic), str(lesson.applicability)].filter(Boolean).join(' · ');
    if (detail) node.append(box('p', detail, 'memory-provenance'));
    if (lesson.evidence_excerpt) node.append(box('p', `evidence: “${str(lesson.evidence_excerpt)}”`, 'memory-provenance'));
    host.append(node);
  }
}
function renderHistory(){
  const host = el('memory-history-list'); if (!host) return;
  host.replaceChildren();
  if (!history.length) { host.append(box('p','No corrections recorded yet.','hint')); return }
  for (const correction of history) host.append(correctionRow(correction));
}

/** The form is the single place a correction happens, so it always states its target. */
function openForm(memory:Obj, action:string){
  target = memory;
  const form = el('memory-correct-form') as HTMLFormElement | null; if (!form) return;
  (el('memory-correct-action') as HTMLSelectElement).value = action;
  (el('memory-correct-content') as HTMLTextAreaElement).value = action === 'supersede' ? str(memory.content) : '';
  const merge = el('memory-correct-merge') as HTMLSelectElement;
  merge.replaceChildren();
  for (const other of profile.filter(row => row.id !== memory.id)){
    const option = document.createElement('option');
    option.value = str(other.id); option.textContent = `${str(other.kind)}: ${str(other.content).slice(0,70)}`;
    merge.append(option);
  }
  const host = el('memory-correct-target');
  if (host) host.textContent = `Correcting: ${str(memory.content)}`;
  syncForm();
  form.hidden = false;
  (el('memory-correct-rationale') as HTMLInputElement | null)?.focus();
}
function closeForm(){
  target = null;
  const form = el('memory-correct-form') as HTMLFormElement | null;
  if (form) form.hidden = true;
}
/** Only the fields the chosen action actually uses are shown. */
function syncForm(){
  const action = (el('memory-correct-action') as HTMLSelectElement | null)?.value || 'supersede';
  const merge = el('memory-merge-label'), content = el('memory-content-label');
  if (merge) merge.hidden = action !== 'merge';
  if (content) content.hidden = action !== 'supersede';
}
function feedback(message:string, phase='ok'){
  const host = el('memory-feedback');
  if (host) { host.textContent = message; host.dataset.phase = phase }
  // The persona card is where the profile is shown, so the outcome is reported there too.
  const persona = el('persona-feedback');
  if (persona) persona.textContent = message;
}
function reason():string { return str((el('memory-correct-rationale') as HTMLInputElement | null)?.value).trim() }

async function submitCorrection(event:Event){
  event.preventDefault();
  if (!target) return;
  const action = (el('memory-correct-action') as HTMLSelectElement).value;
  const newContent = str((el('memory-correct-content') as HTMLTextAreaElement).value).trim();
  const mergeInto = str((el('memory-correct-merge') as HTMLSelectElement).value);
  if (reason().length < 4) return feedback('A correction needs a reason (at least 4 characters).','error');
  if (action === 'supersede' && newContent.length < 4) return feedback('The replacement wording must be at least 4 characters.','error');
  if (action === 'merge' && !mergeInto) return feedback('Choose the memory this one duplicates.','error');
  const payload:Obj = {action, rationale:reason(), actor:actor()};
  if (action === 'supersede') payload.new_content = newContent;
  if (action === 'merge') payload.merge_into = mergeInto;
  try {
    const result = await api(`/personality/profile/${encodeURIComponent(str(target.id))}/correct`,'POST',payload) as Obj;
    const word = str(result.action);
    closeForm();
    feedback(`Memory ${word}. Future tasks are told the corrected profile.`);
    await load();
  } catch (error){ feedback(`Correction failed: ${str(error)}`,'error') }
}
async function resolveReview(review:Obj, decision:string, rationale:string){
  if (decision === 'merge' && rationale.trim().length < 4){
    return feedback('Merging drops the candidate, so it needs a reason (at least 4 characters).','error');
  }
  try {
    await api(`/memory-reviews/${encodeURIComponent(str(review.id))}/resolve`,'POST',
      {decision, rationale:rationale.trim(), actor:actor()});
    feedback(decision === 'merge' ? 'Candidate merged — the existing memory was kept unchanged.' : `Candidate ${decision}ed.`);
    await load();
  } catch (error){ feedback(`Could not resolve the review: ${str(error)}`,'error') }
}

const refresh = makeRefresh({
  noun: 'entries',
  count: () => profile.length + reviews.length + lessons.length + history.length,
  load: async () => {
    const [a,b,c,d] = await Promise.all([
      api('/personality/profile'), api('/memory-reviews'), api('/technical-lessons?limit=20'),
      api('/memory-corrections?limit=20'),
    ]);
    return {a,b,c,d};
  },
  apply: (data) => {
    const payload = data as {a:Obj;b:Obj;c:Obj;d:Obj};
    profile = rows(payload.a,'profile');
    reviews = rows(payload.b,'reviews');
    lessons = rows(payload.c,'lessons');
    history = rows(payload.d,'corrections');
  },
  onChange: () => { renderProfile(); renderReviews(); renderLessons(); renderHistory() },
});
async function load(){
  await refresh.run();
  const label = el('memory-refresh');
  if (label) label.textContent = refresh.label();
  if (refresh.phase === 'error') feedback(refresh.statusText(),'error');
}
function paint(){
  renderProfile(); renderReviews(); renderLessons(); renderHistory();
  const label = el('memory-refresh');
  if (label) label.textContent = refresh.label();
}

if (el('memory-section')){
  el('memory-refresh')?.addEventListener('click',() => void load());
  el('memory-correct-action')?.addEventListener('change', syncForm);
  el('memory-correct-cancel')?.addEventListener('click', closeForm);
  el('memory-correct-form')?.addEventListener('submit', submitCorrection);
  paint();
  void load();
}
