// Company property in a real browser: a cottage placed near Alderbrook with the Build tool earns rent as the month closes at
// 8×, which floats up above the town's name as one pill with the Rent pictogram and no chime, and hides with Income off. The
// first rent arrives once as a toast, never again after a reload. The inspector shows Rent, Occupancy, Worth and Sell, confirmed
// in place; Ctrl+Z then refuses. The Company report's Property section fits on desktop, and a fresh world shows none of it.
// Serve the repository root first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-property-qa';
await mkdir(output, { recursive: true });
const errors = [];

async function open(context, viewport = { width: 1440, height: 900 }) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Every toast shown, and every oscillator the interface starts: a chime starts two.
  await page.addInitScript(() => {
    window.__toasts = []; window.__oscillators = 0;
    const Base = window.AudioContext;
    window.AudioContext = class extends Base { constructor(...args) { super(...args); window.__audio = this; } createOscillator() { window.__oscillators++; return super.createOscillator(); } };
    addEventListener('DOMContentLoaded', () => new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node.classList?.contains('toast')) window.__toasts.push(node.querySelector(':scope > span')?.textContent); }).observe(document.querySelector('#toast-region'), { childList: true }));
  });
  await page.goto(url);
  return page;
}
const firstRent = page => page.evaluate(() => window.__toasts.filter(text => /^First rent from your property/.test(text)).length);
const overflow = page => page.evaluate(() => { const modal = document.querySelector('#modal'); return { page: document.documentElement.scrollWidth - innerWidth, modal: modal.open ? modal.scrollWidth - modal.clientWidth : 0 }; });
const screen = (page, point) => page.evaluate(point => { const p = transport.renderer.worldToScreen(point.x, point.y), rect = document.querySelector('#world').getBoundingClientRect(); return { x: p.x + rect.left, y: p.y + rect.top }; }, point);

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await open(context);
  await createWorldFromMenu(page, { seed: 1847 });
  await page.evaluate(() => document.querySelector('#dismiss-objective')?.click());
  const town = await page.evaluate(() => { const { id, name, x, y } = transport.game.cities[0]; return { id, name, x, y }; });
  assert.equal(town.name, 'Alderbrook');
  // Nothing new on the default screen of a company without property.
  assert.equal(await page.locator('#rent-row').isHidden(), true);
  assert.equal(await page.locator('.property, .company-property').count(), 0);

  // The nearest clear tile Alderbrook owns, placed with the Build tool and a real click.
  const site = await page.evaluate(async () => {
    const { buildProblem } = await import('./model.js'), { townOf } = await import('./town-market.js'), g = transport.game, home = g.cities[0], spots = [];
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) if (Math.hypot(dx, dy) >= 3 && !buildProblem(g, 'house-cheap-1', home.x + dx, home.y + dy) && townOf(g, home.x + dx, home.y + dy) === home) spots.push({ x: home.x + dx, y: home.y + dy, d: Math.hypot(dx, dy) });
    return spots.sort((a, b) => a.d - b.d)[0];
  });
  assert.ok(site, 'a clear tile near Alderbrook');
  await page.evaluate(site => { transport.renderer.setZoom(1); transport.renderer.focus(site.x, site.y); transport.setTool('house-cheap-1'); }, site);
  await page.waitForTimeout(200);
  const at = await screen(page, site);
  await page.mouse.move(at.x, at.y); await page.mouse.click(at.x, at.y);
  await page.waitForFunction(site => transport.game.tiles[site.y * transport.game.width + site.x].building?.owner === 'player', site);
  await page.evaluate(() => transport.setTool('inspect'));
  const paid = await page.evaluate(site => transport.game.tiles[site.y * transport.game.width + site.x].building.paid, site);

  // The last hours of January at 8×, with Alderbrook's name on screen, sound on and every vehicle between its stops.
  await page.evaluate(async town => {
    const model = await import('./model.js'), market = await import('./town-market.js'), g = transport.game;
    model.tick(g, 30.6 - g.day); model.drainDeliveryEvents(g); market.drainPropertyEvents(g);
    for (const vehicle of g.vehicles) { const route = g.routes.find(r => r.id === vehicle.routeId); vehicle.progress = (route.path.length - 1) / 2; vehicle.dwellRemaining = 0; }
    transport.renderer.setZoom(1); transport.renderer.focus(town.x, town.y + 1);
    const renderer = transport.renderer, original = renderer.render;
    window.rentQA = { seen: [] };
    renderer.render = function (now, view = {}) { for (const floater of view.floaters || []) if (floater.cargo === 'property' && !rentQA.seen.includes(floater)) rentQA.seen.push(floater); return original.apply(this, arguments); };
    // Renders one moment with and without the floaters and compares the band above the town, as the delivery check does.
    rentQA.compare = (at, floaters, half = 90) => {
      const canvas = document.querySelector('#world'), density = devicePixelRatio || 1, p = renderer.worldToScreen(floaters[0].x, floaters[0].y);
      const top = p.y - 170, x = Math.round((p.x - half) * density), y = Math.round(top * density), w = Math.round(half * 2 * density), h = Math.round(170 * density);
      const read = list => { original.call(renderer, at, { floaters: list }); return canvas.getContext('2d').getImageData(x, y, w, h).data; }, pending = () => renderer.getStats().sceneryBatches?.pending || 0;
      const prepared = !pending(), plain = read(null), again = read(null), shown = read(floaters), rows = [];
      for (let row = 0; row < h; row++) { let differs = false; for (let i = row * w * 4; i < (row + 1) * w * 4 && !differs; i++) differs = shown[i] !== plain[i]; rows.push(differs); }
      const ranges = []; for (let row = 0; row < h; row++) if (rows[row] && !rows[row - 1]) ranges.push([row, row]); else if (rows[row]) ranges.at(-1)[1] = row;
      const label = renderer.cityLabels().find(r => r.id === town.id);
      return { stable: prepared && !pending() && plain.every((value, i) => value === again[i]), changed: rows.some(Boolean), ranges, label: label ? [(label.y - top) * density, (label.y + label.h - top) * density] : null };
    };
  }, town);
  await page.locator('#audio-button').evaluate(button => button.click());
  await page.waitForFunction(() => window.__audio?.state === 'running');
  const oscillators = await page.evaluate(() => window.__oscillators), month = await page.evaluate(() => transport.game.lastMonth);
  await page.locator('[data-speed="8"]').click();
  await page.waitForFunction(month => transport.game.lastMonth > month && rentQA.seen.length > 0, month, { timeout: 20000 });
  await page.evaluate(() => transport.setSpeed(0));
  const rent = await page.evaluate(town => ({ floaters: rentQA.seen.map(({ x, y, revenue, cargo, born }) => ({ x, y, revenue, cargo, born })), market: transport.game.cities.find(c => c.id === town.id).market.rent, history: transport.game.history.at(-1).property }), town);
  assert.equal(rent.floaters.length, 1, 'one rent pill');
  assert.deepEqual([rent.floaters[0].x, rent.floaters[0].y, rent.floaters[0].cargo], [town.x, town.y, 'property']);
  assert.ok(rent.floaters[0].revenue > 0 && rent.floaters[0].revenue === rent.market && rent.market === rent.history, JSON.stringify(rent));
  assert.equal(await page.evaluate(() => window.__oscillators), oscillators, 'rent floats up without a chime');
  await page.screenshot({ path: `${output}/rent-floater-1440.png` });
  const floater = rent.floaters[0], compare = at => page.evaluate(({ at, floater }) => rentQA.compare(at, [floater]), { at, floater });
  for (let attempt = 0; attempt < 30 && !(await compare(floater.born + 100)).stable; attempt++) await page.waitForTimeout(200);
  const shown = await compare(floater.born + 100);
  assert.equal(shown.stable, true, 'the paused scene renders identically');
  assert.equal(shown.ranges.length, 1, `one pill above the town ${JSON.stringify(shown.ranges)}`);
  assert.ok(shown.label && shown.ranges[0][1] < shown.label[0], `the pill starts above Alderbrook’s name ${JSON.stringify(shown)}`);
  // Layers › Income off hides it.
  if (await page.locator('#layers-button').isVisible()) await page.locator('#layers-button').click(); else await openGameAction(page, 'layers-button');
  await page.locator('#layers-panel').waitFor({ state: 'visible' });
  await page.locator('[data-layer="deliveries"]').setChecked(false);
  await page.waitForFunction(() => transport.renderer.getLayers().deliveries === false);
  assert.equal((await compare(floater.born + 100)).changed, false, 'Income off leaves the map as it was');
  await page.locator('[data-layer="deliveries"]').setChecked(true);
  await page.keyboard.press('Escape');

  // The first rent arrives once, as a toast; the finances card names last month's rent.
  await page.waitForFunction(() => window.__toasts.some(text => /^First rent from your property/.test(text)), undefined, { timeout: 5000 });
  assert.deepEqual(await page.evaluate(() => window.__toasts.filter(text => /^First rent/.test(text))), [`First rent from your property: +$${rent.history.toLocaleString('en-US')}.`]);
  await page.locator('#company-stats').hover();
  assert.equal(await page.locator('#rent-row').isVisible(), true);
  assert.equal(await page.locator('#rent-exact').textContent(), `$${rent.history.toLocaleString('en-US')}`);
  await page.locator('#company-tooltip').screenshot({ path: `${output}/finances-1440.png` });
  await page.mouse.move(700, 600); await page.evaluate(() => document.querySelector('#company-stats').blur());

  // The cottage's inspector: rent, occupancy, worth and Sell; Keep it changes nothing.
  await page.evaluate(site => transport.inspect(site.x, site.y), site);
  const box = page.locator('#inspector .property');
  await box.waitFor();
  const text = await box.innerText();
  assert.match(text, /Rent\s+\$\d+ a month\s+Occupancy\s+\d+%/);
  assert.match(text, new RegExp(`Worth \\$[\\d,]+\\. You paid \\$${paid.toLocaleString('en-US')}\\.`));
  assert.match(text, /Regular passenger service fills homes\./);
  const sell = page.locator('#sell-property');
  assert.match(await sell.innerText(), /^Sell for\s+\$[\d,]+$/);
  assert.ok(await page.locator('#inspector').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'the inspector never scrolls sideways');
  await page.locator('#inspector').screenshot({ path: `${output}/inspector-1440.png` });
  const before = await page.evaluate(site => ({ money: transport.game.money, owner: transport.game.tiles[site.y * transport.game.width + site.x].building.owner }), site);
  await sell.click();
  await page.locator('#inspector .property-sell').waitFor();
  assert.match(await page.locator('#sell-question').innerText(), /^Sell it to Alderbrook for \$[\d,]+\? The town takes it over and its rent stops\. The building stays\.$/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'sell-keep', 'the question lands on Keep it');
  await page.locator('#inspector').screenshot({ path: `${output}/inspector-sell-1440.png` });
  await page.locator('#sell-keep').click();
  await sell.waitFor();
  assert.deepEqual(await page.evaluate(site => ({ money: transport.game.money, owner: transport.game.tiles[site.y * transport.game.width + site.x].building.owner }), site), before, 'Keep it changes nothing');

  // The Company report's Property section on desktop.
  await openGameAction(page, 'company-button');
  await page.locator('[data-company-tab="property"]').click();
  const section = page.locator('#modal .company-property');
  await section.waitFor();
  assert.match(await section.locator('header').innerText(), /^Property\s+\$\d+ a month$/);
  assert.match(await section.locator('.property-figures').innerText(), /Worth\s+\$[\d,]+\s+Rent this year\s+\$[\d,]+\s+Yield\s+\d+% a year/);
  assert.equal(await section.locator('.property-spark').count(), 0, 'one closed month draws no line yet');
  // Past 12 months (city-investment-feedback) holds the one month of returns so far: that rent.
  assert.deepEqual(await section.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.innerText.trim()))), [['Alderbrook', '0', '1', `$${rent.history.toLocaleString('en-US')}`, `$${rent.history.toLocaleString('en-US')}`, 'Show']]);
  assert.deepEqual(await overflow(page), { page: 0, modal: 0 });
  await section.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
  await page.screenshot({ path: `${output}/company-property-1440.png` });
  await section.locator('[data-property-show]').click();
  await page.waitForFunction(() => !document.querySelector('#modal').open && document.querySelector('#inspector-title')?.textContent === 'Alderbrook');
  await page.screenshot({ path: `${output}/show-town-1440.png` });
  // The town's economy names the rent; selling hands the cottage over for 60% of its value and Ctrl+Z then refuses.
  await page.evaluate(town => transport.inspect(town.x, town.y, 'city'), town);
  assert.equal(await page.locator('.town-economy .economy-lead').innerText(), `$${rent.history.toLocaleString('en-US')} a month`);
  await page.locator('.town-economy summary').click();
  assert.match(await page.locator('.town-economy .town-property').innerText(), /^Rent last month\s+\$\d+\s+Plots and buildings\s+0 and 1$/);
  await page.locator('.town-property').scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
  await page.locator('#inspector').screenshot({ path: `${output}/town-economy-1440.png` });
  await page.evaluate(site => transport.inspect(site.x, site.y), site);
  const value = await page.evaluate(async site => { const { propertyAt } = await import('./town-market.js'); return propertyAt(transport.game, site.x, site.y).value; }, site), money = await page.evaluate(() => transport.game.money);
  await page.locator('#sell-property').click(); await page.locator('#sell-confirm').click();
  await page.waitForFunction(() => window.__toasts.some(text => /^Workers’ cottage sold to Alderbrook for /.test(text)));
  assert.equal(await page.evaluate(() => transport.game.money) - money, Math.round(.6 * value));
  assert.equal(await page.locator('#sell-property, #inspector .property').count(), 0, 'the town has it now');
  assert.equal(await page.evaluate(site => transport.game.tiles[site.y * transport.game.width + site.x].building?.kind, site), 'house-cheap-1', 'the building stays');
  const count = await page.evaluate(() => window.__toasts.length);
  await page.locator('#world').focus(); await page.keyboard.press('Control+z');
  await page.waitForFunction(count => window.__toasts.length > count, count);
  assert.equal(await page.evaluate(() => window.__toasts.at(-1)), 'Rent has been paid on this building. Sell it instead.');
  assert.equal(await page.evaluate(site => transport.game.tiles[site.y * transport.game.width + site.x].building?.kind, site), 'house-cheap-1');

  // A reload never replays the first rent.
  await page.evaluate(() => transport.persist());
  await page.waitForTimeout(500);
  await page.close();
  const reloaded = await open(context);
  await loadAutosaveFromMenu(reloaded);
  await reloaded.evaluate(() => { transport.game.money += 1; transport.setSpeed(8); });
  await reloaded.waitForTimeout(2500);
  assert.equal(await firstRent(reloaded), 0, 'no first-rent toast after a reload');
  await reloaded.close();
  await context.close();

  // A fresh world: no property anywhere, and the report has no Property section.
  const freshContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const fresh = await open(freshContext);
  await createWorldFromMenu(fresh, { seed: 1847 });
  await fresh.evaluate(() => { const home = transport.game.cities[0]; transport.inspect(home.x, home.y, 'city'); });
  assert.doesNotMatch(await fresh.locator('.town-economy .economy-lead').innerText(), /a month/);
  assert.equal(await fresh.locator('.town-property, .property').count(), 0);
  await openGameAction(fresh, 'company-button');
  await fresh.locator('#modal .company-report').waitFor();
  assert.equal(await fresh.locator('#modal .company-property').count(), 0, 'no Property section without property');
  assert.equal(await fresh.locator('#rent-row').isHidden(), true);
  await freshContext.close();

  assert.deepEqual(errors, []);
  console.log(`Property browser check passed (rent $${rent.history}). Screenshots: ${output}`);
} finally {
  await browser.close();
}
