// World-sized canvas ownership must end at setup, failed deployment, and replacement loads.
// Run with ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs and ASHLINE_URL.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const url = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
const MiB = 1024 * 1024;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    // Weak references measure live stores without extending their lifetime.
    // The persistent world/minimap HTML elements are excluded from this cache budget.
    window.canvasRefs = [];
    const create = document.createElement.bind(document);
    document.createElement = (tag, ...args) => {
      const element = create(tag, ...args);
      if (tag.toLowerCase() === 'canvas') canvasRefs.push(new WeakRef(element));
      return element;
    };
  });
  await page.goto(url); await page.waitForFunction(() => window.ashline?.booted);
  await page.evaluate(async () => {
    await (await import('./assets.js')).startAssets();
    window.worldSurfaces = () => {
      const r = ashline.renderer;
      return [r.terrain, r.decals, r.fog, r.fogLow, r.fogTint, r.minimapBase, r.miniTiles,
        ...(r.lavaPools || []).flatMap(pool => [pool.surface, pool.flow, pool.mask, pool.innerShade])].filter(Boolean);
    };
    window.retiredSurfaces = [];
    window.rememberWorldSurfaces = () => { retiredSurfaces = worldSurfaces(); };
    window.assertReleased = () => {
      const r = ashline.renderer;
      if (retiredSurfaces.some(surface => surface.width || surface.height)) throw Error('Retired world canvas retains its backing store');
      if (r.terrainSource || r.knownOre || r.knownMineralTypes || r.fogNoise || r.fogVisible || r.fogExplored || r.rockProps.length || r.lavaPools.length || r.rememberedBuildings.size || r.unitPositions?.size) throw Error('Setup retains world state');
      retiredSurfaces = [];
    };
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const memory = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return page.evaluate(() => {
      const live = canvasRefs.map(ref => ref.deref()).filter(Boolean);
      return { bytes: live.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0), canvases: live.length };
    });
  };
  const assetMemory = await memory();
  assert(assetMemory.bytes < 75 * MiB, 'Prepared art must release temporary unit shadow/contact masks');
  await page.locator('#map-size').selectOption('vast');
  await page.locator('#map-profile').selectOption('rift');
  await page.locator('#seed').fill('PERF-VAST-2026');
  await page.locator('#deploy').click();
  await page.waitForFunction(() => ashline.state && !ashline.loading && !ashline.paused, null, { timeout: 120000 });
  await page.locator('#pause').click(); await page.locator('#save-game').click();
  const deployedMemory = await memory();
  const saved = await page.evaluate(async () => {
    const { SAVE_KEY } = await import('./save.js');
    return localStorage.getItem(SAVE_KEY);
  });
  assert(saved);
  // A bad save must retain the active game and terrain; it never begins a replacement.
  await page.evaluate(async () => {
    const { SAVE_KEY } = await import('./save.js');
    window.previousTerrain = ashline.renderer.terrainSource;
    localStorage.setItem(SAVE_KEY, '{invalid save');
  });
  await page.locator('#load-game').click(); await page.waitForFunction(() => !ashline.loading);
  assert(await page.evaluate(() => ashline.renderer.terrainSource === previousTerrain && ashline.state?.seed === 'PERF-VAST-2026'));
  await page.evaluate(async saved => {
    const { SAVE_KEY } = await import('./save.js');
    localStorage.setItem(SAVE_KEY, saved);
    // Reused terrain/fog canvas objects will be resized again, but old pool stores must die.
    retiredSurfaces = ashline.renderer.lavaPools.flatMap(pool => [pool.surface, pool.flow, pool.mask, pool.innerShade]);
  }, saved);
  await page.locator('#resume').click(); await page.locator('#pause').click();
  await page.locator('#load-game').click();
  await page.waitForFunction(() => !ashline.loading && document.querySelector('#menu').open, null, { timeout: 120000 });
  assert(await page.evaluate(() => retiredSurfaces.every(surface => surface.width === 0 && surface.height === 0)), 'A replacement load releases old lava pools immediately');
  await page.evaluate(() => { previousTerrain = null; retiredSurfaces = []; });
  const reloadedMemory = await memory();
  assert(reloadedMemory.bytes <= deployedMemory.bytes + 2 * MiB, 'Loading a save must not retain a second world');
  await page.evaluate(() => rememberWorldSurfaces());
  await page.locator('#new-game').click();
  await page.evaluate(() => assertReleased());
  const setupMemory = await memory();
  assert(setupMemory.bytes < assetMemory.bytes + 2 * MiB, 'Returning to setup retains art, not world-sized surfaces');
  // Fail after real terrain preparation so the cleanup path has substantial work to release.
  await page.evaluate(() => {
    const renderer = ashline.renderer;
    window.originalPrepareTerrain = renderer.prepareTerrain;
    renderer.prepareTerrain = async function(...args) {
      await originalPrepareTerrain.apply(this, args);
      rememberWorldSurfaces();
      throw Error('Injected terrain preparation failure');
    };
  });
  await page.locator('#map-size').selectOption('standard');
  await page.locator('#map-profile').selectOption('highlands');
  await page.locator('#deploy').click();
  await page.waitForFunction(() => document.querySelector('#loading').dataset.error === 'true', null, { timeout: 120000 });
  await page.evaluate(() => assertReleased());
  assert.equal(await page.evaluate(() => ashline.state), null);
  const failedMemory = await memory();
  assert(failedMemory.bytes < assetMemory.bytes + 2 * MiB, 'Failed terrain preparation releases world stores');
  await page.evaluate(() => { ashline.renderer.prepareTerrain = originalPrepareTerrain; });
  await page.locator('#loading-back').click();
  await page.locator('#deploy').click();
  await page.waitForFunction(() => ashline.state && !ashline.loading && !ashline.paused, null, { timeout: 120000 });
  assert(await page.evaluate(() => ashline.renderer.terrainSource === ashline.state.terrain && ashline.renderer.terrain.width > 0), 'Redeployment rebuilds released surfaces');
  await page.locator('#pause').click();
  await page.evaluate(() => rememberWorldSurfaces());
  await page.locator('#new-game').click(); await page.evaluate(() => assertReleased());
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ assetMemory, deployedMemory, reloadedMemory, setupMemory, failedMemory }, null, 2));
  console.log('Memory lifecycle checks passed.');
} finally { await browser.close(); }
