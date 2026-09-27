import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceSimulationFrame } from '../frame-scheduler.js';

test('all five speed settings advance fixed ticks at their requested rate', () => {
  for (const speed of [1, 1.25, 1.5, 1.75, 2]) {
    let pending = 0, simulated = 0;
    for (let frame = 0; frame < 600; frame++) pending = advanceSimulationFrame(pending, 1 / 60, speed, dt => {
      assert.equal(dt, .05); simulated += dt;
    }, () => 0);
    assert(Math.abs(simulated + pending - 10 * speed) < 1e-8);
    assert(pending < .05);
  }
});

test('a slow tick yields before another tick and preserves bounded pending work', () => {
  let time = 0, steps = 0;
  const slow = dt => { assert.equal(dt, .05); steps++; time += 130; };
  let pending = advanceSimulationFrame(0, .2, 2, slow, () => time);
  assert.equal(steps, 1, 'An overloaded frame does not chain eight expensive ticks');
  assert(Math.abs(pending - .35) < 1e-10);
  for (let frame = 0; frame < 20; frame++) {
    const before = steps;
    pending = advanceSimulationFrame(pending, .13, 2, slow, () => time);
    assert.equal(steps - before, 1);
    assert(pending <= .4, 'Overload never creates an unbounded catch-up queue');
  }
  const before = steps;
  pending = advanceSimulationFrame(pending, 0, 2, () => { steps++; }, () => time);
  assert.equal(steps - before, 7, 'A fast frame can consume the retained work');
  assert(pending < 1e-9);
});

test('moderate tick costs respect the frame budget and terminal results clear pending work', () => {
  let time = 0, steps = 0;
  const pending = advanceSimulationFrame(0, .2, 2, () => { steps++; time += 3; }, () => time);
  assert.equal(steps, 3);
  assert(Math.abs(pending - .25) < 1e-10);
  steps = 0;
  assert.equal(advanceSimulationFrame(pending, .1, 1, () => { steps++; return false; }, () => time), 0);
  assert.equal(steps, 1);
});

test('sustained overload trades requested speed for bounded work and a render opportunity', () => {
  let pending = 0, time = 0, simulated = 0;
  // A 10 ms tick plus 10 ms rendering misses alternate 60 Hz display frames.
  // At 30 frames/sec one tick per frame produces 150%, even when 200% is requested.
  for (let frame = 0; frame < 300; frame++) {
    let steps = 0;
    pending = advanceSimulationFrame(pending, 1 / 30, 2, dt => {
      simulated += dt; time += 10; steps++;
    }, () => time);
    assert.equal(steps, 1);
    assert(pending <= .4);
    time += 10;
  }
  assert(Math.abs(simulated - 15) < 1e-8);
  assert(pending < .4);
});

test('a resumed frame starts with no stale debt and ordinary short frames do not tick early', () => {
  let steps = 0;
  const step = () => { steps++; };
  let pending = advanceSimulationFrame(0, .016, 1, step, () => 0);
  assert.equal(steps, 0);
  pending = advanceSimulationFrame(pending, .016, 1, step, () => 0);
  assert.equal(steps, 0);
  advanceSimulationFrame(pending, .018, 1, step, () => 0);
  assert.equal(steps, 1);
  advanceSimulationFrame(0, .016, 1, step, () => 0);
  assert.equal(steps, 1);
});
