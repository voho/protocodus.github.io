import test from 'node:test';
import assert from 'node:assert/strict';
import { railConsistPoses, RAIL_COACH_SPACING } from '../rail-consist.js';
import { shownProgress } from '../model.js';

const bodies = pose => [pose.engine, ...pose.coaches];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const close = (a, b, message = '') => assert.ok(Math.abs(a - b) < 1e-9, `${message}: ${a} ≠ ${b}`);
const angleDistance = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const straight = (axis, length, sign = 1) => Array.from({ length: length + 1 }, (_, i) => ({ x: 20 + (axis === 'x' ? i * sign : 0), y: 20 + (axis === 'y' ? i * sign : 0) }));

test('every body keeps its position and heading through either terminus reversal', () => {
  for (const axis of ['x', 'y']) for (const sign of [-1, 1]) for (const length of [1, 2, 20]) {
    const route = { mode: 'rail', path: straight(axis, length, sign) };
    for (const progress of [0, length]) {
      const arriving = { progress, direction: progress === 0 ? -1 : 1 }, departing = { ...arriving, direction: -arriving.direction };
      const before = railConsistPoses(route.path, shownProgress(route, arriving)), after = railConsistPoses(route.path, shownProgress(route, departing));
      assert.deepEqual(after, before, `${axis}/${sign}/${length} reverses without swapping or stacking bodies`);
      assert.ok(distance(before.engine, before.coaches[0]) > 0);
      assert.ok(distance(before.coaches[0], before.coaches[1]) > 0);
      const near = railConsistPoses(route.path, shownProgress(route, { ...arriving, progress: progress === 0 ? .0001 : length - .0001 }));
      bodies(before).forEach((body, i) => assert.ok(distance(body, bodies(near)[i]) < .0001, 'arrival is continuous all the way to the stop'));
    }
  }
});

test('the complete train moves along short and long routes without losing spacing or leaving the track', () => {
  for (const length of [1, 2, 3, 128]) {
    const path = straight('x', length), frames = Array.from({ length: 101 }, (_, i) => railConsistPoses(path, length * i / 100));
    for (const frame of frames) {
      assert.equal(frame.coaches.length, 2);
      const [engine, middle, tail] = bodies(frame);
      assert.ok(engine.progress > middle.progress && middle.progress > tail.progress, 'fixed physical order never depends on travel direction');
      close(engine.progress - middle.progress, frame.spacing); close(middle.progress - tail.progress, frame.spacing);
      for (const body of bodies(frame)) {
        assert.ok(body.progress >= 0 && body.progress <= length);
        assert.ok(body.x >= path[0].x && body.x <= path.at(-1).x); close(body.y, 20);
      }
    }
    bodies(frames[0]).forEach((body, i) => assert.ok(distance(body, bodies(frames.at(-1))[i]) >= length / 2, 'even the shortest route retains useful travel for every body'));
    if (length >= 3) { close(frames[0].spacing, RAIL_COACH_SPACING); close(frames[0].scale, 1); }
    else assert.ok(frames[0].scale > 0 && frames[0].scale < 1, 'short-route bodies can use the same reduced scale as their spacing');
    const reversed = frames.toReversed();
    for (let i = 1; i < reversed.length; i++) for (let body = 0; body < 3; body++) assert.ok(bodies(reversed[i])[body].progress < bodies(reversed[i - 1])[body].progress, 'the engine pushes the same two coaches on the return leg');
  }
});

test('body positions and headings remain continuous through route corners', () => {
  const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
  const length = path.length - 1, frames = Array.from({ length: 6001 }, (_, i) => railConsistPoses(path, length * i / 6000));
  let cornerHeading = false;
  for (let i = 1; i < frames.length; i++) for (let body = 0; body < 3; body++) {
    const a = bodies(frames[i - 1])[body], b = bodies(frames[i])[body];
    assert.ok(distance(a, b) <= .0011, 'a bend never jumps a body off the path');
    assert.ok(angleDistance(a.angle, b.angle) < .01, 'the body turns between its front and rear samples');
    if (b.angle > .1 && b.angle < Math.PI / 2 - .1) cornerHeading = true;
  }
  assert.ok(cornerHeading, 'bodies use intermediate headings while straddling a bend');
});

test('pose sampling is stateless, bounded by body count and leaves simulation data untouched', () => {
  const original = straight('x', 10000).map(Object.freeze), path = Object.freeze(original), vehicle = Object.freeze({ progress: 1234.5, direction: -1, load: 17, dwellRemaining: .1 });
  let reads = 0;
  const watched = new Proxy(path, { get(target, key) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key); } });
  const first = railConsistPoses(watched, vehicle.progress);
  assert.ok(reads <= 20, `a long route still needs only local body samples (${reads} points)`);
  railConsistPoses(path, 9999); railConsistPoses(path, 0);
  assert.deepEqual(railConsistPoses(path, vehicle.progress), first, 'sampling order and earlier frames do not affect a pose');
  assert.deepEqual(vehicle, { progress: 1234.5, direction: -1, load: 17, dwellRemaining: .1 });
  assert.deepEqual(path[0], { x: 20, y: 20 }); assert.deepEqual(path.at(-1), { x: 10020, y: 20 });
});

test('empty and stationary paths have safe fallbacks and progress stays within endpoints', () => {
  assert.equal(railConsistPoses([]), null); assert.equal(railConsistPoses(null), null);
  assert.deepEqual(railConsistPoses([{ x: 4, y: 7 }], 20), { engine: { x: 4, y: 7, angle: 0, progress: 0 }, coaches: [], spacing: 0, scale: 1 });
  const path = straight('y', 10);
  assert.deepEqual(railConsistPoses(path, -20), railConsistPoses(path, 0));
  assert.deepEqual(railConsistPoses(path, 999), railConsistPoses(path, 10));
  assert.deepEqual(railConsistPoses(path, NaN), railConsistPoses(path, 0));
});
