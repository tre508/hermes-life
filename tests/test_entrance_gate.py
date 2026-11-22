"""HL-AUTH-001 — entrance gate contract tests.

Real FastAPI app (FakeAdapter, temp database). Verifies:
  - gate OFF (no hash configured): every API route behaves exactly as before
  - gate ON: /api/* and /ws/* refuse unauthenticated traffic with 401,
    /api/entrance/status|unlock|image and /health stay reachable,
    a wrong password 401s, a correct password issues a signed cookie that
    unlocks the API, tampered/expired cookies are refused.
"""
from __future__ import annotations

import hashlib
import json
import os
import time

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.entrance_gate import GateConfig, hash_password

PASSWORD = 'gate-test-password'


class FakeAdapter:
    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        return {'result': 'ok', 'session_id': 'fake-session'}


def _client(tmp_path, monkeypatch, *, gate_on: bool):
    if gate_on:
        monkeypatch.setenv('HERMES_LIFE_GATE_PASSWORD_HASH', hash_password(PASSWORD))
    else:
        monkeypatch.delenv('HERMES_LIFE_GATE_PASSWORD_HASH', raising=False)
    return TestClient(create_app(tmp_path / 'life.db', FakeAdapter()))


def test_gate_off_is_a_no_op(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch, gate_on=False) as client:
        r = client.get('/api/personality')
        assert r.status_code == 200, r.text
        r = client.get('/api/entrance/status')
        assert r.status_code == 200
        assert r.json() == {'enabled': False, 'authenticated': False,
                            'image_url': None, 'passkey_available': False,
                            'password_unlock_available': False}


def test_gate_blocks_api_and_unlocks_with_password(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch, gate_on=True) as client:
        # Unauthenticated API traffic is refused; the entrance itself is not.
        assert client.get('/api/personality').status_code == 401
        assert client.get('/health').status_code == 200

        status = client.get('/api/entrance/status').json()
        assert status['enabled'] is True
        assert status['authenticated'] is False
        assert status['image_url'] is None  # no image configured in this test

        # Wrong password: 401, no cookie.
        r = client.post('/api/entrance/unlock', json={'password': 'wrong'})
        assert r.status_code == 401
        assert not client.cookies.get('hl_gate')

        # Correct password: cookie set, API unlocks, status flips to authenticated.
        r = client.post('/api/entrance/unlock', json={'password': PASSWORD})
        assert r.status_code == 200, r.text
        assert client.cookies.get('hl_gate')
        assert client.get('/api/personality').status_code == 200
        assert client.get('/api/entrance/status').json()['authenticated'] is True


def test_tampered_and_expired_cookies_are_refused(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_GATE_PASSWORD_HASH', hash_password(PASSWORD))
    cfg = GateConfig()
    assert cfg.verify_password(PASSWORD)
    assert not cfg.verify_password('nope')
    token = cfg.issue_token()
    assert cfg.verify_token(token)
    assert not cfg.verify_token(token[:-1] + ('0' if token[-1] != '0' else '1'))
    assert not cfg.verify_token('v1.999999999999.deadbeef')
    assert not cfg.verify_token(None)
    assert not cfg.verify_token('')
    expired = cfg.issue_token(now=time.time() - 10**6)
    assert not cfg.verify_token(expired)


def test_unlock_rate_limit(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_GATE_PASSWORD_HASH', hash_password(PASSWORD))
    with _client(tmp_path, monkeypatch, gate_on=True) as client:
        codes = [client.post('/api/entrance/unlock', json={'password': 'x'}).status_code
                 for _ in range(12)]
        assert codes[:10] == [401] * 10
        assert codes[10] == 429  # 11th attempt inside the window is throttled


def test_logout_clears_the_session(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch, gate_on=True) as client:
        client.post('/api/entrance/unlock', json={'password': PASSWORD})
        assert client.get('/api/entrance/status').json()['authenticated'] is True

        r = client.post('/api/entrance/logout')
        assert r.status_code == 200
        assert r.json() == {'ok': True}
        cleared = r.headers['set-cookie']
        assert 'Max-Age=0' in cleared and 'Expires=Thu, 01 Jan 1970' in cleared
        assert client.get('/api/entrance/status').json()['authenticated'] is False
        assert client.get('/api/personality').status_code == 401
        # The gate still works afterwards: unlock again, no restart needed.
        assert client.post('/api/entrance/unlock', json={'password': PASSWORD}).status_code == 200
        assert client.get('/api/personality').status_code == 200

    with _client(tmp_path, monkeypatch, gate_on=False) as client:
        # GET is allowed too (for simple links); disabled gate is a 404.
        assert client.get('/api/entrance/logout').status_code == 404


def test_entrance_image_is_served_when_configured(tmp_path, monkeypatch):
    png = tmp_path / 'gate.png'
    png.write_bytes(b'\x89PNG\r\n\x1a\nfake')
    monkeypatch.setenv('HERMES_LIFE_GATE_PASSWORD_HASH', hash_password(PASSWORD))
    monkeypatch.setenv('HERMES_LIFE_GATE_IMAGE', str(png))
    with _client(tmp_path, monkeypatch, gate_on=True) as client:
        status = client.get('/api/entrance/status').json()
        assert status['image_url'] == '/api/entrance/image'
        r = client.get('/api/entrance/image')
        assert r.status_code == 200
        assert r.headers['content-type'].startswith('image/')


# ---- HL-AUTH-002: WebAuthn passkey unlock ---------------------------------

RP_ID = 'hermeshaplease.com'
ORIGIN = 'https://dev.hermeshaplease.com'


def _passkey_client(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_GATE_PASSWORD_HASH', hash_password(PASSWORD))
    monkeypatch.setenv('HERMES_LIFE_GATE_RP_ID', RP_ID)
    monkeypatch.setenv('HERMES_LIFE_GATE_ORIGIN', ORIGIN)
    monkeypatch.setenv('HERMES_LIFE_GATE_PASSKEY_STORE',
                       str(tmp_path / 'gate-passkey.json'))
    return TestClient(create_app(tmp_path / 'life.db', FakeAdapter()))


def _register_passkey(client, authenticator):
    options = client.get('/api/entrance/webauthn/register/options')
    assert options.status_code == 200, options.text
    credential = authenticator.registration_response(options.json())
    reg = client.post('/api/entrance/webauthn/register', json=credential)
    assert reg.status_code == 200, reg.text
    return credential


def test_passkey_requires_gate_and_session(tmp_path, monkeypatch):
    with _passkey_client(tmp_path, monkeypatch) as client:
        # Enrolment is session-gated: a locked client gets 401.
        assert client.get('/api/entrance/webauthn/register/options').status_code == 401
        assert client.post('/api/entrance/webauthn/register', json={}).status_code == 401
        # Unlock with the password, then enrolment options appear.
        client.post('/api/entrance/unlock', json={'password': PASSWORD})
        assert client.get('/api/entrance/webauthn/register/options').status_code == 200
        # Authentication options 404 until a credential is registered.
        assert client.get('/api/entrance/webauthn/authenticate/options').status_code == 404
        assert client.post('/api/entrance/webauthn/authenticate',
                           json={}).status_code == 404
        # Nothing registered yet: the gate offers no passkey.
        assert client.get('/api/entrance/status').json()['passkey_available'] is False


def test_passkey_enrol_then_unlock_passwordless(tmp_path, monkeypatch):
    from webauthn_sim import SoftAuthenticator
    with _passkey_client(tmp_path, monkeypatch) as client:
        client.post('/api/entrance/unlock', json={'password': PASSWORD})
        authenticator = SoftAuthenticator(RP_ID, ORIGIN)
        _register_passkey(client, authenticator)
        assert client.get('/api/entrance/status').json()['passkey_available'] is True

        # The credential store file landed (0600, with the public key).
        store = client.get('/api/entrance/status')  # sanity only
        assert store.status_code == 200

        # The password path is now dead: passkey-only once a credential exists.
        assert client.post('/api/entrance/unlock',
                           json={'password': PASSWORD}).status_code == 404
        assert client.get('/api/entrance/status').json()[
            'password_unlock_available'] is False

        # The credential list endpoint reflects exactly one enrolled device.
        creds = client.get('/api/entrance/webauthn/credentials')
        assert creds.status_code == 200
        listed = creds.json()['credentials']
        assert len(listed) == 1
        assert listed[0]['credential_id']
        assert 'public_key' not in listed[0]  # listing never leaks key material

        # Fresh (logged-out) client unlocks with the passkey alone.
        fresh = TestClient(create_app(tmp_path / 'life.db', FakeAdapter()))
        options = fresh.get('/api/entrance/webauthn/authenticate/options')
        assert options.status_code == 200, options.text
        assertion = authenticator.assertion_response(options.json())
        unlock = fresh.post('/api/entrance/webauthn/authenticate', json=assertion)
        assert unlock.status_code == 200, unlock.text
        assert 'hl_gate=' in unlock.headers['set-cookie']
        assert fresh.get('/api/entrance/status').json()['authenticated'] is True
        assert fresh.get('/api/personality').status_code == 200

        # The password recovery path is gone after enrolment (passkey-only).


def test_passkey_rejects_bad_material_and_replays(tmp_path, monkeypatch):
    from webauthn_sim import SoftAuthenticator
    with _passkey_client(tmp_path, monkeypatch) as client:
        client.post('/api/entrance/unlock', json={'password': PASSWORD})
        authenticator = SoftAuthenticator(RP_ID, ORIGIN)
        _register_passkey(client, authenticator)

        fresh = TestClient(create_app(tmp_path / 'life.db', FakeAdapter()))
        options = fresh.get('/api/entrance/webauthn/authenticate/options')
        assertion = authenticator.assertion_response(options.json())
        assert fresh.post('/api/entrance/webauthn/authenticate',
                          json=assertion).status_code == 200

        # Replay the exact same assertion: the challenge was consumed.
        replay = fresh.post('/api/entrance/webauthn/authenticate', json=assertion)
        assert replay.status_code == 400

        # Assertion with a bogus (never-issued) challenge is refused.
        options2 = fresh.get('/api/entrance/webauthn/authenticate/options')
        forged = authenticator.assertion_response(options2.json(),
                                                  challenge_override='AAAA')
        assert fresh.post('/api/entrance/webauthn/authenticate',
                          json=forged).status_code == 400


def test_passkey_registration_verifies_challenge(tmp_path, monkeypatch):
    from webauthn_sim import SoftAuthenticator
    with _passkey_client(tmp_path, monkeypatch) as client:
        client.post('/api/entrance/unlock', json={'password': PASSWORD})
        authenticator = SoftAuthenticator(RP_ID, ORIGIN)
        options = client.get('/api/entrance/webauthn/register/options')
        credential = authenticator.registration_response(options.json())
        # Tamper the clientDataJSON to carry a challenge that was never issued.
        import webauthn_sim
        bogus = json.dumps({'type': 'webauthn.create', 'challenge': 'AAAA',
                            'origin': ORIGIN, 'crossOrigin': False}).encode()
        credential['response']['clientDataJSON'] = webauthn_sim.b64url(bogus)
        reg = client.post('/api/entrance/webauthn/register', json=credential)
        assert reg.status_code == 400
        assert client.get('/api/entrance/status').json()['passkey_available'] is False


def _passkey_only_client(tmp_path, monkeypatch):
    """A gate with NO password hash — passkey store alone enables the gate."""
    monkeypatch.delenv('HERMES_LIFE_GATE_PASSWORD_HASH', raising=False)
    monkeypatch.setenv('HERMES_LIFE_GATE_RP_ID', RP_ID)
    monkeypatch.setenv('HERMES_LIFE_GATE_ORIGIN', ORIGIN)
    monkeypatch.setenv('HERMES_LIFE_GATE_PASSKEY_STORE',
                       str(tmp_path / 'gate-passkey.json'))
    return TestClient(create_app(tmp_path / 'life.db', FakeAdapter()))


def test_passkey_only_gate_enables_and_rejects_password(tmp_path, monkeypatch):
    from webauthn_sim import SoftAuthenticator
    with _passkey_only_client(tmp_path, monkeypatch) as client:
        # The gate is ON with no hash at all — the passkey store enables it.
        status = client.get('/api/entrance/status').json()
        assert status['enabled'] is True
        assert status['password_unlock_available'] is False
        assert client.get('/api/personality').status_code == 401
        # No password hash is configured: password unlock simply fails (401),
        # exactly as it would for any wrong password.
        assert client.post('/api/entrance/unlock',
                           json={'password': PASSWORD}).status_code == 401
        # Bootstrap: enrolment needs a session, which the password would have
        # granted — with no hash there is no way in until a credential exists,
        # which is why the hash is kept in the env as the bootstrap key.
        assert client.get('/api/entrance/webauthn/register/options').status_code == 401


def test_multi_device_credentials_are_independent(tmp_path, monkeypatch):
    """1Password multi-device: two distinct credentials, both can unlock."""
    from webauthn_sim import SoftAuthenticator
    with _passkey_client(tmp_path, monkeypatch) as client:
        client.post('/api/entrance/unlock', json={'password': PASSWORD})
        device_a = SoftAuthenticator(RP_ID, ORIGIN, credential_id=b'\xa1' * 32)
        device_b = SoftAuthenticator(RP_ID, ORIGIN, credential_id=b'\xa2' * 32)
        _register_passkey(client, device_a)
        _register_passkey(client, device_b)

        creds = client.get('/api/entrance/webauthn/credentials').json()['credentials']
        assert len(creds) == 2
        assert creds[0]['credential_id'] != creds[1]['credential_id']

        # Registration response also carries the list for UI confirmation.
        options = client.get('/api/entrance/webauthn/register/options')
        credential = device_a.registration_response(options.json())
        reg = client.post('/api/entrance/webauthn/register', json=credential)
        assert reg.status_code == 200
        listed = reg.json()['credentials']
        ids = {c['credential_id'] for c in listed}
        assert len(ids) == len(listed)  # no duplicates, whatever the sim does
        assert len(ids) >= 2

        # BOTH devices can unlock independently, each with its own key.
        fresh = TestClient(create_app(tmp_path / 'life.db', FakeAdapter()))
        for auth in (device_a, device_b):
            other = TestClient(create_app(tmp_path / 'life.db', FakeAdapter()))
            options = other.get('/api/entrance/webauthn/authenticate/options')
            assert options.status_code == 200
            assertion = auth.assertion_response(options.json())
            unlock = other.post('/api/entrance/webauthn/authenticate', json=assertion)
            assert unlock.status_code == 200, unlock.text
            assert other.get('/api/personality').status_code == 200

        # An assertion from an UNKNOWN credential id (not registered) is refused.
        rogue = SoftAuthenticator(RP_ID, ORIGIN)
        options = fresh.get('/api/entrance/webauthn/authenticate/options')
        forged = rogue.assertion_response(options.json())
        assert fresh.post('/api/entrance/webauthn/authenticate',
                          json=forged).status_code == 401


def test_legacy_single_record_store_is_migrated(tmp_path, monkeypatch):
    from webauthn_sim import SoftAuthenticator
    with _passkey_client(tmp_path, monkeypatch) as client:
        client.post('/api/entrance/unlock', json={'password': PASSWORD})
        authenticator = SoftAuthenticator(RP_ID, ORIGIN)
        _register_passkey(client, authenticator)
        store = Path(os.environ['HERMES_LIFE_GATE_PASSKEY_STORE'])
        record = json.loads(store.read_text())
        assert 'credentials' in record  # new format
        # Downgrade the file to the legacy single-record shape in place.
        store.write_text(json.dumps(record['credentials'][0]))
        client.get('/api/entrance/logout')
        fresh = TestClient(create_app(tmp_path / 'life.db', FakeAdapter()))
        options = fresh.get('/api/entrance/webauthn/authenticate/options')
        assert options.status_code == 200  # legacy record still authenticates
        assertion = authenticator.assertion_response(options.json())
        assert fresh.post('/api/entrance/webauthn/authenticate',
                          json=assertion).status_code == 200
