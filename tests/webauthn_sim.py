"""Test-only software authenticator for the entrance-gate passkey tests.

Builds REAL WebAuthn registration/authentication responses (CBOR attestation
objects, COSE keys, ECDSA signatures) exactly like a browser authenticator
would, so the backend's webauthn-library verification runs for real.
"""
from __future__ import annotations

import base64
import cbor2
import hashlib
import json

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


def b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))


class SoftAuthenticator:
    """One P-256 credential that can register and then assert."""

    def __init__(self, rp_id: str, origin: str):
        self.rp_id = rp_id
        self.origin = origin
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = b'\xa1' * 32
        self.sign_count = 0

    # -- registration -------------------------------------------------------

    def _cose_key(self) -> bytes:
        pub = self.key.public_key().public_numbers()
        key = {1: 2, 3: -7, -1: 1,
               -2: pub.x.to_bytes(32, 'big'), -3: pub.y.to_bytes(32, 'big')}
        return cbor2.dumps(key)

    def _rp_id_hash(self) -> bytes:
        return hashlib.sha256(self.rp_id.encode()).digest()

    def _client_data(self, req_type: str, challenge_b64url: str) -> bytes:
        return json.dumps({'type': req_type, 'challenge': challenge_b64url,
                           'origin': self.origin,
                           'crossOrigin': False}).encode()

    def _options_dict(self, creation_options) -> dict:
        if isinstance(creation_options, (str, bytes)):
            return json.loads(creation_options)
        return creation_options

    def registration_response(self, creation_options: dict) -> dict:
        challenge = self._options_dict(creation_options)['challenge']
        client_data = self._client_data('webauthn.create', challenge)
        auth_data = (self._rp_id_hash()
                     + bytes([0x45])  # UP | UV | AT
                     + (0).to_bytes(4, 'big')
                     + b'\x00' * 16  # aaguid
                     + len(self.credential_id).to_bytes(2, 'big')
                     + self.credential_id
                     + self._cose_key())
        attestation = cbor2.dumps({'fmt': 'none', 'attStmt': {},
                                   'authData': auth_data})
        return {
            'id': b64url(self.credential_id),
            'rawId': b64url(self.credential_id),
            'type': 'public-key',
            'response': {
                'clientDataJSON': b64url(client_data),
                'attestationObject': b64url(attestation),
            },
        }

    # -- authentication ------------------------------------------------------

    def assertion_response(self, request_options: dict,
                           *, challenge_override: str | None = None,
                           rp_id: str | None = None) -> dict:
        challenge = challenge_override or \
            self._options_dict(request_options)['challenge']
        client_data = self._client_data('webauthn.get', challenge)
        self.sign_count += 1
        rp_hash = hashlib.sha256(
            (rp_id or self.rp_id).encode()).digest()
        auth_data = rp_hash + bytes([0x05]) + self.sign_count.to_bytes(4, 'big')
        signature = self.key.sign(auth_data + hashlib.sha256(client_data).digest(),
                                  ec.ECDSA(hashes.SHA256()))
        return {
            'id': b64url(self.credential_id),
            'rawId': b64url(self.credential_id),
            'type': 'public-key',
            'response': {
                'clientDataJSON': b64url(client_data),
                'authenticatorData': b64url(auth_data),
                'signature': b64url(signature),
                'userHandle': None,
            },
        }
