// Run with: node tests/combat-check.mjs
import { test, run, assert, near } from './harness.mjs';
import { applyDamage, stepShield, waveSize, spawnPoints, loadBest, saveBest, scoreKill, scoreRock, resolveShipRock, resolveShipShip } from '../js/combat.js';
import { createField, rockMass } from '../js/field.js';
import { createShip } from '../js/flight.js';
import { createWorld, startRun, resetWorld, stepWorld, advance, drainEvents } from '../js/world.js';
import { NEUTRAL_CONTROLS, forward } from '../js/flight.js';
import { PLAYER, ENEMY, COMBAT, FIELD, MAX_STEPS, STEP as DT } from '../js/config.js';
import { makeRng } from '../js/rng.js';
import { dist, dot, len, normalize, sub } from '../js/vec.js';
import { SURVIVAL } from '../js/missions/survival.js';
import { defineMission } from '../js/mission.js';

const idle = { ...NEUTRAL_CONTROLS, fire: false, missile: false, cycleTarget: false };
// A mission with no script: the player alone in the belt.
const QUIET = defineMission({ id: 'quiet', field: FIELD, fieldSeed: 1234, seed: 1234 });
const enemies = w => w.entities.filter(e => e.team === 1);
/* A place on a rock where its skin faces straight out, near the direction
   `toward`: the direction, the skin's distance from the centre along it,
   and its normal. Rocks are lumpy; the checks below want a flat face. */
function faceOf(field, ref, centre, bound, toward = [0, 0, 1]) {
  const rng = makeRng(5);
  let best = null;
  for (let k = 0; k < 300 && !(best?.a > 0.995); k++) {
    const d = normalize([0, 0, 0], [0, 1, 2].map(i => toward[i] + (k ? rng.range(-0.45, 0.45) : 0)));
    let s = bound + 2;
    while (s > 0 && field.skin(ref, [0, 1, 2].map(i => centre[i] + d[i] * s)).distance > 0) s -= 0.01;
    const n = field.skin(ref, [0, 1, 2].map(i => centre[i] + d[i] * (s + 0.01))).normal, a = dot(n, d);
    if (!best || a > best.a) best = { a, d, s, n };
  }
  return best;
}
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('damage drains the shield before the hull', () => {
  const e = { shield: 100, hull: 100, maxShield: 100, maxHull: 100, sinceHit: 9, alive: true };
  applyDamage(e, 70, []); assert.equal(e.shield, 30); assert.equal(e.hull, 100); assert.equal(e.sinceHit, 0);
  const r = applyDamage(e, 50, []); assert.equal(e.shield, 0); assert.equal(e.hull, 80); assert.ok(r.hull > 0);
  assert.ok(applyDamage(e, 500, []).killed); assert.equal(e.alive, false);
});
test('the shield regenerates only after 3 s without damage', () => {
  const e = { shield: 0, hull: 100, maxShield: 100, maxHull: 100, sinceHit: 0, alive: true, stats: PLAYER };
  for (let i = 0; i < Math.round(2.9 / DT); i++) stepShield(e, DT);
  assert.equal(e.shield, 0);
  for (let i = 0; i < Math.round(1.1 / DT); i++) stepShield(e, DT);
  near(e.shield, PLAYER.shieldRegen * 1.0, 0.5);
});
test('wave sizes grow and cap at 10', () => {
  assert.deepEqual([1, 2, 3, 8, 20].map(waveSize), [3, 4, 5, 10, 10]);
});
test('spawn points are 2.5–3.5 km out and outside the view cone', () => {
  const pts = spawnPoints(makeRng(3), [100, 0, 0], [0, 0, -1], 10);
  for (const p of pts) {
    const d = dist(p, [100, 0, 0]); assert.ok(d >= 2500 && d <= 3500);
    const dir = normalize([0, 0, 0], sub([0, 0, 0], p, [100, 0, 0]));
    assert.ok(Math.acos(dot(dir, [0, 0, -1])) > COMBAT.wave.viewCone);
  }
});
test('score: kills scale with the wave, rocks by type', () => {
  assert.equal(scoreKill(3), 300); assert.deepEqual([0, 1, 2].map(scoreRock), [10, 25, 50]);
});
test('best score survives a throwing localStorage', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.equal(loadBest(broken), 0); assert.doesNotThrow(() => saveBest(broken, 500));
  assert.equal(loadBest(null), 0);
  const ok = memory(); saveBest(ok, 1200); assert.equal(loadBest(ok), 1200); saveBest(ok, 300); assert.equal(loadBest(ok), 1200);
});
test('a 60 s frame runs at most 8 steps and drops the backlog', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  const t0 = w.time;
  assert.equal(advance(w, idle, 60), MAX_STEPS);
  near(w.time - t0, MAX_STEPS * DT, 1e-9);
  assert.ok(w.accumulator < DT);
});
test('wave 1 arrives at start, wave 2 follows 6 s after the last kill', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  stepWorld(w, idle, DT);
  assert.equal(w.wave, 1); assert.equal(enemies(w).filter(e => e.alive).length, 3);
  for (const e of enemies(w)) applyDamage(e, 1e6, w.events);
  for (let i = 0; i < Math.round(5.9 / DT); i++) stepWorld(w, idle, DT);
  assert.equal(w.wave, 1);
  for (let i = 0; i < Math.round(0.2 / DT); i++) stepWorld(w, idle, DT);
  assert.equal(w.wave, 2); assert.equal(enemies(w).filter(e => e.alive).length, 4);
  assert.ok(drainEvents(w).some(e => e.type === 'wave' && e.n === 2));
});
test('ramming a rock bounces and costs (v_n − 8) × 1.2, from the front shield quadrant', () => {
  const w = createWorld({ seed: 1234, storage: memory(), mission: QUIET }); startRun(w);
  const b = w.field.belt; const i = [...b.type].findIndex(t => t === 3);
  const c = [b.pos[3 * i], b.pos[3 * i + 1], b.pos[3 * i + 2]];
  const { d, s } = faceOf(w.field, { kind: 'static', index: i }, c, b.collide[i]);
  const p = w.player;
  p.ship.pos = c.map((v, k) => v + d[k] * (s + PLAYER.radius + 0.1)); p.ship.vel = d.map(v => -30 * v); p.ship.fa = false; p.ship.throttle = 0;
  for (let k = 0; k < 4; k++) stepWorld(w, idle, DT);
  near(p.maxShield - p.shield, (30 - COMBAT.collision.safe) * COMBAT.collision.perMs, 1.5);
  near(p.quad[0], p.maxShield / 4 - (30 - COMBAT.collision.safe) * COMBAT.collision.perMs, 1.5, 'front quadrant');
  near(dot(p.ship.vel, d), 30 * COMBAT.collision.restitution, 1.5, 'bounced back');
});
const EMPTY = { ...FIELD, types: FIELD.types.map(t => ({ ...t, count: 0 })), landmarks: { ...FIELD.landmarks, count: 0 } };
const body = (stats, team, o = {}) => ({
  id: team + 10, team, stats, radius: stats.radius, alive: true, sinceHit: 99,
  shield: stats.shield, hull: stats.hull, maxShield: stats.shield, maxHull: stats.hull,
  ship: Object.assign(createShip(stats, o), { fa: false }),
});
const momentum = (...pairs) => [0, 1, 2].map(k => pairs.reduce((s, [m, v]) => s + m * v[k], 0));

test('a glancing scrape along a rock spins the ship, and friction is Coulomb-limited', () => {
  const w = createWorld({ seed: 1234, storage: memory() });
  const b = w.field.belt; const i = [...b.type].findIndex(t => t === 3);
  const c = [b.pos[3 * i], b.pos[3 * i + 1], b.pos[3 * i + 2]];
  const { d, s } = faceOf(w.field, { kind: 'static', index: i }, c, b.collide[i]);
  const pos = c.map((v, k) => v + d[k] * (s + PLAYER.radius - 0.05));
  // Along the skin at 40 m/s, into it at 5, by the normal the contact uses.
  const n = w.field.contacts(pos, PLAYER.radius).find(h => h.index === i).normal;
  const t = normalize([0, 0, 0], sub([0, 0, 0], [1, 0, 0], n.map(v => v * n[0])));
  const e = body(PLAYER, 0, { pos, vel: [0, 1, 2].map(k => 40 * t[k] - 5 * n[k]) });
  resolveShipRock(e, w.field, []);
  assert.ok(Math.hypot(...e.ship.w) > 0.05, `spin ${e.ship.w}`);
  const jn = (1 + COMBAT.collision.restitution) * 5;          // normal Δv the bounce gives
  const slide = dot(e.ship.vel, t);
  assert.ok(slide < 40 && 40 - slide <= COMBAT.collision.mu * jn + 1e-6, `slide ${slide}`);
  near(dot(e.ship.vel, n), 5 * COMBAT.collision.restitution, 1e-9);
});
test('ramming a drifting fragment shoves it, and momentum is conserved', () => {
  const field = createField(1, EMPTY);
  const rock = field.addDynamicRock(0, [0, 0, -20], [0, 0, 0]);
  const { d, s } = faceOf(field, { kind: 'dynamic', rock }, rock.pos, rock.collide);
  const e = body(PLAYER, 0, { pos: rock.pos.map((v, k) => v + d[k] * (s + PLAYER.radius - 0.05)), vel: d.map(v => -20 * v) });
  const M = rockMass(rock.radius), m = PLAYER.mass;
  const before = momentum([m, e.ship.vel], [M, rock.vel]);
  resolveShipRock(e, field, []);
  const after = momentum([m, e.ship.vel], [M, rock.vel]);
  for (let k = 0; k < 3; k++) near(after[k], before[k], Math.abs(before[2]) * 1e-9 + 1e-6);
  assert.ok(dot(rock.vel, d) < -1, `fragment pushed: ${rock.vel}`);
});
test('the heavier fighter shoves the lighter interceptor harder, momentum conserved', () => {
  const a = body(PLAYER, 0, { pos: [0, 0, 0], vel: [0, 0, -30] });
  const b2 = body(ENEMY, 1, { pos: [0, 0, -(PLAYER.radius + ENEMY.radius - 0.1)], vel: [0, 0, 30] });
  const before = momentum([PLAYER.mass, a.ship.vel], [ENEMY.mass, b2.ship.vel]);
  resolveShipShip(a, b2, []);
  const after = momentum([PLAYER.mass, a.ship.vel], [ENEMY.mass, b2.ship.vel]);
  near(after[2], before[2], 1e-3);
  assert.ok(Math.abs(b2.ship.vel[2] - 30) > Math.abs(a.ship.vel[2] + 30), 'the lighter ship changes more');
});
test('reset after a fight restores the belt and clears everything', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  const fire = { ...idle, fire: true, throttleSet: 1 };
  for (let i = 0; i < 120 * 20; i++) stepWorld(w, fire, DT);
  const fresh = createWorld({ seed: 1234, storage: memory() }); startRun(fresh);
  resetWorld(w); startRun(w);
  assert.equal(w.weapons.bolts.length, 0); assert.equal(w.weapons.missiles.length, 0);
  assert.equal(w.field.dynamic.length, 0); assert.ok(w.field.alive.every(a => a === 1));
  assert.equal(w.score, 0); assert.equal(w.player.hull, w.player.maxHull); assert.equal(w.player.shield, w.player.maxShield);
  stepWorld(w, idle, DT); stepWorld(fresh, idle, DT);
  assert.deepEqual(enemies(w).map(e => e.ship.pos.map(v => +v.toFixed(6))), enemies(fresh).map(e => e.ship.pos.map(v => +v.toFixed(6))));
});
test('T targets the enemy nearest the crosshair, then cycles', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  stepWorld(w, idle, DT);
  const fwd = [0, 0, -1];
  const angle = e => Math.acos(dot(normalize([0, 0, 0], sub([0, 0, 0], e.ship.pos, w.player.ship.pos)), fwd));
  const order = enemies(w).sort((a, b) => angle(a) - angle(b));
  stepWorld(w, { ...idle, cycleTarget: true }, DT);
  assert.equal(w.target, order[0]);
  stepWorld(w, { ...idle, cycleTarget: true }, DT);
  assert.equal(w.target, order[1]);
});
const nearestHostile = w => enemies(w).filter(e => e.alive && !e.folding && !e.hidden)
  .sort((a, b) => dist(a.ship.pos, w.player.ship.pos) - dist(b.ship.pos, w.player.ship.pos))[0];
test('with nothing targeted, the nearest hostile is taken', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  for (let i = 0; i < 5 && !enemies(w).some(e => e.alive && !e.folding); i++) stepWorld(w, idle, DT);
  stepWorld(w, idle, DT);
  assert.ok(w.target, 'something is targeted without a key pressed');
  assert.equal(w.target, nearestHostile(w));
});
test('when the target dies, targeting moves to the nearest live enemy', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  stepWorld(w, idle, DT);
  stepWorld(w, { ...idle, cycleTarget: true }, DT);
  const first = w.target;
  applyDamage(first, 1e6, w.events);
  stepWorld(w, idle, DT);
  stepWorld(w, idle, DT);
  assert.ok(w.target && w.target !== first && w.target.alive, 'a live enemy is targeted');
  assert.equal(w.target, nearestHostile(w));
});
test('with an aim point the fighter turns toward it and its guns converge on it', () => {
  const w = createWorld({ seed: 1234, storage: memory(), mission: QUIET }); startRun(w);
  const near2 = [50, 0, -1000];
  stepWorld(w, { ...idle, aimPoint: near2, fire: true }, DT);
  const b = w.weapons.bolts.at(-1);
  const flight = normalize([0, 0, 0], sub([0, 0, 0], b.vel, w.player.ship.vel));
  const wanted = normalize([0, 0, 0], sub([0, 0, 0], near2, b.pos));
  assert.ok(dot(flight, wanted) > 1 - 1e-6, 'bolt flies at the aim point');
  const far = [600, 0, -1000];
  for (let i = 0; i < 120; i++) stepWorld(w, { ...idle, aimPoint: far }, DT);
  assert.ok(forward([0, 0, 0], w.player.ship)[0] > 0.2, 'nose swung toward the aim');
});
test('Z locks the speed to the target\'s; W or S hands the throttle back', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  stepWorld(w, idle, DT);
  stepWorld(w, { ...idle, cycleTarget: true }, DT);
  stepWorld(w, { ...idle, toggleSpeedLock: true }, DT);
  assert.equal(w.speedLock, true);
  for (let i = 0; i < 60; i++) {
    // The player steps before the enemies, so it matches the speed the
    // target had at the start of the step.
    const speed = len(w.target.ship.vel);
    stepWorld(w, idle, DT);
    near(w.player.ship.cruise, Math.min(speed, w.player.ship.stats.fa.boostSpeed), 1e-9);
  }
  stepWorld(w, { ...idle, throttleDelta: 1 }, DT);
  assert.equal(w.speedLock, false);
  stepWorld(w, { ...idle, toggleSpeedLock: true }, DT);
  stepWorld(w, { ...idle, toggleSpeedLock: true }, DT);
  assert.equal(w.speedLock, false, 'Z again lets go');
});
test('with nothing targeted the speed lock does not engage', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  stepWorld(w, { ...idle, toggleSpeedLock: true }, DT);
  assert.equal(w.speedLock, false);
});
test('player death ends the run and stores the best score', () => {
  const store = memory(); const w = createWorld({ seed: 1234, storage: store }); startRun(w);
  w.score = 777; applyDamage(w.player, 1e6, w.events); stepWorld(w, idle, DT);
  assert.equal(w.state, 'dead'); assert.equal(loadBest(store), 777);
  assert.ok(drainEvents(w).some(e => e.type === 'shipKilled' && e.team === 0));
});
await run();
