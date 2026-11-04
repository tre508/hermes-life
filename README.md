# HL-FLOW-006 — Automatic isolated revision execution

This release extends **HL-FLOW-005**. It does not replace `hermes_life/implementation.py` or change existing project/workspace synchronization.

## Behavior

When a reviewer chooses **Request revision** and supplies feedback, the existing review decision is persisted first. The new revision worker automatically enqueues and performs an isolated attempt, using the *existing* run and approved plan.

1. Check that the candidate still matches the hash the reviewer inspected.
2. Copy the current candidate into `/home/hermes/experiments/revision-<attempt-id>` (without `.venv` and caches).
3. Send a bounded instruction to Hermes to edit **only that revision staging copy**. The request includes the user's feedback and original plan acceptance criteria.
4. Run `pytest` in staging using the existing candidate's Python virtual environment when present.
5. On failed tests or evaluator error, retain the original candidate intact. Record the attempt and expose **Retry isolated revision** (maximum three attempts).
6. On passing tests, revalidate the original candidate fingerprint, promote the staged changes into the **VM candidate directory only**, archive the previous `revision_requested` review, and independently reevaluate the promoted candidate.
7. Clear the old pending review decision after promotion and reevaluation so a user can review/accept/reject/revise the new candidate. Historical decisions and attempts remain in SQLite.

A user **must still explicitly accept** a candidate. No code is applied to the host or original VM project automatically. An automatic revision does not imply deployment approval.

## Files

- `hermes_life/implementation_revision.py` — persistent queue, worker, isolated VM staging/test/promotion, attempt history.
- `frontend/src/phase415-review.ts` — **complete replacement** of Phase 4.15 review UI module; shows revision attempt status/test output, refreshes while active, supports bounded retry.
- `scripts/install-flow006.py` — idempotent installer that adds two API routes and attaches the worker to the existing FastAPI lifespan. Creates a timestamped `app.py` backup; refuses unrecognized layouts.
- `tests/test_flow006_revision.py` — fake VM/SQLite tests.

## Install

From the Kubuntu host:

```bash
cd ~/Apps/hermes-life
unzip -o ~/Downloads/hermes-life-hl-flow006-auto-revision.zip
.venv/bin/python scripts/install-flow006.py
.venv/bin/python -m pytest -q
(cd frontend && npm run build)
```

**Restart the backend**, then refresh the browser.

## API

- `GET /api/implementations/{id}/revisions` — past attempts plus archived review decisions.
- `POST /api/implementations/{id}/revisions/retry` — only after a failed attempt and within the three-attempt limit.
- Existing `POST /api/implementations/{id}/review` with `decision: revision_requested` **automatically queues** the revision; its response includes the attempt ID or a clear enqueue error.

## Expected example

In Build, open **Review candidate changes**, enter actionable feedback, and choose **Request revision**. A new revision attempt appears automatically with `queued`, `running`, and a final `passed`, `tests_failed`, or `evaluation_error` state. After passing, review the **new** diff and test results before acceptance.

## Boundaries and known limitations

- Automatic execution is limited to a **human-submitted revision request**. It does not keep issuing unlimited model attempts.
- Each revision may consume LLM/tool usage; attempts are capped at three per requested review.
- `running` attempts interrupted by a backend restart are marked `interrupted` and require manual inspection; they are never re-executed blindly. Already queued requests recover automatically.
- The VM isolation boundary remains essential: prompts alone cannot enforce filesystem restrictions against every agent tool.
- If a guest VM operation fails during promotion, the staging/backup directories are retained for investigation; no host changes are made.
- This patch does not automate applying approved candidate changes to the original project or host and does not replace human validation of acceptance criteria.

## Validation performed in artifact build

- Four isolated regression tests: duplicate queue requests, successful revision history/re-review, failed revision/retry, changed-candidate rejection.
- Strict TypeScript check of the new UI module.
- Python compilation and repeat installer compatibility test against the documented FLOW-005 app structure.

Full integration and real SSH VM execution require validation in your actual installed Hermes Life environment.
