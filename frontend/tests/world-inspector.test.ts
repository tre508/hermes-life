/**
 * HL-UI-PLAN-001 §4.3.3 — contextual inspector selection types on Home.
 * One inspector ring (context-inspector.ts). A World bubble click selects the real
 * event; residents (incl. Hermes) and rooms keep their existing cards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const inspector = readFileSync(join(frontend, 'src', 'context-inspector.ts'), 'utf8');
const bubbles = readFileSync(join(frontend, 'src', 'town-world', 'bubbles.ts'), 'utf8');

test('bubble is a typed inspector kind with a label and a card renderer', () => {
    assert.match(inspector, /export type InspectorKind = SelectionKind \| 'resident' \| 'bubble';/);
    assert.match(inspector, /bubble: 'Execution event'/);
    assert.match(inspector, /registerKindRenderer\('bubble'/);
});

test('a bubble click dispatches the event the inspector listens for', () => {
    assert.match(bubbles, /new CustomEvent\('hermes:bubble-select'/);
    assert.match(inspector, /window\.addEventListener\('hermes:bubble-select'/);
});

test('the bubble card shows only recorded fields and links the task only when one exists', () => {
    assert.match(inspector, /if \(r\.taskId\) \{[\s\S]*Open task/);
    assert.match(inspector, /Shown for/);
    assert.ok(!/Hermes executed|executed by/i.test(inspector.slice(inspector.indexOf("registerKindRenderer('bubble'"), inspector.indexOf("registerKindRenderer('resident'"))),
        'never infer the executing resident (UI-VIS-007)');
});

test('the bubble selection is the inspector-owned selection and does not touch navigation state', () => {
    assert.match(inspector, /setInspectorSelection\(\{\s*kind: 'bubble'/);
});
