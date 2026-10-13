// Run with: node tests/systems-check.mjs
// The campaign's systems: loadouts, quadrant shields, armour and piercing,
// subsystems, large ships' collision spheres, turrets, torpedoes, the
// Tender, detection, scanning, fold travel and the mission runtime.
import { test, run, assert, near } from './harness.mjs';
import { FIELD, STEP as DT } from '../js/config.js';
import { CLASSES, HULLS } from '../js/catalog.js';
import { PRIMARIES, SECONDARIES, REACTORS, assess, bankCount, buildStats, normalizeLoadout } from '../js/loadout.js';
import { applyDamage, equalizeShields, initShields, quadrantOf, stepShield } from '../js/combat.js';
import { overlapCompound, sweepCompound } from '../js/compound.js';
import { createWorld, startRun, stepWorld, drainEvents, spawn, callRepair, foldOut, IDLE } from '../js/world.js';
import { defineMission, results } from '../js/mission.js';
import { updateLock, createLock, launchMissile } from '../js/weapons.js';
import { signature } from '../js/detection.js';
import { DIFFICULTIES } from '../js/difficulty.js';
import { createShip } from '../js/flight.js';
import { len, qLookRotation } from '../js/vec.js';

const EMPTY = { ...FIELD, types: FIELD.types.map(t => ({ ...t, count: 0 })), landmarks: { ...FIELD.landmarks, count: 0 } };
const quiet = (script = null, setup = null, extra = {}) => defineMission({ id: 'test', field: EMPTY, fieldSeed: 1, seed: 1, setup, script, ...extra });
const world = (mission = quiet(), o = {}) => { const w = createWorld({ seed: 1, mission, ...o }); startRun(w); return w; };
const steps = (w, seconds, input = IDLE) => { for (let i = 0; i < Math.round(seconds / DT); i++) stepWorld(w, input, DT); };

/* ---------- loadouts ---------- */

test('every hull builds stats with every reactor, and banks hold what they should', () => {
  for (const hull of HULLS) for (const reactor of Object.keys(REACTORS)) {
    const s = buildStats({ hull, primary: 'pulse', secondaries: ['hornet', 'hornet'], reactor });
    assert.ok(s.shield > 0 && s.hull > 0 && s.flight.fa.forwardSpeed > 0, `${hull}/${reactor}`);
    assert.equal(s.banks.length, CLASSES[hull].banks.length);
  }
  assert.equal(bankCount({ capacity: 8, heavy: false }, 'lance'), 0, 'no Lance in a light bank');
  assert.equal(bankCount({ capacity: 16, heavy: true }, 'lance'), 4);
  assert.equal(bankCount({ capacity: 8, heavy: false }, 'swarm'), 4);
});
test('the interceptor is fastest and frailest, the bomber slowest and toughest', () => {
  const s = Object.fromEntries(HULLS.map(h => [h, buildStats({ hull: h, reactor: 'hearth' })]));
  assert.ok(s.swift.flight.fa.forwardSpeed > s.kestrel.flight.fa.forwardSpeed && s.kestrel.flight.fa.forwardSpeed > s.anvil.flight.fa.forwardSpeed);
  assert.ok(s.swift.hull < s.kestrel.hull && s.kestrel.hull < s.anvil.hull);
  assert.ok(s.swift.signature < s.kestrel.signature && s.kestrel.signature < s.anvil.signature);
});
test('reactors trade as advertised', () => {
  const base = buildStats({ hull: 'kestrel', reactor: 'hearth' });
  const aegis = buildStats({ hull: 'kestrel', reactor: 'aegis' }), forge = buildStats({ hull: 'kestrel', reactor: 'forge' }), hush = buildStats({ hull: 'kestrel', reactor: 'hush' });
  assert.ok(aegis.shield > base.shield && aegis.shieldRegen > base.shieldRegen);
  assert.ok(forge.gun.cool > base.gun.cool && forge.flight.boost.capacity > base.flight.boost.capacity);
  assert.ok(hush.signature < base.signature * 0.5);
});
test('a loadout with locked or illegal parts falls back to legal ones', () => {
  const unlocked = { hulls: ['kestrel'], primaries: ['pulse'], secondaries: ['hornet'], reactors: ['hearth'] };
  const L = normalizeLoadout({ hull: 'anvil', primary: 'breaker', secondaries: ['lance', 'lance'], reactor: 'hush' }, unlocked);
  assert.deepEqual(L, { hull: 'kestrel', primary: 'pulse', secondaries: ['hornet', 'hornet'], reactor: 'hearth' });
  const swift = normalizeLoadout({ hull: 'swift', secondaries: ['lance'] });
  assert.equal(swift.secondaries[0], 'hornet', 'a Swift cannot carry a Lance');
});
test('the hangar warns when a loadout misses what the mission needs', () => {
  const warn = assess({ armor: true, stealth: true }, { hull: 'anvil', primary: 'pulse', secondaries: ['hornet', 'hornet'], reactor: 'forge' });
  assert.ok(warn.some(w => /Breakers/.test(w.text)) && warn.some(w => /Signature/.test(w.text)));
  assert.equal(assess({ armor: true }, { hull: 'anvil', primary: 'breaker', secondaries: ['hornet', 'lance'], reactor: 'aegis' }).length, 0);
});

/* ---------- shields, armour, subsystems ---------- */

const dummy = (o = {}) => {
  const e = { id: 9, team: 1, alive: true, sinceHit: 99, hull: 100, maxHull: 100, armor: 0, shieldRegen: 20, shieldDelay: 3, subsystems: [], generators: 0, ship: createShip(CLASSES.thorn.flight), ...o };
  initShields(e, o.shieldTotal ?? 80);
  return e;
};
test('a hit drains the quadrant facing it, then the hull', () => {
  const e = dummy();
  assert.equal(quadrantOf(e, [0, 0, -10]), 0); assert.equal(quadrantOf(e, [0, 0, 10]), 1);
  assert.equal(quadrantOf(e, [-10, 0, 0]), 2); assert.equal(quadrantOf(e, [10, 0, 0]), 3);
  applyDamage(e, 15, [], [0, 0, -10]);
  near(e.quad[0], 5, 1e-9); near(e.quad[1], 20, 1e-9); assert.equal(e.hull, 100);
  applyDamage(e, 15, [], [0, 0, -10]);
  near(e.quad[0], 0, 1e-9); near(e.hull, 90, 1e-9);
  equalizeShields(e);
  near(e.quad[0], 15, 1e-9); near(e.quad[3], 15, 1e-9);
});
test('quadrants recharge evenly after the delay and level out', () => {
  const e = dummy(); e.quad = [0, 20, 20, 20]; e.shield = 60; e.sinceHit = 0;
  for (let i = 0; i < Math.round(2.9 / DT); i++) stepShield(e, DT);
  near(e.shield, 60, 1e-6, 'nothing recharged before the delay');
  assert.ok(e.quad[0] > 0 && e.quad[0] < 6, 'but the quadrants level out');
  for (let i = 0; i < Math.round(6 / DT); i++) stepShield(e, DT);
  near(e.shield, 80, 0.5);
});
test('armour stops non-piercing fire; Breakers and Lances go through', () => {
  const pulse = dummy({ armor: 0.9 }), breaker = dummy({ armor: 0.9 }), lance = dummy({ armor: 0.9, hull: 2000, maxHull: 2000 });
  for (const e of [pulse, breaker, lance]) { e.quad.fill(0); e.shield = 0; }
  applyDamage(pulse, 30, [], [0, 0, -5], null, { weapon: PRIMARIES.pulse });
  applyDamage(breaker, 30, [], [0, 0, -5], null, { weapon: PRIMARIES.breaker });
  applyDamage(lance, 900, [], [0, 0, -5], null, { weapon: SECONDARIES.lance });
  const p = 100 - pulse.hull, b = 100 - breaker.hull;
  assert.ok(b > 4 * p, `breaker ${b} vs pulse ${p}`);
  near(2000 - lance.hull, 900, 1e-6);
});
test('a subsystem takes the hit at its own armour and the hull takes half; exposed ones ignore the shield', () => {
  const sub = { name: 'sub_reactor', kind: 'reactor', hull: 50, maxHull: 50, armor: 0, alive: true, exposed: false };
  const gen = { name: 'sub_shield_0', kind: 'shield', hull: 40, maxHull: 40, armor: 0, alive: true, exposed: true };
  const e = dummy({ subsystems: [sub, gen], generators: 1 });
  const ev = [];
  applyDamage(e, 20, ev, [0, 0, -5], null, { sub: gen });
  near(gen.hull, 20, 1e-9, 'generator hit through the shield'); near(e.hull, 90, 1e-9); near(e.shield, 80, 1e-9);
  applyDamage(e, 30, ev, [0, 0, -5], null, { sub: gen });
  assert.equal(gen.alive, false);
  assert.ok(ev.some(x => x.type === 'shieldsCollapse'));
  assert.equal(e.shield, 0, 'every generator gone: shields fall');
  e.sinceHit = 99; stepShield(e, 5); assert.equal(e.shield, 0, 'and never come back');
  applyDamage(e, 20, ev, [0, 0, -5], null, { sub });
  near(sub.hull, 30, 1e-9);
});

/* ---------- large ships ---------- */

test('bolts and fighters meet a large ship\'s spheres, not its bounding sphere', () => {
  const w = world();
  const m = spawn(w, 'mule', { team: 0, pos: [0, 0, -400] });
  const hit = sweepCompound(m, [0, 0, 0], [0, 0, -800]);
  assert.ok(hit && hit.t > 0 && hit.t < 0.5, 'hit along the axis');
  const side = m.radius * 0.95;
  assert.equal(sweepCompound(m, [side, 60, 0], [side, 60, -800]), null, 'missed beside it');
  // A fighter driven into the hull is pushed out and bounces.
  const p = w.player; p.ship.pos = [0, 0, -400 + m.radius + 20]; p.ship.vel = [0, 0, -60]; p.ship.fa = false;
  steps(w, 2);
  assert.equal(overlapCompound(m, p.ship.pos, p.radius).length, 0, 'never inside');
  assert.ok(p.ship.vel[2] > -30, `bounced: ${p.ship.vel[2]}`);
});
test('ramming a hull costs the player, and the debrief counts it', () => {
  const w = world();
  const m = spawn(w, 'mule', { team: 0, pos: [0, 0, -400] });
  const p = w.player; p.ship.pos = [0, 0, -400 + m.radius + 30]; p.ship.vel = [0, 0, -160]; p.ship.fa = false;
  const hp = p.hull + p.shield;
  steps(w, 1.5);
  assert.ok(p.hull + p.shield < hp, 'the impact hurt');
  near(w.stats.damageTaken, hp - (p.hull + p.shield), 1e-6, 'all of it counted');
  // One impact never takes more than a fifth or so of a ship's total.
  assert.ok(hp - (p.hull + p.shield) <= (p.maxHull + p.maxShield / 4) * 0.25, `one hit cost ${(hp - p.hull - p.shield).toFixed(1)}`);
});
test('a gunship\'s turrets engage a hostile fighter in range', () => {
  const w = world();
  const h = spawn(w, 'halberd', { team: 0, pos: [0, 0, -3000] });
  const t = spawn(w, 'thorn', { team: 1, pos: [0, 300, -2600], disabled: true });
  steps(w, 6);
  assert.ok(t.hull < t.maxHull || !t.alive, `thorn hull ${t.hull}`);
  assert.ok(h.turrets.length >= 2);
});
test('a Lance locks only on large targets and subsystems, and splits a subsystem', () => {
  const lock = createLock();
  const p = { ship: createShip(CLASSES.anvil.flight) };
  const small = { id: 2, alive: true, big: false, radius: 5, ship: createShip(CLASSES.thorn.flight, { pos: [0, 0, -800] }) };
  for (let i = 0; i < 400; i++) updateLock(lock, p.ship, small, DT, SECONDARIES.lance);
  assert.equal(lock.locked, false); assert.equal(lock.valid, false);
  const w = world(quiet(), { loadout: { hull: 'anvil', primary: 'pulse', secondaries: ['hornet', 'lance'], reactor: 'hearth' } });
  const mother = spawn(w, 'mother', { team: 1, pos: [0, 0, -2600] });
  mother.quad.fill(0); mother.shield = 0;
  // Its point defence would shoot the torpedo down: this is about the warhead.
  for (const t of mother.turrets) t.alive = false;
  const reactor = mother.subsystems.find(s => s.kind === 'reactor');
  // From above, where the reactor sits under the plating (from astern a
  // torpedo meets the engines first).
  const above = [0, 1600, -2600 + reactor.pos[2]];
  w.player.ship.pos = above; w.player.ship.prevPos = [...above];
  qLookRotation(w.player.ship.q, [0, -1, 0], [0, 0, -1]);
  w.target = mother; w.targetSub = reactor; w.player.bank = 1;
  steps(w, 2.2);
  assert.equal(w.lock.locked, true, 'locked on the reactor');
  stepWorld(w, { ...IDLE, missile: true }, DT);
  const before = reactor.hull;
  steps(w, 16);
  assert.ok(reactor.hull < before, `reactor ${before} -> ${reactor.hull}`);
});
test('torpedoes can be shot down', () => {
  const w = world();
  const maul = spawn(w, 'maul', { team: 1, pos: [0, 0, -1500], disabled: true });
  const m = spawn(w, 'mule', { team: 0, pos: [0, 0, 1500], fixed: true });
  w.weapons.missiles.length = 0;
  const t = launchMissile(w.weapons, maul, [0, 0, -6], m.id, SECONDARIES.spike);
  const hp0 = t.hp;
  // A Thorn-killer gun lined up on its path.
  for (let i = 0; i < 400 && w.weapons.missiles.includes(t); i++) {
    if (i % 10 === 0) {
      const b = { id: 999 + i, team: 0, ownerId: w.player.id, pos: [...t.pos].map((v, k) => v + (k === 2 ? -50 : 0)), prev: null, vel: [0, 0, 1200], life: 1, damage: 9, radius: 0.3, w: PRIMARIES.pulse, travelled: 0, fuse: Infinity };
      b.prev = [...b.pos];
      w.weapons.bolts.push(b);
    }
    stepWorld(w, IDLE, DT);
  }
  assert.ok(!w.weapons.missiles.includes(t), 'gone');
  assert.ok(hp0 > 0);
});

/* ---------- the Tender ---------- */

test('R is refused when healthy, then a Tender docks, repairs to 85 % and leaves', () => {
  const w = world(quiet(), { difficulty: 'pilot' });
  const p = w.player;
  assert.equal(callRepair(w), false);
  assert.ok(drainEvents(w).some(e => e.type === 'repairDenied' && e.reason === 'healthy'));
  p.hull = p.maxHull * 0.2; p.banks[0].count = 0;
  assert.equal(callRepair(w), true);
  assert.equal(w.repair.charges, DIFFICULTIES.pilot.repairDrones - 1);
  let docked = false, done = false;
  for (let i = 0; i < 120 * 40 && !done; i++) {
    stepWorld(w, { ...IDLE, throttleSet: 0 }, DT);
    for (const e of drainEvents(w)) { if (e.type === 'tenderDocked') docked = true; if (e.type === 'tenderDone') done = true; }
  }
  assert.ok(docked && done, `docked ${docked} done ${done}`);
  assert.ok(p.hull >= p.maxHull * 0.85 - 1e-6, `hull ${p.hull}`);
  assert.equal(p.banks[0].count, p.banks[0].max, 'restocked');
});

/* ---------- detection and scanning ---------- */

test('an Eye notices a loud ship in range and a quiet one only up close; rocks hide you', () => {
  const w = world(quiet(), { loadout: { hull: 'anvil', primary: 'pulse', secondaries: ['hornet', 'hornet'], reactor: 'forge' } });
  const eye = spawn(w, 'eye', { team: 1, pos: [0, 0, -900], disabled: true });
  w.player.ship.vel = [0, 0, -130];
  assert.ok(signature(w, w.player) * 700 > 900, 'a loud bomber is heard 900 m out');
  let detected = false;
  for (let i = 0; i < 240 && !detected; i++) { stepWorld(w, IDLE, DT); detected = drainEvents(w).some(e => e.type === 'detected'); }
  assert.ok(detected);
  const w2 = world(quiet(), { loadout: { hull: 'swift', primary: 'needle', secondaries: ['hornet'], reactor: 'hush' } });
  spawn(w2, 'eye', { team: 1, pos: [0, 0, -500], disabled: true });
  w2.player.ship.vel = [0, 0, -40]; w2.player.ship.throttle = 0.2;
  let seen = false;
  for (let i = 0; i < 360; i++) { stepWorld(w2, { ...IDLE, throttleSet: 0.17 }, DT); seen ||= drainEvents(w2).some(e => e.type === 'detected'); }
  assert.equal(seen, false, 'a cold Swift on Hush slips past at 500 m');
});
test('scanning needs the target selected, in range and ahead', () => {
  const w = world();
  const wreck = spawn(w, 'wreck', { team: 0, pos: [0, 0, -600], scan: { time: 2, range: 500 } });
  w.target = wreck;
  steps(w, 3);
  assert.equal(wreck.scan.done, false, 'out of range');
  w.player.ship.pos = [0, 0, -200];
  steps(w, 2.2);
  assert.equal(wreck.scan.done, true);
});

/* ---------- fold travel ---------- */

test('a fold arrival is untouchable until it completes; a departure is not a death', () => {
  const w = world();
  const t = spawn(w, 'thorn', { team: 1, pos: [0, 0, -800], fold: true });
  stepWorld(w, IDLE, DT);
  assert.ok(!w.active.includes(t), 'still in the fold');
  applyDamage(t, 1e6, w.events); assert.equal(t.alive, true, 'cannot be hit while folding');
  steps(w, 1.5);
  assert.ok(w.active.includes(t));
  foldOut(w, t);
  steps(w, 2);
  assert.equal(t.departed, true); assert.equal(t.alive, false);
  assert.ok(!drainEvents(w).some(e => e.type === 'shipKilled' && e.id === t.id));
});

/* ---------- the mission runtime ---------- */

test('scripts wait, run threads, track objectives and win', () => {
  const log = [];
  const def = quiet(function* (m) {
    m.objective('a', 'Wait a second');
    m.objective('b', 'Bonus', { bonus: true });
    m.thread((function* () { yield m.wait(0.5); log.push('thread'); })());
    yield m.wait(1);
    log.push('main');
    m.complete('a'); m.complete('b');
    yield m.say('doukas', 'Well done.');
    m.win('done');
  });
  const w = world(def);
  steps(w, 0.8);
  assert.deepEqual(log, ['thread']);
  steps(w, 6);
  assert.equal(w.mission.outcome, 'won');
  const r = results(w);
  assert.equal(r.medal, 'gold'); assert.ok(r.objectives.every(o => o.state === 'done'));
});
test('a failed critical objective or the player\'s death loses the mission', () => {
  const w = world(quiet(function* (m) { m.objective('x', 'Keep it alive'); yield m.wait(0.2); m.fail('x', 'It died.'); }));
  steps(w, 0.5);
  assert.equal(w.mission.outcome, 'lost'); assert.equal(w.mission.reason, 'It died.');
  const w2 = world(quiet(function* (m) { yield m.wait(100); }));
  applyDamage(w2.player, 1e9, w2.events);
  steps(w2, 0.2);
  assert.equal(w2.mission.outcome, 'lost');
});
test('timers count down and can be paused', () => {
  let t;
  const w = world(quiet(function* (m) { t = m.timer('jump', 'Jump', 2); yield m.wait(1); m.pauseTimer('jump'); yield m.wait(1); m.pauseTimer('jump', false); }));
  steps(w, 2.5);
  near(t.left, 0.5, 0.06);
});

await run();
