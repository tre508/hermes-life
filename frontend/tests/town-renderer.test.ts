/**
 * UI-VIS-003 §4 / D4 — the renderer seam's testable surface.
 *
 * These run in plain Node, with no DOM. The static fallback's content is a pure function over the
 * model, so "the fallback shows the same seven residents and the same real states" is a unit test
 * rather than a screenshot. The 3D renderer needs a browser and is verified through
 * `window.__hermesTown` (kind / frames / positions), not from here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ACTIVITY_WORDS, ROLES, ROSTER, TOWN_LOCATIONS, emptyTown } from '../src/town-model.ts';
import { staticRowDetail, staticRows } from '../src/town-renderer-static.ts';
import { DESIGN, prefersReducedMotion, stateWordFor, supportsWebGL2 } from '../src/town-renderer.ts';
import { ROOM, facilityPlan, spotFor, walkEase } from '../src/town-world/layout.ts';
import { activityVisual } from '../src/town-renderer-3d.ts';
import { LOCATION_LABEL, LAB_NAME, locationLabel, locationPurpose } from '../src/town-vocabulary.ts';

test('the static fallback lists every role, in ROLES order', () => {
  const rows = staticRows(emptyTown());
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map(row => row.role), [...ROLES]);
});

test('the fallback shows the model’s names, titles, stations and state words verbatim', () => {
  const rows = staticRows(emptyTown());
  for (const row of rows) {
    assert.equal(row.name, ROSTER[row.role].name);
    assert.equal(row.title, ROSTER[row.role].title);
    assert.equal(row.locationName, locationLabel(row.location));
    assert.equal(row.stateWord, ACTIVITY_WORDS[row.state]);
    assert.equal(row.location, ROSTER[row.role].location);
  }
  // An idle town is idle: the fallback must not open with a claim of work.
  assert.ok(rows.every(row => row.stateWord === 'idle'));
});

test('an unknown state reads as unknown, never as an invented action', () => {
  const state = emptyTown();
  state.residents.tester = { ...state.residents.tester, state: 'unknown', label: '' };
  const row = staticRows(state).find(candidate => candidate.role === 'tester');
  assert.ok(row);
  assert.equal(row.stateWord, 'Status unknown');
  assert.equal(row.locationName, locationLabel('testing_lab'));
});

test('a finished role is a word, not an animation replay', () => {
  const state = emptyTown();
  state.residents.builder = { ...state.residents.builder, state: 'completed', label: 'Built the candidate' };
  const row = staticRows(state).find(candidate => candidate.role === 'builder');
  assert.ok(row);
  assert.equal(row.stateWord, 'finished');
  assert.equal(staticRowDetail(row, 'Built the candidate'), `finished — Built the candidate · ${locationLabel('workshop')}`);
});

test('the WebGL probe and the motion preference degrade safely with no DOM', () => {
  // No `document` / `window` here. The probe must answer "cannot", which is what selects the
  // fallback in a browser; a throw here would break the factory contract.
  assert.equal(supportsWebGL2(), false);
  assert.equal(prefersReducedMotion(), false);
});

test('the design space the renderers frame is the panel ratio', () => {
  assert.equal(DESIGN.width / DESIGN.height, 800 / 425);
});

// --- milestone 2: the facility is derived from the model, not hand-placed ------------------------

test('the floor plan gives one station per role, in ROLES order, covering every location', () => {
  const plan = facilityPlan();
  assert.deepEqual(plan.map(station => station.role), [...ROLES]);
  assert.deepEqual(
    [...plan.map(station => station.location)].sort(),
    [...ROLES.map(role => ROSTER[role].location)].sort());
  // One station per TOWN_LOCATIONS entry and no invented place: seven places, seven buildings.
  assert.equal(new Set(plan.map(station => station.location)).size, Object.keys(TOWN_LOCATIONS).length);
});

test('signage and destinations come from the model, worded for the facility', () => {
  for (const station of facilityPlan()) {
    assert.equal(station.label, locationLabel(station.location));
    assert.equal(station.view, TOWN_LOCATIONS[station.location].view);
    assert.equal(station.location, ROSTER[station.role].location);
  }
});

test('every location has one presentation label, purpose and no leftovers from the town metaphor', () => {
  for (const location of Object.keys(TOWN_LOCATIONS) as Array<keyof typeof TOWN_LOCATIONS>) {
    assert.ok(LOCATION_LABEL[location], `${location} needs a label`);
    assert.ok(locationPurpose(location).length > 0, `${location} needs a purpose`);
  }
  // The facility's own name, and no visible wording that still says "town".
  assert.match(LAB_NAME, /Operations Lab/);
  const visible = Object.values(LOCATION_LABEL).join(' ') + ' ' + LAB_NAME;
  assert.doesNotMatch(visible, /\btown\b/i, 'the old town wording must not survive in the UI');
});

test('the coordinator holds the centre and no station overlaps or leaves the room', () => {
  const plan = facilityPlan();
  const centre = plan.find(station => station.role === 'coordinator');
  assert.ok(centre);
  assert.equal(centre.x, 0);
  assert.equal(centre.z, 0);

  for (const station of plan) {
    // Inside the floor, with room for the desk footprint and the divider.
    assert.ok(Math.abs(station.x) < ROOM.width / 2 - 1.5, `${station.role} x=${station.x} inside the room`);
    assert.ok(Math.abs(station.z) < ROOM.depth / 2 - 1.2, `${station.role} z=${station.z} inside the room`);
  }

  for (let i = 0; i < plan.length; i += 1) {
    for (let j = i + 1; j < plan.length; j += 1) {
      const distance = Math.hypot(plan[i].x - plan[j].x, plan[i].z - plan[j].z);
      assert.ok(distance > 3, `${plan[i].role} and ${plan[j].role} are ${distance.toFixed(2)} apart`);
    }
  }
});

test('every working station turns to face the command dais', () => {
  for (const station of facilityPlan()) {
    if (station.role === 'coordinator') continue;
    const forward = { x: Math.sin(station.yaw), z: Math.cos(station.yaw) };
    const towardDais = { x: -station.x, z: -station.z };
    const length = Math.hypot(towardDais.x, towardDais.z);
    const alignment = (forward.x * towardDais.x + forward.z * towardDais.z) / length;
    assert.ok(alignment > 0.98, `${station.role} faces the dais (alignment ${alignment.toFixed(3)})`);
  }
});

test('the plan is deterministic: the same town gives the same coordinates', () => {
  assert.deepEqual(facilityPlan(), facilityPlan());
});

// --- milestone 3: activity animation bound to state ---------------------------------------------

const ACTIVITIES = ['idle', 'queued', 'working', 'waiting_approval', 'completed', 'failed', 'blocked', 'unknown'] as const;

test('the activity table covers every state the model can produce', () => {
  for (const activity of ACTIVITIES) {
    const visual = activityVisual(activity);
    assert.ok(visual, activity + ' has a visual');
    assert.ok(['idle', 'working', 'waiting', 'alert', 'unknown'].includes(visual.pose), activity + ' pose');
    assert.ok(['none', 'queued', 'waiting', 'alert', 'unknown'].includes(visual.badge), activity + ' badge');
    assert.ok(['task', 'dim'].includes(visual.screen), activity + ' screen');
    assert.equal(typeof visual.flash, 'boolean');
  }
});

test('only `working` is allowed to look like work', () => {
  for (const activity of ACTIVITIES) {
    assert.equal(activityVisual(activity).pose === 'working', activity === 'working',
      activity + ' must not take the working pose');
  }
  // The console only ever carries a task label for the one state that is really executing.
  for (const activity of ACTIVITIES) {
    assert.equal(activityVisual(activity).screen === 'task', activity === 'working',
      activity + ' must not light the station console');
  }
});

test('waiting and queued are visibly not working: a badge and a still figure', () => {
  const waiting = activityVisual('waiting_approval');
  assert.equal(waiting.badge, 'waiting');
  assert.equal(waiting.pose, 'waiting');
  assert.equal(waiting.screen, 'dim');

  const queued = activityVisual('queued');
  assert.equal(queued.badge, 'queued');
  assert.equal(queued.pose, 'waiting');
  // A different marker shape as well as a different colour: queued and waiting are not the same gate.
  assert.notEqual(queued.badge, waiting.badge);
});

test('a failed or blocked operation is a stationary alert, never motion', () => {
  for (const activity of ['failed', 'blocked'] as const) {
    const visual = activityVisual(activity);
    assert.equal(visual.pose, 'alert', activity + ' is an alert pose');
    assert.equal(visual.badge, 'alert', activity + ' carries the alert marker');
    assert.equal(visual.screen, 'dim');
    assert.equal(visual.flash, false);
  }
});

test('completion is a one-shot acknowledgement, and only completion is', () => {
  assert.equal(activityVisual('completed').flash, true);
  assert.notEqual(activityVisual('completed').pose, 'working');
  for (const activity of ACTIVITIES) {
    if (activity === 'completed') continue;
    assert.equal(activityVisual(activity).flash, false, activity + ' must not flash');
  }
});

test('an unknown state is marked unknown, with nothing invented', () => {
  const visual = activityVisual('unknown');
  assert.equal(visual.badge, 'unknown');
  assert.equal(visual.pose, 'unknown');
  assert.equal(visual.screen, 'dim');
  assert.equal(visual.flash, false);
});

test('a resident stands at its own desk, and a visitor stands beside it', () => {
  for (const station of facilityPlan()) {
    const home = spotFor(station.role, station.location);
    assert.equal(home.x, station.x, station.role + ' works at its own desk');
    assert.equal(home.z, station.z, station.role + ' works at its own desk');
  }
  // The coordinator's home is the raised command dais; a visitor to the square stands on it too.
  assert.ok(spotFor('coordinator', 'town_square').y > 0, 'the dais is raised');

  // A read tool puts the coordinator in the Library — beside Sage's desk, never on top of her.
  const library = facilityPlan().find(station => station.location === 'library');
  assert.ok(library);
  const sage = spotFor('researcher', 'library');
  const visitor = spotFor('coordinator', 'library');
  assert.equal(visitor.y, 0, 'the coordinator is off the dais when he leaves it');
  assert.ok(Math.hypot(visitor.x - library.x, visitor.z - library.z) > 1, 'beside the desk, not at it');
  assert.ok(Math.hypot(visitor.x - sage.x, visitor.z - sage.z) > 1, 'not standing inside the resident');
});

test('a destination is only ever a real building, and never invented', () => {
  for (const role of ROLES) {
    for (const location of Object.keys(TOWN_LOCATIONS) as Array<keyof typeof TOWN_LOCATIONS>) {
      const spot = spotFor(role, location);
      for (const value of [spot.x, spot.y, spot.z, spot.yaw]) assert.equal(Number.isFinite(value), true);
      // Every spot is inside the room, for every role/location pair — no walk leaves the floor.
      assert.ok(Math.abs(spot.x) < ROOM.width / 2, role + '@' + location + ' inside width');
      assert.ok(Math.abs(spot.z) < ROOM.depth / 2, role + '@' + location + ' inside depth');
    }
  }
});

test('the walk eases: it starts at the origin, ends at the target, and never goes backwards', () => {
  assert.equal(walkEase(0), 0);
  assert.equal(walkEase(1), 1);
  assert.equal(walkEase(-5), 0);      // clamped, so a stray dt cannot teleport a figure
  assert.equal(walkEase(9), 1);
  assert.ok(walkEase(0.5) > 0 && walkEase(0.5) < 1);
  let previous = -1;
  for (let step = 0; step <= 20; step += 1) {
    const value = walkEase(step / 20);
    assert.ok(value >= previous, 'monotonic at ' + step);
    previous = value;
  }
});

// --- milestone 4: one vocabulary for every view --------------------------------------------------

test('the state word is the model’s own, and unknown is never dressed up as an action', () => {
  for (const activity of ACTIVITIES) {
    const word = stateWordFor(activity);
    assert.equal(typeof word, 'string');
    assert.ok(word.length > 0, activity + ' has a word');
    if (activity === 'unknown') assert.equal(word, 'Status unknown');
    else assert.equal(word, ACTIVITY_WORDS[activity]);
  }
});

test('the 3D tooltip and the static fallback cannot disagree about a state word', () => {
  // Both read `stateWordFor`, so the hover text and the no-WebGL list speak the same vocabulary.
  for (const activity of ACTIVITIES) {
    const state = emptyTown();
    for (const role of ROLES) state.residents[role] = { ...state.residents[role], state: activity };
    for (const row of staticRows(state)) assert.equal(row.stateWord, stateWordFor(activity));
  }
});
