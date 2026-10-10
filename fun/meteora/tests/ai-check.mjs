// Run with: node tests/ai-check.mjs
import { test, run, assert, finite } from './harness.mjs';
import { createBrain, thinkEnemy } from '../js/ai.js';
import { createShip, stepShip, forward } from '../js/flight.js';
import { createField, densityAt } from '../js/field.js';
import { leadPoint } from '../js/weapons.js';
import { ENEMY, PLAYER, ENEMY_CANNON, FIELD, STEP as DT } from '../js/config.js';
import { dist, dot, normalize, sub, qLookRotation } from '../js/vec.js';

const EMPTY = { ...FIELD, types: FIELD.types.map(t => ({ ...t, count: 0 })), landmarks: { ...FIELD.landmarks, count: 0 } };
const ent = (id, team, stats, o) => ({ id, team, stats, radius: stats.radius, alive: true, ship: createShip(stats, o) });
function sim(enemy, ctx, seconds, each) {
  const brain = enemy.brain ?? (enemy.brain = createBrain(5));
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const c = thinkEnemy(brain, enemy, ctx, DT);
    stepShip(enemy.ship, c, DT); each?.(c, brain, i);
  }
}
const calm = { locked: false, missileInbound: false };

test('an enemy closes from 3 km into an attack run', () => {
  const p = ent(1, 0, PLAYER), e = ent(2, 1, ENEMY, { pos: [0, 0, -3000] });
  const ctx = { field: createField(1, EMPTY), player: p, threat: calm, wasHit: false };
  let attacked = false, closest = Infinity;
  sim(e, ctx, 30, (c, b) => { attacked ||= b.state === 'attack'; closest = Math.min(closest, dist(e.ship.pos, p.ship.pos)); });
  assert.ok(attacked); assert.ok(closest < 1200);
});
test('it fires only inside the angle and range gates', () => {
  const p = ent(1, 0, PLAYER, { vel: [40, 0, 0] }), e = ent(2, 1, ENEMY, { pos: [300, 200, -2500] });
  const ctx = { field: createField(1, EMPTY), player: p, threat: calm, wasHit: false };
  let shots = 0;
  sim(e, ctx, 60, c => {
    for (let k = 0; k < 3; k++) p.ship.pos[k] += p.ship.vel[k] * DT;
    if (!c.fire) return;
    shots++;
    const lead = leadPoint([0, 0, 0], e.ship.pos, e.ship.vel, p.ship.pos, p.ship.vel, ENEMY_CANNON.speed);
    assert.ok(lead, 'lead exists');
    const to = normalize([0, 0, 0], sub([0, 0, 0], lead, e.ship.pos));
    assert.ok(Math.acos(Math.min(1, dot(to, forward([0, 0, 0], e.ship)))) <= 4 * Math.PI / 180 + 1e-6, 'angle gate');
    assert.ok(dist(e.ship.pos, p.ship.pos) <= 1200, 'range gate');
  });
  assert.ok(shots > 0, 'it did shoot');
});
test('it breaks off inside 150 m', () => {
  const p = ent(1, 0, PLAYER), e = ent(2, 1, ENEMY, { pos: [0, 0, -140], vel: [0, 0, 150] });
  qLookRotation(e.ship.q, [0, 0, 1], [0, 1, 0]);
  const ctx = { field: createField(1, EMPTY), player: p, threat: calm, wasHit: false };
  e.brain = createBrain(5); e.brain.state = 'attack';
  let broke = false; sim(e, ctx, 0.2, (c, b) => { broke ||= b.state === 'breakoff'; });
  assert.ok(broke);
});
test('it evades and burns when a missile is inbound', () => {
  const p = ent(1, 0, PLAYER), e = ent(2, 1, ENEMY, { pos: [0, 0, -800] });
  const ctx = { field: createField(1, EMPTY), player: p, threat: { locked: true, missileInbound: true }, wasHit: false };
  let evaded = false, burned = false; sim(e, ctx, 0.5, (c, b) => { evaded ||= b.state === 'evade'; burned ||= c.boost; });
  assert.ok(evaded && burned);
});
test('a minute in the densest cell without touching a rock', () => {
  const field = createField(1234);
  let best = -1, at = null;
  for (let x = -3500; x <= 3500; x += 500) for (let z = -3500; z <= 3500; z += 500) {
    const d = densityAt(x, 0, z, 1234); if (d > best && Math.hypot(x, z) > 600) { best = d; at = [x, 0, z]; }
  }
  const clear = p => field.queryRadius(p, ENEMY.radius + 30).length === 0;
  let start = null;
  for (let k = 0; k < 400 && !start; k++) { const p = [at[0] + (k % 20) * 40 - 400, 0, at[2] + Math.floor(k / 20) * 40 - 400]; if (clear(p)) start = p; }
  const p = ent(1, 0, PLAYER, { pos: [at[0] + 1500, 0, at[2]] }), e = ent(2, 1, ENEMY, { pos: start });
  const ctx = { field, player: p, threat: calm, wasHit: false };
  sim(e, ctx, 60, () => {
    assert.equal(field.queryRadius(e.ship.pos, e.radius).length, 0, `hit a rock at ${e.ship.pos.map(Math.round)}`);
  });
});
test('an enemy exactly on the player, both at rest, yields finite controls', () => {
  const p = ent(1, 0, PLAYER), e = ent(2, 1, ENEMY);
  const ctx = { field: createField(1, EMPTY), player: p, threat: calm, wasHit: false };
  const c = thinkEnemy(createBrain(1), e, ctx, DT);
  finite([c.pitch, c.yaw, c.roll, c.strafe, c.lift, c.throttleSet ?? 0]);
});
await run();
