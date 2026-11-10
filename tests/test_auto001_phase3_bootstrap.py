"""HL-AUTO-001 Phase 3 exit gate: proposal -> project bootstrap.

An approved proposal creates a registered project and reproducible environment; a denied
proposal makes NO writes (the VM transport is never invoked).
"""
import json

from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.autonomy_policy import AutonomyPolicy, PolicyDenied
from hermes_life.bootstrap import ProjectBootstrapper, BootstrapError
from hermes_life.opportunities import OpportunityRegistry
from hermes_life.schema import migrate
from hermes_life.store import Store

FAKE_COMMIT = 'a' * 40
ALLOWLIST = ['/home/hermes/experiments']


class FakeSSH:
    """Records scripts; configurable failure. Returns a fake commit on success."""

    def __init__(self, fail=None, cleanup='cleaned'):
        self.scripts = []
        self.fail = fail          # None | 'exists' | 'crash'
        self.cleanup = cleanup

    def __call__(self, script):
        self.scripts.append(script)
        if self.fail == 'exists' and 'if [ -e "$TARGET" ]' in script:
            raise RuntimeError('EXISTS')
        if self.fail == 'crash' and 'git rev-parse HEAD' in script:
            raise RuntimeError('connection lost mid-bootstrap')
        if 'rm -rf' in script:
            return self.cleanup + '\n'
        if 'git rev-parse HEAD' in script:
            return FAKE_COMMIT + '\n'
        return 'ok\n'


def _world(tmp_path):
    store = Store(tmp_path / 'auto.db')
    migrate(store.connection)
    policy = AutonomyPolicy(store)
    registry = OpportunityRegistry(store, policy)
    ssh = FakeSSH()
    bootstrapper = ProjectBootstrapper(store, policy, ssh=ssh)
    return store, policy, registry, bootstrapper, ssh


def _approved_proposal(policy, registry, mode='independent'):
    policy.configure(mode=mode, allowlist=ALLOWLIST)
    # Repo creation is grant-only (Phase 7 tightening): a bounded, audited grant is required.
    policy.grant('create_project_repo', project_id=None, scope={'allowlist': ALLOWLIST},
                 rationale='Phase 3 test bootstrap within the experiments allowlist')
    opportunity = registry.ingest('repeated_workflow', 'Automate exports',
                                  'Exports rebuilt by hand', evidence_refs=['task:e1'],
                                  dedupe_key='export-tool')
    return registry.decide_proposal(
        registry.propose(opportunity['id'], 'Export tool',
                         'A bounded CLI export tool for weekly summaries')['id'],
        True, rationale='Approved for bootstrap testing')


def test_approved_proposal_bootstraps_registered_project(tmp_path):
    store, policy, registry, bootstrapper, ssh = _world(tmp_path)
    proposal = _approved_proposal(policy, registry)
    record = bootstrapper.bootstrap(proposal['id'], 'export-tool',
                                    '/home/hermes/experiments/export-tool')
    assert record['status'] == 'active'
    assert record['base_commit'] == FAKE_COMMIT
    assert record['spec_sha256']
    script = ssh.scripts[0]
    assert 'git init -q' in script and 'mkdir -p' in script
    assert 'SPEC.md' in script and 'requirements-manifest.json' in script
    assert '/home/gayzer' not in script, 'bootstrap must not touch host paths'
    project = bootstrapper.project('export-tool')
    assert project['origin'] == 'autonomous'
    assert project['proposal_id'] == proposal['id']
    assert project['status'] == 'active'
    assert project['spec_sha256'] == record['spec_sha256']


def test_denied_proposal_makes_no_writes(tmp_path):
    store, policy, registry, bootstrapper, ssh = _world(tmp_path)
    policy.configure(mode='suggest', allowlist=[])
    opportunity = registry.ingest('repeated_workflow', 'Automate exports',
                                  'Exports rebuilt by hand', evidence_refs=['task:e1'],
                                  dedupe_key='export-tool')
    proposal = registry.decide_proposal(
        registry.propose(opportunity['id'], 'Export tool',
                         'A bounded CLI export tool for weekly summaries')['id'],
        False, rationale='Not worth building yet')
    # An explicitly REJECTED proposal must never bootstrap.
    try:
        bootstrapper.bootstrap(proposal['id'], 'export-tool',
                               '/home/hermes/experiments/export-tool')
        raised = False
    except BootstrapError:
        raised = True
    assert raised
    # And the policy default (observe) denies repository creation too.
    policy.configure(mode='observe')
    policy_check_raised = False
    try:
        policy.require('create_project_repo', project_id='export-tool')
    except PolicyDenied:
        policy_check_raised = True
    assert policy_check_raised
    assert ssh.scripts == [], 'a denied proposal must never reach the VM'
    assert bootstrapper.projects() == []
    assert bootstrapper.list_bootstraps() == []


def test_policy_and_scope_gates_fire_before_any_vm_write(tmp_path):
    store, policy, registry, bootstrapper, ssh = _world(tmp_path)
    proposal = _approved_proposal(policy, registry, mode='independent')
    # Empty allowlist: creation is authorized by mode but not scoped anywhere.
    policy.configure(mode='independent', allowlist=[])
    try:
        bootstrapper.bootstrap(proposal['id'], 'export-tool',
                               '/home/hermes/experiments/export-tool')
        raised = False
    except BootstrapError as exc:
        raised = 'allowlist' in str(exc)
    assert raised
    # Path outside the allowlist.
    policy.configure(mode='independent', allowlist=['/home/hermes/experiments'])
    try:
        bootstrapper.bootstrap(proposal['id'], 'export-tool', '/home/hermes/other/tool')
        raised = False
    except BootstrapError as exc:
        raised = 'allowlist' in str(exc)
    assert raised
    assert ssh.scripts == [], 'scope denial must happen before the transport is used'


def test_bootstrap_is_idempotent_per_proposal(tmp_path):
    store, policy, registry, bootstrapper, ssh = _world(tmp_path)
    proposal = _approved_proposal(policy, registry)
    first = bootstrapper.bootstrap(proposal['id'], 'export-tool',
                                   '/home/hermes/experiments/export-tool')
    second = bootstrapper.bootstrap(proposal['id'], 'export-tool',
                                    '/home/hermes/experiments/export-tool')
    assert second['id'] == first['id']
    assert len(ssh.scripts) == 1, 'an active bootstrap must not re-run on the VM'


def test_midflight_failure_rolls_back_and_allows_retry(tmp_path):
    store, policy, registry, bootstrapper, ssh = _world(tmp_path)
    ssh.fail = 'crash'
    proposal = _approved_proposal(policy, registry)
    record = bootstrapper.bootstrap(proposal['id'], 'export-tool',
                                    '/home/hermes/experiments/export-tool')
    assert record['status'] == 'rolled_back'
    assert bootstrapper.projects() == [], 'a failed bootstrap must not register a project'
    # The cleanup probe ran; no blind deletion of unknown state.
    assert any('rm -rf' in s for s in ssh.scripts)
    ssh.fail = None
    retried = bootstrapper.bootstrap(proposal['id'], 'export-tool',
                                     '/home/hermes/experiments/export-tool')
    assert retried['status'] == 'active'
    assert bootstrapper.project('export-tool') is not None


def test_ambiguous_failure_requires_recovery(tmp_path):
    store, policy, registry, bootstrapper, ssh = _world(tmp_path)
    ssh.fail = 'crash'
    ssh.cleanup = 'ambiguous'
    proposal = _approved_proposal(policy, registry)
    try:
        bootstrapper.bootstrap(proposal['id'], 'export-tool',
                               '/home/hermes/experiments/export-tool')
        raised = False
    except BootstrapError as exc:
        raised = 'recovery_required' in str(exc)
    assert raised
    assert bootstrapper.list_bootstraps()[0]['status'] == 'recovery_required'
    # Retrying while unreconciled is blocked, not silently destructive.
    try:
        bootstrapper.bootstrap(proposal['id'], 'export-tool',
                               '/home/hermes/experiments/export-tool')
        raised = False
    except BootstrapError:
        raised = True
    assert raised
    assert bootstrapper.projects() == []


def test_existing_target_path_fails_without_modification(tmp_path):
    store, policy, registry, bootstrapper, ssh = _world(tmp_path)
    ssh.fail = 'exists'
    proposal = _approved_proposal(policy, registry)
    record = bootstrapper.bootstrap(proposal['id'], 'export-tool',
                                    '/home/hermes/experiments/export-tool')
    assert record['status'] == 'failed' and 'already exists' in record['error']
    assert bootstrapper.projects() == []
    assert not any('rm -rf' in s for s in ssh.scripts), \
        'an untouched pre-existing path must never be deleted'


def test_phase3_api_surface_and_restart(tmp_path):
    from hermes_life.bootstrap import ProjectBootstrapper
    db = tmp_path / 'api.db'
    with TestClient(create_app(database=db, adapter=FakeAdapter())) as client:
        # Observe mode: bootstrap is denied with 403 and nothing is written.
        runtime = client.app.state.runtime
        policy = client.app.state.autonomy_policy
        registry = client.app.state.opportunities
        policy.configure(mode='suggest', allowlist=[])
        opportunity = registry.ingest('repeated_workflow', 'Automate exports',
                                      'Exports rebuilt by hand', evidence_refs=['task:e1'],
                                      dedupe_key='export-tool')
        proposal = registry.propose(opportunity['id'], 'Export tool',
                                    'A bounded CLI export tool for weekly summaries')
        registry.decide_proposal(proposal['id'], True, rationale='Useful')
        denied = client.post(f"/api/proposals/{proposal['id']}/bootstrap", json={
            'project_name': 'export-tool',
            'vm_path': '/home/hermes/experiments/export-tool'})
        assert denied.status_code == 403
        assert client.get('/api/autonomy/projects').json()['projects'] == []
        # Approve the action explicitly with a bounded grant; with the FakeAdapter there is
        # no SSH transport, so the API must fail with a classified 409, not a 500.
        policy.configure(mode='independent', allowlist=['/home/hermes/experiments'])
        client.post('/api/approvals', json={
            'action': 'create_project_repo',
            'rationale': 'Test bootstrap within the experiments allowlist'})
        no_transport = client.post(f"/api/proposals/{proposal['id']}/bootstrap", json={
            'project_name': 'export-tool',
            'vm_path': '/home/hermes/experiments/export-tool'})
        assert no_transport.status_code == 409, no_transport.text
    with TestClient(create_app(database=db, adapter=FakeAdapter())) as restored:
        assert restored.get('/api/bootstraps').json()['bootstraps']
        assert restored.get('/api/autonomy/projects').json()['projects'] == []


class FakeAdapter:
    def available(self):return True
    def run(self,prompt,callback,task_id=None):
        callback('hermes.result',{'text':prompt})
        return {'result':prompt,'session_id':'fake'}
    def cancel(self, task_id):
        return True
