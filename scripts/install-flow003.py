#!/usr/bin/env python3
"""Safe additive HL-FLOW-003 installer; refuse unknown app / frontend layouts."""
from datetime import datetime
from pathlib import Path
import ast
import shutil

root = Path(__file__).resolve().parents[1]
app = root / 'hermes_life/app.py'
discovery = root / 'hermes_life/discovery.py'
module = root / 'hermes_life/curiosity_workflow.py'
frontend = root / 'frontend/src/phase41301-rework.ts'
for p in (app, discovery, module, frontend):
    if not p.is_file():
        raise SystemExit(f'Required file missing: {p}')
a = app.read_text()
f = frontend.read_text()
d = discovery.read_text()
if 'register_curiosity_workflow_routes' in a:
    raise SystemExit('HL-FLOW-003 already installed; no changes made')
if "row['proposed_prompt']" in d[d.find('def transition('):]:
    raise SystemExit('Unsafe old discovery approval detected: install HL-FLOW-001 first')

# We replace only the standalone REMOTE_SCAN literal, preserving the host's
# discovery fingerprint, transition, project context and all other code.
start = d.find("REMOTE_SCAN = r'''")
if start == -1:
    raise SystemExit('Unknown discovery scan format; no files modified')
end = d.find("'''", start + len("REMOTE_SCAN = r'''"))
if end == -1:
    raise SystemExit('Unterminated discovery scan; no files modified')
remote = (root / 'scripts/flow003-remote-scan.py').read_text()
new_d = d[:start] + "REMOTE_SCAN = r'''\n" + remote.rstrip() + "\n'''" + d[end + 3:]

old_import = 'from .decision import DecisionEngine'
if a.count(old_import) != 1:
    raise SystemExit('App import anchor missing; no files modified')
new_a = a.replace(old_import, old_import + '\nfrom .curiosity_workflow import register_routes as register_curiosity_workflow_routes  # HL_FLOW_003', 1)
# Insert new routes after original curiosity GET but before dynamic /{ident}/{state}.
anchor = "    @app.post('/api/curiosity/{ident}/{state}')"
if new_a.count(anchor) != 1:
    raise SystemExit('Curiosity route anchor missing; no files modified')
new_a = new_a.replace(anchor, "    register_curiosity_workflow_routes(app, runtime, discovery)  # HL_FLOW_003\n\n" + anchor, 1)

# Frontend: retain current dashboard and only change the curiosity fetch and
# action rendering. No second UI is added.
old_fetch = "endpoint('/curiosity')"
if f.count(old_fetch) != 1:
    raise SystemExit('Curiosity fetch anchor missing; no files modified')
new_f = f.replace(old_fetch, "endpoint('/curiosity/workflow')", 1)
old_actions = "const buttons=node('div','hl413r-card-actions');for(const command of curiosityMode?['open','deferred','dismissed']:['approve','defer','dismiss']){const button=btn(command,()=>void mutate(curiosityMode?'curiosity':'discoveries',r,command));button.disabled=!r.id;buttons.append(button)}card.append(buttons);box.append(card)"
new_actions = """const buttons=node('div','hl413r-card-actions');
    if(curiosityMode){
      const quality=text(r.quality),qualityReason=text(r.quality_reason);
      const status=text(r.investigation_status);
      card.append(node('p','hl413r-muted',`Investigation: ${status || 'not started'}${r.goal_id||r.discovery_goal_id?' · Goal '+val(r.discovery_goal_id||r.goal_id).slice(0,8):''}${quality==='excluded'?' · Needs review: '+qualityReason:''}`));
      if(r.can_investigate===true){buttons.append(btn('Investigate',()=>void investigate(r)))}
      if(r.task_id){buttons.append(btn('View findings',()=>window.dispatchEvent(new CustomEvent('hermes:open-task',{detail:{id:val(r.task_id)}}))))}
      if(r.plan_id){buttons.append(btn('View plan',()=>{
        const t=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(x=>x.textContent?.trim()==='Planning'&&!x.closest('#chat-panel'));
        t?.click();
      }))}
      for(const command of ['open','deferred','dismissed']){
        const button=btn(command==='open'?'Reopen':command==='deferred'?'Defer':'Dismiss',()=>void mutate('curiosity',r,command));
        button.disabled=!r.id||command===state(r);buttons.append(button)
      }
    }else{
      for(const command of ['approve','defer','dismiss']){
        const button=btn(command,()=>void mutate('discoveries',r,command));button.disabled=!r.id;buttons.append(button)
      }
    }
    card.append(buttons);box.append(card)"""
if new_f.count(old_actions) != 1:
    raise SystemExit('Curiosity rendering anchor missing; no files modified')
new_f = new_f.replace(old_actions, new_actions, 1)
new_f = new_f.replace("'open','new','proposed','pending','approved','queued','running'", "'open','new','proposed','pending','approved','queued','running','investigating'")
# Treat historical, low-quality records as history rather than current work.
filter_anchor = "const pick=(r:R)=>filter==='history'?!active(r):filter==='new'?unseen(r):active(r);"
filter_replacement = r"""const qualifies=(r:R)=>{
 if(r.quality==='excluded'||r.quality==='missing')return false;
 if(r.quality==='eligible')return true;
 const path=text(r.path).toLowerCase();
 const parts=path.split('/');const filename=parts[parts.length-1]||'';
 if(parts.some(p=>['tests','__tests__','fixtures','node_modules','.venv','dist','build'].includes(p))||filename.startsWith('test_')||/\.(test|spec)\.(ts|js)$/.test(filename))return false;
 const note=text(r.note).trim();
 if(note.includes('{item[')||note.includes('INSERT INTO discoveries')||note.includes('${'))return false;
 return /^(?:#|\/\/|\/\*|\*)\s*(?:TODO|FIXME)\b/i.test(note);
};
const pick=(r:R)=>filter==='history'?(!active(r)||!qualifies(r)):filter==='new'?(unseen(r)&&qualifies(r)):(active(r)&&qualifies(r));"""
if new_f.count(filter_anchor) != 1:
    raise SystemExit('Discover relevance anchor missing; no files modified')
new_f = new_f.replace(filter_anchor, filter_replacement, 1)
new_f = new_f.replace("String(ds.filter(active).length)", "String(ds.filter(r=>active(r)&&qualifies(r)).length)")
new_f = new_f.replace("String([...ds,...qs].filter(unseen).length)", "String([...ds,...qs].filter(r=>unseen(r)&&qualifies(r)).length)")
new_f = new_f.replace("String(qs.length)", "String(qs.filter(qualifies).length)")

old_mutate = ' async function scan(){'
if new_f.count(old_mutate) != 1:
    raise SystemExit('UI action anchor missing; no files modified')
new_f = new_f.replace(old_mutate, """ async function investigate(r:R){
  if(!window.confirm('Approve a read-only investigation for this question?'))return;
  notice='Creating linked read-only investigation…';render();
  try{const result=await endpoint(`/curiosity/${encodeURIComponent(val(r.id))}/investigate`,'POST') as R;
      notice='Investigation requested · Goal '+val(result.goal_id).slice(0,8);await refresh();}
  catch(e){notice='Investigation rejected: '+val(e);render()}
 }
""" + old_mutate, 1)

try:
    ast.parse(new_a); ast.parse(new_d); ast.parse(module.read_text())
except SyntaxError as exc:
    raise SystemExit(f'Python syntax validation failed: {exc}; no files modified')
stamp=datetime.now().strftime('%Y%m%d-%H%M%S')
for p in (app,discovery,frontend):
    shutil.copy2(p,p.with_name(p.name+'.before-flow003-'+stamp))
app.write_text(new_a)
discovery.write_text(new_d)
frontend.write_text(new_f)
print('Installed HL-FLOW-003. Backups created. Run pytest, frontend build and restart backend.')
