// Exercise actual PNGs in isolated browser contexts, including the old public
// sprite names and partial downloads. No game or user storage is modified.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const baseURL = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const errors = [];

async function harness(context) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/generated-art-coverage-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Generated art coverage</title>' }));
  await page.goto(new URL('generated-art-coverage-qa', baseURL).href);
  await page.evaluate(async () => {
    const sprites = await import('./sprites.js'), world = await import('./atlas-runtime.js'), houses = await import('./raster-houses.js');
    const buildings = await import('./buildings.js'), nature = await import('./terrain-sprites.js');
    const natureArt = await import('./raster-nature.js'), treeArt = await import('./tree-art-catalog.js');
    const treeSheets = new Map();
    for (const biome of Object.keys(natureArt.NATURE_ART_CATALOG.trees)) {
      for (const suffix of ['', '/variety-1', '/variety-2', ...(biome === 'tundra' ? ['/hollow'] : [])]) {
        const directory = `./assets/world/nature-trees-${biome}${suffix}`;
        const response = await fetch(`${directory}/atlas.json`);
        if (!response.ok) throw Error(`Missing tree atlas metadata ${directory}`);
        treeSheets.set(new URL(`${directory}/`, location.href).pathname, await response.json());
      }
    }
    const civic = await import('./raster-buildings.js'), industries = await import('./raster-industries.js');
    const calls = [], drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
      if (image instanceof HTMLImageElement) calls.push({ src: image.src, args });
      return drawImage.call(this, image, ...args);
    };
    window.artQA = { ...sprites, world, houses, buildings, nature, natureArt, treeArt, treeSheets, civic, industries, calls };
  });
  return page;
}

try {
  const healthyContext = await browser.newContext(), page = await harness(healthyContext);
  const startupTrees = [];
  page.on('request', request => { if (/\/nature-trees-[^/]+\/.*\.png$/.test(request.url())) startupTrees.push(new URL(request.url()).pathname); });
  // A detached sprite consumer must start nature and industry loading itself;
  // each climate's sprites load only that climate's atlases.
  await page.evaluate(async () => {
    artQA.sprite = artQA.createSprites('taiga');
    await artQA.world.preloadWorldArt({ biome: 'taiga', cells: artQA.world.startupArtCells(1), waitMs: 12000 });
  });
  assert.ok(startupTrees.length > 0 && startupTrees.every(path => path.includes('/nature-trees-taiga/')), 'startup tree artwork loads only the active climate');
  assert.ok(startupTrees.every(path => /atlas-(16|32|64)\.png$/.test(path)), 'startup retains the established three small densities');
  for (const suffix of ['', '/variety-1', '/variety-2']) assert.ok(startupTrees.some(path => path.includes(`/nature-trees-taiga${suffix}/atlas-`)), 'each active-climate tree sheet starts without fetching sharper densities');
  const startupTreeRequestCount = startupTrees.length;
  await page.evaluate(() => { for (const biome of ['tundra', 'desert']) artQA.createSprites(biome); });
  await page.waitForFunction(() => {
    const stats = artQA.world.worldArtStats();
    return stats.ready === stats.atlases && artQA.houses.getHouseAssetStats().status === 'ready';
  });
  const coverage = await page.evaluate(() => {
    const q = artQA, aliases = [], woodland = {}, expectedWoodland = {};
    for (const biome of ['taiga', 'tundra', 'desert']) {
      for (const pixelScale of [.5, 1, 2, 4]) {
        const sprite = q.createSprites(biome, { pixelScale });
        for (const level of [1, 2, 3]) for (const variant of [0, 8, 31]) {
          for (const oldKind of ['house', 'apartment', 'shop', 'office']) {
            const kind = ['house', 'apartment'].includes(oldKind) ? q.buildings.residentialKind(variant, level) : q.buildings.commercialKind(variant, level);
            aliases.push(sprite(oldKind, variant, level) === sprite(kind, variant, level));
          }
        }
      }
      const sprite = q.createSprites(biome, { pixelScale: 1 }); q.calls.length = 0;
      for (const detail of q.nature.BIOME_NATURE[biome].trees) for (let variant = 0; variant < 64; variant++) sprite('forest', variant, 1, detail);
      woodland[biome] = [...new Set(q.calls.flatMap(call => {
        const path = new URL(call.src).pathname;
        if (!path.includes(`/nature-trees-${biome}/`)) return [];
        const meta = q.treeSheets.get(path.slice(0, path.lastIndexOf('/') + 1));
        if (!meta) throw Error(`Unregistered tree atlas ${call.src}`);
        const [sx, sy, cell] = call.args, index = sy / cell * meta.columns + sx / cell;
        if (!meta.order[index]) throw Error(`Unregistered tree cell ${call.src}: ${index}`);
        return [meta.order[index]];
      }))].sort();
      expectedWoodland[biome] = q.natureArt.NATURE_ART_CATALOG.trees[biome].map(kind => `nature-trees-${biome}:${kind}`).sort();
      for (const detail of [...q.natureArt.NATURE_ART_CATALOG.ground[biome], 'glacial', 'ice', 'snow', 'dunes', 'saltflat', 'canyon']) {
        for (const variant of [0, 1, 4]) sprite('terrain-detail', variant, 1, detail);
      }
      for (const detail of q.nature.BIOME_NATURE[biome].mountains) sprite('mountain', 0, 1, detail);
      for (const variant of [0, 1, 4]) sprite('rock', variant, 1, 'glacial');
    }
    const catalog = q.natureArt.NATURE_ART_CATALOG;
    // The Gallery also exposes exact ground identities. Some original desert
    // patches now select a mixture of authored cactus varieties on the map.
    const portrait = document.createElement('canvas'); portrait.width = portrait.height = 128;
    const c = portrait.getContext('2d');
    for (const [biome, kinds] of Object.entries(catalog.ground)) for (const kind of kinds) {
      if (!q.world.drawAtlas(c, `nature-ground-${biome}:${kind}`, 0, 0, 96, 96)) throw Error(`Missing exact ground portrait: ${biome}/${kind}`);
    }
    const expectedNatureCount = [...Object.values(catalog.trees), ...Object.values(catalog.ground), catalog.mountains, catalog.rocks].reduce((sum, kinds) => sum + kinds.length, 0);
    return { aliases, woodland, expectedWoodland, expectedNatureCount, stats: q.world.worldArtStats() };
  });
  assert.ok(coverage.aliases.every(Boolean), 'every legacy building identity shares the generated sprite at all four device densities');
  for (const biome of ['taiga', 'tundra', 'desert']) assert.deepEqual(coverage.woodland[biome], coverage.expectedWoodland[biome], `every registered ${biome} tree image appears in ordinary woodland`);
  assert.deepEqual(coverage.stats.errors, []);
  assert.equal(Object.keys(coverage.stats.rasterizedEntries).filter(id => id.startsWith('nature-')).length, coverage.expectedNatureCount, 'all registered generated nature objects are reachable');
  await healthyContext.close();

  const partialContext = await browser.newContext(); let missingDensity = true;
  const houseRequests = new Map();
  await partialContext.route('**/assets/houses/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    houseRequests.set(pathname, (houseRequests.get(pathname) || 0) + 1);
    if (missingDensity && pathname.endsWith('/desert/house-atlas-128.png')) await route.abort();
    else await route.continue();
  });
  const partialPage = await harness(partialContext);
  const partial = await partialPage.evaluate(async () => {
    const q = artQA; await q.houses.preloadHouses();
    q.sprite = q.createSprites('desert', { pixelScale: 4 }); q.before = q.sprite('house-normal-2');
    return { stats: q.houses.getHouseAssetStats('desert'), draw: q.calls.at(-1) };
  });
  assert.equal(partial.stats.activeBiome, 'desert');
  assert.deepEqual(partial.stats.lodCellSizes, [16,32,64,256]);
  assert.equal(partial.stats.lastCellSize, 256, 'a missing close-up density uses the healthy full-resolution master');
  assert.match(partial.draw.src, /desert\/house-atlas\.png$/);
  missingDensity = false;
  const recovered = await partialPage.evaluate(async () => {
    const q = artQA; await q.houses.preloadHouses({ retry: true });
    const after = q.sprite('house-normal-2');
    return { stats: q.houses.getHouseAssetStats('desert'), replaced: after !== q.before };
  });
  assert.equal(recovered.replaced, true, 'recovered artwork invalidates existing sprite caches');
  assert.deepEqual(recovered.stats.lodCellSizes, [16,32,64,128,256]);
  assert.deepEqual(recovered.stats.errors, {});
  assert.equal(recovered.stats.lastCellSize, 128);
  for (const [path, count] of houseRequests) assert.equal(count, path.endsWith('/desert/house-atlas-128.png') ? 2 : 1, 'retry preserves all already decoded house densities');
  await partialContext.close();

  const fallbackContext = await browser.newContext();
  await fallbackContext.route('**/assets/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (/\/houses\/(taiga|desert)\//.test(path) || /\/buildings-civic\/(taiga|tundra)\//.test(path) || /\/industries-tundra\//.test(path)) return route.abort();
    return route.continue();
  });
  const fallbackPage = await harness(fallbackContext);
  const fallback = await fallbackPage.evaluate(async () => {
    const q = artQA; await Promise.all([q.world.preloadWorldArt(), q.houses.preloadHouses()]);
    const sprite = q.createSprites('tundra');
    sprite('hospital'); const civic = q.calls.at(-1).src;
    sprite('iron-mine'); const industry = q.calls.at(-1).src;
    q.createSprites('desert')('house-cheap-1');
    return { civic, industry, house: q.houses.getHouseAssetStats('desert').activeBiome };
  });
  assert.match(fallback.civic, /buildings-civic\/desert\/atlas-/);
  assert.match(fallback.industry, /industries-taiga\/atlas-/);
  assert.equal(fallback.house, 'tundra');
  await fallbackContext.close();
  assert.deepEqual(errors, [], 'no browser exceptions from missing densities or climate fallbacks');
  console.log(JSON.stringify({ aliases: coverage.aliases.length, startupTrees: startupTreeRequestCount, woodland: coverage.woodland, natureObjects: coverage.expectedNatureCount, partialDensity: 'healthy imagery retained; retry upgrades cached sprite', fallback: 'same generated identity from a healthy climate' }, null, 2));
} finally { await browser.close(); }
