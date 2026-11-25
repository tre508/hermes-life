/**
 * Chat audit §15 — tool activity must read like the Hermes CLI, not like the
 * event wire format. These are the pure helpers the transcript renders through.
 *
 * Typography contract (user-approved): the tool NAME is a pill (`a.name`),
 * the statement is machine mono (`a.text`) — the verb lives in the pill, the
 * locator/command in the statement. Reasoning prose is a different voice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolAction, resultSummary, hasMoreDetail, formatDuration, parseArgs, humanise } from '../src/trace-format.ts';

test('a terminal call renders as the command, not as its JSON envelope', () => {
    const a = toolAction('terminal', { command: 'cd /home/gayzer/Apps/hermes-life && grep -rn "chat_task_models" hermes_life/ | head -20' });
    assert.equal(a.icon, '$');
    assert.equal(a.name, 'terminal');
    assert.equal(a.text, 'cd /home/gayzer/Apps/hermes-life && grep -rn "chat_task_models" hermes_life/ | head -20');
    assert.ok(!a.text.includes('{'), 'no JSON braces may survive');
});

test('arguments given as a JSON string are still understood', () => {
    const a = toolAction('read_file', '{"limit":70,"path":"/home/gayzer/Apps/hermes-life/hermes_life/chat_models.py"}');
    assert.equal(a.name, 'read file');
    assert.equal(a.text, '/home/gayzer/Apps/hermes-life/hermes_life/chat_models.py (first 70 lines)');
});

test('file, search and web tools carry the verb in the pill and the locator in the statement', () => {
    const read = toolAction('read_file', { path: 'src/a.ts' });
    assert.equal(read.name, 'read file');
    assert.equal(read.text, 'src/a.ts');

    const write = toolAction('write_file', { path: 'src/b.ts' });
    assert.equal(write.name, 'write file');
    assert.equal(write.text, 'src/b.ts');

    const edit = toolAction('patch', { file_path: 'src/c.ts' });
    assert.equal(edit.name, 'edit file');
    assert.equal(edit.text, 'src/c.ts');

    const grep = toolAction('grep', { pattern: 'create table', path: 'hermes_life/' });
    assert.equal(grep.name, 'search files');
    assert.equal(grep.text, '"create table" in hermes_life/');

    const search = toolAction('search_files', { pattern: 'TODO' });
    assert.equal(search.name, 'search files');
    assert.equal(search.text, '"TODO"');

    const web = toolAction('web_search', { query: 'sqlite no such table' });
    assert.equal(web.name, 'web search');
    assert.equal(web.text, '"sqlite no such table"');

    const fetch = toolAction('web_extract', { urls: ['https://example.com/x'] });
    assert.equal(fetch.name, 'fetch page');
    assert.equal(fetch.text, 'https://example.com/x');
});

test('an unmapped tool degrades to English, never to raw JSON', () => {
    const a = toolAction('some_new_tool', { path: '/tmp/thing' });
    assert.equal(a.name, 'some new tool');
    assert.equal(a.text, '/tmp/thing');
    assert.ok(!/[{}"]/.test(a.text), 'must not leak the payload');
    assert.equal(humanise('todo_list'), 'todo list');
});

test('action lines are single-line and bounded', () => {
    const long = toolAction('terminal', { command: 'x'.repeat(400) });
    assert.ok(!long.text.includes('\n'));
    assert.ok(long.text.length <= 160, `bounded, got ${long.text.length}`);
});

test('resultSummary leads with the informative line and flags failures', () => {
    const traceback = 'state: failed\nerror: no such table: chat_task_models\nresults: []\nTraceback (most recent call last):';
    const s = resultSummary(traceback);
    assert.match(s, /^failed · state: failed/);
    assert.match(s, /4 lines$/);

    assert.equal(resultSummary(''), 'no output');
    assert.equal(resultSummary('   \n  \n'), 'no output');
    assert.equal(resultSummary('one line only'), 'one line only');
    assert.equal(resultSummary('error: no such table: t'), 'failed · error: no such table: t',
        'a result that LEADS with an error is a failure');
});

test('a result that merely MENTIONS an error is not a failure', () => {
    // Search results discussing errors must read as results, not as failures.
    const web = '1. SQLite no such table — Stack Overflow\n2. sqlite3.OperationalError docs';
    assert.equal(resultSummary(web), '1. SQLite no such table — Stack Overflow · 2 lines');
});

test('hasMoreDetail is true only when a disclosure is worth showing', () => {
    assert.equal(hasMoreDetail('ok'), false);
    assert.equal(hasMoreDetail('a\nb'), true);
    assert.equal(hasMoreDetail('x'.repeat(400)), true);
});

test('durations read the way a person writes them', () => {
    assert.equal(formatDuration(420), '420ms');
    assert.equal(formatDuration(500), '500ms');
    assert.equal(formatDuration(1000), '1.0s');
    assert.equal(formatDuration(1240), '1.2s');
    assert.equal(formatDuration(65000), '1m 5s');
    assert.equal(formatDuration(-1), '');
    assert.equal(formatDuration(NaN), '');
});

test('parseArgs tolerates every shape a payload arrives in', () => {
    assert.deepEqual(parseArgs({ a: 1 }), { a: 1 });
    assert.deepEqual(parseArgs('{"a":1}'), { a: 1 });
    assert.equal(parseArgs('not json'), null);
    assert.equal(parseArgs(null), null);
    assert.equal(parseArgs([1, 2]), null);
});
