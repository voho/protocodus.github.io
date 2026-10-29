// Run: node tests/shadow-install-benchmark.mjs /path/to/baseline-terrain.js
// Diagnostic CPU timings only; no hardware-dependent pass threshold.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { TERRAIN } from '../js/config.js';

const baselinePath = process.argv[2];
assert.ok(baselinePath, 'pass the baseline terrain.js file path');
const [baselineSource, currentSource] = await Promise.all([
  readFile(baselinePath, 'utf8'), readFile(new URL('../js/terrain.js', import.meta.url), 'utf8'),
]);
function runner(source) {
  const start = source.indexOf('  function installShadowRegion(');
  const end = source.indexOf('\n  function publishShadowCache()', start);
  assert.ok(start >= 0 && end > start, 'extract the actual terrain installer');
  const spec = TERRAIN.shade;
  const shadeTileSamples = spec.tileSamples;
  const shadePageSamplesX = shadeTileSamples * spec.tileGrid;
  const shadePageSamplesZ = shadeTileSamples * (spec.tileGrid + spec.tileGridAhead);
  const shadeLayerSamplesX = shadePageSamplesX + 2, shadeLayerSamplesZ = shadePageSamplesZ + 2;
  const shadeDirectionCols = spec.directionGrid[0];
  const shadeAtlasWidth = shadeLayerSamplesX * shadeDirectionCols;
  const shadeAtlasHeight = shadeLayerSamplesZ * spec.directionGrid[1];
  const state = {
    shadeTileSamples, shadePageSamplesX, shadePageSamplesZ, shadeLayerSamplesX,
    shadeLayerSamplesZ, shadeDirectionCols, shadeDirections: spec.directions, shadeAtlasWidth,
    shadeAtlasData: new Uint16Array(shadeAtlasWidth * shadeAtlasHeight * 2),
    shadeHeightData: new Uint16Array(shadePageSamplesX * shadePageSamplesZ),
    slotTileX: new Int32Array(spec.tileGrid * (spec.tileGrid + spec.tileGridAhead)),
    slotTileZ: new Int32Array(spec.tileGrid * (spec.tileGrid + spec.tileGridAhead)),
  };
  const body = [
    'const { ' + Object.keys(state).join(', ') + ' } = state;',
    'const mod = (v, n) => ((v % n) + n) % n;',
    'const slotIndex = (x, z) => mod(z, ' + (spec.tileGrid + spec.tileGridAhead) + ') * ' + spec.tileGrid + ' + mod(x, ' + spec.tileGrid + ');',
    'const copyRG = (src, i, dst, j) => { dst[j] = src[i]; dst[j + 1] = src[i + 1]; };',
    'const refreshShadeGutters = () => {};',
    'const uploadShadeAtlas = () => {};',
    'const shadeHeightTexture = { needsUpdate: false };',
    source.slice(start, end),
    'return installShadowRegion;',
  ].join('\n');
  return { install: new Function('state', body)(state), state };
}
function region(originTileX, originTileZ, tilesX, tilesZ) {
  const width = tilesX * TERRAIN.shade.tileSamples, height = tilesZ * TERRAIN.shade.tileSamples;
  return { originTileX, originTileZ, tilesX, tilesZ, width, height,
    ground: Uint16Array.from({ length: width * height }, (_, i) => (i * 7 + 37) & 65535),
    horizon: Uint16Array.from({ length: TERRAIN.shade.directions * width * height * 2 },
      (_, i) => (i * 13 + 17) & 65535),
  };
}
const before = runner(baselineSource), after = runner(currentSource);
const scenarios = [
  { name: 'one incoming tile', regions: [region(-2, -4, 1, 1)] },
  { name: 'incoming row: five individual tile installs',
    regions: Array.from({ length: 5 }, (_, x) => region(x - 2, -4, 1, 1)) },
  { name: 'opening 5x6 region', regions: [region(-2, -3, 5, 6)] },
];
const elapsed = (fn, count) => {
  const start = performance.now();
  for (let i = 0; i < count; i++) fn();
  return performance.now() - start;
};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = [];
for (const scenario of scenarios) {
  const runBefore = () => { for (const r of scenario.regions) before.install(r, false); };
  const runAfter = () => { for (const r of scenario.regions) after.install(r, false); };
  for (let i = 0; i < 10; i++) { runBefore(); runAfter(); }
  let iterations = 1;
  while (iterations < 2048 && elapsed(runBefore, iterations) < 25) iterations *= 2;
  const baselineMs = [], currentMs = [];
  for (let trial = 0; trial < 7; trial++) {
    const baseline = () => baselineMs.push(elapsed(runBefore, iterations) / iterations);
    const current = () => currentMs.push(elapsed(runAfter, iterations) / iterations);
    if (trial % 2) { current(); baseline(); } else { baseline(); current(); }
  }
  for (const key of ['shadeAtlasData', 'shadeHeightData', 'slotTileX', 'slotTileZ']) {
    assert.deepEqual(after.state[key], before.state[key], scenario.name + ': ' + key);
  }
  const baselineMedian = median(baselineMs), currentMedian = median(currentMs);
  results.push({ name: scenario.name, installsPerBatch: scenario.regions.length, iterations,
    baselineMsPerBatch: baselineMedian, currentMsPerBatch: currentMedian,
    changePercent: (currentMedian / baselineMedian - 1) * 100,
    baselineTrials: baselineMs, currentTrials: currentMs });
}
console.log(JSON.stringify({ benchmark: 'terrain shadow payload installation CPU',
  node: process.version, baselinePath,
  scope: 'actual installer with current terrain dimensions; deferred publication', results }, null, 2));
