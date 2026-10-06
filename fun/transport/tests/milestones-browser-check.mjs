// Company milestones in a real browser: one celebration each and at most one a month, the first
// merged into the first-delivery toast, Company goals on desktop, and nothing replayed after a reload.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-milestones';
await mkdir(output, { recursive: true });
const errors = [];

async function open(viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    window.__toasts = [];
    addEventListener('DOMContentLoaded', () => new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node.classList?.contains('toast')) window.__toasts.push({ text: node.querySelector(':scope > span')?.textContent, type: node.className, action: node.querySelector('.toast-action')?.textContent || '', day: window.transport?.game.day });
    }).observe(document.querySelector('#toast-region'), { childList: true }));
  });
  await page.goto(url);
  return page;
}
const toasts = (page, pattern = /Milestone/) => page.evaluate(source => window.__toasts.filter(toast => new RegExp(source).test(toast.text)), pattern.source);
const days = (page, count) => page.evaluate(async count => { const { tick } = await import('./model.js'); for (let n = 0; n < count; n++) tick(transport.game, 1); }, count);
const month = day => { const date = new Date(Date.UTC(1950, 0, 1 + Math.floor(day))); return date.getUTCFullYear() * 12 + date.getUTCMonth(); };
// Crossing into the next calendar month keeps the one-toast-a-month rule out of the way.
const nextMonth = page => page.evaluate(async () => { const { tick } = await import('./model.js'), g = transport.game, start = new Date(Date.UTC(1950, 0, 1 + Math.floor(g.day))).getUTCMonth(); while (new Date(Date.UTC(1950, 0, 1 + Math.floor(g.day))).getUTCMonth() === start) tick(g, 1); });
const settle = page => page.waitForTimeout(1200);

try {
  const page = await open({ width: 1440, height: 900 });
  await createWorldFromMenu(page, { biome: 'taiga', seed: 1847 });
  await days(page, 1);
  assert.deepEqual(await page.evaluate(() => transport.game.milestones), {}, 'a new company starts the ladder empty');

  // The company's first freight delivery: one toast carries both the delivery and the milestone.
  const route = await page.evaluate(async () => {
    const { buildPlan } = await import('./construction-plan.js'), { build, addRoute } = await import('./model.js'), g = transport.game, points = [];
    for (let y = 251; y >= 245; y--) points.push({ x: 219, y });
    if (!buildPlan(g, 'road', points, { preferredMode: 'road' }).ok || !build(g, 'bus-stop', 219, 251).ok) throw new Error('quarry stop failed');
    const result = addRoute(g, { mode: 'road', stops: [g.stations.find(stop => stop.x === 219 && stop.y === 251).id, 'station-1'], cargo: 'stone' });
    if (!result.ok) throw new Error(result.message);
    return g.routes.at(-1).id;
  });
  await page.evaluate(async id => { const { tick } = await import('./model.js'), g = transport.game, route = g.routes.find(r => r.id === id); for (let d = 0; d < 80 && !route.delivered; d++) tick(g, 1); }, route);
  await settle(page);
  const first = await toasts(page, /^First stone delivered/);
  assert.equal(first.length, 1);assert.match(first[0].text, / · Milestone$/);assert.match(first[0].type, /milestone/);
  assert.ok(await page.evaluate(() => Number.isInteger(transport.game.milestones['first-freight'])));
  assert.deepEqual(await toasts(page), first, 'no separate first-freight toast');
  // The hundredth delivery in the same month is recorded without another toast.
  await page.evaluate(id => { transport.game.routes.find(r => r.id === id).delivered += 100; }, route);
  await days(page, 1);await settle(page);
  assert.ok(await page.evaluate(() => Number.isInteger(transport.game.milestones['freight-100'])));
  assert.deepEqual(await toasts(page), first, 'one milestone toast a month');

  // A town the company serves passes 2,000 residents in a new month: one toast with a way to the goals.
  await nextMonth(page);await settle(page);
  const before = (await toasts(page)).length;
  await page.evaluate(() => { transport.game.cities[0].population = 2100; });
  await days(page, 1);await settle(page);
  let celebrated = (await toasts(page)).slice(before);
  assert.deepEqual(celebrated.map(toast => toast.text), ['Milestone · A town of 2,000']);
  assert.match(celebrated[0].type, /milestone/);assert.equal(celebrated[0].action, 'Goals');
  await page.screenshot({ path: `${output}/desktop-toast.png` });
  // A second milestone that month waits in News and Company goals instead.
  await page.evaluate(() => { const g = transport.game, last = g.history.at(-1) || {}; g.history.push({ month: (last.month ?? -1) + 1, day: Math.floor(g.day), income: 40000, expenses: 5000, operatingExpenses: 5000, operatingProfit: 35000, profit: 35000, money: g.money, population: 0, delivered: g.totalDelivered }); });
  await days(page, 1);await settle(page);
  assert.ok(await page.evaluate(() => Number.isInteger(transport.game.milestones['profit-25k'])));
  assert.equal((await toasts(page)).length, before + 1, 'at most one milestone toast a month');
  await days(page, 20);await settle(page);
  celebrated = await toasts(page);
  assert.equal(new Set(celebrated.map(toast => toast.text)).size, celebrated.length, 'each milestone celebrates once');
  const months = celebrated.map(toast => month(toast.day));assert.equal(new Set(months).size, months.length, 'one milestone toast per game month');
  await openGameAction(page, 'news-button');
  await page.locator('.news-list').waitFor();
  assert.match(await page.locator('.news-item[data-type="milestone"]').first().innerText(), /Milestone · A \$25,000 month/);
  await page.locator('.news-item[data-type="milestone"] [data-news-goals]').first().click();

  // Company goals lists every chapter with dates and progress; the map card never names chapters.
  await page.locator('.goal-chapters').waitFor();
  assert.equal(await page.locator('.goal-chapter').count(), 4);
  assert.deepEqual(await page.locator('.goal-chapter .eyebrow').allTextContents(), ['Chapter 1 of 4', 'Chapter 2 of 4', 'Chapter 3 of 4', 'Chapter 4 of 4']);
  assert.match(await page.locator('.goal-row', { hasText: 'A town of 2,000' }).innerText(), /Reached \w{3} \d+, 1950/);
  assert.match(await page.locator('.goal-row', { hasText: 'Five towns served' }).innerText(), /2 of 5 served/);
  assert.equal(await page.locator('.goal-row em').count(), 0, 'the card still follows the first-route stages');
  await page.screenshot({ path: `${output}/desktop-goals.png` });
  await page.locator('#modal .close-modal').click();
  assert.equal(await page.locator('#objective-card .eyebrow').count(), 0, 'the goal card names its goal with no eyebrow');

  // A reload keeps the stamps and replays no celebration.
  const saved = await page.evaluate(() => transport.game.milestones);
  assert.equal(await page.evaluate(() => transport.persist()), true);
  await page.reload();
  await loadAutosaveFromMenu(page, { paused: false });
  await page.waitForTimeout(2500);
  assert.deepEqual(await toasts(page), [], 'loading a save replays no milestone');
  const reloaded = await page.evaluate(() => transport.game.milestones);
  for (const [id, day] of Object.entries(saved)) assert.equal(reloaded[id], day, `${id} keeps its day`);

  // Past the first-route stages the card follows the ladder: the open chapter's goals, with Another idea and Company goals.
  await page.evaluate(async () => {
    const { build, tick } = await import('./model.js'), g = transport.game, stone = g.routes.find(route => route.cargo === 'stone');
    transport.setSpeed(0);stone.delivered = Math.max(stone.delivered, 150);g.routes.push({ ...structuredClone(stone), id: 'route-lumber-check', name: 'Lumber check', cargo: 'lumber', delivered: 5 });
    const town = g.cities[0];let zoned = false;
    for (let r = 1; r < 9 && !zoned; r++) for (let dy = -r; dy <= r && !zoned; dy++) for (let dx = -r; dx <= r && !zoned; dx++) zoned = build(g, 'residential', town.x + dx, town.y + dy).ok;
    if (!zoned) throw new Error('zoning failed');
    tick(g, 1);
  });
  await page.waitForFunction(() => document.querySelector('#objective-title').textContent === 'A factory at work');
  // Past onboarding the goal is one line (DESIGN.md 11.4) that opens on demand.
  assert.equal(await page.locator('#objective-body').isVisible(), false, 'past onboarding the goal is one line');
  assert.equal((await page.locator('#objective-chip-title').textContent()), 'A factory at work');
  await page.locator('#objective-chip').click();
  assert.equal(await page.locator('#objective-goals').isVisible(), true);assert.equal(await page.locator('#guide-button').isVisible(), false);
  assert.doesNotMatch(await page.locator('#objective-card').innerText(), /Chapter/);
  await page.locator('#objective-another').click();
  assert.equal(await page.locator('#objective-title').textContent(), 'Supplies for a town');
  await page.screenshot({ path: `${output}/desktop-card.png` });
  await page.locator('#objective-goals').click();
  await page.locator('.goal-row em').waitFor();
  assert.match(await page.locator('.goal-row', { has: page.locator('em') }).innerText(), /Supplies for a town/, 'the dialog marks the card’s goal');
  await page.locator('#modal .close-modal').click();
  await page.close();

  // An older save without milestones takes them in silently.
  const legacy = await open({ width: 1440, height: 900 });
  await createWorldFromMenu(legacy, { biome: 'taiga', seed: 1847 });
  await legacy.evaluate(async () => { const g = transport.game; g.cities[0].population = 2100; delete g.milestones; if (!await transport.persist()) throw new Error('persist failed'); });
  await legacy.reload();
  await loadAutosaveFromMenu(legacy, { paused: false });
  await legacy.waitForFunction(() => transport.game.milestones?.['town-2000'] !== undefined);
  await legacy.waitForTimeout(1500);
  assert.deepEqual(await toasts(legacy), [], 'the backfill is silent');
  await legacy.close();

  assert.deepEqual(errors, []);
  console.log(`Milestone checks passed. Screenshots: ${output}`);
} finally { await browser.close(); }
