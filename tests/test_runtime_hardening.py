"""Phase-4 runtime hardening pins (HA-022 / HA-024 / HA-028).

The app.py workstream was interrupted after implementation landed — these
tests pin what shipped: defensive ?after parsing, one shared events poller,
the cancel/finish bookkeeping guard, and the terminal cap + child reaping.
Style follows tests/test_security_hardening.py (real TestClient where a real
behavior is observable; source contract where the behavior is a thread/fork
wiring).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from hermes_life.app import (
    TERMINAL_MAX_SESSIONS,
    TerminalSessions,
    create_app,
    parse_after,
)
from hermes_life.app import Runtime


# ── HA-024: the ?after= watermark parses defensively ───────────────────────

def test_parse_after_is_defensive():
    assert parse_after('0') == 0
    assert parse_after('42') == 42
    assert parse_after('') == 0
    assert parse_after('abc') == 0
    assert parse_after(None) == 0
    assert parse_after('-7') == 0          # negatives clamp to the start
    assert parse_after('3.5') == 0         # non-integers never raise


# ── HA-024: one shared poller feeds every socket ──────────────────────────

def test_ws_events_uses_the_shared_poller_and_survives_bad_after():
    """The old per-connection loop called sync_world + events() every 0.4s per
    socket and crashed on unparseable ?after — pin the shared pump + parse."""
    from pathlib import Path
    app_src = (Path(__file__).resolve().parent.parent / 'hermes_life' / 'app.py').read_text()
    assert 'event_stream.join' in app_src, 'sockets must join one shared poller'
    assert 'parse_after(' in app_src, 'the watermark must go through the parser'
    # per-connection polling must be gone
    assert 'sync_world(runtime.store)\n                batch' not in app_src

    import threading
    client = TestClient(create_app(database=__import__('pathlib').Path('/tmp') / 'ws-hardening-dbg.db'))
    # a garbage ?after must not kill the handler (it used to raise ValueError
    # out of the socket). Bounded drain: the bug ends the drain with an error,
    # the fix ends it by timeout with nothing to read (fresh DB, no events).
    outcome: dict = {'err': None, 'msgs': 0}
    with client.websocket_connect('/ws/events?after=garbage') as ws:
        def _drain():
            while True:
                try:
                    ws.receive_text(); outcome['msgs'] += 1
                except BaseException as exc:
                    outcome['err'] = exc; break
        t = threading.Thread(target=_drain, daemon=True)
        t.start(); t.join(2)
    assert not isinstance(outcome['err'], (RuntimeError, ValueError)), \
        'a bad ?after must not error the handler (HA-024)'


# ── HA-022: cancel vs finish bookkeeping is guarded ───────────────────────

def test_is_cancelled_guard_exists_and_reads_task_state(tmp_path):
    from hermes_life.schema import migrate
    runtime = Runtime(tmp_path / 'cancel-guard.db')
    migrate(runtime.store.connection)  # Runtime's ctor only owns chat_task_models
    # a fresh task is not cancelled (create_task returns the row dict)
    created = runtime.store.create_task('hello')
    task_id = created['id'] if isinstance(created, dict) else created
    assert runtime._is_cancelled(task_id) is False
    # once cancel settles it, later bookkeeping must not flip it back
    runtime.store.update_task(task_id, 'cancelled')
    assert runtime._is_cancelled(task_id) is True
    assert runtime._is_cancelled('nonexistent-task') is False


def test_cancel_path_never_releases_an_unowned_lock():
    from pathlib import Path
    app_src = (Path(__file__).resolve().parent.parent / 'hermes_life' / 'app.py').read_text()
    # cancel_task must consult _is_cancelled rather than blindly settling
    assert '_is_cancelled' in app_src
    cancel_at = app_src.index('def cancel_task')
    body = app_src[cancel_at:cancel_at + 2500]
    assert 'active.release()' not in body, \
        'cancel_task must not release runtime.active unconditionally (HA-022)'


# ── HA-028: terminal cap + child reaping ──────────────────────────────────

def test_terminal_sessions_class_caps_concurrency():
    s = TerminalSessions(limit=2)
    assert s.acquire() is True
    assert s.acquire() is True
    assert s.acquire() is False   # refused before any fork
    s.release()
    assert s.acquire() is True    # release frees the slot
    s.release(); s.release(); s.release()


def test_terminal_cap_refuses_excess_connections_at_the_socket(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_ENABLE_TERMINAL', '1')
    import threading
    client = TestClient(create_app(database=tmp_path / 'cap.db'))
    client.__enter__()
    held = []
    codes = []

    def observe(ws):
        """Bounded drain: accepted shells stream a prompt and never close;
        the refused one closes 4403 immediately."""
        got = {'code': None}
        def _d():
            while True:
                try:
                    ws.receive_text()
                except WebSocketDisconnect as exc:
                    got['code'] = exc.code; break
                except BaseException:
                    break
        t = threading.Thread(target=_d, daemon=True)
        t.start(); t.join(2)
        return got['code']

    try:
        for _ in range(TERMINAL_MAX_SESSIONS + 1):
            cm = client.websocket_connect('/ws/terminal')
            ws = cm.__enter__()
            code = observe(ws)
            if code == 4403:
                codes.append(code)
                cm.__exit__(None, None, None)
            else:
                held.append(cm)
    finally:
        for cm in reversed(held):
            cm.__exit__(None, None, None)
    assert 4403 in codes, \
        f'cap={TERMINAL_MAX_SESSIONS} must refuse the excess connection (close codes seen: {codes})'


def test_terminal_children_are_reaped():
    from pathlib import Path
    app_src = (Path(__file__).resolve().parent.parent / 'hermes_life' / 'app.py').read_text()
    assert 'def reap_child' in app_src
    assert 'waitpid' in app_src
    assert "name='terminal-reap'" in app_src, 'the reaper runs on session teardown'
