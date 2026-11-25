#!/usr/bin/env python3
"""Backfill chat usage telemetry from events already in the database.

Every `hermes.result` event already carries the runtime's token counters and every
`hermes.system` init carries the model it loaded — the chat simply never read
them. This replays those stored events through the SAME code path the live backend
uses (ChatModels.observe), so history gains usage numbers without inventing any.

Idempotent: observation only fills fields, so re-running changes nothing further.

    ./.venv/bin/python scripts/backfill-chat-usage.py [--db PATH] [--dry-run]

Order matters: tasks are replayed in event order so the per-turn context figure
can be differenced against the turn before it in the same session.
"""
import argparse
import os
import re
import sqlite3
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from hermes_life.chat_models import ChatModels, _derived_cost  # noqa: E402

DEFAULT_DB = os.path.expanduser('~/.local/share/hermes-life/life.db')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_WORKER_ENV = os.path.join(REPO, 'config', 'hermes-life-lenovo.env')

_ENV_LINE = re.compile(r'^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$')


class _Store:
    """The minimum ChatModels needs: a connection and a lock."""

    def __init__(self, connection):
        self.connection = connection
        self.lock = threading.Lock()


def _load_env(path):
    """Minimal reader for the `export K=V` files start.sh sources.

    The worker's address is configuration, never a default, so the adapter needs
    these three variables present before it will construct.
    """
    if not path or not os.path.exists(path):
        return False
    for line in open(path, encoding='utf-8'):
        match = _ENV_LINE.match(line.strip())
        if not match:
            continue
        key, raw = match.group(1), match.group(2).strip()
        if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in ('"', "'"):
            raw = raw[1:-1]
        os.environ.setdefault(key, raw)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default=os.environ.get('HERMES_LIFE_DB') or DEFAULT_DB)
    parser.add_argument('--dry-run', action='store_true',
                        help='report what would change without writing')
    parser.add_argument('--worker-default-model', default=os.environ.get('HERMES_LIFE_WORKER_DEFAULT_MODEL', ''),
                        help='model the worker\'s CLI is configured to use; attributed '
                             '(provenance worker_config) to tasks that never named one, '
                             'so their context window can be resolved')
    parser.add_argument('--worker-env', default=DEFAULT_WORKER_ENV,
                        help='env file naming the worker (default: config/hermes-life-lenovo.env)')
    parser.add_argument('--no-worker-sessions', action='store_true',
                        help='skip reading the CLI\'s own session store')
    args = parser.parse_args()

    if not os.path.exists(args.db):
        parser.error(f'no database at {args.db}')

    connection = sqlite3.connect(args.db)
    connection.row_factory = sqlite3.Row
    models = ChatModels(_Store(connection))

    if args.dry_run:
        # Column adds only; no observation is written.
        print(f'dry run against {args.db} — no writes')

    models.migrate()

    if not args.dry_run:
        # Load the catalogue once so windows and rates are available while
        # replaying: both lookups are cache-only by design (the live event handler
        # must never block on the network).
        catalogue = models.catalog()
        print(f'catalogue loaded: {len(catalogue)} models (windows and rates available)')

    before = {row['task_id'] for row in connection.execute('SELECT task_id FROM chat_task_models')}
    events = connection.execute("""
        SELECT task_id, payload FROM events
        WHERE type IN ('hermes.system', 'hermes.result') AND task_id IS NOT NULL
        ORDER BY sequence""").fetchall()
    print(f'{len(events)} runtime events across '
          f"{connection.execute('SELECT COUNT(DISTINCT task_id) c FROM events WHERE task_id IS NOT NULL').fetchone()['c']} tasks")

    applied = skipped = 0
    for event in events:
        if args.dry_run:
            continue
        try:
            payload = __import__('json').loads(event['payload'])
        except (ValueError, TypeError):
            skipped += 1
            continue
        if not isinstance(payload, dict):
            skipped += 1
            continue
        models.observe(event['task_id'], payload)
        applied += 1

    after = {row['task_id'] for row in connection.execute('SELECT task_id FROM chat_task_models')}

    applied_sessions = 0
    if not args.no_worker_sessions and not args.dry_run:
        # The CLI's own store is authoritative: the real model, the last request's
        # prompt size (`_usage_anchor`) and the price IT computed. Read in one
        # round trip and applied by session id, which these rows already carry.
        _load_env(args.worker_env)
        try:
            from hermes_life.hermes_adapter import HermesAdapter
            sessions = HermesAdapter().all_session_usage()
        except Exception as exc:  # noqa: BLE001 - degrade, never fail the backfill
            sessions = {}
            print(f'worker session store unavailable ({exc}); using stream telemetry only')
        print(f'session records read from the worker: {len(sessions)}')
        for row in connection.execute(
                "SELECT task_id, session_id FROM chat_task_models "
                "WHERE session_id IS NOT NULL AND session_id <> '' ORDER BY updated_at").fetchall():
            record = sessions.get(row['session_id'])
            if record:
                models.observe(row['task_id'], record)
                applied_sessions += 1

    attributed = 0
    if args.worker_default_model and not args.dry_run:
        # The runtime only names a model when it was overridden, so historical tasks
        # have none and their window is unresolvable. Attribute the worker's
        # configured default, recorded as such rather than as a runtime report.
        for row in connection.execute(
                "SELECT task_id FROM chat_task_models WHERE model IS NULL OR model=''").fetchall():
            if models.attribute_default_model(row['task_id'], args.worker_default_model):
                attributed += 1
        print(f'attributed the worker default ({args.worker_default_model}) to {attributed} tasks')

    with_tokens = connection.execute(
        'SELECT COUNT(*) c FROM chat_task_models WHERE input_tokens IS NOT NULL').fetchone()['c']
    with_window = connection.execute(
        'SELECT COUNT(*) c FROM chat_task_models WHERE context_window IS NOT NULL').fetchone()['c']
    with_turn = connection.execute(
        'SELECT COUNT(*) c FROM chat_task_models WHERE turn_input_tokens IS NOT NULL').fetchone()['c']

    print()
    print(f'events applied : {applied}  (unusable payloads skipped: {skipped})')
    print(f'session records applied: {applied_sessions}')
    print(f'rows before    : {len(before)}')
    print(f'rows after     : {len(after)}  (created {len(after - before)})')
    print(f'with tokens    : {with_tokens}')
    print(f'with a window  : {with_window}')
    print(f'with turn input: {with_turn}')

    priced = sum(1 for row in connection.execute(
        'SELECT model, input_tokens, output_tokens, cache_read_tokens FROM chat_task_models')
        if _derived_cost(dict(row)) is not None)
    print(f'priceable now  : {priced}  (cost is derived at read time, not stored)')
    print()
    print('sample:')
    for row in connection.execute("""
            SELECT task_id, model, context_window, input_tokens, output_tokens,
                   cache_read_tokens, turn_input_tokens
            FROM chat_task_models WHERE input_tokens IS NOT NULL
            ORDER BY updated_at DESC LIMIT 5"""):
        record = dict(row)
        cost = _derived_cost(record)
        print(f"  {record['task_id'][:8]} model={record['model'] or '(not reported)'} "
              f"window={record['context_window']} input={record['input_tokens']} "
              f"output={record['output_tokens']} turn={record['turn_input_tokens']} "
              f"cost={'$%.4f' % cost if cost is not None else 'n/a'}")


if __name__ == '__main__':
    main()
