// Town outlook in a real browser: the inspector reads recent growth from the monthly counts,
// room to grow waits in a closed fold that survives live refreshes, and the towns list tags growth.
// Serve the repository root first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-town-outlook-qa';
await mkdir(output, { recursive: true });
const errors = [];
const inspectTown = (page, index) => page.evaluate(index => { document.activeElement?.blur?.(); const town = transport.game.cities[index]; transport.renderer.focus(town.x, town.y); transport.inspect(town.x, town.y, 'city'); }, index);
// What the inspector should say, from the saved counts and the same lot rule as the simulation.
const expected = (page, index) => page.evaluate(async index => {
  const { townOutlook } = await import('./settlements.js'), game = transport.game, town = game.cities[index], outlook = townOutlook(game, town);
  return { change: Math.floor(town.population) - (town.popHistory?.[0] ?? NaN), days: outlook.days, plots: outlook.plots };
}, index);

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await createWorldFromMenu(page);

  // A new company has no monthly count yet, so there is no growth line; the fold starts closed.
  await inspectTown(page, 0);
  await page.locator('#inspector .town-grow').waitFor();
  assert.equal(await page.locator('#inspector .town-growth').count(), 0, 'no growth line before the first count');
  assert.equal(await page.locator('#inspector .town-grow').evaluate(el => el.open), false);
  assert.equal(await page.locator('#inspector .town-grow summary').innerText(), 'Help it grow');
  assert.equal(await page.locator('#zone-town').isVisible(), false, 'Add zones waits inside the fold');

  // Four months on, the served starter town has grown since the count three months back. Its homes are in
  // demand, so it fills its road-side plots by early summer; the check reads it while it is still growing.
  await page.evaluate(async () => { const { tick } = await import('./model.js'); tick(transport.game, 125); });
  await inspectTown(page, 0);
  await page.locator('#inspector .town-growth').waitFor();
  const home = await expected(page, 0);
  assert.ok(home.change > 0 && home.days >= 90 && home.days <= 122, JSON.stringify(home));
  assert.equal(await page.locator('#inspector .town-growth').innerText(), `Growth · +${home.change.toLocaleString('en-US')} residents in ${home.days} days`);
  await page.locator('#inspector').screenshot({ path: `${output}/growth-closed.png` });

  // Opening the fold shows room to grow, and a live refresh keeps it open.
  await page.locator('#inspector .town-grow summary').click();
  await page.locator('#zone-town').waitFor();
  const room = home.plots ? `${home.plots} free road-side ${home.plots === 1 ? 'plot' : 'plots'}` : 'no free road-side plots';
  assert.equal(await page.locator('#inspector .town-room').innerText(), `Room to grow · ${room}`);
  assert.match(await page.locator('#inspector .town-grow').innerText(), /Served towns extend their own streets over time\. Zoning nearby land speeds this up\./);
  await page.evaluate(() => { document.activeElement?.blur?.(); transport.setSpeed(8); });
  const day = await page.evaluate(() => transport.game.day);
  await page.waitForFunction(day => transport.game.day > day + 3, day);
  await page.waitForTimeout(600);
  await page.evaluate(() => transport.setSpeed(0));
  assert.equal(await page.locator('#inspector .town-grow').evaluate(el => el.open), true, 'the fold stays open through live refreshes');
  await page.locator('#inspector').screenshot({ path: `${output}/growth-open.png` });

  // A town that has not grown reads as quiet, never as a failure.
  const quiet = await page.evaluate(() => transport.game.cities.findIndex(town => town.popHistory?.[0] === Math.floor(town.population)));
  assert.ok(quiet >= 0, 'an unserved town');
  await inspectTown(page, quiet);
  await page.waitForFunction(name => document.querySelector('#inspector-title')?.textContent === name, await page.evaluate(index => transport.game.cities[index].name, quiet));
  assert.equal(await page.locator('#inspector .town-growth').innerText(), 'Growth · quiet');
  assert.equal(await page.locator('#inspector .town-grow').evaluate(el => el.open), true, 'the fold remembers it was opened');
  assert.doesNotMatch(await page.locator('#inspector').innerText(), /stalled|full/i);

  // Add zones still opens the town tools.
  await page.locator('#zone-town').click();
  await page.locator('#panel-content [data-tool="residential"]').waitFor();

  // The towns list tags only the towns that grew; nothing is marked full.
  await page.evaluate(() => { document.querySelector('#inspector .tiny-button').click(); transport.setView('towns'); });
  await page.locator('#entity-list .entity-card').first().waitFor();
  // The list starts with the towns nearest the view, so each tag is read against its own town.
  const tags = Object.fromEntries(await page.locator('#entity-list .entity-card').evaluateAll(cards => cards.map(card => [card.dataset.city, card.querySelector('.town-tag')?.textContent || ''])));
  const growing = await page.evaluate(() => Object.fromEntries(transport.game.cities.map(town => [town.id, town.popHistory && Math.floor(town.population) > town.popHistory[0] ? 'Growing' : ''])));
  assert.deepEqual(tags, Object.fromEntries(Object.keys(tags).map(id => [id, growing[id]])));
  assert.equal(tags[await page.evaluate(() => transport.game.cities[0].id)], 'Growing', 'the served starter town');
  assert.equal(await page.locator('#entity-list').getByText(/^Full$/).count(), 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${output}/towns-list.png` });

  assert.deepEqual(errors, []);
  console.log(`Town outlook browser check passed · ${output}`);
} finally {
  await browser.close();
}
