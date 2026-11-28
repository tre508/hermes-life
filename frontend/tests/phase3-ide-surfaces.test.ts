/**
 * Phase-3 IDE surface fixes (HA-010/HA-011/HA-040/HA-041/HA-042/HA-043).
 *
 * Source-contract pins in the style of chat-audit-layout.test.ts: the phantom
 * split pane, the retired attachment meter, rendered .md previews, per-extension
 * tree glyphs, the resizable bottom panel and Recent Workspaces must not
 * silently regress. The attachment MODE contract is shared with the chat
 * composer (another workstream) — the shared key shape is pinned here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const ui = readFileSync(join(src, 'phase412-project-ui.ts'), 'utf8');
const css = readFileSync(join(src, 'phase415-workspace.css'), 'utf8');

test('HA-010 the split pane cannot render while hidden', () => {
    // #hc415-split sets display:flex, which beats the UA [hidden] rule — the
    // pane rendered permanently despite hidden=true. Every toggled region
    // carries its own display guard (the file's own convention); the split pane
    // now does too.
    assert.match(css, /#hc415-split\{[^}]*display:flex/);
    assert.match(css, /#hc415-split\[hidden\]\{display:none!important\}/);
    assert.match(ui, /splitPane\.hidden=true/, 'the pane still mounts hidden');
});

test('HA-011 the IDE has no permanent attachment meter', () => {
    // Spec §4.3 forbids a permanent attachment panel in the IDE — the mount
    // code must not even create #hc415-file-meter, and the mode-chips/status
    // chrome that lived on it is gone with it.
    assert.ok(!/hc415-file-meter/.test(ui), 'the meter is not created or mounted');
    assert.ok(!/hc415-file-meter/.test(css), 'and its rules are gone too');
    assert.ok(!/sbMeter/.test(ui), 'no meter node');
    assert.ok(!/renderModeChips/.test(ui), 'no mode-chip chrome');
    assert.ok(!/setMode/.test(ui), 'no mode setter — the composer owns the control');
    assert.ok(!/renderAttachments/.test(ui), 'no meter renderer');
    // verLabel() and the mode strings inside the COMPOSED attachment blocks
    // stay — the mode still shapes what is sent.
    assert.match(ui, /function verLabel\(\)/);
    assert.match(ui, /· mode A\]/);
    assert.match(ui, /· mode B\]/);
    assert.match(ui, /· mode C\]/);
    // The contextual attach ACTIONS are spec-permitted (§4.4) and stay.
    assert.match(ui, /sbAttachToggle=button\('＋ Attach','hc415-preview-attach'\)/);
    assert.match(ui, /attach\.onclick=\(ev\)=>\{ev\.stopPropagation\(\);void toggleFile\(node\.path\)\}/);
    assert.match(ui, /sbAttachToggle\.onclick=\(\)=>\{const p=openFileState\?\.path;if\(!p\)return;void toggleFile\(p\)\.then\(syncPreviewAttach\)\}/);
});

test('HA-011 attachMode(name) reads the shared composer-owned mode map', () => {
    // The composer writes key 'hermes-life-chat-attach-mode' as a localStorage
    // JSON map {projectSlug:'A'|'B'|'C'}, keyed by the conversation's scope
    // project or '' for unscoped. This side only reads it — scope-keyed, with
    // 'A' as the default — and the submit injection passes the scope `name` it
    // already computes.
    assert.match(ui, /MODE_KEY='hermes-life-chat-attach-mode'/);
    assert.match(ui, /function attachMode\(scope:string\):AttachMode\{/);
    assert.ok(!/function attachMode\(\)/.test(ui), 'the zero-arg contract is gone');
    assert.match(ui, /modeMap\[scope\|\|''\]\|\|'A'/, 'scope-keyed lookup with default A');
    assert.match(ui, /localStorage\.getItem\(MODE_KEY\)/, 'reads the shared key shape');
    assert.match(ui, /const m=attachMode\(name\)/, 'the submit injection passes the scope');
});

test('HA-040 .md files render through the safe Markdown renderer with a Source toggle', () => {
    assert.match(ui, /import \{renderHermesMarkdown\} from '\.\/chat-markdown\.ts'/);
    assert.match(ui, /function paintMdView\(\)/);
    assert.ok(ui.includes('renderHermesMarkdown(sbMd,sbEditor.value)'),
        'rendered into the preview container via the existing safe renderer');
    // Default for .md is the RENDERED preview; the head toggle reads Source and
    // flips to the raw text view (and back).
    assert.ok(ui.includes(String.raw`/\.md$/i.test(openFileState?.path||'')`),
        'the toggle is wired per extension');
    assert.match(ui, /sbViewToggle\.textContent=mdRendered\?'Source':'Preview'/);
    assert.match(ui, /sbViewToggle\.onclick=\(\)=>\{mdRendered=!mdRendered;paintMdView\(\)\}/);
    assert.ok(ui.includes('mdRendered=true; // HA-040'),
        'a freshly opened .md starts on the rendered preview');
    // A renderer failure falls back to the raw text view, never a blank pane.
    assert.match(ui, /catch\{sbMd\.hidden=true;sbPreview\.hidden=false\}/);
    // Read mode paints it; the rendered view has its own container + guard.
    const readMode = ui.slice(ui.indexOf('function previewReadMode('), ui.indexOf('function paintMdView('));
    assert.match(readMode, /paintMdView\(\);/);
    assert.match(ui, /id='hc415-md-view'/);
    assert.match(ui, /id='hc415-md-toggle'/);
    assert.match(css, /#hc415-md-view\{/);
    assert.match(css, /#hc415-md-view\[hidden\]\{display:none!important\}/);
});

test('HA-041 tree rows carry per-extension glyphs', () => {
    // The generic '·' glyph is gone: file rows use the same GLYPHS map the tab
    // icons use, through fileGlyph(node.path).
    assert.match(ui, /icon\.textContent=node\.isDir\?\(expanded\.has\(node\.path\)\?'▾':'▸'\):fileGlyph\(node\.path\);/);
    assert.match(ui, /function fileGlyph\(p:string\)/);
    assert.ok(!/attached\.has\(node\.path\)\?'✓':'·'/.test(ui), 'the generic dot is gone');
});

test('HA-042 the bottom panel is resizable and remembers its height', () => {
    // Modelled on the sidebar grip: a drag grip ABOVE the bottom tabs that
    // persists the height in localStorage and restores it on mount.
    assert.match(ui, /bottomGrip\.id='hc415-bottom-grip'/);
    assert.match(ui, /bottom\.insertBefore\(bottomGrip,bottomTabs\)/, 'the grip sits above the tabs');
    assert.match(ui, /bottomGrip\.addEventListener\('pointerdown'/);
    assert.match(ui, /BOTTOM_H_KEY='hermes-life-ide-bottom-h'/);
    assert.match(ui, /localStorage\.setItem\(BOTTOM_H_KEY,String\(h\)\)/, 'the height persists');
    assert.match(ui, /localStorage\.getItem\(BOTTOM_H_KEY\)/, 'and is restored');
    assert.match(css, /#hc415-bottom-grip\{[^}]*cursor:row-resize/);
});

test('HA-043 the workspace dialog offers Recent Workspaces (MRU)', () => {
    // Last ~5 opened workspaces in localStorage, at the TOP of the SELECT
    // WORKSPACE dialog; clicking one selects it and closes the dialog.
    assert.match(ui, /RECENT_KEY='hermes-life-recent-workspaces'/);
    assert.match(ui, /wsSelect\.insertBefore\(wsRecent,wsList\)/, 'the MRU list is at the top of the dialog');
    assert.match(ui, /'Recent Workspaces'/);
    assert.match(ui, /\.slice\(0,5\)/, 'the list is capped at five');
    assert.match(ui, /b\.onclick=\(\)=>\{closeWsSelect\(\);if\(choice\(\)!==n\)selectProject\(n\)\}/,
        'clicking a recent workspace selects it');
    assert.match(ui, /rememberRecent\(name\)/, 'opened workspaces are recorded');
    assert.match(ui, /function renderSelector\(\)\{\s*renderSelectorLabel\(\);\s*renderRecent\(\);/,
        'the dialog repaints the list when it opens');
    assert.match(css, /#hc415-ws-recent/);
});
