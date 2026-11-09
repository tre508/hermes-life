import json
from pathlib import Path

import pytest

from hermes_life.hermes_adapter import HermesAdapter


def test_ssh_command_and_events(monkeypatch, tmp_path):
    key = tmp_path / 'id_ed25519'
    key.write_text('test')
    calls = []
    class Probe:
        returncode = 0
    class FakeStream:
        def __init__(self, lines): self.lines = iter(lines)
        def __iter__(self): return self
        def __next__(self): return next(self.lines)
        def readline(self): return next(self.lines, '')
        def fileno(self): return 0
    monkeypatch.setattr('shutil.which', lambda _: '/usr/bin/ssh')
    monkeypatch.setattr('subprocess.run', lambda cmd, **kw: (calls.append(cmd), Probe())[1])
    # HL-WORKER: the worker address is configuration, so an ssh adapter is always built with it.
    adapter = HermesAdapter(transport='ssh', host='192.168.178.37', user='glenn', identity_file=key)
    assert adapter.available()
    events = []
    monkeypatch.setattr(adapter, '_execute', lambda cmd, prompt, cb, task_id=None: (calls.append((cmd, prompt)), cb('hermes.tool_use', {'name':'terminal'}), {'result':'from VM','session_id':'vm-session'})[-1])
    result = adapter.run('hello; $(dangerous)', lambda *args: events.append(args))
    assert result == {'result':'from VM','session_id':'vm-session'}
    command, payload = calls[-1]
    assert 'hello' not in ' '.join(command)
    assert payload == 'hello; $(dangerous)'
    assert command[-1].startswith('sh -c ')
    assert events[0][0] == 'hermes.tool_use'


def test_local_transport_remains_default(monkeypatch):
    monkeypatch.delenv('HERMES_LIFE_TRANSPORT', raising=False)
    assert HermesAdapter().transport == 'local'


def test_ssh_without_a_worker_address_refuses_to_start(monkeypatch):
    """HL-WORKER: the old VM address must not be used as a silent fallback.

    Before the migration the adapter defaulted to the retired VM's address, so a missing or
    un-sourced worker config quietly drove the wrong machine.
    """
    for name in ('HERMES_LIFE_VM_HOST', 'HERMES_LIFE_VM_USER', 'HERMES_LIFE_VM_KEY'):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ValueError) as excinfo:
        HermesAdapter(transport='ssh')
    message = str(excinfo.value)
    for name in ('HERMES_LIFE_VM_HOST', 'HERMES_LIFE_VM_USER', 'HERMES_LIFE_VM_KEY'):
        assert name in message
    assert 'config/hermes-life-lenovo.env' in message


def test_worker_reports_the_configured_target(monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_VM_HOST', '192.168.178.37')
    monkeypatch.setenv('HERMES_LIFE_VM_USER', 'glenn')
    monkeypatch.setenv('HERMES_LIFE_VM_KEY', '/home/gayzer/.ssh/hermes-lenovo')
    worker = HermesAdapter(transport='ssh').worker
    assert worker['transport'] == 'ssh'
    assert worker['target'] == 'glenn@192.168.178.37:22'
    assert worker['guest_home'] == '/home/hermes'
    assert worker['agent'] == '/home/hermes/.local/bin/hermes'
    local = HermesAdapter(transport='local').worker
    assert local['transport'] == 'local' and local['target'] == 'local'
