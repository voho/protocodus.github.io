// Town needs in a real browser: the row stays hidden on a fresh start, appears with the first
// freight route, and the food badge earns its check after the first real food delivery.
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
const chip = cargo => `#inspector .need-chip:has([data-cargo="${cargo}"])`;

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await createWorldFromMenu(page);

  // The starter bus alone keeps the town inspector as it was.
  await inspectHome(page);
  await page.locator('#inspector h3').waitFor();
  assert.equal(await page.locator('#inspector .town-needs').count(), 0, 'no needs row before a zone or a freight route');

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
  await page.locator('#inspector .town-needs').waitFor();
  assert.equal(await page.locator('#inspector .town-needs h4').textContent(), 'Grows faster with');
  assert.deepEqual(await page.locator('#inspector .need-chip .cargo-badge').evaluateAll(els => els.map(el => el.dataset.cargo)), ['food', 'furniture', 'machinery', 'fuel', 'stone']);
  assert.equal(await page.locator('#inspector .need-chip[data-met="true"]').count(), 0, 'nothing is supplied yet, and nothing reads as a problem');
  assert.equal(await page.locator('#inspector .town-needs .condition-concern').count(), 0);
  assert.equal(await page.locator('#inspector .need-hint').textContent(), 'Food deliveries help homes grow into comfortable homes.');
  await page.locator('#inspector').screenshot({ path: `${output}/needs-before-food.png` });

  // The live refresh flips the food badge once the truck unloads.
  await page.evaluate(() => transport.setSpeed(8));
  await page.waitForFunction(() => transport.game.routes.at(-1).delivered > 0, undefined, { timeout: 30000 });
  await page.waitForSelector(`${chip('food')}[data-met="true"] svg:not(.cargo-icon)`, { timeout: 5000 });
  await page.evaluate(() => transport.setSpeed(0));
  assert.ok(await page.evaluate(() => transport.game.cities[0].lastSupply.food <= transport.game.day));
  assert.equal(await page.locator(`${chip('furniture')}[data-met="false"]`).count(), 1);
  assert.equal(await page.locator('#inspector .need-hint').textContent(), 'Furniture or machinery deliveries help homes grow into prestige homes.');
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

  assert.deepEqual(errors, []);
  console.log('Town needs browser check passed');
} finally {
  await browser.close();
}
