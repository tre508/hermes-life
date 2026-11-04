"""HL-FLOW-007A: single owner of interpreter resolution and platform test environments.

Both guest scripts (implementation and revision) embed these blocks verbatim, so the two
execution paths cannot drift apart the way they did before FLOW-007.

Interpreter policy — the platform environment is authoritative:

  1. ``env-<run-id>``        platform-owned environment, created from the baseline's
                             approved dependencies. Used by baseline tests, candidate
                             tests and revisions alike.
  2. ``<legacy dir>/.venv``  compatibility fallback for runs created before FLOW-007.
                             A revision must never use the *staging* copy for this: that
                             would let an agent-created environment become the evaluator.
  3. system python           last resort; the test step normally reports
                             ``environment_error`` here rather than a passing result.

A directory named ``.venv`` is not evidence of anything: it is only honoured after its
interpreter is executable *and* can import pytest.

Dependency policy — fail closed. Environments are built from the **baseline** copy only
(never from agent-written candidate files), and every manifest line must be a plain index
package spec. Editable installs, VCS/URL specs, extra indexes, ``--find-links`` and path
references are *refused*, not skipped: passing them to pip would fetch or execute code
from outside the approved set, and silently dropping them would hide that from the
operator. ``-r``/``--requirement`` includes are followed, with the same rule applied to
the included file.

Provenance — an existing environment is only reused when the dependency fingerprint still
matches the baseline and its interpreter can import pytest. A dead interpreter is repaired;
a changed or unrecorded dependency set is refused and reported instead.
"""

EXPERIMENTS_ROOT = '/home/hermes/experiments'

#: Interpreter validation and resolution. Embedded in both guest scripts.
ENV_RESOLVER = r'''import json,os,pathlib,re,subprocess,sys
EXPERIMENTS_ROOT='/home/hermes/experiments'
def runtime_env():
 """Ambient interpreter state must not leak into an evaluation."""
 env=os.environ.copy()
 env.pop('PYTHONPATH',None);env.pop('PYTHONHOME',None)
 env['PYTHONNOUSERSITE']='1';env['PIP_NO_INPUT']='1'
 return env
def _run_id(ident):
 if not isinstance(ident,str) or not re.fullmatch(r'[0-9a-f-]{36}',ident):raise ValueError('Invalid run ID')
 return ident
def environment_path(ident):
 root=pathlib.Path(EXPERIMENTS_ROOT)
 target=root/('env-'+_run_id(ident))
 if target.is_symlink() or target.parent!=root:raise ValueError('Invalid environment path')
 return target
def baseline_path(ident):
 root=pathlib.Path(EXPERIMENTS_ROOT)
 target=root/('baseline-'+_run_id(ident))
 if target.is_symlink() or target.parent!=root:raise ValueError('Invalid baseline path')
 return target
def interpreter_probe(directory,require_pytest=False):
 if not isinstance(directory,str) or not directory:return False,'no environment directory',None
 path=pathlib.Path(directory)
 if path.is_symlink() or not path.is_dir():return False,'environment directory absent',None
 interpreter=path/'bin'/'python'
 if not interpreter.is_file() or not os.access(str(interpreter),os.X_OK):return False,'interpreter missing or not executable',str(interpreter)
 code='import pytest,sys;print(sys.version.split()[0])' if require_pytest else 'import sys;print(sys.version.split()[0])'
 try:
  probe=subprocess.run([str(interpreter),'-c',code],capture_output=True,text=True,timeout=90,env=runtime_env())
 except (OSError,subprocess.TimeoutExpired) as exc:return False,'interpreter probe failed: '+str(exc)[:200],str(interpreter)
 if probe.returncode!=0:
  return False,('interpreter cannot import pytest: ' if require_pytest else 'interpreter is not usable: ')+(probe.stderr or '')[-200:],str(interpreter)
 return True,'',str(interpreter)
def interpreter_works(directory):
 """A working interpreter is not a ready environment: the test runner may be missing."""
 return interpreter_probe(directory,False)
def validate_environment(directory):
 """Gate for REUSE only: an interpreter that runs and can already import pytest."""
 return interpreter_probe(directory,True)
def resolve_interpreter(preferred,legacy):
 for directory,source in ((preferred,'platform'),(legacy,'legacy-venv')):
  ok,reason,interpreter=validate_environment(directory)
  if ok:return interpreter,source
 return sys.executable,'system'
'''

#: Environment provisioning. Embedded in the implementation guest script only.
ENV_PROVISION = r'''import hashlib,json,pathlib,re,shutil,subprocess,sys
PACKAGE_SPEC=re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\[[A-Za-z0-9_,.-]+\])?\s*(?:(?:==|!=|<=|>=|~=|<|>)\s*[A-Za-z0-9.*+!_-]+(?:\s*,\s*(?:==|!=|<=|>=|~=|<|>)\s*[A-Za-z0-9.*+!_-]+)*)?(?:\s*;\s*[A-Za-z0-9_ .\'()=!<>-]+)?$')
PROVENANCE='flow007.json'
MAX_REQUIREMENTS_BYTES=64000
MAX_PYPROJECT_BYTES=128000
MAX_INCLUDE_DEPTH=3
def _empty_manifest():return {'specs':[],'inputs':{},'files':[],'includes':[]}
def _read_manifest_file(path,label):
 data=path.read_bytes()
 if len(data)>MAX_REQUIREMENTS_BYTES:raise ValueError('Dependency manifest too large: '+label)
 return data.decode('utf-8'),hashlib.sha256(data).hexdigest()
def _manifest(baseline):
 """Approved dependencies from the trusted baseline copy; anything else is refused."""
 root=pathlib.Path(baseline)
 if root.is_symlink() or not root.is_dir():raise ValueError('Trusted baseline unavailable')
 manifest=_empty_manifest();manifest['specs']=['pytest'];seen=set()
 def consume(path,label,depth):
  if depth>MAX_INCLUDE_DEPTH:raise ValueError('Dependency include depth exceeded: '+label)
  key=str(path.resolve())
  if key in seen:return
  seen.add(key)
  text,digest=_read_manifest_file(path,label)
  manifest['inputs'][label]=digest;manifest['files'].append(label)
  for raw in text.splitlines():
   line=raw.split(' #',1)[0].strip()
   if not line or line.startswith('#'):continue
   low=line.lower()
   if low.startswith(('-r ','--requirement')):
    target=line.split(None,1)[1].strip()
    if not target or target.startswith(('-','.','/')) or ':' in target:
     raise ValueError('Unsupported dependency include in '+label+': '+line[:120])
    included=path.parent/target
    if not included.is_file():raise ValueError('Dependency include not found: '+label+' -> '+target)
    manifest['includes'].append(label+' -> '+target)
    consume(included,label+' -> '+target,depth+1)
    continue
   if not PACKAGE_SPEC.fullmatch(line):raise ValueError('Unsupported dependency directive in '+label+': '+line[:120])
   manifest['specs'].append(line)
 for name in ('requirements.txt','requirements-dev.txt','requirements-test.txt'):
  path=root/name
  if path.is_file():consume(path,name,0)
 pyproject=root/'pyproject.toml'
 if pyproject.is_file():
  data=pyproject.read_bytes()
  if len(data)>MAX_PYPROJECT_BYTES:raise ValueError('pyproject.toml too large')
  manifest['inputs']['pyproject.toml']=hashlib.sha256(data).hexdigest()
  import tomllib
  project=tomllib.loads(data.decode('utf-8')).get('project',{}) or {}
  declared=list(project.get('dependencies') or [])
  optional=project.get('optional-dependencies') or {}
  if isinstance(optional,dict):
   for group in ('test','tests','testing','dev'):declared+=list(optional.get(group) or [])
  for dep in declared:
   if not isinstance(dep,str) or not PACKAGE_SPEC.fullmatch(dep.strip()):
    raise ValueError('Unsupported dependency in pyproject.toml: '+repr(dep)[:120])
   manifest['specs'].append(dep.strip())
 manifest['specs']=list(dict.fromkeys(manifest['specs']))
 return manifest
def fingerprint(manifest):
 return hashlib.sha256(json.dumps({'specs':manifest['specs'],'inputs':manifest['inputs']},sort_keys=True).encode()).hexdigest()
def recorded_metadata(target):
 try:return json.loads((pathlib.Path(target)/PROVENANCE).read_text(encoding='utf-8'))
 except (OSError,ValueError):return None
def _pip(interpreter,args,timeout):
 try:
  proc=subprocess.run([interpreter,'-m','pip']+args,capture_output=True,text=True,timeout=timeout,env=runtime_env())
  return {'args':args,'exit_code':proc.returncode,'ok':proc.returncode==0,'output':(proc.stdout+'\n'+proc.stderr)[-4000:]}
 except (OSError,subprocess.TimeoutExpired) as exc:
  return {'args':args,'exit_code':None,'ok':False,'output':'pip invocation failed: '+str(exc)[:400]}
def _packages(interpreter):
 step=_pip(interpreter,['freeze'],180)
 return step['output'].strip() if step['ok'] else None
def _version(interpreter):
 try:return subprocess.run([interpreter,'-c','import sys;print(sys.version.split()[0])'],capture_output=True,text=True,timeout=60,env=runtime_env()).stdout.strip()
 except (OSError,subprocess.TimeoutExpired):return None
def _report(status,reason,interpreter,created,reused,manifest,install,packages,note=''):
 return {'status':status,'reason':reason,'interpreter':interpreter,'created':created,'reused':reused,
  'manifest':manifest,'install':install,'packages':packages,'note':note,
  'python_version':_version(interpreter) if interpreter else None}
def provision_environment(ident,baseline):
 """Create or validate env-<ident>, reusing it only with matching dependency provenance."""
 try:
  target=environment_path(ident)
  manifest=_manifest(baseline)
 except (OSError,ValueError) as exc:
  return _report('environment_error',str(exc)[:300],None,False,False,_empty_manifest(),[],None)
 expect=fingerprint(manifest)
 if target.exists():
  ready,reason,interpreter=validate_environment(str(target))
  recorded=recorded_metadata(target)
  if recorded and recorded.get('baseline_sha256')==expect and ready:
   return _report('ok','',interpreter,False,True,manifest,[],_packages(interpreter))
  if recorded and recorded.get('baseline_sha256')!=expect:
   return _report('environment_error','test environment provenance mismatch: baseline dependencies changed since it was created',interpreter,False,True,manifest,[],None)
  if not recorded:
   return _report('environment_error','test environment has no recorded provenance: inspect '+str(target),interpreter,False,True,manifest,[],None)
  # Provenance matches but the interpreter is unusable: the environment is repairable.
  shutil.rmtree(target)
 if not target.exists():
  try:subprocess.run([sys.executable,'-m','venv',str(target)],capture_output=True,text=True,timeout=600,check=True,env=runtime_env())
  except (OSError,subprocess.SubprocessError) as exc:
   return _report('environment_error','venv creation failed: '+str(exc)[:300],None,False,False,manifest,[],None)
 healthy,why,interpreter=interpreter_works(str(target))
 if not healthy:
  return _report('environment_error','new environment unusable: '+why,interpreter,True,False,manifest,[],None)
 step=_pip(interpreter,['install','--disable-pip-version-check','--no-input']+manifest['specs'],900)
 install=[step]
 if not step['ok']:
  return _report('environment_error','baseline dependency installation failed',interpreter,True,False,manifest,install,None)
 ready,reason,interpreter=validate_environment(str(target))
 if not ready:
  return _report('environment_error','environment unusable after install: '+reason,interpreter,True,False,manifest,install,None)
 packages=_packages(interpreter)
 metadata={'env_source':'platform-baseline','baseline_sha256':expect,
  'dependency_inputs':manifest['inputs'],'dependency_specs':manifest['specs'],
  'installed_packages':(packages or '').split(),'python':interpreter,'python_version':_version(interpreter)}
 try:(target/PROVENANCE).write_text(json.dumps(metadata,indent=2,sort_keys=True),encoding='utf-8')
 except OSError as exc:
  return _report('environment_error','cannot record environment provenance: '+str(exc)[:200],interpreter,True,False,manifest,install,packages)
 return _report('ok','',interpreter,True,False,manifest,install,packages)
'''
