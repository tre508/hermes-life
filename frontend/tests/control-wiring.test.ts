/** UI-01 regression: a control that cannot act must not be shown as if it could.
 *
 * The Goals/Planning/Build tabs replaced their legacy markup item by item. Lists were re-owned,
 * the control cluster was not: `#goals-refresh`, `#autonomy-toggle`, `#goal-form`,
 * `#plans-refresh`, `#implementations-refresh` and the Goal-formulation block stayed visible with
 * no handler in any live module, so a goal could not be created and the scheduler could not be
 * operated. These tests turn that class of defect into a build failure.
 *
 * Rule: every interactive element in index.html is either referenced by a live module (it can act)
 * or listed as deliberately hidden (it cannot act and is not shown). Placeholder text may never
 * claim work that is not happening.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const srcDir = join(frontend, 'src');
const isBackup = (name: string) => /\.(before-|pre-|bak|backup)/.test(name) || name.endsWith('.backup');
const liveSources = readdirSync(srcDir)
  .filter(name => name.endsWith('.ts') && !isBackup(name))
  .map(name => readFileSync(join(srcDir, name), 'utf8'))
  .join('\n');
const html = readFileSync(join(frontend, 'index.html'), 'utf8');

/** Controls a tab module hides on purpose (its own replacement renders elsewhere). */
const HIDDEN_BY_MODULE = new Set([
  // Discover: the rework hides the whole legacy block, including the discovery/decision controls.
  'decision-state', 'decision-interval', 'decision-toggle', 'decision-scan', 'decision-feedback',
  'discovery-scan', 'discovery-refresh', 'discovery-status',
  // Planning/Build: the review tab renders its own refresh control and hides the duplicates.
  'plans-refresh', 'implementations-refresh', 'formulation-section', 'formulation-feedback',
  'formulations-refresh', 'formulation-list',
  // Goals: the flow pane renders its own Refresh, so the legacy duplicate is hidden too.
  'goals-refresh',
]);

/** Controls the user must be able to operate, with their live owner. */
const MUST_BE_WIRED = {
  'autonomy-toggle': 'enables or pauses the scheduler',
  'goal-form': 'creates a goal',
  'autonomy-status': 'shows the scheduler state',
  'overview-autonomy-status': 'shows the scheduler state on Overview',
  // HL-PERS-001 §5F: the learned profile has to be inspectable and correctable from the product.
  'memory-refresh': 'reloads the learned profile, reviews and lessons',
  'memory-correct-form': 'applies a correction with a recorded reason',
  'memory-correct-action': 'picks supersede, delete or merge',
  'memory-correct-rationale': 'records why the profile changed',
};

function interactiveIds(): string[] {
  const tags = html.match(/<(?:button|input|textarea|select|form)\b[^>]*>/g) ?? [];
  return [...new Set(tags.map(tag => /\bid="([^"]+)"/.exec(tag)?.[1]).filter((id): id is string => !!id))];
}

/** Submit buttons inside a form whose id a live module references are covered by that form's handler.
 *  This does not weaken the rule: the form still has to be referenced (and, for the goal and
 *  correction forms, MUST_BE_WIRED + a route test insist it actually submits). */
function coveredByWiredForm(): Set<string> {
  const covered = new Set<string>();
  for (const form of html.match(/<form\b[^>]*>.*?<\/form>/gs) ?? []) {
    const formId = /\bid="([^"]+)"/.exec(form)?.[1];
    if (!formId || !liveSources.includes(formId)) continue;
    for (const tag of form.match(/<button\b[^>]*type="submit"[^>]*>/g) ?? []) {
      const id = /\bid="([^"]+)"/.exec(tag)?.[1];
      if (id) covered.add(id);
    }
  }
  return covered;
}

test('every interactive control is wired or deliberately hidden', () => {
  const covered = coveredByWiredForm();
  const dead = interactiveIds().filter(id =>
    !liveSources.includes(id) && !HIDDEN_BY_MODULE.has(id) && !covered.has(id));
  assert.deepEqual(dead, [], `visible but unreachable controls: ${dead.join(', ')}`);
});

test('the goal and scheduler controls are wired by a live module', () => {
  const missing = Object.keys(MUST_BE_WIRED).filter(id => !liveSources.includes(id));
  assert.deepEqual(missing, [], `controls that must act: ${missing.join(', ')}`);
});

test('the goal form submits through the goals API, not into the void', () => {
  const workflow = readFileSync(join(srcDir, 'phase41302-workflow.ts'), 'utf8');
  assert.match(workflow, /addEventListener\('submit'/, 'the goal form needs a submit handler');
  assert.match(workflow, /api\('\/goals','POST'/, 'the goal form must POST to /api/goals');
  assert.match(workflow, /api\('\/autonomy','PUT'/, 'the scheduler toggle must PUT /api/autonomy');
  assert.match(workflow, /api\('\/autonomy'\)/, 'the scheduler state must be read, not assumed');
});

test('the learned profile can be inspected, corrected and reviewed from the UI', () => {
  const memory = readFileSync(join(srcDir, 'phase41303-memory.ts'), 'utf8');
  assert.match(memory, /api\('\/personality\/profile'\)/, 'the profile must be read');
  assert.match(memory, /api\('\/memory-reviews'\)/, 'pending candidates must be listed');
  assert.match(memory, /api\('\/technical-lessons/, 'lessons must be listed');
  assert.match(memory, /\/correct',\s*'POST'|\/correct`,'POST'/, 'the surface must reach the correction route');
  assert.match(memory, /\/resolve`,'POST'|\/resolve',\s*'POST'/, 'the surface must reach the review route');
  assert.match(memory, /evidence_excerpt/, 'a memory must show the evidence behind it');
  assert.match(memory, /persona-feedback/, 'the outcome must be reported on the persona card');
  assert.match(memory, /rationale/, 'a correction must carry a reason');
});

test('no placeholder claims work that is not happening', () => {
  assert.doesNotMatch(html, /Checking…/, 'a static "Checking…" claims activity that never occurs');
});
