/**
 * D7 (chat drafts wired to the ONE ledger) + D9 (Projects→Chat send actions).
 * Source-contract style, same as chat-attach-fs.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const chat = readFileSync(join(src, 'hermes-chat.ts'), 'utf8');
const attach = readFileSync(join(src, 'chat-attach.ts'), 'utf8');
const ui = readFileSync(join(src, 'phase412-project-ui.ts'), 'utf8');
const lib = readFileSync(join(src, 'project-editor-lib.ts'), 'utf8');

// --- D7: drafts --------------------------------------------------------------

test('the chat composer uses the shared conv-composer draft ledger', () => {
    assert.match(chat, /import \{ readDraft, writeDraft, clearDraft \} from '\.\/conv-composer'/,
        'one ledger, no second implementation');
});

test('typing persists the draft; switching conversations swaps drafts', () => {
    assert.match(chat, /addEventListener\('input',\(\)=>\{saveChatDraft\(\);autogrow\(\)\}\)/,
        'every keystroke persists');
    assert.match(chat, /function switchChatDraft\(nextConversationId:string\)/, 'switch = save outgoing + restore incoming');
    assert.match(chat, /switchChatDraft\(t\.id\)/, 'thread selection goes through the ledger');
    assert.match(chat, /switchChatDraft\(''\)/, 'New chat goes through the ledger');
});

test('the draft clears only after the backend acknowledges the send', () => {
    const submit = chat.slice(chat.indexOf("el('hc-form').addEventListener('submit'"), chat.indexOf("el('hc-input') as HTMLTextAreaElement).addEventListener('keydown'"));
    assert.ok(submit.length > 0, 'the submit handler is located');
    const ackIdx = submit.indexOf('clearDraft(draftConv||null);clearDraft(t.conversation_id)');
    const boxClearIdx = submit.indexOf("box.value=''");
    assert.ok(ackIdx > 0, 'both draft keys clear on ack');
    assert.ok(boxClearIdx < ackIdx, 'the clear happens after the POST succeeded');
    assert.match(chat, /restoreChatDraft\(\);/, 'a reload restores the current draft');
});

// --- D9: Projects → Chat ------------------------------------------------------

test('file references reach the composer as chips and never auto-send', () => {
    assert.match(attach, /export function addExternalRef\(value:string\)/, 'the chat-attach entry point');
    assert.match(ui, /addExternalRef\(path\)/, 'Projects calls it from the context menu');
    assert.match(ui, /'Send file reference to chat'/, 'the menu item exists');
});

test('Send selection moves text to the composer without submitting', () => {
    assert.match(ui, /'Send selection'/, 'the preview-header action');
    assert.match(lib, /selection\(\)\{/, 'the editor exposes its selection');
    const handler = ui.slice(ui.indexOf('sbSendSel.onclick='), ui.indexOf('sbCancelBtn.onclick='));
    assert.ok(!handler.includes("new Event('submit'"), 'never submits from Projects');
    assert.ok(handler.includes('input.focus()'), 'the composer is focused for review');
});
