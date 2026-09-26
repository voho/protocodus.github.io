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
    const civic = await import('./raster-buildings.js'), industries = await import('./raster-industries.js');
    const calls = [], drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
      if (image instanceof HTMLImageElement) calls.push({ src: image.src, args });
      return drawImage.call(this, image, ...args);
    };
    window.artQA = { ...sprites, world, houses, buildings, nature, civic, industries, calls };
  });
  return page;
}

try {
  const healthyContext = await browser.newContext(), page = await harness(healthyContext);
  // A detached sprite consumer must start nature and industry loading itself.
  await page.evaluate(() => { artQA.sprite = artQA.createSprites('taiga'); });
  await page.waitForFunction(() => {
    const stats = artQA.world.worldArtStats();
    return stats.ready === stats.atlases && artQA.houses.getHouseAssetStats().status === 'ready';
  });
  const coverage = await page.evaluate(() => {
    const q = artQA, aliases = [], woodland = {};
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
      woodland[biome] = [...new Set(q.calls.filter(call => call.src.includes(`/nature-trees-${biome}/`)).map(call => {
        const [, sx, sy, cell] = [call.src, ...call.args]; return sy / cell * 3 + sx / cell;
      }))].sort((a, b) => a - b);
      for (const detail of [...q.nature.BIOME_NATURE[biome].plants, 'glacial', 'ice', 'snow', 'dunes', 'saltflat', 'canyon']) {
        for (const variant of [0, 1, 4]) sprite('terrain-detail', variant, 1, detail);
      }
      for (const detail of q.nature.BIOME_NATURE[biome].mountains) sprite('mountain', 0, 1, detail);
      for (const variant of [0, 1, 4]) sprite('rock', variant, 1, 'glacial');
    }
    return { aliases, woodland, stats: q.world.worldArtStats() };
  });
  assert.ok(coverage.aliases.every(Boolean), 'every legacy building identity shares the generated sprite at all four device densities');
  for (const biome of ['taiga', 'tundra', 'desert']) assert.deepEqual(coverage.woodland[biome], [0,1,2,3,4,5,6,7,8], `all nine ${biome} tree images appear in ordinary woodland`);
  assert.deepEqual(coverage.stats.errors, []);
  assert.equal(Object.keys(coverage.stats.rasterizedEntries).filter(id => id.startsWith('nature-')).length, 72, 'all 72 generated nature objects are reachable');
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
  assert.deepEqual(partial.stats.lodCellSizes, [16,32,64]);
  assert.equal(partial.stats.lastCellSize, 64, 'a missing close-up density uses healthy generated art');
  assert.match(partial.draw.src, /desert\/house-atlas-64\.png$/);
  missingDensity = false;
  const recovered = await partialPage.evaluate(async () => {
    const q = artQA; await q.houses.preloadHouses({ retry: true });
    const after = q.sprite('house-normal-2');
    return { stats: q.houses.getHouseAssetStats('desert'), replaced: after !== q.before };
  });
  assert.equal(recovered.replaced, true, 'recovered artwork invalidates existing sprite caches');
  assert.deepEqual(recovered.stats.lodCellSizes, [16,32,64,128]);
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
    return { civic, industry, house: q.houses.getHouseAssetStats('desert').activeBiome,
      civicWindows: JSON.stringify(q.civic.rasterBuildingWindows('hospital', 'tundra')) === JSON.stringify(q.civic.rasterBuildingWindows('hospital', 'desert')),
      industryWindows: JSON.stringify(q.industries.rasterIndustryWindows('iron-mine', 'tundra')) === JSON.stringify(q.industries.rasterIndustryWindows('iron-mine', 'taiga')) };
  });
  assert.match(fallback.civic, /buildings-civic\/desert\/atlas-/);
  assert.match(fallback.industry, /industries-taiga\/atlas-/);
  assert.equal(fallback.house, 'tundra');
  assert.equal(fallback.civicWindows, true); assert.equal(fallback.industryWindows, true);
  await fallbackContext.close();
  assert.deepEqual(errors, [], 'no browser exceptions from missing densities or climate fallbacks');
  console.log(JSON.stringify({ aliases: coverage.aliases.length, woodland: coverage.woodland, partialDensity: 'healthy imagery retained; retry upgrades cached sprite', fallback: 'same generated identity and measured windows from a healthy climate' }, null, 2));
} finally { await browser.close(); }
