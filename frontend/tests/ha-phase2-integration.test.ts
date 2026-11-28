/**
 * Phase 2 (HA-001–HA-047 build spec) — integration-chain contracts.
 *
 * Source-contract pins in the style of chat-audit-layout.test.ts: these guard
 * the control-flow pairings the audit found broken (a producer without a
 * consumer, a consumer unreachable behind a guard) so they cannot silently
 * regress. Behavioral coverage lives in the backend pytest modules
 * (test_apply_events, test_workflow_labels) and the user's runtime verification.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const ide = readFileSync(join(src, 'phase412-project-ui.ts'), 'utf8');
const attach = readFileSync(join(src, 'chat-attach.ts'), 'utf8');
const main = readFileSync(join(src, 'main.v2.ts'), 'utf8');
const review = readFileSync(join(src, 'phase415-review.ts'), 'utf8');

// ── HA-005: chat file links open the resource (D3 was never really fixed) ──

test('HA-005: pendingOpen is consumed BEFORE the saved-tabs guard', () => {
    const guard = ide.indexOf('if(!saved||!Array.isArray(saved.docs)');
    const consume = ide.indexOf('if(pendingOpen){const t=pendingOpen');
    assert(guard > -1, 'saved-tabs guard still present');
    assert(consume > -1, 'pendingOpen consumption still present');
    assert(consume < guard,
        'pendingOpen must be consumed before the saved-tabs early-return (the old placement never fired)');
});

test('HA-005: same-project and workspace-relative links open directly', () => {
    assert(ide.includes('void openFile(path);'),
        'workspace-relative branch must call openFile directly');
    assert(ide.includes('void openFile(rel);'),
        'same-project absolute branch must call openFile directly');
    assert(ide.includes('selectProject(target,true)'),
        'cross-project handoff must keep pendingOpen (fromOpenFile=true)');
});

test('HA-005: a user-driven project selection drops stale open requests', () => {
    assert(ide.includes('if(!fromOpenFile)pendingOpen=null;'),
        'explicit selection must clear pendingOpen; the open-file path must not');
});

// ── HA-008: conversation scope is explicit, never the IDE selection ────────

test('HA-008: @project injection reads the conversation scope map', () => {
    assert(ide.includes('projectByConversation()[conversationIdNow()]'),
        'injection must read the per-conversation scope');
    assert(!ide.includes("const name=choice();if(!name)return;const value="),
        'injection must NOT fall back to the live IDE selection (spec §4.4)');
});

test('HA-008: scope chip exists and owns all scope writes', () => {
    assert(attach.includes('mountScopeChip'), 'composer scope chip must be mounted');
    assert(attach.includes('export function setConversationScope'),
        'scope writes go through the chip-owned helper');
    assert(attach.includes('export function getConversationScope'),
        'scope reads are shared');
    assert(ide.includes('getConversationScope') || ide.includes('projectByConversation()'),
        'the Projects side must read the shared scope');
});

// ── HA-013: unsaved edits survive tab switches ────────────────────────────

test('HA-013: openFile stashes and restores dirty buffers', () => {
    const openAt = ide.indexOf('async function openFile(path:string){');
    assert(openAt > -1);
    const body = ide.slice(openAt, ide.indexOf('sbEditBtn.onclick', openAt));
    assert(body.includes('dirtyBuffers[outgoing]'),
        'outgoing dirty content must be stashed before it can be replaced');
    assert(body.includes('dirtyBuffers[path]'),
        'a dirty buffer must be restored instead of re-fetching the host copy');
});

test('HA-013: file.changed flags conflicts on ANY open dirty doc', () => {
    assert(ide.includes('if(!p.path||!openDocs.includes(p.path))return;'),
        'the live-update handler must cover every open doc, not just the active one');
    assert(!ide.includes('if(!st||!p.path||p.path!==st.path)return;'),
        'the old active-doc-only guard must be gone');
});

// ── HA-006: apply refresh (frontend half) ─────────────────────────────────

test('HA-006: the Projects apply button refreshes after success', () => {
    assert(ide.includes('HA-006: refresh even without the event'),
        'apply must refresh the workspace even if the event is missed');
});

// ── HA-044: one canonical conversation key ────────────────────────────────

test('HA-044: Home composer shares the Chat tab conversation key', () => {
    assert(main.includes("const CONV_KEY = 'hermes-life-chat-conversation'"),
        'canonical key must be the Chat tab key');
    assert(!main.includes("localStorage.getItem('hermes-life-conversation-id')"),
        'no direct reads of the legacy key (read fallback goes through currentConversationId)');
    assert(main.includes('currentConversationId()') && main.includes('rememberConversationId('),
        'both submission paths must use the shared helpers');
});

// ── HA-045: file-reference chips carry absolute host paths ────────────────

test('HA-045: send-file-reference resolves against the workspace root', () => {
    assert(ide.includes("host_path.replace(/\\/+$/,'')+'/'+path"),
        'tree-relative paths must resolve to absolute host paths before chipping');
});

// ── HA-007: accepted candidates can be applied to the host ────────────────

test('HA-007: the accepted-run card offers Apply to host via the API pair', () => {
    assert(review.includes("btn('Apply to host'"), 'apply action must exist');
    assert(review.includes('/apply-preview'), 'apply must preview blockers first');
    assert(review.includes("/apply`,'POST'"), 'apply must call the apply endpoint');
    assert(review.includes("run?.state)==='applied'?'Applied to host working tree'"),
        'the label must distinguish accepted-not-applied from applied');
});
