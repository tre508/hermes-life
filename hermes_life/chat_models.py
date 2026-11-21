"""HL-CHAT-002: explicitly configured interactive models and evidence-only telemetry.

The model catalogue is intentionally explicit: no presumed access, prices or context limits.
Set HERMES_LIFE_CHAT_MODELS to JSON array of {provider,model,label,context_window?}.
"""
import json
import os
import re
import urllib.request
from datetime import datetime, timezone

_NAME = re.compile(r'^[a-zA-Z0-9_./:+-]{1,160}$')


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
        provider, model = row.get('provider'), row.get('model')
        if not (isinstance(provider, str) and _NAME.fullmatch(provider) and
                isinstance(model, str) and _NAME.fullmatch(model)):
            continue
        window = row.get('context_window')
        if not isinstance(window, int) or isinstance(window, bool) or window <= 0:
            window = None
        out.append({'provider': provider, 'model': model,
                    'label': str(row.get('label') or model)[:120],
                    'context_window': window})
    return out


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
            self.store.connection.commit()

    def catalog(self):
        return _configured()

    def validate(self, provider, model):
        if not provider and not model:
            return None
        match = next((r for r in _configured() if r['provider'] == provider and r['model'] == model), None)
        if not match:
            raise ValueError('Provider/model is not configured for Hermes Life Chat')
        return match

    def save(self, task_id, choice):
        if choice is None:
            return
        with self.store.lock:
            self.store.connection.execute('''INSERT INTO chat_task_models
                (task_id,provider,model,context_window,updated_at) VALUES (?,?,?,?,?)''',
                (task_id, choice['provider'], choice['model'], choice['context_window'],
                 datetime.now(timezone.utc).isoformat()))
            self.store.connection.commit()

    def for_task(self, task_id):
        with self.store.lock:
            row = self.store.connection.execute('SELECT * FROM chat_task_models WHERE task_id=?', (task_id,)).fetchone()
        return dict(row) if row else None

    def observe(self, task_id, item):
        """Only record explicit numeric runtime usage (never estimates derived from string size)."""
        if not isinstance(item, dict):
            return
        usage = item.get('usage')
        if not isinstance(usage, dict):
            usage = item
        def count(*names):
            for name in names:
                x = usage.get(name)
                if isinstance(x, int) and not isinstance(x, bool) and x >= 0:
                    return x
            return None
        input_tokens = count('input_tokens', 'prompt_tokens')
        output_tokens = count('output_tokens', 'completion_tokens')
        price = usage.get('estimated_cost_usd', item.get('estimated_cost_usd'))
        if not isinstance(price, (int, float)) or isinstance(price, bool) or price < 0:
            price = None
        if input_tokens is None and output_tokens is None and price is None:
            return
        with self.store.lock:
            self.store.connection.execute('''UPDATE chat_task_models SET
                input_tokens=COALESCE(?,input_tokens),
                output_tokens=COALESCE(?,output_tokens),
                estimated_cost_usd=COALESCE(?,estimated_cost_usd),
                updated_at=? WHERE task_id=?''',
                (input_tokens, output_tokens, price, datetime.now(timezone.utc).isoformat(), task_id))
            self.store.connection.commit()

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
