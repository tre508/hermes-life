"""HA-018 / HA-020 / HA-021 — entrance-gate hardening contract tests.

- HA-018: HERMES_LIFE_GATE_REQUIRED=1 refuses startup when neither a password
  hash nor a passkey store is configured (fail-closed for the public tunnel),
  and the gate state is logged at startup either way.
- HA-020: rate-limit buckets follow the forwarded client identity
  (X-Forwarded-For / X-Real-IP) so clients behind the vite proxy never share
  one lockout bucket; the raw peer remains the fallback.
- HA-021: session tokens are unique per issue, expire, reject tampering, and
  are revoked server-side by logout — a replayed cookie dies with the session.
  v1 tokens are rejected outright after the rotation.
"""
from __future__ import annotations

import hashlib
import hmac
import time

import pytest
from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.entrance_gate import GateConfig, _client_id, hash_password

PASSWORD = 'gate-hardening-password'
# One pbkdf2 hash for the module — 600k iterations is slow to redo per test.
PASSWORD_HASH = hash_password(PASSWORD)


class FakeAdapter:
    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        return {'result': 'ok', 'session_id': 'fake-session'}


def _gate_on(monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_GATE_PASSWORD_HASH', PASSWORD_HASH)
    monkeypatch.delenv('HERMES_LIFE_GATE_PASSKEY_STORE', raising=False)
    monkeypatch.delenv('HERMES_LIFE_GATE_REQUIRED', raising=False)


def _gate_off(monkeypatch):
    monkeypatch.delenv('HERMES_LIFE_GATE_PASSWORD_HASH', raising=False)
    monkeypatch.delenv('HERMES_LIFE_GATE_PASSKEY_STORE', raising=False)
    monkeypatch.delenv('HERMES_LIFE_GATE_REQUIRED', raising=False)


# ---- HA-018: fail-closed startup + gate-state logging ----------------------

def test_gate_required_refuses_startup_without_credentials(tmp_path, monkeypatch):
    _gate_off(monkeypatch)
    monkeypatch.setenv('HERMES_LIFE_GATE_REQUIRED', '1')
    with pytest.raises(RuntimeError, match='HERMES_LIFE_GATE_REQUIRED'):
        GateConfig()
    # The app-factory path (what the server boots) refuses the same way.
    with pytest.raises(RuntimeError, match='HERMES_LIFE_GATE_REQUIRED'):
        create_app(tmp_path / 'life.db', FakeAdapter())


def test_gate_required_allows_startup_with_configured_credentials(monkeypatch):
    _gate_on(monkeypatch)
    monkeypatch.setenv('HERMES_LIFE_GATE_REQUIRED', '1')
    cfg = GateConfig()
    assert cfg.enabled is True


def test_gate_required_accepts_a_passkey_store_alone(monkeypatch):
    _gate_off(monkeypatch)
    monkeypatch.setenv('HERMES_LIFE_GATE_REQUIRED', '1')
    monkeypatch.setenv('HERMES_LIFE_GATE_PASSKEY_STORE',
                       '/nonexistent/gate-passkey.json')
    cfg = GateConfig()
    assert cfg.enabled is True
    assert cfg.passkey_store is not None


def test_startup_without_the_flag_stays_open_for_local_dev(tmp_path, monkeypatch):
    _gate_off(monkeypatch)
    assert GateConfig().enabled is False  # no flag, no credentials: just off
    with TestClient(create_app(tmp_path / 'life.db', FakeAdapter())) as client:
        assert client.get('/api/personality').status_code == 200


def test_gate_state_is_logged_at_startup(monkeypatch, capsys):
    _gate_off(monkeypatch)
    GateConfig()
    logged = capsys.readouterr()
    assert '[entrance-gate]' in logged.err
    assert 'DISABLED' in logged.err
    _gate_on(monkeypatch)
    GateConfig()
    logged = capsys.readouterr()
    assert '[entrance-gate]' in logged.err
    assert 'ENABLED' in logged.err


# ---- HA-020: per-client rate limiting behind the proxy ---------------------

def test_client_identity_prefers_forwarded_headers():
    """The vite proxy makes every request arrive from the peer 127.0.0.1."""
    peer = {'client': ('127.0.0.1', 50000)}

    def scope(header_pairs):
        return {**peer,
                'headers': [(k.encode(), v.encode()) for k, v in header_pairs]}

    # X-Forwarded-For's first (client) entry wins, even with proxy hops after.
    assert _client_id(scope([('x-forwarded-for', '203.0.113.7, 10.0.0.1')])) == \
        '203.0.113.7'
    # X-Real-IP is the next fallback; X-Forwarded-For wins when both exist.
    assert _client_id(scope([('x-real-ip', '198.51.100.9')])) == '198.51.100.9'
    assert _client_id(scope([('x-forwarded-for', '203.0.113.7'),
                             ('x-real-ip', '198.51.100.9')])) == '203.0.113.7'
    # A blank forwarded header falls through; no headers at all is the peer.
    assert _client_id(scope([('x-forwarded-for', '')])) == '127.0.0.1'
    assert _client_id(peer) == '127.0.0.1'


def test_rate_limit_buckets_follow_the_forwarded_client(tmp_path, monkeypatch):
    _gate_on(monkeypatch)
    with TestClient(create_app(tmp_path / 'life.db', FakeAdapter())) as client:
        def attempt(ip):
            return client.post('/api/entrance/unlock', json={'password': 'x'},
                               headers={'X-Forwarded-For': ip}).status_code

        # Client A exhausts only its own bucket: 10 failures, then throttled.
        assert [attempt('203.0.113.7') for _ in range(10)] == [401] * 10
        assert attempt('203.0.113.7') == 429
        # Client B behind the same proxy peer has an independent bucket.
        assert attempt('198.51.100.9') == 401
        # The same forwarded client shares one bucket across requests.
        assert attempt('203.0.113.7') == 429
        assert attempt('198.51.100.9') == 401  # B still has only 2 failures


# ---- HA-021: revocable session tokens --------------------------------------

def test_each_issue_gets_a_unique_session_token(monkeypatch):
    _gate_on(monkeypatch)
    cfg = GateConfig()
    first, second = cfg.issue_token(), cfg.issue_token()
    assert first != second  # v1 minted the same token per expiry-second
    assert first.startswith('v2.') and second.startswith('v2.')
    assert cfg.verify_token(first) and cfg.verify_token(second)


def test_logout_revokes_the_session_server_side(tmp_path, monkeypatch):
    _gate_on(monkeypatch)
    with TestClient(create_app(tmp_path / 'life.db', FakeAdapter())) as client:
        assert client.post('/api/entrance/unlock',
                           json={'password': PASSWORD}).status_code == 200
        stolen = client.cookies.get('hl_gate')
        assert stolen
        assert client.get('/api/entrance/status').json()['authenticated'] is True

        assert client.post('/api/entrance/logout').status_code == 200
        # Replaying the stolen cookie is dead server-side: it still carries a
        # valid signature and a live expiry, but its session was revoked.
        replay = {'Cookie': f'hl_gate={stolen}'}
        assert client.get('/api/entrance/status',
                          headers=replay).json()['authenticated'] is False
        assert client.get('/api/personality',
                          headers=replay).status_code == 401
        # The gate still works: a fresh unlock gets a fresh session.
        assert client.post('/api/entrance/unlock',
                           json={'password': PASSWORD}).status_code == 200
        assert client.get('/api/personality').status_code == 200


def test_expiry_tampering_and_unknown_sessions_are_refused(monkeypatch):
    _gate_on(monkeypatch)
    cfg = GateConfig()
    token = cfg.issue_token()
    assert cfg.verify_token(token)
    # Tampered signature.
    assert not cfg.verify_token(token[:-1] + ('0' if token[-1] != '0' else '1'))
    # Tampered expiry — the signature covers it.
    sid, exp, sig = token.split('.')[1:]
    assert not cfg.verify_token(f'v2.{sid}.{int(exp) + 60}.{sig}')
    # Expired tokens are refused even with a live session entry.
    old = cfg.issue_token(now=time.time() - 10**6)
    assert not cfg.verify_token(old)
    # A revoked session is refused even though the token is otherwise valid.
    cfg.revoke_token(token)
    assert not cfg.verify_token(token)
    assert not cfg.verify_token(None) and not cfg.verify_token('')


def test_v1_tokens_are_rejected_after_the_rotation(monkeypatch):
    _gate_on(monkeypatch)
    cfg = GateConfig()
    exp = int(time.time() + 3600)
    sig = hmac.new(cfg.key, f'v1.{exp}'.encode(), hashlib.sha256).hexdigest()
    # A well-signed v1 token still dies: only v2 sessions exist after upgrade.
    assert not cfg.verify_token(f'v1.{exp}.{sig}')
    assert not cfg.verify_token('v1.999999999999.deadbeef')


def test_forged_token_cannot_revoke_another_session(monkeypatch):
    _gate_on(monkeypatch)
    cfg = GateConfig()
    victim = cfg.issue_token()
    sid, exp, sig = victim.split('.')[1:]
    forged = f'v2.{sid}.{exp}.' + '0' * len(sig)
    assert cfg.revoke_token(forged) is False
    assert cfg.verify_token(victim) is True  # the victim session is untouched


def test_sessions_do_not_survive_a_restart(monkeypatch):
    _gate_on(monkeypatch)
    cfg = GateConfig()
    token = cfg.issue_token()
    assert cfg.verify_token(token)
    fresh = GateConfig()  # same cookie key, empty session store — a restart
    assert not fresh.verify_token(token)
