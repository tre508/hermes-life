"""HL-AUTH-001 — Password-protected entrance for the public dev deployment.

The public site (dev.hermeshaplease.com) is served by the vite dev server on the
project host, which proxies /api to the local uvicorn backend. This module adds
the authentication boundary at the app edge:

  - GET  /api/entrance/status   -> {enabled, authenticated, image_url}
  - POST /api/entrance/unlock   -> verifies the password, sets a signed cookie
  - GET  /api/entrance/image    -> the entrance image (unauthenticated; it IS the gate)

A pure-ASGI middleware refuses every other /api/* and /ws/* request with 401
(websockets: accept+close 4401) while the gate is enabled.

The gate is OFF unless HERMES_LIFE_GATE_PASSWORD_HASH is configured, so local
development and every existing test/workflow are untouched.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path

from webauthn import (generate_authentication_options,
                      generate_registration_options, options_to_json,
                      verify_authentication_response, verify_registration_response)
from webauthn.helpers.structs import PublicKeyCredentialDescriptor

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

COOKIE_NAME = 'hl_gate'
PBKDF2_ITERATIONS = 600_000
DEFAULT_SESSION_HOURS = 12
MAX_FAILURES = 10
FAILURE_WINDOW = 300  # seconds
DEFAULT_RP_ID = 'hermeshaplease.com'
DEFAULT_ORIGIN = 'https://dev.hermeshaplease.com'
CHALLENGE_TTL = 300  # seconds
KIND_REGISTER = 0
KIND_AUTHENTICATE = 1


def hash_password(password: str) -> str:
    """pbkdf2_sha256$<iterations>$<salt_b64>$<hash_b64> — the storage format."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, PBKDF2_ITERATIONS)
    return 'pbkdf2_sha256${}${}${}'.format(
        PBKDF2_ITERATIONS,
        base64.b64encode(salt).decode(),
        base64.b64encode(digest).decode(),
    )


class GateConfig:
    def __init__(self):
        self.hash = os.getenv('HERMES_LIFE_GATE_PASSWORD_HASH', '').strip()
        self.image = os.getenv(
            'HERMES_LIFE_GATE_IMAGE',
            '/home/gayzer/Pictures/Alchemical Bronze Astronomical Gate.png')
        try:
            self.session_hours = float(os.getenv('HERMES_LIFE_GATE_SESSION_HOURS',
                                                 str(DEFAULT_SESSION_HOURS)))
        except ValueError:
            self.session_hours = DEFAULT_SESSION_HOURS
        self.enabled = bool(self.hash)
        # WebAuthn passkey configuration (HL-AUTH-002). The gate offers passkey
        # unlock only when a credential store path is configured AND a
        # credential has been registered into it.
        self.rp_id = os.getenv('HERMES_LIFE_GATE_RP_ID', DEFAULT_RP_ID).strip()
        self.origin = os.getenv('HERMES_LIFE_GATE_ORIGIN', DEFAULT_ORIGIN).strip()
        store = os.getenv('HERMES_LIFE_GATE_PASSKEY_STORE', '').strip()
        self.passkey_store = Path(store) if store else None
        # Challenge store: challenge (b64url) -> (kind, expiry). In-memory is
        # correct for a single-process, single-user gate.
        self._challenges: dict[str, tuple[int, float]] = {}
        self._failures: dict[str, list[float]] = {}
        # Cookie-signing key is derived from the stored hash, so rotating the
        # password also invalidates every outstanding session cookie.
        self.key = hashlib.sha256((self.hash + ':hl-gate-cookie').encode()).digest()

    # ---- passkey plumbing -------------------------------------------------

    def passkey_record(self) -> dict | None:
        """The registered credential record, or None when not registered."""
        if not self.passkey_store:
            return None
        try:
            record = json.loads(self.passkey_store.read_text())
        except (OSError, ValueError):
            return None
        if not isinstance(record, dict) or not record.get('credential_id'):
            return None
        return record

    def save_passkey_record(self, record: dict) -> None:
        if not self.passkey_store:
            raise HTTPException(404, 'Passkey store is not configured')
        self.passkey_store.parent.mkdir(parents=True, exist_ok=True)
        self.passkey_store.write_text(json.dumps(record))
        try:
            self.passkey_store.chmod(0o600)
        except OSError:
            pass

    def store_challenge(self, raw: bytes, kind: int) -> None:
        self._prune_challenges()
        key = base64.urlsafe_b64encode(raw).decode()
        self._challenges[key] = (kind, time.time() + CHALLENGE_TTL)

    def take_challenge(self, raw: bytes, kind: int) -> bool:
        """Consume the challenge (single use) if it is live and of this kind."""
        key = base64.urlsafe_b64encode(raw).decode()
        entry = self._challenges.get(key)
        if not entry or entry[0] != kind or entry[1] < time.time():
            return False
        del self._challenges[key]
        return True

    def _prune_challenges(self) -> None:
        now = time.time()
        for key in [k for k, (_, exp) in self._challenges.items() if exp < now]:
            del self._challenges[key]

    def verify_password(self, password: str) -> bool:
        if not self.enabled or not password:
            return False
        try:
            _scheme, iters, salt_b64, hash_b64 = self.hash.split('$')
            digest = hashlib.pbkdf2_hmac('sha256', password.encode(),
                                         base64.b64decode(salt_b64), int(iters))
        except (ValueError, TypeError):
            return False
        return hmac.compare_digest(digest, base64.b64decode(hash_b64))

    def issue_token(self, now: float | None = None) -> str:
        exp = int((now or time.time()) + self.session_hours * 3600)
        sig = hmac.new(self.key, f'v1.{exp}'.encode(), hashlib.sha256).hexdigest()
        return f'v1.{exp}.{sig}'

    def verify_token(self, token: str | None, now: float | None = None) -> bool:
        if not self.enabled or not token:
            return False
        parts = token.split('.')
        if len(parts) != 3 or parts[0] != 'v1':
            return False
        try:
            exp = int(parts[1])
        except ValueError:
            return False
        expected = hmac.new(self.key, f'v1.{exp}'.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(parts[2], expected):
            return False
        return exp > (now or time.time())

    def register_failure(self, client: str) -> bool:
        """True when the client is allowed to keep trying."""
        now = time.time()
        recent = [t for t in self._failures.get(client, []) if now - t < FAILURE_WINDOW]
        if len(recent) >= MAX_FAILURES:
            self._failures[client] = recent
            return False
        recent.append(now)
        self._failures[client] = recent
        return True


def _cookie_header_value(scope) -> str:
    for k, v in scope.get('headers') or []:
        if k == b'cookie':
            return v.decode('latin-1')
    return ''


def _cookie_token(scope) -> str | None:
    for part in _cookie_header_value(scope).split(';'):
        name, _, value = part.strip().partition('=')
        if name == COOKIE_NAME:
            return value
    return None


def _client_id(scope) -> str:
    client = scope.get('client') or ('unknown', 0)
    return str(client[0])


def add_gate_middleware(app: FastAPI, config: GateConfig) -> None:
    app.add_middleware(GateMiddleware, config=config)


class GateMiddleware:
    """Pure-ASGI boundary: refuses unauthenticated /api/* and /ws/* traffic.

    Exempt: /api/entrance/* (the entrance itself) and /health. Websockets are
    accepted then closed with 4401 so uvicorn terminates the handshake cleanly.
    """
    def __init__(self, app, config: GateConfig):
        self.app = app
        self.config = config

    async def __call__(self, scope, receive, send):
        if scope['type'] not in ('http', 'websocket') or not self.config.enabled:
            await self.app(scope, receive, send)
            return
        path = scope.get('path', '')
        if path.startswith('/api/entrance') or path == '/health':
            await self.app(scope, receive, send)
            return
        protected = path.startswith('/api') or path.startswith('/ws')
        if not protected or self.config.verify_token(_cookie_token(scope)):
            await self.app(scope, receive, send)
            return
        if scope['type'] == 'http':
            response = JSONResponse({'error': 'Gate locked. Unlock at the entrance.'},
                                    status_code=401)
            await response(scope, receive, send)
        else:
            await send({'type': 'websocket.accept'})
            await send({'type': 'websocket.close', 'code': 4401})


class UnlockInput(BaseModel):
    password: str = Field(min_length=1, max_length=256)


def add_gate_routes(app: FastAPI, config: GateConfig) -> None:
    @app.get('/api/entrance/status')
    def status(request: Request):
        image_url = None
        if config.enabled and config.image and Path(config.image).is_file():
            image_url = '/api/entrance/image'
        return {'enabled': config.enabled,
                'authenticated': config.verify_token(_cookie_token(request.scope)),
                'image_url': image_url,
                'passkey_available': bool(config.enabled and config.passkey_record())}

    @app.post('/api/entrance/unlock')
    def unlock(payload: UnlockInput, request: Request):
        if not config.enabled:
            raise HTTPException(404, 'Gate is not configured')
        if not config.register_failure(_client_id(request.scope)):
            raise HTTPException(429, 'Too many attempts — wait a few minutes')
        if not config.verify_password(payload.password):
            raise HTTPException(401, 'Incorrect password')
        return JSONResponse({'ok': True}, headers={
            'set-cookie': _session_cookie(request, config)})

    @app.post('/api/entrance/logout')
    @app.get('/api/entrance/logout')
    def logout():
        if not config.enabled:
            raise HTTPException(404, 'Gate is not configured')
        # Clear the gate cookie: *** + the shortest possible expiry so
        # every browser honours it. The next request is unauthenticated again.
        cookie = f'{COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax'
        return JSONResponse({'ok': True}, headers={'set-cookie': cookie})

    @app.get('/api/entrance/image')
    def image():
        if not config.enabled or not config.image or not Path(config.image).is_file():
            raise HTTPException(404, 'Entrance image not configured')
        return FileResponse(config.image)


def _session_cookie(request: Request, config: GateConfig) -> str:
    token = config.issue_token()
    max_age = int(config.session_hours * 3600)
    secure = request.url.scheme == 'https' or \
        request.headers.get('x-forwarded-proto', '') == 'https'
    return (f'{COOKIE_NAME}={token}; Path=/; Max-Age={max_age}; '
            f'HttpOnly; SameSite=Lax' + ('; Secure' if secure else ''))


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


def _from_b64url(value: str | bytes | None) -> bytes:
    if value is None:
        return b''
    if isinstance(value, bytes):
        return value
    pad = '=' * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + pad)


def _require_session(request: Request, config: GateConfig) -> None:
    if not config.verify_token(_cookie_token(request.scope)):
        raise HTTPException(401, 'Unlock the gate first')


def _client_challenge(credential: dict) -> bytes:
    """Pull the raw challenge bytes out of the credential's clientDataJSON."""
    client_json = credential['response']['clientDataJSON']
    data = json.loads(_from_b64url(client_json))
    return _from_b64url(data['challenge'])


def add_passkey_routes(app: FastAPI, config: GateConfig) -> None:
    """HL-AUTH-002 — WebAuthn passkey enrolment and passwordless unlock.

    Enrolment requires an existing gate session (you unlock with the password
    once, then register the passkey). Authentication is fully passwordless and
    issues the same signed session cookie as the password unlock.
    """

    @app.get('/api/entrance/webauthn/register/options')
    def register_options(request: Request):
        if not config.enabled:
            raise HTTPException(404, 'Gate is not configured')
        _require_session(request, config)
        if not config.passkey_store:
            raise HTTPException(404, 'Passkey store is not configured')
        user_id = secrets.token_bytes(16)
        options = generate_registration_options(
            rp_id=config.rp_id,
            rp_name='Hermes Life',
            user_name='gate-keeper',
            user_id=user_id,
        )
        raw = options.challenge
        config.store_challenge(raw, KIND_REGISTER)
        return options_to_json(options)

    @app.post('/api/entrance/webauthn/register')
    def register(request: Request, credential: dict):
        if not config.enabled:
            raise HTTPException(404, 'Gate is not configured')
        _require_session(request, config)
        if not config.passkey_store:
            raise HTTPException(404, 'Passkey store is not configured')
        try:
            challenge = _client_challenge(credential)
        except (ValueError, KeyError) as exc:
            raise HTTPException(400, 'Malformed credential payload') from exc
        if not config.take_challenge(challenge, KIND_REGISTER):
            raise HTTPException(400, 'Unknown or expired challenge')
        try:
            verified = verify_registration_response(
                credential=credential,
                expected_challenge=challenge,
                expected_rp_id=config.rp_id,
                expected_origin=config.origin,
            )
        except Exception as exc:  # webauthn raises on any invalid material
            raise HTTPException(400, f'Passkey registration failed: {exc}') from exc
        config.save_passkey_record({
            'credential_id': _b64url(verified.credential_id),
            'public_key': _b64url(verified.credential_public_key),
            'sign_count': verified.sign_count,
        })
        return {'ok': True}

    @app.get('/api/entrance/webauthn/authenticate/options')
    def authenticate_options():
        if not config.enabled:
            raise HTTPException(404, 'Gate is not configured')
        record = config.passkey_record()
        if not record:
            raise HTTPException(404, 'No passkey registered')
        options = generate_authentication_options(
            rp_id=config.rp_id,
            allow_credentials=[PublicKeyCredentialDescriptor(
                id=_from_b64url(record['credential_id']))],
        )
        config.store_challenge(options.challenge, KIND_AUTHENTICATE)
        return options_to_json(options)

    @app.post('/api/entrance/webauthn/authenticate')
    def authenticate(request: Request, credential: dict):
        if not config.enabled:
            raise HTTPException(404, 'Gate is not configured')
        record = config.passkey_record()
        if not record:
            raise HTTPException(404, 'No passkey registered')
        if not config.register_failure(_client_id(request.scope)):
            raise HTTPException(429, 'Too many attempts — wait a few minutes')
        try:
            challenge = _client_challenge(credential)
        except (ValueError, KeyError) as exc:
            raise HTTPException(400, 'Malformed credential payload') from exc
        if not config.take_challenge(challenge, KIND_AUTHENTICATE):
            raise HTTPException(400, 'Unknown or expired challenge')
        try:
            verified = verify_authentication_response(
                credential=credential,
                expected_challenge=challenge,
                expected_rp_id=config.rp_id,
                expected_origin=config.origin,
                credential_public_key=_from_b64url(record['public_key']),
                credential_current_sign_count=int(record.get('sign_count', 0)),
            )
        except Exception as exc:  # webauthn raises on any invalid signature
            raise HTTPException(401, f'Passkey verification failed: {exc}') from exc
        config.save_passkey_record({**record, 'sign_count': verified.new_sign_count})
        return JSONResponse({'ok': True}, headers={
            'set-cookie': _session_cookie(request, config)})
