/**
 * UI-VIS-002 model tests: run with `npm run test:town` (node --test, TypeScript type-stripping).
 * They pin the rules that keep the town honest — one avatar per role, no invented activity,
 * server records as baseline, events as an expiring overlay.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVITY_WORDS, ROLES, ROSTER, TOWN_LOCATIONS, WORKING_TTL_MS,
  applyEvent, chatTaskRunning, deriveFromRecords, emptyTown, expireOverlays, isRuntimeEvent, labelForEvent,
  toolLocation, toolName,
  projectServerState, roleForEvent, stateForEventType, summarize, withBaseline,
} from '../src/town-model.ts';

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const evt = (sequence: number, type: string, payload: Record<string, unknown> = {}) =>
  ({ sequence, type, payload, timestamp: new Date(NOW).toISOString() });

// --------------------------------------------------------------------- roster and locations

test('each role has exactly one resident and one distinct building', () => {
  assert.equal(ROLES.length, 7);
  const locations = ROLES.map(r => ROSTER[r].location);
  assert.equal(new Set(locations).size, 7, 'buildings must not be shared');
  for (const role of ROLES) {
    assert.ok(ROSTER[role].name, `${role} needs a display name`);
    assert.ok(TOWN_LOCATIONS[ROSTER[role].location], `${role} must map to a known building`);
  }
  assert.equal(new Set(ROLES.map(r => ROSTER[r].name)).size, 7, 'display names must be distinct');
  assert.ok(Object.values(TOWN_LOCATIONS).every(l => l.view), 'every building opens an existing view');
});

test('a fresh town shows 7 idle residents and invents nothing', () => {
  const town = emptyTown(NOW);
  assert.deepEqual(Object.keys(town.residents).sort(), [...ROLES].sort());
  assert.ok(Object.values(town.residents).every(r => r.state === 'idle'));
  assert.equal(town.counts.working, 0);
  assert.equal(town.counts.waiting, 0);
});

// --------------------------------------------------------------------- event vocabulary

test('real event names map to the area that acts on them', () => {
  const cases: Array<[string, string, Record<string, unknown>, boolean]> = [
    ['task.started', 'coordinator', { scope: 'interactive' }, false],
    ['task.completed', 'coordinator', { scope: 'interactive' }, false],
    ['task.started', 'researcher', { scope: 'read_only' }, false],
    ['task.queued', 'researcher', {}, true],
    ['goal.selected', 'researcher', {}, false],
    ['discovery.scan_completed', 'researcher', {}, false],
    ['curiosity.investigation_requested', 'researcher', {}, false],
    ['study.unit_queued', 'researcher', {}, false],
    ['formulation.proposed', 'planner', {}, false],
    ['investigation.plan_completed', 'planner', {}, false],
    ['investigation.plan_approved', 'planner', {}, false],
    ['implementation.started', 'builder', {}, false],
    ['implementation.revision_started', 'builder', {}, false],
    ['implementation.environment_ready', 'builder', {}, false],
    ['implementation.evaluated', 'tester', {}, false],
    ['implementation.reevaluation_started', 'tester', {}, false],
    ['verification.started', 'tester', {}, false],
    ['verification.completed', 'tester', {}, false],
    ['verification.auto_revision_queued', 'builder', {}, false],
    ['implementation.review_decided', 'reviewer', {}, false],
    ['implementation.applied', 'reviewer', {}, false],
    ['memory.extraction_summary', 'archivist', {}, false],
    ['reflection.recorded', 'archivist', {}, false],
    ['autonomy.resumed', 'coordinator', {}, false],
    ['maintenance.prune_completed', 'coordinator', {}, false],
  ];
  for (const [type, role, payload, autonomous] of cases) {
    assert.equal(roleForEvent(type, payload, autonomous), role, `${type} should belong to ${role}`);
  }
});

test('an unmapped event is never guessed at', () => {
  assert.equal(roleForEvent('telemetry.teleported', {}), null);
  assert.equal(stateForEventType('telemetry.teleported'), 'unknown');
  const town = applyEvent(emptyTown(NOW), evt(1, 'telemetry.teleported'), false, NOW);
  assert.deepEqual(town.unknownEvents, ['telemetry.teleported']);
  assert.ok(Object.values(town.residents).every(r => r.state === 'idle'), 'no resident may react');
});

test('event suffixes decide the activity, and labels stay factual', () => {
  assert.equal(stateForEventType('implementation.started'), 'working');
  assert.equal(stateForEventType('implementation.revision_queued'), 'queued');
  assert.equal(stateForEventType('implementation.failed'), 'failed');
  assert.equal(stateForEventType('verification.completed'), 'completed');
  assert.equal(stateForEventType('implementation.apply_blocked'), 'failed');
  assert.equal(labelForEvent('verification.started'), 'Verifying acceptance criteria');
  assert.equal(labelForEvent('memory.extraction_summary'), 'Memory extracted');
});

// --------------------------------------------------------------------- record baseline

test('completed history produces no motion', () => {
  const residents = deriveFromRecords({
    agent: { state: 'idle', current_task: null },
    tasks: [{ id: 't1', state: 'completed' }, { id: 't2', state: 'failed' }],
    goals: [{ id: 'g1', state: 'completed', title: 'old work' }, { id: 'g2', state: 'superseded', title: 'dup' }],
    plans: [{ id: 'p1', state: 'approved', project: 'hermes-life' }],
    runs: [{ id: 'r1', state: 'candidate_passed', project: 'hermes-life' }],
    latestReview: { decision: 'accepted' },
  }, NOW);
  assert.equal(residents.researcher.state, 'idle');
  assert.equal(residents.planner.state, 'idle');
  assert.equal(residents.builder.state, 'idle');
  assert.equal(residents.reviewer.state, 'completed');
  assert.equal(residents.coordinator.state, 'idle');
});

test('in-flight records drive their role, and human gates are visible as waiting', () => {
  const residents = deriveFromRecords({
    agent: { state: 'executing', current_task: 't9' },
    tasks: [{ id: 't9', state: 'running', prompt: 'summarise the repo' }],
    goals: [{ id: 'g1', state: 'running', title: 'Investigate TODOs', project: 'hermes-life-test', task_id: 't7' }],
    plans: [{ id: 'p1', state: 'proposed', project: 'hermes-life' }],
    runs: [{ id: 'r1', state: 'implementing', project: 'hermes-life-test', created_at: '2026-11-05T10:00:00Z' }],
  }, NOW);
  assert.equal(residents.coordinator.state, 'working');
  assert.match(residents.coordinator.label, /t9/);
  assert.equal(residents.researcher.state, 'working');
  assert.match(residents.researcher.label, /Investigate TODOs/);
  assert.equal(residents.researcher.project, 'hermes-life-test');
  assert.equal(residents.planner.state, 'waiting_approval');
  assert.equal(residents.builder.state, 'working');
  assert.match(residents.builder.label, /hermes-life-test/);
});

test('an autonomous task belongs to the researcher, not the coordinator', () => {
  const residents = deriveFromRecords({
    agent: { state: 'executing', current_task: 't7' },
    tasks: [{ id: 't7', state: 'running' }],
    goals: [{ id: 'g1', state: 'running', title: 'Investigating', task_id: 't7' }],
  }, NOW);
  assert.equal(residents.coordinator.state, 'idle');
  assert.equal(residents.researcher.state, 'working');
});

test('a candidate awaiting a decision is a review gate, and the tester is not still testing', () => {
  const residents = deriveFromRecords({
    agent: { state: 'idle' },
    runs: [{ id: 'r1', state: 'candidate_passed', project: 'hermes-life-test', created_at: '2026-11-05T11:00:00Z' }],
    latestReview: null,
  }, NOW);
  assert.equal(residents.reviewer.state, 'waiting_approval');
  assert.equal(residents.tester.state, 'completed');
  assert.equal(residents.builder.state, 'idle');
});

test('the newest run is the one that counts', () => {
  const residents = deriveFromRecords({
    runs: [
      { id: 'old', state: 'failed', project: 'a', created_at: '2026-11-01T00:00:00Z' },
      { id: 'new', state: 'implementing', project: 'b', created_at: '2026-11-05T09:00:00Z' },
    ],
  }, NOW);
  assert.equal(residents.builder.state, 'working');
  assert.equal(residents.builder.project, 'b');
});

test('a running verification shows in the lab', () => {
  const residents = deriveFromRecords({
    runs: [{ id: 'r1', state: 'candidate_passed', project: 'p', created_at: '2026-11-05T11:00:00Z' }],
    latestVerification: { state: 'running' },
    latestReview: null,
  }, NOW);
  assert.equal(residents.tester.state, 'working');
  assert.match(residents.tester.label, /Verifying/);
});

// --------------------------------------------------------------------- overlay behaviour

test('a live event overlays its role and the baseline comes back after the flash', () => {
  const signals = { agent: { state: 'idle' }, runs: [] };
  let town = withBaseline(projectServerState(signals, NOW, null, 'live'), signals, NOW);
  town = applyEvent(town, evt(10, 'implementation.started', { project: 'hermes-life-test' }), false, NOW);

  assert.equal(town.residents.builder.state, 'working');
  assert.equal(town.residents.builder.source, 'event');
  assert.equal(town.residents.builder.project, 'hermes-life-test');
  assert.equal(town.counts.working, 1);

  // Long after the event, with nothing to confirm it, the builder is idle again.
  const decayed = expireOverlays(town, NOW + WORKING_TTL_MS + 1);
  assert.equal(decayed.residents.builder.state, 'idle');
  assert.equal(decayed.residents.builder.source, 'records');
  assert.equal(decayed.counts.working, 0);
});

test('a working claim survives while newer authoritative events keep arriving', () => {
  const signals = {};
  let town = withBaseline(projectServerState(signals, NOW, null, 'live'), signals, NOW);
  town = applyEvent(town, evt(1, 'verification.started', {}), false, NOW);
  town = applyEvent(town, evt(2, 'task.queued', { scope: 'interactive' }), false, NOW + 1000);
  const later = expireOverlays(town, NOW + 60_000);
  assert.equal(later.residents.tester.state, 'working', 'still within the TTL for verification');
});

test('duplicate and out-of-order events change nothing', () => {
  let town = withBaseline(projectServerState({}, NOW, null, 'live'), {}, NOW);
  town = applyEvent(town, evt(5, 'verification.started', {}), false, NOW);
  const duplicate = applyEvent(town, evt(5, 'implementation.failed', {}), false, NOW + 10);
  assert.equal(duplicate, town, 'the same sequence must be dropped');
  const older = applyEvent(town, evt(4, 'task.started', {}), false, NOW + 20);
  assert.equal(older, town, 'an older sequence must be dropped');
  assert.equal(town.residents.builder.state, 'idle');
});

test('a running tool decides which building the coordinator is working in', () => {
  const cases: Array<[string, string]> = [
    ['read_file', 'library'], ['search_files', 'library'], ['web_search', 'library'],
    ['write_file', 'workshop'], ['apply_patch', 'workshop'], ['git', 'workshop'],
    ['pytest', 'testing_lab'], ['run_tests', 'testing_lab'], ['verify_implementation', 'testing_lab'],
    ['save_memory', 'archive'], ['reflect', 'archive'],
    ['approve_plan', 'review_office'],
  ];
  for (const [tool, location] of cases) {
    assert.equal(toolLocation({ tool_name: tool }), location, `${tool} should map to ${location}`);
  }
  // An unknown tool keeps him where he is instead of inventing a destination.
  assert.equal(toolLocation({ tool_name: 'zzz_unknown' }), null);
  assert.equal(toolLocation({}), null);
  assert.equal(toolName({ tool_name: 'read_file' }), 'read_file');
});

test('a snapshot refresh keeps live tool detail while a task is running', () => {
  const signals = {
    agent: { state: 'executing', current_task: 't-chat' },
    tasks: [{ id: 't-chat', state: 'running' }],
    goals: [],
  };
  let town = withBaseline(projectServerState(signals, NOW, null, 'live'), signals, NOW);
  assert.equal(town.residents.coordinator.state, 'working');
  assert.equal(town.residents.coordinator.location, 'town_square');
  town = applyEvent(town, evt(10, 'hermes.tool_use', { tool_name: 'write_file' }), false, NOW + 100);
  assert.equal(town.residents.coordinator.location, 'workshop');
  // A refresh lands mid-task (the 20s poll): the location must survive it.
  const refreshed = withBaseline({ ...town }, signals, NOW + 500);
  assert.equal(refreshed.residents.coordinator.location, 'workshop', 'live detail survived');
  assert.equal(refreshed.residents.coordinator.state, 'working');
  // Records that are decisive still win over a stale overlay.
  const ended = withBaseline({ ...town }, { ...signals, agent: { state: 'idle', current_task: null },
    tasks: [{ id: 't-chat', state: 'completed' }] }, NOW + 600);
  assert.equal(ended.residents.coordinator.location, 'town_square', 'records take over once the task ends');
});

test('tool activity only animates the coordinator while a task is really running', () => {
  const now = NOW;
  // No task: tool traffic must not put anyone to work.
  let town = projectServerState({ agent: { state: 'idle' } }, now, null, 'live');
  assert.equal(town.taskRunning, false);
  town = applyEvent(town, evt(40, 'hermes.tool_use', { tool_name: 'write_file' }), false, now + 100);
  assert.equal(town.residents.coordinator.state, 'idle');

  // A task starts, then a tool call moves him to the matching building and shows what he is doing.
  town = applyEvent(town, evt(41, 'task.started', { scope: 'interactive' }), false, now + 200);
  assert.equal(town.taskRunning, true);
  assert.equal(town.residents.coordinator.state, 'working');
  town = applyEvent(town, evt(42, 'hermes.tool_use', { tool_name: 'read_file', input: 'x' }), false, now + 300);
  assert.equal(town.residents.coordinator.location, 'library');
  // Resident label is now a minimal operational indicator; activity narration
  // (what Hermes is actually doing) is handled by the bubble system (UI-VIS-007).
  assert.equal(town.residents.coordinator.label, 'Working');
  town = applyEvent(town, evt(43, 'hermes.tool_use', { tool_name: 'write_file' }), false, now + 400);
  assert.equal(town.residents.coordinator.location, 'workshop');

  // Task ends: the completion is acknowledged, and tool traffic is inert again.
  town = applyEvent(town, evt(44, 'task.completed', {}), false, now + 500);
  assert.equal(town.taskRunning, false);
  assert.equal(town.residents.coordinator.state, 'completed');
  town = applyEvent(town, evt(45, 'hermes.tool_use', { tool_name: 'write_file' }), false, now + 600);
  assert.equal(town.residents.coordinator.eventType, 'task.completed', 'the tool event changed nothing');
  // And once the acknowledgement expires the persisted baseline is back.
  const settled = expireOverlays(town, now + 20_000);
  assert.equal(settled.residents.coordinator.state, 'idle');
});

test('an autonomous investigation task belongs to the researcher, not the coordinator', () => {
  const signals = {
    agent: { state: 'executing', current_task: 't-goal' },
    tasks: [{ id: 't-goal', state: 'running' }],
    goals: [{ id: 'g1', state: 'running', title: 'Investigate TODOs', task_id: 't-goal' }],
  };
  assert.equal(chatTaskRunning(signals), false);
  assert.equal(chatTaskRunning({ agent: { state: 'executing', current_task: 't-chat' }, tasks: [{ id: 't-chat', state: 'running' }] }), true);
  assert.equal(chatTaskRunning({ agent: { state: 'idle', current_task: null } }), false);
});

test('a reconnect replay never animates historical events', () => {
  const now = Date.UTC(2026, 10, 5, 12, 0, 0);
  let town = projectServerState({ agent: { state: 'idle' } }, now, null, 'live');
  // An event from three hours ago arrives on the replayed stream after connect.
  const old = { sequence: 900, type: 'task.started', payload: { scope: 'interactive' },
                timestamp: new Date(now - 3 * 3600_000).toISOString() };
  town = applyEvent(town, old, false, now);
  assert.equal(town.lastSequence, 900, 'the cursor still advances');
  assert.equal(town.residents.coordinator.state, 'idle', 'but no role is put to work');

  // A genuinely new event does overlay.
  const fresh = { sequence: 901, type: 'task.started', payload: { scope: 'interactive' },
                  timestamp: new Date(now + 500).toISOString() };
  town = applyEvent(town, fresh, false, now + 600);
  assert.equal(town.residents.coordinator.state, 'working');
});

test('agent runtime stream events belong to no area and are not "unmapped"', () => {
  for (const type of ['hermes.text', 'hermes.tool_use', 'hermes.tool_result', 'hermes.system', 'hermes.result']) {
    assert.equal(isRuntimeEvent(type), true, `${type} is presentation-only`);
    assert.equal(roleForEvent(type, {}), null);
  }
  let town = projectServerState({}, NOW, null, 'live');
  town = applyEvent(town, evt(20, 'hermes.tool_use', { tool_name: 'read_file' }), false, NOW + 1000);
  assert.deepEqual(town.unknownEvents, []);
  assert.equal(town.lastSequence, 20);
});

test('terminal events are acknowledged, then the record baseline returns', () => {
  const signals = { runs: [{ id: 'r1', state: 'implementing', project: 'p', created_at: '2026-11-05T11:00:00Z' }] };
  let town = withBaseline(projectServerState(signals, NOW, null, 'live'), signals, NOW);
  assert.equal(town.residents.builder.state, 'working');
  town = applyEvent(town, evt(3, 'implementation.failed', { project: 'p' }), false, NOW);
  assert.equal(town.residents.builder.state, 'failed');
  const later = expireOverlays(town, NOW + 30_000);
  // The record still says implementing, so the truthful baseline is restored, not invented.
  assert.equal(later.residents.builder.state, 'working');
  assert.equal(later.residents.builder.source, 'records');
});

test('counts only ever reflect roles that are actually busy or waiting', () => {
  const signals = { plans: [{ id: 'p1', state: 'proposed' }], goals: [{ id: 'g1', state: 'completed' }] };
  const town = withBaseline(projectServerState(signals, NOW, null, 'live'), signals, NOW);
  assert.equal(town.counts.waiting, 1);
  assert.equal(town.counts.working, 0);
  assert.equal(town.counts.finished, 1);
});

test('the summary names who is busy and what waits on a human', () => {
  const signals = { plans: [{ id: 'p1', state: 'proposed' }] };
  const town = withBaseline(projectServerState(signals, NOW, null, 'live'), signals, NOW);
  assert.match(summarize(town), /waiting on you: planner/);
  assert.match(summarize(emptyTown(NOW)), /No role is working/);
});

test('activity words never dress an idle role up as work', () => {
  assert.equal(ACTIVITY_WORDS.idle, 'idle');
  assert.equal(ACTIVITY_WORDS.waiting_approval, 'waiting for you');
  assert.equal(ACTIVITY_WORDS.completed, 'finished');
});
