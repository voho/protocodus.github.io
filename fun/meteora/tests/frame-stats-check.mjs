// Run with: node tests/frame-stats-check.mjs
// The in-game benchmark (?bench) summarises frame samples with these.
import { test, run, assert, near } from './harness.mjs';
import { createFrameStats } from '../js/frame-stats.js';

test('summarises samples into mean, median, 95th percentile and count', () => {
  const s = createFrameStats();
  for (let i = 1; i <= 100; i++) s.add('frame', i);
  const r = s.summary().frame;
  near(r.mean, 50.5, 1e-9); assert.equal(r.p50, 50); assert.equal(r.p95, 95); assert.equal(r.count, 100);
});
test('keeps each metric separately and ignores missing values', () => {
  const s = createFrameStats();
  s.add('frame', 16); s.add('gpu', null); s.add('gpu', 4); s.add('gpu', undefined); s.add('gpu', 6);
  const r = s.summary();
  assert.equal(r.frame.count, 1); assert.equal(r.gpu.count, 2); near(r.gpu.mean, 5, 1e-9);
});
test('a metric with no samples is reported as unavailable, not zero', () => {
  const s = createFrameStats();
  s.add('frame', 16);
  assert.equal(s.summary().gpu, undefined);
  assert.equal(createFrameStats().summary().frame, undefined);
});
await run();
