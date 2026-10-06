// Company report in a real browser: the starting-funds choice, a three-year company's charts, yearly
// table and route ranking, the January review, the optional loan and the quiet below-zero warning.
// Serve the repository root first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-company-qa';
await mkdir(output, { recursive: true });
const errors = [];

async function open(viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__toasts = [];
    addEventListener('DOMContentLoaded', () => new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node.classList?.contains('toast')) window.__toasts.push({ text: node.querySelector(':scope > span')?.textContent, type: node.className, actions: [...node.querySelectorAll('.toast-action')].map(button => button.textContent) });
    }).observe(document.querySelector('#toast-region'), { childList: true }));
  });
  await page.goto(url);
  return page;
}
const shown = page => page.evaluate(() => window.__toasts.length);
const toastsSince = (page, from) => page.evaluate(from => window.__toasts.slice(from), from);
// The simulation runs through the same model module the page imported, as whole days.
const advance = (page, days) => page.evaluate(async days => { const model = await import('./model.js'); model.tick(transport.game, days); transport.game.revision++; }, days);
const settle = page => page.waitForTimeout(900);

try {
  const page = await open({ width: 1440, height: 960 });
  await page.waitForFunction(() => document.querySelector('#start-menu')?.open);
  await page.locator('.start-advanced summary').click();
  const funds = page.locator('#start-world-form [name="startingFunds"]');
  assert.deepEqual(await funds.locator('option').allTextContents(), ['Relaxed · $400k (recommended)', 'Standard · $200k', 'Lean · $100k']);
  assert.equal(await funds.inputValue(), '400000', 'Relaxed is the default');
  await funds.selectOption('100000');
  await page.screenshot({ path: `${output}/start-funds-desktop.png` });
  await createWorldFromMenu(page);
  assert.deepEqual(await page.evaluate(() => ({ money: transport.game.money, funds: transport.game.startingFunds })), { money: 100000, funds: 100000 }, 'a lean company starts with $100k');

  // Three years later January announces the year that closed, with the report and the upgrade review.
  let from = await shown(page);
  await advance(page, 3 * 365 + 20);
  await page.waitForFunction(from => window.__toasts.slice(from).some(toast => /^New for 1953: /.test(toast.text)), from);
  const year = (await toastsSince(page, from)).find(toast => /^New for 1953: /.test(toast.text));
  assert.match(year.text, /^New for 1953: vehicles such as the Hollin Mk 4 bus carry 20% more and run 10% faster\. Prices rise \d\.\d% this year\. · 1952 operating profit \+\$[\d.,]+k \([+−]\d+%\) · best route .+$/);
  assert.deepEqual(year.actions, ['Open report', 'Review upgrades']);
  await page.screenshot({ path: `${output}/january-review-desktop.png` });
  await page.locator('#toast-region .toast-action', { hasText: 'Open report' }).click();
  await page.locator('#modal .company-report').waitFor();
  assert.equal(await page.evaluate(() => transport.speed), 0, 'the report pauses the game');
  const report = await page.evaluate(() => ({
    title: document.querySelector('#modal h2').textContent,
    charts: [...document.querySelectorAll('.company-chart')].map(chart => ({ label: chart.querySelector('figcaption span').textContent, points: chart.querySelector('.spark-line').getAttribute('points').split(' ').length })),
    years: [...document.querySelectorAll('.company-table tbody th')].map(cell => cell.textContent),
    annual: transport.game.annual.map(entry => String(entry.year)).reverse(),
    top: document.querySelectorAll('.company-routes:not(.below) .company-route').length,
    borrow: document.querySelector('#company-borrow').textContent,
  }));
  assert.equal(report.title, 'Company');
  assert.deepEqual(report.charts.map(chart => chart.label), ['Operating profit', 'Balance', 'Residents', 'Delivered a month']);
  assert.deepEqual(report.charts.map(chart => chart.points), [36, 36, 36, 36], 'three years of history fill the 36 months kept');
  assert.deepEqual(report.years, ['1952', '1951', '1950']);
  assert.deepEqual(report.years, report.annual);
  assert.equal(report.top, 1, 'the starter service leads the route ranking');
  assert.match(report.borrow, /^Borrow \$[\d,]+ · \$[\d,]+ \/ month interest$/, 'the interest shows before borrowing');
  await page.screenshot({ path: `${output}/company-desktop.png` });
  await page.locator('#modal').evaluate(modal => { modal.scrollTop = modal.scrollHeight; });
  await page.screenshot({ path: `${output}/company-desktop-bottom.png` });

  // Borrowing and repaying keep the dialog open and show the loan in the finance card.
  const before = await page.evaluate(() => transport.game.money);
  await page.locator('#company-borrow').click();
  await page.locator('#company-repay').waitFor();
  const borrowed = await page.evaluate(() => ({ loan: transport.game.loan, money: transport.game.money, focus: document.activeElement?.id, open: document.querySelector('#modal').open }));
  assert.ok(borrowed.loan > 50000, 'the step rises with inflation');
  assert.equal(borrowed.money, before + borrowed.loan);
  assert.equal(borrowed.focus, 'company-borrow');
  assert.equal(borrowed.open, true);
  assert.match(await page.locator('.company-loan header span').innerText(), /^\$[\d,]+ of \$[\d,]+$/);
  await page.locator('.company-loan').screenshot({ path: `${output}/loan-desktop.png` });
  await page.locator('#modal .close-modal').click();
  await page.locator('#company-stats').click();
  await page.locator('#loan-row').waitFor();
  assert.match(await page.locator('#company-tooltip').innerText(), /Loan\s+\$[\d,]+\s+Interest\s+\$[\d,]+ \/ month/);
  await page.screenshot({ path: `${output}/finance-card-desktop.png` });
  await page.locator('#open-report').click();
  await page.locator('#modal .company-report').waitFor();
  assert.equal(await page.locator('#company-stats').getAttribute('aria-expanded'), 'false', 'opening the report folds the finance card');
  await page.locator('#company-repay').click();
  await page.waitForFunction(() => transport.game.loan === undefined);
  assert.equal(await page.locator('#company-repay').count(), 0, 'Repay leaves with the loan');
  await page.locator('#modal .close-modal').click();
  await page.locator('#company-stats').hover();
  await page.locator('#company-tooltip').waitFor();
  assert.equal(await page.locator('#loan-row').isVisible(), false, 'no loan, no loan rows');
  // Hovering the finances, the pointer can travel down to Open report without the card closing.
  const card = await page.locator('#open-report').boundingBox();
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2, { steps: 8 });
  assert.equal(await page.locator('#open-report').isVisible(), true);
  await page.mouse.move(700, 600);

  // Below zero, the warning toasts when the streak begins and each January; News keeps every month.
  await page.evaluate(() => { transport.game.money = -40000; });
  from = await shown(page);
  await advance(page, 12);
  await page.waitForFunction(from => window.__toasts.slice(from).some(toast => /^Your balance is below zero/.test(toast.text)), from);
  const credit = (await toastsSince(page, from)).find(toast => /^Your balance is below zero/.test(toast.text));
  assert.deepEqual(credit.actions, ['Loan']);
  assert.match(credit.type, /warning/);
  await page.locator('#toast-region .toast-action', { hasText: 'Loan' }).click();
  await page.locator('#modal .company-loan').waitFor();
  const loanBox = await page.locator('.company-loan').boundingBox();
  assert.ok(loanBox.y >= 0 && loanBox.y < 960, 'Loan opens the report at its loan section');
  await page.locator('#modal .close-modal').click();
  from = await shown(page);
  await advance(page, 28);
  await settle(page);
  assert.equal((await toastsSince(page, from)).filter(toast => /below zero/.test(toast.text)).length, 0, 'a continuing streak stays quiet');
  assert.equal(await page.evaluate(() => transport.game.notifications.filter(notice => notice.topic === 'credit').length), 2);
  await openGameAction(page, 'news-button');
  assert.equal(await page.locator('.news-item', { hasText: 'Your balance is below zero' }).count(), 2, 'News keeps each month');
  await page.locator('#modal .close-modal').click();

  // With nothing left for a bus, retiring the only running service warns; a route below its upkeep is flagged.
  await page.evaluate(() => { const route = transport.game.routes[0]; route.expenses = route.revenue - (route.revenueAtAccountingStart || 0) + 5000; transport.game.money = 1000; transport.game.revision++; });
  await openGameAction(page, 'company-button');
  await page.locator('.company-routes.below').waitFor();
  assert.match(await page.locator('.company-routes.below').innerText(), /Earning less than its upkeep/);
  assert.equal(await page.locator('.company-routes:not(.below)').count(), 0);
  await page.locator('.company-routes.below').screenshot({ path: `${output}/below-upkeep-desktop.png` });
  await page.locator('[data-company-retire]').click();
  await page.locator('#confirm-retire').waitFor();
  assert.equal(await page.locator('.retire-warning').innerText(), 'This is your last earning service. After retiring it you cannot afford a new vehicle without a loan.');
  await page.screenshot({ path: `${output}/retire-warning-desktop.png` });
  await page.locator('#modal [data-close]').click();
  assert.equal(await page.evaluate(() => transport.game.routes.length), 1, 'keeping it running retires nothing');
  await page.close();

  assert.deepEqual(errors, []);
  console.log('company browser check passed');
} finally {
  await browser.close();
}
