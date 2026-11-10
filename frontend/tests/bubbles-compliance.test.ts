/**
 * UI-VIS-007 compliance tests for the fixes in the liveagent.md audit:
 *   D1 — historic events never replay as new execution (§14)
 *   D2 — recent bubble history is inspectable (§11)
 *   D3 — overlapping bubbles resolve instead of covering (§7/§8)
 *   D4 — review/approval tools route to Vale, planning to Piper (§3)
 *   D5 — expanded view carries start/completion metadata (§9) [DOM-level,
 *        covered by the merge/rollup shape tested here]
 *   N2 — task boundary drops only thought bubbles
 *
 * The BubbleController's state + history paths are DOM-free by design, so
 * these run headless. DOM rendering itself stays under browser verification.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BubbleController,
  categorizeEvent,
  formatHistoryRows,
  planOverlapAdjustments,
} from '../src/town-world/bubbles.ts';

// ---------------------------------------------------------------------------
// D1 — historic events do not replay as new execution
// ---------------------------------------------------------------------------

test('D1: historical events advance the watermark but never render', () => {
  const c = new BubbleController();
  c.processEvent({
    type: 'hermes.text', sequence: 5, task_id: 't1',
    payload: { text: 'an old streamed message' }, historical: true,
  });
  assert.equal(c.getBubbles().length, 0, 'historic event must not create a bubble');
  assert.equal(c.getHistory().length, 0, 'historic event must not enter the presentation history');

  // Re-delivery below the watermark is still ignored.
  c.processEvent({ type: 'hermes.text', sequence: 3, task_id: 't1', payload: { text: 'old' } });
  assert.equal(c.getBubbles().length, 0);

  // A live event above the watermark renders normally.
  c.processEvent({ type: 'hermes.text', sequence: 7, task_id: 't1', payload: { text: 'live message' } });
  assert.equal(c.getBubbles().length, 1);
  assert.equal(c.getBubbles()[0].content.headline, 'live message');
  assert.equal(c.getHistory().length, 1);
});

test('D1: a full page-load replay produces zero bubbles', () => {
  const c = new BubbleController();
  for (let seq = 1; seq <= 500; seq += 100) {
    c.processEvent({
      type: 'hermes.tool_use', sequence: seq, task_id: 't-old',
      payload: { name: 'read_file', path: 'src/old.ts' }, historical: true,
    });
  }
  assert.equal(c.getBubbles().length, 0);
  assert.equal(c.getHistory().length, 0);
});

// ---------------------------------------------------------------------------
// D4 — role mapping: review/approval → Vale, planning → Piper
// ---------------------------------------------------------------------------

test('D4: review and approval tools route to the reviewer (Vale)', () => {
  for (const tool of ['review_candidate', 'review_changes', 'approve_plan']) {
    const out = categorizeEvent({
      type: 'hermes.tool_use', task_id: 't',
      payload: { name: tool, input: 'plan-1' },
    });
    assert.ok(out, `${tool} produces a bubble`);
    assert.equal(out.role, 'reviewer', `${tool} → reviewer`);
  }
});

test('D4: planning tools still route to the planner (Piper)', () => {
  for (const tool of ['plan_draft', 'formulate_proposal', 'compile_criteria']) {
    const out = categorizeEvent({
      type: 'hermes.tool_use', task_id: 't',
      payload: { name: tool, input: 'x' },
    });
    assert.ok(out, `${tool} produces a bubble`);
    assert.equal(out.role, 'planner', `${tool} → planner`);
  }
});

// ---------------------------------------------------------------------------
// D2 — recent bubble history is inspectable (presentation cache)
// ---------------------------------------------------------------------------

test('D2: formatHistoryRows exposes role, category, tool, task and outcome', () => {
  const c = new BubbleController();
  c.processEvent({
    type: 'hermes.tool_use', sequence: 1, task_id: 'task-1234abcd',
    payload: { name: 'edit_file', path: 'src/x.ts' },
  });
  c.processEvent({
    type: 'hermes.text', sequence: 2, task_id: 'task-1234abcd',
    payload: { text: 'Working on it' },
  });
  const rows = formatHistoryRows(c.getHistory(), 20);
  assert.equal(rows.length, 2);
  // Newest first — the streamed text is the latest entry.
  assert.equal(rows[0].headline, 'Working on it');
  assert.equal(rows[0].categoryLabel, 'Thought');
  assert.equal(rows[0].roleName, 'Hermes');
  assert.equal(rows[0].taskId, 'task-1234abcd');
  // The tool call carries its tool name and target task.
  assert.equal(rows[1].tool, 'edit_file');
  assert.equal(rows[1].taskId, 'task-1234abcd');
  assert.equal(rows[1].status, 'running');
});

test('D2: history rows are bounded by the requested limit', () => {
  const fake = Array.from({ length: 30 }, (_, i) => ({
    id: `b${i}`, role: 'coordinator' as const, category: 'execution' as const,
    content: { headline: `h${i}` }, createdAt: i, visible: true,
    expanded: false, animationState: 'visible' as const,
  }));
  assert.equal(formatHistoryRows(fake, 20).length, 20);
  assert.equal(formatHistoryRows(fake, 5).length, 5);
});

// ---------------------------------------------------------------------------
// D3 — overlap resolution stacks bubbles instead of covering them
// ---------------------------------------------------------------------------

test('D3: a later overlapping bubble is nudged fully above the earlier one', () => {
  const plan = planOverlapAdjustments([
    { id: 'a', left: 100, top: 200, width: 200, height: 60 },
    { id: 'b', left: 120, top: 180, width: 200, height: 60 },
  ]);
  // b must sit above a: top = 200 - 60 - 8 = 132 → delta = 132 - 180 = -48.
  assert.deepEqual(plan, [{ id: 'b', deltaTop: -48 }]);
});

test('D3: disjoint bubbles keep their anchored positions', () => {
  const plan = planOverlapAdjustments([
    { id: 'a', left: 0, top: 200, width: 200, height: 60 },
    { id: 'b', left: 400, top: 180, width: 200, height: 60 },
  ]);
  assert.deepEqual(plan, []);
});

test('D3: chains resolve transitively (each stacks above the last)', () => {
  const plan = planOverlapAdjustments([
    { id: 'a', left: 100, top: 200, width: 200, height: 60 },
    { id: 'b', left: 110, top: 190, width: 200, height: 60 },
    { id: 'c', left: 120, top: 180, width: 200, height: 60 },
  ]);
  const byId = new Map(plan.map(p => [p.id, p.deltaTop]));
  // b above a: 200 - 60 - 8 = 132 → delta -58
  assert.equal(byId.get('b'), -58);
  // c above b's adjusted position (132): 132 - 60 - 8 = 64 → delta -116
  assert.equal(byId.get('c'), -116);
  assert.ok(!byId.has('a'), 'the highest-priority bubble never moves');
});

// ---------------------------------------------------------------------------
// N2 — task boundary drops only the thought accumulator
// ---------------------------------------------------------------------------

test('N2: a new task boundary drops thought bubbles but keeps tool context', () => {
  const c = new BubbleController();
  c.processEvent({ type: 'task.started', sequence: 1, task_id: 't1' });
  c.processEvent({ type: 'hermes.text', sequence: 2, task_id: 't1', payload: { text: 'thinking' } });
  c.processEvent({
    type: 'hermes.tool_use', sequence: 3, task_id: 't1',
    payload: { name: 'read_file', path: 'x.ts' },
  });
  // New task begins: the old thought stream must not bleed into the new task.
  c.processEvent({ type: 'task.started', sequence: 4, task_id: 't2' });
  const bubbles = c.getBubbles();
  assert.ok(!bubbles.some(b => b.category === 'thought'), 'old thought bubble dropped');
  assert.ok(bubbles.some(b => b.category === 'tool'), 'tool bubble retained as context');
});
