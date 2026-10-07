import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Decode dimensions from the actual exported files. Completion stays under the
// test's control so startup, fallback draws and late cache publication are visible.
const requests = [];
globalThis.Image = class {
  set src(url) {
    this.url = url;
    const png = readFileSync(new URL(url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    this.naturalWidth = png.readUInt32BE(16);
    this.naturalHeight = png.readUInt32BE(20);
    requests.push(this);
  }
  get src() { return this.url; }
  decode() { return Promise.resolve(); }
};
const finish = async () => {
  for (const image of requests.filter(image => !image.done)) { image.done = true; image.onload(); }
  for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve));
};
const context = () => ({
  draws: [], save() {}, restore() {}, translate() {}, scale() {},
  drawImage(image, sx, sy, sw, sh, x, y, w, h) { this.draws.push({ image, url: image.src, source: [sx, sy, sw, sh], cell: sw, width: w, height: h }); },
});
const art = await import('../atlas-runtime.js');
const industries = await import('../raster-industries.js');
const identities = industries.RASTER_INDUSTRY_IDS.map(id => { const [, kind, biome] = id.split(':'); return { kind, biome }; });

test('industries and separately calibrated farm cores load 512px artwork only when a dense view needs it', async () => {
  const startup = art.preloadWorldArt({ cells: art.startupArtCells(2), waitMs: 1000 });
  assert.ok(requests.length > 0);
  assert.ok(requests.every(image => !/atlas-(256|512)\.png$/.test(image.url)), 'startup does not fetch large industry artwork');
  await finish();
  assert.equal(await startup, true);
  const c = context();
  for (const { kind, biome } of identities) industries.drawRasterIndustry(c, kind, biome, 1.5);
  assert.ok(c.draws.every(draw => draw.cell === 128), 'loaded startup art stands in for native-density artwork');
  await finish();
  const baseline = art.worldArtRevision();
  c.draws.length = 0;
  for (let repeat = 0; repeat < 2; repeat++) for (const { kind, biome } of identities) industries.drawRasterIndustry(c, kind, biome, 3);
  assert.ok(c.draws.every(draw => draw.cell === 256), 'the established authored level stands in while denser art loads');
  const denseRequests = requests.filter(image => /atlas-512\.png$/.test(image.url));
  assert.equal(denseRequests.length, 4, 'all eligible climates share four neutral industry sheets');
  assert.equal(new Set(denseRequests.map(image => image.url)).size, 4);
  assert.ok(denseRequests.every(image => /plot-buildings-v2\/industries-[1-4]\//.test(image.url)), 'drawing whole industries does not fetch separate farm-core or historical artwork');
  await finish();
  assert.ok(art.worldArtRevision() > baseline, 'late dense artwork refreshes prepared sprite and scene caches');
  for (const [density, expected] of [[1.5, 256], [1.875, 512], [2.25, 512], [3, 512], [6, 512]]) {
    c.draws.length = 0;
    for (const { kind, biome } of identities) assert.equal(industries.drawRasterIndustry(c, kind, biome, density), true);
    assert.equal(c.draws.length, identities.length);
    assert.ok(c.draws.every(draw => draw.cell === expected && draw.width === 160 && draw.height === 160), `density ${density} retains the same five-tile envelope at its best authored level`);
    const byKind = new Map();
    identities.forEach(({ kind }, index) => {
      const draw = c.draws[index], other = byKind.get(kind);
      if (other) {
        assert.equal(draw.image, other.image, `${kind}: climate aliases share the same decoded density`);
        assert.deepEqual(draw.source, other.source, `${kind}: climate aliases retain the same atlas crop`);
      } else byKind.set(kind, draw);
    });
  }
  c.draws.length = 0;
  for (const biome of ['taiga', 'desert']) industries.drawRasterFarmCore(c, 'farm', biome, 9);
  await finish();
  c.draws.length = 0;
  for (const biome of ['taiga', 'desert']) assert.equal(industries.drawRasterFarmCore(c, 'farm', biome, 9), true);
  assert.ok(c.draws.every(draw => draw.cell === 512 && draw.width === 64 && draw.height === 64), 'a sharper two-tile core retains its calibrated world envelope');
  const coreRequests = requests.filter(image => image.url.includes('plot-buildings-v2/farm-cores/') && /atlas-512\.png$/.test(image.url));
  assert.equal(coreRequests.length, 1, 'every eligible climate shares one dense core sheet');
  assert.equal(c.draws[0].image, c.draws[1].image, 'farm-core climate aliases reuse their decoded RGBA image');
  assert.deepEqual(c.draws[0].source, c.draws[1].source);
  assert.equal(art.worldArtStats().atlases, 5, 'four industry sheets and one separately calibrated core sheet');
  const sumSquares = cells => cells.reduce((sum, cell) => sum + cell * cell, 0);
  const industryBytes = (3 * 9 + 1) * 4 * sumSquares([16, 32, 64, 128, 256, 512]);
  const coreBytes = 6 * 4 * sumSquares([16, 32, 64, 128, 512]);
  assert.equal(art.worldArtStats().decodedBytes, industryBytes + coreBytes, 'decoded-memory accounting counts neutral images once, not once per alias');
});

test('the neutral registry retains every eligible industry and farm-core identity', async () => {
  const { INDUSTRIES } = await import('../data.js');
  const ids = prefix => Object.entries(INDUSTRIES).filter(([, entry]) => prefix === 'industry' || entry.farming).flatMap(([kind, entry]) => entry.biomes.map(biome => `${prefix}:${kind}:${biome}`)).sort();
  assert.deepEqual([...industries.RASTER_INDUSTRY_IDS].sort(), ids('industry'));
  assert.deepEqual([...industries.RASTER_FARM_CORE_IDS].sort(), ids('farm-core'));
  assert.equal(industries.RASTER_INDUSTRY_IDS.length, 47);
  assert.equal(industries.RASTER_FARM_CORE_IDS.length, 10);
});
