// Run with: node tests/well-check.mjs
// The Well: a black hole's pull, its point of no return, and what falls.
import { test, run, assert, near } from './harness.mjs';
import { createWell } from '../js/well.js';
import { createBrain, thinkEnemy } from '../js/ai.js';
import { createShip, stepShip, NEUTRAL_CONTROLS } from '../js/flight.js';
import { createField } from '../js/field.js';
import { createWorld, startRun, stepWorld, drainEvents, IDLE } from '../js/world.js';
import { defineMission } from '../js/mission.js';
import { belt } from '../js/missions/belt.js';
import { ENEMY, PLAYER, STEP as DT } from '../js/config.js';

const WELL = { pos: [0, 0, 0], rs: 1500, gm: 1.46e8 };
const well = createWell(WELL);
const r = p => Math.hypot(...p);

test('the pull is the pseudo-Newtonian one, toward the hole, unbounded at the horizon', () => {
  const a = [0, 0, 0];
  for (const d of [3000, 8000, 20000]) {
    const g = well.accel([d, 0, 0], a);
    near(g, WELL.gm / (d - WELL.rs) ** 2, 1e-9);
    near(a[0], -g, 1e-9); near(a[1], 0, 1e-12);
  }
  assert.ok(well.accel([1600, 0, 0]) > 1000 * well.accel([20000, 0, 0]));
  // The point of no return for a given thrust is where the pull matches it.
  for (const thrust of [45, 120]) near(well.accel([well.radiusFor(thrust), 0, 0]), thrust, 1e-6);
});

test('a dead hulk falls in on the predicted clock; sideways speed buys it time', () => {
  const p = [20000, 0, 0];
  const fall = well.timeToHorizon(p, [0, 0, 0]);
  const swing = well.timeToHorizon(p, [0, 0, 0.5 * well.circular(20000)]);
  assert.ok(fall > 200 && fall < 260, `fall ${fall}`);
  assert.ok(swing > fall * 1.1, `swing ${swing}`);
});

// A world with the Well and nothing else.
const QUIET = defineMission({ id: 'quiet-well', field: belt({ density: 0, landmarks: 0 }), fieldSeed: 1, seed: 1, well: WELL, start: { pos: [0, 0, 15000], forward: [0, 0, -1] } });
const place = (w, pos, vel = [0, 0, 0]) => { const s = w.player.ship; s.pos = [...pos]; s.vel = [...vel]; return s; };

test('the flight computer holds a ship against the pull, far out', () => {
  const w = createWorld({ seed: 1, mission: QUIET }); startRun(w);
  const s = place(w, [0, 0, 15000]);
  for (let i = 0; i < 30 / DT; i++) stepWorld(w, { ...IDLE, speedSet: 0 }, DT);
  assert.ok(Math.abs(r(s.pos) - 15000) < 60, `drifted to ${r(s.pos)}`);
});

test('above its point of no return a fighter climbs out; below it, it falls in', () => {
  // Nose straight out, full throttle.
  const out = { ...IDLE, throttleSet: 1 };
  const climb = start => {
    const w = createWorld({ seed: 1, mission: QUIET }); startRun(w);
    const s = place(w, [0, 0, start]);
    s.q = [0, 1, 0, 0];   // nose along +z, away from the hole
    for (let i = 0; i < 40 / DT && w.state === 'flying'; i++) stepWorld(w, out, DT);
    return { w, r: r(s.pos) };
  };
  const noReturn = well.radiusFor(PLAYER.accel.forward);
  const high = climb(noReturn * 1.25);
  assert.ok(high.r > noReturn * 1.25 && high.w.state === 'flying', `from above: ${high.r}`);
  const low = climb(noReturn * 0.85);
  assert.equal(low.w.state, 'dead', `from below: ${low.r}`);
});

test('what reaches the horizon is lost: no wreck, no fire', () => {
  const w = createWorld({ seed: 1, mission: QUIET }); startRun(w);
  place(w, [0, 0, 2000], [0, 0, -300]);
  const events = [];
  for (let i = 0; i < 10 / DT && w.state === 'flying'; i++) { stepWorld(w, IDLE, DT); events.push(...drainEvents(w)); }
  assert.equal(w.state, 'dead');
  assert.ok(events.some(e => e.type === 'lost' && e.id === w.player.id));
  assert.ok(!events.some(e => e.type === 'shipKilled' && e.id === w.player.id));
});

test('a pilot chasing its prey down the Well breaks off at twice its own point of no return', () => {
  const field = createField(1, belt({ density: 0, landmarks: 0 }));
  const prey = { id: 1, team: 0, stats: PLAYER, radius: PLAYER.radius, alive: true, ship: createShip(PLAYER, { pos: [0, 0, 2400] }) };
  const hunter = { id: 2, team: 1, stats: ENEMY, radius: ENEMY.radius, alive: true, ship: createShip(ENEMY, { pos: [0, 0, 9000], vel: [0, 0, -150] }) };
  hunter.brain = createBrain(3);
  const ctx = { field, player: prey, threat: { locked: false, missileInbound: false }, wasHit: false, well };
  const floor = well.radiusFor(ENEMY.accel.forward) * 2;
  const a = [0, 0, 0];
  let lowest = Infinity;
  for (let i = 0; i < 40 / DT; i++) {
    const c = thinkEnemy(hunter.brain, hunter, ctx, DT);
    well.accel(hunter.ship.pos, a);
    for (let k = 0; k < 3; k++) hunter.ship.vel[k] += a[k] * DT;
    stepShip(hunter.ship, c, DT);
    lowest = Math.min(lowest, r(hunter.ship.pos));
  }
  assert.ok(lowest > floor * 0.8, `went down to ${Math.round(lowest)} (floor ${Math.round(floor)})`);
  assert.ok(r(hunter.ship.pos) > well.radiusFor(ENEMY.accel.forward), 'and is still flying');
});
await run();
