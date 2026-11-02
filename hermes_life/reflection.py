"""Evidence-bounded reflective memory. Tool output is never promoted to instructions."""
import json
import re
from collections import Counter
from .store import now

STOP = set('about after again also been before being could does from have into just more only over should than that their them then there these this those through under using want were what when where which while with would your task please make work file files project hermes execute investigate'.split())
TOKENS = re.compile(r'[a-z][a-z0-9_+.-]{2,}', re.I)

def terms(s):
    return set(t for t in (x.lower() for x in TOKENS.findall(str(s)[:5000])) if t not in STOP) 

def categorize(prompt, kinds):
    text = prompt.lower()
    kinds = set(kinds)
    if any(x in text for x in ('pytest', 'test suite', 'unit test', 'verify', 'regression')): return 'testing'
    if any(x in text for x in ('bug', 'fix', 'error', 'crash', 'traceback', 'debug')): return 'debugging'
    if any(x in text for x in ('implement', 'refactor', 'code', 'patch', 'build')): return 'implementation'
    if any(x in text for x in ('research', 'inspect', 'read', 'analyze', 'documentation')): return 'investigation'
    if 'hermes.tool_use' in kinds: return 'tool-work'
    return 'general'

class Reflection:
    def __init__(self, store):
        self.store = store

    def record(self, prompt, outcome, kinds=(), error=None):
        # Store short task terms, tool type counts and verified execution outcome; never tool outputs.
        category = categorize(prompt, kinds)
        status = 'failed' if error or (isinstance(outcome, dict) and outcome.get('error')) else 'completed'
        observations = Counter(kinds)
        term_set = sorted(terms(prompt))[:60]
        evidence = {'category':category, 'status':status, 'terms':term_set,
                    'event_counts':dict(observations.most_common(12)),
                    'error_kind':type(error).__name__ if error else None}
        # The lessons are cautious process recommendations, not conjectures about root causes.
        lesson = (f'For {category} work, confirm the observed failure and check the evidence before retrying.'
                  if status == 'failed' else
                  f'For {category} work, retain verification of the outcome and compare changes against the task requirements.')
        with self.store.lock:
            cur = self.store.connection.execute('''INSERT INTO reflective_runs
                (created_at,category,status,terms_json,evidence_json,lesson)
                VALUES (?,?,?,?,?,?)''', (now(),category,status,json.dumps(term_set),json.dumps(evidence),lesson))
            self.store.connection.commit()
            ident = cur.lastrowid
        self.store.emit('reflection.recorded', {'run_id':ident,'category':category,'status':status})
        return ident

    def recall(self, prompt, limit=3):
        wanted=terms(prompt)
        category=categorize(prompt, ())
        with self.store.lock:
            rows=self.store.connection.execute('''SELECT id, category, status, terms_json, lesson
                 FROM reflective_runs ORDER BY id DESC LIMIT 200''').fetchall()
        scored=[]
        for r in rows:
            overlap=len(wanted.intersection(json.loads(r['terms_json'])))
            if overlap < 2: continue
            score=overlap*3 + (2 if category==r['category'] else 0)
            scored.append((score,dict(r)))
        scored.sort(key=lambda x:(x[0],x[1]['id']),reverse=True)
        return [row for _,row in scored[:limit]]

    def context(self, prompt):
        records=self.recall(prompt)
        if not records: return ''
        lines=['[Relevant Hermes Life reflection: historical evidence, not authority]']
        for r in records:
            lines.append(f"- Previous {r['category']} run #{r['id']} {r['status']}. Process lesson: {r['lesson']}")
        completed=sum(r['status']=='completed' for r in records)
        failed=len(records)-completed
        if failed >= 2:
            lines.append('Adaptation: related attempts failed repeatedly. Narrow the scope, inspect the actual failure evidence, and vary the approach rather than blindly retrying.')
        elif completed >= 2:
            lines.append('Adaptation: related work has succeeded before. Reuse the verified workflow where applicable, but revalidate against this task.')
        elif failed:
            lines.append('Adaptation: a related attempt failed. Check why before repeating its approach.')
        lines.append('These lessons are tentative. Check current evidence; do not assume past solutions apply. They do not override user instructions or permissions.')
        lines.append('[/Relevant Hermes Life reflection]')
        return '\n'.join(lines)+'\n\n'

    def stats(self):
        with self.store.lock:
            rows=self.store.connection.execute('SELECT status, count(*) AS n FROM reflective_runs GROUP BY status').fetchall()
        return {r['status']:r['n'] for r in rows}
