import assert from 'node:assert/strict';
import { adaptiveResolutionScale } from '../adaptive-resolution.js';

function flight(milliseconds, initialFastest = 100, renderMs = 10) {
  let scale = 1, average = 16.7, fastest = initialFastest, time = 0, lastChange = 0, changes = 0;
  for (let frame = 0; frame < 1800; frame++) {
    time += milliseconds / 1000;
    fastest = Math.min(fastest, milliseconds);
    average += (Math.min(milliseconds, 250) - average) * .025;
    const next = adaptiveResolutionScale(scale, average, fastest, renderMs, time - lastChange);
    if (next !== scale) { changes++; scale = next; lastChange = time; }
  }
  return { scale, changes };
}
assert.deepEqual(flight(1000 / 30), { scale: .7, changes: 3 }, 'slow launch downscales without needing an earlier fast frame');
assert.deepEqual(flight(40), { scale: .7, changes: 3 }, '25 fps launch remains eligible');
assert.deepEqual(flight(1000 / 30, 1000 / 60), flight(1000 / 30), 'cold and previously fast flights reach the same floor');
assert.deepEqual(flight(1000 / 60), { scale: 1, changes: 0 }, 'steady 60 Hz retains full quality');
assert.deepEqual(flight(1000 / 120), { scale: 1, changes: 0 }, 'high refresh does not reduce quality');
assert.equal(adaptiveResolutionScale(1, 40, 16.7, 10, 4), 1, 'a slow frame cannot bypass the adaptation interval');
assert.equal(adaptiveResolutionScale(1, 20, 16.7, 10, 5), 1, 'a brief spike below the sustained threshold is ignored');
assert.equal(adaptiveResolutionScale(.7, 80, 16.7, 30, 20), .7, 'minimum backing scale is bounded');
assert.equal(adaptiveResolutionScale(.7, 16.7, 33.3, 5, 13), .75, 'headroom restores quality gradually');
assert.equal(adaptiveResolutionScale(.7, 16.7, 16.7, 5, 12), .7, 'recovery waits for its longer interval');
assert.equal(adaptiveResolutionScale(.7, 33.3, 33.3, 5, 30), .7, 'a learned slow cadence cannot bounce quality upward');
assert.equal(adaptiveResolutionScale(.7, 16.7, 16.7, 7, 30), .7, 'expensive rendering prevents recovery');
assert.equal(adaptiveResolutionScale(.95, 16.7, 16.7, 5, 13), 1, 'quality never exceeds the original backing resolution');
console.log('Adaptive resolution: slow launch, cadence, hysteresis, recovery and scale bounds passed.');
