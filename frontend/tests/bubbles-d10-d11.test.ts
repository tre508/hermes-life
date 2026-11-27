/**
 * D10 (queue/summarize overflow) + D11 (sensitive-field redaction) — review.md.
 * Categorization is pure; the controller runs headless (same style as bubbles.test.ts).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { categorizeEvent, BubbleController, redactSensitive } from '../src/town-world/bubbles.ts';

describe('D11: sensitive-field redaction', () => {
  test('redacts secret-shaped values in tool targets', () => {
    const out = redactSensitive('deploy --api-key=sk-live-abcdef123456 to prod');
    assert.ok(!out.includes('sk-live-abcdef123456'), 'the value is gone');
    assert.ok(out.includes('api-key=••••'), 'the key label survives');
  });
  test('redacts JSON-shaped and quoted values', () => {
    for (const s of [
      '{"password": "hunter2"}',
      'Authorization: Bearer abc.def.ghi',
      "db.connect(token='xyz123')",
    ]) {
      const out = redactSensitive(s);
      assert.ok(!/hunter2|abc\.def\.ghi|xyz123/.test(out), s + ' is redacted');
    }
  });
  test('leaves ordinary content untouched', () => {
    const s = 'Reading src/main.ts — 42 lines';
    assert.strictEqual(redactSensitive(s), s);
  });
  test('tool_use payloads arrive redacted, not raw', () => {
    const result = categorizeEvent({
      type: 'hermes.tool_use',
      payload: { name: 'terminal', command: 'curl -H "Authorization: Bearer sk-secret-token-1" https://x' },
      task_id: 't1', sequence: 1, timestamp: new Date().toISOString(),
    });
    assert.ok(result);
    const shown = (result!.content.headline || '') + ' ' + (result!.content.toolTarget || '');
    assert.ok(!shown.includes('sk-secret-token-1'), 'the bearer value never reaches a bubble');
  });
});

describe('D10: overflow is queued, not discarded', () => {
  // Distinct tool names — the controller merges same-tool events by design,
  // so only a varied stream exercises the per-resident cap.
  const TOOLS = ['read_file', 'grep', 'write_file', 'ls'];
  function event(n: number) {
    return {
      type: 'hermes.tool_use',
      payload: { name: TOOLS[(n - 1) % TOOLS.length], input: { path: 'file-' + n + '.ts' } },
      task_id: 'task-1', sequence: n, timestamp: new Date().toISOString(),
    };
  }
  test('rapid events summarize on the primary bubble instead of vanishing', () => {
    const c = new BubbleController();
    for (let i = 1; i <= 4; i++) c.processEvent(event(i) as never);
    // One primary bubble, and the queued summary reports the other three.
    const overflow = (c as unknown as { overflow: Map<string, { count: number; samples: string[] }> }).overflow;
    const rec = overflow.get('coordinator');
    assert.ok(rec, 'the overflow record exists');
    assert.strictEqual(rec!.count, 3, 'three events were queued');
    assert.strictEqual(rec!.samples.length, 3, 'samples are kept');
    assert.ok(rec!.samples.some(s => s.includes('file-2')), 'the queued headlines survive');
    // The primary bubble shows the newest file; older ones are in the queue.
    const bubbles = (c as unknown as { bubbles: Map<string, { content: { toolTarget?: string } }[]> }).bubbles;
    assert.strictEqual(bubbles.get('coordinator')!.length, 1);
    assert.ok(bubbles.get('coordinator')![0].content.toolTarget!.includes('file-4'));
    assert.ok(!bubbles.get('coordinator')![0].content.toolTarget!.includes('file-1'));
  });
  test('the queue clears when the resident bubbles drain', () => {
    const c = new BubbleController();
    for (let i = 1; i <= 3; i++) c.processEvent(event(i) as never);
    const overflow = (c as unknown as { overflow: Map<string, { count: number; samples: string[] }> }).overflow;
    assert.ok(overflow.get('coordinator'));
    for (const b of [...(c as unknown as { bubbles: Map<string, { id: string }[]> }).bubbles.get('coordinator') || []]) {
      c.dismissBubble(b.id);
    }
    assert.ok(!overflow.get('coordinator'), 'drained to zero → queue cleared');
  });
});
