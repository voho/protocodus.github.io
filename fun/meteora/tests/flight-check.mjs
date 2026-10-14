// Run with: node tests/flight-check.mjs
import { test, run, assert, near } from './harness.mjs';
import { createShip, stepShip, NEUTRAL_CONTROLS, selectRcsPorts, forward, aimCommands, BURN_BUILD } from '../js/flight.js';
import { PLAYER, STEP as DT } from '../js/config.js';
import { CLASSES } from '../js/catalog.js';
import { qRotateInv, qRotate, qFromAxisAngle, len, normalize } from '../js/vec.js';

const ctl = (o = {}) => ({ ...NEUTRAL_CONTROLS, ...o });
const local = s => qRotateInv([0, 0, 0], s.q, s.vel);
function fly(s, c, seconds, each) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { stepShip(s, c, DT); each?.(s, i); }
}

test('FA on: full throttle converges on the forward target within main thrust', () => {
  const s = createShip(PLAYER); s.throttle = 1;
  let prev = local(s)[2];
  fly(s, ctl(), 10, s => { const z = local(s)[2]; assert.ok(prev - z <= PLAYER.accel.forward * DT + 1e-9); prev = z; });
  near(local(s)[2], -PLAYER.fa.forwardSpeed, 0.5);
});
test('throttle zero brakes to rest no faster than reverse thrust', () => {
  const s = createShip(PLAYER, { vel: [0, 0, -180] }); s.throttle = 1;
  let prev = 180;
  fly(s, ctl({ throttleZero: true }), 9.5, s => { const v = len(s.vel); assert.ok(prev - v <= PLAYER.accel.reverse * DT + 1e-9); prev = v; });
  assert.equal(s.throttle, 0);
  assert.ok(len(s.vel) < 0.5, `still ${len(s.vel)}`);
});
test('a fighter never flies backwards: held slower, every hull stops and stays stopped', () => {
  for (const hull of ['swift', 'kestrel', 'anvil']) {
    const stats = CLASSES[hull].flight;
    const s = createShip(stats, { vel: [0, 0, -stats.fa.forwardSpeed] }); s.throttle = 1;
    let back = 0;
    fly(s, ctl({ throttleDelta: -1 }), 30, s => { back = Math.max(back, local(s)[2]); });
    assert.equal(s.throttle, 0, hull);
    assert.ok(back < 0.01, `${hull} went backwards at ${back.toFixed(3)} m/s`);
    assert.ok(len(s.vel) < 0.5, `${hull} still moving at ${len(s.vel)}`);
  }
});
test('a 90° turn at speed leaves a slide that decays at the lateral limit', () => {
  const s = createShip(PLAYER, { vel: [0, 0, -150] }); s.throttle = 150 / 180;
  qFromAxisAngle(s.q, [0, 1, 0], -Math.PI / 2);   // nose now points +X; velocity is sideways
  let prev = Math.abs(local(s)[0]);
  fly(s, ctl(), 9, s => { const x = Math.abs(local(s)[0]); assert.ok(prev - x <= PLAYER.accel.lateral * DT + 1e-9); prev = x; });
  assert.ok(Math.abs(local(s)[0]) < 0.5);
  near(local(s)[2], -150, 0.5);
});
test('FA off with no input conserves velocity and spin', () => {
  const s = createShip(PLAYER, { vel: [3, -2, -50] }); s.fa = false; s.w = [0.2, 0, 0.5];
  const p0 = [...s.pos];
  fly(s, ctl(), 5);
  assert.deepEqual(s.vel.map(v => +v.toFixed(9)), [3, -2, -50]);
  assert.deepEqual(s.w.map(v => +v.toFixed(9)), [0.2, 0, 0.5]);
  near(s.pos[0] - p0[0], 15, 1e-6); near(s.pos[2] - p0[2], -250, 1e-6);
});
test('FA off: thrust keeps accelerating past the FA speed', () => {
  const s = createShip(PLAYER); s.fa = false; s.throttle = 1;
  fly(s, ctl(), 10);
  near(-local(s)[2], PLAYER.accel.forward * 10, 1);
});
test('afterburner: accel, drain, dry-out, regen delay and relock', () => {
  const s = createShip(PLAYER); s.throttle = 1;
  fly(s, ctl({ boost: true }), 1);
  // The thrust builds from 1× to 2× over BURN_BUILD: a second in, the
  // speed is the integral, 1 + 1 / (2 BURN_BUILD) times the base thrust.
  near(len(s.vel), PLAYER.accel.boost * (1 + 1 / (2 * BURN_BUILD)), 1.5); near(s.boost, 75, 0.5); assert.equal(s.afterburner, true);
  fly(s, ctl({ boost: true }), 3.2);
  assert.equal(s.afterburner, false); near(s.boost, 0, 0.01);
  fly(s, ctl(), 1.2); near(s.boost, 0, 0.01);
  fly(s, ctl(), 1.0); near(s.boost, PLAYER.boost.regen * 0.9, 0.3);
  fly(s, ctl({ boost: true }), 0.1); assert.equal(s.afterburner, false, 'locked until 20');
});
test('the longer the afterburner is held, the harder it pushes and the faster it goes', () => {
  const s = createShip({ ...PLAYER, boost: { ...PLAYER.boost, capacity: 1000 } }); s.throttle = 1;
  fly(s, ctl({ boost: true }), 0.2);
  const early = s.burnRamp;
  fly(s, ctl({ boost: true }), BURN_BUILD + 6);
  assert.ok(early < 0.1 && s.burnRamp === 1);
  near(-local(s)[2], PLAYER.fa.boostSpeed * 1.35, 2, 'a third more than the plain boost speed');
  fly(s, ctl(), 0.1);
  assert.equal(s.burnRamp, 0, 'letting go starts the build-up over');
});
test('afterburner raises the FA target to boost speed', () => {
  const s = createShip(PLAYER); s.throttle = 1;
  fly(s, ctl({ boost: true }), 3.9);
  assert.ok(-local(s)[2] > PLAYER.fa.forwardSpeed + 100);
});
test('FA on rotation: rate reached at angular accel, release stops it', () => {
  const s = createShip(PLAYER);
  let prev = 0;
  fly(s, ctl({ pitch: 1 }), 1, s => { assert.ok(s.w[0] - prev <= PLAYER.angAccel[0] * DT + 1e-9); prev = s.w[0]; });
  near(s.w[0], PLAYER.rate[0], 0.01);
  fly(s, ctl(), 0.6);
  near(s.w[0], 0, 0.01);
});
test('control signs: pitch up, yaw right, roll right', () => {
  const nose = s => forward([0, 0, 0], s);
  let s = createShip(PLAYER); fly(s, ctl({ pitch: 1 }), 0.4); assert.ok(nose(s)[1] > 0.1);
  s = createShip(PLAYER); fly(s, ctl({ yaw: 1 }), 0.4); assert.ok(nose(s)[0] > 0.1);
  s = createShip(PLAYER); fly(s, ctl({ roll: 1 }), 0.4);
  assert.ok(qRotate([0, 0, 0], s.q, [1, 0, 0])[1] < -0.1);
});
test('FA off: spin persists after the stick is released', () => {
  const s = createShip(PLAYER); s.fa = false;
  fly(s, ctl({ roll: 1 }), 0.5);
  const spin = s.w[2];
  near(spin, -PLAYER.angAccel[2] * 0.5, 0.05);
  fly(s, ctl(), 2);
  near(s.w[2], spin, 1e-9);
});
test('the quaternion stays normalised through a minute of tumbling', () => {
  const s = createShip(PLAYER); s.fa = false; s.w = [1.3, -0.7, 2.1];
  fly(s, ctl(), 60);
  near(Math.hypot(...s.q), 1, 1e-9);
});
test('throttle ramps at its rate and clamps; toggleFA flips once', () => {
  const s = createShip(PLAYER);
  fly(s, ctl({ throttleDelta: 1 }), 1); near(s.throttle, 0.6, 0.01);
  fly(s, ctl({ throttleDelta: 1 }), 3); near(s.throttle, 1, 1e-9);
  fly(s, ctl({ throttleDelta: -1 }), 5); near(s.throttle, PLAYER.throttle.min, 1e-9);
  stepShip(s, ctl({ toggleFA: true }), DT); assert.equal(s.fa, false);
  stepShip(s, ctl({ throttleSet: 0.5 }), DT); near(s.throttle, 0.5, 1e-9);
});
test('selectRcsPorts fires the ports that push the commanded way', () => {
  const ports = [
    { pos: [0, 0, -5], dir: [0, 1, 0] }, { pos: [0, 0, -5], dir: [0, -1, 0] },
    { pos: [3, 0, 0], dir: [1, 0, 0] }, { pos: [-3, 0, 0], dir: [-1, 0, 0] },
  ];
  assert.deepEqual(selectRcsPorts(ports, [0, 0, 0], [-3, 0, 0], PLAYER).map(f => f.index), [0]);
  assert.deepEqual(selectRcsPorts(ports, [10, 0, 0], [0, 0, 0], PLAYER).map(f => f.index), [3]);
  assert.equal(selectRcsPorts(ports, [0, 0, -45], [0, 0, 0], PLAYER).length, 0, 'main engine needs no RCS');
  for (const f of selectRcsPorts(ports, [22, 0, 0], [0, 0, 0], PLAYER)) assert.ok(f.intensity > 0 && f.intensity <= 1);
});
test('aimCommands: still on the nose, toward the point otherwise, full stick behind', () => {
  const s = createShip(PLAYER);
  let c = aimCommands(s, [0, 0, -1]); near(c.pitch, 0, 1e-12); near(c.yaw, 0, 1e-12);
  c = aimCommands(s, normalize([0, 0, 0], [0.1, 0, -1])); assert.ok(c.yaw > 0.1 && Math.abs(c.pitch) < 1e-12);
  c = aimCommands(s, normalize([0, 0, 0], [0, 0.1, -1])); assert.ok(c.pitch > 0.1 && Math.abs(c.yaw) < 1e-12);
  c = aimCommands(s, [0, 0, 1]); assert.equal(Math.max(Math.abs(c.pitch), Math.abs(c.yaw)), 1);
  c = aimCommands(s, normalize([0, 0, 0], [0.004, 0, -1])); near(c.yaw, 0, 1e-12, 'inside the deadzone');
  c = aimCommands(s, [0, 0, 0]); assert.equal(c.pitch, 0); assert.equal(c.yaw, 0);
});
test('aimCommands answers briskly: 15° off the nose is already full stick', () => {
  // The original gain needed 19° for full stick; the campaign's is 4, so
  // the nose follows the crosshair harder and settles on it sooner.
  const s = createShip(PLAYER);
  const a = 15 * Math.PI / 180;
  const c = aimCommands(s, [Math.sin(a), 0, -Math.cos(a)]);
  near(c.yaw, 1, 1e-12);
  const b = 7 * Math.PI / 180;
  assert.ok(aimCommands(s, [Math.sin(b), 0, -Math.cos(b)]).yaw > 0.45, 'half stick by 7°');
});
test('speedSet holds a commanded forward speed, even above full throttle', () => {
  const s = createShip(PLAYER);
  fly(s, ctl({ speedSet: 250 }), 10);
  near(-local(s)[2], 250, 0.5); near(s.cruise, 250, 1e-9);
  assert.equal(s.afterburner, false, 'no afterburner energy spent');
  near(s.boost, PLAYER.boost.capacity, 1e-9);
  stepShip(s, ctl({ speedSet: 5000 }), DT);
  near(s.cruise, PLAYER.fa.boostSpeed, 1e-9, 'capped at the afterburner speed');
  stepShip(s, ctl({ speedSet: 90 }), DT);
  near(s.throttle, 90 / PLAYER.fa.forwardSpeed, 1e-9, 'the throttle follows, so letting go is seamless');
});
await run();
