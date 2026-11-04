"""Curiosity investigations: linked, explicit and idempotent.

Curiosity state changes alone never execute a task. Investigate explicitly approves
its backing discovery, using the existing formulation / read-only lifecycle.
"""
import re

from .store import now

_COMMENT = {
    '.py': re.compile(r'^#\s*(?:TODO|FIXME)\b', re.I),
    '.ts': re.compile(r'^(?://|/\*|\*)\s*(?:TODO|FIXME)\b', re.I),
    '.tsx': re.compile(r'^(?://|/\*|\*)\s*(?:TODO|FIXME)\b', re.I),
    '.js': re.compile(r'^(?://|/\*|\*)\s*(?:TODO|FIXME)\b', re.I),
    '.jsx': re.compile(r'^(?://|/\*|\*)\s*(?:TODO|FIXME)\b', re.I),
    '.cpp': re.compile(r'^(?://|/\*|\*)\s*(?:TODO|FIXME)\b', re.I),
    '.hpp': re.compile(r'^(?://|/\*|\*)\s*(?:TODO|FIXME)\b', re.I),
    '.h': re.compile(r'^(?://|/\*|\*)\s*(?:TODO|FIXME)\b', re.I),
    '.qml': re.compile(r'^(?://|/\*|\*)\s*(?:TODO|FIXME)\b', re.I),
}


def finding_quality(source):
    """Conservative gate for legacy scanner results; not a proof of relevance."""
    if source is None:
        return 'missing', 'Backing discovery no longer exists'
    path = str(source.get('path') or '').replace('\\', '/')
    note = str(source.get('note') or '').strip()
    segments = path.lower().split('/')
    name = segments[-1] if segments else ''
    if ('tests' in segments or '__tests__' in segments or 'fixtures' in segments
            or name.startswith(('test_', 'spec_')) or name.endswith(('.test.ts', '.spec.ts', '.test.js', '.spec.js'))):
        return 'excluded', 'Source is a test or fixture, not a new production issue'
    if any(part in segments for part in ('node_modules', '.venv', 'dist', 'build', '.git')):
        return 'excluded', 'Generated or dependency path'
    if '{item[' in note or '${' in note or 'INSERT INTO discoveries' in note:
        return 'excluded', 'Marker is a source-code template or database example'
    suffix = '.' + name.rsplit('.', 1)[-1] if '.' in name else ''
    pattern = _COMMENT.get(suffix)
    if not pattern:
        return 'excluded', 'Unsupported source or documentation file'
    if not pattern.match(note):
        return 'excluded', 'TODO/FIXME is not an identifiable source comment'
    return 'eligible', ''


def _rowdict(row):
    return dict(row) if row is not None else None


def list_workflow(runtime):
    """Join existing records without adding a second goal or workflow schema."""
    with runtime.store.lock:
        rows = runtime.store.connection.execute('''
            SELECT c.*, d.project AS source_project, d.path AS source_path,
                   d.line AS source_line, d.note AS source_note,
                   d.state AS discovery_state, d.goal_id AS discovery_goal_id,
                   g.state AS goal_state, g.task_id AS task_id,
                   p.id AS plan_id, p.state AS plan_state
            FROM curiosity c
            LEFT JOIN discoveries d ON d.id=c.discovery_id
            LEFT JOIN goals g ON g.id=d.goal_id
            LEFT JOIN formulated_goals f ON f.discovery_id=d.id
            LEFT JOIN investigation_plans p ON p.formulation_id=f.id
            ORDER BY c.priority DESC, c.created_at ASC
            LIMIT 200
        ''').fetchall()
    result = []
    for r in rows:
        item = dict(r)
        source = None if item['source_path'] is None else {
            'path': item['source_path'], 'note': item['source_note']
        }
        quality, reason = finding_quality(source)
        item['quality'] = quality
        item['quality_reason'] = reason
        item['can_investigate'] = (quality == 'eligible'
            and item['state'] in ('open', 'deferred')
            and item['discovery_state'] in ('proposed', 'deferred', 'approved'))
        if item['discovery_goal_id']:
            item['investigation_status'] = item['goal_state'] or 'linked'
        elif item['discovery_state'] == 'approved':
            item['investigation_status'] = 'linked goal missing'
        else:
            item['investigation_status'] = 'not started'
        result.append(item)
    return result


def investigate(runtime, discovery, ident):
    """Explicit user action; never pass curiosity question to Hermes as a prompt.

    The established discovery transition constructs the source-derived formulation,
    goal and read-only prompt. Repeated clicks return the existing goal.
    """
    with runtime.store.lock:
        row = _rowdict(runtime.store.connection.execute(
            'SELECT * FROM curiosity WHERE id=?', (ident,)).fetchone())
        if not row:
            raise LookupError('Curiosity question not found')
        source = _rowdict(runtime.store.connection.execute(
            'SELECT * FROM discoveries WHERE id=?', (row['discovery_id'],)).fetchone())
    quality, reason = finding_quality(source)
    if quality != 'eligible':
        raise ValueError('Not eligible for investigation: ' + reason)
    if row['state'] == 'dismissed':
        raise ValueError('Dismissed question must be reopened first')
    if source['state'] not in ('proposed', 'deferred', 'approved'):
        raise ValueError('Backing discovery is ' + str(source['state']))
    if source['state'] == 'approved':
        if not source.get('goal_id'):
            raise ValueError('Discovery approved without a linked goal; requires reconciliation')
        goal_id = source['goal_id']
    else:
        # Do not hold store lock across this call; transition acquires its own lock.
        changed = discovery.transition(source['id'], 'approve')
        if not changed or not changed.get('goal_id'):
            raise RuntimeError('Approval did not create a linked investigation goal')
        goal_id = changed['goal_id']
    with runtime.store.lock:
        runtime.store.connection.execute(
            'UPDATE curiosity SET state=?,updated_at=? WHERE id=?',
            ('investigating', now(), ident))
        runtime.store.connection.commit()
        updated = _rowdict(runtime.store.connection.execute(
            'SELECT * FROM curiosity WHERE id=?', (ident,)).fetchone())
    runtime.store.emit('curiosity.investigation_requested', {
        'curiosity_id': ident, 'discovery_id': source['id'], 'goal_id': goal_id
    })
    return {'curiosity': updated, 'goal_id': goal_id, 'discovery_id': source['id'],
            'message': 'Linked investigation goal is queued or already exists'}


def register_routes(app, runtime, discovery):
    from fastapi import HTTPException

    @app.get('/api/curiosity/workflow')
    def curiosity_workflow_list():
        return {'questions': list_workflow(runtime)}

    @app.post('/api/curiosity/{ident}/investigate')
    def curiosity_investigate(ident: str):
        try:
            return investigate(runtime, discovery, ident)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
