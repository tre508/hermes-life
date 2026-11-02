#!/usr/bin/env python3
"""Install a DOM activity banner + sharper Phaser rendering, preserving existing APIs."""
from pathlib import Path
from datetime import datetime
import shutil
import sys

root = Path(__file__).resolve().parents[1]
src = root / 'frontend' / 'src'
main = src / 'main.ts'
asset = root / 'scripts' / 'phase46-assets' / 'phase46-world-status.css'
css = src / 'phase46-world-status.css'
if not main.is_file() or not asset.is_file():
    sys.exit('Missing frontend/src/main.ts or Phase 4.6 asset; no modifications made.')
code = main.read_text()
marker = '// Phase 4.6: live Hermes activity banner and high-DPI world rendering.'
if marker in code:
    print('Phase 4.6 already installed.');sys.exit(0)
anchors = [
    "const $ = (id:string) => document.getElementById(id)!;",
    'function appendEvent(evt:EventRecord){',
    '  // The visual projection is never interpreted as task completion; backend remains authoritative.',
    "    this.narration=this.add.text(400,18,",
    '    this.narration.setText(',
    'new Phaser.Game({type:Phaser.AUTO,',
]
missing = [a for a in anchors if code.count(a)!=1]
if missing:
    sys.exit('Unexpected frontend version; no modifications made. Anchors missing/duplicated: '+str(missing))

insertion = '''// Phase 4.6: public execution activity, NOT private chain-of-thought.
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
  if(kind==='task.started'){updateHermesStatus('Task started · Hermes is working','running');return;}
  if(kind==='task.completed'){updateHermesStatus('Task completed · result available','completed');return;}
  if(kind==='task.failed'){updateHermesStatus('Task failed · check the task result','failed');return;}
  if(kind==='hermes.tool_use'){
    // Event schemas vary by runtime. Show a tool name only when explicitly supplied.
    const tool=[payload.tool_name,payload.tool,payload.name].find(v=>typeof v==='string' && /^[\\w.:-]{1,64}$/.test(v as string));
    updateHermesStatus(tool?`Using tool: ${tool}`:'Using Hermes tools');return;
  }
  if(kind==='hermes.tool_result'){updateHermesStatus('Tool returned · reviewing result');return;}
  if(kind==='hermes.result'){updateHermesStatus('Hermes produced a response','completed');return;}
  if(kind==='hermes.system'){updateHermesStatus('Hermes runtime active');return;}
}
'''
code=code.replace(anchors[0],anchors[0]+'\n'+insertion,1)
code=code.replace(anchors[2],"  eventStatus(evt);\n"+anchors[2],1)
code=code.replace('    this.narration=this.add.text(400,18,','    this.narration=this.add.text(400,18,',1)
# Keep the existing object for compatibility; stop rendering its bitmap text.
needle=".setOrigin(.5,0).setDepth(15);"
if code.count(needle)!=1:sys.exit('Narration object anchor changed; no modifications made.')
code=code.replace(needle,needle.replace(';','.setVisible(false);'),1)
# The DOM caption is updated by genuine events; keep room movement independent.
line='    this.narration.setText(`${persona.name||\'Hermes\'} is ${narrationByActivity[activity]||activity+\' at \'+target.label.toLowerCase()}.`);'
if line not in code:sys.exit('Narration update changed; no modifications made.')
# No need to duplicate activity text in hidden Phaser object.
# Device pixel ratio renderer improves labels while preserving the pixel-art scene.
code=code.replace('new Phaser.Game({type:Phaser.AUTO,', 'new Phaser.Game({type:Phaser.AUTO,resolution:Math.min(window.devicePixelRatio||1,2),',1)
code += '\n'+marker+'\nimport \'./phase46-world-status.css\';\n'
stamp=datetime.now().strftime('%Y%m%d-%H%M%S')
shutil.copy2(main,src/f'main.ts.before-phase46-{stamp}')
if css.exists():shutil.copy2(css,src/f'phase46-world-status.css.before-{stamp}')
shutil.copy2(asset,css)
main.write_text(code)
print('Phase 4.6 installed: real event status, crisp HTML banner, high-DPI Phaser renderer.')
