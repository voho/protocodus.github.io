import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { featureMasterPixels, SPRITE_SCALE } from '../sprite-art-direction.js';

const requests = [];
globalThis.Image = class {
  set src(url) {
    this.url = url;
    const bytes = readFileSync(new URL(url));
    this.naturalWidth = bytes.readUInt32BE(16); this.naturalHeight = bytes.readUInt32BE(20);
    requests.push(this);
  }
  get src() { return this.url; }
  decode() { return Promise.resolve(); }
};
const finish = async () => {
  for (const image of requests.filter(image => !image.done)) { image.done = true; image.onload(); }
  for (let n = 0; n < 4; n++) await new Promise(resolve => setImmediate(resolve));
};
const art = await import('../atlas-runtime.js');
const industries = await import('../raster-industries.js');

test('compact factory artwork loads on demand only at its separately authored three-tile extent', async () => {
  const startup = art.preloadWorldArt({ cells: [16, 32, 64], waitMs: 1000 });
  assert.ok(requests.every(image => !image.url.includes('/compact-equipment-factory/')), 'current worlds do not download a legacy-only sheet');
  await finish(); await startup;
  const draws = [], c = { save() {}, restore() {}, translate() {}, scale() {}, drawImage(image, sx, sy, sw, sh, x, y, width, height) { draws.push({ url: image.url, width, height }); } };
  assert.equal(industries.hasRasterIndustry('equipment-factory', 'tundra', 3), false);
  assert.equal(industries.drawRasterIndustry(c, 'equipment-factory', 'tundra', 1, { footprint: 3 }), false, 'missing compact pixels leave the native fallback available');
  assert.ok(requests.some(image => image.url.includes('/compact-equipment-factory/')), 'only a compact draw requests its authored source');
  await finish();
  assert.equal(industries.hasRasterIndustry('equipment-factory', 'tundra', 3), true);
  assert.equal(industries.drawRasterIndustry(c, 'equipment-factory', 'tundra', 1, { footprint: 3 }), true);
  assert.match(draws.at(-1).url, /compact-equipment-factory/);
  assert.deepEqual([draws.at(-1).width, draws.at(-1).height], [96, 96], 'three tiles retain their own calibrated canvas extent');
  for (const footprint of [1, 2, 4]) assert.equal(industries.drawRasterIndustry(c, 'equipment-factory', 'tundra', 1, { footprint }), false, 'other historical extents cannot resize this painting');
  assert.equal(industries.drawRasterIndustry(c, 'equipment-factory', 'tundra'), true);
  assert.match(draws.at(-1).url, /industries-3/);
  assert.deepEqual([draws.at(-1).width, draws.at(-1).height], [160, 160], 'the current factory retains its original five-tile painting');
  assert.equal(industries.hasRasterIndustry('fishery', 'tundra', 3), false, 'unrelated identities retain their own fallback');
});

test('compact factory keeps observed source camera, ordinary-door scale and complete transparent pixels', () => {
  const directory = new URL('../assets/world/plot-buildings-v2/compact-equipment-factory/', import.meta.url);
  const meta = JSON.parse(readFileSync(new URL('atlas.json', directory))), entry = meta.sprites[0], measured = entry.measuredGeometry;
  assert.equal(entry.footprint, 3);
  assert.ok(measured.groundEdgeSlopesMeasured.some(value => value > 0) && measured.groundEdgeSlopesMeasured.some(value => value < 0));
  for (const slope of measured.groundEdgeSlopesMeasured) assert.ok(Math.abs(Math.abs(slope) - .5) < .03, 'observed original edges follow the shared camera');
  const expected = featureMasterPixels(SPRITE_SCALE.doorHeightMetres, 3);
  assert.ok(Math.abs(measured.personnelDoorHeightMasterMeasured / expected - 1) < .05, 'independently visible ordinary door retains human scale');
  assert.deepEqual(measured.groundCenterMasterMeasured, [128, 192]);
  assert.equal(entry.registrationPlan.clipping.clippedNonNoiseSourcePixels, 0);
  assert.ok(entry.masterAlpha.minimumFilteringGutterPixels >= 2);
  assert.equal(createHash('sha256').update(readFileSync(new URL(meta.source, directory))).digest('hex'), meta.sourceSha256, 'retained original source matches the packing record');
  for (const output of Object.values(meta.outputs)) assert.equal(createHash('sha256').update(readFileSync(new URL(output.path, directory))).digest('hex'), output.sha256);
});
