// Delayed startup stays prominent; readiness removes every loading layer.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8774/fun/tyran/';
const output = process.env.TYRAN_LOADING_OUTPUT || '/tmp/tyran-loader-qa';
const errors = [], results = [];
await mkdir(output, { recursive: true });

try {
  for (const viewport of [
    { width: 3840, height: 2160 }, { width: 1280, height: 720 },
    { width: 320, height: 568 }, { width: 568, height: 320 },
  ]) {
    const touch = viewport.width < 600, reducedMotion = viewport.width === 320 ? 'reduce' : 'no-preference';
    const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, reducedMotion, deviceScaleFactor: 1 });
    const page = await context.newPage();
    let releaseSong, notifyHeld, timeout;
    const songHeld = new Promise(resolve => { notifyHeld = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => {
      localStorage.setItem('tyran-muted', 'true');
      const frames = new Map(); let id = 0, time = 1000;
      window.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
      window.cancelAnimationFrame = id => frames.delete(id);
      window.__loadingAdvance = count => {
        for (let i = 0; i < count; i++) {
          time += 1000 / 60;
          const callbacks = [...frames.values()]; frames.clear();
          callbacks.forEach(callback => callback(time));
        }
      };
    });
    await page.route('**/assets/audio/music/1.mp3', async route => {
      notifyHeld();
      await new Promise(resolve => { releaseSong = resolve; });
      await route.continue();
    });
    try {
      await page.goto(url, { waitUntil: 'commit' });
      await Promise.race([songHeld, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Startup never requested its soundtrack')), 10000); })]);
      clearTimeout(timeout);
      await page.waitForFunction(() => /Preparing flight… \d+%/.test(document.querySelector('#startup-status').textContent), null, { polling: 20 });
      await page.evaluate(() => document.fonts.ready);
      const loading = await page.evaluate(() => {
        const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        const overlay = document.querySelector('#startup-loader'), card = document.querySelector('.startup-card');
        const status = document.querySelector('#startup-status'), title = document.querySelector('#startup-title');
        return {
          ready: document.body.dataset.ready, menuInert: document.querySelector('#menu-screen').inert,
          overlay: box(overlay), card: box(card), title: box(title), status: box(status), message: status.textContent,
          statusRole: status.getAttribute('role'), live: status.getAttribute('aria-live'), atomic: status.getAttribute('aria-atomic'),
          label: overlay.getAttribute('aria-labelledby'), centerInLoader: overlay.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 2)),
          overflow: [title, status, document.querySelector('.startup-note')].some(el => el.scrollWidth > el.clientWidth)
            || document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
          activityAnimation: getComputedStyle(document.querySelector('.startup-activity>span')).animationName,
        };
      });
      const label = `${touch ? 'touch' : 'desktop'}-${viewport.width}x${viewport.height}`;
      assert.notEqual(loading.ready, 'true', `${label}: the last asset keeps startup pending`);
      assert.equal(loading.menuInert, true, `${label}: launch stays unavailable until assets finish`);
      assert.deepEqual(loading.overlay, { x: 0, y: 0, ...viewport }, `${label}: loading covers the full viewport`);
      assert(Math.abs(loading.card.x + loading.card.width / 2 - viewport.width / 2) < 1, `${label}: card is horizontally centered`);
      assert(Math.abs(loading.card.y + loading.card.height / 2 - viewport.height / 2) < 1, `${label}: card is vertically centered`);
      assert(loading.card.x >= 0 && loading.card.y >= 0 && loading.card.x + loading.card.width <= viewport.width
        && loading.card.y + loading.card.height <= viewport.height, `${label}: the whole card stays on screen`);
      assert(loading.title.height >= 30 && loading.status.height >= 25, `${label}: loading title and progress remain prominent`);
      assert.equal(loading.overflow, false, `${label}: loading copy fits without horizontal scrolling`);
      assert.equal(loading.centerInLoader, true, `${label}: loading owns the visual center`);
      assert.equal(loading.statusRole, 'status'); assert.equal(loading.live, 'polite'); assert.equal(loading.atomic, 'true');
      assert.equal(loading.label, 'startup-title', `${label}: loading region has a descriptive accessible name`);
      assert.equal(loading.activityAnimation, reducedMotion === 'reduce' ? 'none' : 'startup-scan', `${label}: activity respects the motion preference`);
      await page.screenshot({ path: `${output}/${label}-loading.png` });

      releaseSong();
      await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
      const ready = await page.evaluate(() => {
        const overlay = document.querySelector('#startup-loader');
        return { display: getComputedStyle(overlay).display, rects: [overlay, ...overlay.querySelectorAll('*')].map(el => el.getClientRects().length),
          animations: overlay.getAnimations({ subtree: true }).length, menuInert: document.querySelector('#menu-screen').inert };
      });
      assert.equal(ready.display, 'none', `${label}: the full overlay disappears on readiness`);
      assert(ready.rects.every(count => count === 0), `${label}: no hidden loading child occupies or intercepts a rectangle`);
      assert.equal(ready.animations, 0, `${label}: hidden loading animations stop`);
      assert.equal(ready.menuInert, false, `${label}: flight command becomes interactive`);
      await page.locator('#launch-button').click();
      assert.equal(await page.evaluate(() => tyran.scene), 'playing', `${label}: actual launch click reaches the game`);
      await page.evaluate(() => { tyran.state.director.hold = true; tyran.state.players[0].guard = 10000; __loadingAdvance(2); document.querySelector('#game-canvas').blur(); });
      await page.locator('#game-canvas').click();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'game-canvas', `${label}: arena receives pointer focus`);
      const before = await page.evaluate(() => tyran.state.players[0].x);
      await page.keyboard.down('KeyD'); await page.keyboard.down('Space');
      await page.evaluate(() => __loadingAdvance(12));
      const flight = await page.evaluate(() => ({ x: tyran.state.players[0].x, fired: tyran.state.bullets.some(bullet => bullet.team === 0),
        loaderVisible: document.querySelector('#startup-loader').getClientRects().length > 0 }));
      await page.keyboard.up('KeyD'); await page.keyboard.up('Space');
      assert(flight.x > before && flight.fired, `${label}: movement and fire work after loading`);
      assert.equal(flight.loaderVisible, false, `${label}: the loading layer stays absent throughout flight`);
      await page.screenshot({ path: `${output}/${label}-flight.png` });
      results.push({ label, reducedMotion, loading, ready, flight });
    } finally { clearTimeout(timeout); releaseSong?.(); await context.close(); }
  }
  assert.deepEqual(errors, [], 'Startup and first flight have no browser or resource errors');
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log('PASS centered loading: delayed assets, 4K/desktop/small touch portrait and landscape, accessible progress, reduced motion, complete removal on readiness and working flight input.');
} finally { await browser.close(); }
