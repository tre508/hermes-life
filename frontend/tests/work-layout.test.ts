/**
 * UUX-004F — Layout and scrolling after isolation (structural gate).
 *
 * Static checks over the shipped CSS/HTML that encode the acceptance
 * criteria: one canonical .work-grid, per-panel scroll scoping, no
 * superseded .work-management stack, context stays accessible at
 * narrow widths (not display:none), composer pinned, and the five
 * exclusive workview panels in the document.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../src/unified-layout.css'), 'utf8');
const html = readFileSync(join(here, '../index.html'), 'utf8');

test('exactly one canonical .work-grid rule remains (no superseded duplicates)', () => {
    // Strip @media blocks: responsive overrides may legitimately restate
    // the selector; the base definition must exist exactly once.
    const base = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
    const definitions = base.match(/\.work-grid\s*\{/g) ?? [];
    assert.equal(definitions.length, 1, `expected one base .work-grid definition, found ${definitions.length}`);
    // And it is scoped to the Tasks panel — never a bare #app-wide rule.
    assert.doesNotMatch(base, /#app \.work-grid \{/);
    assert.match(css, /#workview-tasks \.work-grid \{/);
});

test('tasks grid stretches columns so inner panels can own their scroll', () => {
    const block = css.slice(css.indexOf('#workview-tasks .work-grid {'));
    const rule = block.slice(0, block.indexOf('}'));
    assert.match(rule, /align-items:\s*stretch/);
    assert.match(rule, /min-height:\s*0/);
});

test('task list scrolls independently; page does not scroll under Work', () => {
    assert.match(css, /#workview-tasks \.work-list \{[^}]*overflow-y:\s*auto/);
    assert.match(css, /#workspace-work \{[^}]*overflow:\s*hidden/);
    assert.match(css, /#workview-tasks:not\(\[hidden\]\) \{[^}]*overflow:\s*hidden/);
});

test('context column keeps its own scroll and never crushes task content', () => {
    assert.match(css, /#workview-tasks \.work-context \{[^}]*overflow-y:\s*auto/);
});

test('composer stays pinned: shell fills, thread scrolls, composer does not shrink away', () => {
    assert.match(css, /#task-detail-container:not\(\[hidden\]\) \{[^}]*flex:\s*1 1 auto/);
    assert.match(css, /\.task-composer-host \{[^}]*flex:\s*0 0 auto/);
    assert.match(css, /\.task-thread-host \{[^}]*overflow-y:\s*auto/);
});

test('narrow viewport keeps approval controls accessible (context moves below, not hidden)', () => {
    const mq = css.slice(css.indexOf('@media (max-width: 1500px)'));
    const narrow = mq.slice(0, mq.indexOf('@media (max-width: 1100px)'));
    assert.ok(narrow.length > 0, '1500px breakpoint exists');
    assert.doesNotMatch(narrow, /\.work-context \{[^}]*display:\s*none/, 'context must not be display:none at ≤1500px');
    assert.match(narrow, /\.work-context \{[^}]*max-height:\s*240px/);
});

test('mobile breakpoint stacks columns and caps the thread so the composer stays reachable', () => {
    const mq = css.slice(css.indexOf('@media (max-width: 1100px)'));
    assert.ok(mq.length > 0, '1100px breakpoint exists');
    assert.match(mq, /\.task-thread-host \{[^}]*max-height:\s*50vh/);
    assert.match(mq, /\.work-list \{[^}]*max-height:\s*40vh/);
});

test('superseded .work-management stack is gone from CSS and HTML', () => {
    assert.doesNotMatch(css, /\.work-management/);
    assert.doesNotMatch(html, /work-management/);
});

test('five exclusive workview panels + outlet exist in the document', () => {
    for (const id of ['workview-outlet', 'workview-tasks', 'workview-discover', 'workview-goals', 'workview-planning', 'workview-build']) {
        assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
    }
    // Only the Tasks panel ships visible by default; the rest are hidden.
    const panels = html.match(/<section id="workview-[a-z]+" class="workview-panel"[^>]*>/g) ?? [];
    assert.equal(panels.length, 5);
    const hiddenCount = panels.filter(p => p.includes('hidden')).length;
    assert.equal(hiddenCount, 4, 'exactly four panels start hidden');
});

test('global Work panels (Discover/Goals/Planning/Build) own their scroll', () => {
    assert.match(css, /#workview-discover:not\(\[hidden\]\),[^}]*overflow-y:\s*auto/);
    assert.match(css, /#workview-goals:not\(\[hidden\]\),/);
    assert.match(css, /#workview-planning:not\(\[hidden\]\),/);
    assert.match(css, /#workview-build:not\(\[hidden\]\) \{[^}]*overflow-y:\s*auto/);
});

test('single Command Centre identity: one #primary-nav, one #game, seven roles/eight rooms untouched', () => {
    assert.equal((html.match(/id="primary-nav"/g) ?? []).length, 1);
    assert.equal((html.match(/id="game"/g) ?? []).length, 1);
    const roomLinks = html.match(/data-hc-room="/g) ?? [];
    assert.equal(roomLinks.length, 8, 'eight physical room shortcuts');
});
