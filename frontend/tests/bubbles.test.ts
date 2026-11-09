/**
 * Tests for the bubble system (UI-VIS-007)
 * Run with: node --import tsx --test tests/bubbles.test.ts
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { categorizeEvent, BubbleController } from '../src/town-world/bubbles';

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