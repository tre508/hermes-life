#!/usr/bin/env python3
"""Integrate HL-FLOW-005 review routes and UI into an installed Hermes Life.
Idempotent; refuses ambiguous source structure; preserves current implementation.py.
"""
from pathlib import Path
from datetime import datetime
import shutil
root=Path(__file__).resolve().parents[1]
app=root/'hermes_life/app.py'
main=root/'frontend/src/main.ts'
review=root/'hermes_life/implementation_review.py'
ui=root/'frontend/src/phase415-review.ts'
css=root/'frontend/src/phase415-review.css'
for p in (app, main,review,ui,css):
    if not p.is_file(): raise SystemExit(f'Missing required file: {p}')
s=app.read_text()
changed=False
if "from .implementation_review import ImplementationReview" not in s:
    # Import next to the existing import, only if unique.
    lines=s.splitlines(keepends=True)
    positions=[i for i,line in enumerate(lines) if 'from .implementation import ImplementationEngine' in line]
    if len(positions)!=1:raise SystemExit('Cannot find unique ImplementationEngine import; no edits made')
    lines.insert(positions[0]+1,'from .implementation_review import ImplementationReview\n')
    s=''.join(lines);changed=True
if 'reviewer = ImplementationReview(runtime, implementer)' not in s:
    lines=s.splitlines(keepends=True)
    positions=[i for i,line in enumerate(lines) if 'implementer = ImplementationEngine(' in line]
    if len(positions)!=1:raise SystemExit('Cannot find unique implementation engine initialization; no edits made')
    indent=lines[positions[0]][:len(lines[positions[0]])-len(lines[positions[0]].lstrip())]
    lines.insert(positions[0]+1,indent+'reviewer = ImplementationReview(runtime, implementer)\n')
    s=''.join(lines);changed=True
route="@app.get('/api/implementations/{ident}/review')"
if route not in s:
    anchor="    @app.get('/api/implementations/{ident}')"
    if s.count(anchor)!=1:raise SystemExit('Cannot locate unique implementation route; no edits made')
    addition='''    class ImplementationReviewInput(BaseModel):
        decision: str
        snapshot_sha256: str
        criteria: list[bool]
        feedback: str = ''

    @app.get('/api/implementations/{ident}/review-state')
    def implementation_review_state(ident: str):
        if implementer.get(ident) is None:
            raise HTTPException(404, 'Implementation not found')
        return reviewer.get_decision(ident)

    @app.get('/api/implementations/{ident}/review')
    def get_implementation_review(ident: str):
        try:
            return reviewer.view(ident)
        except KeyError as exc:
            raise HTTPException(404, str(exc))
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(409, str(exc))

    @app.post('/api/implementations/{ident}/review')
    def decide_implementation_review(ident: str, payload: ImplementationReviewInput):
        try:
            return reviewer.decide(ident, payload.decision, payload.snapshot_sha256,
                                   payload.criteria, payload.feedback)
        except KeyError as exc:
            raise HTTPException(404, str(exc))
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        except RuntimeError as exc:
            raise HTTPException(503, str(exc))

'''
    s=s.replace(anchor, addition+anchor,1);changed=True
if changed:
    b=app.with_name('app.py.pre-flow005-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
    shutil.copy2(app,b)
    app.write_text(s)
    print('Backend review API integrated. Backup:',b)
else:print('Backend already integrated.')
m=main.read_text()
if "import './phase415-review';" not in m:
    b=main.with_name('main.ts.pre-flow005-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
    shutil.copy2(main,b)
    main.write_text(m+"\nimport './phase415-review';\n")
    print('Workflow UI loaded. Backup:',b)
else:print('Workflow UI already loaded.')
print('Run: .venv/bin/python -m pytest -q && (cd frontend && npm run build)')
