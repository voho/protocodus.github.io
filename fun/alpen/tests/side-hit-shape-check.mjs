// Sample the real height field with optional features enabled and disabled.
import assert from 'node:assert/strict';
import { TERRAIN } from '../js/config.js';
import { setWorldSeed } from '../js/noise.js';
import { sideHitsIn, heightAt, guideAt } from '../js/terrain.js';

const records = [], kinds = ['roller', 'drift', 'windlip'];
function reseed(seed) {
  setWorldSeed('shape-cache-flush'); sideHitsIn(-2400, 0); heightAt(0, 0); setWorldSeed(seed);
}
for (const seed of ['1EE9566', 'alpen-check', 'fresh-powder', 73291]) {
  reseed(seed);
  const hits = sideHitsIn(-4000, 0);
  assert(hits.length >= 8, 'regular optional features on ' + seed);
  const entries = hits.map(hit => {
    const points = [];
    for (const f of [-.9, -.7, -.5, -.3, -.1, 0, .2, .4, .6, .8]) {
      const s = f < 0 ? hit.face * f : hit.lee * f;
      points.push([hit.x, hit.z - s]);
    }
    for (const f of [.2, .4, .6, .8]) points.push([hit.x + hit.side * hit.halfWidth * f, hit.z]);
    const ribbon = [];
    for (const s of [-hit.face * .6, 0, hit.lee * .6]) {
      const z = hit.z - s, line = guideAt(z);
      for (const dx of [-TERRAIN.guide.tol, 0, TERRAIN.guide.tol]) ribbon.push([line + dx, z]);
    }
    const e = .001, joins = [];
    for (const s of [-hit.face, 0, hit.lee]) for (const d of [-e, 0, e]) joins.push([hit.x, hit.z - s + d]);
    return { hit, points, ribbon, joins };
  });
  const points = entries.flatMap(e => [...e.points, ...e.ribbon, ...e.joins]);
  const on = points.map(([x, z]) => heightAt(x, z));
  const chance = TERRAIN.sideHits.chance;
  let off;
  try {
    TERRAIN.sideHits.chance = -1; reseed(seed);
    off = points.map(([x, z]) => heightAt(x, z));
  } finally { TERRAIN.sideHits.chance = chance; reseed(seed); }
  let index = 0;
  for (const entry of entries) {
    const { hit } = entry;
    assert(kinds.includes(hit.shape));
    const curve = entry.points.map((_, i) => (on[index + i] - off[index + i]) / hit.height);
    index += entry.points.length;
    assert(curve.every(v => Number.isFinite(v) && v >= -1e-8 && v <= 1.001), 'bounded actual normalized height');
    for (let i = 0; i < entry.ribbon.length; i++) assert(Math.abs(on[index + i] - off[index + i]) < 1e-9, 'racing ribbon stays unchanged');
    index += entry.ribbon.length;
    for (let i = 0; i < entry.joins.length; i += 3) {
      const a = on[index + i] - off[index + i], b = on[index + i + 1] - off[index + i + 1], c = on[index + i + 2] - off[index + i + 2];
      assert(Math.abs((b - a) / .001 - (c - b) / .001) < .02, 'face/lee/boundary first derivative stays continuous');
    }
    index += entry.joins.length;
    records.push({ hit, curve });
  }
  assert.deepEqual(sideHitsIn(-4000, 0), hits, 'restored seed restores all geometry');
}
const means = Object.fromEntries(kinds.map(kind => {
  const group = records.filter(r => r.hit.shape === kind);
  assert(group.length >= 4, 'every silhouette family is present');
  return [kind, group[0].curve.map((_, i) => group.reduce((sum, r) => sum + r.curve[i], 0) / group.length)];
}));
const rms = (a, b) => Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0) / a.length);
const differences = [];
for (let a = 0; a < kinds.length; a++) for (let b = a + 1; b < kinds.length; b++) {
  const distance = rms(means[kinds[a]], means[kinds[b]]);
  assert(distance > .04, 'normalized heightfield profiles differ, not just dimensions');
  differences.push({ a: kinds[a], b: kinds[b], rms: distance });
}
const span = key => Math.max(...records.map(r => r.hit[key])) / Math.min(...records.map(r => r.hit[key]));
assert(span('halfWidth') > 2.5 && span('height') > 2 && span('face') > 3, 'width, height and length have meaningful variety');
console.log('Side-hit shape checks passed: ' + records.length + ' actual heightfield profiles, three silhouettes, smooth joins, ribbon and seed determinism. ' + JSON.stringify(differences));
