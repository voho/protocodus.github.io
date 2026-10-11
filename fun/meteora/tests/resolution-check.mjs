// Run with: node tests/resolution-check.mjs
// Adaptive resolution: drop a level when frames run long, climb back when the
// display's refresh rate holds, and never retry a level that just failed.
import { test, run, assert } from './harness.mjs';
import { createResolution } from '../js/resolution.js';

const feed = (r, ms, seconds) => { let ratio = r.ratio; for (let t = 0; t < seconds; t += ms / 1000) ratio = r.frame(ms); return ratio; };

test('starts at 1.5 on a high-density screen, at the screen ratio below that', () => {
  assert.equal(createResolution({ devicePixelRatio: 2 }).ratio, 1.5);
  assert.equal(createResolution({ devicePixelRatio: 1 }).ratio, 1);
});
test('drops a level when frames run long', () => {
  const r = createResolution({ devicePixelRatio: 2 });
  feed(r, 16.7, 2);
  const before = r.ratio;
  feed(r, 30, 1);
  assert.ok(r.ratio < before, `${r.ratio} < ${before}`);
});
test('a single slow frame changes nothing', () => {
  const r = createResolution({ devicePixelRatio: 2 });
  feed(r, 16.7, 2);
  const before = r.ratio;
  r.frame(80);
  feed(r, 16.7, 0.5);
  assert.equal(r.ratio, before);
});
test('never goes below the floor', () => {
  const r = createResolution({ devicePixelRatio: 2 });
  feed(r, 60, 60);
  assert.equal(r.ratio, r.levels[0]);
});
test('climbs back when the refresh rate holds', () => {
  const r = createResolution({ devicePixelRatio: 2 });
  feed(r, 16.7, 2); feed(r, 35, 3);
  const low = r.ratio;
  feed(r, 16.7, 8);
  assert.ok(r.ratio > low, `${r.ratio} > ${low}`);
});
test('a level that just failed is not retried for half a minute', () => {
  const r = createResolution({ devicePixelRatio: 2 });
  feed(r, 16.7, 2);
  const top = r.ratio;
  feed(r, 35, 2);                 // too slow at the top level: drop
  assert.ok(r.ratio < top);
  feed(r, 16.7, 15);
  assert.ok(r.ratio < top, 'the failed level stays banned');
  feed(r, 16.7, 25);
  assert.equal(r.ratio, top, 'and is tried again later');
});
test('a 120 Hz display is judged against its own refresh', () => {
  const r = createResolution({ devicePixelRatio: 2 });
  feed(r, 8.3, 2);
  const before = r.ratio;
  feed(r, 14, 2);                 // 70 fps on a 120 Hz screen is dropping frames
  assert.ok(r.ratio < before);
});
await run();
