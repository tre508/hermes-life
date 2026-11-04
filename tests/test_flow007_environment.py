"""FLOW-007A/B: platform-owned test environments and the shared resolver."""
import json
import sqlite3
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from hermes_life.guest_env import ENV_PROVISION, ENV_RESOLVER
from hermes_life.implementation import GUEST, ImplementationEngine
from hermes_life.implementation_revision import ImplementationRevision, REVISION_GUEST


def _interpreter(directory, valid=True):
    (directory / 'bin').mkdir(parents=True)
    script = directory / 'bin' / 'python'
    script.write_text('#!/bin/sh\necho 3.14.0\n' if valid
                      else '#!/bin/sh\necho "no pytest" >&2\nexit 1\n')
    script.chmod(0o755)
    return directory


@pytest.fixture
def resolver():
    namespace = {}
    exec(ENV_RESOLVER, namespace)
    return namespace


@pytest.fixture
def provision():
    # Mirrors production embedding: the resolver block precedes provisioning and they share
    # one global namespace.
    namespace = {}
    exec(ENV_RESOLVER + '\n' + ENV_PROVISION, namespace)
    return namespace


def test_shared_resolver_is_embedded_verbatim_in_both_guest_scripts():
    """Drift guard: the two execution paths must not encode resolution differently again."""
    assert ENV_RESOLVER in GUEST and ENV_RESOLVER in REVISION_GUEST
    assert GUEST.index(ENV_RESOLVER) < GUEST.index(ENV_PROVISION)
    # Each embedded block must stand on its own imports, not on a neighbour's.
    for block in (ENV_RESOLVER, ENV_PROVISION):
        namespace = {}
        exec(block, namespace)
    compile(GUEST, '<implementation guest>', 'exec')
    compile(REVISION_GUEST, '<revision guest>', 'exec')


def test_validation_rejects_a_venv_that_is_only_a_directory(resolver, tmp_path):
    empty = tmp_path / 'empty'
    empty.mkdir()
    ok, reason, interpreter = resolver['validate_environment'](str(empty))
    assert ok is False and 'interpreter' in reason and interpreter.endswith('bin/python')
    ok, reason, _ = resolver['validate_environment'](str(tmp_path / 'missing'))
    assert ok is False and 'absent' in reason


def test_validation_rejects_an_interpreter_that_cannot_import_pytest(resolver, tmp_path):
    ok, reason, _ = resolver['validate_environment'](str(_interpreter(tmp_path / 'broken', valid=False)))
    assert ok is False and 'pytest' in reason


def test_resolution_prefers_platform_then_legacy_then_system(resolver, tmp_path):
    platform = _interpreter(tmp_path / 'platform')
    legacy = _interpreter(tmp_path / 'legacy')
    assert resolver['resolve_interpreter'](str(platform), str(legacy)) == (str(platform / 'bin' / 'python'), 'platform')
    assert resolver['resolve_interpreter'](str(tmp_path / 'gone'), str(legacy)) == (str(legacy / 'bin' / 'python'), 'legacy-venv')
    interpreter, source = resolver['resolve_interpreter'](str(tmp_path / 'gone'), str(tmp_path / 'also-gone'))
    assert source == 'system' and interpreter == resolver['sys'].executable


def test_revision_never_tests_with_a_workspace_the_agent_just_created():
    # Revision must use ONLY the platform environment; no fallback to candidate/.venv in test operation
    # The test operation validates the platform environment directly, no resolve_interpreter fallback
    assert "validate_environment(str(env_dir))" in REVISION_GUEST
    # The test operation does not use resolve_interpreter with candidate/.venv fallback
    test_section = REVISION_GUEST[REVISION_GUEST.index("elif op=='test':"):REVISION_GUEST.index("elif op==")]
    assert "str(candidate/'.venv')" not in test_section
    assert "resolve_interpreter" not in test_section


def test_manifest_refuses_every_directive_that_would_install_untrusted_code(provision, tmp_path):
    """Fail closed: these were previously passed to pip or silently dropped."""
    baseline = tmp_path / 'baseline'
    baseline.mkdir()
    for directive in ('-e .', '-e /home/hermes/projects/proj', 'git+https://bad.example/repo',
                      '--extra-index-url https://bad.example', '--find-links http://evil/x',
                      'requests @ https://evil.example/requests.tar.gz', '../../project',
                      'file:../wheelhouse/x.whl'):
        (baseline / 'requirements-dev.txt').write_text(directive + '\n')
        with pytest.raises(ValueError, match='Unsupported dependency'):
            provision['_manifest'](str(baseline))
    # Control: ordinary specs are still accepted, so the test above is not vacuous.
    (baseline / 'requirements-dev.txt').write_text('pytest==9.2.0\nrequests>=2\n')
    assert provision['_manifest'](str(baseline))['specs'] == ['pytest', 'pytest==9.2.0', 'requests>=2']


def test_manifest_follows_requirement_includes_and_records_input_hashes(provision, tmp_path):
    baseline = tmp_path / 'baseline'
    baseline.mkdir()
    (baseline / 'requirements.txt').write_text('requests>=2\n')
    (baseline / 'requirements-dev.txt').write_text('-r requirements.txt\npytest==9.2.0\n')
    manifest = provision['_manifest'](str(baseline))
    assert manifest['specs'] == ['pytest', 'requests>=2', 'pytest==9.2.0']
    assert set(manifest['inputs']) == {'requirements.txt', 'requirements-dev.txt'}
    assert all(len(digest) == 64 for digest in manifest['inputs'].values())
    assert manifest['includes'] == ['requirements-dev.txt -> requirements.txt']


def test_manifest_refuses_includes_that_escape_the_baseline(provision, tmp_path):
    baseline = tmp_path / 'baseline'
    baseline.mkdir()
    for directive in ('-r ../outside.txt', '-r /etc/passwd', '-r file:../x.txt', '-r missing.txt'):
        (baseline / 'requirements-dev.txt').write_text(directive + '\n')
        with pytest.raises(ValueError):
            provision['_manifest'](str(baseline))


def test_manifest_refuses_an_oversized_manifest(provision, tmp_path):
    baseline = tmp_path / 'baseline'
    baseline.mkdir()
    (baseline / 'requirements.txt').write_text('requests>=2\n' * 6000)
    with pytest.raises(ValueError, match='too large'):
        provision['_manifest'](str(baseline))


def test_provisioning_refuses_missing_or_stale_provenance(provision, tmp_path):
    """An existing environment is only reused with matching dependency provenance."""
    provision['EXPERIMENTS_ROOT'] = str(tmp_path)
    ident = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    baseline = tmp_path / ('baseline-' + ident)
    baseline.mkdir()
    (baseline / 'requirements.txt').write_text('requests>=2\n')
    target = tmp_path / ('env-' + ident)
    (target / 'bin').mkdir(parents=True)
    interpreter = target / 'bin' / 'python'
    interpreter.write_text('#!/bin/sh\necho 3.14.0\n')
    interpreter.chmod(0o755)

    missing = provision['provision_environment'](ident, str(baseline))
    assert missing['status'] == 'environment_error'
    assert 'no recorded provenance' in missing['reason']

    expect = provision['fingerprint'](provision['_manifest'](str(baseline)))
    (target / 'flow007.json').write_text(json.dumps({'env_source': 'platform-baseline',
                                                     'baseline_sha256': 'stale'}))
    stale = provision['provision_environment'](ident, str(baseline))
    assert stale['status'] == 'environment_error' and 'provenance mismatch' in stale['reason']

    (target / 'flow007.json').write_text(json.dumps({'env_source': 'platform-baseline',
                                                     'baseline_sha256': expect}))
    reused = provision['provision_environment'](ident, str(baseline))
    assert reused['status'] == 'ok' and reused['reused'] is True and reused['created'] is False


def test_runtime_env_blocks_ambient_interpreter_state(provision, monkeypatch):
    """An evaluation must not inherit PYTHONPATH/PYTHONHOME or user-site packages."""
    monkeypatch.setenv('PYTHONPATH', '/tmp/injected')
    monkeypatch.setenv('PYTHONHOME', '/tmp/home')
    env = provision['runtime_env']()
    assert 'PYTHONPATH' not in env and 'PYTHONHOME' not in env
    assert env['PYTHONNOUSERSITE'] == '1'
    assert env['PIP_NO_INPUT'] == '1'


def test_provisioning_reports_a_missing_baseline_instead_of_crashing(provision, tmp_path):
    provision['EXPERIMENTS_ROOT'] = str(tmp_path)
    ident = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    result = provision['provision_environment'](ident, str(tmp_path / ('baseline-' + ident)))
    assert result['status'] == 'environment_error'
    assert 'baseline unavailable' in result['reason']


def test_manifest_includes_pyproject_test_dependencies(provision, tmp_path):
    baseline = tmp_path / 'baseline'
    baseline.mkdir()
    (baseline / 'pyproject.toml').write_text(
        '[project]\nname="demo"\ndependencies=["fastapi>=0.1"]\n'
        '[project.optional-dependencies]\ntest=["pytest==9.2.0"]\n')
    manifest = provision['_manifest'](str(baseline))
    assert manifest['specs'] == ['pytest', 'fastapi>=0.1', 'pytest==9.2.0']
    assert list(manifest['inputs']) == ['pyproject.toml']


class Store:
    """Minimal store: one reviewable run plus the flow tables the worker needs."""

    def __init__(self, run_state='candidate_passed'):
        self.connection = sqlite3.connect(':memory:', check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.events = []
        self.connection.executescript(f'''
          CREATE TABLE implementation_runs(id TEXT PRIMARY KEY,plan_id TEXT,project TEXT,state TEXT,
            created_at TEXT,updated_at TEXT,candidate_path TEXT,baseline_path TEXT,baseline_json TEXT,
            candidate_json TEXT,response TEXT,error TEXT);
          INSERT INTO implementation_runs VALUES ('run','plan','demo','{run_state}','t','t','/c','/b',NULL,NULL,NULL,NULL);
          CREATE TABLE investigation_plans(id TEXT PRIMARY KEY,report TEXT);
          INSERT INTO investigation_plans VALUES ('plan','{{"acceptance_criteria":["sample behavior"]}}');
          CREATE TABLE implementation_reviews(run_id TEXT PRIMARY KEY,decision TEXT,
            evidence_sha256 TEXT,criteria_json TEXT,feedback TEXT,decided_at TEXT);
          INSERT INTO implementation_reviews VALUES ('run','revision_requested','abc','[false]','Fix it','yesterday');
        ''')

    def emit(self, *args):
        self.events.append(args)


def _engine(guest, store=None):
    store = store or Store()
    runtime = SimpleNamespace(store=store, adapter=SimpleNamespace(transport='ssh'), active=threading.Lock())
    engine = ImplementationEngine(runtime, Mock())
    engine._guest = guest
    return engine, store


def test_environment_metadata_and_install_results_are_recorded():
    engine, store = _engine(lambda payload: {
        'status': 'ok', 'python_version': '3.14.4', 'interpreter': '/env/bin/python', 'created': True,
        'manifest': {'sources': {'requirements-dev.txt': 1}, 'specs': ['pytest==9.2.0'],
                     'files': ['requirements-dev.txt'], 'skipped': [], 'depth_limited': False},
        'install': [{'args': ['install', 'pytest'], 'exit_code': 0, 'ok': True, 'output': 'ok'}],
        'packages': 'pytest==9.2.0\n'})
    assert engine._ensure_environment('run')['status'] == 'ok'
    row = engine.environment('run')
    assert row is not None
    assert row['status'] == 'ok' and row['python_version'] == '3.14.4' and row['interpreter'] == '/env/bin/python'
    assert json.loads(row['manifest_json'])['specs'] == ['pytest==9.2.0']
    assert json.loads(row['install_json'])[0]['ok'] is True
    assert row['packages_json'] == 'pytest==9.2.0\n'
    assert any(event[0] == 'implementation.environment_ready' for event in store.events)


def test_environment_setup_failure_is_reported_separately_from_test_failure():
    engine, store = _engine(lambda payload: {
        'status': 'environment_error', 'reason': 'dependency installation failed',
        'interpreter': '/env/bin/python', 'python_version': '3.14.4', 'created': True,
        'manifest': {}, 'install': [], 'packages': None})
    with pytest.raises(ValueError, match='Environment setup failed'):
        engine._ensure_environment('run')
    row = engine.environment('run')
    assert row is not None
    assert row['status'] == 'environment_error' and row['error'] == 'dependency installation failed'
    assert any(event[0] == 'implementation.environment_failed' for event in store.events)


def _mock_engine(store):
    """Worker-level tests need a Mock engine: the real one's get() is a bound method."""
    engine = Mock()
    engine.lock = threading.Lock()
    engine.get.side_effect = lambda _: dict(
        store.connection.execute('SELECT * FROM implementation_runs WHERE id="run"').fetchone())
    engine._evaluate = Mock()
    return engine


def _revision_worker(engine, store, guest):
    runtime = SimpleNamespace(store=store, adapter=SimpleNamespace(run=lambda prompt, cb: {'result': 'attempted'}),
                              active=threading.Lock())
    reviewer = Mock()
    reviewer.get_decision.side_effect = lambda _: dict(
        store.connection.execute('SELECT * FROM implementation_reviews WHERE run_id="run"').fetchone())
    reviewer._snapshot.return_value = {'snapshot_sha256': 'abc'}
    worker = ImplementationRevision(runtime, engine, reviewer)
    worker._guest = guest
    return worker


def test_revision_survives_an_environment_it_cannot_repair():
    """A changed environment must not turn a passing candidate into an unrecoverable run."""
    store = Store()
    engine = _mock_engine(store)
    engine._ensure_environment = Mock(side_effect=ValueError('Environment setup failed: interpreter missing'))
    worker = _revision_worker(engine, store, lambda payload: (
        {'path': '/vm/staging'} if payload['operation'] == 'prepare'
        else {'status': 'evaluation_error', 'exit_code': None, 'output': 'no module named pytest',
              'env_source': 'system'}))
    worker._execute(worker.queue('run'))
    attempt = worker.list('run')['attempts'][0]
    # Environment failure propagates as 'error' state, not 'evaluation_error'
    assert attempt['state'] == 'error'
    # No environment_unavailable event emitted; exception propagates instead
    # Candidate, run state and the pending request all survive for a retry.
    assert store.connection.execute('SELECT state FROM implementation_runs WHERE id="run"').fetchone()['state'] == 'candidate_passed'
    assert store.connection.execute('SELECT decision FROM implementation_reviews').fetchone()['decision'] == 'revision_requested'
    engine._evaluate.assert_not_called()
    assert worker.queue('run')['attempt'] == 2


def test_revision_uses_the_platform_environment_when_it_is_usable():
    store = Store()
    engine = _mock_engine(store)
    env = {'status': 'ok', 'python_version': '3.14.4', 'interpreter': '/env/bin/python', 'created': False,
           'manifest': {}, 'install': [], 'packages': None}
    engine._ensure_environment = Mock(return_value=env)
    seen = []

    def guest(payload):
        seen.append(payload['operation'])
        return ({'path': '/vm/staging'} if payload['operation'] == 'prepare'
                else {'status': 'passed', 'exit_code': 0, 'output': '4 passed', 'env_source': 'platform'}
                if payload['operation'] == 'test' else {'candidate': '/vm/candidate'})

    worker = _revision_worker(engine, store, guest)
    worker._execute(worker.queue('run'))
    assert seen == ['prepare', 'test', 'promote']
    engine._ensure_environment.assert_called_once_with('run')
    assert worker.list('run')['attempts'][0]['state'] == 'passed'
