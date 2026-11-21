# HL-CHAT-002 — Hermes Life chat upgrade patch packet

**Target**: `tre508/hermes-life` on `main`, code inspected 2026-11-21.
**Status**: source patch packet, **not installed or runtime verified on your machine**.

## Contents

- `install.py`: anchor-validated, non-destructive installer. Aborts if the expected source differs; backs up modified files before writing them.
- `patches/chat-markdown.ts`: safe DOM-based Markdown renderer (headings, emphasis, links, code fences/copy, lists, blockquotes, tables) without inserting agent text as HTML.
- `patches/chat-upgrade.css`: readable assistant responses and model controls.
- `patches/chat_models.py`: model allowlist, durable per-task model selection, optional evidence-based usage and OpenRouter credit balance.
- `tests/test_packet.py`: standalone contract sanity checks.

## Apply

Extract this packet somewhere **outside the Hermes Life repository**, then:

```bash
python3 install.py --repo /home/gayzer/Apps/hermes-life --check
python3 install.py --repo /home/gayzer/Apps/hermes-life
cd /home/gayzer/Apps/hermes-life/frontend
npm run build
```

Review `git diff`, run your existing backend and frontend tests, and restart Hermes Life using your existing service procedure. The installer does not modify the running process, VM configuration, credentials, or project database. The `chat_task_models` table is created when the backend starts.

## Configure visible models

Only explicitly configured models appear. Set this **in the Hermes Life host backend environment** (not in the frontend). Example:

```bash
export HERMES_LIFE_CHAT_MODELS='[{"provider":"openrouter","model":"YOUR/VALID-MODEL-ID","label":"My OpenRouter model","context_window":128000},{"provider":"openai-api","model":"YOUR-MODEL-ID","label":"My OpenAI-compatible model"}]'
```

**Replace placeholders with model IDs available to your actual Hermes worker**. `context_window` must be the provider's verified limit; otherwise omit it and the UI will not invent a percentage. With no configured models the selector uses the worker default.

For *optional* OpenRouter credit balance on the host, set `HERMES_LIFE_OPENROUTER_API_KEY` in the backend service environment. The key is never included in an API response. Other providers report balance unavailable rather than showing fabricated credits. This is deliberately different from per-task spending.

The guest Hermes installation must support `hermes chat --provider <id> --model <id> --format stream-json`. CLI flags are applied only to explicitly selected **interactive Chat** tasks; autonomous/background workers continue using existing defaults. The dropdown changes **subsequent requests**, not running tasks.

## Telemetry semantics

- **Context**: last-request `input_tokens` divided by the explicitly configured `context_window`; not cumulative conversation tokens, and not guaranteed full effective context accounting.
- **Cost**: `estimated_cost_usd` from a runtime stream event, only if supplied; no invented cost calculation.
- **Balance**: live OpenRouter credit API response if configured and available; otherwise unavailable.
- **Provider/model**: stored per task in a separate `chat_task_models` table. Existing tasks without an explicit override display default/unknown rather than getting retroactively attributed.
- These fields are not updated on the frontend until a task starts/ends; telemetry remains unavailable if the installed runtime does not emit compatible counts.

## Limitations / follow-on improvements

The included Markdown renderer is safe and self-contained, but **not a full CommonMark implementation** and does not yet syntax-color code tokens. Full syntax highlighting and advanced Markdown nesting should be a separate follow-up with a reviewed parser dependency. The catalog is an allowlist, not an automatic discovery of all providers installed in the guest. No provider API tokens are read from the browser.

## Rollback

The installer prints the backup path, for example:

`/home/gayzer/Apps/hermes-life/.hl-chat-002-backups/YYYYMMDD-HHMMSS`

Stop the backend, copy the four original source files from that directory back into their original paths, delete the three newly added source files, rebuild the frontend, and restart. The new `chat_task_models` table may remain; it does not modify previous task records. If the checkout is a clean Git worktree, inspect `git diff` and revert only the patch's source changes, not unrelated work.

## Safety and verification

Installation aborts without editing if required insertion anchors are missing or target new files already exist. This packet has Python syntax checks and isolated contract tests; **it has not been compiled against your local frontend bundle or exercised against your actual VM provider settings**. Validate on a development checkout before adopting to a live instance.
