# Hermes Life Phase 3.9.3 — Confidence and Contradictions

Install on top of Phase 3.9.2. Stop the backend and back up your SQLite database first. Extract at the project root.

## Changes
- Schema v10 adds `technical_lesson_challenges` with source run and tool-result excerpt. Historical technical lessons and reuse/application counts are unchanged.
- Existing supported lessons show `supporting_runs`, `challenging_runs`, `confidence_score`, `confidence_status` in `/api/technical-lessons`.
- Evidence from distinct runs contributes once to the confidence score. `confidence_score=(supporting_runs+1)/(supporting_runs+challenging_runs+2)` is an evidence-balance indicator, **not** a calibrated likelihood of truth.
- A lesson with even one recorded challenge is labeled `disputed` and omitted from automatic technical recall pending review. Original evidence and history remain available.
- Hermes may report a contradiction in its structured `[HERMES_LEARNING_JSON]` report by adding `challenges_lesson_id` to a lesson item with topic, lesson, applies_when, and an exact tool_evidence excerpt. The host verifies that the excerpt appears in current tool-result events and that the claim shares at least two topical terms with the old lesson. Such a match is evidence that a conflicting observation was reported, not independent proof of the underlying claim.
- Core persona, UI and VM bridge unchanged.

## Install
```
cd ~/Apps/hermes-life
cp -a ~/.local/share/hermes-life/life.db ~/.local/share/hermes-life/life.db.before-3.9.3
unzip -o ~/Downloads/hermes-life-phase3.9.3-confidence-contradictions.zip
source config/hermes-life-ssh.env.example
./start.sh
```

Verify: `curl -s http://127.0.0.1:8766/api/technical-lessons | python3 -m json.tool`.

## Verification scope
Local integration test covered v10 schema, supported lesson insertion and reinforcement, recorded challenge, confidence/status fields, and disputed recall exclusion. No live VM task or complete project regression suite was executed.

## Limitation
This patch does not automatically prove contradictions or resolve them; disputed lessons require a future review workflow. Evidence excerpts are observations, not truth guarantees. No prior records are retroactively challenged.
