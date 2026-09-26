// Every active flight pixel belongs to the arena; instruments live beside it.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8774/fun/tyran/';
const output = process.env.TYRAN_UI_OUTPUT || '/tmp/tyran-ui-qa';
const errors = [], results = [];
await mkdir(output, { recursive: true });

async function newPage(touch, viewport) {
  const page = await browser.newPage({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    localStorage.setItem('tyran-muted', 'true');
    const frames = new Map(); let id = 0, time = 1000;
    window.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
    window.cancelAnimationFrame = id => frames.delete(id);
    window.__uiFrame = (milliseconds = 0) => {
      time += milliseconds;
      const callbacks = [...frames.values()]; frames.clear();
      callbacks.forEach(callback => callback(time));
    };
    window.__uiAdvance = count => { for (let i = 0; i < count; i++) __uiFrame(1000 / 60); };
    window.__uiCanvasText = [];
    for (const method of ['fillText', 'strokeText']) {
      const original = CanvasRenderingContext2D.prototype[method];
      CanvasRenderingContext2D.prototype[method] = function (text, ...args) {
        if (this.canvas.id === 'game-canvas') __uiCanvasText.push(String(text));
        return original.call(this, text, ...args);
      };
    }
  });
  await page.goto(url);
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
  return page;
}

const arena = page => page.locator('#game-canvas').boundingBox();
async function settled(page) {
  await page.waitForFunction(() => {
    const rect = document.querySelector('#game-canvas').getBoundingClientRect();
    return !tyran.state || Math.abs(tyran.state.width - 900 * rect.width / rect.height) < 1e-7;
  }, null, { polling: 20 });
  await page.evaluate(() => __uiFrame());
}

async function audit(page, label, touch) {
  const result = await page.evaluate(() => {
    const surface = document.querySelector('#game-canvas'), r = surface.getBoundingClientRect();
    const bounds = el => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const visible = el => {
      if (el.closest('[hidden]')) return false;
      const style = getComputedStyle(el), box = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0 && box.width > 0 && box.height > 0;
    };
    const overlap = box => Math.max(0, Math.min(r.right, box.x + box.width) - Math.max(r.left, box.x))
      * Math.max(0, Math.min(r.bottom, box.y + box.height) - Math.max(r.top, box.y));
    const ui = [...document.querySelectorAll('#hud *, #touch-controls, #touch-controls *')].filter(visible);
    const overlaps = ui.map(el => ({ tag: el.id || el.className || el.tagName, box: bounds(el) }))
      .filter(({ box }) => overlap(box) > .1);
    const essential = ['.hull-meter', '.shield-meter', '.energy-meter', '#p1-bombs', '#difficulty-value', '#pause-button', '#combat-feedback',
      tyran.state.challenge && !tyran.state.challenge.done ? '#challenge-count' : '#boss-status'];
    const controls = ['#touch-stick', '#touch-fire', '#touch-secondary', '#touch-bomb'].map(selector => {
      const el = document.querySelector(selector);
      return { selector, visible: visible(el), ...bounds(el) };
    });
    const pointTargets = [.01, .5, .99].flatMap(x => [.01, .5, .99].map(y =>
      document.elementFromPoint(r.left + r.width * x, r.top + r.height * y)?.id));
    return { arena: bounds(surface), viewport: { width: innerWidth, height: innerHeight }, overlaps,
      visibleCore: essential.map(selector => ({ selector, visible: visible(document.querySelector(selector)), ...bounds(document.querySelector(selector)) })), controls, pointTargets,
      instruments: ['#flight-header', '.hud-bottom'].map(selector => ({ selector, ...bounds(document.querySelector(selector)) })),
      uniformScale: Math.abs(r.width / tyran.state.width - r.height / tyran.state.height) < 1e-9,
      rootOverflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      notice: document.querySelector('#announcement-title').textContent, canvasText: [...__uiCanvasText],
    };
  });
  assert.deepEqual(result.overlaps, [], `${label}: no visible UI covers any arena pixel`);
  assert.deepEqual(result.canvasText, [], `${label}: HUD labels are never drawn over the flight canvas`);
  assert(result.uniformScale, `${label}: the reserved arena retains uniform world scale`);
  assert.equal(result.rootOverflow, false, `${label}: layout stays inside the screen`);
  assert(result.arena.height >= result.viewport.height * .5, `${label}: at least half the screen height remains playable`);
  assert(result.arena.width >= result.viewport.width * .6, `${label}: controls leave a useful flight width`);
  assert(result.pointTargets.every(id => id === 'game-canvas'), `${label}: every sampled flight point is unobstructed`);
  for (const item of result.visibleCore) {
    assert(item.visible, `${label}: ${item.selector} remains visible`);
    assert(item.x >= 0 && item.y >= 0 && item.x + item.width <= result.viewport.width + .5
      && item.y + item.height <= result.viewport.height + .5, `${label}: ${item.selector} stays on screen`);
  }
  for (const control of result.controls) if (touch) {
    assert(control.visible && control.width >= 44 && control.height >= 44, `${label}: ${control.selector} remains a usable touch target`);
    assert(control.x >= 0 && control.y >= 0 && control.x + control.width <= result.viewport.width + .5
      && control.y + control.height <= result.viewport.height + .5, `${label}: ${control.selector} fits the screen`);
    for (const obstacle of [...result.instruments, ...result.controls.filter(other => other !== control)]) {
      const x = Math.max(0, Math.min(control.x + control.width, obstacle.x + obstacle.width) - Math.max(control.x, obstacle.x));
      const y = Math.max(0, Math.min(control.y + control.height, obstacle.y + obstacle.height) - Math.max(control.y, obstacle.y));
      assert(x * y < .1, `${label}: ${control.selector} clears ${obstacle.selector}`);
    }
  } else assert(!control.visible, `${label}: desktop does not reserve visible touch targets`);
  results.push({ label, ...result });
  return result;
}

try {
  for (const touch of [false, true]) {
    const viewports = touch
      ? [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 568, height: 320 }, { width: 667, height: 375 }, { width: 844, height: 390 }, { width: 1024, height: 768 }]
      : [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 5120, height: 1440 }, { width: 760, height: 600 }];
    const page = await newPage(touch, viewports[0]);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport); await settled(page);
      const beforeLaunch = await arena(page);
      await page.evaluate(() => {
        tyran.launch(7); const s = tyran.state; s.director.hold = true;
        s.players[0].guard = 10000; __uiFrame();
      });
      await settled(page);
      assert.deepEqual(await arena(page), beforeLaunch, 'launch reuses the exact geometry prepared by the menu');
      const stable = await arena(page);
      await page.evaluate(async () => {
        const { spawnEnemy, killEnemy } = await import('./sim.js');
        const s = tyran.state, p = s.players[0];
        for (let i = 0; i < 5; i++) killEnemy(s, spawnEnemy(s, 0, 100 + i * 65, 230));
        p.power = 4; p.drones = 2;
        for (const kind of ['rapid', 'invulnerable', 'credit']) s.pickups.push({ x: p.x, y: p.y, age: 0, kind, value: 1234567 });
        spawnEnemy(s, 9, s.width / 2, 200);
        s.events.push({ type: 'boss' }); tyran.step(1 / 60); __uiFrame();
      });
      await settled(page);
      const label = `${touch ? 'touch' : 'desktop'}-${viewport.width}x${viewport.height}`;
      await audit(page, label, touch);
      assert.deepEqual(await arena(page), stable, `${label}: boss, bonuses and reward notices never resize the arena`);
      // Every announcement variant shares the reserved message strip.
      for (const type of ['wave', 'challenge', 'phase']) {
        await page.evaluate(type => { tyran.state.events.push({ type, wave: 3, total: 40, kind: 'hive' }); tyran.step(1 / 60); __uiFrame(); }, type);
        await audit(page, `${label}-${type}`, touch);
        assert.deepEqual(await arena(page), stable);
      }
      await page.screenshot({ path: `${output}/${label}.png` });
      const recharge = await page.evaluate(() => {
        const p = tyran.state.players[0]; p.fireEnergy = 0; p.fireEnergyLocked = true; tyran.step(0); __uiFrame();
        const line = document.querySelector('#p1-energy-line'), status = document.querySelector('#p1-energy-status');
        const word = line.firstElementChild, range = document.createRange(); range.selectNodeContents(status);
        const text = range.getBoundingClientRect(), box = line.getBoundingClientRect();
        const wordVisible = getComputedStyle(word).display !== 'none' && getComputedStyle(word).visibility === 'visible';
        range.selectNodeContents(word); const label = range.getBoundingClientRect();
        return { value: status.textContent, fits: text.left >= box.left - .5 && text.right <= box.right + .5,
          clearsLabel: !wordVisible || label.right <= text.left + .5 };
      });
      assert.match(recharge.value, /Recharging/);
      assert(recharge.fits && recharge.clearsLabel, `${label}: depleted-energy status remains legible inside its instrument`);
      await audit(page, `${label}-recharging`, touch);
      assert.deepEqual(await arena(page), stable, 'depleted-energy text does not resize the arena');
      await page.evaluate(() => { const p = tyran.state.players[0]; p.fireEnergy = 100; p.fireEnergyLocked = false; tyran.step(0); __uiFrame(); });
      await page.evaluate(() => { tyran.pause(); __uiFrame(); });
      assert.deepEqual(await arena(page), stable, 'pause preserves the arena geometry');
      await page.evaluate(() => { tyran.pause(); __uiFrame(); });
      assert.deepEqual(await arena(page), stable, 'resume preserves the arena geometry');
      if (touch) {
        const session = await page.context().newCDPSession(page);
        const stick = await page.locator('#touch-stick').boundingBox(), x = stick.x + stick.width / 2, y = stick.y + stick.height / 2;
        const before = await page.evaluate(() => { const p = tyran.state.players[0]; p.x = tyran.state.width / 2; return p.x; });
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 42, y: y - 42, id: 1 }] });
        await page.evaluate(() => __uiAdvance(12));
        assert(await page.evaluate(() => tyran.state.players[0].x) > before, 'the reserved joystick still steers');
        await audit(page, `${label}-steering`, true);
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await session.detach();
      }
      await page.evaluate(async () => {
        const { startChallenge } = await import('./waves.js');
        const { spawnEnemy, killEnemy } = await import('./sim.js');
        const s = tyran.state; s.enemies.length = 0;
        startChallenge(s, spawnEnemy);
        for (const enemy of s.enemies.slice(0, 4)) killEnemy(s, enemy);
        tyran.step(1 / 60); __uiFrame(); __uiAdvance(200);
      });
      assert.equal(await page.locator('#challenge-count').textContent(), '4 / 40 hits', 'the reserved count follows real challenge kills');
      assert(await page.locator('#announcement').isHidden(), 'the introductory challenge notice expires');
      await audit(page, `${label}-challenge-count`, touch);
      assert.deepEqual(await arena(page), stable, 'the persistent challenge readout never resizes the arena');
      await page.evaluate(() => { tyran.pause(); document.querySelector('#menu-button').click(); __uiFrame(); });
      assert.deepEqual(await arena(page), stable, 'returning to menu keeps prewarming at flight dimensions');
    }
    await page.close();
  }
  assert.deepEqual(errors, [], 'UI layout and controls produce no runtime/resource errors');
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log('PASS unobstructed arena: desktop, ultrawide, touch portrait/landscape, all announcement styles, boss/rewards/bonuses, stable menu/pause geometry, uniform scaling and working touch steering.');
} finally { await browser.close(); }
