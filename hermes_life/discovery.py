"""Read-only VM repository discovery. Never executes repository-supplied code."""
import json
import subprocess
import shlex
from uuid import uuid4
from .store import now
from .formulation import read_only_investigation_prompt

# Fixed script: no paths, commands, or prompts from user input. The scanning scope is the guest's ~/projects.
REMOTE_SCAN = r'''
import io
import json
import os
import time
from pathlib import Path
import re
import tokenize

# Read-only, bounded scan of VM-approved projects. Never imports or executes source.
root = Path('/home/hermes/projects')
found = []
examined = 0
skipped_by_rule = 0
errors = 0
start_time = time.time()
SKIP = {'.git', '.venv', 'venv', 'node_modules', 'build', 'dist', '__pycache__',
        'tests', '__tests__', 'fixtures', '.pytest_cache', 'coverage'}
SOURCE = {'.py', '.ts', '.tsx', '.js', '.jsx', '.cpp', '.hpp', '.h', '.qml'}
PREFIX = re.compile(r'^(?://|/\*|\*)\s*(?:TODO|FIXME)\b', re.I)
PY_MARKER = re.compile(r'^#\s*(?:TODO|FIXME)\b', re.I)

def scan_file(file):
    if file.suffix == '.py':
        # Python tokenizer distinguishes actual comments from quoted strings,
        # triple-quoted examples and SQL containing TODO/FIXME.
        try:
            with tokenize.open(file) as handle:
                for token in tokenize.generate_tokens(handle.readline):
                    if token.type == tokenize.COMMENT and PY_MARKER.match(token.string.strip()):
                        yield token.start[0], token.string.strip()[:180]
        except (OSError, UnicodeError, SyntaxError, tokenize.TokenError):
            return
    else:
        # Only standalone comments; inline strings/examples are not candidates.
        try:
            with file.open(encoding='utf-8', errors='replace') as handle:
                for number, line in enumerate(handle, 1):
                    trimmed = line.strip()
                    if PREFIX.match(trimmed):
                        yield number, trimmed[:180]
        except (OSError, UnicodeError):
            return

if root.is_dir():
    for project in sorted(root.iterdir()):
        if project.is_symlink() or not project.is_dir():
            continue
        for base, dirs, files in os.walk(project, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d not in SKIP and not Path(base, d).is_symlink())
            if len(Path(base).relative_to(project).parts) >= 4:
                dirs[:] = []
            for name in sorted(files):
                if examined >= 500 or len(found) >= 80:
                    break
                file = Path(base, name)
                if (file.is_symlink() or file.suffix not in SOURCE
                        or name.startswith(('test_', 'spec_'))
                        or name.endswith(('.test.ts', '.spec.ts', '.test.js', '.spec.js'))):
                    skipped_by_rule += 1
                    continue
                examined += 1
                try:
                    if file.stat().st_size > 100000:
                        skipped_by_rule += 1
                        continue
                    for line, note in scan_file(file):
                        found.append({'project': project.name, 'file': str(file.relative_to(project)),
                                      'line': line, 'note': note})
                        if len(found) >= 80:
                            break
                except OSError:
                    errors += 1
                    continue
            if examined >= 500 or len(found) >= 80:
                break
        if len(found) >= 80:
            break

elapsed_ms = int((time.time() - start_time) * 1000)
truncated = examined >= 500 or len(found) >= 80
print(json.dumps({'findings': found, 'metrics': {
    'examined': examined,
    'skipped_by_rule': skipped_by_rule,
    'errors': errors,
    'elapsed_ms': elapsed_ms,
    'truncated': truncated
}}))
'''

class Discovery:
 def __init__(self, runtime, autonomy):
  self.runtime=runtime
  self.autonomy=autonomy
  self.store=runtime.store

 @staticmethod
 def fingerprint(project,path,note):
  # Canonical identity = project + relative path + normalized issue content.
  # Line number is evidence, not identity (spec 8.2, HL-GOAL-0001): an identical
  # TODO shifted to a different line must NOT become a separate finding.
  norm=" ".join(note.split())
  return json.dumps([project,path,norm],sort_keys=True)

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
  payload=json.loads(result.stdout)
  # Support both old format (list of findings) and new format (object with findings+metrics)
  if isinstance(payload, list):
   findings=payload
   metrics={}
  else:
   findings=payload.get('findings',[])
   metrics=payload.get('metrics',{})
  added=0
  for item in findings:
   fp=Discovery.fingerprint(item['project'],item['file'],item['note'])
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
  # Persist scan metrics on decision_settings and emit with full metrics
  with self.store.lock:
   self.store.connection.execute('UPDATE decision_settings SET last_scan=? WHERE id=1',(now(),))
   self.store.connection.commit()
  self.store.emit('discovery.scan_completed',{'found':len(findings),'new':added,'metrics':metrics})
  return {'found':len(findings),'new':added,'metrics':metrics}

 def transition(self,ident,action):
  if action not in ('approve','dismiss','defer'):raise ValueError('Invalid decision')
  with self.store.lock:
   row=self.store.connection.execute('SELECT * FROM discoveries WHERE id=?',(ident,)).fetchone()
   if not row:return None
   row=dict(row)
   if row['state'] not in ('proposed','deferred'):raise ValueError('Candidate already decided')
   goal=None;goal_id=None
   if action=='approve':
    # Route through the formulation process with a source-derived read-only prompt.
    # The raw proposed_prompt (which embeds marker text) is NEVER handed to the
    # execution adapter; read_only_investigation_prompt treats the marker as data.
    safe_prompt=read_only_investigation_prompt(row)
    goal=self.autonomy.add(f"Investigate {row['project']}/{row['path']}:{row['line']}",safe_prompt,40)
    goal_id=goal['id']
    self._create_approved_formulation(row,goal_id)
   state={'approve':'approved','dismiss':'dismissed','defer':'deferred'}[action]
   self.store.connection.execute('UPDATE discoveries SET state=?,updated_at=?,goal_id=? WHERE id=?',
        (state,now(),goal_id,ident))
   self.store.connection.commit()
  self.store.emit('discovery.'+state,{'discovery_id':ident,'goal_id':goal_id})
  return dict(self.store.connection.execute('SELECT * FROM discoveries WHERE id=?',(ident,)).fetchone())

 def _create_approved_formulation(self,source,goal_id):
  # Traceable discovery -> formulation -> goal chain, derived from source fields only.
  # Idempotent: an existing formulation for this discovery is re-linked, never duplicated.
  ident=str(uuid4());stamp=now()
  title=f"Investigate {source['project']}/{source['path']}:{source['line']}"
  acceptance=json.dumps([
    'A reproducible acceptance criterion and source-referenced evidence are documented '
    'from read-only inspection of the reported marker.'])
  with self.store.lock:
   existing=self.store.connection.execute(
     'SELECT id FROM formulated_goals WHERE discovery_id=?',(source['id'],)).fetchone()
   if existing:
    self.store.connection.execute('UPDATE formulated_goals SET state=?,goal_id=?,updated_at=? WHERE id=?',
      ('approved',goal_id,stamp,existing['id']))
    self.store.emit('formulation.proposed',{'proposal_id':existing['id'],'discovery_id':source['id'],'action':'research'})
    return existing['id']
   self.store.connection.execute('INSERT INTO formulated_goals VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
     (ident,source['id'],title,'research',source['rationale'],acceptance,
      read_only_investigation_prompt(source),40,'approved',goal_id,stamp,stamp))
  self.store.emit('formulation.proposed',{'proposal_id':ident,'discovery_id':source['id'],'action':'research'})
  return ident
