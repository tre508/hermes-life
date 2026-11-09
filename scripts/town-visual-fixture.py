#!/usr/bin/env python3
"""Drive the seven residents of the Hermes Life 3D world through every state they can display.

Why this exists: the world never invents activity. Each resident's pose comes from a real record — a
task the agent is executing, a running investigation goal, a plan awaiting approval, an implementation
run, a memory review — so during one chat task only the coordinator moves and the other six correctly
sit idle. Waiting for the real pipeline to put all seven in flight would take half an hour and would
still only ever light up the roles that happen to be busy.

This writes rows in exactly those record shapes into the same SQLite database the renderer reads.
Ids are real UUIDs, so the labels look like production ("Running your task 3f9a2c81"). Every id it
creates is recorded in a ledger next to the database; `clear` deletes exactly those and restores the
agent state it found. Nothing here can start or advance a real agent run.

    python3 scripts/town-visual-fixture.py list        # the 15 states, in order
    python3 scripts/town-visual-fixture.py tableau     # most the model can show at once
    python3 scripts/town-visual-fixture.py step 6      # apply one state and stop
    python3 scripts/town-visual-fixture.py cycle       # walk all 15, 24s each
    python3 scripts/town-visual-fixture.py show        # what each resident should be showing
    python3 scripts/town-visual-fixture.py clear       # remove fixture rows, restore agent state

The world panel polls /api every 20 seconds, so each cycle step is held longer than that. To skip the
wait, paste `__hermesTown.refresh(true)` into the browser console after applying a step.

Two states are deliberately absent because the system cannot produce them:
  * the planner working — the backend writes a plan only as `proposed` or `approved`; the plan text is
    drafted inside the coordinator's own task, so `deriveFromRecords`' drafting branch never fires.
  * builder, tester and reviewer working at the same time — all three read the same newest
    implementation run, so at most one of them is ever non-idle.
"""

import argparse
import datetime
import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from uuid import uuid4

DB = Path(os.getenv('HERMES_LIFE_DB', str(Path.home() / '.local/share/hermes-life/life.db')))
LEDGER = DB.parent / 'town-fixture.json'
STEP_SECONDS = 24

# (table, key column) — the whole footprint, so `clear` cannot miss a row.
TABLES = (
    ('tasks', 'id'),
    ('goals', 'id'),
    ('investigation_plans', 'id'),
    ('implementation_runs', 'id'),
    ('implementation_reviews', 'run_id'),
    ('implementation_revisions', 'run_id'),
    ('implementation_revisions', 'id'),
    ('hl_memory_reviews', 'task_id'),
)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def connect():
    if not DB.exists():
        sys.exit(f'no database at {DB} — start the backend once so it creates the schema')
    connection = sqlite3.connect(str(DB))
    connection.row_factory = sqlite3.Row
    return connection


def load_ledger():
    if LEDGER.exists():
        try:
            return json.loads(LEDGER.read_text())
        except json.JSONDecodeError:
            pass
    return {'ids': {table + '.' + key: [] for table, key in TABLES}, 'agent': None}


def save_ledger(ledger):
    LEDGER.write_text(json.dumps(ledger, indent=2))


def note(ledger, table, key, value):
    bucket = ledger['ids'].setdefault(table + '.' + key, [])
    if value not in bucket:
        bucket.append(value)
    save_ledger(ledger)      # persist immediately: an id we cannot find is a row we cannot clear


def wipe(connection, ledger):
    deleted = {}
    for table, key in TABLES:
        values = ledger['ids'].get(table + '.' + key, [])
        if not values:
            deleted[f'{table}.{key}'] = 0
            continue
        marks = ','.join('?' * len(values))
        deleted[f'{table}.{key}'] = connection.execute(
            f'DELETE FROM {table} WHERE {key} IN ({marks})', values).rowcount
    connection.commit()
    for bucket in ledger['ids'].values():
        bucket.clear()
    save_ledger(ledger)
    return deleted


def save_agent(connection, ledger):
    if ledger.get('agent'):
        return
    row = connection.execute('SELECT state,current_task FROM agent_state WHERE id=1').fetchone()
    ledger['agent'] = {'state': row['state'], 'current_task': row['current_task']}
    save_ledger(ledger)


def set_agent(connection, state, task):
    connection.execute('UPDATE agent_state SET state=?,current_task=?,updated_at=? WHERE id=1',
                       (state, task, now()))
    connection.commit()


# --- record writers ------------------------------------------------------------------------------

def add_task(connection, ledger, state, prompt):
    ident = str(uuid4())
    stamp = now()
    connection.execute(
        'INSERT INTO tasks (id,prompt,state,created_at,updated_at) VALUES (?,?,?,?,?)',
        (ident, prompt, state, stamp, stamp))
    note(ledger, 'tasks', 'id', ident)
    return ident


def add_goal(connection, ledger, state, title):
    ident = str(uuid4())
    stamp = now()
    connection.execute(
        'INSERT INTO goals (id,title,prompt,state,priority,created_at,updated_at,task_id,error) '
        'VALUES (?,?,?,?,?,?,?,NULL,NULL)',
        (ident, title, title, state, 5, stamp, stamp))
    note(ledger, 'goals', 'id', ident)
    return ident


def add_plan(connection, ledger, state):
    ident = str(uuid4())
    connection.execute(
        'INSERT INTO investigation_plans (id,formulation_id,task_id,report,state,approved_at,created_at) '
        'VALUES (?,?,?,?,?,NULL,?)',
        (ident, str(uuid4()), str(uuid4()), '# Plan\n\nInvestigate the renderer.', state, now()))
    note(ledger, 'investigation_plans', 'id', ident)
    return ident


def add_run(connection, ledger, state, project='hermes-life'):
    ident = str(uuid4())
    stamp = now()
    connection.execute(
        'INSERT INTO implementation_runs (id,plan_id,project,state,created_at,updated_at) '
        'VALUES (?,?,?,?,?,?)',
        (ident, str(uuid4()), project, state, stamp, stamp))
    note(ledger, 'implementation_runs', 'id', ident)
    return ident


def add_review(connection, ledger, run_id, decision):
    connection.execute(
        'INSERT INTO implementation_reviews (run_id,decision,evidence_sha256,criteria_json,feedback,decided_at) '
        'VALUES (?,?,?,?,?,?)',
        (run_id, decision, 'fixture', '[]', 'fixture decision', now()))
    note(ledger, 'implementation_reviews', 'run_id', run_id)


def add_revision(connection, ledger, run_id, state, attempt=1):
    ident = str(uuid4())
    stamp = now()
    connection.execute(
        'INSERT INTO implementation_revisions '
        '(id,run_id,attempt,state,feedback,snapshot_sha256,response,created_at,updated_at) '
        'VALUES (?,?,?,?,?,?,?,?,?)',
        (ident, run_id, attempt, state, 'fixture feedback', 'fixture', '', stamp, stamp))
    note(ledger, 'implementation_revisions', 'id', ident)
    note(ledger, 'implementation_revisions', 'run_id', run_id)


def add_memory_review(connection, ledger, status='pending'):
    task_id = str(uuid4())
    connection.execute(
        'INSERT INTO hl_memory_reviews (task_id,candidate,reason,status,created_at) VALUES (?,?,?,?,?)',
        (task_id, 'Candidate memory from a finished task.', 'Awaiting review', status, now()))
    note(ledger, 'hl_memory_reviews', 'task_id', task_id)


# --- the scenarios -------------------------------------------------------------------------------

def step_idle(connection, ledger):
    return 'nothing in flight — every resident idle'


def step_coordinator_working(connection, ledger):
    save_agent(connection, ledger)
    ident = add_task(connection, ledger, 'started',
                     'Read the renderer and summarise how the scene is composed.')
    set_agent(connection, 'executing', ident)
    return 'coordinator working at his console; the other six idle'


def step_coordinator_queued(connection, ledger):
    save_agent(connection, ledger)
    add_task(connection, ledger, 'queued', 'First queued task.')
    add_task(connection, ledger, 'queued', 'Second queued task.')
    set_agent(connection, 'idle', None)
    return 'coordinator queued, with a badge'


def step_researcher(connection, ledger):
    save_agent(connection, ledger)
    add_goal(connection, ledger, 'running', 'Investigate how the renderer composes the scene')
    return 'researcher working at the Research Laboratory'


def step_researcher_queued(connection, ledger):
    save_agent(connection, ledger)
    add_goal(connection, ledger, 'pending', 'Investigate the memory surface')
    return 'researcher queued — goal accepted but not yet running (badge)'


def step_planner_waiting(connection, ledger):
    add_plan(connection, ledger, 'proposed')
    return 'planner waiting for your approval (badge, arms folded)'


# There is deliberately no "planner drafting" step. The backend only ever writes a plan as `proposed`
# (investigation.py:190) or `approved` (investigation.py:62); the plan text is drafted inside the
# coordinator's own task. `deriveFromRecords`' `drafting` branch therefore cannot fire, and inventing a
# `drafting` row here would demonstrate a state the system can never actually be in.


def step_builder(connection, ledger):
    add_run(connection, ledger, 'implementing')
    return 'builder working at the Development Studio'


def step_builder_revision(connection, ledger):
    run_id = add_run(connection, ledger, 'implementing')
    add_revision(connection, ledger, run_id, 'running')
    return 'builder revising the candidate'


def step_tester(connection, ledger):
    add_run(connection, ledger, 'testing_baseline')
    return 'tester working at the Verification Laboratory'


def step_tester_failed(connection, ledger):
    add_run(connection, ledger, 'candidate_failed')
    return 'tester failed — stationary alert, no motion'


def step_reviewer_waiting(connection, ledger):
    add_run(connection, ledger, 'candidate_passed')
    return 'reviewer waiting for your review'


def step_reviewer_accepted(connection, ledger):
    run_id = add_run(connection, ledger, 'candidate_passed')
    add_review(connection, ledger, run_id, 'accepted')
    return 'reviewer completed — one brief flash'


def step_builder_failed(connection, ledger):
    add_run(connection, ledger, 'failed')
    return 'builder failed — stationary alert'


def step_builder_blocked(connection, ledger):
    add_run(connection, ledger, 'interrupted')
    return 'builder blocked — stationary alert'


def step_archivist(connection, ledger):
    add_memory_review(connection, ledger, 'pending')
    return 'archivist waiting, with pending memory reviews'


def step_tableau(connection, ledger):
    """The most the model can show at once.

    Builder, tester and reviewer all read the newest implementation run, so only one of those three can
    be non-idle at a time. That is the data model, not a rendering limit.
    """
    save_agent(connection, ledger)
    ident = add_task(connection, ledger, 'started', 'Test the world: check every resident state.')
    set_agent(connection, 'executing', ident)
    add_goal(connection, ledger, 'running', 'Investigate the scene composition')
    add_plan(connection, ledger, 'proposed')
    add_run(connection, ledger, 'implementing')
    add_memory_review(connection, ledger, 'pending')
    return ('coordinator working · researcher working · planner waiting · builder working · '
            'archivist waiting · tester and reviewer idle (they share the newest run)')


STEPS = [
    ('idle', step_idle),
    ('coordinator-working', step_coordinator_working),
    ('coordinator-queued', step_coordinator_queued),
    ('researcher', step_researcher),
    ('researcher-queued', step_researcher_queued),
    ('planner-waiting', step_planner_waiting),
    ('builder', step_builder),
    ('builder-revision', step_builder_revision),
    ('tester', step_tester),
    ('tester-failed', step_tester_failed),
    ('reviewer-waiting', step_reviewer_waiting),
    ('reviewer-accepted', step_reviewer_accepted),
    ('builder-failed', step_builder_failed),
    ('builder-blocked', step_builder_blocked),
    ('archivist', step_archivist),
]


def refuse_if_real_work_running(connection, ledger):
    """Never overwrite the agent state while a real task is executing: the panel would then lie."""
    row = connection.execute('SELECT state,current_task FROM agent_state WHERE id=1').fetchone()
    known = set(ledger['ids'].get('tasks.id', []))
    if row['state'] == 'executing' and row['current_task'] and row['current_task'] not in known:
        sys.exit('a real task is executing right now. Finish it (or wait) before running the fixture — '
                 'otherwise the world would show test data while your task runs.')


def apply(connection, ledger, build):
    refuse_if_real_work_running(connection, ledger)
    wipe(connection, ledger)
    set_agent(connection, 'idle', None)
    note_text = build(connection, ledger)
    connection.commit()
    save_ledger(ledger)
    return note_text


# --- reporting -----------------------------------------------------------------------------------

def snapshot(connection):
    return {
        'agent': connection.execute('SELECT state,current_task FROM agent_state WHERE id=1').fetchone(),
        'tasks': [dict(r) for r in connection.execute('SELECT id,state FROM tasks')],
        'goals': [dict(r) for r in connection.execute('SELECT id,state,title FROM goals')],
        'plans': [dict(r) for r in connection.execute('SELECT id,state FROM investigation_plans')],
        'runs': [dict(r) for r in connection.execute(
            'SELECT id,state,created_at FROM implementation_runs ORDER BY created_at DESC')],
        'reviews': [dict(r) for r in connection.execute('SELECT run_id,decision FROM implementation_reviews')],
        'memories': [dict(r) for r in connection.execute('SELECT status FROM hl_memory_reviews')],
    }


def expected(rows):
    """The mapping the renderer applies (frontend/src/town-model.ts deriveFromRecords)."""
    agent, tasks = rows['agent'], rows['tasks']
    goals, plans, runs = rows['goals'], rows['plans'], rows['runs']
    reviews, memories = rows['reviews'], rows['memories']
    out = {}
    queued = [t for t in tasks if str(t.get('state')) == 'queued']
    if agent['current_task'] and agent['state'] == 'executing':
        out['coordinator'] = 'working'
    elif queued:
        out['coordinator'] = 'queued'
    else:
        out['coordinator'] = 'idle'
    out['researcher'] = ('working' if any(g['state'] == 'running' for g in goals)
                         else 'queued' if goals else 'idle')
    proposed = [p for p in plans if p['state'] == 'proposed']
    drafting = [p for p in plans if p['state'] not in ('proposed', 'approved', 'completed', 'failed')]
    out['planner'] = 'waiting_approval' if proposed else ('working' if drafting else 'idle')
    run = runs[0] if runs else None
    if not run:
        out['builder'] = out['tester'] = out['reviewer'] = 'idle'
    else:
        state = run['state']
        out['builder'] = {'implementing': 'working', 'preparing': 'working',
                          'failed': 'failed', 'interrupted': 'blocked'}.get(state, 'idle')
        out['tester'] = {'testing_baseline': 'working', 'evaluating': 'working',
                         'candidate_passed': 'completed', 'candidate_failed': 'failed',
                         'evaluation_error': 'blocked'}.get(state, 'idle')
        decision = next((r['decision'] for r in reviews if r['run_id'] == run['id']), None)
        if decision in ('accepted', 'rejected'):
            out['reviewer'] = 'completed'
        elif state in ('candidate_passed', 'candidate_failed', 'evaluation_error'):
            out['reviewer'] = 'waiting_approval'
        else:
            out['reviewer'] = 'idle'
    out['archivist'] = ('waiting_approval'
                        if any(str(m['status']) in ('pending', 'open', 'proposed') for m in memories)
                        else 'idle')
    order = ['coordinator', 'researcher', 'planner', 'builder', 'tester', 'reviewer', 'archivist']
    return [(role, out[role]) for role in order]


def show(connection):
    rows = snapshot(connection)
    agent = rows['agent']
    print(f'database : {DB}')
    print(f'agent    : state={agent["state"]!r} current_task={agent["current_task"]!r}')
    print(f'tasks    : {[(t["id"][:8], t["state"]) for t in rows["tasks"]] or "none"}')
    print(f'goals    : {[(g["state"], g["title"][:40]) for g in rows["goals"]] or "none"}')
    print(f'plans    : {[(p["id"][:8], p["state"]) for p in rows["plans"]] or "none"}')
    print(f'runs     : {[(r["id"][:8], r["state"]) for r in rows["runs"]] or "none"}')
    print(f'reviews  : {[(r["run_id"][:8], r["decision"]) for r in rows["reviews"]] or "none"}')
    print(f'memory   : {[m["status"] for m in rows["memories"]] or "none"}')
    print()
    for role, state in expected(rows):
        print(f'  {role:<12} {state}')
    print('\n\"expected\" is what frontend/src/town-model.ts decides from these rows; compare with the panel.')


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('mode', nargs='?', default='show',
                        choices=['show', 'list', 'tableau', 'step', 'cycle', 'clear'])
    parser.add_argument('index', nargs='?', type=int, default=None, help='step number for `step`')
    parser.add_argument('--seconds', type=float, default=STEP_SECONDS,
                        help=f'how long to hold each cycle step (default {STEP_SECONDS}s; the panel '
                             'polls every 20s)')
    args = parser.parse_args()

    if args.mode == 'list':
        for index, (name, _) in enumerate(STEPS):
            print(f'{index:>3}  {name}')
        print(f'{len(STEPS):>3}  tableau (several at once)')
        return

    connection = connect()
    ledger = load_ledger()

    if args.mode == 'clear':
        deleted = wipe(connection, ledger)
        if ledger.get('agent'):
            set_agent(connection, ledger['agent'].get('state', 'idle'),
                      ledger['agent'].get('current_task'))
        else:
            set_agent(connection, 'idle', None)
        ledger['agent'] = None
        save_ledger(ledger)
        print('removed :', ', '.join(f'{k.split(".")[0]}={v}' for k, v in deleted.items() if v))
        print('agent   : restored')
        return

    if args.mode == 'show':
        show(connection)
        return

    if args.mode == 'tableau':
        print(apply(connection, ledger, step_tableau))
        print()
        show(connection)
        return

    if args.mode == 'step':
        if args.index is None or not 0 <= args.index < len(STEPS):
            sys.exit(f'give a step number 0–{len(STEPS) - 1} (see `list`)')
        name, build = STEPS[args.index]
        print(f'[{args.index}] {name}')
        print(apply(connection, ledger, build))
        print()
        show(connection)
        return

    print(f'cycling {len(STEPS)} steps at {args.seconds}s each — Ctrl-C stops, `clear` restores.')
    try:
        for index, (name, build) in enumerate(STEPS):
            print(f'\n[{index}/{len(STEPS) - 1}] {name}')
            print('    ' + apply(connection, ledger, build))
            rows = snapshot(connection)
            print('    expected: ' + ' · '.join(f'{r}={s}' for r, s in expected(rows) if s != 'idle'))
            time.sleep(args.seconds)
    except KeyboardInterrupt:
        print('\ninterrupted')
    finally:
        connection.close()
    print('last step is still in place — run `clear` to restore.')


if __name__ == '__main__':
    main()