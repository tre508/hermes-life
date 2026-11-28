"""HA-012: a tested candidate is not an applied host change (spec §4.4).

The workflow resolver must distinguish:
  - accepted, NOT applied  -> 'Accepted — not yet applied to host' (open_apply)
  - accepted, applied      -> 'Completed' (the only state that earns it)
The progress ranker then treats only 'Completed' as integrated, so an accepted
candidate ranks 'decided' until the host actually has the changes.
"""
from hermes_life import workflow_status as ws

DISC = {'id': 'd1', 'state': 'approved', 'goal_id': None}


def _index(run_state=None, applied_at=None, decision='accepted'):
    run = {'id': 'r1', 'state': run_state}
    if applied_at:
        run['applied_at'] = applied_at
    return {
        'goals': {}, 'tasks': {},
        'plans_by_formulation': {'f1': {'id': 'p1'}},
        'runs_by_plan': {'p1': run},
        'formulations_by_discovery': {'d1': {'id': 'f1', 'goal_id': None}},
        'curiosity_by_discovery': {},
        'reviews': {'r1': {'run_id': 'r1', 'decision': decision}},
        'verifications': {},
    }


def test_accepted_without_apply_is_not_completed():
    rec = ws.WorkflowStatus._derive(DISC, _index(run_state='candidate_passed'))
    assert rec['status'] == 'Accepted — not yet applied to host'
    assert rec['next_action'] == 'open_apply'
    assert rec['stage'] == 'history'


def test_accepted_and_applied_is_completed():
    rec = ws.WorkflowStatus._derive(DISC, _index(run_state='applied'))
    assert rec['status'] == 'Completed'
    assert rec['next_action'] == 'none'


def test_accepted_with_applied_stamp_is_completed():
    rec = ws.WorkflowStatus._derive(
        DISC, _index(run_state='candidate_passed', applied_at='2026-11-27'))
    assert rec['status'] == 'Completed'


def test_rejected_stays_rejected():
    rec = ws.WorkflowStatus._derive(DISC, _index(decision='rejected'))
    assert rec['status'] == 'Rejected'
