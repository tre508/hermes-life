HERMES LIFE  /  DEVELOPMENT SPECIFICATION

HL-AUTO-001

Autonomous Learning, Project Ideation & Self-Directed Development

Status: Proposed implementation milestone  |  Version: 1.0  |  10 November 2026

1. Purpose and boundaries

Enable Hermes Life to initiate useful work without a user-authored ticket: learn, discover opportunities, propose and create new applications or research projects, execute and test them in authorized isolated workspaces, evaluate outcomes, and resume or revise work across sessions. Self-improvement of Hermes itself is one eligible project category, not the only category.

This specification is a design proposal, not a claim that the listed APIs or tables already exist. Inspect the live codebase and master development specification before choosing final integration points. The provided Phase 4.11 attachment confirms a project-workspaces patch/install path but not its internal contracts.

2. Preconditions and architectural principles

Implement HL-PERS-001 first; share persistent memory, preference feedback, and outcome records, but separate personality policy from project-selection policy.

Reuse existing goal, discovery, planning, workspace, execution, evaluation, revision, VM isolation, SQLite and Obsidian capabilities; add orchestration adapters rather than duplicate engines.

No autonomous operation bypasses workspace boundaries, approval policy, task cancellation, resource budgets, or auditable execution records.

Treat model-generated opportunities as hypotheses until supported by observations; record evidence and confidence.

Store decisions as explicit user-visible rationales and event summaries, never fabricated internal reasoning.

3. Target architecture

Observation sources → Opportunity Engine → Candidate Registry → Feasibility / Value Scoring → Policy Gate → Project Proposal → Project Initialization → Milestone Planner → Execution Orchestrator → Test / Evaluation → Outcome Learning → Next-action Scheduler. Shared services: Memory/Experience, Workspace/VM Adapter, Event Bus, Policy/Budget, Project Registry, Dashboard API.

Component contracts

Learning Engine

Detect skill gaps from failed tasks and planned projects; create curricula, exercises, verification checks and skill evidence. Proposed records: learning_objective, resource_ref, exercise_run, skill_evidence.

Opportunity Engine

Extract repeated manual steps, project friction, missing capabilities and explicit interests; deduplicate candidates and attach provenance. Proposed records: opportunity_candidate with evidence_refs, impact, confidence.

Proposal Engine

Produce requirements, rationale, alternatives, feasibility, effort, expected value, risks and acceptance tests. Proposed records: project_proposal versioned and reviewable.

Project Bootstrapper

Allocate isolated workspace, initialize repository and environment, register project and create specification/roadmap. Proposed records: project_id, workspace_id, bootstrap_result.

Portfolio Manager

Prioritize direct requests over background work as configured; maintain milestones, dependencies, blocked state and resumability. Proposed records: project, milestone, work_item, next_action.

Execution Adapter

Invoke existing planner/coder/tester/evaluator/reviser using stable job IDs; collect artifacts and tool events. Proposed records: execution_run, artifact_ref, evaluation_result.

Experience Engine

Compare expected versus observed results, summarize failures and successful patterns, update skill and strategy evidence. Proposed records: experience_record, strategy_score.

Policy & Scheduler

Enforce mode, per-action permissions, compute/time/token budgets, concurrency, cooldown and user interruption. Proposed records: approval_request, policy_decision, budget_ledger.

4. Autonomous initiative decision loop

1. Ingest authorized observations from user tasks, project history, execution outcomes, skill gaps and explicit interests.

2. Normalize, deduplicate and rank opportunities; require evidence references, not unsupported assertions.

3. Choose a learning activity, a new-project proposal, an existing-project milestone, or no action.

4. Estimate value, feasibility, uncertainty, dependencies, cost and expected learning gain.

5. Run policy check: autonomy mode, resource ceiling, workspace scope, required approvals and active user work.

6. For approved work, initialize or resume project, execute a bounded next step, and emit real events.

7. Evaluate against objective acceptance criteria; retry within limits, escalate blockers or mark complete.

8. Persist outcome and lesson; update ranking and schedule next review without infinite loops.

Illustrative prioritization: score = weighted(user_relevance, expected_utility, feasibility, learning_gain, evidence_strength) − weighted(cost, risk, uncertainty, interruption_penalty). Weights must be configurable, inspectable and calibrated from actual outcomes. A low-confidence candidate should default to investigation, not implementation.

5. Project state machine and recovery

CANDIDATE → PROPOSED → AWAITING_APPROVAL (if needed) → APPROVED → INITIALIZING → PLANNED → ACTIVE → EVALUATING → COMPLETED; alternative states: PAUSED, BLOCKED, FAILED, ARCHIVED, CANCELLED. Revision can transition EVALUATING → ACTIVE. State transitions must be validated, event-sourced or transactionally logged, idempotent and restart-safe.

On restart, reconcile unfinished jobs with VM/workspace state; do not assume completion or launch duplicate actions. Record checkpoints and resume only approved, recoverable tasks. Use bounded retries with backoff and explicit blocker classification.

6. Proposed persistence schema

• projects: id, origin (user/autonomous), title, objective, status, workspace_id, autonomy_mode, priority, created_at, updated_at.

• opportunities: id, source_type, evidence_refs, problem, proposed_benefit, confidence, dedupe_key, status.

• project_proposals: id, project_id, version, specification_json, feasibility, estimated_cost, approval_status.

• milestones / work_items: id, project_id, parent_id, dependency_ids, acceptance_criteria, state, assigned_role.

• execution_runs: id, project_id, work_item_id, vm_job_id, status, started_at, ended_at, result_refs.

• learning_objectives / skill_evidence: id, skill, target_level, exercise_refs, verification_result, confidence.

• experience_records: id, project_id, decision_id, expected_result, actual_result, lesson, evidence_refs.

• approval_requests / budget_ledger: id, action_type, policy_snapshot, decision, actor, timestamp, resource_usage.

Use SQLite migrations with foreign keys, uniqueness constraints and indices on project/status/time. Obsidian receives human-readable synchronized notes and links, not a second authoritative transactional database. Ensure writes are idempotent and sync failures are retryable.

7. Configurable autonomy and approvals

Observe: Collect and analyze observations; no background project execution.

Suggest: Generate learning plans and project proposals; explicit approval before initialization/execution.

Guided: Autonomously plan and execute approved projects within budget; require approval for new projects and sensitive actions.

Independent within scope: Discover, initialize and develop projects inside allowlisted VM/workspaces under defined budgets; ask for actions outside scope.

Permissions are action-based and independent of mode: network access, external downloads, package installation, repo creation, filesystem writes, secrets, deployment, external messaging, spending and modifications to Hermes core. Default to least privilege; approval records must bind to concrete action and scope. User can pause, cancel or downgrade mode at any time; in-flight tasks must honor cancellation checkpoints.

8. Proposed service and API surface

GET /api/autonomy/config; PATCH /api/autonomy/config — modes, schedules, budgets and permissions.

GET /api/opportunities; POST /api/opportunities/{id}/propose; POST /api/opportunities/{id}/dismiss.

GET /api/projects; POST /api/projects; GET /api/projects/{id}; GET /api/projects/{id}/timeline.

POST /api/projects/{id}/approve; /pause; /resume; /cancel; /archive.

GET /api/approvals; POST /api/approvals/{id}/decision.

GET /api/learning/objectives; GET /api/skills; GET /api/autonomy/decisions.

WebSocket event families: opportunity.*, proposal.*, project.*, milestone.*, learning.*, approval.*, budget.*, execution.*.

These routes are proposed only. Align naming, authentication, error formats and event transport with actual Hermes Life conventions discovered during implementation.

9. Projects dashboard specification

Add Projects as a dedicated primary navigation area, separate from Goals and Discover. Show a portfolio of active, proposed, paused and completed projects; origin badge (user/autonomous), rationale/evidence, priority, current milestone, live job state, latest result, blockers, resource consumption and next planned action.

Project detail: overview, proposal versions, requirements, roadmap, dependency graph, repository/workspace, test results, artifacts, decision timeline and experience notes.

Controls: approve/reject proposal, edit priority, pause/resume/cancel, adjust per-project autonomy scope, inspect event evidence.

Autonomy settings: mode, schedule, budgets, concurrency, permissions and emergency stop.

Real-time updates must reflect actual runtime events; no fabricated progress, tool calls, completion claims or private reasoning.

Empty, loading, offline, error and reconnect states must be designed; long sections must scroll and remain usable at common desktop resolutions.

10. Delivery phases and acceptance gates

0 — Audit and contract mapping

Implementation: Inspect master spec, HL-PERS-001 status, DB migrations, existing project workspace APIs, VM executor, memory, event bus and frontend. Produce integration map and discrepancies.

Exit gate: Reviewed dependency map; no duplicate subsystem planned.

1 — Shared data and policy

Implementation: Add migrations, project/opportunity registries, permission evaluator, approval ledger and budget accounting.

Exit gate: Persistence, policy denials, migration and restart tests pass.

2 — Opportunity and learning

Implementation: Implement evidence ingestion, deduplication, skill-gap detection, curricula, exercises and skill validation.

Exit gate: Repeated-task and failed-task fixtures yield traceable opportunities and verified skill records.

3 — Proposal and initialization

Implementation: Generate structured proposals; bootstrap isolated repositories/workspaces through existing adapters.

Exit gate: Approved proposal creates registered project and reproducible environment; denied proposal makes no writes.

4 — Portfolio orchestration

Implementation: Implement state machine, priority scheduler, checkpoints, interruption, dependency handling and recovery.

Exit gate: Two projects resume across restart without duplicate jobs; user requests preempt background work.

5 — Execution and experience

Implementation: Connect existing coding/test/evaluation/revision; compare outcomes to acceptance criteria; persist lessons.

Exit gate: A new project is implemented, tested, revised and scored using real artifacts.

6 — Dashboard and telemetry

Implementation: Build Projects views, controls, decision timeline, event streaming and settings.

Exit gate: UI displays accurate project state; approval and pause actions affect backend.

7 — End-to-end hardening

Implementation: Run realistic autonomous project scenarios, failure injection, resource limit checks and regression suite.

Exit gate: All required scenarios pass with auditable evidence and no scope violation.

11. Mandatory end-to-end scenarios

Repeated manual task → evidence-backed automation proposal → approval → isolated tool build → tests → completion record.

Knowledge gap → learning objective → exercise → verified skill → newly proposed demonstration project.

Autonomous project initiation within independent-mode allowlist, with no user-authored ticket.

Two concurrent initiatives with dependencies; direct user request interrupts background work without losing progress.

VM crash/restart during build; reconciliation resumes safely without duplicate commits or jobs.

Exceeded budget, disallowed filesystem path, and unapproved external action are blocked and logged.

Failed tests trigger bounded revision; unresolved failure becomes BLOCKED with visible evidence.

Outcome review changes future opportunity ranking; experience is shared with HL-PERS-001 without conflating preferences and project policy.

12. Definition of done

HL-AUTO-001 is complete only when Hermes can independently discover at least one evidence-backed opportunity, choose or propose a new project, initialize an isolated repository, plan and execute milestones, validate a deliverable, record lessons, and resume the initiative after restart—all under configured permissions, with complete user-visible provenance. A simulated dashboard or generated proposal alone does not satisfy completion.

13. Integration and implementation notes

Do not replace working Phase 4.11 project workspaces or existing execution machinery. Verify actual paths and contracts in the live repository before implementation. Make every phase independently testable and avoid unbounded background loops. HL-PERS-001 is a prerequisite for shared experience/personalization behavior, but autonomous project policy remains a separate, explicit subsystem.

Reference supplied: “Build Autonomous Bot.txt” — Phase 4.11 project-workspaces patch installation instructions (no source code or API contracts supplied).