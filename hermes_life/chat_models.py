"""HL-CHAT-002: interactive model catalogue and evidence-only telemetry.

The catalogue is the configured list (HERMES_LIFE_CHAT_MODELS) followed by the
provider's own live model list, so the picker reflects what the account can
actually select instead of a handful of hand-copied ids. The configured entries
are curated defaults: they stay pinned at the top with their labels, and they are
the fallback whenever the provider cannot be reached, so the picker never empties.

Telemetry is recorded for EVERY chat, not only ones where a model was explicitly
picked: the runtime names the model it actually loaded (`hermes.system`, init) and
reports its counters (`hermes.result`). A task with no model choice still gets a
row, created on first observation.

Nothing is presumed about a model. Every stored figure is either reported by the
runtime or — for cost alone — arithmetic on the provider's own published per-token
rates applied to the provider's own token counts, and it is labelled as such.
"""
import json
import os
import re
import threading
import time
import urllib.request
from datetime import datetime, timezone

# '~' is included for the provider's family aliases (~anthropic/claude-sonnet-latest).
# It is not a shell metacharacter, and the id is quoted again where it reaches a
# command (hermes_adapter.remote_script), so this stays a shape check, not a
# substitute for that quoting.
_NAME = re.compile(r'^[~a-zA-Z0-9_./:+-]{1,160}$')

# The provider's public catalogue. No key required; ~1 MB and ~470 entries, so it
# is cached rather than fetched per request.
_CATALOGUE_URL = 'https://openrouter.ai/api/v1/models'
_CATALOGUE_TTL = 900.0
_catalogue_lock = threading.Lock()
_catalogue_cache = {'fetched_at': 0.0, 'rows': [], 'pricing': {}}

# Only these may ever be written as a column name.
_WRITABLE = ('provider', 'model', 'context_window', 'input_tokens', 'output_tokens',
             'cache_read_tokens', 'session_id', 'turn_input_tokens',
             'estimated_cost_usd', 'model_source', 'cost_source',
             'context_anchor_tokens', 'api_call_count')

# Added after the first release; migrate() ALTERs them in when absent.
_ADDED_COLUMNS = (('session_id', 'TEXT'),
                  ('cache_read_tokens', 'INTEGER'),
                  ('turn_input_tokens', 'INTEGER'),
                  ('model_source', 'TEXT'),
                  ('cost_source', 'TEXT'),
                  ('context_anchor_tokens', 'INTEGER'),
                  ('api_call_count', 'INTEGER'))


def _now():
    return datetime.now(timezone.utc).isoformat()


def _normalise(provider, model, label, window):
    """One catalogue row, or None when the provider's statement is not usable."""
    if not (isinstance(provider, str) and _NAME.fullmatch(provider) and
            isinstance(model, str) and _NAME.fullmatch(model)):
        return None
    if not isinstance(window, int) or isinstance(window, bool) or window <= 0:
        window = None
    return {'provider': provider, 'model': model,
            'label': str(label or model)[:120],
            'context_window': window}


def _rates_from(raw):
    """Per-token rates the provider publishes, as floats. None when unusable."""
    if not isinstance(raw, dict):
        return None

    def rate(name):
        value = raw.get(name)
        if not isinstance(value, (str, int, float)) or isinstance(value, bool):
            return None
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        return number if number >= 0 else None

    prompt, completion = rate('prompt'), rate('completion')
    if prompt is None or completion is None:
        return None
    return {'prompt': prompt, 'completion': completion,
            'cache_read': rate('cache_read'), 'cache_write': rate('cache_write')}


def _configured():
    raw = os.environ.get('HERMES_LIFE_CHAT_MODELS', '[]')
    try:
        rows = json.loads(raw)
    except (ValueError, TypeError):
        return []
    if not isinstance(rows, list):
        return []
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        normalised = _normalise(row.get('provider'), row.get('model'),
                                row.get('label'), row.get('context_window'))
        if normalised:
            out.append(normalised)
    return out


def _fetch_openrouter():
    """(rows, pricing) for the provider's live catalogue. ([], {}) on any failure."""
    try:
        request = urllib.request.Request(_CATALOGUE_URL, headers={'Accept': 'application/json'})
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = json.load(response)
    except Exception:
        return [], {}
    rows, pricing = [], {}
    for row in payload.get('data') or []:
        if not isinstance(row, dict):
            continue
        normalised = _normalise('openrouter', row.get('id'), row.get('name'),
                                row.get('context_length'))
        if not normalised:
            continue
        rows.append(normalised)
        rates = _rates_from(row.get('pricing'))
        if rates:
            pricing[normalised['model']] = rates
    return sorted(rows, key=lambda r: r['label'].lower()), pricing


def _live_catalogue():
    """Cached live catalogue, falling back to the last good copy, then to [].

    Pricing is cached alongside it but never leaves this module: it is not part
    of the catalogue the browser receives.
    """
    with _catalogue_lock:
        if _catalogue_cache['rows'] and (time.monotonic() - _catalogue_cache['fetched_at']) < _CATALOGUE_TTL:
            return _catalogue_cache['rows']
    rows, pricing = _fetch_openrouter()
    with _catalogue_lock:
        if rows:
            _catalogue_cache['rows'] = rows
            _catalogue_cache['fetched_at'] = time.monotonic()
            _catalogue_cache['pricing'] = pricing
        return rows or _catalogue_cache['rows']


def _rates(model):
    """Per-token rates for one model, from the catalogue already in memory.

    Deliberately cache-only: this is read on every usage poll AND from the event
    handler while a task is streaming, so it must never block on the network. The
    catalogue is loaded by the model picker (GET /api/chat/models) on chat init.
    """
    with _catalogue_lock:
        return _catalogue_cache['pricing'].get(model or '')


def _window_for(model):
    """The context window the provider reports for a model id. Cache-only, as above."""
    with _catalogue_lock:
        for row in _catalogue_cache['rows']:
            if row['model'] == model:
                return row['context_window']
    return None


def _derived_cost(record):
    """Cost from the provider's published rates applied to the provider's counts.

    The runtime reports no price, so this is the only honest source. `cache_read`
    is a SUBSET of `input` in the runtime's accounting (total == input + output,
    with cache_read counted inside input), so the cached portion is priced at the
    cache rate and only the remainder at the full input rate.
    """
    rates = _rates(record.get('model'))
    if not rates:
        return None
    input_tokens = record.get('input_tokens')
    output_tokens = record.get('output_tokens')
    if input_tokens is None and output_tokens is None:
        return None
    gross = input_tokens or 0
    cached = min(record.get('cache_read_tokens') or 0, gross)
    fresh = gross - cached
    total = fresh * rates['prompt']
    total += cached * (rates.get('cache_read') if rates.get('cache_read') is not None
                       else rates['prompt'])
    total += (output_tokens or 0) * rates['completion']
    return round(total, 6)


class ChatModels:
    def __init__(self, store):
        self.store = store

    def migrate(self):
        with self.store.lock:
            self.store.connection.execute('''CREATE TABLE IF NOT EXISTS chat_task_models (
                task_id TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                context_window INTEGER,
                input_tokens INTEGER,
                output_tokens INTEGER,
                estimated_cost_usd REAL,
                updated_at TEXT NOT NULL
            )''')
            existing = {row[0] for row in self.store.connection.execute(
                "SELECT name FROM pragma_table_info('chat_task_models')")}
            for name, kind in _ADDED_COLUMNS:
                if name not in existing:
                    self.store.connection.execute(
                        f'ALTER TABLE chat_task_models ADD COLUMN {name} {kind}')
            self.store.connection.commit()

    def catalog(self):
        """Configured models first, then everything the provider offers.

        Configured rows keep their curated labels and stay pinned at the top;
        the live list follows, alphabetically, de-duplicated against them.
        """
        pinned = _configured()
        configured = {(r['provider'], r['model']) for r in pinned}
        return pinned + [r for r in _live_catalogue()
                         if (r['provider'], r['model']) not in configured]

    def validate(self, provider, model):
        if not provider and not model:
            return None
        match = next((r for r in self.catalog()
                      if r['provider'] == provider and r['model'] == model), None)
        if not match:
            raise ValueError('Provider/model is not configured for Hermes Life Chat')
        return match

    # -- writing ------------------------------------------------------------

    def _write(self, task_id, **values):
        """Create or update this task's row, touching only the keys supplied.

        A task the user left on "Worker default" has no model choice recorded, so
        the row is created here on first observation — with an empty provider and
        model, which is what "not chosen" honestly means. Both columns are NOT
        NULL, so '' stands in for unknown rather than inventing a name.
        """
        known = {k: v for k, v in values.items() if v is not None and k in _WRITABLE}
        with self.store.lock:
            exists = self.store.connection.execute(
                'SELECT 1 FROM chat_task_models WHERE task_id=?', (task_id,)).fetchone()
            if exists:
                if known:
                    assignments = ','.join(f'{k}=?' for k in known)
                    self.store.connection.execute(
                        f'UPDATE chat_task_models SET {assignments},updated_at=? WHERE task_id=?',
                        (*known.values(), _now(), task_id))
            else:
                known.setdefault('provider', '')
                known.setdefault('model', '')
                columns = ','.join(['task_id', *known, 'updated_at'])
                marks = ','.join(['?'] * (len(known) + 2))
                self.store.connection.execute(
                    f'INSERT INTO chat_task_models ({columns}) VALUES ({marks})',
                    (task_id, *known.values(), _now()))
            self.store.connection.commit()

    def save(self, task_id, choice):
        """The model the user explicitly selected for this task."""
        if choice is None:
            return
        self._write(task_id, provider=choice['provider'], model=choice['model'],
                    context_window=choice['context_window'])

    # -- reading ------------------------------------------------------------

    def attribute_default_model(self, task_id, model):
        """Record the model the worker is CONFIGURED to use, when the runtime named none.

        Only ever fills a blank: a model the runtime reported, or one the user chose,
        always wins. Provenance is 'worker_config', so a window derived this way is
        never presented as one the runtime reported.
        """
        if not model:
            return False
        record = self.for_task(task_id)
        if record and record.get('model'):
            return False
        self._write(task_id, model=model, context_window=_window_for(model),
                    model_source='worker_config')
        return True

    def for_task(self, task_id):
        """The task's usage record, with cost derived when the runtime gave none."""
        with self.store.lock:
            row = self.store.connection.execute(
                'SELECT * FROM chat_task_models WHERE task_id=?', (task_id,)).fetchone()
        if row is None:
            return None
        record = dict(row)
        if record.get('estimated_cost_usd') is None:
            derived = _derived_cost(record)
            if derived is not None:
                record['estimated_cost_usd'] = derived
                record['cost_source'] = 'provider_rates'
        return record

    def selected_for_task(self, task_id):
        """The same row, but only when a model was actually CHOSEN for this task.

        The run path uses this: a row that exists merely because telemetry was
        observed (provider/model empty) must not be passed to the adapter as if
        the user had selected a model.
        """
        record = self.for_task(task_id)
        if not record or not record.get('provider') or not record.get('model'):
            return None
        return record

    # -- observing ----------------------------------------------------------

    def _previous_counter(self, task_id, session_id):
        """Cumulative input of the turn before this one, in the same session."""
        if not session_id:
            return None
        try:
            with self.store.lock:
                row = self.store.connection.execute('''
                    SELECT m.input_tokens FROM hl_conversation_turns t
                    JOIN chat_task_models m ON m.task_id = t.task_id
                    WHERE t.conversation_id = (
                        SELECT conversation_id FROM hl_conversation_turns
                        WHERE task_id = ? ORDER BY id DESC LIMIT 1)
                      AND t.task_id IS NOT NULL AND t.task_id <> ?
                      AND m.session_id = ? AND m.input_tokens IS NOT NULL
                    ORDER BY t.id DESC LIMIT 1''', (task_id, task_id, session_id)).fetchone()
        except Exception:
            # A store without the conversation tables cannot answer the question;
            # that is a missing refinement, not a reason to lose the measurement.
            return None
        return row[0] if row else None

    def _turn_input(self, task_id, session_id, cumulative_input):
        """The input the LAST turn sent — i.e. what the model actually held.

        The runtime's counter is cumulative for the session, so on a resumed
        conversation it is the whole session's spend, not the occupied window (one
        real row reads 2,907,999 input against a 1,048,576 window, which no single
        request can be). Within the same session the last turn is the difference
        from the previous turn; a new session starts from its own counter, so it
        is used as-is.
        """
        if cumulative_input is None:
            return None
        previous = self._previous_counter(task_id, session_id)
        if previous is None:
            return cumulative_input
        delta = cumulative_input - previous
        return delta if delta >= 0 else cumulative_input

    def observe(self, task_id, item):
        """Record what the runtime reports: the model it loaded, and its counters.

        Only explicit numeric runtime values are stored — never a figure derived
        from string length or message count.
        """
        if not isinstance(item, dict):
            return

        def number(*names):
            """The first explicit non-negative integer among `names`."""
            for name in names:
                value = item.get(name)
                if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                    return value
            return None

        reported_model = item.get('model')
        subtype = item.get('subtype')
        # 'init' is the CLI's own line (populated only when --model was passed);
        # 'resolved_model' is the worker reporting what its config selects. The
        # provenance is recorded so a window derived from configuration is never
        # presented as one the runtime reported.
        if subtype in ('init', 'resolved_model') and isinstance(reported_model, str) and reported_model.strip():
            model = reported_model.strip()
            self._write(task_id, model=model, context_window=_window_for(model),
                        model_source='runtime' if subtype == 'init' else 'worker_config')

        # The CLI's OWN session record, which the adapter reads after every turn.
        # It is authoritative for the model, the price, and — via `_usage_anchor` —
        # the size of the last request's prompt, which is the context actually
        # occupied. Recognised by columns only this record has.
        if 'cost_status' in item or 'api_call_count' in item:
            # Its token convention DIFFERS from the stream's: the CLI's
            # `input_tokens` EXCLUDES cache reads, while the stream's `tokens.input`
            # INCLUDES them (verified exactly: stream input == input + cache_read +
            # cache_write). Normalise to the gross figure so the displayed total
            # stays comparable, and keep cache_read in its own column.
            cached = number('cache_read_tokens') or 0
            gross_input = (number('input_tokens') or 0) + cached + (number('cache_write_tokens') or 0)
            if isinstance(reported_model, str) and reported_model.strip():
                model = reported_model.strip()
                self._write(task_id, model=model, context_window=_window_for(model),
                            model_source='runtime')
            actual = item.get('actual_cost_usd')
            if isinstance(actual, (int, float)) and not isinstance(actual, bool) and actual >= 0:
                cost, source = actual, 'provider_actual'
            else:
                estimated = item.get('estimated_cost_usd')
                cost = (estimated if isinstance(estimated, (int, float))
                        and not isinstance(estimated, bool) and estimated >= 0 else None)
                source = str(item.get('cost_source') or '') or None
            session_id = item.get('id') if isinstance(item.get('id'), str) and item.get('id') else None
            self._write(task_id,
                        input_tokens=gross_input or None,
                        output_tokens=number('output_tokens'),
                        cache_read_tokens=cached or None,
                        estimated_cost_usd=cost,
                        cost_source=source,
                        context_anchor_tokens=number('context_anchor_tokens'),
                        api_call_count=number('api_call_count'),
                        session_id=session_id,
                        turn_input_tokens=self._turn_input(task_id, session_id, gross_input or None))
            return

        usage = item.get('usage')
        if not isinstance(usage, dict):
            # The Hermes CLI reports a session's counters as a nested `tokens`
            # object: {input, output, total, cache_read, cache_write}. Reading only
            # flat input_tokens/prompt_tokens keys matched nothing and left every
            # row NULL, so the chat reported token usage as "unavailable".
            tokens = item.get('tokens')
            usage = tokens if isinstance(tokens, dict) else item

        def count(*names):
            for name in names:
                x = usage.get(name)
                if isinstance(x, int) and not isinstance(x, bool) and x >= 0:
                    return x
            return None

        input_tokens = count('input_tokens', 'prompt_tokens', 'input')
        output_tokens = count('output_tokens', 'completion_tokens', 'output')
        cache_read = count('cache_read_tokens', 'cache_read')
        price = usage.get('estimated_cost_usd', item.get('estimated_cost_usd'))
        if not isinstance(price, (int, float)) or isinstance(price, bool) or price < 0:
            price = None
        if input_tokens is None and output_tokens is None and price is None:
            return

        session_id = item.get('session_id')
        if not isinstance(session_id, str) or not session_id:
            session_id = None
        self._write(task_id, input_tokens=input_tokens, output_tokens=output_tokens,
                    cache_read_tokens=cache_read, estimated_cost_usd=price,
                    session_id=session_id,
                    turn_input_tokens=self._turn_input(task_id, session_id, input_tokens))

    @staticmethod
    def balance(provider):
        # OpenRouter credits API is optional. No secret is ever sent to the browser.
        if provider != 'openrouter':
            return {'available': False, 'reason': 'Provider balance API not configured'}
        key = os.environ.get('HERMES_LIFE_OPENROUTER_API_KEY', '')
        if not key:
            return {'available': False, 'reason': 'OpenRouter balance API key not configured'}
        try:
            req = urllib.request.Request('https://openrouter.ai/api/v1/credits',
                                         headers={'Authorization': 'Bearer ' + key,
                                                  'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=5) as response:
                data = json.load(response).get('data', {})
            credits, used = data.get('total_credits'), data.get('total_usage')
            if isinstance(credits, (float, int)) and isinstance(used, (float, int)):
                return {'available': True, 'currency': 'USD',
                        'remaining': round(max(0, credits - used), 6),
                        'source': 'openrouter_credits_api'}
        except Exception:
            pass
        return {'available': False, 'reason': 'Balance could not be verified'}
