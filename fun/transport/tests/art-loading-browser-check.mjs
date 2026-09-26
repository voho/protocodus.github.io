import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  let missing = true;
  await context.route('**/assets/**', route => missing && /-32\.png$/.test(route.request().url()) ? route.abort() : route.continue());
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/art-loading-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>canvas{width:1000px;height:700px}</style><canvas></canvas>' }));
  await page.goto(new URL('art-loading-qa', base).href);
  await page.evaluate(async () => {
    const { createSprites } = await import('./sprites.js'), assets = await import('./atlas-runtime.js'), houses = await import('./raster-houses.js');
    const sprite = createSprites('taiga', { pixelScale: 1 });
    sprite('forest', 0, 1, 'pine');
    window.artLoading = { sprite, assets, houses };
  });
  // Constructing sprites alone starts generated world loading, without app.js.
  await page.waitForFunction(() => artLoading.assets.worldArtStats().usable === artLoading.assets.worldArtStats().atlases);
  const before = await page.evaluate(async () => {
    const q = artLoading;
    await Promise.all([q.assets.preloadWorldArt({ waitMs: 12000 }), q.houses.preloadHouses({ waitMs: 12000 })]);
    const { createGame } = await import('./model.js'), { createRenderer } = await import('./renderer.js');
    q.game = createGame({ size: 'regional' }); q.saved = JSON.stringify(q.game);
    q.renderer = createRenderer(document.querySelector('canvas'), q.game, { zoom: 1 });
    await q.assets.preloadWorldArt({ waitMs: 12000 });
    q.renderer.focus(q.game.cities[0].x, q.game.cities[0].y); q.renderer.render(0);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const school = q.assets.drawAtlas(canvas.getContext('2d'), 'civic:school:taiga', 0, 0, 32, 32);
    const house = q.houses.drawRasterHouse(canvas.getContext('2d'), 'house-cheap-1', { pixelScale: 1, biome: 'tundra' });
    return { world: q.assets.worldArtStats(), houses: q.houses.getHouseAssetStats('tundra'), school, house, chunks: q.renderer.getStats().composedChunks, camera: q.renderer.getCamera() };
  });
  assert.equal(before.world.usable, before.world.atlases, 'one failed density preserves every generated atlas');
  assert.ok(before.world.errors.length > 0, 'failed densities remain diagnosable');
  assert.equal(before.school, true, 'school uses generated art at another available density');
  assert.equal(before.house, true, 'houses keep generated art when one density fails');
  assert.equal(before.houses.activeBiome, 'tundra', 'a damaged density does not switch biome style');
  missing = false;
  const after = await page.evaluate(async () => {
    const q = artLoading;
    await Promise.all([q.assets.preloadWorldArt({ waitMs: 12000, retry: true }), q.houses.preloadHouses({ waitMs: 12000, retry: true })]);
    q.renderer.render(0);
    return { world: q.assets.worldArtStats(), houses: q.houses.getHouseAssetStats('tundra'), chunks: q.renderer.getStats().composedChunks, camera: q.renderer.getCamera(), unchanged: q.saved === JSON.stringify(q.game) };
  });
  assert.equal(after.world.ready, after.world.atlases); assert.deepEqual(after.world.errors, []);
  assert.ok(after.world.revision > before.world.revision); assert.ok(after.chunks > before.chunks, 'higher-quality recovery rebuilds existing map caches');
  assert.ok(after.houses.lodCellSizes.includes(32)); assert.deepEqual(after.houses.errors, {});
  assert.deepEqual(after.camera, before.camera); assert.equal(after.unchanged, true);
  assert.deepEqual(errors, []);
  console.log(`PASS: ${after.world.atlases} world atlases retain generated art during missing-LOD failures and recover without changing the game; house styles and map caches recover too.`);
  await context.close();
} finally { await browser.close(); }
