// Town opinion in a real browser: a closed fold at the foot of the town inspector, the town hall's
// priced purchases, a campaign that survives live refreshes and a reload, the phone sheet, and a
// single Outstanding moment. Serve the repository root first; the page uses fresh browser storage.
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
const fold = page => page.locator('#inspector .town-opinion');

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await createWorldFromMenu(page);
  assert.equal(await page.evaluate(() => transport.game.cities[0].name), 'Alderbrook');

  // The fold starts closed and says only the opinion; nothing else joins the default screen.
  await inspectTown(page);
  await fold(page).waitFor();
  assert.equal(await fold(page).evaluate(el => el.open), false, 'closed by default');
  const summary = await page.locator('#inspector .town-opinion summary').innerText();
  assert.match(summary, /Opinion of your company/); assert.match(summary, /Good/);
  assert.equal(await page.locator('#inspector .town-opinion [data-town-action]').first().isVisible(), false, 'the town hall waits inside the fold');
  await page.locator('#inspector').screenshot({ path: `${output}/town-closed.png` });
  await page.locator('#inspector .town-opinion summary').click();
  await page.locator('#inspector [data-town-action="advertise"]').waitFor();
  const opened = await fold(page).innerText();
  for (const text of ['A stop in town', 'Town hall', 'Good: no effect on growth.']) assert.ok(opened.includes(text), `${text} in ${opened}`);
  const advertise = await quote(page, 'advertise'), fund = await quote(page, 'fund');
  assert.equal((await page.locator('[data-town-action="advertise"]').innerText()).replace(/\s+/g, ' '), `Advertise $${advertise.cost.toLocaleString('en-US')}`);
  assert.equal((await page.locator('[data-town-action="fund"]').innerText()).replace(/\s+/g, ' '), `Fund new buildings $${fund.cost.toLocaleString('en-US')}`);
  assert.doesNotMatch(opened, / · /, 'no middle-dot glue');
  await page.locator('#inspector').screenshot({ path: `${output}/town-open.png` });

  // Safari and iPad never focus a clicked button, so focus cannot shield the inspector from a live refresh.
  await page.evaluate(() => document.addEventListener('mousedown', event => { if (event.target.closest('#inspector button')) event.preventDefault(); }, true));
  const money = await page.evaluate(() => transport.game.money);
  await page.locator('[data-town-action="advertise"]').click();
  assert.equal(await page.evaluate(() => transport.game.money), money - advertise.cost, 'money drops by exactly the price');
  await page.locator('#toast-region .toast', { hasText: 'Advertising in Alderbrook' }).waitFor();
  const button = page.locator('[data-town-action="advertise"]');
  assert.equal(await button.isDisabled(), true);
  assert.match(await button.innerText(), /^Advertising until \d{1,2} [A-Z][a-z]{2} \d{4}$/);
  assert.match(await page.locator('#inspector .town-opinion summary').innerText(), /Advertising/);
  await page.evaluate(() => { document.querySelector('#inspector .town-opinion').dataset.before = '1'; transport.setSpeed(8); });
  const day = await page.evaluate(() => transport.game.day);
  await page.waitForTimeout(3000);
  await page.evaluate(() => transport.setSpeed(0));
  assert.ok(await page.evaluate(day => transport.game.day > day + 2, day), 'days passed');
  assert.equal(await fold(page).evaluate(el => el.dataset.before), undefined, 'the inspector refreshed');
  assert.equal(await fold(page).evaluate(el => el.open), true, 'the fold stays open through live refreshes');
  assert.match(await page.locator('#inspector .town-opinion summary').innerText(), /Advertising/);
  await page.locator('#inspector').screenshot({ path: `${output}/town-advertising.png` });

  // From the keyboard, a purchase keeps focus on the fold.
  await page.locator('[data-town-action="fund"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.matches('#inspector .town-opinion summary'));
  assert.match(await page.locator('[data-town-action="fund"]').innerText(), /^Funded until /);
  assert.match(await page.locator('#inspector .town-opinion summary').innerText(), /Funded/);

  // The campaign lives in the save.
  const until = await page.evaluate(() => transport.game.cities[0].advertisedUntil);
  assert.ok(Number.isInteger(until));
  await page.evaluate(() => transport.persist());
  await page.reload();
  await loadAutosaveFromMenu(page);
  assert.equal(await page.evaluate(() => transport.game.cities[0].advertisedUntil), until);
  await inspectTown(page);
  await fold(page).waitFor();
  assert.match(await page.locator('#inspector .town-opinion summary').innerText(), /Advertising/);

  // On a phone the open fold fits the sheet and its buttons are touch-sized.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await inspectTown(page);
  await page.locator('#inspector .town-opinion summary').click();
  await page.locator('#inspector [data-town-action="advertise"]').waitFor();
  await page.evaluate(() => document.querySelector('#inspector .sheet-grabber:not([hidden])')?.click());
  await page.waitForTimeout(300);
  await page.locator('#inspector .town-opinion h4').scrollIntoViewIfNeeded();
  const phone = await page.evaluate(() => { const box = document.querySelector('#inspector'); return { scroll: box.scrollWidth, client: box.clientWidth, buttons: [...box.querySelectorAll('[data-town-action]')].map(el => el.getBoundingClientRect().height), summary: box.querySelector('.town-opinion summary').getBoundingClientRect().height }; });
  assert.ok(phone.scroll <= phone.client, JSON.stringify(phone));
  assert.ok(phone.buttons.length === 2 && phone.buttons.every(height => height >= 44), JSON.stringify(phone));
  assert.ok(phone.summary >= 44, JSON.stringify(phone));
  await page.screenshot({ path: `${output}/town-phone.png` });
  await page.setViewportSize({ width: 1440, height: 960 });
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
