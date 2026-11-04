#!/usr/bin/env python3
"""Install Phase 4.13.2 presentation and task-navigation bridge. Idempotent."""
from pathlib import Path
from datetime import datetime
import shutil
root=Path(__file__).resolve().parents[1]
main=root/'frontend/src/main.ts'
module=root/'frontend/src/phase41302-workflow.ts'
css=root/'frontend/src/phase41302-workflow.css'
for p in (main,module,css):
    if not p.is_file():raise SystemExit(f'Missing {p}')
s=main.read_text()
if "import './phase41302-workflow';" not in s:
    if 'async function loadTask(' not in s or 'function setFollowLive(' not in s:
        raise SystemExit('Current main.ts has no expected task viewer; no changes made.')
    backup=main.with_name('main.ts.before-phase41302-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
    shutil.copy2(main,backup)
    s += '''
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
'''
    main.write_text(s)
    print('Added module import and task viewer bridge. Backup:',backup)
else:print('UI module already installed.')
# Enhance discover metric cards if the prior replacement is installed.
rework=root/'frontend/src/phase41301-rework.ts'
if rework.exists():
    s=rework.read_text()
    target="for(const [k,v] of items){const m=node('div','hl413r-metric');m.append(node('strong','',v),node('span','',k));metrics.append(m)}"
    replacement="""for(const [k,v] of items){
   const m=node('div','hl413r-metric');
   if(k==='Questions'||k==='Unseen'||k==='Active findings'){
    const b=btn(`${v} ${k} · View`,()=>{
      if(k==='Unseen')filter='new';else filter='active';
      render();
      const groups=Array.from(sections.querySelectorAll<HTMLElement>('.hl413r-group'));
      (k==='Questions'?groups[1]:groups[0])?.scrollIntoView({behavior:'smooth',block:'start'});
    });b.className='hl413r-metric-button';m.append(b);
   }else{m.append(node('strong','',v),node('span','',k))}
   metrics.append(m)
  }"""
    if target in s:
        backup=rework.with_name('phase41301-rework.ts.before-phase41302-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
        shutil.copy2(rework,backup);rework.write_text(s.replace(target,replacement,1));print('Made Discover metrics navigable. Backup:',backup)
    elif "hl413r-metric-button" not in s:print('NOTE: Discover metric expression differs; left unchanged.')
print('Installation completed. Run: cd frontend && npm run build')
