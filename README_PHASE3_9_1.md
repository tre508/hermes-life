# Phase 3.9.1 — Memory Consolidation and Application Evidence

Applies on top of Hermes Life Phase 3.9. Stop the backend and back up your current project and SQLite database before extracting.

Schema v8 creates `technical_lesson_evidence` and `lesson_application`. On migration it merges **conservatively equivalent** existing supported lessons, retains the older ID, transfers evidence and retrieval history, and preserves unrelated findings. Original database backup is recommended because duplicate row IDs are retired during migration.

New supported findings matching an existing lesson reinforce that lesson with an additional source observation instead of creating a duplicate. API `/api/technical-lessons` now includes `evidence_count` and `application_count`; `reuse_count` remains the number of times the lesson was sent in historical task context, NOT actual application.

Agent reports may add `applied_lessons` entries that contain the recalled lesson ID and an exact excerpt of tool output demonstrating an applicable technique. The host stores those claims only when the lesson was recalled in that run and the cited excerpt appears in the run's actual tool-result data. This is **agent-attested, tool-output-matched application**, not independent causal proof or guaranteed correctness. Legacy runs are not retroactively labeled as applied.

The matcher is conservative token/anchor similarity. Semantically equivalent lessons may still remain separate if wording differs greatly; unrelated lessons should not be merged merely by topic.

## Install

```bash
cd ~/Apps/hermes-life
cp -a . "../hermes-life-backup-$(date +%Y%m%d-%H%M%S)"
unzip -o ~/Downloads/hermes-life-phase3.9.1-memory-consolidation.zip
source config/hermes-life-ssh.env.example
./start.sh
```

Verify with `curl -s http://127.0.0.1:8766/api/technical-lessons | python3 -m json.tool`.

No frontend or VM changes. Local checks cover schema migration, legacy lesson consolidation, evidence accumulation, application evidence recording, and Python syntax. Live Kubuntu deployment remains unverified.
