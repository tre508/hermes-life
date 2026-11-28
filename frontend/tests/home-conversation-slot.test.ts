/**
 * uichange.md §3/§8 — Home's conversation slot (fix 3 of the 2026-11-28 diagnosis).
 *  - Chat honours new_conversation by clearing the stored conversation before send.
 *  - Chat announces the conversation id it created or used on each send.
 *  - Home remembers only its own sends, and starts a new conversation when it has none.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const html = readFileSync(join(frontend, 'index.html'), 'utf8');
const chat = readFileSync(join(frontend, 'src', 'hermes-chat.ts'), 'utf8');
const composer = readFileSync(join(frontend, 'src', 'world-composer.ts'), 'utf8');

test('Chat clears the stored conversation for new_conversation and only then opens', () => {
    assert.match(chat, /if\(d\.new_conversation\)\{conversationId='';localStorage\.removeItem\(stored\);switchChatDraft\(''\);\}/);
    assert.match(chat, /void open\(d\.new_conversation\?undefined:d\.conversation_id\);/);
});

test('Chat announces the conversation id after each accepted send', () => {
    assert.match(chat, /new CustomEvent\('hermes:chat-conversation'/);
});

test('every Home send starts a new conversation (decision 2026-11-28)', () => {
    assert.match(composer, /setHomeThread\(''\);\s*handoff\(\{ prefill: text, submit: true, new_conversation: true \}\);/);
    assert.ok(!/conversation_id: thread/.test(composer), 'no continuation of the old slot on send');
});

test('Home only records a conversation from its own sends', () => {
    assert.match(composer, /if \(!homeSendPending \|\| !id\) return;/);
});

test('Home offers an explicit new-conversation control', () => {
    assert.match(html, /<button id="world-composer-new" type="button"/);
    assert.match(composer, /newButton\?\.addEventListener\('click'/);
});
