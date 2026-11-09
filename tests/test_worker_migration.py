"""HL-WORKER: the coding worker is the Lenovo, configured in one place, with no path fallback.

The migration retired the Kubuntu VM (192.168.124.136). Two things must stay true or the backend can
connect successfully and still execute against the wrong machine or the wrong directory:

1. No default anywhere points at the retired VM, and no live module or config carries its address.
2. Every worker path - guest script, host-built prompt, workspace destination - is derived from
   HERMES_LIFE_GUEST_HOME, so the worker's own directory layout is what executes. The authored
   scripts say `/home/hermes`; that text may only exist inside `for_worker(...)`, which rewrites it
   to the configured home at import time.
"""
import ast
import importlib
import json
import pathlib
import subprocess
import sys

from hermes_life import guest_env
from hermes_life.guest_env import for_worker
from hermes_life.maintenance import EXPERIMENTS_INVENTORY_GUEST
from hermes_life.project_workspaces import workspace_dest

CANONICAL = '/home/hermes'
REPO = pathlib.Path(__file__).resolve().parent.parent

#: Modules that embed a worker script or build a worker path.
LIVE_WORKER_MODULES = (
    'hermes_life.guest_env', 'hermes_life.discovery', 'hermes_life.implementation',
    'hermes_life.implementation_review', 'hermes_life.implementation_revision',
    'hermes_life.verification', 'hermes_life.maintenance', 'hermes_life.formulation',
    'hermes_life.study', 'hermes_life.project_workspaces', 'hermes_life.hermes_adapter',
)

#: Text that must not survive in live code or configuration.
RETIRED_VM_MARKERS = ('192.168.124.136', 'hermes_life_vm')


def _live_sources():
    for module_name in LIVE_WORKER_MODULES:
        path = REPO / (module_name.replace('.', '/') + '.py')
        yield path, path.read_text()


def _embedded_scripts():
    """Every module-level string that is an embedded worker script (path-bearing, not a docstring)."""
    for module_name in LIVE_WORKER_MODULES:
        module = importlib.import_module(module_name)
        for attribute, value in vars(module).items():
            if isinstance(value, str) and len(value) > 150 and CANONICAL in value:
                yield f'{module_name}.{attribute}', value


def _in_worker_env(home, program):
    """Run a program against a worker home other than the canonical one."""
    env = {'PATH': '/usr/bin:/bin', 'HERMES_LIFE_GUEST_HOME': home}
    proc = subprocess.run([sys.executable, '-c', program], capture_output=True, text=True, env=env, cwd=str(REPO))
    assert proc.returncode == 0, proc.stderr
    return proc.stdout.strip()


def test_guest_paths_have_one_owner():
    assert guest_env.CANONICAL_GUEST_HOME == CANONICAL
    assert guest_env.GUEST_HOME == CANONICAL
    assert guest_env.PROJECTS_ROOT == CANONICAL + '/projects'
    assert guest_env.EXPERIMENTS_ROOT == CANONICAL + '/experiments'
    assert guest_env.WORKSPACES_ROOT == CANONICAL + '/workspaces'
    assert guest_env.HERMES_BIN == CANONICAL + '/.local/bin/hermes'


def test_for_worker_is_inert_on_the_default_home():
    """The default worker home is left exactly as authored; only a moved home rewrites it."""
    assert for_worker('inspect /home/hermes/projects/x') == 'inspect /home/hermes/projects/x'


def test_worker_home_is_configurable():
    """Any worker directory layout is reached by configuration alone."""
    out = _in_worker_env('/srv/worker', 'from hermes_life import guest_env as g; '
                         'print(",".join([g.GUEST_HOME, g.PROJECTS_ROOT, g.EXPERIMENTS_ROOT, '
                         'g.WORKSPACES_ROOT, g.HERMES_BIN]))')
    assert out == ('/srv/worker,/srv/worker/projects,/srv/worker/experiments,'
                   '/srv/worker/workspaces,/srv/worker/.local/bin/hermes')


def test_the_configured_home_rewrites_every_executed_script():
    """With a moved worker home, no executed script may still name the old directory."""
    found = json.loads(_in_worker_env('/srv/worker', """
import importlib, json
mods = ('hermes_life.guest_env','hermes_life.discovery','hermes_life.implementation',
        'hermes_life.implementation_review','hermes_life.implementation_revision',
        'hermes_life.verification','hermes_life.maintenance')
found = {}
for name in mods:
    m = importlib.import_module(name)
    for attr, value in vars(m).items():
        if isinstance(value, str) and len(value) > 150 and ('/home/hermes' in value or '/srv/worker' in value):
            found[f'{name}.{attr}'] = {'old': value.count('/home/hermes'), 'new': value.count('/srv/worker')}
print(json.dumps(found))
"""))
    assert len(found) >= 6, found
    for name, counts in found.items():
        assert counts['old'] == 0, f'{name} still names the old worker home: {counts}'
        assert counts['new'] > 0, f'{name} does not follow the configured worker home: {counts}'


def test_host_prompts_follow_the_configured_worker_home():
    """Prompts the controller builds must name the worker's own directory, not a historical one."""
    old, new = _in_worker_env('/srv/worker', """
from hermes_life.study import StudyService, StudySource, StudyUnit
src = StudySource(1, 'file:///p.pdf', 'Handbook', None, 300, 300, 'pdf', '2026-01-01')
unit = StudyUnit(1, 1, 3, 'Unit 3', 'read', 11, 15, 'not_queued', None, None, None, None, 'a', 'b')
prompt = StudyService(None)._build_unit_prompt(unit, src)
print(prompt.count('/home/hermes'), prompt.count('/srv/worker'))
""").split()
    assert old == '0' and int(new) >= 2, (old, new)


def test_the_worker_home_only_exists_inside_for_worker_calls():
    """Authored text may say /home/hermes only when routed through for_worker(...).

    This is what lets a worker move directory with configuration alone: any string literal naming the
    home must be an argument of for_worker, which rewrites it.
    """
    offenders = []
    for path, text in _live_sources():
        module = ast.parse(text)
        wrapped = {id(node) for call in ast.walk(module)
                   if isinstance(call, ast.Call) and getattr(call.func, 'id', None) == 'for_worker'
                   for node in ast.walk(call)}
        # The constant that DEFINES the canonical home is the one place the literal belongs.
        wrapped |= {id(node.value) for node in ast.walk(module)
                    if isinstance(node, ast.Assign)
                    and any(getattr(t, 'id', None) == 'CANONICAL_GUEST_HOME' for t in node.targets)}
        for node in ast.walk(module):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and CANONICAL in node.value:
                if id(node) not in wrapped:
                    offenders.append(f'{path.name}:{node.lineno}')
    assert not offenders, f'worker home outside for_worker(): {offenders}'


def test_no_live_module_or_config_carries_the_retired_vm():
    offenders = []
    for path, text in _live_sources():
        offenders += [f'{path.name}: {m}' for m in RETIRED_VM_MARKERS if m in text]
    for config in list((REPO / 'config').glob('*')) + [REPO / 'start.sh']:
        offenders += [f'{config.name}: {m}' for m in RETIRED_VM_MARKERS if m in config.read_text()]
    assert not offenders, offenders


def test_ssh_without_a_worker_address_refuses_to_start(monkeypatch):
    """The retired address is not a fallback: an unconfigured ssh transport must not start."""
    import pytest

    from hermes_life.hermes_adapter import HermesAdapter

    for name in ('HERMES_LIFE_VM_HOST', 'HERMES_LIFE_VM_USER', 'HERMES_LIFE_VM_KEY'):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ValueError) as excinfo:
        HermesAdapter(transport='ssh')
    message = str(excinfo.value)
    for name in ('HERMES_LIFE_VM_HOST', 'HERMES_LIFE_VM_USER', 'HERMES_LIFE_VM_KEY'):
        assert name in message
    assert 'config/hermes-life-lenovo.env' in message


def test_worker_reports_the_configured_target(monkeypatch):
    from hermes_life.hermes_adapter import HermesAdapter

    monkeypatch.setenv('HERMES_LIFE_VM_HOST', '192.168.178.37')
    monkeypatch.setenv('HERMES_LIFE_VM_USER', 'glenn')
    monkeypatch.setenv('HERMES_LIFE_VM_KEY', '/home/gayzer/.ssh/hermes-lenovo')
    worker = HermesAdapter(transport='ssh').worker
    assert worker['transport'] == 'ssh'
    assert worker['target'] == 'glenn@192.168.178.37:22'
    assert worker['guest_home'] == '/home/hermes'
    assert worker['agent'] == '/home/hermes/.local/bin/hermes'
    assert HermesAdapter(transport='local').worker['target'] == 'local'


def test_maintenance_inventory_follows_the_configured_home():
    # With the default home the rewrite is a no-op; it only fires when the worker home moves.
    assert 'EXPERIMENTS_ROOT="/home/hermes/experiments"' in EXPERIMENTS_INVENTORY_GUEST
    assert 'strict=True' in EXPERIMENTS_INVENTORY_GUEST


def test_workspace_destination_is_built_from_the_shared_root():
    dest = workspace_dest('hermes-life', 'b3cd8a5660feba2d3ac450df0a4eed0b6a114522')
    assert dest == '/home/hermes/workspaces/hermes-life/b3cd8a5660feba2d'
    assert dest.startswith(guest_env.WORKSPACES_ROOT + '/')


def test_health_reports_which_worker_the_backend_drives(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from hermes_life.app import create_app

    monkeypatch.setenv('HERMES_LIFE_VM_HOST', '192.168.178.37')
    monkeypatch.setenv('HERMES_LIFE_VM_USER', 'glenn')
    monkeypatch.setenv('HERMES_LIFE_VM_KEY', '/home/gayzer/.ssh/hermes-lenovo')
    monkeypatch.setenv('HERMES_LIFE_TRANSPORT', 'ssh')
    # Never probe the network from a unit test.
    monkeypatch.setattr('hermes_life.hermes_adapter.HermesAdapter.available', lambda self: True)

    client = TestClient(create_app(database=tmp_path / 'worker.db'))
    client.__enter__()
    body = client.get('/health').json()
    assert body['status'] == 'ok'
    assert body['hermes_available'] is True
    assert body['worker']['transport'] == 'ssh'
    assert body['worker']['target'] == 'glenn@192.168.178.37:22'
    assert body['worker']['guest_home'] == '/home/hermes'
    assert body['worker']['agent'] == '/home/hermes/.local/bin/hermes'
    client.__exit__(None, None, None)
