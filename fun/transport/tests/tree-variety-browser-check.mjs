// The tree catalog is visual: published woodland geometry and saved companies
// must stay stable while every new identity is selectable at normal game sizes.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu } from './browser-start.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-tree-variety';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const errors = [], sheets = [], previews = [], cactusPreviews = [], forests = [];
// SHA-256 of the original 64 compositions for every published climate detail,
// captured from tree-sprites.js at main ab9bbf3 before adding visual identities.
// Coordinates use eight decimal places so Node and Chromium trig-library
// last-bit differences do not masquerade as changed woodland geometry.
const originalGeometry = {
  taiga: '746ab6f8c0436465a9be746428a987ac952b95720c288b712bf65b056df1945a',
  tundra: 'a13d3d246802c563de3885a6f11fb50c7d43afeb3fe02a163c3fb062210d4543',
  desert: '2995f33194c10fa5b32463eeb3421391d14564a9915e423084a3444033562dec',
};

async function harness(context) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/tree-variety-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0;background:#28342d;color:#f1edda;font:15px system-ui}h1{margin:12px;font-size:20px}#sheet{display:block}#world{display:none;width:1100px;height:720px}</style><h1></h1><canvas id="sheet"></canvas><canvas id="world"></canvas>' }));
  await page.goto(new URL('tree-variety-qa', base).href);
  await page.evaluate(async () => {
    const [sprites, assets, nature, catalog, native, terrain, shadows, renderer, model, saves] = await Promise.all([
      import('./sprites.js'), import('./atlas-runtime.js'), import('./raster-nature.js'), import('./tree-art-catalog.js'),
      import('./tree-sprites.js'), import('./terrain-sprites.js'), import('./tree-shadows.js'), import('./renderer.js'), import('./model.js'), import('./save-codec.js'),
    ]);
    const calls = [], treeBillboardDraws = [], treeCanvases = new WeakMap(), originalDraw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
      if (image instanceof HTMLImageElement && (image.src.includes('/nature-trees-') || image.src.includes('/nature-ground-desert/cacti/'))) {
        const m = this.getTransform(); calls.push({ src: image.src, args, transform: [m.a, m.b, m.c, m.d, m.e, m.f] });
        if (image.src.includes('/nature-trees-')) treeCanvases.set(this.canvas, { nativeScale: m.a });
      } else if (image instanceof HTMLCanvasElement && treeCanvases.has(image) && args.length === 4) {
        const { nativeScale } = treeCanvases.get(image);
        treeBillboardDraws.push({ sourceWidth: image.width, drawWidth: args[2], worldScale: args[2] / image.width * nativeScale });
      }
      return originalDraw.call(this, image, ...args);
    };
    const hashPixels = canvas => {
      let value = 2166136261;
      for (const byte of canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) value = Math.imul(value ^ byte, 16777619);
      return value >>> 0;
    };
    const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
    const decode = async path => { const image = new Image(); image.src = new URL(path, location.href).href; await image.decode(); return image; };
    const pixels = canvas => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0, transparent = 0, edgeAlpha = 0, left = canvas.width, right = -1, top = canvas.height, bottom = -1;
      const edges = [0, 0, 0, 0];
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const alpha = data[(y * canvas.width + x) * 4 + 3];
        if (!alpha) transparent++;
        if (alpha >= 32) { ink++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
        if (!x || !y || x === canvas.width - 1 || y === canvas.height - 1) edgeAlpha = Math.max(edgeAlpha, alpha);
        if (!y) edges[0] = Math.max(edges[0], alpha);
        if (x === canvas.width - 1) edges[1] = Math.max(edges[1], alpha);
        if (y === canvas.height - 1) edges[2] = Math.max(edges[2], alpha);
        if (!x) edges[3] = Math.max(edges[3], alpha);
      }
      return { ink, transparentFraction: transparent / (canvas.width * canvas.height), edgeAlpha, edgeAlphaTopRightBottomLeft: edges, bounds: [left, top, right, bottom], hash: hashPixels(canvas) };
    };
    const treeSheets = Object.entries(catalog.ORIGINAL_TREE_KINDS).flatMap(([biome, kinds]) => [
      { biome, name: 'original', directory: `./assets/world/nature-trees-${biome}`, kinds },
      ...[1, 2].map(number => ({ biome, name: `variety-${number}`, directory: `./assets/world/nature-trees-${biome}/variety-${number}`, kinds: catalog.treeArtSheet(biome, number).map(tree => tree.id) })),
      ...(biome === 'tundra' ? [{ biome, name: 'hollow', directory: './assets/world/nature-trees-tundra/hollow', kinds: catalog.HOLLOW_TREE_ART.map(tree => tree.id) }] : []),
    ]);
    const { SPRITE_SCALE } = await import('./sprite-art-direction.js');
    window.treeQA = { ...sprites, ...assets, ...nature, ...catalog, ...native, ...terrain, ...shadows, ...renderer, ...model, ...saves, calls, treeBillboardDraws, hashPixels, digest, decode, pixels, treeSheets, SPRITE_SCALE };
  });
  return page;
}

async function settle(page) {
  await page.evaluate(async () => {
    const q = treeQA;
    for (let pass = 0; pass < 100; pass++) {
      q.renderer.render(1000, { settle: true });
      if (!q.worldArtStats().loading && !q.renderer.getStats().sceneryBatches.pending) {
        q.renderer.render(1000, { settle: true }); return;
      }
      await new Promise(requestAnimationFrame);
    }
    throw Error('Tree artwork and scene caches did not settle');
  });
}

async function companyFingerprint(page) {
  return page.evaluate(async () => {
    const { encodeGame } = await import('./save-codec.js');
    const tiles = JSON.stringify(transport.game.tiles, (_, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
    const bytes = new TextEncoder().encode(tiles), tileHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    return { state: JSON.stringify(encodeGame(transport.game)), tileHash, generationVersion: transport.game.generationVersion };
  });
}

try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1150, height: 900 }, deviceScaleFactor: dpr });
    const page = await harness(context);
    await page.evaluate(async () => {
      const q = treeQA;
      await q.preloadWorldArt({ waitMs: 30000 });
      q.sheet = document.querySelector('#sheet'); q.canvas = document.querySelector('#world');
    });
    if (dpr === 1) {
      const integrity = await page.evaluate(async expectedGeometry => {
        const q = treeQA, records = [], geometry = [], calibration = [];
        const authoredHeights = new Map([...Object.values(q.EXTRA_TREE_ART).flat(), ...q.HOLLOW_TREE_ART, ...q.CACTUS_ART].map(art => [art.id, art.heightMetres]));
        const calibrated = async (directory, biome, sheet) => {
          const response = await fetch(`${directory}/generation.json`); if (!response.ok) throw Error(`Missing generation provenance: ${directory}`);
          const generation = await response.json();
          let registration = typeof generation.registration === 'object' ? generation.registration : null;
          if (generation.registration === 'registration.json') {
            const response = await fetch(`${directory}/registration.json`); if (!response.ok) throw Error(`Missing physical registration: ${directory}`); registration = await response.json();
          }
          const ppm = generation.scale?.normalizedMasterPixelsPerVerticalMetre ?? registration?.metrePixels ?? registration?.normalizedMasterPixelsPerMetre ?? generation.pixelsPerMetre;
          const expected = q.treeMasterPixels(1) * (sheet === 'cacti' ? q.TREE_ART_SCALE.nominalSpriteSize * q.TREE_ART_SCALE.cellSizeMultiplier / q.CACTUS_ART_SCALE.nominalSpriteSize : 1);
          const rootAnchor = generation.scale?.rootAnchor ?? registration?.rootAnchor ?? registration?.rootBaseline ?? generation.rootAnchor;
          if (!Number.isFinite(ppm) || Math.abs(ppm - expected) > 1e-9 || rootAnchor !== q.TREE_ART_SCALE.rootAnchor) throw Error(`Artwork registration differs from the shared physical scale: ${directory}`);
          const measurements = generation.measurements ?? registration?.sprites ?? generation.records;
          if (!measurements?.length) throw Error(`Missing measured source heights: ${directory}`);
          const heights = measurements.map(record => {
            const kind = record.id.split(':').at(-1), nominal = authoredHeights.get(kind);
            const actual = record.calibratedHeightMetres ?? record.measuredHeightMetres ?? record.registeredPlantHeightPixels / ppm;
            if (!nominal || !Number.isFinite(actual) || Math.abs(actual / nominal - 1) > .16) throw Error(`Uncalibrated physical height: ${directory}/${kind}`);
            return { kind, nominalMetres: nominal, measuredMetres: actual };
          });
          return { biome, sheet, pixelsPerMetre: ppm, rootAnchor, heights };
        };
        for (const biome of Object.keys(q.TREE_KINDS)) {
          const trees = q.TREE_KINDS[biome];
          const hollowCount = biome === 'tundra' ? q.HOLLOW_TREE_ART.length : 0;
          if (trees.length !== q.ORIGINAL_TREE_KINDS[biome].length * 3 + hollowCount) throw Error(`${biome} tree catalog is not tripled plus its hollow trees`);
          const layout = q.BIOME_NATURE[biome].trees.flatMap(detail => Array.from({ length: 64 }, (_, variant) => q.forestComposition(biome, detail, variant)));
          const geometryHash = await q.digest(JSON.stringify(layout, (_, value) => typeof value === 'number' && !Number.isInteger(value) ? Number(value.toFixed(8)) : value));
          if (geometryHash !== expectedGeometry[biome]) throw Error(`${biome} published tree geometry changed`);
          const selected = [...new Set(layout.flatMap(trees => trees.map(tree => q.rasterTreeIdentity(tree, biome))))].sort();
          const expected = trees.map(kind => `nature-trees-${biome}:${kind}`).sort();
          if (selected.join() !== expected.join()) throw Error(`${biome} new tree identity is unreachable in the published 64 woodland variants`);
          geometry.push({ biome, hash: geometryHash, variants: layout.length, selected });
          const speciesMasterHashes = [];
          for (const { directory, kinds, name } of q.treeSheets.filter(sheet => sheet.biome === biome)) {
            const response = await fetch(`${directory}/atlas.json`); if (!response.ok) throw Error(`Missing ${directory}/atlas.json`);
            const meta = await response.json();
            if (meta.order.join() !== kinds.map(kind => `nature-trees-${biome}:${kind}`).join()) throw Error(`Bad tree order in ${directory}`);
            const masterHashes = [];
            for (const size of [16, 32, 64, 128, 256]) {
              const image = await q.decode(`${directory}/atlas-${size}.png`);
              if (image.naturalWidth !== size * meta.columns || image.naturalHeight !== size * meta.rows) throw Error(`Bad tree atlas size: ${directory}/${size}`);
              for (const [index, kind] of kinds.entries()) {
                const cell = document.createElement('canvas'); cell.width = cell.height = size;
                cell.getContext('2d').drawImage(image, index % meta.columns * size, Math.floor(index / meta.columns) * size, size, size, 0, 0, size, size);
                const pixel = q.pixels(cell);
                if (!pixel.ink || pixel.transparentFraction < .1) throw Error(`Empty or opaque tree: ${biome}/${kind}/${size}`);
                if (size === 256 && pixel.edgeAlpha !== 0) throw Error(`Tree master touches its cell edge: ${biome}/${kind}`);
                // At16px, the95.5% root baseline is in the final pixel row.
                // Root/contact filtering there is valid; crowns and side
                // branches must retain their transparent gutters at every LOD.
                // The unchanged original atlases have12px master gutters, so
                // their16px mip can filter foliage into a side pixel. New art
                // promises wider gutters; enforce that on the added sheets.
                if (name !== 'original' && size < 256 && [0, 1, 3].some(edge => pixel.edgeAlphaTopRightBottomLeft[edge] >= 32)) throw Error(`Tree mip clips its crown or branches: ${biome}/${kind}/${size}`);
                if (size === 256) { masterHashes.push(pixel.hash); speciesMasterHashes.push(pixel.hash); }
                records.push({ biome, kind, sheet: name, size, ...pixel });
              }
            }
            if (new Set(masterHashes).size !== kinds.length) throw Error(`Duplicate exact tree master pixels in ${directory}`);
            if (name !== 'original') calibration.push(await calibrated(directory, biome, name));
          }
          if (new Set(speciesMasterHashes).size !== trees.length) throw Error(`Duplicate tree master pixels across ${biome} sheets`);
        }
        const directory = './assets/world/nature-ground-desert/cacti', response = await fetch(`${directory}/atlas.json`);
        if (!response.ok) throw Error('Missing cactus atlas metadata');
        const meta = await response.json();
        if (meta.order.join() !== q.CACTUS_ART.map(plant => `nature-ground-desert:${plant.id}`).join()) throw Error('Bad cactus atlas identity order');
        for (const size of [16, 32, 64, 128, 256]) {
          const image = await q.decode(`${directory}/atlas-${size}.png`), hashes = [];
          if (image.naturalWidth !== size * meta.columns || image.naturalHeight !== size * meta.rows) throw Error(`Bad cactus atlas size ${size}`);
          for (const [index, plant] of q.CACTUS_ART.entries()) {
            const cell = document.createElement('canvas'); cell.width = cell.height = size;
            cell.getContext('2d').drawImage(image, index % meta.columns * size, Math.floor(index / meta.columns) * size, size, size, 0, 0, size, size);
            const pixel = q.pixels(cell);
            if (!pixel.ink || pixel.transparentFraction < .1 || (size === 256 ? pixel.edgeAlpha !== 0 : [0, 1, 3].some(edge => pixel.edgeAlphaTopRightBottomLeft[edge] >= 32))) throw Error(`Missing, opaque or clipped cactus: ${plant.id}/${size}`);
            hashes.push(pixel.hash); records.push({ biome: 'desert', kind: plant.id, sheet: 'cacti', size, ...pixel });
          }
          if (new Set(hashes).size !== q.CACTUS_ART.length) throw Error(`Duplicate cactus pixels at density ${size}`);
        }
        calibration.push(await calibrated(directory, 'desert', 'cacti'));
        return { records, geometry, calibration };
      }, originalGeometry);
      sheets.push(...integrity.records);
      await writeFile(`${output}/geometry-and-calibration.json`, JSON.stringify({ geometry: integrity.geometry, calibration: integrity.calibration }, null, 2));
    }
    for (const biome of ['taiga', 'tundra', 'desert']) {
      for (const zoom of [.5, 1, 2]) {
        const profile = await page.evaluate(({ biome, zoom, dpr }) => {
          const q = treeQA, scale = zoom * dpr, view = zoom === .5 ? 'region' : zoom === 2 ? 'detail' : 'town';
          const sprite = q.createSprites(biome, { pixelScale: scale, detailLevel: view });
          const cw = 126, ch = 132, sheet = q.sheet, kinds = q.TREE_KINDS[biome];
          sheet.style.display = 'block'; q.canvas.style.display = 'none';
          const rows = Math.ceil(kinds.length / 9);
          sheet.width = cw * 9 * dpr; sheet.height = ch * rows * dpr; sheet.style.width = `${cw * 9}px`; sheet.style.height = `${ch * rows}px`;
          document.querySelector('h1').textContent = `${biome}: ${kinds.length} individual trees at ${view} size, DPR ${dpr}`;
          const c = sheet.getContext('2d'); c.scale(dpr, dpr); c.fillStyle = '#344638'; c.fillRect(0, 0, cw * 9, ch * rows);
          c.font = '12px system-ui'; const records = [];
          for (const [index, kind] of kinds.entries()) {
            q.calls.length = 0; const image = sprite('tree', 0, 1, kind), again = sprite('tree', 0, 1, kind), pixel = q.pixels(image);
            if (image !== again || image.width !== Math.round(32 * scale) || image.height !== Math.round(40 * scale)) throw Error(`Tree cache or game-size envelope changed for ${biome}/${kind}`);
            if (!pixel.ink || pixel.edgeAlpha >= 32) throw Error(`Missing or clipped ${biome}/${kind}/${view}/DPR${dpr}`);
            const call = q.calls.at(-1); if (!call) throw Error(`Exact ${biome}/${kind} preview did not use authored art`);
            const wantedSheet = q.treeSheets.find(sheet => sheet.biome === biome && sheet.kinds.includes(kind));
            if (!new URL(call.src).pathname.startsWith(new URL(`${wantedSheet.directory}/atlas-`, location.href).pathname)) throw Error(`Wrong climate or tree atlas: ${biome}/${kind}`);
            const [sx, sy, cell, , x, y, w, h] = call.args, slot = sy / cell * 3 + sx / cell;
            if (slot !== wantedSheet.kinds.indexOf(kind)) throw Error(`Wrong exact tree cell: ${biome}/${kind}`);
            const m = call.transform, rootX = x + w / 2, rootY = y + h * q.TREE_ART_SCALE.rootAnchor;
            const worldPixelsPerMetre = q.treeMasterPixels(1) * w / q.TREE_ART_SCALE.masterCellPixels;
            if (Math.abs(worldPixelsPerMetre - q.SPRITE_SCALE.worldPixelsPerMetre) > 1e-9) throw Error(`Tree atlas-to-world physical scale mismatch: ${biome}/${kind}`);
            const root = [m[0] * rootX + m[2] * rootY + m[4], m[1] * rootX + m[3] * rootY + m[5]];
            if (Math.abs(root[0] - 16 * scale) > 1e-6 || Math.abs(root[1] - 35 * scale) > 1e-6) throw Error(`Tree root moved for ${biome}/${kind}: ${root}`);
            const left = index % 9 * cw, top = Math.floor(index / 9) * ch;
            c.fillStyle = '#5b7055'; c.fillRect(left + 12, top + 10, cw - 24, 1);
            c.drawImage(image, left + (cw - 32 * zoom) / 2, top + 16, 32 * zoom, 40 * zoom);
            c.fillStyle = '#f0edda'; kind.split('-').forEach((word, line) => c.fillText(word, left + 8, top + 96 + line * 12));
            records.push({ biome, kind, zoom, dpr, view, root, worldPixelsPerMetre, densityCell: cell, ...pixel });
          }
          return records;
        }, { biome, zoom, dpr });
        previews.push(...profile);
        await page.locator('#sheet').screenshot({ path: `${output}/trees-${biome}-${zoom}-dpr${dpr}.png` });
      }
      await page.evaluate(biome => {
        const q = treeQA, width = 64, tiles = Array.from({ length: width * width }, () => ({ terrain: 'grass', elevation: .2, detail: '', road: false, rail: false }));
        q.calls.length = 0; q.treeBillboardDraws.length = 0;
        const details = q.BIOME_NATURE[biome].trees;
        for (let y = 17; y < 47; y++) for (let x = 17; x < 47; x++) if ((x + y) % 3) tiles[y * width + x] = { ...tiles[y * width + x], terrain: 'forest', detail: details[(x + y * 3) % details.length], variant: (x * 13 + y * 7) % 64 };
        q.game = { biome, seed: 1847, day: 0, width, height: width, revision: 0, networkRevision: 0, tiles, cities: [], industries: [], stations: [], routes: [], vehicles: [], terrainObjects: [] };
        q.before = JSON.stringify(q.game);
        q.renderer = q.createRenderer(q.canvas, q.game, { layers: { weather: false, names: false, industryIcons: false, grid: false }, sceneryPanSettleMs: 0 });
        q.sheet.style.display = 'none'; q.canvas.style.display = 'block'; q.renderer.resize(); q.renderer.focus(32, 32);
      }, biome);
      for (const zoom of [.5, 1, 2]) {
        await page.evaluate(zoom => { treeQA.renderer.setZoom(zoom); treeQA.renderer.focus(32, 32); }, zoom);
        await settle(page);
        const visible = await page.evaluate(() => {
          const q = treeQA; q.referencePixels = q.canvas.getContext('2d').getImageData(0, 0, q.canvas.width, q.canvas.height).data;
          return q.hashPixels(q.canvas);
        });
        await page.evaluate(() => treeQA.renderer.setLayers({ trees: false })); await settle(page);
        const hidden = await page.evaluate(() => treeQA.hashPixels(treeQA.canvas));
        await page.evaluate(() => treeQA.renderer.setLayers({ trees: true })); await settle(page);
        const row = await page.evaluate(({ biome, zoom, dpr }) => {
          const q = treeQA, restored = q.hashPixels(q.canvas), before = q.renderer.getStats();
          q.renderer.render(1000, { settle: true }); const after = q.renderer.getStats();
          const restoredPixels = q.canvas.getContext('2d').getImageData(0, 0, q.canvas.width, q.canvas.height).data;
          let differing = 0, far = 0, maxChannel = 0;
          for (let n = 0; n < restoredPixels.length; n += 4) {
            const delta = Math.max(...[0, 1, 2, 3].map(channel => Math.abs(restoredPixels[n + channel] - q.referencePixels[n + channel])));
            if (delta) differing++; if (delta > 4) far++; maxChannel = Math.max(maxChannel, delta);
          }
          return { biome, zoom, dpr, restored, pixelDifference: { differing, far, maxChannel }, unchanged: q.before === JSON.stringify(q.game), cache: { bytes: after.cacheBytes, limit: after.cacheLimit, sceneryBytes: after.sceneryBatches.bytes, sceneryLimit: after.sceneryBatches.limit, spriteBytes: after.preparedSprites.bytes, spriteLimit: after.preparedSprites.limit, shadows: after.treeShadows }, newChunks: after.composedChunks - before.composedChunks, newShadows: after.treeShadows.created - before.treeShadows.created };
        }, { biome, zoom, dpr });
        assert.notEqual(hidden, visible, 'Trees layer hides the new woodland artwork');
        // Cached source strips and the final view can differ by a few channel
        // values when translucent shadows are composed again. The established
        // scenery-batch parity fixture allows4; moved or lost objects exceed it.
        assert.ok(row.pixelDifference.maxChannel <= 4 && row.pixelDifference.far === 0, `restoring Trees preserves the original composed frame: ${JSON.stringify({ biome, zoom, dpr, difference: row.pixelDifference })}`);
        assert.equal(row.unchanged, true, 'tree styles, zoom and layers do not rewrite geography or saved state');
        assert.equal(row.newChunks, 0); assert.equal(row.newShadows, 0, 'a repeated frame reuses projected tree shadows');
        assert.ok(row.cache.bytes <= row.cache.limit && row.cache.sceneryBytes <= row.cache.sceneryLimit && row.cache.spriteBytes <= row.cache.spriteLimit && row.cache.shadows.bytes <= row.cache.shadows.limit, 'existing world, scenery, sprite and shadow budgets stay bounded');
        forests.push(row);
        await page.locator('#world').screenshot({ path: `${output}/woodland-${biome}-${zoom}-dpr${dpr}.png` });
      }
      const worldSelected = await page.evaluate(biome => {
        const q = treeQA;
        const selected = [...new Set(q.calls.filter(call => call.src.includes(`/nature-trees-${biome}/`)).map(call => {
          const sheet = q.treeSheets.find(sheet => new URL(call.src).pathname.startsWith(new URL(`${sheet.directory}/atlas-`, location.href).pathname));
          const [sx, sy, cell] = call.args; return sheet.kinds[sy / cell * 3 + sx / cell];
        }))].sort();
        const expected = q.EXTRA_TREE_ART[biome].map(tree => tree.id).sort();
        return { selected, expected };
      }, biome);
      assert.ok(worldSelected.expected.every(kind => worldSelected.selected.includes(kind)), 'every added tree species is actually drawn in the seeded renderer woodland');
      const actualWorldScale = await page.evaluate(() => treeQA.treeBillboardDraws.map(draw => draw.worldScale));
      assert.ok(actualWorldScale.length > 0 && actualWorldScale.every(scale => Math.abs(scale - 1) < 1e-9), 'actual woodland billboards retain the1:1 native-to-world scale used by tree metre calibration');
      const shadow = await page.evaluate(biome => {
        const q = treeQA, metadata = new Map([...q.EXTRA_TREE_ART[biome], ...(biome === 'tundra' ? q.HOLLOW_TREE_ART : [])].map(art => [art.id, art]));
        const trees = q.BIOME_NATURE[biome].trees.flatMap(detail => Array.from({ length: 64 }, (_, variant) => q.forestComposition(biome, detail, variant))).flat();
        const checked = new Set();
        for (const tree of trees) {
          const selected = q.rasterTreeIdentity(tree, biome).split(':')[1], art = metadata.get(selected); if (!art || checked.has(selected)) continue;
          const calibrated = q.rasterTreeShadowRecord(tree, biome), shadow = q.treeShadowGeometry(calibrated, biome);
          const wanted = tree.size * art.heightMetres / q.TREE_ART_SCALE.nominalReferenceHeightMetres;
          if (calibrated.x !== tree.x || calibrated.y !== tree.y || calibrated.seed !== tree.seed || Math.abs(calibrated.size - wanted) > 1e-9 || calibrated.species !== selected) throw Error(`Tree shadow height or root mismatch: ${selected}`);
          if (!shadow.contact || Math.abs(shadow.contact.x - tree.x - .25) > 1e-9 || Math.abs(shadow.contact.y - tree.y - .2) > 1e-9) throw Error(`Tree contact shadow root mismatch: ${selected}`);
          if (shadow.lobes.some(lobe => lobe.x <= tree.x || lobe.y <= tree.y)) throw Error(`Tree projected shadow violates northwest lighting: ${selected}`);
          checked.add(selected);
        }
        return { biome, checked: [...checked].sort(), expected: [...metadata.keys()].sort() };
      }, biome);
      assert.deepEqual(shadow.checked, shadow.expected, 'all added species use their own physically scaled ground shadow at the original root');
      if (biome === 'tundra') {
        const sparse = await page.evaluate(() => {
          const q = treeQA, hollow = new Set(q.HOLLOW_TREE_ART.map(tree => tree.id)); let eligible = 0, chosen = 0, other = 0;
          for (const detail of q.BIOME_NATURE.tundra.trees) for (let variant = 0; variant < 64; variant++) for (const tree of q.forestComposition('tundra', detail, variant)) {
            const selected = q.rasterTreeIdentity(tree, 'tundra').split(':')[1];
            if (tree.bare && tree.size >= 12) { eligible++; if (hollow.has(selected)) chosen++; }
            else if (hollow.has(selected)) other++;
          }
          return { eligible, chosen, other };
        });
        assert.equal(sparse.other, 0, 'hollow art preserves juvenile and leafy tree identities');
        assert.ok(sparse.chosen / sparse.eligible > .12 && sparse.chosen / sparse.eligible < .38, 'hollow trees are a sparse minority among mature bare trunks');
      }
    }
    for (const zoom of [.5, 1, 2]) {
      const cactus = await page.evaluate(({ zoom, dpr }) => {
        const q = treeQA, scale = zoom * dpr, view = zoom === .5 ? 'region' : zoom === 2 ? 'detail' : 'town';
        const sprite = q.createSprites('desert', { pixelScale: scale, detailLevel: view }), cw = 126, ch = 132;
        q.sheet.style.display = 'block'; q.canvas.style.display = 'none';
        q.sheet.width = cw * q.CACTUS_ART.length * dpr; q.sheet.height = ch * dpr; q.sheet.style.width = `${cw * q.CACTUS_ART.length}px`; q.sheet.style.height = `${ch}px`;
        const c = q.sheet.getContext('2d'); c.scale(dpr, dpr); c.fillStyle = '#c6b48b'; c.fillRect(0, 0, cw * q.CACTUS_ART.length, ch);
        c.font = '12px system-ui'; document.querySelector('h1').textContent = `Desert cacti at ${view} size, DPR ${dpr}`;
        const records = [];
        for (const [index, plant] of q.CACTUS_ART.entries()) {
          q.calls.length = 0; const image = sprite('terrain-detail', 0, 1, plant.id), pixel = q.pixels(image), calls = [...q.calls];
          if (image !== sprite('terrain-detail', 0, 1, plant.id) || !pixel.ink) throw Error(`Missing or uncached cactus ${plant.id}`);
          if (!calls.length || calls.some(call => !call.src.includes('/nature-ground-desert/cacti/'))) throw Error(`Cactus ${plant.id} did not use its generated identity`);
          for (const call of calls) {
            const [sx, sy, cell, , , , width, height] = call.args;
            if (sy / cell * 3 + sx / cell !== index) throw Error(`Wrong cactus slot: ${plant.id}`);
            if (Math.abs(width - q.CACTUS_ART_SCALE.nominalSpriteSize) > 1e-9 || Math.abs(height - width) > 1e-9) throw Error(`Cactus ${plant.id} lost its shared physical envelope`);
            const ppm = q.SPRITE_SCALE.worldPixelsPerMetre * q.CACTUS_ART_SCALE.masterCellPixels / q.CACTUS_ART_SCALE.nominalSpriteSize;
            if (Math.abs(ppm * width / q.CACTUS_ART_SCALE.masterCellPixels - q.SPRITE_SCALE.worldPixelsPerMetre) > 1e-9) throw Error(`Cactus ${plant.id} no longer shares world metres with buildings`);
          }
          const left = index * cw; c.drawImage(image, left + (cw - 32 * zoom) / 2, 12, 32 * zoom, 40 * zoom);
          c.fillStyle = '#3b4838'; plant.id.split('-').forEach((word, line) => c.fillText(word, left + 8, 84 + line * 12));
          records.push({ kind: plant.id, heightMetres: plant.heightMetres, zoom, dpr, view, ...pixel });
        }
        q.calls.length = 0;
        for (const detail of ['cactus', 'prickly-pear']) for (let variant = 0; variant < 64; variant++) sprite('terrain-detail', variant, 1, detail);
        const selected = [...new Set(q.calls.filter(call => call.src.includes('/nature-ground-desert/cacti/')).map(call => {
          const [sx, sy, cell] = call.args; return q.CACTUS_ART[sy / cell * 3 + sx / cell].id;
        }))].sort();
        if (selected.join() !== q.CACTUS_ART.map(plant => plant.id).sort().join()) throw Error('Not all desert cactus types appear in existing cactus patches');
        return records;
      }, { zoom, dpr });
      cactusPreviews.push(...cactus);
      await page.locator('#sheet').screenshot({ path: `${output}/cacti-${zoom}-dpr${dpr}.png` });
    }
    await context.close();
  }

  const partialContext = await browser.newContext({ viewport: { width: 1150, height: 900 } });
  let failed = true;
  const requests = new Map();
  await partialContext.route('**/nature-trees-taiga/variety-1/*.png', route => {
    const path = new URL(route.request().url()).pathname; requests.set(path, (requests.get(path) || 0) + 1);
    return failed ? route.abort() : route.continue();
  });
  const partialPage = await harness(partialContext);
  const before = await partialPage.evaluate(async () => {
    const q = treeQA; await q.preloadWorldArt({ biome: 'taiga', waitMs: 30000 });
    q.sprite = q.createSprites('taiga', { pixelScale: 2, detailLevel: 'detail' });
    q.detail = q.BIOME_NATURE.taiga.trees.find(detail => Array.from({ length: 64 }, (_, variant) => q.forestComposition('taiga', detail, variant)).some(trees => trees.some(tree => q.rasterTreeIdentity(tree, 'taiga') === 'nature-trees-taiga:scots-pine')));
    q.variant = Array.from({ length: 64 }, (_, n) => n).find(variant => q.forestComposition('taiga', q.detail, variant).some(tree => q.rasterTreeIdentity(tree, 'taiga') === 'nature-trees-taiga:scots-pine'));
    q.fallback = q.sprite('forest', q.variant, 1, q.detail); q.fallbackHash = q.hashPixels(q.fallback);
    q.tree = q.forestComposition('taiga', q.detail, q.variant).find(tree => q.rasterTreeIdentity(tree, 'taiga') === 'nature-trees-taiga:scots-pine');
    const shadow = q.rasterTreeShadowRecord(q.tree, 'taiga');
    q.geometry = JSON.stringify(q.forestComposition('taiga', q.detail, q.variant));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const available = q.drawAtlas(canvas.getContext('2d'), 'nature-trees-taiga:scots-pine', 0, 0, 96, 96);
    return { nonempty: q.pixels(q.fallback).ink > 0, available, cached: q.fallback === q.sprite('forest', q.variant, 1, q.detail), originalShadow: shadow === q.tree, errors: q.worldArtStats().errors.filter(error => error.id.includes('nature-trees')) };
  });
  assert.ok(before.nonempty && before.cached && before.originalShadow, 'failed added tree sheets retain visible cached native woodland and the original shadow');
  assert.equal(before.available, false, 'missing art never substitutes another tree identity');
  assert.equal(before.errors.length, 1);
  failed = false;
  const recovery = await partialPage.evaluate(async () => {
    const q = treeQA; await q.preloadWorldArt({ biome: 'taiga', retry: true, waitMs: 30000 });
    const after = q.sprite('forest', q.variant, 1, q.detail), shadow = q.rasterTreeShadowRecord(q.tree, 'taiga');
    return { replaced: after !== q.fallback, changed: q.hashPixels(after) !== q.fallbackHash, cached: after === q.sprite('forest', q.variant, 1, q.detail), geometryStable: q.geometry === JSON.stringify(q.forestComposition('taiga', q.detail, q.variant)), calibratedShadow: shadow !== q.tree && shadow.species === 'scots-pine', errors: q.worldArtStats().errors };
  });
  assert.ok(recovery.replaced && recovery.changed && recovery.cached && recovery.geometryStable && recovery.calibratedShadow, 'late tree art upgrades the existing cache and shadow without moving published trees');
  assert.deepEqual(recovery.errors, []);
  for (const count of requests.values()) assert.equal(count, 2, 'retry fetches each failed tree density once');
  await partialContext.close();

  const lodContext = await browser.newContext(); let missingLod = true;
  const lodRequests = new Map();
  await lodContext.route('**/nature-trees-taiga/variety-1/atlas-*.png', route => {
    const path = new URL(route.request().url()).pathname; lodRequests.set(path, (lodRequests.get(path) || 0) + 1);
    return missingLod && path.endsWith('atlas-128.png') ? route.abort() : route.continue();
  });
  const lodPage = await harness(lodContext);
  const lodBefore = await lodPage.evaluate(async () => {
    const q = treeQA; await q.preloadWorldArt({ biome: 'taiga', waitMs: 30000 });
    q.sprite = q.createSprites('taiga', { pixelScale: 4, detailLevel: 'detail' }); q.calls.length = 0;
    q.standIn = q.sprite('tree', 0, 1, 'scots-pine');
    return { draw: q.calls.at(-1), nonempty: q.pixels(q.standIn).ink > 0, cached: q.standIn === q.sprite('tree', 0, 1, 'scots-pine') };
  });
  assert.ok(lodBefore.nonempty && lodBefore.cached, 'one missing tree density retains the same authored identity in the cache');
  assert.match(lodBefore.draw.src, /nature-trees-taiga\/variety-1\/atlas-256\.png$/);
  missingLod = false;
  const lodAfter = await lodPage.evaluate(async () => {
    const q = treeQA; await q.preloadWorldArt({ biome: 'taiga', retry: true, waitMs: 30000 }); q.calls.length = 0;
    const image = q.sprite('tree', 0, 1, 'scots-pine'); return { replaced: image !== q.standIn, draw: q.calls.at(-1), errors: q.worldArtStats().errors };
  });
  assert.ok(lodAfter.replaced, 'recovering the requested tree density invalidates its stand-in cache');
  assert.match(lodAfter.draw.src, /nature-trees-taiga\/variety-1\/atlas-128\.png$/);
  assert.deepEqual(lodAfter.errors, []);
  for (const [path, count] of lodRequests) assert.equal(count, path.endsWith('atlas-128.png') ? 2 : 1, 'density recovery preserves already decoded tree images');
  await lodContext.close();

  const hollowContext = await browser.newContext();
  await hollowContext.route('**/nature-trees-tundra/hollow/*.png', route => route.abort());
  const hollowPage = await harness(hollowContext);
  const hollowFallback = await hollowPage.evaluate(async () => {
    const q = treeQA; await q.preloadWorldArt({ biome: 'tundra', waitMs: 30000 });
    const sprite = q.createSprites('tundra', { pixelScale: 2, detailLevel: 'detail' }), sheet = document.querySelector('#sheet');
    sheet.width = 600; sheet.height = 180; const c = sheet.getContext('2d'); c.fillStyle = '#cbd4c5'; c.fillRect(0, 0, 600, 180);
    document.querySelector('h1').textContent = 'Missing hollow-tree artwork: native branch and trunk-cavity fallback';
    const records = [];
    for (const [index, tree] of q.HOLLOW_TREE_ART.entries()) {
      q.calls.length = 0; const image = sprite('tree', 0, 1, tree.id), pixel = q.pixels(image);
      if (!pixel.ink || q.calls.length) throw Error(`Missing native hollow fallback: ${tree.id}`);
      c.drawImage(image, index * 200 + 68, 30, 64, 80); c.fillStyle = '#33443a'; c.fillText(tree.id, index * 200 + 55, 145);
      records.push({ kind: tree.id, ...pixel });
    }
    return records;
  });
  assert.equal(new Set(hollowFallback.map(record => record.hash)).size, hollowFallback.length, 'missing hollow trees retain distinct native silhouettes');
  await hollowPage.locator('#sheet').screenshot({ path: `${output}/hollow-native-fallback.png` });
  await hollowContext.close();

  const gameContext = await browser.newContext({ viewport: { width: 1150, height: 800 } });
  // The public diagnostic surface appears after startup has painted its map.
  // Pause synchronously when it appears, before the first scheduled simulation
  // callback; creation and save loading still go through the real menus.
  await gameContext.addInitScript(() => {
    Object.defineProperty(window, 'transport', { configurable: true, set(value) {
      Object.defineProperty(window, 'transport', { value, writable: true, configurable: true });
      value.setSpeed(0);
    } });
  });
  const gamePage = await gameContext.newPage(); gamePage.on('pageerror', error => errors.push(error.message));
  await gamePage.goto(base); await createWorldFromMenu(gamePage, { biome: 'taiga', generationVersion: 7 });
  await gamePage.evaluate(async () => {
    const { saveGame } = await import('./model.js');
    const saved = saveGame(transport.game); if (!saved.ok) throw Error('Unable to save isolated legacy company');
  });
  const saved = await companyFingerprint(gamePage);
  await gamePage.reload(); await loadAutosaveFromMenu(gamePage);
  const restored = await companyFingerprint(gamePage);
  assert.equal(restored.tileHash, saved.tileHash, 'loading an existing recipe-7 company preserves its geography');
  await gamePage.locator('#game-menu-button').click(); await gamePage.locator('[data-open-gallery]').click();
  await gamePage.locator('.gallery-explorer').waitFor(); await gamePage.locator('#gallery-category').selectOption('nature');
  const galleryTrees = await gamePage.evaluate(async () => {
    const { EXTRA_TREE_ART, HOLLOW_TREE_ART, CACTUS_ART } = await import('./tree-art-catalog.js');
    return Object.fromEntries(Object.entries(EXTRA_TREE_ART).map(([biome, trees]) => [biome, [...trees, ...(biome === 'tundra' ? HOLLOW_TREE_ART : []), ...(biome === 'desert' ? CACTUS_ART : [])].map(tree => ({ id: `nature:${biome === 'desert' && CACTUS_ART.includes(tree) ? 'plants' : 'trees'}:${tree.id}`, name: tree.id.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()), height: tree.heightMetres }))]));
  });
  for (const [biome, trees] of Object.entries(galleryTrees)) {
    await gamePage.locator('#gallery-climate').selectOption(biome);
    for (const tree of trees) {
      await gamePage.locator('#gallery-search').fill(tree.name);
      await gamePage.locator(`[data-gallery-entry="${tree.id}"]`).click();
      assert.equal(await gamePage.locator('#gallery-object-heading').innerText(), tree.name);
      const heightLabel = await gamePage.locator('.gallery-facts div').filter({ has: gamePage.locator('dt', { hasText: 'Typical mature height' }) }).locator('dd').innerText();
      assert.match(heightLabel, /^\d+(?:\.\d{1,2})? m$/, 'Gallery heights use readable metre labels');
      const decimals = heightLabel.match(/\.(\d+)/)?.[1].length || 0;
      assert.equal(Number(heightLabel.slice(0, -2)), Number(tree.height.toFixed(decimals)), `new plants display their calibrated height: ${tree.name}`);
      await gamePage.waitForFunction(id => {
        const canvas = document.querySelector(`.gallery-portrait [data-gallery-nature="${id}"]`); if (!canvas) return false;
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; return data.some((n, i) => i % 4 === 3 && n > 32);
      }, tree.id);
      await gamePage.waitForFunction(async ({ id, biome }) => {
        const { worldArtStats } = await import('./atlas-runtime.js');
        const kind = id.split(':')[2], family = id.includes(':plants:') ? 'ground' : 'trees';
        return worldArtStats().rasterizedEntries[`nature-${family}-${biome}:${kind}`] > 0;
      }, { id: tree.id, biome });
    }
    await gamePage.screenshot({ path: `${output}/gallery-${biome}.png` });
  }
  await gamePage.locator('#modal .close-modal').click();
  const afterGallery = await companyFingerprint(gamePage);
  assert.equal(afterGallery.state, restored.state, 'exploring all new trees and changing preview climates leaves a loaded company unchanged');
  assert.equal(afterGallery.tileHash, saved.tileHash, 'visual tree variety does not rewrite legacy terrain tiles');
  await gameContext.close();
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ sheets, previews, cactusPreviews, forests, fallback: before, recovery, densityFallback: { before: lodBefore, after: lodAfter }, hollowFallback, gallery: { addedObjects: Object.values(galleryTrees).flat().length, existingRecipe: saved.generationVersion, saveUnchanged: true }, errors }, null, 2));
  console.log(JSON.stringify({ atlasCells: sheets.length, individualTreeProfiles: previews.length, cactusProfiles: cactusPreviews.length, woodlandProfiles: forests.length, addedGalleryObjects: Object.values(galleryTrees).flat().length, fallbackAndRecovery: 'passed', publishedGeometryAndSavedWorld: 'unchanged', errors, artifacts: output }, null, 2));
} finally { await browser.close(); }
