#!/usr/bin/env python3
"""Phase 4.10.2: auditable memory-extraction diagnostics; no eligibility changes."""
from pathlib import Path
import ast
import shutil
from datetime import datetime

root = Path(__file__).resolve().parent
# Works when invoked from project scripts/ or from a downloaded standalone file while cwd is project.
project = root.parent if (root.parent / 'hermes_life/vault_memory.py').exists() else Path.cwd()
p = project / 'hermes_life/vault_memory.py'
if not p.is_file():
    raise SystemExit(f'Missing file: {p}')
s = p.read_text()
if 'PHASE4102_DIAGNOSTICS' in s:
    raise SystemExit('Phase 4.10.2 diagnostics already installed; no change.')
start = s.find('    def extract_completed(self,conversation_id,task_id):')
end = s.find('    def retrieve_notes(self,prompt,limit=3):', start)
if start < 0 or end < 0:
    raise SystemExit('Unexpected VaultMemory method layout; no change.')
if 'def _propose(' not in s or 'def _review(' not in s:
    raise SystemExit('Expected Phase 4.10 semantic extractor not found; no change.')
replacement = '''    def extract_completed(self,conversation_id,task_id):
        # PHASE4102_DIAGNOSTICS: preserve existing eligibility and acceptance rules;
        # record aggregated candidate outcomes, not conversation text or quotes.
        import json as _diagnostic_json
        from collections import Counter as _Counter
        counts = _Counter()
        def report(state, note=''):
            summary = {'status': state, 'candidates': counts['candidates'],
                       'stored': counts['stored'], 'reviews': counts['reviews'],
                       'rejected': {k[7:]:v for k,v in counts.items() if k.startswith('reject_')},
                       'note': note[:160]}
            with self.store.lock:
                self.store.connection.execute("""INSERT INTO hl_memory_extraction_runs(task_id,state,note)
                  VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET
                  state=excluded.state,note=excluded.note,completed_at=CURRENT_TIMESTAMP""",
                  (task_id, state, _diagnostic_json.dumps(summary, sort_keys=True)))
                self.store.connection.commit()
            self.store.emit('memory.extraction_summary', summary, task_id)
        if not conversation_id:
            report('skipped', 'missing_conversation_id')
            return 0
        # The _read() guard intentionally skips already processed tasks. Do not
        # overwrite their original extraction results.
        with self.store.lock:
            processed = self.store.connection.execute(
                'SELECT 1 FROM hl_memory_extraction_runs WHERE task_id=?',(task_id,)).fetchone()
        if processed:
            return 0
        data=self._read(conversation_id,task_id)
        if not data:
            report('skipped', 'no_eligible_turn_or_uncompleted_task')
            return 0
        row,answer,existing=data
        user=row['content']
        if len(user)>6000 or PRIVATE.search(user):
            report('skipped', 'length_limit_or_private_content')
            return 0
        try:
            proposed=self._propose(user,answer,existing)
            items=proposed.get('candidates',[]) if isinstance(proposed,dict) else []
            if not isinstance(items,list):
                counts['reject_invalid_candidates_container'] += 1
                items=[]
            counts['candidates'] = len(items)
            if len(items)>4:
                counts['reject_over_limit'] += len(items)-4
            made=0
            for item in items[:4]:
                if not isinstance(item,dict):
                    counts['reject_not_object'] += 1
                    continue
                kind=item.get('kind');content=compact(item.get('memory',''))
                quote=compact(item.get('evidence',''))
                if kind not in FOLDERS:
                    counts['reject_invalid_kind'] += 1
                    continue
                if not 15<=len(content)<=600 or not 12<=len(quote)<=500:
                    counts['reject_invalid_lengths'] += 1
                    continue
                if PRIVATE.search(content):
                    counts['reject_private_content'] += 1
                    continue
                if quote.casefold() not in compact(user).casefold():
                    counts['reject_evidence_not_verbatim'] += 1
                    continue
                matching=sorted(((similarity(content,e['content']),e) for e in existing),key=lambda x:x[0],reverse=True)
                if matching and matching[0][0]>=0.88:
                    counts['reject_near_duplicate'] += 1
                    continue
                rel=item.get('relation','new');ident=item.get('existing_id','')
                referenced=next((e for e in existing if e['id']==ident),None)
                if rel in ('contradiction','uncertain') and referenced:
                    self._review(task_id,content,ident,rel)
                    counts['reviews'] += 1
                    continue
                if rel=='equivalent':
                    counts['reject_model_equivalent'] += 1
                    continue
                if rel!='new':
                    counts['reject_unknown_relation'] += 1
                    continue
                if matching and matching[0][0]>=0.68:
                    self._review(task_id,content,matching[0][1]['id'],'possible equivalent or conflict')
                    counts['reviews'] += 1
                    continue
                entry=self.recall.remember(content,kind,conversation_id,row['id'])
                entry.update(source_conversation_id=conversation_id,source_turn_id=row['id'])
                existing.append(entry);made+=1
                counts['stored'] += 1
                try:self._mirror(entry)
                except (OSError,ValueError):counts['reject_mirror_write_error'] += 1
            lesson=proposed.get('task_lesson') if isinstance(proposed,dict) else None
            if isinstance(lesson,dict):
                summary=compact(lesson.get('summary',''));quote=compact(lesson.get('evidence',''))
                if 20<=len(summary)<=650 and len(quote)>=15 and quote.casefold() in compact(answer).casefold():
                    self._review(task_id,summary,None,'task lesson awaiting verification')
                    counts['reviews'] += 1
                elif summary or quote:
                    counts['reject_task_lesson_evidence'] += 1
            report('completed')
            return made
        except Exception as exc:
            # Record the error type only; avoid leaking raw conversation content.
            try:report('failed',type(exc).__name__)
            except Exception:pass
            raise RuntimeError(f'Memory extraction: {type(exc).__name__}: {str(exc)[:180]}') from exc

'''
updated = s[:start] + replacement + s[end:]
ast.parse(updated)
backup = p.with_name(p.name+'.before-phase4102-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
shutil.copy2(p,backup)
p.write_text(updated)
print('Phase 4.10.2 installed. Backup:', backup)
print('Restart the Hermes Life backend. New completed chat tasks will emit memory.extraction_summary.')
