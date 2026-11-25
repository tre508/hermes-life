/**
 * HERMESHA §10 — the five operational questions, uniform across every
 * selection surface.
 *
 * Spec §10: different views may present the answers differently; they cannot
 * contradict one another. The uniform line builder (five-questions.ts) is the
 * contract; each card feeds it from the same records its host view renders.
 * The Attention Center's item cards (Why / Evidence / Authority / Next action)
 * predate this pass and stay untouched as the reference implementation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const src = (name: string): string => readFileSync(join(frontend, 'src', name), 'utf8');

// ---- minimal DOM stub BEFORE importing the module ----
const g = globalThis as unknown as Record<string, unknown>;
const made: Array<{ tag: string; cls: string; kids: Array<{ text: string; strong?: boolean }> }> = [];
g.document = {
    getElementById: () => null,
    createElement: (tag: string) => {
        const el: Record<string, unknown> = {
            style: {}, dataset: {}, children: [] as unknown[],
            className: '',
            append(...nodes: unknown[]) { (el.children as unknown[]).push(...nodes); },
            set textContent(v: string) { (el as { _text?: string })._text = v; },
            get textContent() { return (el as { _text?: string })._text ?? ''; },
        };
        made.push({ tag, cls: String(el.className), kids: [] });
        return el;
    },
    createTextNode: (text: string) => ({ text, strong: false }),
    addEventListener: () => { /* noop */ },
};
const mod = await import('../src/five-questions.ts');
const { FQ, fqLine } = mod as typeof import('../src/five-questions.ts');

test('the contract exposes the four labeled questions (actions are the card’s own buttons)', () => {
    assert.deepEqual(Object.values(FQ), ['Status', 'Why', 'Evidence', 'Decision needed']);
});

test('fqLine renders a tagged, labeled line', () => {
    const p = fqLine(FQ.why, 'project vid-gayzer — fix the flaky test') as unknown as {
        className: string; dataset: Record<string, string>; children: Array<{ text?: string; strong?: boolean }>;
    };
    assert.equal(p.className, 'fq-line');
    assert.equal(p.dataset.question, 'Why');
    const label = p.children[0] as { textContent?: string };
    assert.equal(label.textContent, 'Why: ');
    const answer = p.children[1] as { text?: string };
    assert.equal(answer.text, 'project vid-gayzer — fix the flaky test');
});

/* ------------------------------------------------------------------ surfaces */

test('the task inspector card answers with the SAME chain record as the center card', () => {
    const ui = src('work-workspace.ts');
    assert.match(ui, /import \{ FQ, fqLine \} from '\.\/five-questions\.ts'/);
    // Ownership comes from chainByTask (c?.project / c?.reason) — the same fields
    // buildFactsCard renders. No second truth.
    assert.match(ui, /fqLine\(FQ\.why, c\?\.project/);
    assert.match(ui, /fqLine\(FQ\.status, `\$\{str\(t\.state\)\} · \$\{c \? str\(c\.status\)/);
    assert.match(ui, /fqLine\(FQ\.evidence, `chain stage/);
    // A pending human gate is named, not hidden.
    assert.match(ui, /next === 'approve_plan' \|\| next === 'review_investigation'/);
});

test('the goal card reuses the Goals list’s derived-status helpers', () => {
    const ui = src('phase41302-workflow.ts');
    assert.match(ui, /fqLine\(FQ\.evidence,`derived status: \$\{status\(g\)\}/);
    assert.match(ui, /fqLine\(FQ\.why,p\?p\.length>300/);
});

test('the discovery card carries real next operations, not only a pointer', () => {
    const ui = src('phase41301-rework.ts');
    assert.match(ui, /fqLine\(FQ\.status,`\$\{val\(dsc\.state\)\} · \$\{stage\(dsc\)\}`\)/);
    assert.match(ui, /fqLine\(FQ\.why,val\(dsc\.project\)/);
    assert.match(ui, /btn\('Investigate',\(\)=>void investigate\(dsc\)\)/);
    assert.match(ui, /btn\('View findings',\(\)=>openTask\(val\(dsc\.task_id\)/);
});

test('World cards use the same labels: room Why line, resident Why with the goal title', () => {
    const ui = src('town-view.ts');
    assert.match(ui, /fqLine\(FQ\.why, here\.length/);
    assert.match(ui, /\['Why', isAutonomousTask\(resident\.taskId\)/);
    assert.match(ui, /goalTitles\.get\(resident\.taskId\)/, 'the why names its cause, not just the classification');
    // "What actually happened" rides with the linked work.
    assert.match(ui, /last event \$\{res\.eventType\}/);
});

test('the Attention Center stays the reference implementation (untouched labels)', () => {
    const ui = src('attention-center.ts');
    assert.match(ui, /Why/);
    assert.match(ui, /Evidence/);
    assert.match(ui, /authority:/);
    assert.match(ui, /actionLabel:/);
});

test('the uniform line has styling in the shell stylesheet', () => {
    const css = src('unified-layout.css');
    assert.match(css, /\.fq-line \{/);
    assert.match(css, /\.fq-line strong/);
});
