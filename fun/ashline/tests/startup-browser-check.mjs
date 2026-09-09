// Run with ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs and ASHLINE_URL.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const url = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-startup-qa';
await mkdir(output, { recursive: true });
const measurements = [], errors = [];
const ready = page => page.waitForFunction(() => window.ashline?.booted);
const deployed = page => page.waitForFunction(() => ashline.state && !ashline.loading && !ashline.paused, null, { timeout: 120000 });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 800 });
    const assetRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/assets/generated/')) assetRequests.push(request.url()); });
    await page.addInitScript(() => {
      window.startupFrames = 0;
      const raf = requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => { startupFrames++; return raf(callback); };
    });
    await page.goto(url); await ready(page);
    await page.locator('#map-size').selectOption('vast');
    await page.locator('#map-profile').selectOption('highlands');
    await page.locator('#player-race').selectOption('aiUnity');
    await page.locator('#random-seed').click();
    await page.locator('#seed').fill('INSTANT-MENU');
    await page.waitForTimeout(150);
    const menu = await page.evaluate(() => ({ game: ashline.state, assetCount: ashline.assets.loaded, started: ashline.assets.started,
      frames: startupFrames, terrain: Boolean(ashline.renderer.terrainSource), hidden: getComputedStyle(document.querySelector('#game-shell')).visibility,
      overflow: document.documentElement.scrollWidth > innerWidth, contentOverflow: document.querySelector('#briefing').scrollWidth > document.querySelector('#briefing').clientWidth,
      title: document.querySelector('h1').textContent, font: getComputedStyle(document.querySelector('h1')).fontFamily,
      bootMs: performance.now(), firstPaintMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime }));
    assert.equal(menu.game, null); assert.equal(menu.started, false); assert.equal(menu.assetCount, 0);
    assert.equal(menu.frames, 0, 'The menu never starts a game animation loop');
    assert.equal(menu.terrain, false); assert.equal(menu.hidden, 'hidden');
    assert.equal(menu.overflow || menu.contentOverflow, false, 'Menu stays inside the viewport');
    assert.equal(menu.title, 'Ashline'); assert.match(menu.font, /Oxanium/);
    assert.equal(assetRequests.length, 0, 'Art decoding waits for deployment');
    await page.screenshot({ path: `${output}/menu-${viewport.width}.png` });
    if (viewport.width !== 1440) { measurements.push({ width: viewport.width, menu }); await page.close(); continue; }
    await page.evaluate(() => {
      window.loadingSamples = [];
      window.loadingTimer = setInterval(() => {
        if (ashline.loading) loadingSamples.push({ value: document.querySelector('#loading-progress').value,
          label: document.querySelector('#loading-stage').textContent, time: ashline.state?.time || 0, at: performance.now() });
      }, 30);
    });
    const launchAt = Date.now();
    await page.locator('#deploy').click();
    assert(await page.locator('#loading').isVisible(), 'Deployment paints a dedicated loading screen');
    await page.screenshot({ path: `${output}/loading.png` });
    await deployed(page);
    const launchMs = Date.now() - launchAt;
    const launch = await page.evaluate(() => {
      clearInterval(loadingTimer);
      return { samples: loadingSamples, seed: ashline.state.seed, width: ashline.state.width, profile: ashline.state.mapProfile,
        race: ashline.state.teams[0].race, assets: ashline.assets.ready, terrainReady: ashline.renderer.terrainSource === ashline.state.terrain };
    });
    assert.equal(launch.seed, 'INSTANT-MENU'); assert.equal(launch.width, 224); assert.equal(launch.profile, 'highlands'); assert.equal(launch.race, 'aiUnity');
    assert(launch.assets && launch.terrainReady); assert(launch.samples.every(sample => sample.time === 0), 'Simulation waits for the completed loading screen');
    assert(new Set(launch.samples.map(sample => sample.value)).size > 6, 'Completed preparation chunks visibly advance progress');
    assert(launch.samples.filter(sample => sample.value >= 40 && sample.value < 99).length > 3, 'Terrain work yields to the loading UI');
    for (let i = 1; i < launch.samples.length; i++) assert(launch.samples[i].value >= launch.samples[i - 1].value, 'Progress is monotonic');
    await page.locator('#pause').click(); await page.locator('#save-game').click();
    const saved = await page.evaluate(async () => { const { SAVE_KEY } = await import('./save.js'); return localStorage.getItem(SAVE_KEY); });
    assert(saved);
    await page.locator('#new-game').click(); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => ashline.state), null, 'A new skirmish returns to an empty menu');
    const frames = await page.evaluate(() => startupFrames); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => startupFrames), frames, 'Returning to setup stops the old frame loop');
    await page.locator('#load-saved').click();
    await page.waitForFunction(() => !ashline.loading && document.querySelector('#menu').open, null, { timeout: 120000 });
    assert.equal(await page.evaluate(() => ashline.state.seed), 'INSTANT-MENU');
    assert(await page.evaluate(() => ashline.paused), 'Saved operation restores paused');
    const time = await page.evaluate(() => ashline.state.time);
    await page.locator('#resume').click(); await page.waitForFunction(time => ashline.state.time > time, time);
    await page.locator('#pause').click();
    await page.evaluate(async () => { const { SAVE_KEY } = await import('./save.js'); localStorage.setItem(SAVE_KEY, '{broken save'); });
    await page.locator('#load-game').click(); await page.waitForFunction(() => !ashline.loading);
    assert.equal(await page.evaluate(() => ashline.state.seed), 'INSTANT-MENU', 'Invalid saves preserve the current operation');
    assert(await page.locator('#menu').isVisible());
    measurements.push({ width: viewport.width, menu, launchMs, progressSamples: launch.samples.length, progressStages: [...new Set(launch.samples.map(sample => sample.label))] });
    await page.close();
  }
  // A worker failure leaves a usable route back to setup and can be retried.
  const failure = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await failure.goto(url); await ready(failure);
  await failure.route('**/world-worker.js', route => route.abort());
  await failure.locator('#deploy').click();
  await failure.locator('#loading-back').waitFor({ state: 'visible', timeout: 120000 });
  await failure.locator('#loading-back').click();
  assert.equal(await failure.evaluate(() => ashline.state), null);
  assert(await failure.locator('#deploy').isEnabled());
  await failure.unroute('**/world-worker.js');
  await failure.locator('#map-size').selectOption('standard');
  await failure.locator('#deploy').click(); await deployed(failure);
  assert.equal(await failure.evaluate(() => ashline.state.width), 144);
  await failure.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, measurements, output }, null, 2));
} finally { await browser.close(); }
