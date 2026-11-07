// River banks must join the surrounding land smoothly, retain the actual
// crossing sections and keep every underwater point inside visible water.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import L from '../js/levels/saint-clair.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/saint-river-crossings.json', import.meta.url), 'utf8'));
for (const crossing of fixture.crossings) {
  const prop = crossing.id ? L.props.find(p => p.id === crossing.id) : null;
  assert.ok(!crossing.id || prop, 'the real crossing prop remains available');
  const [x, z] = prop ? [prop.x, prop.z] : crossing.origin;
  for (const sample of crossing.samples) {
    const ax = x + sample.offset[0], az = z + sample.offset[1], h = L.baseHeight(ax, az);
    assert.ok(Math.abs(h - sample.height) < 1e-10, crossing.name + ' protected ground section changes');
    const splat = L.splat(ax, az, h, 0);
    assert.ok(splat.every((w, i) => Math.abs(w - sample.splat[i]) < 1e-10), crossing.name + ' protected wet/grass section changes');
  }
}

// The old null-at-bank edge left a measurable step on the high valley side.
// Probe its complete historical cutoff ring, not a value from the new helper.
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const epsilon = 1e-5;
let maximumEdgeDifference = 0;
for (let x = -95; x <= 95; x += .25) {
  const legacyRadius = 10.5 + 3.5 * smooth(9, 3, Math.abs(x + 32));
  for (const side of [-1, 1]) {
    const z = L.water.riverZ(x) + side * legacyRadius;
    const difference = Math.abs(L.baseHeight(x, z + epsilon) - L.baseHeight(x, z - epsilon));
    maximumEdgeDifference = Math.max(maximumEdgeDifference, difference);
    assert.ok(difference < .001, 'historical outer-bank cutoff cannot leave a height step');
  }
}
for (const { x, z } of fixture.outerTieSites) {
  const delta = .001, centre = L.baseHeight(x, z);
  const left = (centre - L.baseHeight(x, z - delta)) / delta;
  const right = (L.baseHeight(x, z + delta) - centre) / delta;
  assert.ok(Math.abs(left - right) < .01, 'the reviewed outer shoulder meets the land with a continuous grade');
}

// Actual master vertices and diagonal interpolation, as terrain.js. The
// river sections have no building pad between the bank and its wet floor.
const res = .5, cache = new Map(), { minX, minZ } = L.bounds;
const point = (i, j) => { const key = i + ',' + j; if (!cache.has(key)) cache.set(key, Math.fround(L.baseHeight(minX + i * res, minZ + j * res))); return cache.get(key); };
const master = (x, z) => {
  const gx = (x - minX) / res, gz = (z - minZ) / res, i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
  const a = point(i, j), b = point(i + 1, j), c = point(i, j + 1), d = point(i + 1, j + 1);
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
};
const wetWidth = (x, side) => {
  const z = L.water.riverZ(x); let lo = 0, hi = 13;
  assert.ok(master(x, z) < L.water.level && master(x, z + side * hi) > L.water.level);
  for (let n = 0; n < 30; n++) { const mid = (lo + hi) / 2; if (master(x, z + side * mid) < L.water.level) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
};
const east = wetWidth(-18, -1) - wetWidth(-18, 1), west = wetWidth(18, 1) - wetWidth(18, -1);
assert.ok(east > .75 && west > .75, 'the open banks form unequal opposing bays rather than a symmetric channel');

function checkWaterMargin(water) {
  let wet = 0;
  for (let x = -95; x <= 95; x += 1) for (let d = -16; d <= 16; d += .25) {
    const z = L.water.riverZ(x) + d;
    if (master(x, z) >= water.level - .01) continue;
    wet++;
    assert.ok(water.contains(x, z) && water.contains(x, z - 1) && water.contains(x, z + 1), 'sampled underwater ground has a metre of visible/physical water margin');
  }
  assert.ok(wet > 1000, 'the containment test samples the real river floor');
}
checkWaterMargin(L.water);
assert.throws(() => checkWaterMargin({ ...L.water, contains: (x, z) => Math.abs(z - L.water.riverZ(x)) < 5 }), /water margin/, 'negative control rejects an undersized water strip');
console.log('saint-river-bank-check: protected crossing ground/splat, continuous outer bank/grade, opposing bays and sampled water margin; maximum cutoff delta ' + maximumEdgeDifference.toExponential(2) + 'm');
