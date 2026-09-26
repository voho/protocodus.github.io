// Startup gates a complete asset cache; flight, pause and display changes use it offline.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const context = await browser.newContext({ viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1 });
const page = await context.newPage(), errors = [], requests = [], pending = new Map();
let phase = 'startup', releaseSong, heldSong, releaseHero, heldHero, startupTimeout;
const songHeld = new Promise(resolve => { heldSong = resolve; });
const heroHeld = new Promise(resolve => { heldHero = resolve; });
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  // Include scripts, styles, icons and memory-backed media, not just asset URLs.
  if (!/^(https?:|blob:)/.test(request.url())) return;
  const record = { url: request.url(), phase };
  requests.push(record); pending.set(request, record);
});
page.on('requestfinished', request => pending.delete(request));
page.on('requestfailed', request => pending.delete(request));
// Chromium can keep a local Blob reader open after media reports readiness.
// Completed HTTP bodies establish download completion; any new Blob/HTTP
// request after readiness still fails the separate request-start assertion.
const pendingDownloads = () => [...pending.values()].filter(({ url }) => /^https?:/.test(url));
await page.addInitScript(() => localStorage.setItem('tyran-muted', 'false'));
await page.route('**/assets/audio/music/1.mp3', async route => {
  heldSong();
  await new Promise(resolve => { releaseSong = resolve; });
  await route.continue();
});
await page.route('**/assets/hero.jpg', async route => {
  heldHero();
  await new Promise(resolve => { releaseHero = resolve; });
  await route.continue();
});
try {
  const navigation = page.goto(url, { waitUntil: 'domcontentloaded' });
  await Promise.race([Promise.all([songHeld, heroHeld]), new Promise((_, reject) => startupTimeout = setTimeout(() => reject(new Error('Startup never requested its soundtrack/title image')), 30000))]);
  clearTimeout(startupTimeout);
  const gate = await page.evaluate(() => ({ ready: document.body.dataset.ready, inert: document.querySelector('#menu-screen').inert, loading: !document.querySelector('#startup-status').hidden }));
  assert.notEqual(gate.ready, 'true', 'Flight must wait for the last soundtrack download');
  assert.equal(gate.inert, true, 'Launch controls remain inert while assets are pending');
  assert.equal(gate.loading, true, 'Startup visibly explains why launch is unavailable');
  releaseSong(); await navigation;
  await page.evaluate(async () => {
    const { preloadAudio } = await import('./audio-assets.js');
    const { spritesReady } = await import('./sprite-assets.js');
    await Promise.all([preloadAudio(), spritesReady, document.fonts.ready]);
  });
  assert.notEqual(await page.evaluate(() => document.body.dataset.ready), 'true', 'A slow title image also keeps launch gated after every other asset finishes');
  assert.equal(await page.locator('#menu-screen').evaluate(el => el.inert), true);
  releaseHero();
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true');
  assert.deepEqual(pendingDownloads(), [], 'Readiness leaves no HTTP download still running');
  assert((await page.locator('link[rel="icon"]').getAttribute('href')).startsWith('data:'), 'The browser icon cannot start a delayed network request');
  const assets = await page.evaluate(async () => {
    const { audioAssets, preloadAudio } = await import('./audio-assets.js');
    const status = await preloadAudio();
    const { AudioEngine } = await import('./audio.js'), originalUpdate = AudioEngine.prototype.update;
    AudioEngine.prototype.update = function (...args) { window.flightAudio = this; return originalUpdate.apply(this, args); };
    window.preflightAudit = { phase: 'ready', canvases: [], damagedBuildings: 0, destroyedBuildings: 0 };
    const record = () => {
      if (preflightAudit.phase === 'flight') preflightAudit.canvases.push(new Error().stack);
    };
    const OriginalCanvas = window.OffscreenCanvas;
    if (OriginalCanvas) window.OffscreenCanvas = new Proxy(OriginalCanvas, { construct(target, args) { record(); return Reflect.construct(target, args); } });
    const originalCreate = document.createElement.bind(document);
    document.createElement = function (name, ...args) { if (name === 'canvas') record(); return originalCreate(name, ...args); };
    const button = document.createElement('button'); button.id = 'preflight-test-launch'; button.textContent = 'Start preflight test';
    button.style = 'position:fixed;top:0;left:0;z-index:99999';
    button.onclick = () => { tyran.launch(6); for (const pilot of tyran.state.players) pilot.hurt = 1e8; preflightAudit.phase = 'flight'; button.remove(); };
    document.body.append(button);
    return { status, samples: audioAssets.samples.size, songs: audioAssets.songs.size, players: audioAssets.players.size,
      playersReady: [...audioAssets.players.values()].every(player => player.readyState >= 4 && player.networkState === 1) };
  });
  assert.deepEqual(assets.status, { ready: true, completed: 23, total: 23, loaded: 23, failed: 0 });
  assert.equal(assets.samples, 18, 'Every effect is decoded before readiness');
  assert.equal(assets.songs, 5, 'Every complete soundtrack is in memory before readiness');
  assert.equal(assets.players, 5); assert.equal(assets.playersReady, true, 'Every cached song has a prepared playback element');
  assert.equal(requests.filter(request => request.url.includes('/audio/')).length, 23, 'Cold startup fetches each audio asset exactly once');
  phase = 'after-ready';
  await context.setOffline(true);
  await page.click('#preflight-test-launch');
  await page.waitForFunction(() => flightAudio?.musicPlaying);
  assert.equal(await page.evaluate(() => tyran.scene), 'playing');
  // Jump across generated strips, then damage visible buildings through real hit
  // handling. Expensive materials, atlas recolors and fixtures must already exist.
  await page.evaluate(async () => {
    const buildings = new Set(['temple', 'ruin', 'bunker', 'station', 'radar', 'dome', 'solar', 'refinery', 'building', 'tower', 'pylon', 'fortress', 'hut', 'satellite']);
    for (const scroll of [440, 2040, 4440, 7640, 10840]) {
      tyran.state.scroll = scroll;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const world = tyran.world, target = world.visibleProps.find(prop => buildings.has(prop.type) && prop.hp > 0);
      if (target) {
        const before = target.hp;
        for (const fraction of [.35, .4, .5]) {
          const x = (target.x + world.parallaxX) * world.scale, y = (target.y + world.scroll) * world.scale;
          const events = world.hit(x, y, 0, target.maxHp * fraction);
          for (const event of events) tyran.fx.emit({ ...event, type: 'explosion', ground: true }, tyran.state.scroll);
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        if (target.hp < before) preflightAudit.damagedBuildings++;
        if (world.destroyed.has(target.id)) preflightAudit.destroyedBuildings++;
      }
    }
    tyran.state.events.push({ type: 'nova', x: tyran.state.width / 2, y: 400, size: 100 });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.click('#pause-button');
  assert.equal(await page.evaluate(() => flightAudio.music.paused), true, 'Pausing immediately stops the cached song');
  const pausedAt = await page.evaluate(() => flightAudio.music.currentTime);
  await page.waitForTimeout(120);
  assert(Math.abs(await page.evaluate(() => flightAudio.music.currentTime) - pausedAt) < .03, 'Paused song position stays frozen');
  await page.click('#resume-button');
  await page.waitForFunction(() => flightAudio.musicPlaying && tyran.scene === 'playing');
  // Reconfigure backing surfaces between flight samples, then verify the next
  // frame needs no new static art even at a different density and aspect ratio.
  await page.evaluate(() => { preflightAudit.phase = 'display-change'; });
  await page.click('#pause-button');
  await page.click('#pause-quality-toggle');
  await page.click('#resume-button');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => { preflightAudit.phase = 'flight'; });
  await page.waitForTimeout(150);
  await page.evaluate(() => { preflightAudit.phase = 'display-change'; });
  await page.click('#pause-button');
  await page.click('#pause-quality-toggle');
  await page.click('#resume-button');
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.evaluate(() => { preflightAudit.phase = 'flight'; });
  await page.waitForTimeout(200);
  const result = await page.evaluate(() => ({
    canvases: preflightAudit.canvases, damagedBuildings: preflightAudit.damagedBuildings, destroyedBuildings: preflightAudit.destroyedBuildings,
    songIsCached: flightAudio.music.src.startsWith('blob:'),
    scene: tyran.scene, performance: tyran.performance,
  }));
  assert(result.damagedBuildings >= 3 && result.destroyedBuildings >= 3, 'Actual first hits advance several buildings through damage and destruction');
  const expensive = result.canvases.filter(stack => /terrain-sprites\.js|makeAtlasSprite|makeDamagedFallback|StructureEffects\.getFoundation|StructureEffects\.getFixtures|\btexture \(.*effects\.js|hullSprite|lightsSprite|silhouetteSprites/.test(stack));
  assert.deepEqual(expensive, [], 'Flight never constructs materials, edge masks, recolored art or static structure/effect textures');
  assert.deepEqual(requests.filter(request => request.phase === 'after-ready'), [], 'All gameplay and display changes work without asset network requests');
  assert.equal(result.songIsCached, true);
  assert.equal(result.scene, 'playing');
  // Preparation between sectors may rebuild bounded GPU/canvas caches, but
  // every biome must keep working with files and all music already in memory.
  await page.evaluate(() => { preflightAudit.phase = 'between-sectors'; });
  const sectors = await page.evaluate(async () => {
    const visited = [];
    for (let level = 10; level < 20; level++) {
      tyran.launch(level, null, false);
      for (const pilot of tyran.state.players) pilot.hurt = 1e8;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      visited.push({ level: tyran.state.level, world: tyran.world.index, scene: tyran.scene });
    }
    // Drive an actual boss clear into the shop, then use the normal Next button.
    const { spawnEnemy, killEnemy } = await import('./sim.js');
    tyran.launch(1);
    killEnemy(tyran.state, spawnEnemy(tyran.state, 9, tyran.state.width / 2, 180));
    tyran.step(3.4);
    return visited;
  });
  assert.deepEqual(sectors.map(({ world }) => world), Array.from({ length: 10 }, (_, i) => i));
  assert(sectors.every(({ scene }) => scene === 'playing'), 'All ten environments launch offline in the next campaign cycle');
  assert.equal(await page.evaluate(() => tyran.scene), 'hangar');
  await page.click('#next-button');
  assert.equal(await page.evaluate(() => tyran.state.level), 2, 'Shop advances to the next sector offline');
  await page.click('#pause-button');
  await page.click('#restart-button');
  assert.equal(await page.evaluate(() => tyran.scene), 'playing', 'Retry uses the existing cache');
  await page.click('#pause-button');
  await page.click('#menu-button');
  await page.click('#continue-button');
  assert.equal(await page.evaluate(() => tyran.scene), 'pause', 'Saved flight resumes offline');
  await page.click('#pause-sound-toggle');
  await page.click('#resume-button');
  assert.equal(await page.evaluate(() => flightAudio.muted), true);
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => flightAudio.musicPlaying && !flightAudio.muted);
  assert.deepEqual(pendingDownloads(), [], 'No pending HTTP downloads after transitions');
  assert.deepEqual(requests.filter(request => request.phase === 'after-ready'), [], 'Flight, all sectors, shop, retry, saved resume and unmute never start a file or media load');
  assert.deepEqual(errors, [], 'Preflight and offline flight have no browser errors');
  console.log(`Preflight browser checks passed: gated title and 23 audio assets, no outstanding downloads at readiness, five prepared music players, all ten worlds/shop/retry/resume/unmute offline, zero new in-flight file/media requests or expensive texture builds (${result.canvases.length} lightweight strip/scratch canvases).`);
} finally { clearTimeout(startupTimeout); releaseSong?.(); releaseHero?.(); await browser.close(); }
