#!/usr/bin/env python3
"""Rotate the entrance-gate password — HA-001 remediation, USER-RUN.

Run this yourself in a terminal (the new password prints ONCE, here, for you to
save — it is never written anywhere else):

    ./.venv/bin/python tools/rotate-gate-password.py [--dry-run]

What it does:
  1. Generates a strong random password and its pbkdf2_sha256 hash
     (same storage format entrance_gate.verify_password reads).
  2. Upserts HERMES_LIFE_GATE_PASSWORD_HASH in ~/.config/hermes-life/keys.env
     (single-quoted — the hash contains $ and must survive `source`).
  3. Pins HERMES_LIFE_GATE_COOKIE_KEY if absent, so the cookie-signing key is
     no longer derived from the password hash (entrance_gate.py:87-88).
  4. Keeps keys.env at mode 600 and never prints the hash.

Why rotate at all (HA-001): the old hash is in git history on origin/main
(commits 885e6bd, da77725) and entrance_gate derives its cookie key from the
hash — anyone with repo access can mint session cookies. Rotation gives you a
hash nobody has seen AND re-derives/repins the cookie key, so the leaked value
and every outstanding cookie stop working.

After running: restart the backend so it loads the new hash
(`./hermes-life.sh restart`) — the gate reads keys.env at startup.
"""
import argparse
import re
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from hermes_life.entrance_gate import hash_password  # noqa: E402

DEFAULT_KEYS = Path.home() / '.config' / 'hermes-life' / 'keys.env'


def upsert(lines: list[str], name: str, value: str) -> list[str]:
    """Replace `name=` line (export or bare) with a single-quoted export."""
    pat = re.compile(rf'^\s*(?:export\s+)?{re.escape(name)}=')
    out: list[str] = []
    done = False
    for line in lines:
        if pat.match(line):
            out.append(f"export {name}='{value}'\n")
            done = True
        else:
            out.append(line)
    if not done:
        if out and not out[-1].endswith('\n'):
            out[-1] += '\n'
        out.append(f"export {name}='{value}'\n")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--keys', type=Path, default=DEFAULT_KEYS,
                    help=f'keys.env path (default: {DEFAULT_KEYS})')
    ap.add_argument('--dry-run', action='store_true',
                    help='show what would change without writing keys.env')
    args = ap.parse_args()

    password = secrets.token_urlsafe(18)
    hashed = hash_password(password)
    cookie_key = secrets.token_urlsafe(32)

    lines = args.keys.read_text().splitlines(keepends=True) if args.keys.exists() else []
    had_hash_line = any('HERMES_LIFE_GATE_PASSWORD_HASH' in l for l in lines)
    had_cookie_key = any(
        re.match(r'^\s*(?:export\s+)?HERMES_LIFE_GATE_COOKIE_KEY=', l) for l in lines)
    lines = upsert(lines, 'HERMES_LIFE_GATE_PASSWORD_HASH', hashed)
    if not had_cookie_key:
        lines = upsert(lines, 'HERMES_LIFE_GATE_COOKIE_KEY', cookie_key)

    hash_note = 'existing line replaced' if had_hash_line else 'new line added'
    print(f'keys file: {args.keys} ({"exists" if args.keys.exists() else "will be created"})')
    print(f'HERMES_LIFE_GATE_PASSWORD_HASH: {hash_note}')
    print(f'HERMES_LIFE_GATE_COOKIE_KEY: {"already set — untouched" if had_cookie_key else "generated and pinned"}')

    if args.dry_run:
        print('\n--dry-run: nothing written.')
    else:
        args.keys.parent.mkdir(parents=True, exist_ok=True)
        args.keys.write_text(''.join(lines))
        args.keys.chmod(0o600)
        print(f'\nWritten and chmod 600.')

    print('\n=== SAVE THIS NOW — shown exactly once ===')
    print(password)
    print('=========================================')
    print('\nNext steps:')
    print('  1. Store the password in your password manager.')
    print('  2. Restart the backend so the gate loads the new hash:')
    print('       ./hermes-life.sh restart')
    print('  3. Log in with the new password; old cookies and the leaked hash')
    print('     are dead from the moment the restarted gate reads keys.env.')
    print('  4. (D1 hygiene, coordinated) purge config/*.env from git history —')
    print('     this force-pushes origin/main; say the word and I will run it.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
