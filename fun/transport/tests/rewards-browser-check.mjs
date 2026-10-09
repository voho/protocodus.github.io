// Goal rewards and medal prizes in a real browser: the Next goal card names the reward, the first delivery's toast
// and the finances card show it paid, Company goals lists every open reward, and an achievement toast names its prize.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-rewards';
await mkdir(output, { recursive: true });
const errors = [];
const days = (page, count, until) => page.evaluate(async ({ count, until }) => {
  const { tick } = await import('./model.js'), g = transport.game, done = until ? new Function('g', `return ${until}`) : () => false;
  for (let n = 0; n < count && !done(g); n++) tick(g, 1);
}, { count, until });
const toasts = page => page.evaluate(() => window.__toasts);

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    window.__toasts = [];
    addEventListener('DOMContentLoaded', () => new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node.classList?.contains('toast')) window.__toasts.push(node.querySelector(':scope > span:not(.medal)')?.textContent || '');
    }).observe(document.querySelector('#toast-region'), { childList: true }));
  });
  await page.goto(url);
  await createWorldFromMenu(page, { biome: 'taiga', seed: 1847, generationVersion: 13 });
  await page.locator('#objective-card').waitFor({ state: 'visible' });

  // The first route's card ends its sentence with the first goal's reward, in the card's existing lines.
  assert.match(await page.locator('#objective-summary .objective-reward').innerText(), /^\$10,000 reward$/);
  assert.ok((await page.locator('#objective-card').evaluate(el => el.getBoundingClientRect().height)) <= 220, 'the reward adds no line');
  await page.locator('#objective-card').screenshot({ path: `${output}/next-goal.png` });

  // Plan road, Build and Launch, then the first delivery: one toast names the fare and the goal's reward.
  await page.locator('#objective-plan').click();await page.locator('#build-connection-plan').click();
  await page.locator('#route-launch [type="submit"]').click();
  await page.locator('#route-list[data-route-detail]').waitFor();
  await days(page, 120, "g.milestones['first-freight']!==undefined");
  await page.waitForTimeout(1500);
  const first = (await toasts(page)).find(text => /^First .+ delivered on/.test(text));
  assert.match(first, / · Goal reached, \+\$10,000 reward$/, first);
  const paid = await page.evaluate(() => ({ monthly: transport.game.monthlyRewards, total: transport.game.totalRewards }));
  assert.deepEqual(paid, { monthly: 10000, total: 10000 });

  // The finances card lists this month's rewards beside fares and running costs.
  await page.locator('#balance').hover();
  await page.locator('#company-tooltip').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#rewards-row').isVisible(), true);
  assert.equal(await page.locator('#rewards-exact').innerText(), '+$10,000');
  await page.locator('#company-tooltip').screenshot({ path: `${output}/finances.png` });
  await page.mouse.move(700, 600);

  // Later goals fold to a chip; opened, the next goal names its own reward. Company goals lists every open one.
  while (await page.locator('#objective-chip').evaluate(el => { const b = el.getBoundingClientRect(), top = document.elementFromPoint(b.left + 20, b.top + b.height / 2); return !el.contains(top); })) await page.keyboard.press('Escape');
  await page.locator('#objective-chip').click();
  assert.match(await page.locator('#objective-detail').innerText(), /\$20,000 reward$/);
  await page.locator('#objective-card').screenshot({ path: `${output}/next-goal-later.png` });
  await openGameAction(page, 'goals-button');
  await page.locator('.goals-dialog').waitFor();
  assert.match(await page.locator('.goals-dialog .modal-heading p').innerText(), /Each pays a one-off reward/);
  const open = await page.locator('.goal-row:not(.done) .goal-reward').allInnerTexts();
  assert.ok(open.length >= 3 && open.every(text => /^Reward \$[\d,]+$/.test(text)), JSON.stringify(open));
  assert.equal(await page.locator('.goal-row.done .goal-reward').count(), 0, 'reached goals show their date, not a reward');
  await page.locator('.goals-dialog').screenshot({ path: `${output}/goals.png` });
  await page.keyboard.press('Escape');

  // A bronze medal pays its prize, named in its toast and in the dialog's next rung.
  const before = (await toasts(page)).length;
  await page.evaluate(() => { transport.game.totalDelivered = 100000; });
  await days(page, 1);
  // Notices queue one after another, so the medal may wait behind the delivery's toasts.
  await page.waitForFunction(before => window.__toasts.slice(before).some(text => /achievement/.test(text)), before, { timeout: 30000 });
  const medal = (await toasts(page)).slice(before).find(text => /achievement/.test(text));
  assert.match(medal, /^Bronze achievement: 100,000 delivered\. \+\$25,000\.$/, medal);
  await openGameAction(page, 'achievements-button');
  await page.locator('.achievements-dialog').waitFor();
  assert.match(await page.locator('[data-family="delivered"] .achievement-prize').innerText(), /^Silver pays \$100k$/);
  await page.locator('[data-family="delivered"]').screenshot({ path: `${output}/achievement-row.png` });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, output }));
} finally {
  await browser.close();
}
