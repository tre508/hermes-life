"""HL-VERIFY-001 part A: criteria become explicit checks, and are never weakened.

Criteria text is stored verbatim; the compiler only produces checks. An invalid or
unavailable compiler leaves criteria with no checks, which can only ever be reported
'unverified' — a plan is never blocked or silently softened by compilation.
"""
import json

from fastapi.testclient import TestClient

from hermes_life.app import create_app
from hermes_life.verification import clean_checks

CRITERIA = [
    'The candidate contains tests/test_main.py and pytest passes in it.',
    'A read of main.py is recorded showing the print statement.',
    'The report JSON carries the summary and evidence keys.',
]

REPORT = {
    'summary': 'Add an automated test suite for the candidate project.',
    'steps': ['Add tests/test_main.py covering the script output'],
    'acceptance_criteria': CRITERIA,
    'test_approach': {'baseline_command': 'pytest -q', 'candidate_command': 'pytest -q'},
}


class Compiler:
    transport = 'ssh'

    def __init__(self, value=None, fail=False):
        self.value, self.fail, self.prompts = value, fail, []

    def available(self):
        return True

    def run(self, prompt, callback, task_id=None):
        self.prompts.append(prompt)
        if self.fail:
            raise RuntimeError('compiler unavailable')
        return {'result': json.dumps(self.value), 'session_id': 'criteria'}

    def cancel(self, task_id):
        return True


def seeded_app(tmp_path, report=None):
    app = create_app(tmp_path / 'verify.db')
    store = app.state.runtime.store
    # create_app defers DDL to the lifespan; seed against a migrated database instead.
    from hermes_life.schema import migrate
    migrate(store.connection)
    with store.lock:
        con = store.connection
        con.execute("INSERT INTO investigation_plans(id,formulation_id,task_id,report,state,created_at,approved_at)"
                    " VALUES ('plan','form','task',?,'approved','now','now')",
                    (json.dumps(report or REPORT),))
        con.commit()
    return app


COMPILED = {
    'deliverable_class': 'code_change',
    'checks': [
        {'ordinal': 1, 'kind': 'pytest', 'root': 'candidate',
         'expect': 'pytest exits 0', 'evidence_required': 'command, exit code and output'},
        {'ordinal': 2, 'kind': 'file_read', 'root': 'candidate', 'path': 'main.py',
         'expect': 'file is readable', 'evidence_required': 'file contents and sha256'},
        {'ordinal': 3, 'kind': 'json_object', 'root': 'candidate', 'path': 'report.json',
         'keys': ['summary', 'evidence'], 'expect': 'both keys present',
         'evidence_required': 'observed key list'},
    ],
}


def test_criteria_compile_into_checks_and_keep_their_text(tmp_path):
    app = seeded_app(tmp_path)
    compiler = Compiler(COMPILED)
    app.state.runtime.adapters['read_only'] = compiler
    result = app.state.verifier.compile_criteria('plan')
    assert compiler.prompts and 'convert acceptance criteria into checks' in compiler.prompts[0]
    assert result['deliverable_class'] == 'code_change'
    assert [c['criterion_text'] for c in result['criteria']] == CRITERIA
    assert [c['method'] for c in result['criteria']] == ['pytest', 'file_read', 'json_object']
    assert all(c['auto_verifiable'] == 1 for c in result['criteria'])
    assert [c['checks'][0]['kind'] for c in result['criteria']] == ['pytest', 'file_read', 'json_object']
    assert result['criteria'][2]['checks'][0]['keys'] == ['summary', 'evidence']


def test_compiler_omission_leaves_the_criterion_unverified_not_weakened(tmp_path):
    app = seeded_app(tmp_path)
    partial = {'deliverable_class': 'evidence_report',
               'checks': [{'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'}]}
    app.state.runtime.adapters['read_only'] = Compiler(partial)
    result = app.state.verifier.compile_criteria('plan')
    assert result['deliverable_class'] == 'evidence_report'
    assert len(result['criteria']) == 3, 'omitted criteria must still be recorded verbatim'
    assert result['criteria'][0]['auto_verifiable'] == 1
    assert result['criteria'][1]['auto_verifiable'] == 0 and result['criteria'][1]['checks'] == []
    assert result['criteria'][1]['criterion_text'] == CRITERIA[1]


def test_unavailable_compiler_records_compiled_criteria_without_checks(tmp_path):
    app = seeded_app(tmp_path)
    app.state.runtime.adapters['read_only'] = Compiler(fail=True)
    result = app.state.verifier.compile_criteria('plan')
    assert len(result['criteria']) == 3
    assert all(c['auto_verifiable'] == 0 and c['checks'] == [] for c in result['criteria'])
    assert 'compiler unavailable' in (result['compiler_note'] or '')


def test_interpretive_checks_are_kept_but_never_count_as_automatic():
    checks, dropped = clean_checks([
        {'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'},
        {'ordinal': 2, 'kind': 'interpretive'},
        {'ordinal': 2, 'kind': 'interpretive', 'root': None},
    ], criterion_count=2)
    assert [c['kind'] for c in checks] == ['pytest', 'interpretive', 'interpretive']
    assert dropped == []


def test_auto_verifiable_counts_only_executable_checks(tmp_path):
    app = seeded_app(tmp_path)
    app.state.runtime.adapters['read_only'] = Compiler({
        'deliverable_class': 'evidence_report',
        'checks': [{'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'},
                   {'ordinal': 2, 'kind': 'interpretive'},
                   {'ordinal': 3, 'kind': 'json_object', 'root': 'candidate', 'path': 'report.json',
                    'keys': ['summary']}]})
    result = app.state.verifier.compile_criteria('plan')
    assert [c['auto_verifiable'] for c in result['criteria']] == [1, 0, 1]
    assert [c['method'] for c in result['criteria']] == ['pytest', 'interpretive', 'json_object']
    assert app.state.verifier.summary('plan')['auto_verifiable'] == 2


def test_irrelevant_fields_do_not_discard_a_usable_check():
    """Compilers are noisy: junk parameters must not cost a valid check."""
    checks, dropped = clean_checks([
        {'ordinal': 1, 'kind': 'pytest', 'root': 'candidate', 'path': [], 'table': 'x'},
        {'ordinal': 2, 'kind': 'file_contains', 'root': 'candidate', 'path': 'main.py',
         'needle': 'TODO', 'table': 7},
        {'ordinal': 3, 'kind': 'search', 'root': 'candidate', 'needle': 'TODO', 'path': 'nope'},
        {'ordinal': 4, 'kind': 'file_contains', 'root': 'candidate', 'path': '', 'needle': 'TODO'},
    ], criterion_count=4)
    assert [c['kind'] for c in checks] == ['pytest', 'file_contains', 'search']
    assert checks[0] == {'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'}
    assert 'table' not in checks[1] and checks[1]['needle'] == 'TODO'
    assert 'path' not in checks[2]
    assert dropped == ['invalid path for kind file_contains']


def test_invalid_checks_are_dropped_not_executed():
    checks, dropped = clean_checks([
        {'ordinal': 1, 'kind': 'shell', 'root': 'candidate', 'path': 'x'},
        {'ordinal': 1, 'kind': 'pytest', 'root': '/etc'},
        {'ordinal': 99, 'kind': 'pytest', 'root': 'candidate'},
        {'ordinal': 1, 'kind': 'file_contains', 'root': 'candidate', 'path': 'main.py'},
        {'ordinal': 1, 'kind': 'pytest', 'root': 'candidate'},
    ], criterion_count=2)
    assert [c['kind'] for c in checks] == ['pytest']
    assert len(dropped) == 4
    assert any('unsupported kind' in d for d in dropped)
    assert any('root' in d for d in dropped)
    assert any('ordinal out of range' in d for d in dropped)
    assert any('missing needle' in d for d in dropped)


def test_criteria_routes_expose_and_recompile(tmp_path):
    app = seeded_app(tmp_path)
    compiler = Compiler(COMPILED)
    app.state.runtime.adapters['read_only'] = compiler
    with TestClient(app) as client:
        assert client.post('/api/investigation-plans/plan/compile-criteria').status_code == 201
        listed = client.get('/api/investigation-plans/plan/criteria').json()
        assert listed['deliverable_class'] == 'code_change'
        assert len(listed['criteria']) == 3
        # The plan list annotates what will be verified, for the Planning tab.
        row = next(p for p in client.get('/api/investigation-plans').json() if p['id'] == 'plan')
        assert row['criteria'] == 3 and row['auto_verifiable'] == 3
        assert row['deliverable_class'] == 'code_change'
        assert client.get('/api/investigation-plans/missing/criteria').status_code == 404