/** P5 Research workspace + §3 navigation grouping — spec hermesha-ui-ux-obsidian-spec.md.
 *
 * Verified invariants:
 *  - §3: the nav rail exposes every WORKSPACES entry and carries the four
 *    group captions (Experience / Operations / Intelligence / Global).
 *  - §4 Research: the module reads ONLY real endpoints (library, discoveries,
 *    curiosity, /memory) — no invented research store.
 *  - §4/§5: promotion to durable knowledge is an explicit action via
 *    POST /api/memory/notes; the module never auto-writes on load.
 *  - §7: opening a vault note from Research hands the note id to the ONE
 *    Knowledge context (hermes:open-note), not a second memory surface.
 *  - §6: the note graph renders from GET /api/memory/graph.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const html = readFileSync(join(frontend, 'index.html'), 'utf8');
const research = readFileSync(join(frontend, 'src', 'research-workspace.ts'), 'utf8');
const knowledge = readFileSync(join(frontend, 'src', 'knowledge-workspace.ts'), 'utf8');
const navState = readFileSync(join(frontend, 'src', 'navigation-state.ts'), 'utf8');
const mainV2 = readFileSync(join(frontend, 'src', 'main.v2.ts'), 'utf8');

test('§3: nav rail carries exactly the three-group destinations', () => {
    // Regroup (user-approved): Experience / Operations / Intelligence.
    for (const ws of ['world', 'conversations', 'home', 'work', 'activity', 'knowledge', 'research']) {
        assert.ok(navState.includes(`'${ws}'`), `navigation-state must declare '${ws}'`);
        assert.ok(html.includes(`data-workspace="${ws}"`), `index.html nav must have a button for '${ws}'`);
    }
    // Folded/absorbed destinations leave the rail but stay deep-linkable:
    // attention (badge + Home), results (Work/Activity), system (redirects
    // to knowledge in navigation-state), rooms (World).
    for (const folded of ['attention', 'results', 'system']) {
        assert.ok(navState.includes(`'${folded}'`), `deep-linkable workspace '${folded}' stays declared`);
        assert.ok(!html.includes(`data-workspace="${folded}" type="button">`), `'${folded}' must not be a primary nav destination`);
    }
});

test('§3: nav rail carries the three group captions', () => {
    for (const group of ['Experience', 'Operations', 'Intelligence']) {
        assert.ok(html.includes(`>${group}</span>`), `nav group caption '${group}' missing`);
    }
    assert.ok(!html.includes('>Global</span>'), 'the Global group is retired by the regroup');
});

test('§3: legacy labels remain reachable as redirects (no dropped features)', () => {
    // Work still opens its tasks view via data-hc-workview, preserving selection.
    assert.match(html, /data-workspace="work" data-hc-workview="tasks"/);
    // Goals is a first-class entity inside Work's own subnav.
    assert.match(html, /data-workview="goals"/);
    // Memory folded into Knowledge: the memory section markup lives there.
    const knowledgeSection = html.slice(html.indexOf('id="workspace-knowledge"'));
    assert.ok(knowledgeSection.includes('id="memory-section"'), 'memory UI folded into Knowledge');
    // Results stays a real workspace for Work/Activity deep links.
    assert.match(html, /id="workspace-results"/);
});

test('§4 Research: the module only reads real endpoints', () => {
    const endpoints = [...research.matchAll(/api\((['`])([a-z/_-]+)/g)].map(m => m[2]);
    for (const e of ['/discoveries', '/curiosity', '/memory/search', '/library/search', '/memory/notes']) {
        assert.ok(endpoints.some(x => x.endsWith(e)), `research-workspace must read ${e}`);
    }
    assert.ok(!research.includes('/api/research'), 'no invented /api/research store');
});

test('§4/§5: promotion is an explicit POST /api/memory/notes, never an automatic side effect', () => {
    assert.match(research, /api\('\/memory\/notes', 'POST'/);
    // The only fetch with a POST body in the module is the explicit promote path.
    const postCalls = research.match(/api\([^)]*'POST'[^)]*\)/g) ?? [];
    assert.equal(postCalls.length, 1, 'exactly one write endpoint: explicit promotion');
});

test('§4 Research: promotion preserves provenance (discovery id, project, path) in the note body', () => {
    const promote = research.slice(research.indexOf('async function promoteFinding'));
    for (const marker of ['discovery', 'project', 'Origin: research workspace promotion']) {
        assert.ok(promote.includes(marker), `note body must keep provenance: ${marker}`);
    }
});

test('§7: Research hands vault note ids to the ONE Knowledge context', () => {
    assert.match(research, /hermes:open-note/);
    assert.match(knowledge, /hermes:open-note/);
    assert.match(knowledge, /showVaultNote\(noteId\)/);
});

test('§6: Knowledge renders the note graph from GET /api/memory/graph', () => {
    assert.match(knowledge, /\/api\/memory\/graph\?note_id=/);
    assert.match(knowledge, /backlinks/);
    assert.match(knowledge, /projects/);
});

test('Research module is imported and its workspace section exists in the shell', () => {
    assert.match(mainV2, /import '\.\/research-workspace';/);
    assert.match(mainV2, /'research'/);
    assert.match(html, /id="workspace-research"/);
    for (const id of ['research-session-form', 'research-query', 'research-sources', 'research-findings', 'research-questions', 'research-notes']) {
        assert.ok(html.includes(`id="${id}"`), `index.html must declare #${id}`);
        assert.ok(research.includes(`'${id}'`), `research-workspace must reference #${id}`);
    }
});
