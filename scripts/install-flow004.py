"""Install the independent candidate reevaluator endpoint into existing app.py.

Run from the Hermes Life repository root after copying the implementation.py.
Does not replace app.py or alter existing endpoints.
"""
from pathlib import Path
from datetime import datetime

p = Path('hermes_life/app.py')
s = p.read_text()
route = "@app.post('/api/implementations/{ident}/reevaluate')"
if route in s:
    print('Reevaluation route already installed.')
else:
    anchor = "    @app.get('/api/implementations/{ident}')"
    if s.count(anchor) != 1:
        raise SystemExit('Expected implementation-detail route not found exactly once. No edits made.')
    block = '''    @app.post('/api/implementations/{ident}/reevaluate')
    def reevaluate_implementation(ident: str):
        try:
            return implementer.reevaluate(ident)
        except KeyError as exc:
            raise HTTPException(404, str(exc))
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        except RuntimeError as exc:
            raise HTTPException(503, str(exc))

    @app.get('/api/implementations/{ident}/evaluations')
    def implementation_evaluations(ident: str):
        try:
            return implementer.evaluations(ident)
        except KeyError as exc:
            raise HTTPException(404, str(exc))

'''
    backup = p.with_name(p.name + '.pre-flow004-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.write_text(s)
    p.write_text(s.replace(anchor, block + anchor, 1))
    print('Added reevaluation and evaluation-history endpoints; backup:', backup)
