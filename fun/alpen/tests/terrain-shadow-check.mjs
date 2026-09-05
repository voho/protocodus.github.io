// Run from the game directory: node tests/terrain-shadow-check.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { buildShadowTile, buildShadowTiles, toHalfFloat } from '../js/shadow-cache.js';
import { heightAt, drawnHeightAt, corridorHalfAt, centersAt, chapterNameAt,
  guideAt, wanderAt } from '../js/terrain.js';
import { setWorldSeed } from '../js/noise.js';
import { createShading } from '../js/shading.js';

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

// A shoulder several hundred metres away must still hide a low sun. The
// coarse extension shares the near atlas and must keep its global tile seams.
const farSpec = { ...spec, farSteps: [80, 120, 180], farSpacing: 12 };
const farBatch = buildShadowTiles(farSpec, tiles, heightAt);
for (let i = 0; i < tiles.length; i++) {
  const tile = tiles[i];
  const single = buildShadowTile({ ...farSpec,
    originTileX: tile.x, originTileZ: tile.z }, heightAt);
  assert.deepEqual(farBatch[i].horizon, single.horizon, 'Long rays remain seamless');
  assert.deepEqual(farBatch[i].ground, single.ground, 'Far terrain cannot alter receivers');
}
const hillSpec = { ...farSpec, directions: 1, azimuth: [Math.PI / 2, Math.PI / 2],
  originTileX: 0, originTileZ: 0 };
const remoteHill = (x, z) => 0.28 * z + 120 * Math.exp(-(((x - 120) / 22) ** 2));
const shortHorizon = buildShadowTile({ ...hillSpec, farSteps: [] }, remoteHill);
const longHorizon = buildShadowTile(hillSpec, remoteHill);
assert.ok(fromHalf(shortHorizon.horizon[0]) < 0.01, 'Near probes cannot see the remote summit');
assert.ok(fromHalf(longHorizon.horizon[0]) > 0.90, 'Far probes include the remote summit');
assert.ok(longHorizon.horizon[1] < longHorizon.horizon[0], 'Raised receivers clear more of the summit');
const farPlane = buildShadowTile(farSpec, plane);
for (let d = 0; d < spec.directions; d++) {
  const angle = spec.azimuth[0] + d / (spec.directions - 1)
    * (spec.azimuth[1] - spec.azimuth[0]);
  const slope = 0.12 * Math.sin(angle) - 0.28 * Math.cos(angle);
  const p = d * spec.tileSamples ** 2 * 2;
  assert.ok(Math.abs(fromHalf(farPlane.horizon[p]) - slope) < 0.0003);
  assert.ok(Math.abs(fromHalf(farPlane.horizon[p + 1])
    - (slope - spec.raise / farSpec.farSteps.at(-1))) < 0.0006);
}

let maxShoulderSlopeJump = 0;
let apronRelief = 0, apronAsymmetry = 0, apronSamples = 0, downhillSamples = 0;
const chapters = new Set();
for (const seed of ['alpen-check', 'fresh-powder', 73291]) {
  setWorldSeed(seed);
  for (let z = -10; z > -12000; z -= 19.37) {
    chapters.add(chapterNameAt(z));
    const half = corridorHalfAt(z);
    const midpoint = (centersAt(z)[0] + centersAt(z).at(-1)) * 0.5;
    const base = heightAt(wanderAt(z), z);
    const leftApron = heightAt(midpoint - 250, z) - base;
    const rightApron = heightAt(midpoint + 250, z) - base;
    apronRelief += leftApron + rightApron;
    apronAsymmetry += Math.abs(leftApron - rightApron);
    apronSamples++;
    const line = guideAt(z);
    const pitch = (heightAt(line, z + 0.35) - heightAt(line, z - 0.35)) / 0.7;
    downhillSamples += pitch > 0;
    assert.ok(half >= 15, 'Even a couloir keeps a broad usable piste');
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
assert.ok(apronRelief / (apronSamples * 2) < 90, 'Open shoulders must not become a tall canyon');
assert.ok(apronAsymmetry / apronSamples > 8, 'Opposite flanks must describe different mountains');
assert.ok(downhillSamples / apronSamples > 0.99, 'The easy guide line must keep descending');
setWorldSeed('alpen-check');
const original = heightAt(12.7, -719.2);
setWorldSeed('fresh-powder');
assert.notEqual(heightAt(12.7, -719.2), original, 'Seeds must change the mountain');
setWorldSeed('alpen-check');
assert.equal(heightAt(12.7, -719.2), original, 'Restoring a seed must restore its mountain');

// Exercise the real staged builder against fresh generator output. Private
// hooks stay in this check; shadow initialization is already covered above.
const terrainURL = new URL('../js/terrain.js', import.meta.url);
let terrainSource = await readFile(terrainURL, 'utf8');
terrainSource = terrainSource.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g,
  (_, quote, path) => `from ${quote}${new URL(path, terrainURL).href}${quote}`)
  .replaceAll('import.meta.url', JSON.stringify(terrainURL.href))
  .replace('    initializeShadowCache(x, z);\n    snapSnowReady();', '    snapSnowReady();')
  .replace('    mesh,\n    setSun,', `    mesh,
    checkCold(x, z) {
      heightsReady = false;
      fill(x, z, heightAt(x, z), positions, normals, colors, surface, groomFrame);
    },
    checkStream(x, z) {
      beginBuild(x, z, heightAt(x, z));
      while (build) advanceBuild();
    },
    checkInterrupt(x, z, stage) {
      beginBuild(x, z, heightAt(x, z));
      fillHeightRows(x, z, 0, stage ? vertsZ : 4);
      if (stage) fillSurfaceRows(x, z, build.ay, buildPositions, buildNormals,
        buildColors, buildSurface, buildGroomFrame, 0, 4);
      build.stage = stage;
      build.row = 4;
    },
    checkBuffers: () => [heights, positions, normals, colors, surface, groomFrame],
    checkReuse: () => [reusedHeights, reusedSurfaces],
    setSun,`);
const { createTerrain } = await import('data:text/javascript;base64,'
  + Buffer.from(terrainSource).toString('base64'));
const headlessTHREE = { ...THREE, TextureLoader: class {
  load(url, ready, progress, fail) { fail?.(); return new THREE.Texture(); }
} };
const makeTerrain = () => createTerrain(headlessTHREE, { apply: m => m, uniforms: {} });
const streamed = makeTerrain();
const cold = makeTerrain();
// A fogged fragment still supplies its neighbours' texture gradients. An
// early shader exit breaks those quads and can seed NaN into the HDR scene.
createShading(THREE).apply(streamed.mesh.material, { sheen: 1 });
const terrainShader = { ...THREE.ShaderLib.lambert, uniforms: {} };
streamed.mesh.material.onBeforeCompile(terrainShader);
const terrainMain = terrainShader.fragmentShader
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  .split('void main() {')[1];
const lastGradient = Math.max(...['dFdx(', 'dFdy(', 'fwidth(']
  .map(token => terrainMain.lastIndexOf(token)));
assert.ok(lastGradient > 0, 'exercise the terrain material texture gradients');
assert.doesNotMatch(terrainMain.slice(0, lastGradient), /\b(?:return|discard)\s*;/,
  'terrain fragments must stay alive until all screen derivatives are evaluated');
const fogExit = terrainMain.indexOf('return;');
assert.ok(fogExit > lastGradient, 'fully fogged terrain still skips material and lighting work');
assert.doesNotMatch(terrainMain.slice(fogExit), /\btexture2D\s*\(/,
  'custom texture reads after the fog exit use explicit gradients or a fixed mip level');
assert.equal(streamed.mesh.material.normalMap, null);
assert.equal(streamed.mesh.material.bumpMap, null,
  'terrain owns its smooth normal and has no built-in derivative normal maps');
const bufferNames = ['height', 'position', 'normal', 'color', 'surface', 'groom frame'];
let streamChecks = 0, heightHits = 0, surfaceHits = 0;
function compareTerrain(x, z, includeHeights = true) {
  cold.checkCold(x, z);
  const actual = streamed.checkBuffers(), expected = cold.checkBuffers();
  for (let i = includeHeights ? 0 : 1; i < expected.length; i++) {
    assert.deepEqual(actual[i], expected[i], `${bufferNames[i]} must match cold generation at ${x}, ${z}`);
  }
  streamChecks++;
}
for (const seed of ['alpen-check', 'fresh-powder', 73291]) {
  setWorldSeed(seed);
  streamed.reset(0, -396);
  compareTerrain(0, -396);
  for (const [x, z] of [[0, -402], [6, -408], [-6, -420], [0, -414], [18, -426],
    [0, -3600], [6, -3606], [-12, -3624], [0, -8004], [6, -8010], [0, -396]]) {
    streamed.checkStream(x, z);
    compareTerrain(x, z);
    const hits = streamed.checkReuse();
    heightHits += hits[0]; surfaceHits += hits[1];
  }
}
assert.ok(heightHits > streamed.vertexCount, 'Nearby anchors must reuse exact heights');
assert.ok(surfaceHits > streamed.vertexCount, 'Unchanged stencils must reuse surface attributes');
for (const stage of [0, 1]) {
  for (const restart of ['same anchor', 'moved anchor', 'new seed']) {
    setWorldSeed('alpen-check');
    streamed.reset(0, -396);
    streamed.checkInterrupt(6, -402, stage);
    if (restart === 'new seed') setWorldSeed('fresh-powder');
    const x = restart === 'moved anchor' ? -6 : 0;
    streamed.reset(x, -396);
    // A same-anchor restart can retain the live attributes while discarding
    // unfinished scratch heights. The next build must refresh those safely.
    compareTerrain(x, -396, restart !== 'same anchor');
    streamed.checkStream(0, -408);
    compareTerrain(0, -408);
  }
}
console.log(`Terrain/shadow checks passed; ${streamChecks} exact streaming/reset cases; shared tile halos use ${batchSamples}/${individualSamples} height samples; max shoulder slope jump ${maxShoulderSlopeJump.toFixed(5)}.`);
