/**
 * Hardening regressions from the liveagent.md bubble-layer audit:
 *   HA-015 — redactSensitive leaked HTTP-Basic credentials and multi-word
 *            value tails (P2, security)
 *   HA-016 — concurrent same-tool calls collapsed into one bubble and lost
 *            tool_call_id correlation (P2)
 *   HA-033 — viewport clamps used stale constants and overlap nudges could
 *            push bodies past the overlay top (P3)
 *   HA-034 — hover only glowed; the spec says hover OR click exposes the
 *            details (P3)
 *
 * Headless like bubbles-d10-d11.test.ts: categorization is pure, the
 * controller's state paths run without a DOM, and the clamp/overlap geometry
 * is exported pure. DOM rendering itself stays under browser verification.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  BubbleController,
  categorizeEvent,
  clampAnchorTop,
  mergeContent,
  planOverlapAdjustments,
  redactSensitive,
} from '../src/town-world/bubbles.ts';

// ---------------------------------------------------------------------------
// HA-015 — scheme credentials and multi-word values redact to a safe boundary
// ---------------------------------------------------------------------------

describe('HA-015: redaction covers Basic credentials and multi-word values', () => {
  test('probe: Basic credentials redact, the scheme label and structure survive', () => {
    // A 12-char HTTP-Basic credential, assembled so no secret-shaped literal
    // is embedded in this file.
    const cred = Buffer.from('user:pass').toString('base64');
    assert.strictEqual(cred.length, 12);
    const out = redactSensitive(`Authorization: Basic ${cred}`);
    assert.ok(!out.includes(cred), 'the credential is gone');
    assert.ok(out.includes('Basic ••••'), 'the scheme label survives');
    // Redaction changes VALUES, not structure: the surrounding text is verbatim.
    assert.strictEqual(out, 'Authorization: Basic ••••');
  });

  test('probe: multi-word values redact the whole token run, not just the first word', () => {
    const out = redactSensitive('password=hello world and more');
    assert.ok(!out.includes('hello world and more'), 'the tail is gone');
    assert.strictEqual(out, 'password=••••', 'the key label survives');
  });

  test('existing Bearer and JSON shapes stay redacted (pinned in bubbles-d10-d11)', () => {
    for (const s of [
      '{"password": "***"}',
      "db.connect(token='xyz123')",
      'Authorization: Bearer ***',
    ]) {
      const out = redactSensitive(s);
      assert.ok(!/hunter2|xyz123/.test(out), s + ' is redacted');
    }
    assert.ok(redactSensitive('Authorization: Bearer ***').includes('Bearer ••••'),
      'standalone Bearer values still redact');
    const cli = redactSensitive('deploy --api-key=«redacted:sk-…» to prod');
    assert.ok(cli.includes('api-key=••••'), 'the key label survives');
    assert.ok(!cli.includes('«redacted:sk-…»'), 'the value is gone');
  });

  test('tool_use payloads never carry a Basic credential or value tail into a bubble', () => {
    const result = categorizeEvent({
      type: 'hermes.tool_use',
      payload: {
        name: 'terminal',
        command: 'curl -H "Authorization: Basic ***" https://x',
        input: { command: 'curl --password=*** world and more' },
      },
      task_id: 't1',
      sequence: 1,
      timestamp: new Date().toISOString(),
    });
    assert.ok(result);
    const shown = [result!.content.headline, result!.content.toolTarget, result!.content.details]
      .filter(Boolean).join(' ');
    assert.ok(!shown.includes('dXNlcjpwYXNz'), 'the credential never reaches a bubble');
    assert.ok(!shown.includes('hello world and more'), 'the multi-word tail never reaches a bubble');
    assert.ok(shown.includes('Basic ••••') && shown.includes('password=••••'),
      'the key/scheme labels survive for orientation');
  });
});

// ---------------------------------------------------------------------------
// HA-016 — concurrent same-tool calls stay distinct and correlate by id
// ---------------------------------------------------------------------------

describe('HA-016: concurrent same-tool calls keep their own bubbles and ids', () => {
  const toolUse = (id: string, path: string, sequence: number) => ({
    type: 'hermes.tool_use',
    payload: { name: 'read_file', tool_call_id: id, input: { path } },
    task_id: 't1', sequence, timestamp: new Date().toISOString(),
  });
  const toolResult = (id: string, output: string, sequence: number) => ({
    type: 'hermes.tool_result',
    payload: { name: 'read_file', tool_call_id: id, output },
    task_id: 't1', sequence, timestamp: new Date().toISOString(),
  });

  test('interleaved two-call regression: distinct ids never collapse, results land on their own call', () => {
    const c = new BubbleController({ maxPerResident: 2 });
    c.processEvent(toolUse('tc-A', 'a.ts', 1) as never);
    c.processEvent(toolUse('tc-B', 'b.ts', 2) as never);

    let bubbles = c.getBubbles();
    assert.strictEqual(bubbles.length, 2, 'two tool_use ids → two bubbles');
    assert.deepStrictEqual(
      new Set(bubbles.map(b => b.content.id)),
      new Set(['tc-A', 'tc-B']),
    );

    // Out-of-order completion must still correlate call ↔ result.
    c.processEvent(toolResult('tc-B', 'content-B', 3) as never);
    c.processEvent(toolResult('tc-A', 'content-A', 4) as never);

    bubbles = c.getBubbles();
    assert.strictEqual(bubbles.length, 2, 'results merge, they do not stack');
    const a = bubbles.find(b => b.content.id === 'tc-A')!;
    const b = bubbles.find(b => b.content.id === 'tc-B')!;
    for (const [mine, other, label] of [[a, b, 'A'], [b, a, 'B']] as const) {
      assert.strictEqual(mine.content.status, 'completed', `call ${label} completed`);
      assert.strictEqual(mine.content.id, label === 'A' ? 'tc-A' : 'tc-B', `call ${label} keeps its anchor id`);
      assert.ok(mine.content.details!.includes(`content-${label}`), `result ${label} on call ${label}`);
      assert.ok(!mine.content.details!.includes(`content-${label === 'A' ? 'B' : 'A'}`),
        `no cross-talk into call ${label}`);
    }
    // The merge preserves the original call context (pinned merge semantics).
    assert.strictEqual(a.content.headline, 'Reading a.ts');
    assert.strictEqual(b.content.headline, 'Reading b.ts');
  });

  test('the cap bounds the stack through the overflow queue instead of merging', () => {
    const c = new BubbleController(); // maxPerResident: 1
    c.processEvent(toolUse('tc-A', 'a.ts', 1) as never);
    c.processEvent(toolUse('tc-B', 'b.ts', 2) as never);
    assert.strictEqual(c.getBubbles().length, 1, 'the cap still bounds the visible stack');
    const overflow = (c as unknown as { overflow: Map<string, { count: number; samples: string[] }> }).overflow;
    const rec = overflow.get('coordinator')!;
    assert.strictEqual(rec.count, 1, 'the displaced call is queued, not discarded');
    assert.ok(rec.samples.some(s => s.includes('Reading a.ts')), 'the queued call keeps its headline');
    // A result for the queued call surfaces as its own entry; the queue grows.
    c.processEvent(toolResult('tc-A', 'content-A', 3) as never);
    assert.strictEqual(overflow.get('coordinator')!.count, 2);
    assert.ok(overflow.get('coordinator')!.samples.some(s => s.includes('Reading b.ts')));
  });

  test('mergeContent preserves the original anchor id when a follow-up carries another', () => {
    const merged = mergeContent(
      { id: 'tc-A', headline: 'Reading a.ts', toolName: 'read_file', status: 'running' },
      { id: 'tc-B', headline: 'read_file returned', toolName: 'read_file', status: 'completed' },
    );
    assert.strictEqual(merged.id, 'tc-A', 'the call bubble keeps its tool_call_id');
    assert.strictEqual(merged.headline, 'Reading a.ts', 'terminal merges keep the call headline');
  });
});

// ---------------------------------------------------------------------------
// HA-033 — clamps measure the real body; nudges never bleed past the top
// ---------------------------------------------------------------------------

describe('HA-033: viewport clamps use measured bodies and bounded nudges', () => {
  test('clampAnchorTop keeps a tall body below the top edge (the old 110px guess could not)', () => {
    // 300px body (bubbles.css allows 200-320px, 400-500px expanded):
    // anchored at y=150 the body top would land at -150 without the clamp.
    assert.strictEqual(clampAnchorTop(150, 300, 400), 308);
    // In-range anchors pass through; the anchor never leaves the overlay.
    assert.strictEqual(clampAnchorTop(350, 300, 400), 350);
    assert.strictEqual(clampAnchorTop(900, 300, 400), 392);
  });

  test('overlap nudges stack downward when the top is exhausted', () => {
    const items = [
      { id: 'a', left: 100, top: 40, width: 200, height: 200 },
      { id: 'b', left: 110, top: 30, width: 200, height: 200 },
    ];
    // Without bounds the legacy upward nudge is preserved (pinned D3 shape):
    assert.deepStrictEqual(planOverlapAdjustments(items), [{ id: 'b', deltaTop: -198 }]);
    // Bounded by the overlay: above is exhausted (40 - 200 - 8 < 0), so b
    // flips fully BELOW a instead of exiting through the top edge.
    const plan = planOverlapAdjustments(items, 8, { top: 0, bottom: 600 });
    assert.deepStrictEqual(plan, [{ id: 'b', deltaTop: 218 }]);
    const bTop = 30 + 218;
    assert.ok(bTop >= 0, 'never past the top edge');
    assert.strictEqual(bTop, 40 + 200 + 8, 'sits fully below the colliding bubble');
  });

  test('the final top is re-clamped against the overlay height', () => {
    const items = [
      { id: 'a', left: 100, top: 40, width: 200, height: 200 },
      { id: 'b', left: 110, top: 30, width: 200, height: 200 },
    ];
    // A tight bottom bound pulls the downward stack back inside the overlay.
    const plan = planOverlapAdjustments(items, 8, { top: 0, bottom: 300 });
    assert.deepStrictEqual(plan, [{ id: 'b', deltaTop: 70 }]);
    assert.ok(30 + 70 + 200 <= 300, 'the body bottom stays inside the overlay');
  });
});

// ---------------------------------------------------------------------------
// HA-034 — hover reveals the same detail block click shows
// ---------------------------------------------------------------------------

/** Minimal detail surface: enough DOM for syncExpansion/toggleExpand to drive
 *  the real `.town-bubble__details` / `.town-bubble__times` spans. */
function stubDetailSurface() {
  const classes = new Set<string>();
  const spans = new Map<string, { hidden: boolean; textContent: string }>();
  const spanFor = (sel: string) => {
    let s = spans.get(sel);
    if (!s) { s = { hidden: true, textContent: '' }; spans.set(sel, s); }
    return s;
  };
  return {
    hidden: (sel: string) => spanFor(sel).hidden,
    has: (cls: string) => classes.has(cls),
    classList: {
      toggle: (cls: string, on?: boolean) => {
        if (on === undefined) { classes.has(cls) ? classes.delete(cls) : classes.add(cls); }
        else if (on) classes.add(cls); else classes.delete(cls);
      },
    },
    querySelector: (sel: string) => spanFor(sel),
  };
}

function hoverFixture() {
  const c = new BubbleController();
  c.processEvent({
    type: 'hermes.tool_use',
    payload: { name: 'read_file', tool_call_id: 'tc-H', input: { path: 'a.ts' } },
    task_id: 't1', sequence: 1, timestamp: new Date().toISOString(),
  } as never);
  const bubble = c.getBubbles()[0];
  const surface = stubDetailSurface();
  (c as unknown as { bubbleElements: Map<string, unknown> }).bubbleElements.set(bubble.id, surface);
  const api = c as unknown as {
    onHover(id: string, entering: boolean): void;
    toggleExpand(id: string): void;
  };
  return { bubble, surface, api };
}

describe('HA-034: hover exposes the §9 detail block after a small delay', () => {
  test('hover reveals after the delay; a cancelled sweep never flashes it', async () => {
    const { bubble, surface, api } = hoverFixture();
    const details = '.town-bubble__details';

    // Entering starts the delayed reveal — nothing is visible synchronously.
    api.onHover(bubble.id, true);
    assert.strictEqual(surface.hidden(details), true, 'the delay exists');

    // Leaving before the delay cancels it entirely.
    api.onHover(bubble.id, false);
    await new Promise(r => setTimeout(r, 350));
    assert.strictEqual(surface.hidden(details), true, 'a cancelled sweep never reveals');

    // A real hover reveals the SAME detail block click shows…
    api.onHover(bubble.id, true);
    await new Promise(r => setTimeout(r, 350));
    assert.strictEqual(surface.hidden(details), false, 'hover reveals the details');
    assert.strictEqual(surface.hidden('.town-bubble__times'), false, 'and the same metadata block');
    assert.ok(surface.has('expanded'), 'the shared expanded state drives it');

    // …and leaving re-hides the transient reveal.
    api.onHover(bubble.id, false);
    assert.strictEqual(surface.hidden(details), true, 'leaving re-hides the hover reveal');
    assert.ok(!surface.has('expanded'));
  });

  test('hover never collapses a click-expanded view', async () => {
    const { bubble, surface, api } = hoverFixture();
    const details = '.town-bubble__details';

    api.toggleExpand(bubble.id); // click opens the details
    assert.strictEqual(surface.hidden(details), false, 'click reveals the details');

    api.onHover(bubble.id, true);
    await new Promise(r => setTimeout(r, 350));
    api.onHover(bubble.id, false);
    assert.strictEqual(surface.hidden(details), false, 'hover-out keeps the click-expanded view open');

    api.toggleExpand(bubble.id); // click again closes it
    assert.strictEqual(surface.hidden(details), true, 'click collapse still works');
  });
});
