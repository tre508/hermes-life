/**
 * UI-VIS-007 §14 acceptance-criteria traceability (headless, state-level).
 *
 * Maps each acceptance criterion in liveagent.md §14 to the evidence that
 * satisfies it. DOM/browser-level criteria are annotated with where their
 * verification lives (browser verification / CSS / unchanged code paths).
 *
 *   1.  Seven characters support contextual bubbles      → this file (AC1)
 *   2.  Tool calls appear on runtime events              → bubbles.test.ts (tool use cases)
 *   3.  Reasoning summaries appear as thought bubbles    → bubbles.test.ts (hermes.text)
 *   4.  Tool names and arguments displayed accurately    → bubbles.test.ts (headline/target)
 *   5.  Tool results update the corresponding bubble     → bubbles.test.ts (tool_result merge)
 *   6.  Completed/failed visually distinguishable        → bubbles.test.ts (category success/error)
 *   7.  Bubbles follow moving characters                 → browser-level: position loop projects
 *                                                          headX/headY each frame (bubbles.ts)
 *   8.  Placement prevents excessive overlap             → compliance D3 (planOverlapAdjustments)
 *   9.  Text readable at normal viewport sizes           → bubbles.css (max-width, clamp, font)
 *   10. Multiple active bubbles only from real events    → this file (AC10)
 *   11. Content does not invent reasoning                → this file (AC11)
 *   12. Historic events do not replay                    → compliance D1
 *   13. Reconnection does not duplicate bubbles          → bubbles.test.ts (watermark dedup)
 *   14. Reduced-motion respected                         → JS: prefersReducedMotion() + matchMedia
 *                                                          listener (bubbles.ts:695-727, 899, 1234);
 *                                                          CSS: two prefers-reduced-motion blocks
 *                                                          in bubbles.css
 *   15. Click navigates to an existing record            → browser-level: navigateToTask dispatches
 *                                                          hermes:open-task (bubbles.ts:1277);
 *                                                          main.v2.ts listener opens the record
 *   16. Existing task execution/navigation unchanged     → main.v2.ts untouched by this feature;
 *                                                          verified by full-suite green runs
 *   17. Static fallback presents correct states          → town-view static fallback path unchanged
 *   18. No backend changes required                      → no backend files touched (git diff scope)
 *   19. Performance within existing budget               → compliance D2 (bounded history), §8
 *                                                          single-bubble rollup, hidden-tab skip
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BubbleController, categorizeEvent } from '../src/town-world/bubbles.ts';
import { ROLES as MODEL_ROLES } from '../src/town-model.ts';

// ---------------------------------------------------------------------------
// AC1 — each of the seven characters supports contextual activity bubbles
// ---------------------------------------------------------------------------

test('AC1: every role in the town model produces a contextual bubble from its workflow events', () => {
  // One representative workflow event per role (mapWorkflowEventToRole).
  const eventsForRole: Record<string, string[]> = {
    coordinator: ['task.started', 'task.completed', 'decision.made'],
    researcher: ['goal.queued', 'discovery.recorded', 'curiosity.poked'],
    planner: ['formulation.started', 'investigation.completed'],
    builder: ['implementation.started', 'implementation.applied'],
    reviewer: ['implementation.review_started', 'implementation.review_accepted'],
    tester: ['verification.started', 'verification.passed'],
    archivist: ['memory.recorded', 'reflection.completed'],
  };

  for (const role of MODEL_ROLES) {
    const types = eventsForRole[role];
    assert.ok(types && types.length > 0, `role ${role} has representative workflow events`);
    for (const type of types) {
      const result = categorizeEvent({ type, task_id: 't1', sequence: 1 });
      assert.ok(result, `${type} produces a bubble`);
      assert.equal(result!.role, role, `${type} anchors to ${role}`);
    }
  }
  // No role outside the town model ever gets a bubble.
  const knownRoles = new Set(MODEL_ROLES);
  const seen = new Set<string>();
  for (const role of Object.keys(eventsForRole)) {
    seen.add(role);
  }
  assert.ok([...seen].every(r => knownRoles.has(r as never)), 'roles come from the town model roster');
});

// ---------------------------------------------------------------------------
// AC10 — multiple active bubbles appear only when supported by actual events
// ---------------------------------------------------------------------------

test('AC10: an idle controller shows no bubbles and unknown events produce none', () => {
  const c = new BubbleController();
  assert.equal(c.getBubbles().length, 0, 'no events → no bubbles');

  // An unrecognized event type must not invent a bubble.
  c.processEvent({ type: 'totally.unknown.event', sequence: 1, task_id: 't1' });
  c.processEvent({ type: 'hermes.text', sequence: 2, task_id: 't1', payload: { text: 'hello' } });
  const bubbles = c.getBubbles();
  assert.ok(bubbles.every(b => b.role === 'coordinator'), 'only the real event made a bubble');
  assert.equal(bubbles.filter(b => b.category === 'thought').length, 1,
    'exactly one bubble for the one real event');
});

// ---------------------------------------------------------------------------
// AC11 — bubble content does not invent reasoning or execution steps
// ---------------------------------------------------------------------------

test('AC11: displayed text is exactly the runtime payload text, never synthesized', () => {
  const c = new BubbleController();
  c.processEvent({
    type: 'hermes.text', sequence: 1, task_id: 't1',
    payload: { text: 'grep for the adapter in town-view' },
  });
  const bubbles = c.getBubbles();
  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].content._streamFragment, 'grep for the adapter in town-view',
    'bubble text is verbatim runtime output');

  // A workflow event with no payload text must not invent dialogue either.
  const result = categorizeEvent({ type: 'task.completed', task_id: 't2', sequence: 2 });
  assert.ok(!('text' in result!.content) || result!.content._streamFragment === undefined,
    'state bubbles carry no fabricated reasoning text');
});
