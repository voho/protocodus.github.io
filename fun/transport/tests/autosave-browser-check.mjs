// Serve the repository root first; no manual save action is used in this check.
import assert from 'node:assert/strict';
import { createWorldFromMenu, loadAutosaveFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await createWorldFromMenu(page);
  await page.waitForFunction(() => window.transport?.game && localStorage.getItem('transport-save-v1'));
  const initial = await page.evaluate(() => JSON.parse(localStorage.getItem('transport-save-v1')).state);
  assert.equal(initial.width, 512);
  assert.equal(initial.height, 512);
  assert.equal(initial.day, 0, 'a first visit establishes the save before play begins');

  await page.locator('[data-speed="3"]').click();
  // Read storage while staying on the same page: a reload cannot accidentally satisfy this test.
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('transport-save-v1')).state.day > 15,
    undefined, { timeout: 26000, polling: 250 });
  const periodic = await page.evaluate(() => JSON.parse(localStorage.getItem('transport-save-v1')).state);
  assert.ok(periodic.totalDelivered > 0, 'periodic autosave captures actual simulation progress');
  assert.ok(periodic.totalRevenue > 0);

  await page.locator('[data-speed="0"]').click();
  const beforeNavigation = await page.evaluate(() => ({
    day: transport.game.day, money: transport.game.money, delivered: transport.game.totalDelivered,
    seed: transport.game.seed, routes: transport.game.routes.map(route => route.id),
  }));
  await page.goto(new URL('/fun/', url).href);
  const leaving = await page.evaluate(() => JSON.parse(localStorage.getItem('transport-save-v1')).state);
  assert.equal(leaving.day, beforeNavigation.day, 'leaving captures the latest day, beyond the last timed save');
  assert.equal(leaving.money, beforeNavigation.money);
  assert.equal(leaving.totalDelivered, beforeNavigation.delivered);

  await page.goto(url);
  await page.locator('#start-menu').waitFor();
  assert.equal(await page.evaluate(() => !!window.transport), false, 'reload waits for an explicit world selection');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('transport-save-v1')).state.day), leaving.day,
    'opening the menu does not advance or replace the autosave');
  await loadAutosaveFromMenu(page);
  const restored = await page.evaluate(() => ({
    day: transport.game.day, seed: transport.game.seed,
    delivered: transport.game.totalDelivered, routes: transport.game.routes.map(route => route.id),
  }));
  assert.equal(restored.seed, beforeNavigation.seed);
  assert.deepEqual(restored.routes, beforeNavigation.routes);
  // Playwright may wait through cold renderer frames before its real Pause
  // click lands. The new world clock keeps that active elapsed time exactly,
  // so compare against its fresh interval rather than a fixed day allowance.
  const restoredClock = await page.evaluate(() => transport.simulation.getStats());
  assert.ok(Math.abs(restored.day - beforeNavigation.day - restoredClock.activeMs / 1000) < 1e-6,
    'loading advances only the fresh clock\'s active speed1 interval');
  assert.ok(restored.delivered >= beforeNavigation.delivered);

  // Full or blocked storage is announced once, marked on the game menu, and cleared by the next good save.
  await page.evaluate(() => {
    window.autosaveNotices = [];
    new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node.textContent?.includes('Autosave')) window.autosaveNotices.push({ text:node.textContent, error:node.classList.contains('error') }); })
      .observe(document.querySelector('#toast-region'), { childList:true });
    const setItem = Storage.prototype.setItem;
    window.restoreStorage = () => { Storage.prototype.setItem = setItem; };
    Storage.prototype.setItem = function (key, value) { if (String(key).startsWith('transport')) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return setItem.call(this, key, value); };
  });
  await page.locator('[data-speed="8"]').click();
  await page.waitForTimeout(22000);
  const failed = await page.evaluate(() => window.autosaveNotices);
  assert.equal(failed.length, 1, 'the first failing autosave is announced');
  assert.equal(failed[0].error, true);
  assert.match(failed[0].text, /Autosave failed: browser storage is full or blocked/);
  assert.match(failed[0].text, /Delete older saves in Save \/ load \(Ctrl\+S\) to free space\./, 'a desktop notice names the keyboard shortcut');
  const menuButton = page.locator('#game-menu-button');
  assert.equal(await menuButton.getAttribute('data-alert'), '');
  assert.equal(await menuButton.getAttribute('aria-label'), 'Game menu · autosave failed');
  assert.equal(await page.locator('#save-status').textContent(), 'Save unavailable');
  assert.equal(await page.locator('#save-status').evaluate(el => el.classList.contains('save-failed')), true);
  await page.waitForTimeout(22000);
  assert.equal(await page.evaluate(() => transport.persist()), false);
  assert.equal((await page.evaluate(() => window.autosaveNotices)).length, 1, 'later failures do not repeat the notice');
  assert.equal(await page.evaluate(() => { window.restoreStorage(); return transport.persist(); }), true);
  assert.equal(await menuButton.getAttribute('data-alert'), null);
  assert.equal(await menuButton.getAttribute('aria-label'), 'Game menu');
  assert.equal(await page.locator('#save-status').evaluate(el => el.classList.contains('save-failed')), false);
  const recovered = await page.evaluate(() => window.autosaveNotices);
  assert.equal(recovered.length, 2);
  assert.equal(recovered[1].text, 'Autosave is working again.');
  assert.equal(recovered[1].error, false);

  assert.deepEqual(errors, []);
  console.log('Autosave browser check passed: initial save, timed progress, leaving, menu preservation, loading Autosave and failed-storage notices; the Save dialog is never used.');
} finally {
  await browser.close();
}
