/** Phase 6: structural contracts that must survive visual redesigns. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PHYSICAL_ROOMS, roomForRole, roomToWorld } from '../src/town-world/ship-rooms';
import { ROLES, ROSTER } from '../src/town-model';
import { facilityPlan, spotFor } from '../src/town-world/layout';

const expected = [
  'director_office', 'research_station', 'review_station', 'dev_station',
  'control_room', 'lab', 'archive', 'break_room',
];

test('exactly eight unique physical rooms (one Command Centre)', () => {
  assert.deepEqual(PHYSICAL_ROOMS.map(r => r.id), expected);
  assert.equal(new Set(PHYSICAL_ROOMS.map(r => r.id)).size, 8);
  assert.equal(PHYSICAL_ROOMS.filter(r => r.id === 'control_room').length, 1);
  for (const r of PHYSICAL_ROOMS) {
    assert.ok(r.label.trim().length > 0);
    assert.ok(Number.isFinite(r.u) && Number.isFinite(r.v));
    assert.ok(r.width > 0 && r.depth > 0);
  }
});

test('seven existing backend roles; Break Room has no owner', () => {
  assert.equal(ROLES.length, 7);
  assert.equal(PHYSICAL_ROOMS.find(r => r.id === 'break_room')?.owner, null);
  const assigned = PHYSICAL_ROOMS.flatMap(r => r.owner ? [r.owner] : []);
  assert.equal(assigned.length, 7);
  assert.equal(new Set(assigned).size, 7);
  assert.deepEqual([...assigned].sort(), [...ROLES].sort());
  for (const role of ROLES) assert.equal(roomForRole(role).owner, role);
  assert.equal(roomForRole('planner').id, 'director_office');
  assert.equal(roomForRole('coordinator').id, 'control_room');
});

test('facility plan preserves established backend LocationIds', () => {
  const plan = facilityPlan();
  assert.equal(plan.length, ROLES.length);
  assert.equal(new Set(plan.map(p => p.location)).size, 7);
  for (const role of ROLES) {
    const station = plan.find(p => p.role === role);
    assert.ok(station, `missing ${role}`);
    assert.equal(station.location, ROSTER[role].location);
    const room = roomForRole(role);
    const point = roomToWorld(room.u, room.v);
    assert.ok(Math.abs(station.x - point.x) < 0.001);
    assert.ok(Math.abs(station.z - point.z) < 0.001);
    const home = spotFor(role, ROSTER[role].location);
    assert.equal(home.x, station.x);
    assert.equal(home.z, station.z);
  }
});

test('room graph has the screenshot-based spatial relationships', () => {
  const r = Object.fromEntries(PHYSICAL_ROOMS.map(r => [r.id, r]));
  assert.ok(r.control_room.v > r.director_office.v);
  assert.ok(r.control_room.v < r.archive.v && r.control_room.v < r.break_room.v);
  assert.ok(r.research_station.u < r.control_room.u);
  assert.ok(r.review_station.u > r.control_room.u);
  assert.ok(r.dev_station.u < r.control_room.u);
  assert.ok(r.lab.u > r.control_room.u);
  assert.ok(r.archive.u < r.control_room.u);
  assert.ok(r.break_room.u > r.control_room.u);
});
