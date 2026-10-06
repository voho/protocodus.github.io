// Headlines in a real browser: a rare paper card that never pauses, never takes focus, waits for the plain map,
// holds while pointed at or hidden, keeps 15 s between cards, is kept in News and can be switched off there.
// Serve the repository root on a fresh no-store port first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-headlines-qa';
await mkdir(output, { recursive: true });
const errors = [];

async function open(viewport, options = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, ...options });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Every card added to the slot, with the most present at once, and every toast shown.
  await page.addInitScript(() => {
    window.__headlines = { added: [], max: 0 }; window.__toasts = [];
    addEventListener('DOMContentLoaded', () => {
      const slot = document.querySelector('#headline-slot');
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) if (node.classList?.contains('headline-card')) window.__headlines.added.push({ title: node.querySelector('h2')?.textContent, kicker: node.querySelector('.headline-kicker')?.textContent, at: performance.now() });
        window.__headlines.max = Math.max(window.__headlines.max, slot.querySelectorAll('.headline-card:not(.leaving)').length);
      }).observe(slot, { childList: true });
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) if (node.classList?.contains('toast')) window.__toasts.push(node.querySelector(':scope > span')?.textContent);
      }).observe(document.querySelector('#toast-region'), { childList: true });
    });
  });
  await page.goto(url);
  return page;
}
const added = page => page.evaluate(() => window.__headlines.added.length);
const waitForCard = (page, count, timeout = 2000) => page.waitForFunction(count => window.__headlines.added.length >= count && Boolean(window.transport?.headline), count, { timeout });
const now = page => page.evaluate(() => performance.now());
const waitUntil = async (page, at) => { const left = at - await now(page); if (left > 0) await page.waitForTimeout(left); };
const visibility = page => page.evaluate(() => { const card = document.querySelector('.headline-card:not(.leaving)'); return card ? getComputedStyle(card).visibility : null; });
const box = (page, selector) => page.locator(selector).evaluate(el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; });
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
// A town is served for the first time: the simulation's own lastServiceDay, stamped as a delivery would.
const arrive = (page, indexes) => page.evaluate(list => { const g = transport.game; for (const index of list) g.cities[index].lastServiceDay = Math.floor(g.day); g.money += 1; return list.map(index => g.cities[index].name); }, indexes);
// Closing a dialog restores the speed it paused, a task after the click.
const closeNews = async page => { await page.locator('#modal .close-modal').click(); await page.waitForFunction(() => !document.querySelector('#modal').open); await page.waitForTimeout(100); };

try {
  const page = await open({ width: 1440, height: 900 });
  await createWorldFromMenu(page, { paused: false });
  // a. A fresh company at 8× shows no headline, and News keeps none.
  await page.evaluate(() => transport.setSpeed(8));
  await page.waitForTimeout(8000);
  assert.equal(await added(page), 0, 'a fresh world makes no headline');
  assert.equal(await page.evaluate(() => transport.game.headlines), undefined);
  await openGameAction(page, 'news-button');
  await page.locator('.news-list').waitFor();
  assert.equal(await page.locator('.news-headline').count(), 0);
  assert.equal(await page.locator('#headline-pref').isChecked(), true, 'headlines are on by default');
  await closeNews(page);

  // b. The first arrival in a town: one card, the game keeps its speed and focus.
  await page.evaluate(() => transport.setSpeed(1));
  const before = await page.evaluate(() => ({ speed: transport.speed, focus: document.activeElement?.id || document.activeElement?.tagName }));
  const [first] = await arrive(page, [5]);
  await waitForCard(page, 1);
  const card = await page.evaluate(() => ({ title: document.querySelector('.headline-card h2').textContent, kicker: document.querySelector('.headline-kicker span').textContent, date: document.querySelector('.headline-kicker time').textContent, key: transport.headline, speed: transport.speed, focus: document.activeElement?.id || document.activeElement?.tagName, status: document.querySelector('#status-message').textContent }));
  assert.equal(card.title, `${first} joins your network`, 'no route reaches it, so the town simply joins');
  assert.equal(card.kicker, 'Local news'); assert.match(card.date, /^\d{1,2} [A-Z][a-z]{2} 1950$/, 'dates read 14 Mar 1950');
  assert.match(card.key, /^arrival:/);
  assert.deepEqual({ speed: card.speed, focus: card.focus }, before, 'the card neither pauses nor takes focus');
  assert.equal(card.status, card.title, 'the live status line reads the headline');
  assert.doesNotMatch(await page.locator('.headline-card').innerText(), / · /, 'the kicker and date share a line without a middle dot');
  await page.waitForTimeout(400);
  const cardBox = await box(page, '.headline-card');
  assert.ok(!overlaps(cardBox, await box(page, '#objective-card')), 'the card leaves the expanded goal card clear');
  assert.ok(Math.abs(cardBox.left + cardBox.width / 2 - 720) < 2 && cardBox.width <= 440, 'top centre, at most 440 wide');
  await page.screenshot({ path: `${output}/arrival-1440.png` });
  await page.mouse.click(cardBox.left + cardBox.width / 2, cardBox.bottom + 40);
  await page.locator('#inspector').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => transport.headline), card.key, 'a click on the map beside the card inspects, and the card stays');
  await page.keyboard.press('Escape');

  // f. Show opens the town.
  await page.locator('.headline-card .headline-action').click();
  const shownAt = await now(page);
  await page.waitForFunction(name => document.querySelector('#inspector-title')?.textContent.includes(name), first);
  assert.equal(await page.evaluate(() => transport.headline), null, 'the action dismisses the card');
  await page.keyboard.press('Escape');

  // c. Four arrivals at once: one card at a time, 15 s apart, and News keeps all four.
  const four = await arrive(page, [6, 7, 8, 9]);
  const count = await added(page);
  await waitUntil(page, shownAt + 14000);
  assert.equal(await added(page), count, 'no card within 14 s of the last one closing');
  await waitUntil(page, shownAt + 14500);
  await page.waitForFunction(count => window.__headlines.added.length > count, count, { timeout: 3000 });
  assert.ok(await now(page) - shownAt < 17500, 'the next card comes by 17 s');
  assert.equal(await page.evaluate(() => window.__headlines.max), 1, 'never more than one card');
  await openGameAction(page, 'news-button');
  await page.locator('.news-list').waitFor();
  const news = await page.locator('.news-headline').allInnerTexts();
  for (const name of [first, ...four]) assert.ok(news.some(text => text.includes(name)), `News keeps ${name}`);
  assert.equal(await visibility(page), 'hidden', 'News hides the card');
  await page.screenshot({ path: `${output}/news-1440.png` });
  await closeNews(page);

  // d. Pointing holds the card; leaving lets it go. The game menu hides it and stops its time.
  let key = await page.evaluate(() => transport.headline);
  await page.hover('.headline-card');
  await page.waitForTimeout(12000);
  assert.equal(await page.evaluate(() => transport.headline), key, 'a card held by the pointer stays');
  await page.mouse.move(200, 700);
  await page.waitForFunction(() => !transport.headline, undefined, { timeout: 11000 });
  const next = await added(page);
  await page.waitForFunction(count => window.__headlines.added.length > count && transport.headline, next, { timeout: 17000 });
  key = await page.evaluate(() => transport.headline);
  await page.locator('#game-menu-button').click();
  await page.waitForTimeout(300);
  assert.equal(await visibility(page), 'hidden', 'the game menu hides the card');
  await page.waitForTimeout(12000);
  assert.equal(await page.evaluate(() => transport.headline), key, 'a hidden card keeps its time');
  await page.locator('#game-menu-button').click();
  await page.waitForTimeout(300);
  assert.equal(await visibility(page), 'visible');
  await page.waitForFunction(() => !transport.headline, undefined, { timeout: 11000 });

  // e. Building: no new card while a tool is active; a card on screen hides and waits for the tool to close.
  const building = await added(page);
  await page.evaluate(() => transport.setTool('road'));
  await arrive(page, [10]);
  await page.waitForTimeout(17000);
  assert.equal(await added(page), building, 'no card while building');
  await page.keyboard.press('Escape');
  await page.waitForFunction(count => window.__headlines.added.length > count && transport.headline, building, { timeout: 2000 });
  key = await page.evaluate(() => transport.headline);
  await page.evaluate(() => transport.setTool('road'));
  await page.waitForTimeout(300);
  assert.equal(await visibility(page), 'hidden', 'the tool bar hides the card');
  await page.screenshot({ path: `${output}/building-1440.png` });
  await page.waitForTimeout(12000);
  assert.equal(await page.evaluate(() => transport.headline), key, 'the card waits while building');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await visibility(page), 'visible', 'the card comes back when the tool closes');
  await page.waitForFunction(() => !transport.headline, undefined, { timeout: 11000 });
  assert.equal(await page.evaluate(() => window.__headlines.max), 1);
  await page.close();

  // g. A served town passing 2,500 makes a headline instead of the toast.
  const towns = await open({ width: 1440, height: 900 });
  await createWorldFromMenu(towns, { paused: false });
  await towns.evaluate(() => { const g = transport.game; g.cities[0].population = 2600; g.day += 1; g.money += 1; });
  await waitForCard(towns, 1, 3000);
  assert.equal(await towns.locator('.headline-card h2').textContent(), 'Alderbrook welcomes its 2,500th resident');
  assert.equal(await towns.locator('.headline-kicker span').textContent(), 'Town news');
  await towns.waitForTimeout(2500);
  assert.ok(!(await towns.evaluate(() => window.__toasts)).some(text => /reached 2,500/.test(text)), 'the card replaces the town toast');
  await towns.close();

  // h. A new series of the player's most-used vehicle makes the models headline (ttd-vehicle-models), and the January toast keeps only the prices.
  const models = await open({ width: 1440, height: 900 });
  await createWorldFromMenu(models, { paused: false });
  await models.evaluate(() => { transport.setSpeed(8); transport.game.day = 4018 - .5; });
  await waitForCard(models, 1, 4000);
  assert.equal(await models.locator('.headline-card h2').textContent(), 'New Pendle buses arrive for 1961');
  assert.equal(await models.locator('.headline-detail').textContent(), 'The Pendle Mk 1 bus carries 3.2 times the load of a 1950 bus and runs 2.1× as fast.');
  assert.equal(await models.locator('.headline-kicker span').textContent(), 'New models');
  assert.equal(await models.locator('.headline-action').textContent(), 'Review upgrades');
  await models.waitForFunction(() => window.__toasts.some(text => /^Prices rise \d\.\d% in 1961\./.test(text)), undefined, { timeout: 3000 });
  assert.ok(!(await models.evaluate(() => window.__toasts)).some(text => /vehicles (such as|carry)/.test(text)), 'the toast leaves the models to the card');
  await models.screenshot({ path: `${output}/models-1440.png` });
  await models.evaluate(() => transport.setSpeed(0));
  const money = await models.evaluate(() => transport.game.money);
  await models.locator('.headline-action').click();
  await models.waitForFunction(() => document.activeElement?.id === 'upgrade-fleet', undefined, { timeout: 3000 });
  assert.equal(await models.evaluate(() => transport.game.money), money, 'Review upgrades never spends');
  await models.evaluate(() => { transport.setSpeed(8); transport.game.day = 4383 - .5; });
  await models.waitForFunction(() => window.__toasts.some(text => /^New for 1962: vehicles such as the Pendle Mk 2 bus carry 20% more/.test(text)), undefined, { timeout: 4000 });
  assert.equal(await models.evaluate(() => transport.game.headlines.some(entry => entry.key === 'models:1962')), false, 'a year without a new bus series makes no headline');
  await models.close();

  // i. Switched off: no card, the old toasts return, and News still keeps every headline, across a reload.
  const quiet = await open({ width: 1440, height: 900 });
  await createWorldFromMenu(quiet, { paused: false });
  await openGameAction(quiet, 'news-button');
  await quiet.locator('#headline-pref').uncheck();
  await closeNews(quiet);
  const [town] = await arrive(quiet, [5]);
  await quiet.waitForTimeout(3000);
  assert.equal(await added(quiet), 0, 'no card with headlines off');
  await quiet.evaluate(() => { const g = transport.game; g.cities[0].population = 5100; g.day += 1; g.money += 1; });
  await quiet.waitForFunction(() => window.__toasts.some(text => /^Alderbrook reached 5,000 residents$/.test(text)), undefined, { timeout: 5000 });
  assert.equal(await added(quiet), 0);
  await openGameAction(quiet, 'news-button');
  await quiet.locator('.news-list').waitFor();
  assert.equal(await quiet.locator('#headline-pref').isChecked(), false);
  const items = await quiet.locator('.news-item').evaluateAll(list => list.map(item => ({ headline: item.classList.contains('news-headline'), text: item.innerText, date: item.querySelector('time')?.textContent })));
  assert.equal(items.filter(item => item.headline).length, 2, 'News keeps both headlines');
  assert.ok(items.some(item => item.headline && item.text.includes(`${town} joins your network`)));
  assert.ok(items.some(item => item.headline && item.text.includes('Alderbrook grows to 5,000 residents')));
  assert.ok(items.some(item => !item.headline), 'notices sit beside them');
  const days = items.map(item => Date.parse(item.date + ' UTC'));
  assert.ok(days.every((day, index) => index === 0 || day <= days[index - 1]), 'newest first');
  assert.ok(items.findIndex(item => item.headline) < items.findIndex(item => /Welcome/.test(item.text)), 'headlines interleave with notices by date');
  await quiet.screenshot({ path: `${output}/news-off-1440.png` });
  await quiet.locator('.news-headline', { hasText: town }).locator('[data-news-target]').click();
  await quiet.waitForFunction(name => document.querySelector('#inspector-title')?.textContent.includes(name), town);
  const kept = await quiet.evaluate(() => transport.game.headlines.length);
  assert.equal(await quiet.evaluate(() => transport.persist()), true);
  await quiet.reload();
  await loadAutosaveFromMenu(quiet, { paused: false });
  assert.equal(await quiet.evaluate(() => transport.game.headlines.length), kept, 'the log is saved');
  await openGameAction(quiet, 'news-button');
  assert.equal(await quiet.locator('#headline-pref').isChecked(), false, 'the choice is remembered');
  // j. Switched back on, a reloaded company replays nothing.
  await quiet.locator('#headline-pref').check();
  await closeNews(quiet);
  assert.equal(await quiet.evaluate(() => transport.persist()), true);
  await quiet.reload();
  await loadAutosaveFromMenu(quiet, { paused: false });
  await quiet.evaluate(() => transport.setSpeed(8));
  await quiet.waitForTimeout(5000);
  assert.equal(await added(quiet), 0, 'loading replays no headline');
  await quiet.close();

  // k. Reduced motion: the card appears without animation.
  const still = await open({ width: 1440, height: 900 }, { reducedMotion: 'reduce' });
  await createWorldFromMenu(still, { paused: false });
  await arrive(still, [5]);
  await waitForCard(still, 1);
  assert.equal(await still.locator('.headline-card').evaluate(el => getComputedStyle(el).animationName), 'none');
  // Escape inside the card dismisses it at once and hands focus back to the map.
  await still.locator('.headline-close').focus();
  assert.equal(await still.evaluate(() => transport.headline) !== null, true, 'focus inside holds the card');
  await still.keyboard.press('Escape');
  assert.equal(await still.locator('.headline-card').count(), 0, 'dismissed at once under reduced motion');
  assert.equal(await still.evaluate(() => document.activeElement?.id), 'world');
  assert.equal(await still.evaluate(() => transport.speed), 1, 'Escape on the card leaves the game running');
  await still.close();

  // l. Layout at 1024: clear of the expanded goal card and of a tall stop inspector.
  const compact = await open({ width: 1024, height: 768 });
  await createWorldFromMenu(compact, { paused: false });
  await compact.evaluate(() => { const stop = transport.game.stations[0]; transport.inspect(stop.x, stop.y); });
  await compact.locator('#inspector').waitFor({ state: 'visible' });
  await arrive(compact, [5]);
  await waitForCard(compact, 1);
  await compact.hover('.headline-card');
  await compact.waitForTimeout(300);
  assert.ok(!overlaps(await box(compact, '.headline-card'), await box(compact, '#inspector')), 'the card leaves the inspector clear');
  await compact.screenshot({ path: `${output}/inspector-1024.png` });
  await compact.evaluate(() => document.querySelector('#inspector .tiny-button')?.click());
  await compact.locator('#objective-card').waitFor({ state: 'visible' });
  assert.equal(await compact.locator('#objective-card').evaluate(el => el.classList.contains('collapsed')), false);
  await compact.waitForTimeout(300);
  assert.ok(!overlaps(await box(compact, '.headline-card'), await box(compact, '#objective-card')), 'the card leaves the goal card clear');
  await compact.screenshot({ path: `${output}/goal-1024.png` });
  await compact.close();

  assert.deepEqual(errors, []);
  console.log(`Headlines browser check passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
