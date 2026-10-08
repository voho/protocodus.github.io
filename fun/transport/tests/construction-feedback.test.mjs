import test from 'node:test';
import assert from 'node:assert/strict';
import { createConstructionFeedback, CONSTRUCTION_FEEDBACK_MS, CONSTRUCTION_FEEDBACK_CELLS } from '../construction-feedback.js';

const cells = feedback => feedback.flatMap(effect => effect.points);

test('a successful edit stays briefly readable, fades on wall time and expires while the world is paused', () => {
  const feedback = createConstructionFeedback();
  assert.equal(feedback.add([{ x: 4, y: 7 }], { now: 1000 }), true);
  assert.equal(feedback.sample(1000)[0].alpha, 1);
  assert.equal(feedback.sample(1120)[0].alpha, 1, 'the first frames hold the complete mark');
  const middle = feedback.sample(1400)[0].alpha, last = feedback.sample(1699)[0].alpha;
  assert.ok(middle > last && last > 0 && middle < 1, 'opacity settles without a blink or pulse');
  assert.equal(feedback.active(1699), true);
  assert.deepEqual(feedback.sample(1000 + CONSTRUCTION_FEEDBACK_MS), []);
  assert.equal(feedback.active(2000), false);
});

test('reduced motion shows a static confirmation for the same bounded lifetime', () => {
  const feedback = createConstructionFeedback();
  feedback.add([{ x: 3, y: 8 }], { now: 0 });
  for (const now of [0, 120, 400, 699]) assert.equal(feedback.sample(now, { reducedMotion: true })[0].alpha, 1);
  assert.deepEqual(feedback.sample(700, { reducedMotion: true }), []);
});

test('multi-tile footprints retain every changed cell without retaining the undo record', () => {
  const points = Array.from({ length: 25 }, (_, i) => ({ x: 10 + i % 5, y: 10 + Math.floor(i / 5), tile: { terrain: 'grass' } }));
  const original = points.map(({ x, y }) => ({ x, y })), feedback = createConstructionFeedback();
  feedback.add([...points, points[0], null, { x: -1, y: 3 }, { x: 2.5, y: 1 }], { now: 0 });
  const sample = feedback.sample(0);
  assert.equal(cells(sample).length, 25);
  assert.deepEqual(new Set(cells(sample).map(JSON.stringify)), new Set(original.map(JSON.stringify)));
  points[0].x = 999;
  sample[0].points[0].x = 998;
  assert.equal(cells(feedback.sample(10)).some(point => point.x > 100), false, 'neither callers nor frame data own the retained coordinates');
  assert.equal(cells(feedback.sample(10)).some(point => 'tile' in point), false);
});

test('a large drag reads and retains only its latest bounded footprint', () => {
  let reads = 0;
  const points = new Proxy(new Array(100_000), { get(target, prop) {
    if (/^\d+$/.test(String(prop))) { reads++; return { x: Number(prop), y: 3 }; }
    return Reflect.get(target, prop);
  } });
  const feedback = createConstructionFeedback();
  feedback.add(points, { now: 0 });
  assert.equal(reads, CONSTRUCTION_FEEDBACK_CELLS);
  assert.equal(cells(feedback.sample(0)).length, CONSTRUCTION_FEEDBACK_CELLS);
  assert.equal(cells(feedback.sample(0))[0].x, points.length - CONSTRUCTION_FEEDBACK_CELLS);
});

test('rapid edits share one cap and refreshed cells inherit the latest kind and lifetime', () => {
  const feedback = createConstructionFeedback();
  for (let i = 0; i < 150; i++) feedback.add([{ x: i, y: 3 }], { now: i });
  assert.equal(cells(feedback.sample(150)).length, CONSTRUCTION_FEEDBACK_CELLS);
  assert.equal(cells(feedback.sample(150))[0].x, 150 - CONSTRUCTION_FEEDBACK_CELLS);
  feedback.add([{ x: 149, y: 3 }], { now: 500, kind: 'remove' });
  const effects = feedback.sample(849), restored = effects.find(effect => effect.kind === 'remove');
  assert.deepEqual(cells(effects), [{ x: 149, y: 3 }], 'old marks expire separately from the latest change');
  assert.ok(restored.alpha > 0);
  feedback.add([{ x: 149, y: 3 }], { now: 900, kind: 'undo' });
  assert.deepEqual(feedback.sample(900), [{ points: [{ x: 149, y: 3 }], kind: 'undo', alpha: 1, expiresAt: 1600 }]);
});

test('empty or rejected changes create no mark, and clearing a world discards pending effects', () => {
  const feedback = createConstructionFeedback();
  assert.equal(feedback.add([], { now: 0 }), false);
  assert.equal(feedback.add(null, { now: 0 }), false);
  assert.equal(feedback.add([{ x: 1, y: 1 }], { now: NaN }), false);
  assert.equal(feedback.active(1), false);
  feedback.add([{ x: 1, y: 1 }], { now: 10 });
  feedback.clear();
  assert.equal(feedback.active(10), false);
  assert.deepEqual(feedback.sample(10), []);
});
