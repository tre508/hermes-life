# Hermes Life 3.9 — Technical Learning

Apply on top of Phase 3.8 (fixed persona + reflective memory). Stop backend before patching. Back up project and database first.

## What it adds
- Schema v7 adds `technical_lessons` and `lesson_reuse`; existing `reflective_runs` and other tables remain.
- Hermes may append a structured learning report after its usual answer. The host strips that report from the human-facing task result.
- The host only marks a technical lesson as `supported` when the exact excerpt claimed by Hermes is found in an actual `hermes.tool_result` event from that run. Unsupported claims are stored as `unverified` and are not recalled into future prompts.
- At most 3 relevant supported lessons are retrieved by topic/applicability overlap. Historical observations are explicitly untrusted context and cannot override current instructions or VM permissions.
- Subsequent runs record whether a lesson was included and whether the subsequent run completed or failed. This **does not establish causal improvement** and is not a proof that the lesson itself is true.
- API: GET `/api/technical-lessons` (optional `?limit=30`).

## Install
```
cd ~/Apps/hermes-life
cp -a . "../hermes-life-backup-$(date +%Y%m%d-%H%M%S)"
unzip -o ~/Downloads/hermes-life-phase3.9-technical-learning.zip
source config/hermes-life-ssh.env.example
./start.sh
```
Restart frontend only if needed; no frontend files change. Check `curl -s http://127.0.0.1:8766/api/technical-lessons | python3 -m json.tool`.

## Verification notes
Test task should involve actual tool calls (e.g., edit a test script, run `python ...`, inspect output). An empty lesson list is expected when the agent doesn't emit a structured report or when no specific evidence appears. Existing Phase 3.8 generic reflections will remain but won't automatically become technical lessons.

Tool-backed means only that some text appeared in a tool result, **not** that a claim has been independently validated. A test's exit code and assertions should still be inspected by Hermes. Reuse metrics track exposure/outcome association, not proof of improvement. No additional model API calls are made.
