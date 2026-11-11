/**
 * Tests for the bubble system (UI-VIS-007).
 *
 * Two scopes:
 *  - pure categorizeEvent (no DOM), exercised by the cases below.
 *  - live wire payload shapes from hermes_life/hermes_adapter.py / event loop.
 *  If a new event shape matters at runtime, add a case here so the adapter
 *  surfaces it without recreating a screenshot fixture.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { categorizeEvent, BubbleController } from '../src/town-world/bubbles.ts';

describe('Bubble System - Event Categorization', () => {
  test('categorizes hermes.tool_use as tool bubble for researcher (read_file is research tool)', () => {
    const event = {
      type: 'hermes.tool_use',
      payload: { tool_name: 'read_file', input: { path: 'src/main.ts' } },
      task_id: 'task-123',
      sequence: 1,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result !== null);
    assert.strictEqual(result!.role, 'researcher');
    assert.strictEqual(result!.category, 'tool');
    assert.strictEqual(result!.content.toolName, 'read_file');
    assert.ok(result!.content.toolTarget!.includes('src/main.ts'));
    assert.strictEqual(result!.content.status, 'running');
  });

  test('categorizes hermes.tool_use with grep as researcher tool', () => {
    const event = {
      type: 'hermes.tool_use',
      payload: { tool_name: 'grep', input: { pattern: 'TODO' } },
      task_id: 'task-123',
      sequence: 2,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result !== null);
    assert.strictEqual(result!.role, 'researcher');
    assert.strictEqual(result!.category, 'tool');
  });

  test('categorizes hermes.tool_use with write_file as builder tool', () => {
    const event = {
      type: 'hermes.tool_use',
      payload: { tool_name: 'write_file', input: { path: 'src/test.ts', content: 'test' } },
      task_id: 'task-123',
      sequence: 3,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result !== null);
    assert.strictEqual(result!.role, 'builder');
    assert.strictEqual(result!.category, 'tool');
  });

  test('categorizes hermes.tool_use with pytest as tester tool', () => {
    const event = {
      type: 'hermes.tool_use',
      payload: { tool_name: 'pytest', input: { args: ['tests/'] } },
      task_id: 'task-123',
      sequence: 4,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result !== null);
    assert.strictEqual(result!.role, 'tester');
    assert.strictEqual(result!.category, 'tool');
  });

  test('categorizes hermes.tool_result as success bubble for researcher', () => {
    const event = {
      type: 'hermes.tool_result',
      payload: { tool_name: 'read_file', output: 'file content' },
      task_id: 'task-123',
      sequence: 5,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result !== null);
    assert.strictEqual(result!.role, 'researcher');
    assert.strictEqual(result!.category, 'success');
    assert.strictEqual(result!.content.status, 'completed');
  });

  test('categorizes hermes.tool_result with error as error bubble for builder', () => {
    const event = {
      type: 'hermes.tool_result',
      payload: { tool_name: 'write_file', error: 'Permission denied' },
      task_id: 'task-123',
      sequence: 6,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result !== null);
    assert.strictEqual(result!.role, 'builder');
    assert.strictEqual(result!.category, 'error');
    assert.strictEqual(result!.content.status, 'failed');
  });

  test('categorizes hermes.text as thought bubble', () => {
    const event = {
      type: 'hermes.text',
      payload: { text: 'Analyzing the requested changes...' },
      task_id: 'task-123',
      sequence: 7,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result !== null);
    assert.strictEqual(result!.role, 'coordinator');
    assert.strictEqual(result!.category, 'thought');
    assert.ok(result!.content.headline.includes('Analyzing'));
  });

  test('categorizes hermes.result as success bubble', () => {
    const event = {
      type: 'hermes.result',
      payload: {},
      task_id: 'task-123',
      sequence: 8,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result !== null);
    assert.strictEqual(result!.role, 'coordinator');
    assert.strictEqual(result!.category, 'success');
    assert.strictEqual(result!.content.headline, 'Task completed');
  });

  test('categorizes task.queued as waiting bubble', () => {
    const event = {
      type: 'task.queued',
      payload: {},
      task_id: 'task-123',
      sequence: 9,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result !== null);
    assert.strictEqual(result!.role, 'coordinator');
    assert.strictEqual(result!.category, 'waiting');
    assert.strictEqual(result!.content.headline, 'Task queued');
  });

  test('categorizes task.started as execution bubble', () => {
    const event = {
      type: 'task.started',
      payload: {},
      task_id: 'task-123',
      sequence: 10,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result !== null);
    assert.strictEqual(result!.role, 'coordinator');
    assert.strictEqual(result!.category, 'execution');
    assert.strictEqual(result!.content.headline, 'Task started');
  });

  test('categorizes task.completed as success bubble', () => {
    const event = {
      type: 'task.completed',
      payload: {},
      task_id: 'task-123',
      sequence: 11,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result !== null);
    assert.strictEqual(result!.role, 'coordinator');
    assert.strictEqual(result!.category, 'success');
    assert.strictEqual(result!.content.headline, 'Task completed');
  });

  test('categorizes task.failed as error bubble', () => {
    const event = {
      type: 'task.failed',
      payload: {},
      task_id: 'task-123',
      sequence: 12,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result !== null);
    assert.strictEqual(result!.role, 'coordinator');
    assert.strictEqual(result!.category, 'error');
    assert.strictEqual(result!.content.headline, 'Task failed');
  });

  test('categorizes implementation.started as builder execution bubble', () => {
    const event = {
      type: 'implementation.started',
      payload: { project: 'hermes-life' },
      task_id: 'task-123',
      sequence: 13,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result !== null);
    assert.strictEqual(result!.role, 'builder');
    assert.strictEqual(result!.category, 'execution');
    assert.ok(result!.content.headline.includes('Implementing'));
  });

  test('categorizes discovery.scan_completed as researcher success bubble', () => {
    const event = {
      type: 'discovery.scan_completed',
      payload: { project: 'hermes-life' },
      task_id: 'task-123',
      sequence: 14,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result !== null);
    assert.strictEqual(result!.role, 'researcher');
    assert.strictEqual(result!.category, 'success');
  });

  test('returns null for unknown event types', () => {
    const event = {
      type: 'unknown.event',
      payload: {},
      task_id: 'task-123',
      sequence: 15,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.strictEqual(result, null);
  });

  test('returns null for empty hermes.text', () => {
    const event = {
      type: 'hermes.text',
      payload: { text: '' },
      task_id: 'task-123',
      sequence: 16,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.strictEqual(result, null);
  });
});

describe('Bubble System - Live wire payload shapes (UI-VIS-007 §6)', () => {
  test('hermes.tool_use with `name` and `tool_call_id` is recognised, falls back to coordinator for unknowns', () => {
    const event = {
      type: 'hermes.tool_use',
      payload: {
        type: 'tool_use',
        name: 'terminal',
        tool_call_id: 'chatcmpl-tool-9abbdaf7b18d803e',
        input: { command: 'cd /home/glenn/workspaces/hermes-life && git fetch origin' },
      },
      task_id: 'task-live-1',
      sequence: 100,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result);
    // "terminal" doesn't map cleanly to a specialist role (spec §3: never
    // invent autonomous agents from tool usage), so the bubble stays on
    // the coordinator — but the bubble still surfaces the actual command
    // it was given.
    assert.strictEqual(result!.role, 'coordinator');
    assert.strictEqual(result!.category, 'tool');
    assert.strictEqual(result!.content.toolName, 'terminal');
    assert.strictEqual(result!.content.id, 'chatcmpl-tool-9abbdaf7b18d803e');
    assert.ok(result!.content.status === 'running');
    // Meaningful headline from actual command (HL-TELEM-001)
    assert.ok(result!.content.headline.startsWith('Running:'));
    assert.ok(result!.content.headline.includes('git fetch origin'));
    assert.ok(result!.content.toolTarget!.includes('git fetch origin'));
  });

  test('hermes.tool_result with is_error:true returns error bubble', () => {
    const event = {
      type: 'hermes.tool_result',
      payload: {
        type: 'tool_result',
        name: 'write_file',
        tool_call_id: 'tc-1',
        is_error: true,
        output: 'Permission denied',
      },
      task_id: 'task-live-2',
      sequence: 101,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result);
    assert.strictEqual(result!.category, 'error');
    assert.strictEqual(result!.content.status, 'failed');
    assert.strictEqual(result!.content.toolName, 'write_file');
    assert.ok(result!.content.details!.startsWith('Error:'));
  });

  test('hermes.tool_result surfaces actual output in details when available', () => {
    const event = {
      type: 'hermes.tool_result',
      payload: {
        type: 'tool_result',
        name: 'terminal',
        tool_call_id: 'tc-2',
        output: 'From https://github.com/tre508/hermes-life\n   55f0794..17f2da3  main\n',
      },
      task_id: 'task-live-3',
      sequence: 102,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result);
    assert.strictEqual(result!.category, 'success');
    assert.ok(result!.content.details!.includes('55f0794..17f2da3  main'));
  });

  test('hermes.system "init" subtitle returns null (no fabricated "Runtime active")', () => {
    const event = {
      type: 'hermes.system',
      payload: { type: 'system', subtype: 'init', model: 'haiku', session_id: '' },
      task_id: null,
      sequence: 50,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.strictEqual(result, null);
  });

  test('hermes.result with full text surfaces the first non-blank line as headline', () => {
    const event = {
      type: 'hermes.result',
      payload: {
        type: 'result',
        session_id: 'local-x',
        exit_code: 0,
        text: 'Done. Fix applied and verified in the isolated staging dir.\n\n**Plan:**\n- inspect\n- fix\n',
      },
      task_id: 'task-live-4',
      sequence: 200,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result);
    assert.strictEqual(result!.category, 'success');
    assert.strictEqual(result!.content.status, 'completed');
    assert.ok(result!.content.headline.startsWith('Done.'));
    assert.ok(result!.content.details!.startsWith('Done.'));
  });

  test('hermes.result reflects non-zero exit_code as a failed bubble', () => {
    const event = {
      type: 'hermes.result',
      payload: { type: 'result', session_id: 'local-x', exit_code: 2, text: '' },
      task_id: 'task-live-5',
      sequence: 1,
      timestamp: new Date().toISOString(),
    };
    const result = categorizeEvent(event);
    assert.ok(result);
    assert.strictEqual(result!.content.status, 'failed');
  });

  test('repeat streamed hermes.text deltas all produce a thought bubble and share taskId', () => {
    const events = [
      { type: 'hermes.text', payload: { text: ' at the dead bundle ' }, task_id: 't1', sequence: 11 },
      { type: 'hermes.text', payload: { text: ' at `/home/glenn/' }, task_id: 't1', sequence: 12 },
      { type: 'hermes.text', payload: { text: 'workspaces/hermes-life` is your live one.' }, task_id: 't1', sequence: 13 },
    ].map((e) => ({ ...e, timestamp: new Date().toISOString() }));
    const results = events.map((e) => categorizeEvent(e));
    assert.ok(results.every((r) => r && r.category === 'thought' && r.content.taskId === 't1'));
    // Each fragment replaces the last — newer headline wins.
    assert.strictEqual(results[2]!.content.headline, 'workspaces/hermes-life` is your live one.');
  });
});

describe('Bubble System - Result bubble keeps original context', () => {
  test('tool_result preserves tool_target and toolName from the preceding tool_use', () => {
    const use = categorizeEvent({
      type: 'hermes.tool_use',
      payload: {
        type: 'tool_use',
        name: 'write_file',
        tool_call_id: 'tc-context',
        input: { path: 'frontend/src/main.ts' },
      },
      task_id: 't',
      sequence: 1,
      timestamp: new Date().toISOString(),
    });
    const result = categorizeEvent({
      type: 'hermes.tool_result',
      payload: {
        type: 'tool_result',
        name: 'write_file',
        tool_call_id: 'tc-context',
        output: 'Written 12 lines',
      },
      task_id: 't',
      sequence: 2,
      timestamp: new Date().toISOString(),
    });
    assert.ok(use && result);
    // Same id anchors the result to the same bubble the controller would
    // resolve; the categorizer itself just shapes the per-event content.
    assert.strictEqual(use!.content.id, result!.content.id);
    assert.strictEqual(use!.content.toolTarget, '{"path":"frontend/src/main.ts"}');
    // The result carries no input, so when the controller merges it with
    // the existing bubble's content, the original target survives. The
    // result's own content.toolTarget is empty here only because the
    // payload had no input — that's the case we defend against.
    assert.ok(!result!.content.toolTarget || result!.content.toolTarget === '');
  });
});

describe('Bubble System - Role mapping from tool name (live keys)', () => {
  test('maps `read_file` to researcher', () => {
    const r = categorizeEvent({ type: 'hermes.tool_use', payload: { name: 'read_file', input: { path: 'x' } }, task_id: 't', sequence: 1, timestamp: new Date().toISOString() });
    assert.strictEqual(r!.role, 'researcher');
  });
  test('maps `write_file`, `edit_file`, `git`, `npm` to builder', () => {
    for (const name of ['write_file', 'edit_file', 'git', 'npm']) {
      const r = categorizeEvent({ type: 'hermes.tool_use', payload: { name, input: {} }, task_id: 't', sequence: 1, timestamp: new Date().toISOString() });
      assert.strictEqual(r!.role, 'builder', `expected ${name} → builder`);
    }
  });
  test('maps `pytest`, `test`, `lint`, `evaluate` to tester', () => {
    for (const name of ['pytest', 'test', 'lint', 'evaluate']) {
      const r = categorizeEvent({ type: 'hermes.tool_use', payload: { name, input: {} }, task_id: 't', sequence: 1, timestamp: new Date().toISOString() });
      assert.strictEqual(r!.role, 'tester', `expected ${name} → tester`);
    }
  });
  test('maps `memory`, `recall`, `archive` to archivist', () => {
    for (const name of ['memory', 'recall', 'archive']) {
      const r = categorizeEvent({ type: 'hermes.tool_use', payload: { name, input: {} }, task_id: 't', sequence: 1, timestamp: new Date().toISOString() });
      assert.strictEqual(r!.role, 'archivist', `expected ${name} → archivist`);
    }
  });
  test('maps `plan`, `goal`, `formulate` to planner', () => {
    for (const name of ['plan', 'goal', 'formulate']) {
      const r = categorizeEvent({ type: 'hermes.tool_use', payload: { name, input: {} }, task_id: 't', sequence: 1, timestamp: new Date().toISOString() });
      assert.strictEqual(r!.role, 'planner', `expected ${name} → planner`);
    }
  });
});

describe('Bubble System - Workflow event role mapping (live)', () => {
  test('implementation.evaluated → tester', () => {
    const r = categorizeEvent({ type: 'implementation.evaluated', payload: { state: 'candidate_passed' }, task_id: 't', sequence: 1, timestamp: new Date().toISOString() });
    assert.ok(r);
    assert.strictEqual(r!.role, 'tester');
    assert.strictEqual(r!.category, 'success');
  });
  test('verification.completed → tester success', () => {
    const r = categorizeEvent({ type: 'verification.completed', payload: { disposition: 'verified' }, task_id: 't', sequence: 1, timestamp: new Date().toISOString() });
    assert.ok(r);
    assert.strictEqual(r!.role, 'tester');
    assert.strictEqual(r!.category, 'success');
  });
  test('verification.failed → tester error', () => {
    const r = categorizeEvent({ type: 'verification.failed', payload: { blocker: 'flow' }, task_id: 't', sequence: 1, timestamp: new Date().toISOString() });
    assert.ok(r);
    assert.strictEqual(r!.role, 'tester');
    assert.strictEqual(r!.category, 'error');
    assert.strictEqual(r!.content.status, 'failed');
  });
  test('implementation.review_decided → reviewer (override of planner "review" prefix)', () => {
    // Implementation review routing lives in the planner regex today.
    // The rule is "anything not implementation-prefix falls through". Pin
    // the current behaviour so a future routing change is a deliberate
    // test update rather than an accidental regression.
    const r = categorizeEvent({ type: 'implementation.review_decided', payload: { decision: 'accepted' }, task_id: 't', sequence: 1, timestamp: new Date().toISOString() });
    assert.ok(r);
    assert.strictEqual(r!.role, 'reviewer');
  });
  test('memory.extraction_summary → archivist', () => {
    const r = categorizeEvent({ type: 'memory.extraction_summary', payload: { status: 'completed', stored: 1, reviews: 0 }, task_id: 't', sequence: 1, timestamp: new Date().toISOString() });
    assert.ok(r);
    assert.strictEqual(r!.role, 'archivist');
    assert.strictEqual(r!.category, 'success');
  });
});

describe('Bubble System - Meaningful tool headlines (HL-TELEM-001)', () => {
  test('read_file shows "Reading <path>"', () => {
    const r = categorizeEvent({
      type: 'hermes.tool_use',
      payload: { name: 'read_file', input: { path: 'backend/research.py' } },
      task_id: 't1',
      sequence: 1,
      timestamp: new Date().toISOString(),
    });
    assert.ok(r);
    assert.strictEqual(r!.content.headline, 'Reading backend/research.py');
  });

  test('write_file shows "Writing <path>"', () => {
    const r = categorizeEvent({
      type: 'hermes.tool_use',
      payload: { name: 'write_file', input: { path: 'src/main.ts', content: 'x' } },
      task_id: 't1',
      sequence: 1,
      timestamp: new Date().toISOString(),
    });
    assert.ok(r);
    assert.strictEqual(r!.content.headline, 'Writing src/main.ts');
  });

  test('edit_file shows "Editing <path>"', () => {
    const r = categorizeEvent({
      type: 'hermes.tool_use',
      payload: { name: 'edit_file', input: { path: 'src/main.ts' } },
      task_id: 't1',
      sequence: 1,
      timestamp: new Date().toISOString(),
    });
    assert.ok(r);
    assert.strictEqual(r!.content.headline, 'Editing src/main.ts');
  });

  test('terminal shows "Running: <command>"', () => {
    const r = categorizeEvent({
      type: 'hermes.tool_use',
      payload: { name: 'terminal', input: { command: 'pytest tests/test_research.py' } },
      task_id: 't1',
      sequence: 1,
      timestamp: new Date().toISOString(),
    });
    assert.ok(r);
    assert.ok(r!.content.headline.startsWith('Running:'));
    assert.ok(r!.content.headline.includes('pytest tests/test_research.py'));
  });

  test('pytest shows "Testing <target>"', () => {
    const r = categorizeEvent({
      type: 'hermes.tool_use',
      payload: { name: 'pytest', input: { args: ['tests/'] } },
      task_id: 't1',
      sequence: 1,
      timestamp: new Date().toISOString(),
    });
    assert.ok(r);
    assert.strictEqual(r!.content.headline, 'Testing tests/');
  });

  test('grep shows "Searching for <pattern>"', () => {
    const r = categorizeEvent({
      type: 'hermes.tool_use',
      payload: { name: 'grep', input: { pattern: 'TODO' } },
      task_id: 't1',
      sequence: 1,
      timestamp: new Date().toISOString(),
    });
    assert.ok(r);
    assert.strictEqual(r!.content.headline, 'Searching for TODO');
  });

  test('ls shows "Listing <path>"', () => {
    const r = categorizeEvent({
      type: 'hermes.tool_use',
      payload: { name: 'ls', input: { path: '/home/user' } },
      task_id: 't1',
      sequence: 1,
      timestamp: new Date().toISOString(),
    });
    assert.ok(r);
    assert.strictEqual(r!.content.headline, 'Listing /home/user');
  });

  test('git shows "Git <subcommand>"', () => {
    const r = categorizeEvent({
      type: 'hermes.tool_use',
      payload: { name: 'git', input: { subcommand: 'status' } },
      task_id: 't1',
      sequence: 1,
      timestamp: new Date().toISOString(),
    });
    assert.ok(r);
    assert.strictEqual(r!.content.headline, 'Git status');
  });

  test('browse shows "Browsing <url>"', () => {
    const r = categorizeEvent({
      type: 'hermes.tool_use',
      payload: { name: 'browse', input: { url: 'https://example.com' } },
      task_id: 't1',
      sequence: 1,
      timestamp: new Date().toISOString(),
    });
    assert.ok(r);
    assert.strictEqual(r!.content.headline, 'Browsing https://example.com');
  });

  test('memory shows "Recalling <query>"', () => {
    const r = categorizeEvent({
      type: 'hermes.tool_use',
      payload: { name: 'memory', input: { query: 'project config' } },
      task_id: 't1',
      sequence: 1,
      timestamp: new Date().toISOString(),
    });
    assert.ok(r);
    assert.strictEqual(r!.content.headline, 'Recalling project config');
  });
});

describe('Bubble System - Streaming text accumulation (HL-TELEM-001)', () => {
  test('multiple hermes.text fragments accumulate in details', () => {
    const c = new BubbleController();

    // First fragment
    c.processEvent({
      type: 'hermes.text',
      sequence: 1,
      task_id: 't1',
      payload: { text: 'Analyzing the code...' },
      historical: false,
    });

    // Second fragment
    c.processEvent({
      type: 'hermes.text',
      sequence: 2,
      task_id: 't1',
      payload: { text: ' Found the issue in line 42.' },
      historical: false,
    });

    // Third fragment
    c.processEvent({
      type: 'hermes.text',
      sequence: 3,
      task_id: 't1',
      payload: { text: ' Fixing it now.' },
      historical: false,
    });

    const bubbles = c.getBubbles();
    assert.strictEqual(bubbles.length, 1);
    const bubble = bubbles[0];
    assert.strictEqual(bubble.category, 'thought');
    assert.strictEqual(bubble.content.taskId, 't1');
    // Details should accumulate all fragments
    assert.ok(bubble.content.details!.includes('Analyzing the code...'));
    assert.ok(bubble.content.details!.includes('Found the issue in line 42.'));
    assert.ok(bubble.content.details!.includes('Fixing it now.'));
    // Headline shows latest fragment
    assert.strictEqual(bubble.content.headline, 'Fixing it now.');
  });

  test('duplicate fragments are not double-counted', () => {
    const c = new BubbleController();

    c.processEvent({
      type: 'hermes.text',
      sequence: 1,
      task_id: 't1',
      payload: { text: 'Hello' },
      historical: false,
    });

    // Same fragment again (simulating cumulative snapshot)
    c.processEvent({
      type: 'hermes.text',
      sequence: 2,
      task_id: 't1',
      payload: { text: 'Hello world' },
      historical: false,
    });

    const bubbles = c.getBubbles();
    assert.strictEqual(bubbles.length, 1);
    // Should not have "HelloHello world"
    assert.ok(!bubbles[0].content.details!.includes('HelloHello'));
    assert.ok(bubbles[0].content.details!.includes('Hello world'));
  });
});

describe('Bubble System - Tool result correlation (HL-TELEM-001)', () => {
  test('tool_result updates tool_use bubble with outcome, preserving original headline', () => {
    const c = new BubbleController();

    // Tool use
    c.processEvent({
      type: 'hermes.tool_use',
      sequence: 1,
      task_id: 't1',
      payload: {
        name: 'read_file',
        tool_call_id: 'tc-1',
        input: { path: 'backend/research.py' },
      },
      historical: false,
    });

    // Tool result
    c.processEvent({
      type: 'hermes.tool_result',
      sequence: 2,
      task_id: 't1',
      payload: {
        name: 'read_file',
        tool_call_id: 'tc-1',
        output: 'file content here',
      },
      historical: false,
    });

    const bubbles = c.getBubbles();
    assert.strictEqual(bubbles.length, 1);
    const bubble = bubbles[0];
    // Original meaningful headline preserved
    assert.strictEqual(bubble.content.headline, 'Reading backend/research.py');
    // Status updated to completed
    assert.strictEqual(bubble.content.status, 'completed');
    // Details show result summary
    assert.ok(bubble.content.details!.includes('file content here'));
    // Tool name and target preserved
    assert.strictEqual(bubble.content.toolName, 'read_file');
    assert.ok(bubble.content.toolTarget!.includes('backend/research.py'));
  });

  test('failed tool_result shows error status and message', () => {
    const c = new BubbleController();

    c.processEvent({
      type: 'hermes.tool_use',
      sequence: 1,
      task_id: 't1',
      payload: {
        name: 'write_file',
        tool_call_id: 'tc-1',
        input: { path: 'src/test.ts' },
      },
      historical: false,
    });

    c.processEvent({
      type: 'hermes.tool_result',
      sequence: 2,
      task_id: 't1',
      payload: {
        name: 'write_file',
        tool_call_id: 'tc-1',
        is_error: true,
        error: 'Permission denied',
      },
      historical: false,
    });

    const bubbles = c.getBubbles();
    assert.strictEqual(bubbles.length, 1);
    const bubble = bubbles[0];
    assert.strictEqual(bubble.content.headline, 'Writing src/test.ts');
    assert.strictEqual(bubble.content.status, 'failed');
    assert.ok(bubble.content.details!.startsWith('Error:'));
    assert.ok(bubble.content.details!.includes('Permission denied'));
  });
});