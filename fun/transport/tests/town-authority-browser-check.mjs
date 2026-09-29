// Town opinion and the town hall in a real browser: two closed folds at the foot of the town inspector, the
// opinion's reasons and the town hall's priced purchases, a funded year bought at 8× that survives live refreshes
// and a reload, the zone inspector's funded line, the phone sheet, and a single Outstanding moment.
// Serve the repository root first; the page uses fresh browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-town-authority-qa';
await mkdir(output, { recursive: true });
const errors = [];
const OUTSTANDING = 'Alderbrook now rates your company Outstanding';
const inspectTown = page => page.evaluate(() => { document.activeElement?.blur?.(); const town = transport.game.cities[0]; transport.renderer.focus(town.x, town.y); transport.inspect(town.x, town.y, 'city'); });
const quote = (page, action) => page.evaluate(async action => { const { townActionQuote } = await import('./town-authority.js'); return townActionQuote(transport.game, transport.game.cities[0], action); }, action);
const fold = page => page.locator('#inspector .town-opinion'), hall = page => page.locator('#inspector .town-hall');
const openHall = async page => { await hall(page).waitFor(); if (!await hall(page).evaluate(el => el.open)) await page.locator('#inspector .town-hall summary').click(); await page.locator('#inspector [data-town-action="fund"]').waitFor(); };
// The inspector fits its width, and its buttons and folds are at least `target` px tall.
const fits = (page, target) => page.evaluate(target => {
  const box = document.querySelector('#inspector'), heights = [...box.querySelectorAll('[data-town-action], .town-hall summary')].map(el => Math.round(el.getBoundingClientRect().height));
  return { ok: box.scrollWidth <= box.clientWidth && heights.length === 3 && heights.every(height => height >= target), scroll: box.scrollWidth, client: box.clientWidth, heights };
}, target);

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await createWorldFromMenu(page);
  assert.equal(await page.evaluate(() => transport.game.cities[0].name), 'Alderbrook');

  // Both folds start closed. The opinion says only the opinion; the town hall is its own fold right after it.
  await inspectTown(page);
  await fold(page).waitFor();
  assert.equal(await fold(page).evaluate(el => el.open), false, 'closed by default');
  const summary = await page.locator('#inspector .town-opinion summary').innerText();
  assert.match(summary, /Opinion of your company/); assert.match(summary, /Good/);
  const layout = await page.evaluate(() => {
    const opinion = document.querySelector('#inspector .town-opinion'), next = opinion.nextElementSibling, title = next?.querySelector('summary .town-hall-title');
    return { next: next?.className, open: next?.open, opinionText: opinion.textContent, actions: opinion.querySelectorAll('[data-town-action], .town-action-tag').length, summary: next?.querySelector('summary').getBoundingClientRect().height, lines: title?.getClientRects().length, buttons: [...next.querySelectorAll('[data-town-action]')].map(el => el.dataset.townAction) };
  });
  assert.equal(layout.next, 'town-hall', 'the town hall directly follows the opinion');
  assert.equal(layout.open, false, 'the town hall starts closed');
  assert.doesNotMatch(layout.opinionText, /Town hall/);
  assert.equal(layout.actions, 0, 'no purchases or action tags in the opinion');
  assert.deepEqual(layout.buttons, ['advertise', 'fund']);
  assert.ok(layout.lines === 1 && layout.summary <= 32, `one-line town hall summary: ${JSON.stringify(layout)}`);
  await page.locator('#inspector').screenshot({ path: `${output}/town-closed.png` });
  await page.locator('#inspector .town-opinion summary').click();
  const opened = await fold(page).innerText();
  for (const text of ['A stop in town', 'Good: no effect on growth.']) assert.ok(opened.includes(text), `${text} in ${opened}`);
  await openHall(page);
  const advertise = await quote(page, 'advertise'), fund = await quote(page, 'fund');
  assert.equal((await page.locator('[data-town-action="advertise"]').innerText()).replace(/\s+/g, ' '), `Advertise $${advertise.cost.toLocaleString('en-US')}`);
  assert.equal((await page.locator('[data-town-action="fund"]').innerText()).replace(/\s+/g, ' '), `Fund development $${fund.cost.toLocaleString('en-US')}`);
  assert.doesNotMatch(opened + await hall(page).innerText(), / · /, 'no middle-dot glue');
  await page.locator('#inspector').screenshot({ path: `${output}/town-open.png` });

  // Four zoned tiles beside a served Alderbrook: the hint counts them and states the speed.
  const zoned = await page.evaluate(async () => {
    const { build, buildProblem, tick } = await import('./model.js'), { hasRoadAccess } = await import('./environment.js'), { townOf } = await import('./town-market.js');
    const game = transport.game, town = game.cities[0], tiles = [];
    for (let n = 0; n < 60 && !(Number.isFinite(town.lastServiceDay) && game.day - town.lastServiceDay <= 20); n++) tick(game, 1);
    // Clear of a month's end, so the purchase below sees no month close.
    while (new Date(Date.UTC(1950, 0, 1 + Math.floor(game.day))).getUTCDate() > 18) tick(game, 1);
    for (let r = 2; r <= 8 && tiles.length < 4; r++) for (let dy = -r; dy <= r && tiles.length < 4; dy++) for (let dx = -r; dx <= r && tiles.length < 4; dx++) {
      const x = town.x + dx, y = town.y + dy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || buildProblem(game, 'residential', x, y) || !hasRoadAccess(game, x, y) || townOf(game, x, y) !== town) continue;
      if (build(game, 'residential', x, y).ok) tiles.push({ x, y });
    }
    return { tiles, served: game.day - town.lastServiceDay };
  });
  assert.equal(zoned.tiles.length, 4, JSON.stringify(zoned));
  await inspectTown(page);
  await openHall(page);
  assert.equal(await hall(page).locator('[data-town-action="fund"] ~ .micro-note').innerText(), 'Your 4 zoned tiles here would develop twice as fast.');

  // Safari and iPad never focus a clicked button, so focus cannot shield the inspector from a live refresh.
  await page.evaluate(() => document.addEventListener('mousedown', event => { if (event.target.closest('#inspector button')) event.preventDefault(); }, true));
  const books = () => page.evaluate(() => ({ money: transport.game.money, revenue: transport.game.totalRevenue, running: transport.game.totalOperatingExpenses || 0, month: transport.game.lastMonth, day: transport.game.day }));
  await page.evaluate(() => { document.querySelector('#inspector .town-hall').dataset.before = '1'; transport.setSpeed(8); });
  await page.waitForTimeout(400);
  const before = await books();
  await page.locator('[data-town-action="fund"]').click();
  await page.locator('#toast-region .toast', { hasText: 'Development funded in Alderbrook' }).waitFor();
  const after = await books();
  assert.equal(after.month, before.month, 'no month closed during the purchase');
  assert.equal(before.money - after.money + (after.revenue - before.revenue) - (after.running - before.running), fund.cost, 'money drops by exactly the price, fares and running costs aside');
  assert.ok(await page.locator('#toast-region .toast', { hasText: `Development funded in Alderbrook for a year. $${fund.cost.toLocaleString('en-US')} spent.` }).count());
  const button = page.locator('[data-town-action="fund"]');
  assert.equal(await button.isDisabled(), true);
  assert.match(await button.innerText(), /^Funded until \d{1,2} [A-Z][a-z]{2} \d{4}$/);
  assert.equal(await hall(page).locator('[data-town-action="fund"] ~ .micro-note').count(), 0, 'no hint while funded');
  assert.match(await page.locator('#inspector .local-conditions').innerText(), /Development funded/);
  await page.waitForTimeout(3000);
  await page.evaluate(() => transport.setSpeed(0));
  assert.ok((await books()).day > before.day + 2, 'days passed');
  assert.equal(await hall(page).evaluate(el => el.dataset.before), undefined, 'the inspector refreshed');
  assert.equal(await hall(page).evaluate(el => el.open), true, 'the town hall stays open through live refreshes');
  assert.match(await button.innerText(), /^Funded until /);
  await page.locator('#inspector').screenshot({ path: `${output}/town-funded.png` });

  // From the keyboard, a purchase keeps focus on the town hall.
  await page.locator('[data-town-action="advertise"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.matches('#inspector .town-hall summary'));
  assert.match(await page.locator('[data-town-action="advertise"]').innerText(), /^Advertising until \d{1,2} [A-Z][a-z]{2} \d{4}$/);
  assert.equal(await page.locator('#inspector .town-opinion summary .town-action-tag').count(), 0);

  // A zone in the funded town says so.
  const tile = zoned.tiles[0];
  await page.evaluate(tile => { transport.renderer.focus(tile.x, tile.y); transport.inspect(tile.x, tile.y); }, tile);
  const zoneText = await page.locator('#inspector').innerText();
  assert.match(zoneText, /Development \d+%\. Funded until \d{1,2} [A-Z][a-z]{2} \d{4}\. Road access required\./);
  assert.match(zoneText, /Development funded/);
  await page.locator('#inspector').screenshot({ path: `${output}/zone-funded.png` });

  // The funded year lives in the save.
  const until = await page.evaluate(() => transport.game.cities[0].fundedUntil);
  assert.ok(Number.isInteger(until));
  await page.evaluate(() => transport.persist());
  await page.reload();
  await loadAutosaveFromMenu(page);
  assert.equal(await page.evaluate(() => transport.game.cities[0].fundedUntil), until);
  await inspectTown(page);
  await openHall(page);
  assert.match(await page.locator('[data-town-action="fund"]').innerText(), /^Funded until /);
  await page.locator('#inspector .town-hall').scrollIntoViewIfNeeded();
  const desk = await fits(page, 32);
  assert.ok(desk.ok, `desk ${JSON.stringify(desk)}`);
  await page.screenshot({ path: `${output}/town-desk.png` });

  // On a phone the open fold fits the sheet and its buttons are touch-sized.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await inspectTown(page);
  await openHall(page);
  await page.evaluate(() => document.querySelector('#inspector .sheet-grabber:not([hidden])')?.click());
  await page.waitForTimeout(300);
  await page.locator('#inspector .town-hall').scrollIntoViewIfNeeded();
  const phone = await fits(page, 44);
  assert.ok(phone.ok, `phone ${JSON.stringify(phone)}`);
  assert.ok(await page.locator('#inspector .town-opinion summary').evaluate(el => el.getBoundingClientRect().height >= 44));
  await page.screenshot({ path: `${output}/town-phone.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);

  // A town that comes to rate the company Outstanding is celebrated once.
  await page.evaluate(() => { const status = document.querySelector('#status-message'); window.outstandingSeen = 0; new MutationObserver(() => { if (status.textContent.includes('now rates your company Outstanding')) window.outstandingSeen++; }).observe(status, { childList: true, characterData: true, subtree: true }); });
  const setup = await page.evaluate(async () => {
    const { build, addRoute, buildProblem } = await import('./model.js'), { townOpinion } = await import('./town-authority.js');
    const game = transport.game, [town, other] = game.cities, used = new Set(game.stations.map(stop => `${stop.x},${stop.y}`));
    let placed = null;
    for (let r = 1; r <= 5 && !placed; r++) for (let dy = -r; dy <= r && !placed; dy++) for (let dx = -r; dx <= r && !placed; dx++) {
      const x = town.x + dx, y = town.y + dy;
      if (Math.hypot(dx, dy) > 5 || used.has(`${x},${y}`) || !game.tiles[y * game.width + x]?.road || buildProblem(game, 'bus-stop', x, y)) continue;
      const stop = build(game, 'bus-stop', x, y).station, target = game.stations.find(item => Math.hypot(item.x - other.x, item.y - other.y) <= 5 && item.mode === 'road');
      if (addRoute(game, { mode: 'road', stops: [stop.id, target.id], cargo: 'passengers' }).ok) placed = stop;
    }
    const day = Math.floor(game.day);
    town.serviceMonths = 10; town.lastSupply = { ...town.lastSupply, food: day, goods: day };
    return { placed: Boolean(placed), opinion: townOpinion(game, town) };
  });
  assert.ok(setup.placed, 'a second stop in Alderbrook');
  assert.equal(setup.opinion.label, 'Outstanding', JSON.stringify(setup.opinion));
  const advance = () => page.evaluate(async () => { const { tick } = await import('./model.js'); tick(transport.game, 1); });
  await advance();
  await page.locator('#toast-region .toast', { hasText: OUTSTANDING }).waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${output}/town-outstanding.png` });
  for (let n = 0; n < 5; n++) { await advance(); await page.waitForTimeout(700); }
  assert.equal(await page.evaluate(() => window.outstandingSeen), 1, 'the moment is celebrated once');
  assert.equal(await page.locator('#toast-region .toast', { hasText: OUTSTANDING }).locator('.toast-count').count(), 0);

  assert.deepEqual(errors, []);
  console.log(`Town authority browser check passed: ${output}`);
} finally {
  await browser.close();
}
