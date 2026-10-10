// tests/shake-check.mjs
import { test, run, assert } from './harness.mjs';
import { vibration, createShake, kick, stepShake } from '../js/shake.js';
import { SHAKE } from '../js/config.js';

const total = a => a.fine + a.rumble + a.buffet;
test('a ship at rest with no thrust only hums', () => {
  const a = vibration({ thrust: 0, afterburner: false, speed: 0, density: 0.8, rcs: 0 }, true);
  assert.equal(a.rumble, 0); assert.equal(a.buffet, 0); assert.ok(a.fine > 0 && a.fine <= SHAKE.idle + 1e-9);
});
test('amplitude rises with thrust and with speed × density', () => {
  let prev = -1;
  for (const thrust of [0, 0.25, 0.5, 1]) { const t = total(vibration({ thrust, afterburner: false, speed: 0, density: 0, rcs: 0 }, true)); assert.ok(t > prev); prev = t; }
  prev = -1;
  for (const [speed, density] of [[0, 1], [50, 0.2], [100, 0.5], [300, 1]]) { const b = vibration({ thrust: 0, afterburner: false, speed, density, rcs: 0 }, true).buffet; assert.ok(b > prev || (speed === 0 && b === 0)); prev = b; }
});
test('the afterburner adds rumble', () => {
  const off = vibration({ thrust: 1, afterburner: false, speed: 100, density: 0.3, rcs: 0 }, true);
  const on = vibration({ thrust: 1, afterburner: true, speed: 100, density: 0.3, rcs: 0 }, true);
  assert.equal(off.rumble, 0); assert.ok(on.rumble > 0);
});
test('vibration off zeroes everything but impact shake', () => {
  const a = vibration({ thrust: 1, afterburner: true, speed: 300, density: 1, rcs: 1 }, false);
  assert.equal(total(a), 0);
  const s = createShake(1); kick(s, 1);
  const o = stepShake(s, a, 1 / 60);
  assert.ok(Math.hypot(...o.rot) > 0, 'impact shake still shows');
  for (let i = 0; i < 120; i++) stepShake(s, a, 1 / 60);
  assert.ok(Math.hypot(...stepShake(s, a, 1 / 60).rot) < 1e-3, 'and decays');
});
await run();
