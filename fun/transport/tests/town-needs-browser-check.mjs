// Town needs in a real browser: the town inspector's Town economy fold lists what its shops want,
// counts the first real food delivery, and names the cargo a slowed zone is waiting for; the Towns
// list and a waiting zone's note explain the rest.
// Serve the repository root first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-town-needs-qa';
await mkdir(output, { recursive: true });
const errors = [];
const inspectHome = page => page.evaluate(() => { const town = transport.game.cities[0]; transport.renderer.focus(town.x, town.y); transport.inspect(town.x, town.y, 'city'); });
const want = cargo => `#inspector .want:has([data-cargo-icon="${cargo}"])`;
const openEconomy = async page => { await page.locator('#inspector .town-economy').waitFor(); if (!await page.locator('#inspector .town-economy').evaluate(el => el.open)) { await page.locator('#inspector .town-economy summary').click(); await page.evaluate(() => document.activeElement.blur()); } };

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await createWorldFromMenu(page);

  // The starter bus alone: the needs wait in the closed Town economy fold.
  await inspectHome(page);
  await page.locator('#inspector h3').waitFor();
  assert.equal(await page.locator('#inspector .town-economy').evaluate(el => el.open), false);

  // A food plant beside a stop that reaches Alderbrook, and a truck that has not yet delivered.
  await page.evaluate(async () => {
    const { build, addRoute } = await import('./model.js'), { buildPlan } = await import('./construction-plan.js'), game = transport.game;
    game.money = 5e6;
    const points = []; for (let y = 251; y >= 245; y--) points.push({ x: 219, y });
    if (!buildPlan(game, 'road', points, { preferredMode: 'road' }).ok || !build(game, 'bus-stop', 219, 251).ok) throw new Error('stop failed');
    let placed = false;
    for (let r = 2; r <= 6 && !placed; r++) for (let dy = -r; dy <= r && !placed; dy++) for (let dx = -r; dx <= r && !placed; dx++) placed = build(game, 'food-plant', 219 + dx, 251 + dy).ok;
    if (!placed) throw new Error('food plant failed');
    game.industries.at(-1).inventory.food = 60;
    if (!addRoute(game, { mode: 'road', stops: [game.stations.at(-1).id, 'station-1'], cargo: 'food' }).ok) throw new Error('route failed');
  });
  await inspectHome(page);
  await openEconomy(page);
  assert.equal(await page.locator('#inspector .town-economy h4').textContent(), 'Shops want each month');
  assert.deepEqual(await page.locator('#inspector .want [data-cargo-icon]').evaluateAll(els => els.map(el => el.dataset.cargoIcon)), ['food', 'furniture', 'fuel']);
  assert.equal(await page.locator('#inspector .want.met').count(), 0, 'nothing is supplied yet, and nothing reads as a problem');
  assert.equal(await page.locator('#inspector .town-economy .condition-concern').count(), 0);
  assert.match(await page.locator(want('food')).textContent(), /Food\s*0 of \d+/);
  await page.locator('#inspector').screenshot({ path: `${output}/needs-before-food.png` });

  // The live refresh flips the food badge once the truck unloads.
  await page.evaluate(() => transport.setSpeed(8));
  await page.waitForFunction(() => transport.game.routes.at(-1).delivered > 0, undefined, { timeout: 30000 });
  await page.waitForFunction(() => /Food\s*[1-9]/.test(document.querySelector('#inspector .want:has([data-cargo-icon="food"])')?.textContent || ''), undefined, { timeout: 5000 });
  await page.evaluate(() => transport.setSpeed(0));
  assert.ok(await page.evaluate(() => transport.game.cities[0].lastSupply.food <= transport.game.day));
  assert.equal(await page.locator(`${want('furniture')}.met`).count(), 0);
  await page.locator('#inspector').screenshot({ path: `${output}/needs-after-food.png` });

  // The towns list names only what each town has received.
  await page.evaluate(() => { document.querySelector('#inspector .tiny-button').click(); transport.setView('towns'); });
  const home = page.locator('#entity-list .entity-card').first();
  await home.locator('.town-need-metric').waitFor();
  assert.deepEqual(await home.locator('.need-icon').evaluateAll(els => els.map(el => el.getAttribute('aria-label'))), ['Food, delivered recently']);
  assert.equal(await page.locator('#entity-list .town-need-metric').count(), 1, 'unsupplied towns keep their compact card');
  await page.screenshot({ path: `${output}/towns-list.png` });
  await page.locator('#close-management').click();
  await page.locator('#close-management').waitFor({ state: 'hidden' });
  await page.waitForTimeout(400);

  // A zone waiting on food explains it as a neutral note, never as a concern.
  const zone = await page.evaluate(async () => {
    const { build } = await import('./model.js'), game = transport.game, town = game.cities[0];
    town.lastSupply = {};
    for (let r = 2; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = town.x + dx, y = town.y + dy, tile = game.tiles[y * game.width + x];
      if (!tile.building && !tile.road && !tile.zone && build(game, 'residential', x, y).ok) { game.zones.at(-1).progress = 1.4; transport.inspect(x, y); return { x, y }; }
    }
  });
  assert.ok(zone, 'a residential plot beside Alderbrook');
  await page.locator('#inspector .condition-note').waitFor();
  assert.equal(await page.locator('#inspector .condition-note').textContent(), 'Faster with food deliveries');
  assert.equal(await page.locator('#inspector .condition-concern', { hasText: /food/i }).count(), 0);
  await page.locator('#inspector').screenshot({ path: `${output}/zone-note.png` });
  // While that tier waits for food, the town's Town economy fold names the cargo that would speed it up.
  await inspectHome(page);
  await openEconomy(page);
  await page.locator('#inspector .town-economy .economy-note', { hasText: 'Food deliveries help homes grow into comfortable homes.' }).waitFor();

  assert.deepEqual(errors, []);
  console.log('Town needs browser check passed');
} finally {
  await browser.close();
}
