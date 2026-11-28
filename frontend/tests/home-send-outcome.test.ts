/**
 * Home must report the real outcome of a send. A refused send (e.g. HTTP 409
 * "Agent is busy") is not "Sent", and the typed text is given back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const chat = readFileSync(join(frontend, 'src', 'hermes-chat.ts'), 'utf8');
const composer = readFileSync(join(frontend, 'src', 'world-composer.ts'), 'utf8');

test('the chat announces a refused submit with its message', () => {
    assert.match(chat, /new CustomEvent\('hermes:chat-submit-failed'/);
});

test('Home restores the text and reports the refusal instead of Sent', () => {
    assert.match(composer, /addEventListener\('hermes:chat-submit-failed'/);
    assert.match(composer, /input\.value = lastHomeText/);
    assert.match(composer, /Not sent: \$\{message\}/);
});
