/**
 * Chat flicker + stop contract (uichange.md State B; diagnosis 2026-11-28).
 *  - Chat redraws only on a real change: setRunning is change-only and the trace
 *    refresh skips an unchanged read.
 *  - Home mirrors Chat's running state, shows Stop instead of Send, and stops via
 *    Chat's existing cancel handler.
 *  - Home refuses a submit while a task runs instead of silently ignoring it.
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

test('setRunning touches the DOM only when the running state changes', () => {
    assert.match(chat, /let runningNow:boolean\|null=null;/);
    assert.match(chat, /if\(runningNow===running\)return;/);
});

test('the trace refresh skips an unchanged read', () => {
    assert.match(chat, /JSON\.stringify\(live\.steps\)===JSON\.stringify\(steps\)\)\{placeholder\.open=live\.open;return;\}/);
});

test('Chat broadcasts running state and handles a Home stop with its own cancel handler', () => {
    assert.match(chat, /new CustomEvent\('hermes:chat-running'/);
    assert.match(chat, /addEventListener\('hermes:chat-stop',\(\)=>\{el\('hc-stop'\)\.click\(\)\}\)/);
});

test('Home has a Stop button beside Send and mirrors Chat state', () => {
    assert.match(html, /<button id="world-composer-stop" type="button" hidden/);
    assert.match(composer, /addEventListener\('hermes:chat-running'/);
    assert.match(composer, /dispatchEvent\(new CustomEvent\('hermes:chat-stop'\)\)/);
});

test('Home refuses a submit while a task runs instead of reporting Sent', () => {
    assert.match(composer, /if \(chatRunning\) \{[\s\S]*stop the task first/);
});
