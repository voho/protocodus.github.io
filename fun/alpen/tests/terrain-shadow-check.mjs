// Run from the game directory: node tests/terrain-shadow-check.mjs
import assert from 'node:assert/strict';
import { buildShadowTile, buildShadowTiles, toHalfFloat } from '../js/shadow-cache.js';
import { heightAt, drawnHeightAt, corridorHalfAt, centersAt, chapterNameAt,
  guideAt, wanderAt } from '../js/terrain.js';
import { setWorldSeed } from '../js/noise.js';

function fromHalf(h) {
  const sign = h & 0x8000 ? -1 : 1;
  const exponent = (h >> 10) & 31;
  const fraction = h & 1023;
  return sign * (exponent === 0 ? fraction * 2 ** -24
    : (1 + fraction / 1024) * 2 ** (exponent - 15));
}
const spec = { tileSamples: 8, spacing: 3, directions: 9,
  azimuth: [0.25, 2.05], steps: [0.9, 2.1, 4.3, 9.6, 20.4, 41.7],
  raise: 14, gradeBase: 0.28, originTileX: -2, originTileZ: -3 };
const plane = (x, z) => 0.12 * x + 0.28 * z + 5;
const result = buildShadowTile(spec, plane);
for (let d = 0; d < spec.directions; d++) {
  const angle = spec.azimuth[0] + d / (spec.directions - 1)
    * (spec.azimuth[1] - spec.azimuth[0]);
  const slope = 0.12 * Math.sin(angle) - 0.28 * Math.cos(angle);
  for (let p = 0; p < spec.tileSamples ** 2; p++) {
    const index = (d * spec.tileSamples ** 2 + p) * 2;
    assert.ok(Math.abs(fromHalf(result.horizon[index]) - slope) < 0.0003,
      'A plane must keep its analytical slope at every sun bearing');
    assert.ok(Math.abs(fromHalf(result.horizon[index + 1])
      - (slope - spec.raise / spec.steps.at(-1))) < 0.0006,
    'Raised receivers must clear the same horizon geometrically');
  }
}
assert.equal(toHalfFloat(2 ** -24), 1);

setWorldSeed('alpen-check');
const tiles = [{ x: -2, z: -3 }, { x: -1, z: -3 },
  { x: -2, z: -2 }, { x: -1, z: -2 }, { x: 0, z: -2 }];
let individualSamples = 0;
let batchSamples = 0;
const separate = tiles.map((tile) => buildShadowTile({ ...spec,
  originTileX: tile.x, originTileZ: tile.z }, (x, z) => {
  individualSamples++;
  return heightAt(x, z);
}));
const batch = buildShadowTiles(spec, tiles, (x, z) => {
  batchSamples++;
  return heightAt(x, z);
});
for (const value of batch) {
  const i = tiles.findIndex((tile) => tile.x === value.tile.x && tile.z === value.tile.z);
  assert.deepEqual(value.horizon, separate[i].horizon, 'No horizon seam at a batch boundary');
  assert.deepEqual(value.ground, separate[i].ground, 'No ground seam at a batch boundary');
}
assert.ok(batchSamples < individualSamples * 0.7, 'Adjacent tiles must share their height halo');

let maxShoulderSlopeJump = 0;
const chapters = new Set();
for (const seed of ['alpen-check', 'fresh-powder', 73291]) {
  setWorldSeed(seed);
  for (let z = -10; z > -12000; z -= 19.37) {
    chapters.add(chapterNameAt(z));
    const half = corridorHalfAt(z);
    const center = centersAt(z)[0];
    for (const x of [guideAt(z), center - half, center + half, wanderAt(z)]) {
      const h = heightAt(x, z);
      assert.ok(Number.isFinite(h) && Number.isFinite(drawnHeightAt(x, z)));
      assert.equal(heightAt(x, z), h, 'Repeated samples must be deterministic');
      const epsilon = 0.0001;
      assert.ok(Math.abs(heightAt(x + epsilon, z) - heightAt(x - epsilon, z)) < 0.01,
        'Terrain must not step vertically across shoulders or fork midpoints');
    }
    const edge = center - half;
    const e = 0.001;
    const h = heightAt(edge, z);
    const left = (h - heightAt(edge - e, z)) / e;
    const right = (heightAt(edge + e, z) - h) / e;
    maxShoulderSlopeJump = Math.max(maxShoulderSlopeJump, Math.abs(right - left));
  }
}
assert.ok(maxShoulderSlopeJump < 0.025, `Shoulders must be smooth: ${maxShoulderSlopeJump}`);
assert.equal(chapters.size, 5, 'Long descents must retain all five terrain chapters');
setWorldSeed('alpen-check');
const original = heightAt(12.7, -719.2);
setWorldSeed('fresh-powder');
assert.notEqual(heightAt(12.7, -719.2), original, 'Seeds must change the mountain');
setWorldSeed('alpen-check');
assert.equal(heightAt(12.7, -719.2), original, 'Restoring a seed must restore its mountain');
console.log(`Terrain/shadow checks passed; shared tile halos use ${batchSamples}/${individualSamples} height samples; max shoulder slope jump ${maxShoulderSlopeJump.toFixed(5)}.`);
