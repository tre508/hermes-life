"""Phase-0 pins from the HA-001–HA-047 build spec.

HA-019: /health is liveness-only (gate-exempt by design); worker topology is
operator information and lives behind the gate at /api/health/detail.
HA-002: /ws/terminal is a full server shell — opt-in per deployment
(HERMES_LIFE_ENABLE_TERMINAL=1) and its PTY environment is an allowlist. The
uvicorn process carries keys.env secrets (API keys, gate hash) that must never
reach a shell, authenticated or not.
"""
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from hermes_life.app import create_app, terminal_environ


def _client(tmp_path):
    client = TestClient(create_app(database=tmp_path / 'hardening.db'))
    client.__enter__()
    return client


def test_health_is_liveness_only(tmp_path):
    body = _client(tmp_path).get('/health').json()
    assert body == {'status': 'ok'}


def test_worker_topology_moved_behind_gated_route(tmp_path, monkeypatch):
    monkeypatch.setattr('hermes_life.hermes_adapter.HermesAdapter.available',
                        lambda self: True)
    client = _client(tmp_path)
    detail = client.get('/api/health/detail').json()
    # HL-WORKER contract preserved — it moved behind the gate, it did not go away.
    assert detail['status'] == 'ok'
    assert isinstance(detail['worker'], dict) and detail['worker']
    assert 'worker' not in client.get('/health').json()


def test_terminal_ws_refused_when_disabled(tmp_path, monkeypatch):
    monkeypatch.delenv('HERMES_LIFE_ENABLE_TERMINAL', raising=False)
    client = _client(tmp_path)
    with client.websocket_connect('/ws/terminal') as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
    assert exc.value.code == 4403


def test_terminal_environ_strips_secrets():
    base = {
        'PATH': '/usr/bin', 'HOME': '/home/x', 'TERM': 'xterm',
        'OPENROUTER_API_KEY': 'sk-canary-openrouter',
        'HERMES_LIFE_GATE_PASSWORD_HASH': 'pbkdf2_sha256$canary',
        'HERMES_LIFE_GATE_COOKIE_KEY': 'canary-cookie',
        'MY_TOKEN': 'canary-token',
    }
    env = terminal_environ(base)
    assert set(env) == {'PATH', 'HOME', 'TERM'}
    for secret in ('sk-canary-openrouter', 'pbkdf2_sha256$canary',
                   'canary-cookie', 'canary-token'):
        assert secret not in env.values()


def test_terminal_ws_shell_env_cannot_carry_secrets(tmp_path, monkeypatch):
    """Integration: run the real PTY shell and prove the leak canary is absent.

    The drain is bounded: session teardown is the app's job (client disconnect
    tears the shell down), so the test never waits on shell exit.
    """
    import threading

    monkeypatch.setenv('HERMES_LIFE_ENABLE_TERMINAL', '1')
    monkeypatch.setenv('MY_FAKE_SECRET_TOKEN', 'leak-canary-123')
    client = _client(tmp_path)
    chunks = []
    with client.websocket_connect('/ws/terminal') as ws:
        ws.send_text('env; exit\n')

        def _drain():
            while True:
                try:
                    chunks.append(ws.receive_text())
                except BaseException:
                    break

        t = threading.Thread(target=_drain, daemon=True)
        t.start()
        t.join(timeout=5)
    output = ''.join(chunks)
    assert 'PATH=' in output  # the shell really ran and printed its environment
    assert 'leak-canary-123' not in output
