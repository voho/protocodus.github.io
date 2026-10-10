// Run with: node tests/flight-check.mjs
import { test, run, assert, near } from './harness.mjs';
import { createShip, stepShip, NEUTRAL_CONTROLS, selectRcsPorts, forward } from '../js/flight.js';
import { PLAYER, STEP as DT } from '../js/config.js';
import { qRotateInv, qRotate, qFromAxisAngle, len } from '../js/vec.js';

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
  near(len(s.vel), PLAYER.accel.boost, 1.5); near(s.boost, 75, 0.5); assert.equal(s.afterburner, true);
  fly(s, ctl({ boost: true }), 3.2);
  assert.equal(s.afterburner, false); near(s.boost, 0, 0.01);
  fly(s, ctl(), 1.2); near(s.boost, 0, 0.01);
  fly(s, ctl(), 1.0); near(s.boost, PLAYER.boost.regen * 0.9, 0.3);
  fly(s, ctl({ boost: true }), 0.1); assert.equal(s.afterburner, false, 'locked until 20');
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
await run();
