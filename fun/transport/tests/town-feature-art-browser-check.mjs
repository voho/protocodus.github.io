// The shipped recent town features are authored imagegen cutouts. Native code
// is an emergency fallback, covered separately by native-building-scale tests.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-town-feature-art-qa';
await mkdir(output, { recursive: true });
const errors = [], cells = [], profiles = [], calibrations = [];
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('tools/sprite-scale-gallery.html', base).href);
    await page.evaluate(() => window.spriteScaleGalleryReady);
    assert.deepEqual(await page.evaluate(() => spriteScaleGallery.stats().errors), [], 'current authored sheets load without fallback errors');

    if (dpr === 1) {
      const integrity = await page.evaluate(async () => {
        const [{ drawTownFeature, TOWN_FEATURE_KINDS }, { BUILDINGS }, { RASTER_BUILDING_FAMILIES }, { SPRITE_SCALE, featureMasterPixels, featureWorldPixels }] = await Promise.all([
          import('../town-feature-sprites.js'), import('../buildings.js'), import('../raster-buildings.js'), import('../sprite-art-direction.js'),
        ]);
        const make = size => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = size; return canvas; };
        const decode = async src => { const image = new Image(); image.src = new URL(`../${src}`, location.href).href; await image.decode(); return image; };
        const json = async src => { const response = await fetch(new URL(`../${src}`, location.href)); if (!response.ok) throw Error(`Missing provenance: ${src}`); return response.json(); };
        const order = RASTER_BUILDING_FAMILIES['buildings-town-features'];
        if (order.length !== 12 || order[11] !== null || order.slice(0, 11).join() !== TOWN_FEATURE_KINDS.join()) throw Error('Runtime town-feature order differs from the authored sheet');
        const records = [], calibration = [];
        for (const biome of ['taiga', 'tundra', 'desert']) {
          const folder = `assets/world/buildings-town-features/${biome}`;
          const [meta, generation] = await Promise.all([json(`${folder}/atlas.json`), json(`${folder}/generation-2026-10-06.json`)]);
          if (generation.generator !== 'image_gen.imagegen') throw Error(`${biome} lost its generated art provenance`);
          const source = await decode(`${folder}/source-generated-2026-10-06.png`);
          if (source.naturalWidth < 1024 || source.naturalHeight < 768) throw Error(`${biome} is missing the retained full-resolution source`);
          if (meta.columns !== 4 || meta.rows !== 3 || meta.mipSharpening !== false) throw Error(`${biome} lost its isolated, simplified atlas registration`);
          if (meta.order.join() !== order.map(kind => kind ? `civic:${kind}:${biome}` : null).join()) throw Error(`${biome} has an incorrect atlas identity order`);
          for (let index = 0; index < 11; index++) {
            const kind = order[index], footprint = BUILDINGS[kind].footprint;
            const registered = meta.physicalCalibration.cells[index], tier = meta.physicalCalibration.tiers[footprint];
            if (registered.footprint !== footprint || registered.contactAnchor.join() !== '128,244') throw Error(`${kind}/${biome} lost its physical parcel registration`);
            const target = featureMasterPixels(SPRITE_SCALE.doorHeightMetres, footprint);
            if (Math.abs(tier.targetDoorMasterPixels - target) > 1e-9) throw Error(`${kind}/${biome} personnel doors no longer cancel the footprint transform`);
            calibration.push({ biome, kind, footprint, tileMetres: SPRITE_SCALE.tileMetres, doorMasterPixels: tier.targetDoorMasterPixels, doorWorldPixels: tier.targetDoorMasterPixels * 48 * footprint / 256, expectedDoorWorldPixels: featureWorldPixels(SPRITE_SCALE.doorHeightMetres) });
          }
          for (const size of [16, 32, 64, 128, 256]) {
            const sheet = await decode(`${folder}/atlas-${size}.png`);
            if (sheet.naturalWidth !== size * 4 || sheet.naturalHeight !== size * 3) throw Error(`Bad ${biome}/${size} sheet dimensions`);
            for (let index = 0; index < 12; index++) {
              const kind = order[index], actual = make(size), c = actual.getContext('2d', { willReadFrequently: true });
              c.drawImage(sheet, index % 4 * size, Math.floor(index / 4) * size, size, size, 0, 0, size, size);
              const pixels = c.getImageData(0, 0, size, size).data;
              let ink = 0, edge = 0, edgeAlphaMax = 0, anyAlpha = 0;
              for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                const alpha = pixels[(y * size + x) * 4 + 3], boundary = !x || !y || x === size - 1 || y === size - 1;
                if (alpha) anyAlpha++;
                if (alpha > 16) { ink++; if (boundary) edge++; }
                if (boundary) edgeAlphaMax = Math.max(edgeAlphaMax, alpha);
              }
              let fallbackDifferentPixels = null;
              if (kind && size === 256) {
                const native = make(size), nc = native.getContext('2d', { willReadFrequently: true });
                nc.scale(size / 32, size / 32); drawTownFeature(nc, kind, biome, 'detail');
                const fallback = nc.getImageData(0, 0, size, size).data;
                fallbackDifferentPixels = 0;
                for (let pixel = 0; pixel < pixels.length; pixel += 4) {
                  if (pixels[pixel + 3] <= 16 && fallback[pixel + 3] <= 16) continue;
                  if ([0, 1, 2, 3].some(channel => Math.abs(pixels[pixel + channel] - fallback[pixel + channel]) > 24)) fallbackDifferentPixels++;
                }
              }
              records.push({ biome, size, kind, ink, edge, edgeAlphaMax, anyAlpha, fallbackDifferentPixels });
            }
          }
        }
        return { records, calibration };
      });
      cells.push(...integrity.records); calibrations.push(...integrity.calibration);
    }

    for (const biome of ['taiga', 'tundra', 'desert']) for (const zoom of [.5, 1, 2]) {
      const result = await page.evaluate(({ biome, zoom }) => {
        const before = spriteScaleGallery.stats().rasterizedEntries;
        const rows = spriteScaleGallery.show({ family: 'features', biome, zoom });
        const after = spriteScaleGallery.stats().rasterizedEntries;
        return rows.map(row => ({ ...row, authoredDraws: (after[`civic:${row.kind}:${biome}`] || 0) - (before[`civic:${row.kind}:${biome}`] || 0) }));
      }, { biome, zoom });
      assert.equal(result.length, 11, 'every recent town feature reaches the production sprite path');
      for (const row of result) {
        const label = `${row.kind}/${biome}/zoom${zoom}/DPR${dpr}`;
        assert.equal(row.ready, true, `${label} has its authored art loaded`);
        assert.equal(row.authoredDraws, 1, `${label} draws the correct climate raster rather than a native fallback`);
        assert.equal(row.width, row.expectedWidth, `${label} retains its physical parcel width`);
        assert.equal(row.height, row.expectedHeight, `${label} retains its full sprite envelope`);
        assert.ok(row.ink > 0, `${label} remains visible at actual game size`);
        assert.equal(row.edge, 0, `${label} is unclipped and isolated`);
      }
      profiles.push(...result);
      if (dpr === 1 && (zoom !== 2 || biome === 'taiga')) await page.screenshot({ path: `${output}/${biome}-zoom${zoom}-dpr${dpr}.png`, fullPage: true });
      else if (dpr === 2 && biome === 'taiga' && zoom === .5) await page.screenshot({ path: `${output}/${biome}-zoom${zoom}-dpr${dpr}.png`, fullPage: true });
    }
    await context.close();
  }

  assert.equal(cells.filter(row => row.kind).length, 165, '33 climate identities have all five authored densities');
  assert.equal(cells.filter(row => !row.kind).length, 15, 'each sheet retains one transparent unused cell');
  for (const row of cells) {
    const label = `${row.kind || 'empty'}/${row.biome}/${row.size}`;
    if (!row.kind) assert.equal(row.anyAlpha, 0, `${label} is fully transparent`);
    else {
      assert.ok(row.ink > 0, `${label} contains authored artwork`);
      if (row.size === 16) assert.ok(row.edgeAlphaMax <= 64, `${label} contains no opaque clipped body on its mip boundary`);
      else assert.equal(row.edge, 0, `${label} preserves transparent gutters`);
      if (row.size === 256) assert.ok(row.fallbackDifferentPixels > 256, `${label} preserves generated artwork distinct from procedural fallback`);
    }
  }
  assert.equal(calibrations.length, 33);
  assert.ok(calibrations.every(row => row.tileMetres === 16 && Math.abs(row.doorWorldPixels - row.expectedDoorWorldPixels) < 1e-9), 'human scale stays independent of parcel size in all climate metadata');
  assert.equal(profiles.length, 198, '33 authored identities render at three zooms and two display densities');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ cells, profiles, calibrations, errors }, null, 2));
  console.log(JSON.stringify({ authoredClimateFeatures: calibrations.length, occupiedDensityCells: cells.filter(row => row.kind).length, runtimeProfiles: profiles.length, generatedMastersDistinctFromNative: cells.filter(row => row.fallbackDifferentPixels > 256).length, errors, screenshots: output }, null, 2));
} finally { await browser.close(); }
