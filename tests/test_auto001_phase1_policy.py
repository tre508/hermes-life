"""HL-AUTO-001 Phase 1 exit gate: shared persistence + policy.

Covers the §26.10 Phase 1 gate: fresh/legacy DB migration, idempotency, deny-without-mutation,
policy version and restart tests.
"""
import sqlite3

from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.autonomy_policy import AutonomyPolicy, PolicyDenied
from hermes_life.opportunities import OpportunityRegistry
from hermes_life.schema import migrate
from hermes_life.store import Store


class FakeAdapter:
    def available(self):return True
    def run(self,prompt,callback,task_id=None):
        callback('hermes.result',{'text':prompt})
        return {'result':prompt,'session_id':'fake'}
    def cancel(self, task_id):
        return True


def _store(path):
    store = Store(path)
    migrate(store.connection)
    return store


def _legacy_db(tmp_path):
    """A database at schema v33 — a legacy install that must migrate cleanly."""
    path = tmp_path / 'legacy.db'
    conn = sqlite3.connect(path)
    conn.execute('PRAGMA user_version=33')
    conn.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY)")
    conn.commit()
    conn.close()
    return path


def test_fresh_database_migrates_to_v34_with_defaults(tmp_path):
    conn = sqlite3.connect(tmp_path / 'fresh.db')
    migrate(conn)
    assert conn.execute('PRAGMA user_version').fetchone()[0] >= 34
    row = conn.execute('SELECT mode, policy_version FROM autonomy_policy_settings'
                       ' WHERE id=1').fetchone()
    assert row == ('observe', 1), 'default must be Observe: no background execution'
    conn.close()


def test_legacy_v33_database_migrates_without_data_loss(tmp_path):
    path = _legacy_db(tmp_path)
    conn = sqlite3.connect(path)
    migrate(conn)
    assert conn.execute('PRAGMA user_version').fetchone()[0] >= 34
    assert conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 0
    # Re-running migration must be idempotent (restart safety).
    migrate(conn)
    assert conn.execute('PRAGMA user_version').fetchone()[0] >= 34
    conn.close()


def test_opportunity_ingest_is_idempotent_on_dedupe_key(tmp_path):
    store = _store(tmp_path / 'auto.db')
    policy = AutonomyPolicy(store)
    registry = OpportunityRegistry(store, policy)
    kwargs = dict(source_type='repeated_workflow', title='Deduplicate exports',
                  problem='The same export is rebuilt by hand weekly',
                  evidence_refs=['task:abc'], dedupe_key='workflow:export:weekly')
    first = registry.ingest(**kwargs)
    second = registry.ingest(**kwargs)
    assert first['duplicate'] is False
    assert second['duplicate'] is True
    assert second['id'] == first['id']
    assert len(registry.list()) == 1


def test_ingest_rejects_unsupported_model_claims(tmp_path):
    store = _store(tmp_path / 'auto.db')
    registry = OpportunityRegistry(store, AutonomyPolicy(store))
    try:
        registry.ingest('task_outcome', 'No evidence', 'A model guessed this',
                        evidence_refs=[], dedupe_key='k1')
        raised = False
    except ValueError:
        raised = True
    assert raised, 'an opportunity without evidence references must be refused'


def test_policy_denies_without_mutation_and_audits(tmp_path):
    store = _store(tmp_path / 'auto.db')
    policy = AutonomyPolicy(store)
    # Default mode is observe: host_apply is grant-only and must be denied.
    before = policy.grants()
    decision = policy.evaluate('host_apply')
    assert decision['allowed'] is False
    after = policy.grants()
    # Deny-without-mutation: the only change is the audit ledger row itself.
    assert len(after) == len(before) + 1
    assert after[0]['decision'] == 'denied'
    require_raised = False
    try:
        policy.require('host_apply')
    except PolicyDenied:
        require_raised = True
    assert require_raised


def test_policy_modes_and_grant_boundaries(tmp_path):
    store = _store(tmp_path / 'auto.db')
    policy = AutonomyPolicy(store)
    assert policy.evaluate('inspect_read')['allowed'] is True   # observe
    assert policy.evaluate('propose_project')['allowed'] is False
    policy.configure(mode='suggest')
    assert policy.evaluate('propose_project')['allowed'] is True
    assert policy.evaluate('isolated_edit')['allowed'] is False
    policy.configure(mode='independent')
    assert policy.evaluate('isolated_edit')['allowed'] is True
    # Mode can never implicitly authorize host apply / spend / secrets / core changes.
    for action in ('host_apply', 'spend', 'secrets_access', 'modify_core'):
        assert policy.evaluate(action)['allowed'] is False, action
    # An explicit grant authorizes exactly its action.
    grant = policy.grant('host_apply', rationale='User approved applying reviewed diff to host')
    assert policy.evaluate('host_apply')['allowed'] is True
    assert policy.evaluate('spend')['allowed'] is False
    assert policy.revoke(grant['id'], rationale='Withdrawn')['decision'] == 'revoked'
    assert policy.evaluate('host_apply')['allowed'] is False
    # Core modification cannot even be granted.
    try:
        policy.grant('modify_core', rationale='test')
        raised = False
    except ValueError:
        raised = True
    assert raised
    # Policy version advances on every configuration change (seed=1, two changes).
    assert policy.settings()['policy_version'] == 3


def test_budget_hard_cap_blocks(tmp_path):
    store = _store(tmp_path / 'auto.db')
    policy = AutonomyPolicy(store)
    assert policy.check_budget('tokens', 100)['enforced'] is False  # unconfigured = unknown
    policy.set_budget('tokens', 1000)
    assert policy.record_usage('tokens', 600)['allowed'] is True
    assert policy.record_usage('tokens', 900)['allowed'] is False, 'over cap must be blocked'
    assert policy.record_usage('tokens', 5)['allowed'] is False


def test_proposals_are_versioned_and_decisions_rationale_backed(tmp_path):
    store = _store(tmp_path / 'auto.db')
    policy = AutonomyPolicy(store)
    registry = OpportunityRegistry(store, policy)
    policy.configure(mode='suggest')
    opp = registry.ingest('repeated_workflow', 'Automate backups',
                          'Backups are run manually', evidence_refs=['task:e1'],
                          dedupe_key='backup')
    proposal = registry.propose(opp['id'], 'Automate backups',
                                'A CLI tool that runs nightly backups in the VM')
    assert proposal['status'] == 'awaiting_approval'
    assert proposal['version'] == 1
    v2 = registry.propose(opp['id'], 'Automate backups', 'Revised specification, v2')
    assert v2['version'] == 2
    assert registry.proposals(opp['id'])[0]['status'] == 'awaiting_approval'
    # Approval records who and why; it does not start work.
    decided = registry.decide_proposal(proposal['id'], True, rationale='Worth prototyping')
    assert decided['status'] == 'approved'
    # A decision without a rationale is refused — no fabricated internal reasoning.
    try:
        registry.decide(opp['id'], 'no_action', rationale='   ')
        raised = False
    except ValueError:
        raised = True
    assert raised
    decision = registry.decide(opp['id'], 'no_action', scores={'utility': 0.3},
                               rationale='Low value; revisit if backups fail again')
    assert decision['policy_version'] == policy.settings()['policy_version']


def test_api_surface_and_restart_persistence(tmp_path):
    db = tmp_path / 'api.db'
    with TestClient(create_app(database=db, adapter=FakeAdapter())) as client:
        config = client.get('/api/autonomy/config').json()
        assert config['mode'] == 'observe'
        patched = client.patch('/api/autonomy/config',
                               json={'mode': 'suggest', 'allowlist': ['/home/hermes/experiments']})
        assert patched.status_code == 200 and patched.json()['mode'] == 'suggest'
        created = client.post('/api/opportunities', json={
            'source_type': 'repeated_workflow', 'title': 'Automate report',
            'problem': 'Report is compiled by hand', 'evidence_refs': ['task:r1'],
            'dedupe_key': 'report'})
        assert created.status_code == 201
        opportunity_id = created.json()['opportunity']['id']
        proposal = client.post(f'/api/opportunities/{opportunity_id}/propose', json={
            'specification': 'A bounded report generator for weekly summaries'}).json()
        assert proposal['status'] == 'awaiting_approval'
        decided = client.post(f"/api/proposals/{proposal['id']}/decision", json={
            'approve': True, 'rationale': 'Useful weekly'}).json()
        assert decided['status'] == 'approved'
        assert client.get('/api/autonomy/decisions').json()['decisions'] == []
        grant = client.post('/api/approvals', json={
            'action': 'create_project_repo', 'rationale': 'Approved prototype'}).json()
        assert grant['decision'] == 'granted'
        budget = client.put('/api/autonomy/budgets', json={
            'resource': 'time_seconds', 'limit_amount': 3600}).json()
        assert budget['limit_amount'] == 3600
    # Restart on the same database: everything survives, no re-seeding side effects.
    with TestClient(create_app(database=db, adapter=FakeAdapter())) as restored:
        config = restored.get('/api/autonomy/config').json()
        assert config['mode'] == 'suggest'
        assert config['allowlist'] == ['/home/hermes/experiments']
        assert restored.get('/api/opportunities').json()['opportunities'][0]['id'] == opportunity_id
        assert restored.get('/api/proposals').json()['proposals'][0]['status'] == 'approved'
        grants = restored.get('/api/approvals').json()['grants']
        assert any(g['id'] == grant['id'] and g['decision'] == 'granted' for g in grants)
        assert restored.get('/api/autonomy/config').json()['budgets'][0]['limit_amount'] == 3600
