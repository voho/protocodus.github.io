// One top instrument bar; every active flight pixel belongs to the arena.
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
    const essential = ['.hull-meter', '.shield-meter', '.energy-meter', '#p1-bombs', '#p1-drones', '#p1-lives', '#p1-power',
      '#score-value', '#credits-value', '#difficulty-value', '#pause-button', '#combat-feedback',
      tyran.state.challenge && !tyran.state.challenge.done ? '#challenge-count' : '#boss-status'];
    const controls = ['#touch-stick', '#touch-fire', '#touch-secondary', '#touch-bomb'].map(selector => {
      const el = document.querySelector(selector);
      return { selector, visible: visible(el), ...bounds(el) };
    });
    const pointTargets = [.01, .5, .99].flatMap(x => [.01, .5, .99].map(y =>
      document.elementFromPoint(r.left + r.width * x, r.top + r.height * y)?.id));
    // Element boxes can fit while their text overflows a shrinking grid/flex
    // slot. Measure the actual text fragments, including clipped fragments.
    // Mission/announcement copy and reward descriptions may intentionally use
    // ellipsis; essential values and timed combat status must remain complete.
    const textSlots = [
      ['#score-value', '.score-instrument'], ['#credits-value', '.credits-instrument'],
      ['#difficulty-value', '.mission-instrument'],
      ['#p1-bombs', '.loadout-item'], ['#p1-drones', '.loadout-item'], ['#p1-lives', '.loadout-item'],
      ['#p1-energy-status', '#p1-energy-line'], ['#boss-status', '#boss-hud'],
      ['#challenge-count', '#challenge-hud'],
      ['#p1-rapid-time', '#p1-rapid'], ['#p1-invulnerable-time', '#p1-invulnerable'],
      ['#combat-feedback-score', '.combat-feedback-totals'], ['#combat-feedback-credits', '.combat-feedback-totals'],
    ];
    const pause = document.querySelector('#pause-button').getBoundingClientRect();
    const measure = document.createElement('canvas').getContext('2d');
    const textFit = textSlots.flatMap(([selector, slotSelector]) => {
      const el = document.querySelector(selector);
      if (!visible(el)) return [];
      const style = getComputedStyle(el);
      measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const metrics = measure.measureText(el.textContent);
      const range = document.createRange(); range.selectNodeContents(el);
      const fragments = [...range.getClientRects()].filter(box => box.width > 0 && box.height > 0)
        .map(box => {
          // Range includes the font's empty ascent/descent space. Chakra Petch
          // has a 24px font box on a 21px line even when the digits fit easily.
          // For matching metrics, test actual vertical ink at the Range's
          // baseline; retain its full horizontal extent and pause exclusion.
          const matched = Math.abs(box.height - metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) < 1;
          return { x: box.x, y: box.y, width: box.width, height: box.height,
            inkY: matched ? box.y + metrics.fontBoundingBoxAscent - metrics.actualBoundingBoxAscent : box.y,
            inkHeight: matched ? metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent : box.height };
        });
      const slots = [];
      for (let slot = el.closest(slotSelector); slot; slot = slot.parentElement) {
        // display:contents groups have no allocated box of their own.
        if (getComputedStyle(slot).display !== 'contents') slots.push({ tag: slot.id || slot.className || slot.tagName, ...bounds(slot) });
        if (slot.id === 'flight-header') break;
      }
      const outside = slots.filter(slot => fragments.some(box => box.x < slot.x - .75 || box.inkY < slot.y - .75
        || box.x + box.width > slot.x + slot.width + .75 || box.inkY + box.inkHeight > slot.y + slot.height + .75));
      const pauseOverlap = fragments.some(box => Math.max(0, Math.min(box.x + box.width, pause.right) - Math.max(box.x, pause.left))
        * Math.max(0, Math.min(box.y + box.height, pause.bottom) - Math.max(box.y, pause.top)) > .1);
      return [{ selector, text: el.textContent, fragments, outside, pauseOverlap }];
    });
    return { arena: bounds(surface), viewport: { width: innerWidth, height: innerHeight }, overlaps,
      visibleCore: essential.map(selector => ({ selector, visible: visible(document.querySelector(selector)), ...bounds(document.querySelector(selector)) })), controls, pointTargets,
      instruments: ['#flight-header'].map(selector => ({ selector, ...bounds(document.querySelector(selector)) })),
      oneBar: [...document.querySelector('#hud').children].length === 1
        && document.querySelector('#hud').firstElementChild.id === 'flight-header'
        && essential.every(selector => document.querySelector('#flight-header').contains(document.querySelector(selector))),
      uniformScale: Math.abs(r.width / tyran.state.width - r.height / tyran.state.height) < 1e-9,
      rootOverflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      notice: document.querySelector('#announcement-title').textContent, canvasText: [...__uiCanvasText], textFit,
    };
  });
  assert.deepEqual(result.overlaps, [], `${label}: no visible UI covers any arena pixel`);
  assert.deepEqual(result.canvasText, [], `${label}: HUD labels are never drawn over the flight canvas`);
  assert(result.uniformScale, `${label}: the reserved arena retains uniform world scale`);
  assert.equal(result.rootOverflow, false, `${label}: layout stays inside the screen`);
  assert(result.oneBar, `${label}: every flight instrument belongs to the single top bar`);
  const bar = result.instruments[0];
  assert(bar.height <= 144 && Math.abs(bar.y + bar.height - result.arena.y) < .5, `${label}: one compact bar sits directly above the arena`);
  if (!touch) assert(Math.abs(result.arena.y + result.arena.height - result.viewport.height) < .5, `${label}: no bottom HUD reserves map space`);
  assert(result.arena.height >= result.viewport.height * .5, `${label}: at least half the screen height remains playable`);
  assert(result.arena.width >= result.viewport.width * .6, `${label}: controls leave a useful flight width`);
  assert(result.pointTargets.every(id => id === 'game-canvas'), `${label}: every sampled flight point is unobstructed`);
  for (const item of result.visibleCore) {
    assert(item.visible, `${label}: ${item.selector} remains visible`);
    assert(item.x >= 0 && item.y >= 0 && item.x + item.width <= result.viewport.width + .5
      && item.y + item.height <= result.viewport.height + .5, `${label}: ${item.selector} stays on screen`);
    assert(item.y >= bar.y && item.y + item.height <= bar.y + bar.height + .5, `${label}: ${item.selector} fits inside the top bar`);
  }
  for (const item of result.textFit) {
    assert(item.fragments.length, `${label}: ${item.selector} renders its text`);
    assert.deepEqual(item.outside, [], `${label}: ${item.selector} (${item.text}) fits its allocated slots; text ${JSON.stringify(item.fragments)}`);
    assert.equal(item.pauseOverlap, false, `${label}: ${item.selector} (${item.text}) clears the pause target`);
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

async function stressLongRunHUD(page, label, touch, stable) {
  const original = await page.evaluate(() => {
    const s = tyran.state, p = s.players[0], boss = s.enemies.find(enemy => enemy.boss && !enemy.dead);
    return {
      state: { level: s.level, score: s.score, credits: s.credits, combo: s.combo, comboTime: s.comboTime, comboLabel: s.comboLabel },
      pilot: { alive: p.alive, fireEnergy: p.fireEnergy, fireEnergyLocked: p.fireEnergyLocked, rapidFireTime: p.rapidFireTime, invulnerableTime: p.invulnerableTime },
      boss: { vulnerable: boss.vulnerable, windowClock: boss.windowClock },
    };
  });
  const cases = [
    // The last unshortened total is wider than many compact large totals.
    { total: 999999, level: 9998, energy: .99, vulnerable: false },
    { total: 1e12, level: 9998, energy: 0, vulnerable: true },
    { total: Number.MAX_SAFE_INTEGER, level: 99989, energy: .99, vulnerable: false },
  ];
  for (const fixture of cases) {
    const hud = await page.evaluate(async fixture => {
      const { shipStats } = await import('./sim.js');
      const s = tyran.state, p = s.players[0], boss = s.enemies.find(enemy => enemy.boss && !enemy.dead);
      s.level = fixture.level; s.score = 0; s.credits = 0; tyran.feedback.reset(s);
      s.score = fixture.total; s.credits = fixture.total; s.combo = 99; s.comboTime = 4; s.comboLabel = 'Rampage';
      p.rapidFireTime = 10; p.invulnerableTime = 10;
      p.fireEnergy = shipStats(s.upgrades).energy * fixture.energy; p.fireEnergyLocked = true;
      boss.vulnerable = fixture.vulnerable; boss.windowClock = 10;
      tyran.feedback.collect(s, [{ type: 'pickup', bonus: 'rapid' }, { type: 'pickup', bonus: 'invulnerable' },
        { type: 'squadron' }, { type: 'rescue' }, { type: 'nova' }]);
      // Refresh presentation without advancing a high-score simulation or
      // spawning a different world; this fixture tests fixed HUD allocation.
      tyran.step(0); __uiFrame();
      const shown = id => { const el = document.getElementById(id); return !el.closest('[hidden]') && el.getBoundingClientRect().width > 0; };
      return {
        sector: document.querySelector('#level-number').textContent,
        energy: document.querySelector('#p1-energy-status').textContent,
        boss: document.querySelector('#boss-status').textContent,
        simultaneous: ['p1-rapid', 'p1-invulnerable', 'boss-hud', 'combat-feedback'].every(shown),
        notices: document.querySelector('#combat-feedback-detail').textContent,
        totals: ['score-value', 'credits-value'].map(id => { const el = document.getElementById(id); return { text: el.textContent, title: el.title, accessible: el.getAttribute('aria-label') }; }),
        rewards: ['combat-feedback-score', 'combat-feedback-credits'].map(id => ({ visible: shown(id), title: document.getElementById(id).title })),
      };
    }, fixture);
    const caseLabel = `${label}-sector-${fixture.level + 1}-totals-${fixture.total}`;
    const exact = new Intl.NumberFormat('en-US').format(fixture.total);
    assert.equal(hud.sector, `${fixture.level + 1} · Cycle ${Math.floor(fixture.level / 10) + 1}`);
    assert.equal(hud.energy, `Recharging · ${Math.floor(fixture.energy * 100)}%`);
    assert.equal(hud.boss, `${fixture.vulnerable ? 'Core exposed' : 'Armor sealed'} · 10.0s`);
    assert(hud.simultaneous && hud.notices.includes('+2 more'), `${caseLabel}: both timed bonuses, boss and multiple reward notices remain active together`);
    for (const total of hud.totals) {
      assert(total.title.startsWith(exact) && total.accessible.startsWith(exact), `${caseLabel}: compact totals retain their exact accessible value`);
      if (fixture.total === 999999) assert.equal(total.text, exact, 'the widest unshortened counter remains intact');
    }
    assert(hud.rewards.every(reward => reward.visible && reward.title.startsWith(`+${exact}`)), `${caseLabel}: both reward totals retain their exact value`);
    await audit(page, caseLabel, touch);
    assert.deepEqual(await arena(page), stable, `${caseLabel}: long-run content never changes arena geometry`);
  }
  await page.evaluate(() => { tyran.state.players[0].alive = false; tyran.step(0); __uiFrame(); });
  assert.equal(await page.locator('#p1-energy-status').textContent(), 'Offline');
  await audit(page, `${label}-offline`, touch);
  assert.deepEqual(await arena(page), stable, 'offline status never changes arena geometry');
  await page.evaluate(original => {
    const s = tyran.state;
    Object.assign(s, original.state); Object.assign(s.players[0], original.pilot);
    Object.assign(s.enemies.find(enemy => enemy.boss && !enemy.dead), original.boss);
    tyran.feedback.reset({ score: 0, credits: 0 });
    tyran.feedback.collect(s, [{ type: 'pickup', bonus: 'rapid' }, { type: 'pickup', bonus: 'invulnerable' }]);
    tyran.step(0); __uiFrame();
  }, original);
}

try {
  for (const touch of [false, true]) {
    const viewports = touch
      ? [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 568, height: 320 }, { width: 667, height: 375 }, { width: 844, height: 390 }, { width: 1024, height: 768 }]
      : [{ width: 1280, height: 720 }, { width: 1200, height: 720 }, { width: 1920, height: 1080 }, { width: 5120, height: 1440 }, { width: 760, height: 600 }];
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
      // Every announcement variant shares the updates group in the single bar.
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
      await stressLongRunHUD(page, label, touch, stable);
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
  console.log('PASS one compact top HUD: desktop, ultrawide, touch portrait/landscape, rendered text fit, long-run totals/sectors, simultaneous notices/boss/rewards/bonuses, stable geometry, unobstructed uniformly scaled arena and working touch steering.');
} finally { await browser.close(); }
