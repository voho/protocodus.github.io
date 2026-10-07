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
  drawImage(image, sx, sy, sw, sh, x, y, w, h) { this.draws.push({ url: image.src, cell: sw, width: w, height: h }); },
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
  assert.equal(denseRequests.length, 8, 'each industry family shares a single 512px request');
  assert.equal(new Set(denseRequests.map(image => image.url)).size, 8);
  assert.ok(denseRequests.every(image => !image.url.includes('farm-cores-v1')), 'drawing whole industries does not fetch separate farm-core artwork');
  await finish();
  assert.ok(art.worldArtRevision() > baseline, 'late dense artwork refreshes prepared sprite and scene caches');
  for (const [density, expected] of [[1.5, 256], [1.875, 512], [2.25, 512], [3, 512], [6, 512]]) {
    c.draws.length = 0;
    for (const { kind, biome } of identities) assert.equal(industries.drawRasterIndustry(c, kind, biome, density), true);
    assert.equal(c.draws.length, identities.length);
    assert.ok(c.draws.every(draw => draw.cell === expected && draw.width === 160 && draw.height === 160), `density ${density} retains the same five-tile envelope at its best authored level`);
  }
  c.draws.length = 0;
  for (const biome of ['taiga', 'desert']) industries.drawRasterFarmCore(c, 'farm', biome, 9);
  await finish();
  c.draws.length = 0;
  for (const biome of ['taiga', 'desert']) assert.equal(industries.drawRasterFarmCore(c, 'farm', biome, 9), true);
  assert.ok(c.draws.every(draw => draw.cell === 512 && draw.width === 64 && draw.height === 64), 'a sharper two-tile core retains its calibrated world envelope');
  const coreRequests = requests.filter(image => image.url.includes('farm-cores-v1') && /atlas-512\.png$/.test(image.url));
  assert.equal(coreRequests.length, 2, 'each eligible climate shares one dense core sheet');
  assert.equal(new Set(coreRequests.map(image => image.url)).size, 2, 'repeated core draws reuse the decoded dense sheet');
});
