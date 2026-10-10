// Run with: node tests/weapons-check.mjs
import { test, run, assert, near, finite } from './harness.mjs';
import { createWeapons, createGun, triggerGun, fireBolt, createLock, updateLock, launchMissile,
  stepWeapons, leadPoint, blastDamage } from '../js/weapons.js';
import { createShip } from '../js/flight.js';
import { createField } from '../js/field.js';
import { CANNON, MISSILE, PLAYER, ENEMY, FIELD, STEP as DT } from '../js/config.js';
import { qLookRotation, dist, len, sub, normalize } from '../js/vec.js';

const EMPTY = { ...FIELD, types: FIELD.types.map(t => ({ ...t, count: 0 })), landmarks: { ...FIELD.landmarks, count: 0 } };
function ctxWith(entities = []) {
  const events = [], damage = [];
  return { field: createField(1, EMPTY), entities, events, damageLog: damage,
    damage(entity, amount, point, dir) { damage.push({ id: entity.id, amount }); } };
}
const player = (o = {}) => ({ id: 1, team: 0, alive: true, radius: PLAYER.radius, ship: createShip(PLAYER, o) });
const target = (pos, vel = [0, 0, 0]) => ({ id: 2, team: 1, alive: true, radius: ENEMY.radius, ship: createShip(ENEMY, { pos, vel }) });

test('bolts inherit the shooter velocity', () => {
  const w = createWeapons(); const p = player({ vel: [30, 0, -100] });
  const bolt = fireBolt(w, p, [0, 0, -7], CANNON);
  near(bolt.vel[0], 30, 1e-9); near(bolt.vel[2], -1100, 1e-9);
});
test('gimballed cannons follow the aim inside the cone and stop at its edge', () => {
  const w = createWeapons(); const p = player();
  const inside = normalize([0, 0, 0], [Math.tan(5 * Math.PI / 180), 0, -1]);
  let b = fireBolt(w, p, [0, 0, 0], CANNON, inside);
  near(b.vel[0] / len(b.vel), inside[0], 1e-9);
  b = fireBolt(w, p, [0, 0, 0], CANNON, normalize([0, 0, 0], [1, 0, -1]));
  near(Math.acos(-b.vel[2] / len(b.vel)), CANNON.gimbal, 1e-9, 'clamped to the gimbal');
  assert.ok(b.vel[0] > 0, 'toward the aim side');
  b = fireBolt(w, p, [0, 0, 0], CANNON, [0, 0, 1]);
  near(Math.acos(-b.vel[2] / len(b.vel)), CANNON.gimbal, 1e-9, 'straight behind still clamps');
});
test('a 1000 m/s bolt does not tunnel through a 1.5 m rock', () => {
  const w = createWeapons(); const ctx = ctxWith([]);
  const rock = ctx.field.addDynamicRock(0, [0, 0, -500], [0, 0, 0]);
  const hp0 = rock.hp;
  fireBolt(w, player(), [0, 0, 0], CANNON);
  for (let i = 0; i < 120; i++) stepWeapons(w, ctx, DT);
  assert.ok(ctx.events.some(e => e.type === 'boltHit' && e.kind === 'rock'));
  assert.equal(w.bolts.length, 0);
  assert.ok(rock.hp < hp0 || !ctx.field.dynamic.includes(rock));
});
test('gun heat locks at 100 and releases at 40', () => {
  const g = createGun(CANNON); let t = 0, shots = 0, sawLock = false, firedWhileLocked = false;
  while (t < 8) { const n = triggerGun(g, true, DT); if (g.overheated) { sawLock = true; if (n) firedWhileLocked = true; } shots += n; t += DT; }
  assert.ok(sawLock && !firedWhileLocked);
  for (let i = 0; i < 120 * 10 && !g.overheated; i++) shots += triggerGun(g, true, DT) * 0;
  assert.equal(g.overheated, true, 'a held trigger overheats again');
  for (let i = 0; i < 120 * 3 && g.overheated; i++) triggerGun(g, false, DT);
  assert.equal(g.overheated, false); assert.ok(g.heat <= CANNON.releaseAt + 1e-9);
  near(shots / 8, CANNON.rate * 0.5, CANNON.rate * 0.45, 'fires a lot but not while locked');
});
test('guns alternate muzzles at the configured rate', () => {
  const g = createGun(CANNON); let shots = 0; const muzzles = [];
  for (let i = 0; i < 120; i++) if (triggerGun(g, true, DT)) { shots++; muzzles.push(g.muzzle); }
  near(shots, CANNON.rate, 1);
  assert.notEqual(muzzles[0], muzzles[1]);
});
test('lock needs 0.8 s inside 15° and 3 km, and resets when lost', () => {
  const p = player(); const lock = createLock();
  const ahead = target([0, 0, -1000]);
  for (let i = 0; i < Math.round(0.7 / DT); i++) updateLock(lock, p.ship, ahead, DT);
  assert.equal(lock.locked, false);
  for (let i = 0; i < Math.round(0.15 / DT); i++) updateLock(lock, p.ship, ahead, DT);
  assert.equal(lock.locked, true);
  const off = target([Math.tan(20 * Math.PI / 180) * 1000, 0, -1000]);
  updateLock(lock, p.ship, off, DT); assert.equal(lock.locked, false); assert.equal(lock.progress, 0);
  const far = target([0, 0, -3500]); const l2 = createLock();
  for (let i = 0; i < 240; i++) updateLock(l2, p.ship, far, DT);
  assert.equal(l2.locked, false);
});
for (const [name, start, vel] of [
  ['head-on 2 km', [0, 0, -2000], [0, 0, 150]],
  ['crossing 1.5 km', [-600, 0, -1500], [200, 0, 0]],
  ['tail chase 1.2 km', [0, 0, -1200], [0, 0, -200]],
]) {
  test(`PN missile hits a 3 g turning target: ${name}`, () => {
    const p = player(); const t = target(start, vel); const ctx = ctxWith([p, t]); const w = createWeapons();
    launchMissile(w, p, [0, -1, -3], t.id);
    const g = 3 * 9.81, speed = len(vel); let hit = false;
    for (let i = 0; i < Math.round(MISSILE.life / DT) && !hit; i++) {
      // Turn the target: centripetal accel g, perpendicular to its velocity in the XY-plane-ish.
      const v = t.ship.vel, perp = normalize([0, 0, 0], [-v[2], 0.3 * speed, v[0]]);
      for (let k = 0; k < 3; k++) { v[k] += perp[k] * g * DT; }
      const s = speed / len(v); for (let k = 0; k < 3; k++) { v[k] *= s; t.ship.pos[k] += v[k] * DT; }
      stepWeapons(w, ctx, DT);
      hit = ctx.events.some(e => e.type === 'missileExplode' && e.targetId === t.id);
    }
    assert.ok(hit, 'missile hit');
    assert.ok(ctx.damageLog.some(d => d.id === t.id && d.amount >= MISSILE.damage * (1 - MISSILE.fuse / MISSILE.blast) - 1e-9));
  });
}
test('blast damage falls off linearly to zero at 30 m', () => {
  near(blastDamage(0), 80, 1e-9); near(blastDamage(15), 40, 1e-9); assert.equal(blastDamage(30), 0); assert.equal(blastDamage(45), 0);
});
test('a missile whose target dies flies on, finite, and expires', () => {
  const p = player(); const t = target([0, 0, -2500]); const ctx = ctxWith([p, t]); const w = createWeapons();
  launchMissile(w, p, [0, 0, -3], t.id);
  for (let i = 0; i < 120; i++) stepWeapons(w, ctx, DT);
  t.alive = false;
  const m = w.missiles[0]; const before = [...m.pos];
  for (let i = 0; i < 240; i++) stepWeapons(w, ctx, DT);
  finite([...m.pos, ...m.vel]);
  assert.ok(dist(m.pos, before) > 100);
  for (let i = 0; i < Math.round(MISSILE.life / DT); i++) stepWeapons(w, ctx, DT);
  assert.equal(w.missiles.length, 0);
  assert.ok(ctx.events.some(e => e.type === 'missileExpire'));
});
test('leadPoint solves the intercept and refuses the impossible', () => {
  const lead = leadPoint([0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, -1000], [100, 0, 0], 1000);
  const t = len(lead) / 1000;
  near(dist(lead, [100 * t, 0, -1000]), 0, 0.01);
  assert.equal(leadPoint([0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, -1000], [0, 0, -2000], 1000), null);
});
await run();
