// ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs ASHLINE_URL=http://127.0.0.1:8131/fun/ashline/ node tests/features-browser-check.mjs
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true});
const url = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-features-qa';
await mkdir(output, {recursive: true});
const errors = [];
const assertPoint = (actual, expected) => assert(actual && Math.abs(actual.x - expected.x) < 1e-6 && Math.abs(actual.y - expected.y) < 1e-6, 'Rally matches the clicked ground position');
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
};
const advance = (page, seconds) => page.evaluate(async seconds => {
  const {updateGame} = await import('./sim.js');
  for (let i = 0; i < seconds * 20; i++) updateGame(ashline.state, .05);
}, seconds);
const worldPoint = (page, x, y) => page.evaluate(({x, y}) => {
  const p = ashline.renderer.worldToScreen(x, y, ashline.view);
  const r = document.querySelector('#world').getBoundingClientRect();
  return {x: p.x + r.x, y: p.y + r.y};
}, {x, y});
const clickWorld = async (page, x, y, button = 'left', touch = false) => {
  const p = await worldPoint(page, x, y);
  if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y, {button});
};
async function selectProducer(page, id, touch = false) {
  const center = await page.evaluate(id => {
    const e = ashline.state.entities.find(e => e.id === id);
    const center = {x: e.x + e.size / 2, y: e.y + e.size / 2};
    ashline.view.x = center.x; ashline.view.y = center.y; ashline.view.selected.clear();
    return center;
  }, id);
  await page.waitForTimeout(90);
  await clickWorld(page, center.x, center.y, 'left', touch);
  assert.deepEqual(await page.evaluate(() => [...ashline.view.selected]), [id]);
  return center;
}
const readQueue = (page, id) => page.evaluate(id => ashline.state.entities.find(e => e.id === id).queue, id);
const stateJSON = page => page.evaluate(async () => {
  const {encodeGame} = await import('./save.js'); return JSON.parse(encodeGame(ashline.state)).game;
});

try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}}); watch(page);
  await page.goto(url); await page.waitForFunction(() => window.ashline?.assets.ready);
  await page.locator('#seed').fill('FEATURES-BROWSER');
  await page.locator('#deploy').click();
  await page.waitForFunction(() => !ashline.paused && ashline.state.time > 0);
  await page.locator('#pause').click();

  // Assemble a paid base through simulation commands; actual UI controls are tested below.
  const producers = await page.evaluate(async () => {
    const {BUILDINGS, canPlace, placeBuilding, updateGame, getEntity, powerStats} = await import('./sim.js');
    const s = ashline.state; s.ai.nextThink = 1e12; s.teams[0].credits = 50000;
    function construct(type) {
      const sites = [], core = s.entities.find(e => e.team === 0 && e.type === 'core');
      for (let y = core.y - 15; y < core.y + 15; y++) for (let x = core.x - 9; x < core.x + 25; x++) if (canPlace(s, 0, type, x, y).ok) sites.push({x, y});
      sites.sort((a, b) => Math.hypot(a.x - core.x - 4, a.y - core.y + 3) - Math.hypot(b.x - core.x - 4, b.y - core.y + 3));
      if (!sites.length) throw new Error(`No build site for ${type}`);
      const e = getEntity(s, placeBuilding(s, 0, type, sites[0].x, sites[0].y).id);
      const duration = BUILDINGS[type].buildTime / Math.max(.2, powerStats(s, 0).ratio) + 1;
      for (let i = 0; i < duration * 20; i++) updateGame(s, .05);
      return e.id;
    }
    construct('reactor'); construct('reactor');
    const barracks = [construct('barracks'), construct('barracks')];
    const factories = [construct('factory'), construct('factory')];
    return {barracks, factories, refinery: s.entities.find(e => e.team === 0 && e.type === 'refinery').id};
  });
  await page.locator('#resume').click();

  // Right-click rallies every producer class; the button and R shortcut work with left-click.
  for (const id of [producers.barracks[0], producers.factories[0], producers.refinery]) {
    const c = await selectProducer(page, id);
    const destination = {x: c.x + 4, y: c.y - 3};
    await clickWorld(page, destination.x, destination.y, 'right');
    assertPoint(await page.evaluate(id => ashline.state.entities.find(e => e.id === id).rally, id), destination);
  }
  let c = await selectProducer(page, producers.factories[1]);
  await page.locator('#rally-order').click();
  await clickWorld(page, c.x + 5, c.y + 2);
  assertPoint(await page.evaluate(id => ashline.state.entities.find(e => e.id === id).rally, producers.factories[1]), {x: c.x + 5, y: c.y + 2});
  c = await selectProducer(page, producers.barracks[1]);
  await page.keyboard.press('r'); await clickWorld(page, c.x + 3, c.y - 4);
  assertPoint(await page.evaluate(id => ashline.state.entities.find(e => e.id === id).rally, producers.barracks[1]), {x: c.x + 3, y: c.y - 4});

  if (await page.locator('#command-console').isHidden()) await page.locator('#command-toggle').click();
  await page.locator('#train-tab').click();
  const tankCard = page.locator('.build-card[data-type="tank"]');
  await selectProducer(page, producers.factories[0]);
  await tankCard.click(); await tankCard.click();
  assert.equal((await readQueue(page, producers.factories[0])).length, 2, 'Selected foundry gets both requested tanks');
  assert.equal((await readQueue(page, producers.factories[1])).length, 0);
  await selectProducer(page, producers.factories[1]); await tankCard.click();
  assert.equal((await readQueue(page, producers.factories[1])).length, 1);
  await advance(page, 2);
  assert((await readQueue(page, producers.factories[0]))[0].progress > .1);
  assert((await readQueue(page, producers.factories[1]))[0].progress > .1, 'Both foundries progress concurrently');
  await page.waitForFunction(() => Number(document.querySelector('.build-card[data-type="tank"] .card-queue-count').textContent.replace(/\D/g, '')) === 3);
  assert(await tankCard.locator('.card-production').isVisible());
  await page.waitForFunction(() => {
    const bars = [...document.querySelectorAll('.build-card[data-type="tank"] .card-production [role="progressbar"]')];
    return bars.length === 2 && bars.every(bar => Number(bar.getAttribute('aria-valuenow')) > 0 && Number(bar.getAttribute('aria-valuenow')) < 100);
  });
  await page.screenshot({path: `${output}/parallel-production.png`});

  // With selection cleared, the catalog chooses remaining work rather than queue length.
  await page.keyboard.press('Escape');
  await page.evaluate(ids => {
    const [a, b] = ids.map(id => ashline.state.entities.find(e => e.id === id));
    a.queue = [{type: 'tank', progress: .75}, {type: 'tank', progress: 0}];
    b.queue = [{type: 'artillery', progress: 0}];
  }, producers.factories);
  await tankCard.click();
  assert.equal((await readQueue(page, producers.factories[0])).length, 3);
  assert.equal((await readQueue(page, producers.factories[1])).length, 1);

  // The pause menu exposes independent audio controls and stops playback during a pause.
  await page.locator('#pause').click();
  await page.waitForFunction(() => ashline.audio.unlocked && ashline.audio.paused && !ashline.audio.musicPlaying);
  const audioBefore = await page.evaluate(() => ashline.audio);
  await page.locator('#sfx-toggle').click(); await page.locator('#music-toggle').click();
  assert.equal(await page.evaluate(() => ashline.audio.sfxEnabled), !audioBefore.sfxEnabled);
  assert.equal(await page.evaluate(() => ashline.audio.musicEnabled), !audioBefore.musicEnabled);
  await page.locator('#sfx-toggle').click(); await page.locator('#music-toggle').click();

  // Saving through the menu and loading over changed state restores the complete operation.
  const fogMemory = await page.evaluate(() => {
    ashline.view.x = 32; ashline.view.y = 28; ashline.view.zoom = 30;
    const s = ashline.state, enemy = s.entities.find(e => e.team === 1 && e.type === 'core');
    for (let y = enemy.y; y < enemy.y + enemy.size; y++) for (let x = enemy.x; x < enemy.x + enemy.size; x++) s.explored[0][y * s.width + x] = 1;
    ashline.renderer.rememberedBuildings.set(enemy.id, {...enemy, queue: [], rememberedAt: s.time});
    const tile = s.minerals.findIndex((amount, index) => amount > 0 && !s.visible[0][index]);
    s.explored[0][tile] = 1; ashline.renderer.knownOre[tile] = 123.25;
    return {id: enemy.id, tile, amount: 123.25};
  });
  await page.locator('#save-game').click();
  await page.waitForFunction(async () => {
    const {SAVE_KEY} = await import('./save.js'); return Boolean(localStorage.getItem(SAVE_KEY));
  });
  const saved = await page.evaluate(async () => {
    const {SAVE_KEY} = await import('./save.js'); return {key: SAVE_KEY, raw: localStorage.getItem(SAVE_KEY)};
  });
  const record = JSON.parse(saved.raw);
  assert((await page.locator('#save-status').textContent()).trim().length > 0);
  await page.evaluate(() => { ashline.state.teams[0].credits += 123; ashline.view.x = 45; ashline.view.zoom = 40; });
  await page.locator('#load-game').click();
  assert(await page.evaluate(() => ashline.paused && document.querySelector('#menu').open));
  assert.deepEqual(await stateJSON(page), record.game);
  assert.deepEqual(await page.evaluate(() => ({x: ashline.view.x, y: ashline.view.y, zoom: ashline.view.zoom})), record.view);
  assert(await page.evaluate(({id, tile, amount}) => ashline.renderer.rememberedBuildings.has(id) && ashline.renderer.knownOre[tile] === amount, fogMemory), 'Loading preserves last-seen buildings and mineral fields');
  await page.screenshot({path: `${output}/save-and-audio.png`});
  const pausedAt = await page.evaluate(() => ashline.state.time);
  await page.waitForTimeout(200); assert.equal(await page.evaluate(() => ashline.state.time), pausedAt);
  await page.locator('#resume').click();
  await page.waitForFunction(time => !ashline.paused && ashline.state.time > time, pausedAt);
  await page.waitForFunction(() => ashline.audio.musicPlaying || Boolean(ashline.audio.musicError));
  assert.equal(await page.evaluate(() => ashline.audio.musicError), '', 'Locally hosted soundtrack plays after resume');
  const playedBefore = await page.evaluate(() => ashline.audio.played);
  await selectProducer(page, producers.factories[0]);
  assert(await page.evaluate(before => ashline.audio.played > before, playedBefore), 'Selection plays a generated effect');
  await page.locator('#pause').click();

  // A corrupt save is reported without replacing the currently running operation.
  const current = await stateJSON(page);
  await page.evaluate(key => localStorage.setItem(key, '{broken save'), saved.key);
  await page.locator('#load-game').click();
  assert.deepEqual(await stateJSON(page), current);
  assert(await page.evaluate(() => ashline.paused && document.querySelector('#menu').open));
  await page.waitForFunction(() => /damaged|corrupt|could not|incompatible/i.test(document.querySelector('#save-status').textContent));

  // The saved operation survives a full reload and can be resumed from the briefing.
  await page.evaluate(({key, raw}) => localStorage.setItem(key, raw), saved);
  await page.reload(); await page.waitForFunction(() => window.ashline?.assets.ready);
  assert(await page.locator('#briefing').evaluate(dialog => dialog.open));
  assert(await page.locator('#load-saved').isEnabled());
  await page.locator('#load-saved').click();
  assert(await page.evaluate(() => ashline.paused && !document.querySelector('#briefing').open && document.querySelector('#menu').open));
  assert.deepEqual(await stateJSON(page), record.game);
  assert.deepEqual(await page.evaluate(() => ({x: ashline.view.x, y: ashline.view.y, zoom: ashline.view.zoom})), record.view);
  assert(await page.evaluate(({id, tile, amount}) => ashline.renderer.rememberedBuildings.has(id) && ashline.renderer.knownOre[tile] === amount, fogMemory), 'Reloading restores fog knowledge to the fresh renderer');
  await page.close();

  // Touch users can place refinery rallies and reach save/load/audio controls without overflow.
  const mobile = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2}); watch(mobile);
  await mobile.goto(url); await mobile.waitForFunction(() => window.ashline?.assets.ready);
  await mobile.locator('#deploy').tap();
  const refineryId = await mobile.evaluate(() => ashline.state.entities.find(e => e.team === 0 && e.type === 'refinery').id);
  const refineryCenter = await selectProducer(mobile, refineryId, true);
  await mobile.locator('#rally-order').tap();
  await clickWorld(mobile, refineryCenter.x + 3, refineryCenter.y - 3, 'left', true);
  assertPoint(await mobile.evaluate(id => ashline.state.entities.find(e => e.id === id).rally, refineryId), {x: refineryCenter.x + 3, y: refineryCenter.y - 3});
  await mobile.locator('#pause').tap();
  await mobile.locator('#save-game').tap();
  assert(await mobile.locator('#load-game').isEnabled());
  await mobile.locator('#sfx-toggle').tap(); await mobile.locator('#music-toggle').tap();
  await mobile.locator('#load-game').tap();
  assert(await mobile.evaluate(() => ashline.paused && document.querySelector('#menu').open));
  assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal mobile overflow');
  await mobile.screenshot({path: `${output}/save-menu-mobile.png`});
  assert.deepEqual(errors, [], 'No browser runtime or console errors');
  console.log(`Ashline feature browser checks passed: all producer rallies, concurrent queues/card progress, producer routing, generated effects/music controls, persistent save/load/corruption handling, and touch controls. Screenshots: ${output}`);
} finally { await browser.close(); }
