// Company rating in a real browser: the finances card's Title row, the first review, a new title as company news
// (a headline, or a toast with headlines off), the Company report's rating block and its folded measures, the
// century as news that opens its card only on demand, a reload that replays nothing.
// Serve the repository root on a fresh no-store port first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-company-rating-qa';
await mkdir(output, { recursive: true });
const errors = [];

async function open(viewport, context = null) {
  const page = await (context || browser).newPage(context ? {} : { viewport, deviceScaleFactor: 1 });
  if (context) await page.setViewportSize(viewport);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    window.__toasts = []; window.__headlines = [];
    addEventListener('DOMContentLoaded', () => {
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) if (node.classList?.contains('toast')) window.__toasts.push({ text: node.querySelector(':scope > span')?.textContent, actions: [...node.querySelectorAll('.toast-action')].map(button => button.textContent) });
      }).observe(document.querySelector('#toast-region'), { childList: true });
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) if (node.classList?.contains('headline-card')) window.__headlines.push({ title: node.querySelector('h2')?.textContent, kicker: node.querySelector('.headline-kicker span')?.textContent, action: node.querySelector('.headline-action')?.textContent ?? null });
      }).observe(document.querySelector('#headline-slot'), { childList: true });
    });
  });
  await page.goto(url);
  return page;
}
const toasts = (page, from = 0) => page.evaluate(from => window.__toasts.slice(from), from);
const headlines = (page, from = 0) => page.evaluate(from => window.__headlines.slice(from), from);
const counts = page => page.evaluate(() => ({ toasts: window.__toasts.length, headlines: window.__headlines.length }));
// A change the HUD notices on its next update.
const nudge = page => page.evaluate(() => { transport.game.money += 1; });
const closeDialog = async page => { await page.locator('#modal .close-modal').click(); await page.waitForFunction(() => !document.querySelector('#modal').open); await page.waitForTimeout(150); };
const overflow = page => page.evaluate(() => { const modal = document.querySelector('#modal'); return { page: document.documentElement.scrollWidth - innerWidth, modal: modal.open ? modal.scrollWidth - modal.clientWidth : 0 }; });
const setHeadlines = async (page, on) => {
  await openGameAction(page, 'news-button'); await page.locator('#headline-pref').waitFor();
  if (await page.locator('#headline-pref').isChecked() !== on) await page.locator('#headline-pref').click();
  await closeDialog(page);
};

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await open({ width: 1440, height: 900 }, context);
  await createWorldFromMenu(page);

  // 1. A fresh world: Engineer, and the first review named in the row's tooltip.
  await page.locator('#company-stats').hover();
  await page.locator('#rating-row').waitFor();
  assert.equal(await page.locator('#company-title').textContent(), 'Engineer');
  assert.equal(await page.locator('#rating-row').getAttribute('title'), 'First review on 1 Apr 1950.');
  await page.screenshot({ path: `${output}/tooltip-first-review-1440.png` });
  await page.mouse.move(700, 600);
  await page.evaluate(() => document.querySelector('#company-stats').blur());

  // 5. The next-goal card reads the same with and without a rating.
  const goal = () => page.evaluate(() => document.querySelector('#objective-card')?.innerText ?? '');
  const goalBefore = await goal();

  // 2. At 8× through 31 March, the first review stamps Engineer with a score.
  await page.evaluate(() => { const g = transport.game; g.day = 89.9; g.lastDailyDay = 89; g.lastMonth = 2; g.revision++; transport.setSpeed(8); });
  await page.waitForFunction(() => { if (!transport.game.performance) return false; transport.setSpeed(0); return true; }, undefined, { timeout: 15000, polling: 'raf' });
  await page.waitForFunction(() => /^Engineer \d+ of 1,000$/.test(document.querySelector('#company-title').textContent), undefined, { timeout: 5000 });
  const first = await page.evaluate(() => ({ performance: transport.game.performance, title: document.querySelector('#rating-row').title }));
  assert.equal(first.performance.day, 90); assert.deepEqual(first.performance.reached, [90]);
  assert.equal(first.title, `Performance rating ${first.performance.score} of 1,000 at the review on 1 Apr 1950. Traffic manager at 120. Titles are kept once earned.`);
  await page.waitForTimeout(600);
  assert.equal(await goal(), goalBefore, 'the goal card is unchanged by the rating');
  assert.equal((await counts(page)).headlines, 0, 'the first review announces nothing');

  // 3. A new title arrives as one Company news headline with Open report, and no toast.
  let from = await counts(page);
  await page.evaluate(() => { transport.game.performance.reached.push(Math.floor(transport.game.day)); transport.game.money += 1; });
  await page.waitForFunction(from => window.__headlines.length > from, from.headlines, { timeout: 5000 });
  await page.waitForTimeout(2600);
  const promoted = await headlines(page, from.headlines);
  assert.deepEqual(promoted, [{ title: 'New title: Traffic manager', kicker: 'Company news', action: 'Open report' }]);
  assert.equal((await toasts(page, from.toasts)).filter(toast => /title/i.test(toast.text)).length, 0, 'never both a headline and a toast');
  assert.match(await page.locator('.headline-detail').textContent(), /^Your company scored \d+ of 1,000 at its quarterly review\. A title, once earned, is yours to keep\.$/);
  await page.screenshot({ path: `${output}/headline-new-title-1440.png` });
  await page.locator('.headline-action').click();
  await page.locator('#modal .rating-summary').waitFor();
  assert.equal(await page.evaluate(() => transport.speed), 0, 'the report pauses');
  assert.equal(await page.locator('#rating-title').textContent(), 'Traffic manager');
  assert.match(await page.locator('.rating-meta').innerText(), /^Transport coordinator at 240\s+Reviewed 1 Apr 1950, next review 1 Jul 1950$/);
  assert.match(await page.locator('.rating-value').innerText(), /^Company value\s+\$[\d,]+\s+Cash, vehicles and property at resale value and half of today’s infrastructure cost, less any loan\.$/);
  assert.equal(await page.locator('.rating-details').evaluate(el => el.open), false, 'What counts starts folded');
  await page.screenshot({ path: `${output}/company-rating-1440.png` });
  await page.locator('.rating-details summary').click();
  const table = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.rating-table tbody tr')].map(row => [...row.cells].map(cell => cell.textContent)), total: document.querySelector('.rating-table tfoot td:last-child').textContent, score: transport.game.performance.score }));
  assert.equal(table.rows.length, 9);
  assert.deepEqual(table.rows.map(row => row[0]), ['Vehicles earning a profit', 'Stops in use', 'Weakest route', 'Weakest quarter', 'Best quarter', 'Cargo delivered', 'Cargo types', 'Cash', 'No loan']);
  assert.equal(table.rows.reduce((sum, row) => sum + Number(row[3].split(' of ')[0]), 0), table.score, 'the points add up to the score');
  assert.equal(table.total, `${table.score} of 1,000`);
  assert.equal(table.rows[2][1], 'Counts from 10 vehicles with a full year');
  assert.equal(table.rows[8][1], 'No loan'); assert.equal(table.rows[8][3], '50 of 50');
  assert.match(table.rows[2][2], /^\$25,000 per vehicle$/, 'full marks at 1950 prices');
  assert.match(await page.locator('.rating-career').innerText(), /^Engineer, then Traffic manager\s+Apr 1950$/);
  await page.locator('.rating-details').screenshot({ path: `${output}/what-counts-1440.png` });
  await closeDialog(page);

  // The weakest route is named with Show, which opens that route.
  const routeId = await page.evaluate(() => { const g = transport.game, p = g.performance; p.values[2] = -1234; p.weakest = g.routes[0].id; return p.weakest; });
  await openGameAction(page, 'company-button');
  await page.locator('#modal .rating-summary').waitFor();
  assert.equal(await page.locator('.rating-details').evaluate(el => el.open), true, 'the fold is remembered for the session');
  assert.match(await page.locator('.rating-table tbody tr:nth-child(3) td:nth-child(2)').innerText(), /^−\$1,234 per vehicle last year\s+.+\s+Show$/);
  await page.locator('[data-rating-show]').click();
  await page.waitForFunction(() => !document.querySelector('#modal').open);
  await page.locator(`#route-list [data-route-id="${routeId}"]`).waitFor();
  await page.evaluate(() => { transport.game.performance.values[2] = null; transport.game.performance.weakest = null; });

  // With headlines off, a new title is one toast with Open report.
  await setHeadlines(page, false);
  from = await counts(page);
  await page.evaluate(() => { transport.game.performance.reached.push(Math.floor(transport.game.day)); transport.game.money += 1; });
  await page.waitForFunction(from => window.__toasts.slice(from).some(toast => toast.text.startsWith('New title')), from.toasts, { timeout: 5000 });
  await page.waitForTimeout(2600);
  const titleToasts = (await toasts(page, from.toasts)).filter(toast => toast.text.startsWith('New title'));
  assert.equal(titleToasts.length, 1);
  assert.match(titleToasts[0].text, /^New title: Transport coordinator\. Performance \d+ of 1,000\.$/);
  assert.deepEqual(titleToasts[0].actions, ['Open report']);
  assert.equal((await counts(page)).headlines, from.headlines, 'no card while headlines are off');
  assert.equal(await page.evaluate(() => transport.game.headlines.some(entry => entry.key === 'rating:2')), true, 'News still keeps it');

  // 4. The century: one toast with See evaluation; nothing opens and the speed holds.
  await page.evaluate(() => transport.setSpeed(3));
  from = await counts(page);
  await page.evaluate(() => { const p = transport.game.performance; p.century = { day: p.day, score: p.score, title: p.reached.length - 1, value: 4812300 }; transport.game.money += 1; });
  await page.waitForFunction(from => window.__toasts.slice(from).some(toast => toast.text.startsWith('A century')), from.toasts, { timeout: 5000 });
  await page.waitForTimeout(2600);
  const century = (await toasts(page, from.toasts)).filter(toast => toast.text.startsWith('A century'));
  assert.equal(century.length, 1);
  assert.match(century[0].text, /^A century of transport: Transport coordinator, performance \d+ of 1,000\.$/);
  assert.deepEqual(century[0].actions, ['See evaluation']);
  assert.deepEqual(await page.evaluate(() => ({ open: document.querySelector('#modal').open, speed: transport.speed })), { open: false, speed: 3 });
  await page.locator('#toast-region .toast-action', { hasText: 'See evaluation' }).click();
  await page.locator('#modal .century-card').waitFor();
  const card = await page.evaluate(() => ({ speed: transport.speed, focus: document.activeElement?.className, heading: document.querySelector('#modal h2').textContent, sub: document.querySelector('.century-card .modal-heading p').textContent, title: document.querySelector('.century-title strong').textContent, facts: [...document.querySelectorAll('.century-facts div')].map(div => div.innerText.replace(/\s+/g, ' ')) }));
  assert.equal(card.speed, 0, 'the card pauses');
  assert.equal(card.focus, 'close-modal');
  assert.equal(card.heading, 'A century of transport');
  assert.equal(card.sub, '1 Apr 1950. Your company has run for one hundred years.');
  assert.equal(card.title, 'Transport coordinator');
  assert.deepEqual(card.facts, ['Company value $4,812,300', 'Titles earned 3 of 9']);
  await page.screenshot({ path: `${output}/century-card-1440.png` });
  await page.locator('#modal [data-close]', { hasText: 'Keep playing' }).click();
  await page.waitForFunction(() => !document.querySelector('#modal').open);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => transport.speed), 3, 'Keep playing restores the speed');
  await page.evaluate(() => transport.setSpeed(0));

  // The finance card at a title, and the report's annual Rating column once a year has closed.
  await page.locator('#company-stats').hover();
  assert.match(await page.locator('#company-title').textContent(), /^Transport coordinator \d+ of 1,000$/);
  await page.locator('#company-tooltip').screenshot({ path: `${output}/tooltip-1440.png` });
  await page.mouse.move(700, 600);

  // 7. A reload from the autosave replays nothing; the report still offers the evaluation.
  await page.evaluate(() => transport.persist());
  await page.close();
  const reloaded = await open({ width: 1440, height: 900 }, context);
  await loadAutosaveFromMenu(reloaded);
  await reloaded.evaluate(() => transport.setSpeed(1));
  await reloaded.waitForTimeout(3500);
  const replay = await reloaded.evaluate(() => [...window.__toasts.map(toast => toast.text), ...window.__headlines.map(entry => entry.title)].filter(text => /title|century/i.test(text)));
  assert.deepEqual(replay, [], 'a load never announces the rating');
  await openGameAction(reloaded, 'company-button');
  await reloaded.locator('.rating-century').waitFor();
  assert.match(await reloaded.locator('.rating-century').innerText(), /^A century of transport: Transport coordinator, \d+ of 1,000\s+See evaluation$/);
  await reloaded.locator('#rating-century').click();
  await reloaded.locator('#modal .century-card').waitFor();
  await reloaded.locator('#century-report').click();
  await reloaded.locator('#modal .rating-summary').waitFor();
  await closeDialog(reloaded);
  await reloaded.close();
  await context.close();

  assert.deepEqual(errors, []);
  console.log('company rating browser check passed');
} finally {
  await browser.close();
}
