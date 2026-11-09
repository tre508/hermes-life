/**
 * UI-VIS-007 §8 — Tool activity grouping tests.
 *
 * Pure functions with deterministic shapes; run under node:test without
 * a DOM (groups render happens browser-side; here we lock down the
 * adapter that turns a long raw event stream into collapsed cards).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { categoriseTool, groupToolActivity, CATEGORY_LABEL } from '../src/tool-group.ts';

describe('Tool activity categorisation', () => {
  test('read-like tools land in: read', () => {
    for (const name of ['read_file', 'cat', 'grep', 'ls', 'find', 'glob', 'browse', 'search']) {
      assert.strictEqual(categoriseTool(name), 'read', `${name} should be read`);
    }
  });
  test('edit-like tools land in: edit', () => {
    for (const name of ['write_file', 'edit', 'patch', 'apply']) {
      assert.strictEqual(categoriseTool(name), 'edit', `${name} should be edit`);
    }
  });
  test('shell-like tools land in: shell', () => {
    for (const name of ['terminal', 'bash', 'exec', 'cmd', 'run']) {
      assert.strictEqual(categoriseTool(name), 'shell');
    }
  });
  test('test-like tools land in: test', () => {
    for (const name of ['pytest', 'test', 'verify', 'lint', 'check']) {
      assert.strictEqual(categoriseTool(name), 'test');
    }
  });
  test('memory-like tools land in: memory', () => {
    for (const name of ['memory', 'recall', 'archive', 'reflect', 'vault']) {
      assert.strictEqual(categoriseTool(name), 'memory');
    }
  });
  test('web-like tools land in: web', () => {
    for (const name of ['web_search', 'fetch_url', 'arxiv', 'http']) {
      assert.strictEqual(categoriseTool(name), 'web');
    }
  });
  test('unknown tools stay in: other (never invented)', () => {
    assert.strictEqual(categoriseTool(''), 'other');
    assert.strictEqual(categoriseTool('mysterious_tool'), 'other');
  });
});

describe('Tool activity grouping — pairing and bucketing', () => {
  test('uses tool_call_id to pair tool_use with tool_result', () => {
    const result = groupToolActivity([
      { sequence: 1, type: 'hermes.tool_use', payload: { name: 'read_file', tool_call_id: 'tc-1', input: { path: 'main.ts' } }, task_id: 't1', timestamp: '2026-11-09T10:00:00.000Z' },
      { sequence: 2, type: 'hermes.tool_result', payload: { name: 'read_file', tool_call_id: 'tc-1', output: 'main file body' }, task_id: 't1', timestamp: '2026-11-09T10:00:01.000Z' },
    ], 't1');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].category, 'read');
    assert.strictEqual(result[0].callCount, 1);
    assert.strictEqual(result[0].runs[0].status, 'completed');
    assert.strictEqual(result[0].runs[0].target, '{"path":"main.ts"}');
    assert.match(result[0].runs[0].summary!, /main file body/);
  });

  test('failed tool_result sets status=failed with the error message', () => {
    const result = groupToolActivity([
      { sequence: 1, type: 'hermes.tool_use', payload: { name: 'write_file', tool_call_id: 'tc-x', input: { path: 'x.ts' } }, task_id: 't1', timestamp: '2026-11-09T10:00:00Z' },
      { sequence: 2, type: 'hermes.tool_result', payload: { name: 'write_file', tool_call_id: 'tc-x', is_error: true, error: 'permission denied' }, task_id: 't1', timestamp: '2026-11-09T10:00:01Z' },
    ], 't1');
    assert.strictEqual(result[0].runs[0].status, 'failed');
    assert.match(result[0].runs[0].summary!, /Error: permission denied/);
  });

  test('tool_use without a matching result stays pending (group status running)', () => {
    const result = groupToolActivity([
      { sequence: 1, type: 'hermes.tool_use', payload: { name: 'terminal', tool_call_id: 'tc-z', input: { command: 'ls' } }, task_id: 't1', timestamp: '2026-11-09T10:00:00Z' },
    ], 't1');
    assert.strictEqual(result[0].runs[0].status, 'pending');
    assert.strictEqual(result[0].status, 'pending');
  });

  test('events for a different task_id are filtered out', () => {
    const result = groupToolActivity([
      { sequence: 1, type: 'hermes.tool_use', payload: { name: 'read_file', tool_call_id: 'tc-a', input: { path: 'main.ts' } }, task_id: 't-other', timestamp: '2026-11-09T10:00:00Z' },
      { sequence: 2, type: 'hermes.tool_use', payload: { name: 'read_file', tool_call_id: 'tc-b', input: { path: 'index.ts' } }, task_id: 't1', timestamp: '2026-11-09T10:00:01Z' },
    ], 't1');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].callCount, 1);
    assert.strictEqual(result[0].runs[0].target, '{"path":"index.ts"}');
  });

  test('non-tool events are ignored entirely', () => {
    const result = groupToolActivity([
      { sequence: 1, type: 'hermes.text', payload: { text: 'hmm' }, task_id: 't1', timestamp: '2026-11-09T10:00:00Z' },
      { sequence: 2, type: 'task.started', payload: {}, task_id: 't1', timestamp: '2026-11-09T10:00:01Z' },
      { sequence: 3, type: 'hermes.tool_use', payload: { name: 'read_file', tool_call_id: 'tc-1', input: { path: 'a' } }, task_id: 't1', timestamp: '2026-11-09T10:00:02Z' },
    ], 't1');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].callCount, 1);
  });

  test('mixed category calls split into separate groups by category', () => {
    const result = groupToolActivity([
      { sequence: 1, type: 'hermes.tool_use', payload: { name: 'read_file', tool_call_id: 'tc-1', input: { path: 'a.ts' } }, task_id: 't1', timestamp: '2026-01-01T00:00:00Z' },
      { sequence: 2, type: 'hermes.tool_use', payload: { name: 'write_file', tool_call_id: 'tc-2', input: { path: 'a.ts', content: 'x' } }, task_id: 't1', timestamp: '2026-01-01T00:00:01Z' },
      { sequence: 3, type: 'hermes.tool_use', payload: { name: 'pytest', tool_call_id: 'tc-3', input: { args: ['tests/'] } }, task_id: 't1', timestamp: '2026-01-01T00:00:02Z' },
      { sequence: 4, type: 'hermes.tool_result', payload: { name: 'pytest', tool_call_id: 'tc-3', output: 'OK' }, task_id: 't1', timestamp: '2026-01-01T00:00:03Z' },
    ], 't1');
    const cares = result.map(g => g.category);
    assert.deepStrictEqual(cares, ['read', 'edit', 'test']);
    assert.strictEqual(result.find(g => g.category === 'test')!.runs[0].status, 'completed');
    assert.strictEqual(result.find(g => g.category === 'read')!.runs[0].status, 'pending');
  });

  test('group status collapses to worst across runs (pending > failed > completed)', () => {
    const result = groupToolActivity([
      { sequence: 1, type: 'hermes.tool_use', payload: { name: 'terminal', tool_call_id: 'tc-1', input: { command: 'a' } }, task_id: 't1', timestamp: '2026-01-01T00:00:00Z' },
      { sequence: 2, type: 'hermes.tool_use', payload: { name: 'terminal', tool_call_id: 'tc-2', input: { command: 'b' } }, task_id: 't1', timestamp: '2026-01-01T00:00:01Z' },
      { sequence: 3, type: 'hermes.tool_use', payload: { name: 'terminal', tool_call_id: 'tc-3', input: { command: 'c' } }, task_id: 't1', timestamp: '2026-01-01T00:00:02Z' },
      { sequence: 4, type: 'hermes.tool_result', payload: { name: 'terminal', tool_call_id: 'tc-2', is_error: true, error: 'fail' }, task_id: 't1', timestamp: '2026-01-01T00:00:03Z' },
      { sequence: 5, type: 'hermes.tool_result', payload: { name: 'terminal', tool_call_id: 'tc-1', output: 'OK' }, task_id: 't1', timestamp: '2026-01-01T00:00:04Z' },
    ], 't1');
    // A still-pending run pulls group status to "pending".
    assert.strictEqual(result[0].status, 'pending');
  });

  test('label uses singular "operation" vs plural correctly', () => {
    assert.match(CATEGORY_LABEL.read, /^Reading files$/);
    const one = groupToolActivity([
      { sequence: 1, type: 'hermes.tool_use', payload: { name: 'read_file', tool_call_id: 'tc-1', input: { path: 'a' } }, task_id: 't1', timestamp: '2026-01-01T00:00:00Z' },
    ], 't1');
    assert.strictEqual(one[0].callCount, 1);
    assert.strictEqual(one[0].category, 'read');
    const two = groupToolActivity([
      { sequence: 1, type: 'hermes.tool_use', payload: { name: 'read_file', tool_call_id: 'tc-1', input: { path: 'a' } }, task_id: 't1', timestamp: '2026-01-01T00:00:00Z' },
      { sequence: 2, type: 'hermes.tool_use', payload: { name: 'read_file', tool_call_id: 'tc-2', input: { path: 'b' } }, task_id: 't1', timestamp: '2026-01-01T00:00:01Z' },
    ], 't1');
    assert.strictEqual(two[0].callCount, 2);
  });

  test('runs inside a group are sorted chronologically by sequence', () => {
    const result = groupToolActivity([
      { sequence: 30, type: 'hermes.tool_use', payload: { name: 'terminal', tool_call_id: 'tc-30', input: { command: 'b' } }, task_id: 't1', timestamp: '2026-01-01T00:00:01Z' },
      { sequence: 10, type: 'hermes.tool_use', payload: { name: 'terminal', tool_call_id: 'tc-10', input: { command: 'a' } }, task_id: 't1', timestamp: '2026-01-01T00:00:00Z' },
      { sequence: 20, type: 'hermes.tool_use', payload: { name: 'terminal', tool_call_id: 'tc-20', input: { command: 'c' } }, task_id: 't1', timestamp: '2026-01-01T00:00:02Z' },
    ], 't1');
    const seqs = result[0].runs.map(r => r.sequence);
    assert.deepStrictEqual(seqs, [10, 20, 30]);
  });

  test('empty input returns an empty group list (never crashes)', () => {
    assert.deepStrictEqual(groupToolActivity([], 't1'), []);
    assert.deepStrictEqual(groupToolActivity([
      { sequence: 1, type: 'task.started', payload: {}, task_id: 't1', timestamp: '2026-01-01T00:00:00Z' },
    ], 't1'), []);
  });
});
