"""HL-CHAT-002: the catalogue is the configured defaults plus the provider's live list."""
import json

import pytest

from hermes_life import chat_models
from hermes_life.chat_models import ChatModels

PINNED = '[{"provider":"openrouter","model":"pinned/model","label":"Pinned Model","context_window":1000}]'
LIVE = {'data': [
    {'id': 'a/one', 'name': 'A One', 'context_length': 4096},
    {'id': 'pinned/model', 'name': 'Duplicate Of Pinned', 'context_length': 4096},
    {'id': 'b/two', 'name': 'B Two', 'context_length': 8192},
    {'id': 'bad id!', 'name': 'Unusable id', 'context_length': 1},
    {'id': 'c/three', 'name': 'C Three'},
]}


class _Response:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture(autouse=True)
def clear_cache():
    chat_models._catalogue_cache['rows'] = []
    chat_models._catalogue_cache['fetched_at'] = 0.0
    chat_models._catalogue_cache['pricing'] = {}


def _serve(monkeypatch, payload=LIVE):
    calls = []

    def fake_urlopen(request, timeout=None):
        calls.append(request.full_url)
        return _Response(payload)

    monkeypatch.setattr('urllib.request.urlopen', fake_urlopen)
    return calls


def _offline(monkeypatch):
    def boom(request, timeout=None):
        raise OSError('network down')

    monkeypatch.setattr('urllib.request.urlopen', boom)


def test_catalogue_contains_way_more_than_the_configured_four(monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_CHAT_MODELS', PINNED)
    _serve(monkeypatch)
    rows = ChatModels(store=None).catalog()
    assert len(rows) == 4, 'the live list must actually reach the picker'
    assert rows[0]['model'] == 'pinned/model'


def test_configured_models_stay_pinned_first_with_their_curated_labels(monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_CHAT_MODELS', PINNED)
    _serve(monkeypatch)
    rows = ChatModels(store=None).catalog()
    assert rows[0] == {'provider': 'openrouter', 'model': 'pinned/model',
                       'label': 'Pinned Model', 'context_window': 1000}, \
        'the provider copy must not overwrite the curated label or window'
    assert sum(1 for r in rows if r['model'] == 'pinned/model') == 1, 'de-duplicated'


def test_live_models_follow_pinned_ones_alphabetically(monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_CHAT_MODELS', PINNED)
    _serve(monkeypatch)
    assert [r['model'] for r in ChatModels(store=None).catalog()] == \
        ['pinned/model', 'a/one', 'b/two', 'c/three']


def test_the_provider_id_is_never_trusted_blindly(monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_CHAT_MODELS', '[]')
    _serve(monkeypatch, payload={'data': LIVE['data'] + [
        {'id': '~anthropic/claude-sonnet-latest', 'name': 'Sonnet latest', 'context_length': 1000000},
        {'id': 'evil;rm -rf /', 'name': 'Injection', 'context_length': 1},
        {'id': 'has space', 'name': 'Spaces', 'context_length': 1},
    ]})
    models = [r['model'] for r in ChatModels(store=None).catalog()]
    assert '~anthropic/claude-sonnet-latest' in models, \
        'the provider family aliases are selectable'
    assert not any(m in models for m in ('evil;rm -rf /', 'has space')), \
        'an id that fails the name pattern is dropped'
    assert 'c/three' in models, 'a model without a context_length is still offered'


def test_an_unreachable_provider_degrades_to_the_configured_list(monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_CHAT_MODELS', PINNED)
    _offline(monkeypatch)
    rows = ChatModels(store=None).catalog()
    assert [r['model'] for r in rows] == ['pinned/model'], 'the picker must never empty out'


def test_a_garbled_payload_is_survived(monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_CHAT_MODELS', PINNED)
    _serve(monkeypatch, payload={'unexpected': True})
    assert [r['model'] for r in ChatModels(store=None).catalog()] == ['pinned/model']


def test_the_catalogue_is_cached_rather_than_fetched_per_request(monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_CHAT_MODELS', PINNED)
    calls = _serve(monkeypatch)
    models = ChatModels(store=None)
    models.catalog()
    models.catalog()
    models.validate('openrouter', 'a/one')
    assert len(calls) == 1, f'one fetch per TTL, got {len(calls)}'


def test_validate_accepts_a_live_model_and_still_rejects_nonsense(monkeypatch):
    monkeypatch.setenv('HERMES_LIFE_CHAT_MODELS', PINNED)
    _serve(monkeypatch)
    models = ChatModels(store=None)
    live = models.validate('openrouter', 'b/two')
    assert live is not None, 'a model the provider offers must be submittable'
    assert live['model'] == 'b/two'
    with pytest.raises(ValueError):
        models.validate('openrouter', 'not/a-real-model')
    assert models.validate('', '') is None


# --- observe(): reading the runtime's usage report ---------------------------

import sqlite3
import threading

PINNED_CHOICE = {'provider': 'openrouter', 'model': 'x/y', 'context_window': 1048576}


class _FakeStore:
    def __init__(self):
        self.connection = sqlite3.connect(':memory:')
        # The real Store sets this; without it `dict(row)` raises ValueError and
        # the test fails for a reason that has nothing to do with the code.
        self.connection.row_factory = sqlite3.Row
        self.lock = threading.Lock()


def _models():
    models = ChatModels(_FakeStore())
    models.migrate()
    return models


def _row(models, task_id) -> dict:
    row = models.for_task(task_id)
    assert row is not None, 'the row must exist'
    return row


# Verbatim shape emitted by the Hermes CLI as `hermes.result`, which is what the
# chat never read: the counters are NESTED under `tokens`, not flat.
CLI_RESULT = {'type': 'result', 'session_id': 's-1', 'exit_code': 0, 'text': 'done',
              'tokens': {'input': 2907999, 'output': 11715, 'total': 2919714,
                         'cache_read': 2792192, 'cache_write': 0},
              'duration_ms': 643803, 'timestamp': 1795478221138}


def test_observe_reads_the_cli_nested_tokens_shape():
    models = _models()
    models.save('t1', PINNED_CHOICE)
    models.observe('t1', CLI_RESULT)
    row = _row(models, 't1')
    assert row['input_tokens'] == 2907999, 'the nested `tokens.input` must be read'
    assert row['output_tokens'] == 11715, 'and the nested `tokens.output`'


def test_observe_still_accepts_flat_usage_keys():
    models = _models()
    models.save('t2', PINNED_CHOICE)
    models.observe('t2', {'usage': {'prompt_tokens': 100, 'completion_tokens': 20}})
    row = _row(models, 't2')
    assert (row['input_tokens'], row['output_tokens']) == (100, 20)


def test_observe_records_an_explicit_cost_when_the_runtime_reports_one():
    models = _models()
    models.save('t3', PINNED_CHOICE)
    models.observe('t3', {'usage': {'input_tokens': 10, 'estimated_cost_usd': 0.25}})
    assert _row(models, 't3')['estimated_cost_usd'] == 0.25


def test_observe_ignores_values_it_cannot_trust():
    models = _models()
    models.save('t4', PINNED_CHOICE)
    # booleans are not counts; negatives are not counts; a bare string is not a count
    models.observe('t4', {'tokens': {'input': True, 'output': -5, 'total': '12'}})
    row = _row(models, 't4')
    assert row['input_tokens'] is None and row['output_tokens'] is None, \
        'nothing usable was reported, so nothing may be recorded'
    models.observe('t4', 'not a dict')
    assert _row(models, 't4')['input_tokens'] is None


def test_observe_never_invents_a_cost():
    models = _models()
    models.save('t5', PINNED_CHOICE)
    models.observe('t5', CLI_RESULT)
    assert _row(models, 't5')['estimated_cost_usd'] is None, \
        'the runtime reports no price, so no price may be fabricated'


# --- (1) telemetry for chats with no model choice ----------------------------

import time  # noqa: E402

_SAMPLE_RATES = {'prompt': 0.000003, 'completion': 0.000015,
                 'cache_read': 0.0000003, 'cache_write': 0.00000375}


def _warm_catalogue(model='x/y', window=1000, rates=None):
    """A fresh cache entry, so nothing reaches for the network."""
    chat_models._catalogue_cache['rows'] = [
        {'provider': 'openrouter', 'model': model, 'label': model, 'context_window': window}]
    chat_models._catalogue_cache['fetched_at'] = time.monotonic()
    chat_models._catalogue_cache['pricing'] = {} if rates is None else {model: rates}


def test_observe_creates_a_row_for_a_chat_with_no_model_choice():
    # "Worker default" chats never called save(), so there was no row to update
    # and every field stayed unavailable. Observation now creates it.
    models = _models()
    models.observe('worker-task', CLI_RESULT)
    row = _row(models, 'worker-task')
    assert row['input_tokens'] == 2907999
    assert (row['provider'], row['model']) == ('', ''), \
        'not chosen is recorded as empty rather than inventing a name'


def test_the_runtime_gets_to_name_the_model_it_loaded():
    models = _models()
    _warm_catalogue()
    models.observe('t6', {'subtype': 'init', 'model': 'x/y', 'session_id': 's'})
    row = _row(models, 't6')
    assert row['model'] == 'x/y', 'the init line reports the model actually in use'
    assert row['context_window'] == 1000, 'and the window comes from the catalogue'


def test_an_observed_only_row_is_not_treated_as_a_chosen_model():
    models = _models()
    models.observe('t7', CLI_RESULT)
    assert models.selected_for_task('t7') is None, \
        'the run path must not pass an empty provider/model to the adapter'
    models.save('t7', PINNED_CHOICE)
    assert models.selected_for_task('t7')['model'] == 'x/y'


# --- (3) context means the occupied window, not cumulative spend -------------

def _models_with_conversations():
    models = _models()
    models.store.connection.execute('''CREATE TABLE IF NOT EXISTS hl_conversation_turns (
        id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL, task_id TEXT,
        role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)''')
    models.store.connection.commit()
    return models


def _join_conversation(models, task_id, conversation_id):
    models.store.connection.execute(
        'INSERT INTO hl_conversation_turns (conversation_id,task_id,role,content,created_at)'
        ' VALUES (?,?,?,?,?)', (conversation_id, task_id, 'user', 'x', '2026-01-01T00:00:00+00:00'))
    models.store.connection.commit()


def test_turn_input_is_differenced_within_one_session():
    models = _models_with_conversations()
    _join_conversation(models, 'turn-1', 'conv-1')
    models.observe('turn-1', {'tokens': {'input': 1000, 'output': 10}, 'session_id': 'sess-1'})
    assert _row(models, 'turn-1')['turn_input_tokens'] == 1000, 'first turn is the counter itself'

    _join_conversation(models, 'turn-2', 'conv-1')
    models.observe('turn-2', {'tokens': {'input': 1500, 'output': 20}, 'session_id': 'sess-1'})
    assert _row(models, 'turn-2')['turn_input_tokens'] == 500, \
        'the second turn sent 500 more, which is what it actually held'
    assert _row(models, 'turn-2')['input_tokens'] == 1500, 'cumulative spend is kept separate'


def test_a_new_session_uses_its_own_counter():
    models = _models_with_conversations()
    _join_conversation(models, 'turn-1', 'conv-1')
    models.observe('turn-1', {'tokens': {'input': 1000, 'output': 10}, 'session_id': 'sess-1'})
    _join_conversation(models, 'turn-2', 'conv-1')
    # A fresh session restarts the counter, so subtracting would be nonsense.
    models.observe('turn-2', {'tokens': {'input': 400, 'output': 5}, 'session_id': 'sess-2'})
    assert _row(models, 'turn-2')['turn_input_tokens'] == 400


# --- (4) cost from the provider's published rates ----------------------------

def test_cost_is_derived_from_published_rates():
    models = _models()
    models.save('t8', PINNED_CHOICE)
    models.observe('t8', CLI_RESULT)
    assert _row(models, 't8')['estimated_cost_usd'] is None, 'not stored on observe'

    _warm_catalogue(rates=_SAMPLE_RATES)
    record = models.for_task('t8')
    assert record is not None
    # 115,807 fresh input @3e-6 + 2,792,192 cached @3e-7 + 11,715 output @1.5e-5
    assert record['estimated_cost_usd'] == pytest.approx(1.360804, abs=1e-6)
    assert record['cost_source'] == 'provider_rates', 'and it says where it came from'


def test_cost_is_not_derived_without_published_rates():
    models = _models()
    models.save('t9', PINNED_CHOICE)
    models.observe('t9', CLI_RESULT)
    _warm_catalogue(rates=None)  # provider gave no pricing
    record = models.for_task('t9')
    assert record is not None and record['estimated_cost_usd'] is None
    assert not record.get('cost_source'), 'no number, so no claim about its source'


# --- who names the model, and with what provenance ---------------------------

def test_model_provenance_is_recorded():
    models = _models()
    _warm_catalogue()
    models.observe('p1', {'subtype': 'init', 'model': 'x/y'})
    assert _row(models, 'p1')['model_source'] == 'runtime', \
        'the CLI\'s own init line is a runtime report'
    models.observe('p2', {'subtype': 'resolved_model', 'model': 'x/y'})
    assert _row(models, 'p2')['model_source'] == 'worker_config', \
        'a model read from the worker\'s configuration is not a runtime report'


def test_a_default_model_fills_the_window_but_never_overwrites_a_report():
    models = _models()
    _warm_catalogue(window=4096)
    assert models.attribute_default_model('a1', 'x/y') is True
    row = _row(models, 'a1')
    assert row['context_window'] == 4096 and row['model_source'] == 'worker_config'

    models.observe('a1', {'subtype': 'init', 'model': 'x/y'})
    assert _row(models, 'a1')['model_source'] == 'runtime', 'the runtime report wins'
    assert models.attribute_default_model('a1', 'other/model') is False, \
        'a known model must never be replaced by the configured default'


def test_remote_script_resolves_the_model_only_when_not_overridden():
    from hermes_life.hermes_adapter import remote_script
    # `hermes chat` reports the model in its init line only when it was overridden,
    # so without this the host can never learn which model a default run used.
    plain = remote_script('interactive')
    assert 'config get model.default' in plain, 'the CLI\'s own resolver is the source'
    assert '"subtype":"resolved_model"' in plain
    assert 'resolved_model' in plain and 'hermes chat' in plain, 'the CLI still runs'

    overridden = remote_script('interactive', provider='openrouter', model='z-ai/glm-5.3-flash')
    assert 'config get model.default' not in overridden, \
        'a chosen model is already reported by the CLI, so no probe is needed'
    assert '--model' in overridden and '--provider' in overridden


def test_the_resolved_model_line_is_admitted_by_the_reader():
    # The synthetic line the worker prints must be exactly what observe() accepts.
    import json
    models = _models()
    _warm_catalogue(window=131072)
    line = '{"type":"system","subtype":"resolved_model","model":"x/y"}'
    assert ' ' not in line and '"' in line, 'a bare model id needs no JSON escaping'
    models.observe('r1', json.loads(line))
    row = _row(models, 'r1')
    assert row['model'] == 'x/y' and row['context_window'] == 131072

# --- the CLI's own session record, which is authoritative ---------------------

SESSION_ROW = {'id': 'local-abc123', 'model': 'x/y', 'billing_provider': 'openrouter',
               'input_tokens': 115807, 'output_tokens': 11715,
               'cache_read_tokens': 2792192, 'cache_write_tokens': 0,
               'reasoning_tokens': 5452, 'estimated_cost_usd': 0.10699431,
               'actual_cost_usd': None, 'cost_status': 'estimated',
               'cost_source': 'provider_models_api', 'api_call_count': 69,
               'message_count': 140, 'context_anchor_tokens': 59531}


def test_the_session_record_supplies_the_context_anchor_and_the_cli_price():
    models = _models()
    _warm_catalogue(window=1048576)
    models.observe('s1', SESSION_ROW)
    row = _row(models, 's1')
    assert row['context_anchor_tokens'] == 59531, "the LAST request's prompt size"
    assert row['api_call_count'] == 69
    assert row['estimated_cost_usd'] == pytest.approx(0.10699431)
    assert row['cost_source'] == 'provider_models_api', "the CLI's own provenance"
    assert row['model'] == 'x/y' and row['context_window'] == 1048576
    assert row['session_id'] == 'local-abc123'


def test_the_two_token_conventions_are_normalised():
    # The CLI's input_tokens EXCLUDE cache reads; the stream's tokens.input INCLUDE
    # them (verified exactly: stream input == input + cache_read + cache_write).
    # Storing both the same way is what keeps the displayed total comparable.
    models = _models()
    _warm_catalogue(window=1048576)
    models.observe('s2', SESSION_ROW)
    row = _row(models, 's2')
    assert row['input_tokens'] == 115807 + 2792192 + 0, 'stored gross, as the stream reports'
    assert row['cache_read_tokens'] == 2792192, 'with the cached part kept apart'


def test_the_cli_price_beats_a_host_side_derivation():
    models = _models()
    _warm_catalogue(rates=_SAMPLE_RATES)  # host rates ARE available...
    models.observe('s3', SESSION_ROW)     # ...but the CLI has already priced it
    record = models.for_task('s3')
    assert record is not None
    assert record['cost_source'] == 'provider_models_api'
    assert record['estimated_cost_usd'] == pytest.approx(0.10699431)


def test_an_actual_cost_beats_an_estimate():
    models = _models()
    _warm_catalogue()
    models.observe('s4', dict(SESSION_ROW, actual_cost_usd=0.42))
    row = _row(models, 's4')
    assert row['estimated_cost_usd'] == pytest.approx(0.42)
    assert row['cost_source'] == 'provider_actual'


def test_the_session_probe_is_read_only_and_binds_its_id():
    from hermes_life.hermes_adapter import WORKER_SESSION_SCRIPT, _SESSION_ID
    assert 'mode=ro' in WORKER_SESSION_SCRIPT, 'never write to the worker session store'
    assert 'WHERE id=?' in WORKER_SESSION_SCRIPT, 'a bound parameter, not interpolation'
    assert _SESSION_ID.match('local-407ba5bdc9b513a7dd4f9e040418b831ba824807139b31828cf51a2298c74cf3')
    for bad in ('bad;rm -rf /', '', 'a b', "x' OR 1=1--"):
        assert not _SESSION_ID.match(bad), f'{bad!r} must be refused'


def test_migrate_adds_the_new_columns_to_an_older_table():
    store = _FakeStore()
    store.connection.execute('''CREATE TABLE chat_task_models (
        task_id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL,
        context_window INTEGER, input_tokens INTEGER, output_tokens INTEGER,
        estimated_cost_usd REAL, updated_at TEXT NOT NULL)''')
    store.connection.execute(
        "INSERT INTO chat_task_models (task_id,provider,model,updated_at) VALUES ('old','p','m','t')")
    store.connection.commit()

    ChatModels(store).migrate()  # the existing row must survive the ALTERs

    columns = {row[0] for row in store.connection.execute(
        "SELECT name FROM pragma_table_info('chat_task_models')")}
    assert {'session_id', 'cache_read_tokens', 'turn_input_tokens'} <= columns
    assert store.connection.execute(
        "SELECT COUNT(*) FROM chat_task_models WHERE task_id='old'").fetchone()[0] == 1
