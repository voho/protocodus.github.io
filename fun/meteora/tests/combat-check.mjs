// Run with: node tests/combat-check.mjs
import { test, run, assert, near } from './harness.mjs';
import { applyDamage, stepShield, waveSize, spawnPoints, loadBest, saveBest, scoreKill, scoreRock } from '../js/combat.js';
import { createWorld, startRun, resetWorld, stepWorld, advance, drainEvents } from '../js/world.js';
import { NEUTRAL_CONTROLS } from '../js/flight.js';
import { PLAYER, COMBAT, FIELD, MAX_STEPS, STEP as DT } from '../js/config.js';
import { makeRng } from '../js/rng.js';
import { dist, dot, normalize, sub } from '../js/vec.js';

const idle = { ...NEUTRAL_CONTROLS, fire: false, missile: false, cycleTarget: false };
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
  assert.equal(w.wave, 1); assert.equal(w.enemies.filter(e => e.alive).length, 3);
  for (const e of w.enemies) applyDamage(e, 1e6, w.events);
  for (let i = 0; i < Math.round(5.9 / DT); i++) stepWorld(w, idle, DT);
  assert.equal(w.wave, 1);
  for (let i = 0; i < Math.round(0.2 / DT); i++) stepWorld(w, idle, DT);
  assert.equal(w.wave, 2); assert.equal(w.enemies.filter(e => e.alive).length, 4);
  assert.ok(drainEvents(w).some(e => e.type === 'wave' && e.n === 2));
});
test('ramming a rock bounces and costs (v_n − 8) × 1.2', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  w.enemies.length = 0; w.waveTimer = 1e9;
  const b = w.field.belt; const i = [...b.type].findIndex(t => t === 3);
  const c = [b.pos[3 * i], b.pos[3 * i + 1], b.pos[3 * i + 2]], R = b.collide[i];
  const p = w.player; p.ship.pos = [c[0], c[1], c[2] + R + PLAYER.radius + 0.1]; p.ship.vel = [0, 0, -30]; p.ship.fa = false; p.ship.throttle = 0;
  for (let k = 0; k < 4; k++) stepWorld(w, idle, DT);
  near(PLAYER.shield - p.shield, (30 - COMBAT.collision.safe) * COMBAT.collision.perMs, 1.5);
  assert.ok(p.ship.vel[2] > 0); near(p.ship.vel[2], 30 * COMBAT.collision.restitution, 1.5);
});
test('reset after a fight restores the belt and clears everything', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  const fire = { ...idle, fire: true, throttleSet: 1 };
  for (let i = 0; i < 120 * 20; i++) stepWorld(w, fire, DT);
  const fresh = createWorld({ seed: 1234, storage: memory() }); startRun(fresh);
  resetWorld(w); startRun(w);
  assert.equal(w.weapons.bolts.length, 0); assert.equal(w.weapons.missiles.length, 0);
  assert.equal(w.field.dynamic.length, 0); assert.ok(w.field.alive.every(a => a === 1));
  assert.equal(w.score, 0); assert.equal(w.player.hull, PLAYER.hull); assert.equal(w.player.shield, PLAYER.shield);
  stepWorld(w, idle, DT); stepWorld(fresh, idle, DT);
  assert.deepEqual(w.enemies.map(e => e.ship.pos.map(v => +v.toFixed(6))), fresh.enemies.map(e => e.ship.pos.map(v => +v.toFixed(6))));
});
test('T targets the enemy nearest the crosshair, then cycles', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  stepWorld(w, idle, DT);
  const fwd = [0, 0, -1];
  const angle = e => Math.acos(dot(normalize([0, 0, 0], sub([0, 0, 0], e.ship.pos, w.player.ship.pos)), fwd));
  const order = [...w.enemies].sort((a, b) => angle(a) - angle(b));
  stepWorld(w, { ...idle, cycleTarget: true }, DT);
  assert.equal(w.target, order[0]);
  stepWorld(w, { ...idle, cycleTarget: true }, DT);
  assert.equal(w.target, order[1]);
});
test('when the target dies, targeting moves to the enemy nearest the crosshair', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  stepWorld(w, idle, DT);
  stepWorld(w, { ...idle, cycleTarget: true }, DT);
  const first = w.target;
  applyDamage(first, 1e6, w.events);
  stepWorld(w, idle, DT);
  assert.ok(w.target && w.target !== first && w.target.alive, 'a live enemy is targeted');
});
test('player death ends the run and stores the best score', () => {
  const store = memory(); const w = createWorld({ seed: 1234, storage: store }); startRun(w);
  w.score = 777; applyDamage(w.player, 1e6, w.events); stepWorld(w, idle, DT);
  assert.equal(w.state, 'dead'); assert.equal(loadBest(store), 777);
  assert.ok(drainEvents(w).some(e => e.type === 'shipKilled' && e.team === 0));
});
await run();
