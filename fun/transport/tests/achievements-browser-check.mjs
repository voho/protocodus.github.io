// Achievements in a real browser: the dialog from the Game menu (six groups, nothing earned, five hidden rows, the
// clock paused), one bronze toast with its medal and Open achievements, no second toast that game month, a burst of two
// the next month as one gold toast that stays 8 s, a gold record as a headline, a reload and an older save that celebrate
// nothing, the Company report's line, no HUD badge and an unchanged goal card, and phone widths with no sideways scroll.
// Serve the repository root on a fresh no-store port first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-achievements-qa';
await mkdir(output, { recursive: true });
const errors = [];

async function open(context) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    window.__toasts = []; window.__headlines = [];
    addEventListener('DOMContentLoaded', () => {
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) if (node.classList?.contains('toast')) window.__toasts.push({ text: node.querySelector(':scope > span:not(.medal)')?.textContent, className: node.className, medal: node.querySelector(':scope > .medal')?.className ?? null, actions: [...node.querySelectorAll('.toast-action')].map(button => button.textContent), at: performance.now(), node });
      }).observe(document.querySelector('#toast-region'), { childList: true });
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) if (node.classList?.contains('headline-card')) window.__headlines.push({ title: node.querySelector('h2')?.textContent, kicker: node.querySelector('.headline-kicker span')?.textContent, action: node.querySelector('.headline-action')?.textContent ?? null });
      }).observe(document.querySelector('#headline-slot'), { childList: true });
    });
  });
  await page.goto(url);
  return page;
}
const achievementToasts = (page, from = 0) => page.evaluate(from => window.__toasts.slice(from).filter(t => /achievement/.test(t.className)).map(({ node, ...t }) => t), from);
const toastCount = page => page.evaluate(() => window.__toasts.length);
const closeDialog = async page => { await page.locator('#modal .close-modal').click(); await page.waitForFunction(() => !document.querySelector('#modal').open); await page.waitForTimeout(150); };
const openAchievements = async page => { await openGameAction(page, 'achievements-button'); await page.locator('.achievements-dialog').waitFor(); };
const summary = page => page.locator('.achievements-summary').innerText();
const overflow = page => page.evaluate(() => { const modal = document.querySelector('#modal'); return { page: document.documentElement.scrollWidth - innerWidth, modal: modal.open ? modal.scrollWidth - modal.clientWidth : 0 }; });
const setHeadlines = async (page, on) => {
  await openGameAction(page, 'news-button'); await page.locator('#headline-pref').waitFor();
  if (await page.locator('#headline-pref').isChecked() !== on) await page.locator('#headline-pref').click();
  await closeDialog(page);
};
// The HUD shows nothing about achievements outside the dialog, the menu, toasts and headlines.
const badges = page => page.evaluate(() => [...document.querySelectorAll('[class*="achievement"], [class*="medal"]')].filter(el => !el.closest('#modal, #game-menu, #toast-region, #headline-slot')).length);
const goal = page => page.evaluate(() => document.querySelector('#objective-card')?.innerText ?? '');

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await open(context);
  await createWorldFromMenu(page, { seed: 1847 });
  await page.waitForTimeout(1200);
  const goalBefore = await goal(page);

  // 1. The Game menu opens Achievements: six groups, nothing earned, five hidden rows, and the clock paused.
  await page.evaluate(() => transport.setSpeed(1));
  await openAchievements(page);
  assert.equal(await page.evaluate(() => transport.speed), 0, 'the dialog pauses like News');
  assert.equal(await page.locator('.achievement-group').count(), 6);
  assert.match(await summary(page), /^0 of 41 earned$/);
  assert.equal(await page.locator('.achievement-row[data-state="hidden"]').count(), 5);
  assert.equal(await page.locator('.achievement-row[data-state="hidden"] .medal-mark').allTextContents().then(list => list.join('')), '?????');
  assert.equal(await page.locator('.achievements-dialog .medal:not(.is-locked)').count(), 0);
  assert.deepEqual(await overflow(page), { page: 0, modal: 0 });
  await page.screenshot({ path: `${output}/dialog-new-1440.png` });
  await closeDialog(page);
  assert.equal(await page.evaluate(() => transport.speed), 1, 'closing resumes the clock');

  // 2. 100,000 deliveries: exactly one bronze toast after the next day boundary, with its medal and Open achievements.
  let from = await toastCount(page);
  await page.evaluate(() => { transport.game.totalDelivered = 100000; });
  await page.waitForFunction(from => window.__toasts.slice(from).some(t => /achievement/.test(t.className)), from, { timeout: 8000 });
  await page.waitForTimeout(2500);
  const bronze = await achievementToasts(page, from);
  assert.equal(bronze.length, 1, JSON.stringify(bronze));
  assert.equal(bronze[0].text, 'Bronze achievement: 100,000 delivered.');
  assert.match(bronze[0].className, /\bmilestone\b.*\bachievement\b.*\btier-bronze\b/);
  assert.match(bronze[0].medal, /medal--bronze/);assert.deepEqual(bronze[0].actions, ['Open achievements']);
  await page.evaluate(() => transport.setSpeed(0));
  await page.locator('#toast-region .toast.achievement').screenshot({ path: `${output}/toast-bronze-1440.png` });
  await page.screenshot({ path: `${output}/toast-bronze-map-1440.png` });
  await page.locator('#toast-region .toast.achievement .toast-action').click();
  await page.locator('.achievements-dialog').waitFor();
  const delivered = page.locator('.achievement-row[data-family="delivered"]');
  assert.equal(await delivered.locator('.medal--bronze:not(.is-locked)').count(), 1);
  const stamp = await page.evaluate(() => transport.game.achievements.unlocked['delivered-100k']);
  const date = await page.evaluate(async day => (await import('./copy.js')).dateLong(day), stamp);
  assert.match(await delivered.locator('.medal--bronze').getAttribute('title'), new RegExp(`^Bronze: 100,000 delivered, earned ${date}$`));
  assert.match(await delivered.locator('.achievement-earned').innerText(), new RegExp(`^100,000 delivered, earned ${date}$`));
  assert.match(await delivered.locator('strong').first().innerText(), /^A million delivered$/);
  assert.match(await delivered.locator('.achievement-value').innerText(), /^100,\d{3} of 1,000,000 delivered$/);
  assert.match(await summary(page), /^1 of 41 earned$/);
  await delivered.screenshot({ path: `${output}/row-delivered-1440.png` });
  await closeDialog(page);

  // 3. At most one achievement toast a game month: ten vehicles later that month waits in the dialog.
  const month = await page.evaluate(() => transport.game.lastMonth);
  from = await toastCount(page);
  await page.evaluate(() => { const g = transport.game, bus = g.vehicles[0]; for (let n = g.vehicles.length; n < 10; n++) g.vehicles.push({ ...bus, id: `early-${n}` }); transport.setSpeed(1); });
  await page.waitForFunction(() => transport.game.achievements.unlocked['fleet-10'] !== undefined, undefined, { timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => transport.setSpeed(0));
  assert.equal(await page.evaluate(() => transport.game.lastMonth), month, 'still the same month');
  assert.deepEqual(await achievementToasts(page, from), [], 'a second record in one month is not toasted');

  // 4. The next month, with headlines off, a fleet of 1,000 arrives as one grouped gold toast that stays 8 s.
  await setHeadlines(page, false);
  await page.evaluate(() => transport.setSpeed(8));
  await page.waitForFunction(month => transport.game.lastMonth > month, month, { timeout: 15000 });
  await page.evaluate(() => transport.setSpeed(0));
  from = await toastCount(page);
  await page.evaluate(() => { const g = transport.game, bus = g.vehicles[0]; for (let n = 1; n < 1000; n++) g.vehicles.push({ ...bus, id: `clone-${n}` }); transport.setSpeed(1); });
  await page.waitForFunction(from => window.__toasts.slice(from).some(t => /achievement/.test(t.className)), from, { timeout: 8000 });
  const shownAt = await page.evaluate(() => performance.now());
  await page.evaluate(() => transport.setSpeed(0));
  const fleet = await achievementToasts(page, from);
  assert.equal(fleet.length, 1, JSON.stringify(fleet));
  assert.equal(fleet[0].text, '2 achievements earned: A hundred vehicles and A thousand vehicles.');
  assert.match(fleet[0].className, /\btier-gold\b/);assert.match(fleet[0].medal, /medal--gold/);
  await page.locator('#toast-region .toast.tier-gold').screenshot({ path: `${output}/toast-gold-group-1440.png` });
  await page.waitForTimeout(Math.max(0, 6500 - (await page.evaluate(() => performance.now()) - shownAt)));
  assert.equal(await page.locator('#toast-region .toast.tier-gold').count(), 1, 'gold stays past 5 s');
  await page.waitForFunction(() => !document.querySelector('#toast-region .toast.tier-gold'), undefined, { timeout: 3000 });
  assert.ok(await page.evaluate(() => transport.game.headlines?.some(h => h.key === 'achievement:fleet-1000:gold')), 'News keeps the gold record');

  // 5. With headlines on, a gold record is a headline card with Open achievements, and no toast.
  await setHeadlines(page, true);
  from = await toastCount(page);
  const cards = await page.evaluate(() => window.__headlines.length);
  // A margin over the billion: a day's upkeep for the thousand-bus fleet must not drop it below before the day closes.
  await page.evaluate(() => { transport.game.money = 1.1e9; transport.setSpeed(1); });
  await page.waitForFunction(cards => window.__headlines.length > cards, cards, { timeout: 8000 });
  await page.evaluate(() => transport.setSpeed(0));
  const card = (await page.evaluate(cards => window.__headlines.slice(cards), cards)).at(-1);
  assert.deepEqual(card, { title: 'Gold achievement: A billion, nominally', kicker: 'Achievement', action: 'Open achievements' });
  assert.equal(await page.evaluate(() => transport.headline), 'achievement:billion-nominal:gold');
  await page.waitForTimeout(1500);
  assert.deepEqual(await achievementToasts(page, from), [], 'a carded record is not toasted too');
  await page.locator('.headline-card').screenshot({ path: `${output}/headline-gold-1440.png` });
  await page.locator('.headline-card .headline-action').click();
  await page.locator('.achievements-dialog').waitFor();
  assert.match(await summary(page), /^5 of 41 earned$/);
  assert.equal(await page.locator('.achievement-row[data-state="hidden"]').count(), 4, 'the nominal billion is revealed');
  assert.match(await page.locator('.achievement-row[data-family="billion-nominal"]').innerText(), /A billion, nominally/);
  await page.screenshot({ path: `${output}/dialog-earned-1440.png` });
  await page.locator('#modal').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.screenshot({ path: `${output}/dialog-earned-bottom-1440.png` });
  await closeDialog(page);

  // 6. The Company report counts them and opens the dialog; nothing shows on the HUD and the goal card is unchanged.
  await openGameAction(page, 'company-button');
  await page.locator('.rating-achievements').waitFor();
  assert.match(await page.locator('.rating-achievements').innerText(), /^Achievements\s+5 of 41\s+Open$/);
  await page.locator('.rating-achievements').screenshot({ path: `${output}/company-line-1440.png` });
  await page.locator('.rating-achievements [data-open-achievements]').click();
  await page.locator('.achievements-dialog').waitFor();
  await closeDialog(page);
  await page.waitForTimeout(600);
  assert.equal(await badges(page), 0, 'no HUD badge');
  assert.equal(await goal(page), goalBefore, 'the goal card never mentions achievements');

  // 7. Persist, reload and Continue: nothing replays, and the dialog keeps five.
  await page.evaluate(() => transport.persist());
  await page.reload();
  await loadAutosaveFromMenu(page);
  from = await toastCount(page);
  await page.evaluate(() => transport.setSpeed(1));await page.waitForTimeout(2500);await page.evaluate(() => transport.setSpeed(0));
  assert.deepEqual(await achievementToasts(page), [], 'a reload celebrates nothing');
  await openAchievements(page);
  assert.match(await summary(page), /^5 of 41 earned$/);
  await closeDialog(page);

  // 8. An older autosave without records is credited quietly: no toast, the stamps and 'Records began'.
  // Leaving the page saves the company, so the save is edited at the start menu, before Continue.
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#start-menu')?.open);
  await page.evaluate(() => { const saved = JSON.parse(localStorage.getItem('transport-save-v1')); delete saved.state.achievements; saved.state.day += 400; saved.state.lastDailyDay += 400; localStorage.setItem('transport-save-v1', JSON.stringify(saved)); });
  await loadAutosaveFromMenu(page);
  await page.evaluate(() => transport.setSpeed(1));await page.waitForTimeout(2500);await page.evaluate(() => transport.setSpeed(0));
  assert.deepEqual(await achievementToasts(page), [], 'an older save is credited quietly');
  const legacy = await page.evaluate(() => ({ since: transport.game.achievements.since, day: Math.floor(transport.game.day), ids: Object.keys(transport.game.achievements.unlocked) }));
  assert.ok(legacy.since >= 400 && legacy.since <= legacy.day, JSON.stringify(legacy));
  assert.ok(['delivered-100k', 'fleet-10', 'fleet-100', 'fleet-1000', 'billion-nominal'].every(id => legacy.ids.includes(id)), legacy.ids.join());
  await openAchievements(page);
  assert.match(await summary(page), /^5 of 41 earned\s+Records began in [A-Z][a-z]{2} 1951$/);
  await page.screenshot({ path: `${output}/dialog-backfilled-1440.png` });
  await closeDialog(page);
  await openGameAction(page, 'company-button');
  assert.match(await page.locator('.rating-achievements').innerText(), /^Achievements\s+5 of 41\s+Open$/);
  await closeDialog(page);
  await context.close();

  // 9. Phones: the dialog never scrolls sideways and a toast fits.
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    const phone = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const small = await open(phone);
    await createWorldFromMenu(small, { seed: 1847 });
    await small.evaluate(() => { const g = transport.game; g.totalDelivered = 1e6; g.achievements.cargo = 7; transport.setSpeed(1); });
    await small.waitForFunction(() => document.querySelector('#toast-region .toast.achievement'), undefined, { timeout: 8000 });
    await small.evaluate(() => transport.setSpeed(0));
    const box = await small.locator('#toast-region .toast.achievement').first().boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, `the toast fits at ${viewport.width}: ${JSON.stringify(box)}`);
    await small.screenshot({ path: `${output}/toast-${viewport.width}.png` });
    await openAchievements(small);
    assert.deepEqual(await overflow(small), { page: 0, modal: 0 }, `no sideways scroll at ${viewport.width}`);
    await small.screenshot({ path: `${output}/dialog-${viewport.width}.png` });
    await small.locator('.achievement-row[data-family="every-cargo"]').scrollIntoViewIfNeeded();
    await small.screenshot({ path: `${output}/dialog-cargo-${viewport.width}.png` });
    await phone.close();
  }
  assert.deepEqual(errors, []);
  console.log('achievements browser check passed');
} finally {
  await browser.close();
}
