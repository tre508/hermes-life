"""Read-only VM repository discovery. Never executes repository-supplied code."""
import json
import subprocess
import shlex
from uuid import uuid4
from .store import now

# Fixed script: no paths, commands, or prompts from user input. The scanning scope is the guest's ~/projects.
REMOTE_SCAN = r'''
import json, os, pathlib, re
root=pathlib.Path('/home/hermes/projects')
found=[]
if root.is_dir():
 for repo in sorted(root.iterdir()):
  if repo.is_symlink() or not repo.is_dir(): continue
  # Bounded scan: named repositories only, no recursive symlink following.
  count=0
  for base,dirs,files in os.walk(repo,followlinks=False):
   dirs[:]=sorted(d for d in dirs if d not in {'.git','.venv','node_modules','build','dist','__pycache__'} and not pathlib.Path(base,d).is_symlink())
   if len(pathlib.Path(base).relative_to(repo).parts)>=4: dirs[:]=[]
   for file in sorted(files):
    if count>=500: break
    p=pathlib.Path(base,file)
    if p.is_symlink() or p.suffix not in {'.py','.ts','.tsx','.js','.cpp','.hpp','.h','.md','.qml'}:continue
    count+=1
    try:
     if p.stat().st_size>100000:continue
     for lineno,line in enumerate(p.read_text(encoding='utf-8',errors='replace').splitlines(),1):
      if re.search(r'\bTODO\b|\bFIXME\b',line,re.I):
       found.append({'project':repo.name,'file':str(p.relative_to(repo)),'line':lineno,'note':line.strip()[:180]})
       if len(found)>=80:break
    except (OSError,ValueError):pass
    if len(found)>=80:break
   if count>=500 or len(found)>=80:break
  if len(found)>=80:break
print(json.dumps(found))
'''

class Discovery:
 def __init__(self, runtime, autonomy):
  self.runtime=runtime
  self.autonomy=autonomy
  self.store=runtime.store

 def list(self):
  with self.store.lock:
   return [dict(r) for r in self.store.connection.execute('SELECT * FROM discoveries ORDER BY created_at DESC LIMIT 100')]

 def scan(self):
  adapter=self.runtime.adapter
  if getattr(adapter,'transport',None)!='ssh':
   raise ValueError('Discovery requires the isolated SSH VM transport')
  command=adapter._ssh_base()+['python3 -c '+shlex.quote(REMOTE_SCAN)]
  result=subprocess.run(command,capture_output=True,text=True,timeout=45,check=False)
  if result.returncode:
   raise RuntimeError('Guest scan failed: '+result.stderr[-500:])
  records=json.loads(result.stdout)
  added=0
  for item in records:
   fp=json.dumps([item['project'],item['file'],item['line'],item['note']],sort_keys=True)
   ident=str(uuid4())
   title=f"Investigate TODO in {item['project']}/{item['file']}:{item['line']}"
   prompt=(f"Inside the VM, inspect /home/hermes/projects/{item['project']}/{item['file']} "
     f"near line {item['line']}. Investigate the noted TODO/FIXME: {item['note']}. "
     "Provide a concrete problem analysis and a reproducible acceptance criterion. "
     "Do not modify files until a separate implementation goal is approved.")
   with self.store.lock:
    cur=self.store.connection.execute('INSERT OR IGNORE INTO discoveries '
      '(id,fingerprint,project,path,line,note,proposed_prompt,rationale,state,created_at,updated_at) '
      'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      (ident,fp,item['project'],item['file'],item['line'],item['note'],prompt,
       'Explicit TODO/FIXME in approved VM project directory', 'proposed',now(),now()))
    self.store.connection.commit()
   if cur.rowcount:
    added+=1
    self.store.emit('discovery.proposed',{'discovery_id':ident,'title':title,'project':item['project']})
  self.store.emit('discovery.scan_completed',{'found':len(records),'new':added})
  return {'found':len(records),'new':added}

 def transition(self,ident,action):
  if action not in ('approve','dismiss','defer'):raise ValueError('Invalid decision')
  with self.store.lock:
   row=self.store.connection.execute('SELECT * FROM discoveries WHERE id=?',(ident,)).fetchone()
   if not row:return None
   row=dict(row)
   if row['state'] not in ('proposed','deferred'):raise ValueError('Candidate already decided')
   goal=None
   if action=='approve':
    goal=self.autonomy.add(f"Investigate {row['project']}/{row['path']}:{row['line']}",row['proposed_prompt'],40)
   state={'approve':'approved','dismiss':'dismissed','defer':'deferred'}[action]
   self.store.connection.execute('UPDATE discoveries SET state=?,updated_at=?,goal_id=? WHERE id=?',
        (state,now(),goal['id'] if goal else None,ident))
   self.store.connection.commit()
  self.store.emit('discovery.'+state,{'discovery_id':ident,'goal_id':goal['id'] if goal else None})
  return dict(self.store.connection.execute('SELECT * FROM discoveries WHERE id=?',(ident,)).fetchone())
