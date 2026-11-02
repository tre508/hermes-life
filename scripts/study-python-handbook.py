#!/usr/bin/env python3
"""Prepare and queue resumable, evidence-backed handbook study goals through Hermes Life."""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / 'study' / 'python-handbook' / 'manifest.json'
API = os.environ.get('HERMES_LIFE_API', 'http://127.0.0.1:8766').rstrip('/')
PDF = '/home/hermes/learning/python-handbook/The Ultimate Python Handbook.pdf'


def api(method, path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(API + path, data=data, method=method, headers={'Content-Type': 'application/json'} if data else {})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f'{method} {path}: HTTP {exc.code}: {exc.read(500).decode(errors="replace")}') from exc


def remote_pages(args):
    # Use the already-indexed PDF in the VM; do not download or write onto the host.
    code = r'''
import json,sys
from pathlib import Path
p=Path('/home/hermes/learning/python-handbook/The Ultimate Python Handbook.pdf')
if not p.is_file(): raise SystemExit('PDF not found in VM: '+str(p))
try:
 from pypdf import PdfReader
except ImportError:
 from pathlib import Path
 for site in (Path('/home/hermes/learning/python-handbook/.venv/lib')).glob('python*/site-packages'):
  sys.path.insert(0,str(site))
 from pypdf import PdfReader
r=PdfReader(str(p))
for i,page in enumerate(r.pages,1):
 text=page.extract_text() or ''
 print(json.dumps({'page':i,'text':text[:1600]},ensure_ascii=False))
'''
    cmd=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=12','-i',str(Path(args.key).expanduser()),f'{args.user}@{args.vm}','python3','-']
    run=subprocess.run(cmd,input=code,text=True,capture_output=True,timeout=180)
    if run.returncode: raise RuntimeError('VM PDF read failed: '+run.stderr[-1000:])
    pages=[json.loads(x) for x in run.stdout.splitlines() if x.strip()]
    if not pages: raise RuntimeError('No pages returned from VM')
    return pages


def make_units(pages, chunk_size):
    """Create sequential study units without guessing chapter boundaries."""
    total = len(pages)
    units = []

    for start in range(1, total + 1, chunk_size):
        end = min(total, start + chunk_size - 1)
        units.append({
            "title": f"Study unit — PDF pages {start}–{end}",
            "start": start,
            "end": end,
            "kind": "page-range",
            "index": len(units) + 1,
            "goal_id": None,
            "goal_status": "not_queued"
        })

    return units

def save(data):
    STATE.parent.mkdir(parents=True,exist_ok=True)
    tmp=STATE.with_suffix('.tmp')
    tmp.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
    tmp.replace(STATE)


def load():
    if not STATE.is_file(): raise RuntimeError('Study plan missing: run prepare first')
    return json.loads(STATE.read_text())


def prompt(unit, total):
    start,end=unit['start'],unit['end']
    return f'''STUDY WORKFLOW — THE ULTIMATE PYTHON HANDBOOK
This is unit {unit['index']} of {total}: {unit['title']} (PDF pages {start}–{end}).
Run ONLY inside the isolated Hermes Life VM. The PDF is at {PDF}.

1. Read ALL PDF pages {start}–{end} using Python/pypdf. Use the existing isolated PDF reader environment at /home/hermes/learning/python-handbook/.venv if needed. Never assume the PDF pages correspond to printed page numbers. Identify actual section/chapter headings and the relevant concepts; note extraction gaps.
2. Write a study report at /home/hermes/learning/python-handbook/study/unit-{unit['index']:02d}.md: sections and PDF page citations; concepts paraphrased in your own words; examples; limits and version-sensitive assertions; questions requiring verification.
3. Create a separate executable verification script at /home/hermes/learning/python-handbook/study/unit-{unit['index']:02d}-checks.py. Choose representative safe examples from THIS unit, with explicit expected outcomes. Run the script in the VM and capture the actual stdout/stderr and exit status in a test log beside the report. Do not claim code has passed unless it ran.
4. For each finding, distinguish DOCUMENT-SOURCED information from EXECUTION-VERIFIED evidence. Cite the PDF page(s). Where relevant, compare with Python's current actual behavior, and clearly label differences instead of falsifying test results.
5. Emit 0–5 concrete reusable technical lessons through the existing [HERMES_LEARNING_JSON] report ONLY if they are supported by exact tool_result excerpts FROM THIS run. Avoid generic lessons, do not copy entire pages, do not write directly to the host DB, and do not mark the entire book verified.
6. In your final answer report pages processed, actual sections read, tests executed/passed/failed, evidence locations, and any extraction gaps. Preserve all earlier study files and lessons.

Do not install packages globally, change the transport, modify the host, or alter the fixed persona.'''


def prepare(args):
    if STATE.exists() and not args.replace:
        raise RuntimeError(f'Existing study plan at {STATE}; use status or --replace to regenerate')
    sources=api('GET','/api/library/sources')['sources']
    matching=[s for s in sources if 'Ultimate Python Handbook' in s.get('title','')]
    if not matching: raise RuntimeError('Handbook is not indexed in Knowledge Library yet')
    pages=remote_pages(args)
    indexed=matching[0].get('indexed_pages',0)
    if indexed < len(pages)-2: raise RuntimeError(f'Library appears incomplete ({indexed}/{len(pages)} searchable pages)')
    units=make_units(pages,args.pages_per_unit)
    save({'source_id':matching[0]['id'],'pdf_pages':len(pages),'indexed_pages':indexed,'units':units})
    print(f'Prepared {len(units)} study units from {len(pages)} PDF pages; {indexed} searchable pages indexed.')
    for u in units:print(f" {u['index']:02d}: {u['title']} (PDF {u['start']}–{u['end']})")
    print('Next: python3 scripts/study-python-handbook.py enqueue-next')


def status():
    plan=load()
    goals={str(g.get('id')):g for g in api('GET','/api/goals') if isinstance(g,dict)} if False else None
    # goal list shape can differ by release; status deliberately uses stored submission IDs only.
    for u in plan['units']:
        print(f"{u['index']:02d} {u['goal_status']:<12} id={u['goal_id'] or '-'}  {u['title']}")


def enqueue():
    plan=load()
    # Scheduler's goal-list envelope differs across releases, support both.
    response=api('GET','/api/goals')
    goals=response if isinstance(response,list) else response.get('goals',response.get('items',[]))
    if not isinstance(goals,list): raise RuntimeError('Unexpected /api/goals response; no goal submitted')
    lookup={str(g.get('id')):g for g in goals if isinstance(g,dict)}
    terminal={'completed','done','succeeded','success'}
    failed={'failed','cancelled','canceled','blocked'}
    for unit in plan['units']:
        if unit['goal_id']:
            record=lookup.get(str(unit['goal_id']))
            if not record:raise RuntimeError(f"Prior goal {unit['goal_id']} not visible; inspect it before continuing")
            current=str(record.get('status',record.get('state',''))).lower()
            unit['goal_status']=current or 'unknown'
            if current in failed:
                save(plan); raise RuntimeError(f"Previous unit {unit['index']} ended {current}; inspect and retry manually")
            if current not in terminal:
                save(plan);print(f"Unit {unit['index']} still {current}; no new goal queued");return
        else:
            payload={'title':f"Python Handbook study {unit['index']}/{len(plan['units'])}: {unit['title']}"[:160],
                     'prompt':prompt(unit,len(plan['units'])),'priority':50}
            created=api('POST','/api/goals',payload)
            ident=created.get('id',created.get('goal_id'))
            if not ident: raise RuntimeError(f'Goal response missing ID: {created}')
            unit.update(goal_id=str(ident),goal_status='queued')
            save(plan)
            print(f"Queued unit {unit['index']}/{len(plan['units'])} as goal {ident}. Wait for completion, then run enqueue-next again.")
            return
    save(plan);print('All study units completed (according to scheduler statuses).')


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['prepare','enqueue-next','status'])
    parser.add_argument('--vm',default=os.environ.get('HERMES_LIFE_VM_HOST','192.168.124.136'))
    parser.add_argument('--user',default=os.environ.get('HERMES_LIFE_VM_USER','hermes'))
    parser.add_argument('--key',default=os.environ.get('HERMES_LIFE_VM_KEY','~/.ssh/hermes_life_vm'))
    parser.add_argument('--pages-per-unit',type=int,default=5)
    parser.add_argument('--replace',action='store_true')
    args=parser.parse_args()
    try:
        if args.action=='prepare':
            if not 1<=args.pages_per_unit<=15:raise RuntimeError('--pages-per-unit must be 1–15')
            prepare(args)
        elif args.action=='enqueue-next':enqueue()
        else:status()
    except (RuntimeError,OSError,subprocess.TimeoutExpired,urllib.error.URLError) as exc:
        print(f'Study workflow: {exc}',file=sys.stderr);raise SystemExit(1)

if __name__=='__main__':main()
