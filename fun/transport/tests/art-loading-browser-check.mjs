import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-art-loading';
await mkdir(output, { recursive: true });
const errors = [], densities = [], throttled = [];
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
  // Constructing sprites alone starts generated world loading, without app.js; it loads only its own biome's atlases.
  await page.waitForFunction(() => artLoading.assets.worldArtStats().usable > 0);
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

  // Startup preloads only the densities a view draws at once, and each draw fetches a sharper level it lacks.
  // Once no draw waits for art, every zoom matches the eager loader at DPR 1 and 2. The renderer itself varies
  // by a level or two on a few pixels between runs; a stand-in density differs by far more.
  async function artScene(dpr, lazy) {
    const scene = await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: dpr }), requested = [];
    const page = await scene.newPage(); page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const match = request.url().match(/\/assets\/.*?(?:-(\d+))?\.png$/); if (match) requested.push(Number(match[1] || 256)); });
    await page.route('**/art-loading-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{width:1000px;height:700px}</style><canvas></canvas>' }));
    await page.goto(new URL('art-loading-qa', base).href);
    await page.evaluate(async lazy => {
      const { createGame } = await import('./model.js'), { createRenderer } = await import('./renderer.js');
      const assets = await import('./atlas-runtime.js'), houses = await import('./raster-houses.js'), cells = lazy ? assets.startupArtCells() : undefined;
      await Promise.all([assets.preloadWorldArt({ biome: 'taiga', cells, waitMs: 20000 }), houses.preloadHouses({ biome: 'taiga', cells, waitMs: 20000 })]);
      const canvas = document.querySelector('canvas'), game = createGame({ biome: 'taiga', size: 'square512', seed: 1847 }), renderer = createRenderer(canvas, game, { layers: { weather: false, names: false } });
      const revision = () => `${assets.worldArtRevision()}:${houses.houseAssetsRevision()}`, loading = () => assets.worldArtStats().loading || houses.getHouseAssetStats().status === 'loading';
      // Each arriving batch republishes once; redraw until a full frame asks for nothing new.
      const settle = async () => {
        for (let n = 0; n < 40; n++) {
          const seen = revision(); renderer.render(1000);
          for (let k = 0; renderer.getStats().sceneryBatches?.pending && k < 120; k++) { await new Promise(requestAnimationFrame); renderer.render(1000); }
          while (loading()) await new Promise(resolve => setTimeout(resolve, 20));
          if (seen === revision()) return;
        }
        throw new Error('Artwork did not settle.');
      };
      const compare = async url => {
        const image = new Image(); image.src = url; await image.decode();
        const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height; copy.getContext('2d').drawImage(image, 0, 0);
        const a = copy.getContext('2d').getImageData(0, 0, copy.width, copy.height).data, b = canvas.getContext('2d').getImageData(0, 0, copy.width, copy.height).data; let differing = 0, far = 0;
        for (let i = 0; i < a.length; i += 4) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3])); if (d) differing++; if (d > 8) far++; }
        return { differing, far, pixels: a.length / 4 };
      };
      const decoded = () => assets.worldArtStats().decodedBytes + houses.getHouseAssetStats('taiga').decodedBytes;
      window.densityQA = { game, renderer, settle, compare, decoded, canvas };
    }, lazy);
    return { scene, page, requested, startup: [...requested] };
  }
  for (const dpr of [1, 2]) {
    const eager = await artScene(dpr, false), lazy = await artScene(dpr, true), matches = {};
    for (const zoom of [.5, 1, 2]) {
      for (const run of [eager, lazy]) await run.page.evaluate(async zoom => { const q = densityQA; q.renderer.setZoom(zoom); q.renderer.focus(q.game.cities[0].x, q.game.cities[0].y); await q.settle(); }, zoom);
      matches[zoom] = await eager.page.evaluate(url => densityQA.compare(url), await lazy.page.evaluate(() => densityQA.canvas.toDataURL()));
      if (zoom === 1) for (const run of [eager, lazy]) { run.beforeDetail = [...run.requested]; run.decoded = await run.page.evaluate(() => densityQA.decoded()); }
    }
    await lazy.page.locator('canvas').screenshot({ path: `${output}/lazy-detail-dpr${dpr}.png` });
    await eager.scene.close(); await lazy.scene.close();
    assert.ok(eager.startup.includes(256), 'the eager loader fetches 256 cells');
    assert.equal(lazy.startup.filter(cell => cell === 256).length, 0, `DPR ${dpr} startup requests no 256 cells`);
    if (dpr === 1) assert.equal(lazy.startup.filter(cell => cell === 128).length, 0, 'DPR 1 startup requests no 128 cells');
    for (const [zoom, match] of Object.entries(matches)) assert.ok(match.far === 0 && match.differing < match.pixels * .005, `zoom ${zoom} at DPR ${dpr} matches the eager loader once art settles: ${JSON.stringify(match)}`);
    assert.ok(lazy.decoded < eager.decoded * (dpr === 1 ? .5 : .9), `the Region and Town views decode ${(lazy.decoded / 2 ** 20).toFixed(1)} of ${(eager.decoded / 2 ** 20).toFixed(1)} MiB`);
    densities.push({ dpr, startupRequests: lazy.startup.length, eagerRequests: eager.startup.length, cells256BeforeDetail: lazy.beforeDetail.filter(cell => cell === 256).length, cells256Eager: eager.startup.filter(cell => cell === 256).length, townMiB: +(lazy.decoded / 2 ** 20).toFixed(1), eagerMiB: +(eager.decoded / 2 ** 20).toFixed(1), differingPixels: Object.values(matches).map(match => match.differing) });
  }

  // On an 8 Mbps connection, late art arrives in a few batches, not one map rebuild per image (78 publications
  // before). Expect about 5 at DPR 1 and 6–7 at DPR 2, where Town's 256-pixel cells arrive more than 500 ms apart.
  for (const dpr of [1, 2]) {
    const slow = await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: dpr }), page = await slow.newPage(), cdp = await slow.newCDPSession(page);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await page.waitForFunction(() => document.querySelector('#start-menu')?.open);
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 1e6, uploadThroughput: 1e6 });
    await createWorldFromMenu(page, { paused: true });
    const start = await page.evaluate(async () => { const [world, houses] = await Promise.all([import('./atlas-runtime.js'), import('./raster-houses.js')]); window.slowArt = { world, houses }; return world.worldArtRevision() + houses.houseAssetsRevision(); });
    let revisions = -1, still = 0;
    for (let n = 0; n < 60 && still < 3; n++) {
      await page.waitForTimeout(500);
      const now = await page.evaluate(() => slowArt.world.worldArtStats().loading || slowArt.houses.getHouseAssetStats().status === 'loading' ? -1 : slowArt.world.worldArtRevision() + slowArt.houses.houseAssetsRevision());
      still = now >= 0 && now === revisions ? still + 1 : 0; revisions = now;
    }
    assert.ok(still >= 3, 'late art finishes loading');
    throttled.push({ dpr, revisionsAfterReady: revisions - start });
    assert.ok(revisions - start <= 8, `DPR ${dpr}: ${revisions - start} art publications after ready at 8 Mbps`);
    await slow.close();
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: lazy densities match the eager loader at every zoom and DPR; ${JSON.stringify({ densities, throttled })}`);
} finally { await browser.close(); }
