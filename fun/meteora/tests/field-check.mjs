// Run with: node tests/field-check.mjs
import { test, run, assert, near } from './harness.mjs';
import { generateBelt, createField, densityAt } from '../js/field.js';
import { FIELD } from '../js/config.js';
import { makeRng } from '../js/rng.js';
import { dist, len } from '../js/vec.js';

const SEED = 1234;
const field = createField(SEED);
const b = field.belt;
const P = i => [b.pos[3 * i], b.pos[3 * i + 1], b.pos[3 * i + 2]];
const EMPTY = { ...FIELD, types: FIELD.types.map(t => ({ ...t, count: 0 })), landmarks: { ...FIELD.landmarks, count: 0 } };

test('the same seed gives the identical belt, another seed does not', () => {
  const again = generateBelt(SEED);
  assert.deepEqual(again.pos, b.pos); assert.deepEqual(again.type, b.type); assert.deepEqual(again.scale, b.scale);
  assert.notDeepEqual(generateBelt(SEED + 1).pos.slice(0, 30), b.pos.slice(0, 30));
});
test('counts per type match the config', () => {
  const counts = [0, 0, 0, 0, 0]; let landmarks = 0;
  for (let i = 0; i < b.count; i++) { counts[b.type[i]]++; landmarks += b.landmark[i]; }
  FIELD.types.forEach((t, k) => assert.equal(counts[k], t.count + (k === 4 ? FIELD.landmarks.count : 0), `type ${k}`));
  assert.equal(landmarks, FIELD.landmarks.count);
});
test('no two rocks overlap (central 1.5 km cube brute force, plus all big rocks)', () => {
  const ids = [];
  for (let i = 0; i < b.count; i++) { const p = P(i); if (Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])) < 750 || b.radius[i] > 30) ids.push(i); }
  for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
    const i = ids[x], j = ids[y];
    assert.ok(dist(P(i), P(j)) >= (b.radius[i] + b.radius[j]) * FIELD.gap - 1e-3, `rocks ${i} and ${j} overlap`);
  }
});
test('the spawn sphere is clear', () => {
  for (let i = 0; i < b.count; i++) assert.ok(dist(P(i), FIELD.spawn) - b.radius[i] >= FIELD.spawnClear);
});
test('radius queries agree with brute force', () => {
  const r = makeRng(9);
  for (let q = 0; q < 200; q++) {
    const p = [r.range(-4000, 4000), r.range(-1000, 1000), r.range(-4000, 4000)], rad = r.range(20, 400);
    const got = field.queryRadius(p, rad).filter(h => h.kind === 'static').map(h => h.index).sort((a, c) => a - c);
    const want = [];
    for (let i = 0; i < b.count; i++) if (dist(P(i), p) < rad + b.collide[i]) want.push(i);
    assert.deepEqual(got, want);
  }
});
test('sweepSphere returns the first rock along a segment', () => {
  const r = makeRng(11);
  for (let k = 0; k < 50; k++) {
    const p0 = [r.range(-3000, 3000), r.range(-800, 800), r.range(-3000, 3000)];
    const p1 = [p0[0] + r.range(-800, 800), p0[1] + r.range(-200, 200), p0[2] + r.range(-800, 800)];
    const hit = field.sweepSphere(p0, p1, 0.3);
    let best = Infinity, bestI = -1;
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    for (let i = 0; i < b.count; i++) {   // brute-force segment–sphere
      const c = P(i), R = b.collide[i] + 0.3;
      const m = [p0[0] - c[0], p0[1] - c[1], p0[2] - c[2]];
      const A = d[0] ** 2 + d[1] ** 2 + d[2] ** 2, B = 2 * (m[0] * d[0] + m[1] * d[1] + m[2] * d[2]), C = m[0] ** 2 + m[1] ** 2 + m[2] ** 2 - R * R;
      const disc = B * B - 4 * A * C; if (disc < 0) continue;
      const t = C <= 0 ? 0 : (-B - Math.sqrt(disc)) / (2 * A);
      if (t >= 0 && t <= 1 && t < best) { best = t; bestI = i; }
    }
    if (bestI < 0) assert.equal(hit, null);
    else { assert.equal(hit.ref.index, bestI); near(hit.t, best, 1e-6); }
  }
});
test('density is in [0,1] and vanishes outside the slab', () => {
  for (let i = 0; i < 500; i++) { const d = densityAt(i * 13 - 3000, (i % 7) * 100, i * 7 - 2000, SEED); assert.ok(d >= 0 && d <= 1); }
  assert.equal(densityAt(0, 3000, 0, SEED), 0);
  assert.equal(densityAt(9000, 0, 0, SEED), 0);
});
test('a type-3 rock splits into 2–3 type-2 rocks whose centre of mass carries the impulse', () => {
  const f = createField(SEED);
  const i = [...f.belt.type].findIndex(t => t === 2);
  const ref = { kind: 'static', index: i, pos: P(i) };
  const events = [];
  const M = f.belt.radius[i] ** 3, impulse = [0, 0, -5 * M];
  let result;
  while ((result = f.damageRock(ref, 50, P(i), impulse, events)) === 'damaged');
  assert.equal(result, 'destroyed');
  assert.ok(f.dynamic.length >= 2 && f.dynamic.length <= 3);
  assert.ok(f.dynamic.every(r => r.type === 1));
  let m = 0; const mv = [0, 0, 0];
  for (const r of f.dynamic) { const w = r.radius ** 3; m += w; for (let k = 0; k < 3; k++) mv[k] += w * r.vel[k]; }
  near(mv[2] / m, -5, 1e-6); near(mv[0] / m, 0, 1e-6); near(mv[1] / m, 0, 1e-6);
  assert.ok(!f.queryRadius(P(i), 0.1).some(h => h.kind === 'static' && h.index === i), 'parent gone');
  assert.ok(events.some(e => e.type === 'rockBreak') && events.some(e => e.type === 'staticRockRemoved' && e.index === i));
});
test('type-1 rocks crumble without children; types 4–5 are immune', () => {
  const f = createField(SEED); const events = [];
  const small = [...f.belt.type].findIndex(t => t === 0);
  while (f.damageRock({ kind: 'static', index: small }, 100, P(small), [0, 0, 0], events) === 'damaged');
  assert.equal(f.dynamic.length, 0);
  const big = [...f.belt.type].findIndex(t => t === 4);
  assert.equal(f.damageRock({ kind: 'static', index: big }, 1e9, P(big), [0, 0, 0], events), 'immune');
  assert.ok(events.some(e => e.type === 'rockImpact'));
});
test('dynamic rocks are capped and the oldest crumble first', () => {
  const f = createField(SEED, EMPTY); const events = [];
  for (let k = 0; k < 80; k++) f.addDynamicRock(0, [k * 10, 0, 0], [0, 0, 0]);
  assert.equal(f.dynamic.length, FIELD.maxDynamic);
  assert.equal(Math.min(...f.dynamic.map(r => r.id)), 80 - FIELD.maxDynamic);
});
test('reset restores destroyed rocks and clears dynamic ones', () => {
  const f = createField(SEED); const events = [];
  const ids = [...f.belt.type].map((t, i) => [t, i]).filter(([t]) => t === 1).slice(0, 20).map(([, i]) => i);
  for (const i of ids) while (f.damageRock({ kind: 'static', index: i }, 100, P(i), [0, 0, 0], events) === 'damaged');
  assert.ok(f.dynamic.length > 0);
  f.reset();
  assert.equal(f.dynamic.length, 0);
  for (const i of ids) assert.ok(f.queryRadius(P(i), 0.1).some(h => h.kind === 'static' && h.index === i));
  assert.ok(f.alive.every(a => a === 1));
});
test('queries 1 000 km out return nothing, fast', () => {
  const t0 = performance.now();
  assert.deepEqual(field.queryRadius([1e6, 0, -1e6], 500), []);
  assert.equal(field.sweepSphere([1e6, 0, 0], [1e6 + 1000, 0, 0], 1), null);
  assert.ok(performance.now() - t0 < 50);
});
test('dynamic rocks drift and bounce off static rocks', () => {
  const f = createField(SEED); const events = [];
  const big = [...f.belt.type].findIndex(t => t === 3);
  const c = P(big), R = f.belt.collide[big];
  const r = f.addDynamicRock(0, [c[0] + R + 20, c[1], c[2]], [-20, 0, 0]);
  for (let k = 0; k < 240; k++) f.step(1 / 120, events);
  assert.ok(r.vel[0] > 0, 'bounced away');
  assert.ok(dist(r.pos, c) >= R + r.collide - 1e-6);
});
await run();
