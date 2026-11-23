/**
 * P1 — Work workspace wiring tests.
 *
 * HL-CONV-001 removed the duplicate Task Board composer because a second
 * surface that POSTs /api/tasks duplicates the send path. convo-redesign.md §6
 * brought the composer back as a state-adaptive *entry point* that hands its
 * text to Chat (`hermes:open-in-chat` + submit:true) instead of POSTing — so
 * the invariant HL-CONV-001 protected still holds: ONE conversation, ONE send
 * path. These checks pin that contract.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const work = readFileSync(join(here, '../src/work-workspace.ts'), 'utf8');
const chat = readFileSync(join(here, '../src/hermes-chat.ts'), 'utf8');
const thread = readFileSync(join(here, '../src/conv-thread.ts'), 'utf8');
const composer = readFileSync(join(here, '../src/task-composer.ts'), 'utf8');
const review = readFileSync(join(here, '../src/phase415-review.ts'), 'utf8');

describe('HL-CONV-001 (revised) — one conversation, one send path', () => {
  test('Work mounts the state-adaptive task composer (§6)', () => {
    assert.match(work, /mountTaskComposer\(/);
    assert.match(work, /task-composer-host/);
    assert.doesNotMatch(work, /buildComposerShell/);
  });

  test('the composer is a second ENTRY POINT, not a second write path', () => {
    // It hands text to Chat; it must never POST /api/tasks itself.
    assert.match(composer, /hermes:open-in-chat/);
    assert.match(composer, /submit: true/);
    assert.doesNotMatch(composer, /fetch\(\s*[`'"]\/api\/tasks/);
    assert.doesNotMatch(work, /fetch\(\s*[`'"]\/api\/tasks/);
  });

  test('the composer carries the task conversation on the hand-off', () => {
    assert.match(composer, /conversation_id/);
    assert.match(composer, /task_id/);
    assert.match(work, /conversationId: convId/);
  });

  test('Chat listens for hermes:open-in-chat and resolves task_id via /api/tasks', () => {
    assert.match(chat, /addEventListener\('hermes:open-in-chat'/);
    assert.match(chat, /\/api\/tasks\/\$\{encodeURIComponent\(d\.task_id\)\}/);
  });

  test('Chat prefill routes drafts into the chat input, never a local composer', () => {
    assert.match(chat, /d\.prefill/);
    assert.match(work, /prefillComposer/);
    // prefillComposer must dispatch the event, not a Work textarea.
    assert.match(work, /function prefillComposer\(prompt: string\) \{\s*const detail/);
  });

  test('thread view offers Open in Chat on the same conversation_id', () => {
    assert.match(thread, /conv-thread__open-chat/);
    assert.match(thread, /conversation_id: conv\.conversation_id/);
  });

  test('autonomous tasks get a conversation turn (backend)', () => {
    const autonomy = readFileSync(join(here, '../../hermes_life/autonomy.py'), 'utf8');
    assert.match(autonomy, /conversations\.add_user_turn\(goal\['prompt'\], task_id=task\['id'\]\)/);
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

describe('§5 completed-implementation actions (convo-redesign.md)', () => {
  test('the task panel offers test results and revision, deep-linked', () => {
    assert.match(work, /View test results →/);
    assert.match(work, /Request revision →/);
    assert.match(work, /hermes:open-review/);
    assert.match(review, /addEventListener\('hermes:open-review'/);
  });

  test('the revision mutation has exactly ONE owner (the candidate review)', () => {
    // The request needs the snapshot hash, per-criterion verdicts and reviewer
    // feedback. The task panel holds none of them, so it must not re-implement
    // the call — it deep-links instead.
    assert.match(review, /revisions\/retry/);
    assert.match(review, /snapshot_sha256/);
    assert.match(review, /revision_requested/);
    assert.doesNotMatch(work, /revisions\/retry/);
    assert.doesNotMatch(work, /snapshot_sha256/);
  });

  test('Submit for approval is absent — no implementation-approval route exists', () => {
    assert.doesNotMatch(work, /Submit for approval/i);
    const backend = readFileSync(join(here, '../../hermes_life/app.py'), 'utf8');
    assert.doesNotMatch(backend, /implementations\/\{ident\}\/approve/);
  });

  test('the deep-link targets the real run card and the builds subview', () => {
    assert.match(work, /hl415-run-\$\{runId\}/);
    assert.match(work, /openWorkView\('builds'\)/);
    assert.match(work, /setSelection\('builds', \{ kind: 'build', id: runId \}\)/);
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
