"""HL-UI-STATE-001: one read-only status authority for the workflow chain.

Covers the status table, duplicate grouping, the no-write guarantee, and the agreement between
the annotating endpoints and the snapshot endpoint.
"""
import hashlib
import json

import pytest
from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.schema import migrate

NOTE = '# TODO: Add automated tests for this project'


def chain(app, discovery_id, *, discovery_state='approved', fingerprint=None, project='demo',
          path='main.py', note=None, goal=None, task=None, formulation=None, plan=None, run=None,
          review=None, created_at='2026-01-01T00:00:00+00:00'):
    """Insert one link of the chain, leaving absent stages absent.

    The note defaults to something unique per discovery: findings that share a project, path and
    normalised note are the same underlying issue, so a fixture wanting duplicates must say so.
    """
    note = note or '# TODO: handle ' + discovery_id
    con = app.state.runtime.store.connection
    with app.state.runtime.store.lock:
        con.execute("""INSERT INTO discoveries(id,fingerprint,project,path,line,note,proposed_prompt,
            rationale,state,created_at,updated_at,goal_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                    # The column is UNIQUE, so seeded rows need distinct stored fingerprints;
                    # only the duplicate test deliberately collides after normalisation.
                    (discovery_id, fingerprint or json.dumps([project, path, note, discovery_id]),
                     project, path, 1, note, 'p', 'r', discovery_state, created_at, created_at,
                     goal[0] if goal else None))
        if formulation:
            con.execute("""INSERT INTO formulated_goals(id,discovery_id,title,action,rationale,
                acceptance,prompt,priority,state,goal_id,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (formulation, discovery_id, 'work', 'coding', 'why', '[]', 'prompt', 50,
                         'approved', goal[0] if goal else None, created_at, created_at))
        if goal:
            con.execute("""INSERT INTO goals(id,title,prompt,state,priority,created_at,updated_at,
                task_id,error) VALUES (?,?,?,?,?,?,?,?,?)""",
                        (goal[0], 'Investigation', 'inspect', goal[1], 50, created_at, created_at,
                         task[0] if task else None, None))
        if task:
            con.execute("""INSERT INTO tasks(id,prompt,state,created_at,updated_at,result,error,
                session_id) VALUES (?,?,?,?,?,?,?,?)""",
                        (task[0], 'inspect', task[1], created_at, created_at, 'evidence', None, None))
        if plan:
            con.execute("""INSERT INTO investigation_plans(id,formulation_id,task_id,report,created_at,
                state,approved_at) VALUES (?,?,?,?,?,?,?)""",
                        (plan[0], formulation, task[0] if task else 'task', json.dumps({'summary': 's',
                         'acceptance_criteria': ['c']}), created_at, plan[1], created_at))
        if run:
            con.execute("""INSERT INTO implementation_runs(id,plan_id,project,state,candidate_path,
                baseline_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)""",
                        (run[0], plan[0], project, run[1], '/vm/c', '/vm/b', created_at, created_at))
        if review:
            con.execute("""INSERT INTO implementation_reviews(run_id,decision,evidence_sha256,
                criteria_json,feedback,decided_at,decided_by) VALUES (?,?,?,?,?,?,?)""",
                        (run[0], review, 'sha', '[true]', 'ok', created_at, 'human'))
        con.commit()


def build(tmp_path):
    app = create_app(tmp_path / 'uistate.db')
    migrate(app.state.runtime.store.connection)
    return app


def status_of(app, discovery_id):
    return app.state.workflow.snapshot()['discoveries'][discovery_id]


def checksum(app):
    con = app.state.runtime.store.connection
    digest = hashlib.sha256()
    for table in ('discoveries', 'curiosity', 'goals', 'formulated_goals', 'investigation_plans',
                  'implementation_runs', 'implementation_reviews'):
        for row in con.execute('SELECT * FROM ' + table + ' ORDER BY rowid'):
            digest.update(repr(tuple(row)).encode())
    return digest.hexdigest()


def test_every_stage_of_the_status_table(tmp_path):
    app = build(tmp_path)
    base = '2026-01-01T00:00:00+00:00'
    chain(app, 'd-proposed', discovery_state='proposed', created_at=base)
    chain(app, 'd-queued', goal=('g-queued', 'pending'), created_at=base)
    chain(app, 'd-running', goal=('g-running', 'running'), task=('t-running', 'running'), created_at=base)
    chain(app, 'd-complete', formulation='f-complete', goal=('g-complete', 'completed'),
          task=('t-complete', 'completed'), created_at=base)
    chain(app, 'd-ready', formulation='f-ready', goal=('g-ready', 'completed'),
          task=('t-ready', 'completed'), plan=('p-ready', 'proposed'), created_at=base)
    chain(app, 'd-awaiting', formulation='f-awaiting', goal=('g-awaiting', 'completed'),
          task=('t-awaiting', 'completed'), plan=('p-awaiting', 'approved'), created_at=base)
    chain(app, 'd-building', formulation='f-building', goal=('g-building', 'completed'),
          task=('t-building', 'completed'), plan=('p-building', 'approved'),
          run=('r-building', 'implementing'), created_at=base)
    chain(app, 'd-review', formulation='f-review', goal=('g-review', 'completed'),
          task=('t-review', 'completed'), plan=('p-review', 'approved'),
          run=('r-review', 'candidate_passed'), created_at=base)
    chain(app, 'd-done', formulation='f-done', goal=('g-done', 'completed'),
          task=('t-done', 'completed'), plan=('p-done', 'approved'),
          run=('r-done', 'candidate_passed'), review='accepted', created_at=base)
    chain(app, 'd-dismissed', discovery_state='dismissed', created_at=base)

    snapshot = app.state.workflow.snapshot()
    stages = {
        'd-proposed': ('active', 'Proposed'),
        'd-queued': ('in_progress', 'Queued'),
        'd-running': ('in_progress', 'Investigating'),
        'd-complete': ('in_progress', 'Investigation complete'),
        'd-ready': ('planning', 'Plan ready'),
        'd-awaiting': ('planning', 'Awaiting build'),
        'd-building': ('build', 'Building'),
        'd-review': ('build', 'Awaiting review'),
        'd-done': ('history', 'Completed'),
        'd-dismissed': ('history', 'Dismissed'),
    }
    for ident, (stage, status) in stages.items():
        record = snapshot['discoveries'][ident]
        assert (record['stage'], record['status']) == (stage, status), (ident, record)
    # Approval alone is never completion: only the accepted candidate is history.
    assert snapshot['discoveries']['d-queued']['status'] != 'Completed'
    assert snapshot['counts']['active'] == 1 and snapshot['counts']['history'] == 2
    assert snapshot['counts']['in_progress'] == 3      # queued, running, investigation complete
    assert snapshot['counts']['planning'] == 2 and snapshot['counts']['build'] == 2
    assert snapshot['counts']['needs_attention'] == 4  # active + in_progress, nothing else


def test_a_finished_investigation_leaves_the_active_view_without_being_deleted(tmp_path):
    app = build(tmp_path)
    chain(app, 'd-one', note=NOTE, formulation='f-one', goal=('g-one', 'completed'),
          task=('t-one', 'completed'))
    snapshot = app.state.workflow.snapshot()
    assert snapshot['discoveries']['d-one']['stage'] == 'in_progress'
    # The row is still there, untouched, with its evidence.
    with app.state.runtime.store.lock:
        row = app.state.runtime.store.connection.execute(
            "SELECT state, note FROM discoveries WHERE id='d-one'").fetchone()
    assert row['state'] == 'approved' and row['note'] == NOTE


def test_resolution_writes_nothing(tmp_path):
    app = build(tmp_path)
    chain(app, 'd-a', goal=('g-a', 'running'), task=('t-a', 'running'))
    chain(app, 'd-b', discovery_state='proposed')
    before = checksum(app)
    app.state.workflow.snapshot()
    app.state.workflow.annotate('discoveries', [{'id': 'd-a'}, {'id': 'd-b'}])
    assert checksum(app) == before


def test_duplicate_findings_are_grouped_and_marked_superseded(tmp_path):
    app = build(tmp_path)
    # Same todo, two line numbers: the canonical identity ignores the line, the stored column
    # (legacy rows) does not.
    chain(app, 'd-old', discovery_state='proposed', note=NOTE, path='main.py',
          created_at='2026-01-01T00:00:00+00:00')
    chain(app, 'd-new', discovery_state='proposed', note=NOTE, path='main.py',
          fingerprint=json.dumps(['demo', 'main.py', 3, NOTE]),
          created_at='2026-02-01T00:00:00+00:00')
    snapshot = app.state.workflow.snapshot()
    old, new = snapshot['discoveries']['d-old'], snapshot['discoveries']['d-new']
    assert old['status'] == 'Proposed' and old['duplicate_of'] is None and old['group_size'] == 2
    assert new['status'] == 'Superseded' and new['duplicate_of'] == 'd-old'
    assert new['own_status'] == 'Proposed'
    assert 'duplicate of d-old' in new['reason']
    assert snapshot['counts']['superseded'] == 1


def test_a_completed_twin_supersedes_unfinished_duplicates(tmp_path):
    app = build(tmp_path)
    chain(app, 'd-done', note=NOTE, formulation='f', goal=('g', 'completed'), task=('t', 'completed'),
          plan=('p', 'approved'), run=('r', 'candidate_passed'), review='accepted',
          created_at='2026-01-01T00:00:00+00:00')
    chain(app, 'd-tw', note=NOTE, formulation='f2', goal=('g2', 'completed'), task=('t2', 'completed'),
          plan=('p2', 'approved'), created_at='2026-02-01T00:00:00+00:00')
    snapshot = app.state.workflow.snapshot()
    assert snapshot['discoveries']['d-done']['status'] == 'Completed'
    twin = snapshot['discoveries']['d-tw']
    assert twin['status'] == 'Superseded' and twin['duplicate_of'] == 'd-done'
    assert 'Completed' in twin['reason']
    # The superseded plan is marked too, so nobody starts a build for finished work.
    assert snapshot['plans']['p2']['status'] == 'Superseded'


def test_curiosity_badge_follows_the_chain_not_its_own_state(tmp_path):
    app = build(tmp_path)
    chain(app, 'd-c', formulation='f-c', goal=('g-c', 'completed'), task=('t-c', 'completed'),
          plan=('p-c', 'approved'), run=('r-c', 'candidate_passed'))
    with app.state.runtime.store.lock:
        app.state.runtime.store.connection.execute(
            """INSERT INTO curiosity(id,discovery_id,question,category,priority,state,rationale,
               created_at,updated_at) VALUES ('c-1','d-c','What is the impact?','research',40,
               'investigating','r','t','t')""")
        app.state.runtime.store.connection.commit()
    record = app.state.workflow.snapshot()['curiosity']['c-1']
    assert record['curiosity_state'] == 'investigating'      # the stale column
    assert record['status'] == 'Awaiting review'             # the verified chain
    assert record['next_action'] == 'open_review'


def test_results_are_reproducible_across_resolvers(tmp_path):
    app = build(tmp_path)
    chain(app, 'd-r', goal=('g-r', 'running'), task=('t-r', 'running'))
    first = app.state.workflow.snapshot()
    second = app.state.workflow.snapshot()
    first.pop('generated_at'), second.pop('generated_at')
    assert first == second, 'status must not depend on in-memory state'


def test_the_curiosity_workflow_route_the_tab_renders_is_annotated(tmp_path):
    """The Discover tab renders /api/curiosity/workflow, so that route needs the verdict too."""
    app = build(tmp_path)
    chain(app, 'd-cw', note=NOTE, formulation='f-cw', goal=('g-cw', 'completed'),
          task=('t-cw', 'completed'), plan=('p-cw', 'approved'), run=('r-cw', 'candidate_passed'))
    with app.state.runtime.store.lock:
        app.state.runtime.store.connection.execute(
            """INSERT INTO curiosity(id,discovery_id,question,category,priority,state,rationale,
               created_at,updated_at) VALUES ('c-1','d-cw','What is the impact?','research',40,
               'investigating','r','t','t')""")
        app.state.runtime.store.connection.commit()
    with TestClient(app) as client:
        rows = client.get('/api/curiosity/workflow').json()['questions']
        row = next(r for r in rows if r['id'] == 'c-1')
        assert row['workflow']['status'] == 'Awaiting review'
        assert row['workflow']['next_action'] == 'open_review'
        assert row['plan_id'] == 'p-cw'          # what the "View plan" button needs
        assert row['state'] == 'investigating'   # the stored column is left alone


def test_endpoints_annotate_consistently(tmp_path):
    app = build(tmp_path)
    chain(app, 'd-one', formulation='f-one', goal=('g-one', 'completed'), task=('t-one', 'completed'),
          plan=('p-one', 'approved'), run=('r-one', 'candidate_passed'))
    with TestClient(app) as client:
        snapshot = client.get('/api/workflow/status').json()
        discoveries = client.get('/api/discoveries').json()
        plans = client.get('/api/investigation-plans').json()
        runs = client.get('/api/implementations').json()
        goals = client.get('/api/goals').json()
        assert discoveries[0]['workflow']['status'] == snapshot['discoveries']['d-one']['status']
        assert plans[0]['workflow']['status'] == snapshot['plans']['p-one']['status']
        assert runs[0]['workflow']['status'] == snapshot['runs']['r-one']['status']
        assert goals[0]['workflow']['status'] == snapshot['goals']['g-one']['status']
        assert all('workflow' in row for row in discoveries + plans + runs + goals)
        # The tabs therefore cannot disagree about the same record.
        assert runs[0]['workflow']['stage'] == 'build'
        assert client.get('/api/workflow/status').json()['counts']['build'] == 1
