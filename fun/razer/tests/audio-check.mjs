import assert from 'node:assert/strict';
import { createEngineState } from '../js/audio.js';

const engine = createEngineState();
let voice, shifts = 0;
// A continuous acceleration run must progress through six gears without
// hunting or exceeding the voice's RPM range.
for (let frame = 0; frame < 1800; frame++) {
  voice = engine.update({ speed: Math.min(250 / 3.6, frame / 1800 * 80) }, 1, 1 / 60);
  assert(Number.isFinite(voice.rpm) && voice.rpm >= 850 && voice.rpm <= 7400);
  if (voice.shifted) shifts++;
}
assert.equal(voice.gear, 6);
assert.equal(shifts, 5);
assert(engine.update({ speed: 250 / 3.6 }, 0, 1 / 60).burble);
assert(!engine.update({ speed: 250 / 3.6 }, 0, 1 / 60).burble, 'Lift-off burble must only trigger once');
for (let frame = 0; frame < 600; frame++) voice = engine.update({ speed: 0 }, 0, 1 / 60);
assert.equal(voice.gear, 0);
assert(Math.abs(voice.rpm - 950) < 1);
for (let frame = 0; frame < 300; frame++) voice = engine.update({ speed: -6 }, .5, 1 / 60);
assert.equal(voice.gear, -1);
const grounded = createEngineState(), airborne = createEngineState();
for (let frame = 0; frame < 120; frame++) {
  grounded.update({ speed: 8 }, 1, 1 / 60);
  airborne.update({ speed: 8, airborne: true }, 1, 1 / 60);
}
assert(airborne.rpm > grounded.rpm + 2000, 'Unloaded engine must rev freely in the air');
console.log('Audio checks passed: six gears, shift hysteresis, RPM bounds, idle, reverse, lift-off and airborne load.');
