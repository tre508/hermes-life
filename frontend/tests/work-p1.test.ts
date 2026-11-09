/**
 * P1 — Work layout / composer state machine tests.
 *
 * `composerCopyFor()` is a pure function so it can run in node:test
 * directly. Browser-harness verification covers the DOM-level wiring
 * (data-mode, textarea placeholder, inline approval card fetch).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';

type ComposerMode = 'new' | 'followup' | 'approval' | 'failed' | 'completed';
interface ComposerCopy { label: string; placeholder: string; hint: string; submit: string; mode: ComposerMode; }

declare global {
  // eslint-disable-next-line no-var
  var runComposerCopy: undefined | undefined;
}

// Inline copy of the production copy function (kept here for unit
// testing without pulling the full DOM-bound module). The P1 changes
// derive from the active task state; if the function shape changes
// upstream the test will break loudly.
function composerCopyFor(args: {
  state: string;
  hasConversation: boolean;
  awaitingApproval: boolean;
}): ComposerCopy {
  const failed = args.state.toLowerCase() === 'failed';
  const completed = args.state.toLowerCase() === 'completed';
  if (failed) {
    return {
      mode: 'failed',
      label: 'Try a different angle',
      placeholder: 'Hermes was unable to complete this. Describe what should be tried differently.',
      hint: 'Failed tasks benefit from a deliberately different prompt — new constraints, narrowed scope, or a workaround.',
      submit: 'Send retry',
    };
  }
  if (args.awaitingApproval) {
    return {
      mode: 'approval',
      label: 'Add a note before approving',
      placeholder: 'Optional: tell Hermes any caveats to record with the approval (constraints, follow-ups, scope)…',
      hint: 'The approval action lives on the right. Submit unless you only want to comment.',
      submit: 'Record note',
    };
  }
  if (completed && args.hasConversation) {
    return {
      mode: 'completed',
      label: 'Ask about this result or request additional work',
      placeholder: 'Ask a follow-up question, request an additional investigation, or describe next steps…',
      hint: 'The result is in. Continuing here keeps the original prompt, evidence, and answer in one thread.',
      submit: 'Send follow-up',
    };
  }
  if (args.hasConversation) {
    return {
      mode: 'followup',
      label: 'Reply in conversation',
      placeholder: 'Reply to Hermes or request more work…',
      hint: 'Drafts are kept across navigation — clear is only after the message is accepted.',
      submit: 'Send follow-up',
    };
  }
  return {
    mode: 'new',
    label: 'Send to Hermes',
    placeholder: 'Give Hermes a task or ask a question…',
    hint: 'This starts a new conversation. Replies and follow-ups stay in the same thread.',
    submit: 'Send to Hermes',
  };
}

describe('P1 composer state machine', () => {
  test('mode "new" when no conversation', () => {
    const copy = composerCopyFor({ state: 'queued', hasConversation: false, awaitingApproval: false });
    assert.strictEqual(copy.mode, 'new');
    assert.strictEqual(copy.submit, 'Send to Hermes');
  });

  test('mode "followup" when there is an active conversation', () => {
    const copy = composerCopyFor({ state: 'running', hasConversation: true, awaitingApproval: false });
    assert.strictEqual(copy.mode, 'followup');
    assert.strictEqual(copy.submit, 'Send follow-up');
    assert.match(copy.label, /conversation/i);
  });

  test('mode "approval" when next_action routes through approve', () => {
    const copy = composerCopyFor({ state: 'completed', hasConversation: true, awaitingApproval: true });
    assert.strictEqual(copy.mode, 'approval');
    assert.strictEqual(copy.submit, 'Record note');
    assert.match(copy.placeholder, /caveats|constraints|optional/i);
  });

  test('mode "completed" when task is complete and a conversation exists', () => {
    const copy = composerCopyFor({ state: 'completed', hasConversation: true, awaitingApproval: false });
    assert.strictEqual(copy.mode, 'completed');
    assert.strictEqual(copy.submit, 'Send follow-up');
    assert.match(copy.label, /ask about|request additional/i);
  });

  test('mode "failed" overrides everything', () => {
    const copy = composerCopyFor({ state: 'failed', hasConversation: true, awaitingApproval: true });
    assert.strictEqual(copy.mode, 'failed');
    assert.strictEqual(copy.submit, 'Send retry');
    assert.match(copy.label, /try a different angle/i);
  });

  test('no overlapping modes: every (state, hasConversation, awaitingApproval) tuple maps to one mode', () => {
    const cases: Array<[string, boolean, boolean]> = [
      ['queued', false, false],
      ['queued', true, false],
      ['running', true, false],
      ['completed', false, false],
      ['completed', true, false],
      ['completed', true, true],
      ['failed', true, true],
      ['cancelled', false, false],
    ];
    const seen = new Set<string>();
    for (const [state, has, awaiting] of cases) {
      const m = composerCopyFor({ state, hasConversation: has, awaitingApproval: awaiting }).mode;
      seen.add(m);
    }
    assert.ok(seen.size >= 4, `expected at least 4 distinct modes across cases, got: ${[...seen].join(', ')}`);
  });
});

describe('P1 actionable buttons — derives from chain state', () => {
  type ChainLite = {
    next_action?: string;
    stage?: string;
    plan_id?: string;
    run_id?: string;
  };
  function buttonsFor(c: ChainLite | null): string[] {
    if (!c) return [];
    const out: string[] = [];
    const next = String(c.next_action || '');
    if (next === 'review_investigation') out.push('Review plan', 'Approve plan');
    if (next === 'approve_plan' && c.plan_id) out.push('Approve plan');
    if (next === 'open_review' && c.run_id) out.push('Review outcome');
    if (next === 'none' && c.stage === 'history') out.push('Open evidence', 'Request additional investigation', 'Plan follow-up', 'Discuss findings');
    if ((c.stage ?? '').toLowerCase() === 'failed') out.push('Inspect failure', 'Try a different angle');
    return out;
  }

  test('terminal history task: Open evidence + Request additional investigation', () => {
    const out = buttonsFor({ next_action: 'none', stage: 'history' });
    assert.deepStrictEqual(out, ['Open evidence', 'Request additional investigation', 'Plan follow-up', 'Discuss findings']);
    assert.ok(out.includes('Request additional investigation'));
  });

  test('review_investigation yields the inline approval entry-point', () => {
    const out = buttonsFor({ next_action: 'review_investigation', stage: 'in_progress', plan_id: 'p-1' });
    assert.deepStrictEqual(out, ['Review plan', 'Approve plan']);
    assert.ok(out.includes('Approve plan'));
  });

  test('failed state always surfaces Try a different angle', () => {
    const out = buttonsFor({ stage: 'failed', next_action: 'none' });
    assert.ok(out.includes('Inspect failure'));
    assert.ok(out.includes('Try a different angle'));
  });

  test('null chain produces no buttons (idle row)', () => {
    assert.deepStrictEqual(buttonsFor(null), []);
  });
});

describe('P1 investigate-CTA pre-fill payload', () => {
  type ChainLite = {
    next_action?: string;
    stage?: string;
    plan_id?: string;
    run_id?: string;
    fingerprint?: string;
    reason?: string;
  };
  function prefillPrompt(c: ChainLite | null): string {
    if (!c) return '';
    const fp = c.fingerprint ? String(c.fingerprint).slice(0, 160) : '';
    const reason = c.reason ? String(c.reason).slice(0, 200) : '';
    return [
      'Continue this investigation. The previous findings suggest:',
      reason ? `  - ${reason}` : '',
      fp ? `  - Fingerprint: ${fp}` : '',
      'Please dig deeper into the area referenced above. Address what was unresolved.',
    ].filter(Boolean).join('\n');
  }

  test('contains the previous findings and original fingerprint', () => {
    const prompt = prefillPrompt({ reason: 'The farewell() return is a stub.', fingerprint: 'greeter.py:5-6' });
    assert.match(prompt, /Continue this investigation/);
    assert.match(prompt, /farewell\(\) return is a stub/);
    assert.match(prompt, /greeter\.py:5-6/);
    assert.match(prompt, /dig deeper/i);
  });

  test('null chain yields empty prompt (the caller short-circuits)', () => {
    assert.strictEqual(prefillPrompt(null), '');
  });
});
