/**
 * HA-032 — the resident card is a real 'resident' kind in the contextual
 * Inspector (spec §3.2: clicking a resident opens the contextual inspector
 * showing role, active operation, owning project or goal, relevant events,
 * evidence and available actions).
 *
 * These checks pin the implementation contracts: the typed 'resident' kind and
 * its renderer in context-inspector.ts, town-view selecting kind 'resident'
 * with the resident record while the room highlight ring stays keyed to the
 * room pick, the retirement of the floating #town-selection popover in favor
 * of the Inspector, and the untouched room-inspector behavior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const inspector = readFileSync(join(src, 'context-inspector.ts'), 'utf8');
const townView = readFileSync(join(src, 'town-view.ts'), 'utf8');
const navState = readFileSync(join(src, 'navigation-state.ts'), 'utf8');

const fnBody = (source: string, name: string): string =>
    source.slice(source.indexOf(name), source.indexOf('\n}', source.indexOf(name)));

const showResident = fnBody(townView, 'function showResident');
const showBuilding = fnBody(townView, 'function showBuilding');
const residentRenderer = inspector.slice(inspector.indexOf("registerKindRenderer('resident'"));

test('§3.2 the inspector owns a typed resident kind with its label', () => {
    assert.match(inspector, /export type InspectorKind = SelectionKind \| 'resident'/);
    assert.match(inspector, /resident: 'Resident'/);
    assert.match(inspector, /export interface ResidentSelection \{ kind: 'resident'; id: string; record: ResidentRecord; \}/);
    // The record a resident selection carries: role/title, operation, facts, events.
    assert.match(inspector, /export interface ResidentRecord \{/);
    assert.match(inspector, /events: ResidentEventLine\[\]/);
});

test('§3.2 the resident renderer draws role/title, operation and the fact rows', () => {
    assert.match(inspector, /registerKindRenderer\('resident', \(sel, body\) => \{/);
    assert.match(residentRenderer, /\$\{r\.name\} — \$\{r\.title\}/, 'role and title head the card');
    assert.match(residentRenderer, /state\.textContent = r\.operation/, 'the active operation is its own line');
    assert.match(residentRenderer, /for \(const \[key, value\] of r\.rows\)/, 'the rows carry place, why, project/task and goal');
});

test('§3.2 the card answers "why" with the owning goal, not just a classification', () => {
    // The rows are built from the same town records the World renders (no second truth).
    assert.match(townView, /const goalTitle = resident\.taskId \? goalTitles\.get\(resident\.taskId\) : undefined/);
    assert.match(townView, /\['Why', isAutonomousTask\(resident\.taskId\)/);
    assert.match(townView, /Autonomous — investigation goal/);
});

test('§3.2 the last N events ride with the card, each with its timestamp when available', () => {
    assert.match(townView, /const RECENT_EVENT_LIMIT = 5/, 'N≈5 recent events');
    assert.match(townView, /if \(list\.length > RECENT_EVENT_LIMIT\) list\.length = RECENT_EVENT_LIMIT/, 'bounded — never grows');
    // The recent-event data already flowing through showResident's town state:
    // noted per change from the event stream, with the wire timestamp when present.
    assert.match(townView, /noteRecentEvents\(typeof event\.timestamp === 'string' \? event\.timestamp : null\)/);
    assert.match(townView, /timestamp: timestamp \?\? \(res\.observedAt \? clock\(res\.observedAt\) : null\)/);
    assert.match(townView, /events: recentEventsFor\(role\)/);
    assert.match(residentRenderer, /Recent events/);
    assert.match(residentRenderer, /ev\.timestamp \? ` · \$\{ev\.timestamp\}` : ''/, 'a timestamp renders only when available');
});

test('§3.2 evidence and the available actions: Activity/evidence, Open task, Open workspace', () => {
    assert.match(residentRenderer, /Activity \/ evidence/);
    assert.match(residentRenderer, /openActivityForTask\(r\.taskId!\)/, 'the existing Activity/evidence action');
    assert.match(residentRenderer, /openTask\(r\.taskId!, \{ destination: 'work' \}\)/);
    assert.match(residentRenderer, /'Open ' \+ r\.view/);
    assert.match(residentRenderer, /if \(r\.workspace\) openWorkspace\(r\.workspace\)/);
});

test('§3.2 clicking a resident selects kind "resident" with the resident record', () => {
    assert.match(showResident, /setInspectorSelection\(\{ kind: 'resident', id: role, record: residentRecord\(role\) \}\)/);
    assert.match(townView, /function residentRecord\(role: Role\): ResidentRecord \{/);
    // The record is re-read on every data refresh so the card cannot go stale.
    assert.match(townView, /\{ \.\.\.sel, record: residentRecord\(sel\.id as Role\) \}/);
});

test('§3.2 the room highlight ring survives the resident pick', () => {
    // The resident pick still selects the resident's CURRENT ROOM (one ring,
    // room_id keyed) — the ring must not regress when the card moves.
    assert.match(showResident, /setSelection\('home', \{ kind: 'room', id: resident\.location \}\)/);
    // The room pick is keyed first; the resident card layers on top of it.
    assert.ok(showResident.indexOf("kind: 'room'") < showResident.indexOf("kind: 'resident'"),
        'the room selection (ring) is set before the resident card');
});

test('the floating #town-selection popover is retired in favor of the Inspector', () => {
    // Removed, not merely hidden: the element is never created, nothing renders
    // into it, and the resident card draws in the contextual inspector instead.
    assert.ok(!/id = 'town-selection'/.test(townView), 'the popover element is gone');
    assert.ok(!/createElement\('aside'\)/.test(townView), 'no floating aside is built');
    assert.ok(!/'Role detail'/.test(townView), 'its dialog chrome is gone with it');
    assert.ok(!/\.selection\.(replaceChildren|hidden)/.test(townView), 'nothing renders into or shows the popover');
    assert.match(townView, /retired the floating #town-selection popover/);
    assert.match(inspector, /card\.className = 'town-card'/, 'the card renders in the inspector');
});

test('the resident card stays dismissible: Escape and room picks close it', () => {
    assert.match(townView, /const hideResidentCard = \(\) => setInspectorSelection\(null\);/);
    assert.match(townView, /else hideResidentCard\(\);/);
    // A room pick replaces the resident card (one contextual surface at a time).
    assert.match(showBuilding, /setInspectorSelection\(null\);/);
});

test('the room inspector behavior is intact', () => {
    assert.match(townView, /registerKindRenderer\('room', \(sel, body\) => \{/);
    assert.match(townView, /fqLine\(FQ\.why, here\.length/);
    assert.match(townView, /'Open ' \+ place\.view \+ ' workspace'/);
    assert.match(showBuilding, /setSelection\('home', \{ kind: 'room', id: location \}\)/);
    assert.match(showBuilding, /renderer\?\.focusRoom\?\.\(location\)/);
    // The pinned Home/World surface rule: a selection replaces ctx-home.
    assert.match(inspector, /ctxHome\.hidden = !\(onWorld && !roomSel\)/);
    // The resident card layers over the room pick, which resumes when dismissed.
    assert.match(inspector, /inspectorSelection \?\? getValidSelection\('home'\)/);
});

test("the 'resident' kind stays out of navigation-state (not ours to edit)", () => {
    // The Home scope's acceptance list only knows 'room'; per the brief the
    // selection is kept inside town-view/context-inspector instead.
    assert.ok(!/'resident'/.test(navState), 'navigation-state must not grow the kind');
    assert.match(inspector, /export function setInspectorSelection/);
    assert.match(inspector, /export function getInspectorSelection/);
});
