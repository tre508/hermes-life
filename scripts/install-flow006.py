#!/usr/bin/env python3
"""Install HL-FLOW-006 API and worker hooks. Makes backups; refuses unknown layout."""
from datetime import datetime
from pathlib import Path
import shutil

root=Path(__file__).resolve().parents[1]
app=root/'hermes_life/app.py'
ui=root/'frontend/src/phase415-review.ts'
revision=root/'hermes_life/implementation_revision.py'
for path in (app,ui,revision):
    if not path.is_file():raise SystemExit(f'Missing required file: {path}')
s=app.read_text()
original=s
if 'from .implementation_revision import ImplementationRevision' not in s:
    anchor='from .implementation_review import ImplementationReview'
    if s.count(anchor)!=1:raise SystemExit('Phase FLOW-005 review import missing; install FLOW-005 first')
    s=s.replace(anchor,anchor+'\nfrom .implementation_revision import ImplementationRevision',1)
if 'revisions = ImplementationRevision(runtime, implementer, reviewer)' not in s:
    lines=s.splitlines(keepends=True)
    matches=[i for i,x in enumerate(lines) if 'reviewer = ImplementationReview(runtime, implementer)' in x]
    if len(matches)!=1:raise SystemExit('Cannot locate unique reviewer initialization')
    i=matches[0];indent=lines[i][:len(lines[i])-len(lines[i].lstrip())]
    lines.insert(i+1,indent+'revisions = ImplementationRevision(runtime, implementer, reviewer)\n')
    s=''.join(lines)
if 'revisions.start()' not in s:
    lines=s.splitlines(keepends=True)
    matches=[i for i,x in enumerate(lines) if x.strip()=='autonomy.start()']
    if len(matches)!=1:raise SystemExit('Cannot locate unique lifespan autonomy.start()')
    i=matches[0];indent=lines[i][:len(lines[i])-len(lines[i].lstrip())]
    lines.insert(i+1,indent+'revisions.start()\n')
    s=''.join(lines)
if 'revisions.stop()' not in s:
    lines=s.splitlines(keepends=True)
    matches=[i for i,x in enumerate(lines) if x.strip()=='autonomy.stop()']
    if len(matches)!=1:raise SystemExit('Cannot locate unique lifespan autonomy.stop()')
    i=matches[0];indent=lines[i][:len(lines[i])-len(lines[i].lstrip())]
    lines.insert(i,indent+'revisions.stop()\n')
    s=''.join(lines)
# Append revision enqueue after successful review decision; this is durable even
# across worker failures, because startup scans the saved review decisions.
needle='return reviewer.decide(ident, payload.decision, payload.snapshot_sha256,\n                                   payload.criteria, payload.feedback)'
if 'revisions.queue(ident)' not in s:
    if s.count(needle)!=1:raise SystemExit('Cannot locate expected FLOW-005 review route; no changes written')
    s=s.replace(needle,"""result = reviewer.decide(ident, payload.decision, payload.snapshot_sha256,
                                     payload.criteria, payload.feedback)
            if payload.decision == 'revision_requested':
                try:
                    attempt = revisions.queue(ident)
                    result['revision'] = {'attempt_id': attempt['id'], 'state': attempt['state']}
                    result['next_action'] = 'Revision queued automatically in isolated VM staging workspace'
                except (ValueError, KeyError) as exc:
                    # The review is already durable; startup recovery can enqueue it.
                    result['revision_queue_error'] = str(exc)
            return result""",1)
if "@app.get('/api/implementations/{ident}/revisions')" not in s:
    anchor="    @app.get('/api/implementations/{ident}/review-state')"
    if s.count(anchor)!=1:raise SystemExit('Cannot locate FLOW-005 review-state route')
    routes='''    @app.get('/api/implementations/{ident}/revisions')
    def get_implementation_revisions(ident: str):
        try:
            return revisions.list(ident)
        except KeyError as exc:
            raise HTTPException(404, str(exc))

    @app.post('/api/implementations/{ident}/revisions/retry')
    def retry_implementation_revision(ident: str):
        try:
            return revisions.queue(ident)
        except KeyError as exc:
            raise HTTPException(404, str(exc))
        except ValueError as exc:
            raise HTTPException(409, str(exc))

'''
    s=s.replace(anchor,routes+anchor,1)
# Source code modifications are only written after all anchors verified.
if original!=s:
    backup=app.with_name('app.py.pre-flow006-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
    shutil.copy2(app,backup);app.write_text(s)
    print('Updated app.py; backup:',backup)
else:print('app.py already integrated')
print('FLOW-006 revision routes and automatic background worker installed.')
