import json
from pathlib import Path
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
    adapter = HermesAdapter(transport='ssh', identity_file=key)
    assert adapter.available()
    events = []
    monkeypatch.setattr(adapter, '_execute', lambda cmd, prompt, cb: (calls.append((cmd, prompt)), cb('hermes.tool_use', {'name':'terminal'}), {'result':'from VM','session_id':'vm-session'})[-1])
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
