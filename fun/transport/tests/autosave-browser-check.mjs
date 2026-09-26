// Serve the repository root first; no manual save action is used in this check.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.transport?.game && localStorage.getItem('transport-save-v1'));
  const initial = await page.evaluate(() => JSON.parse(localStorage.getItem('transport-save-v1')).state);
  assert.equal(initial.width, 768);
  assert.equal(initial.height, 576);
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
  await page.waitForFunction(() => !!window.transport?.game);
  await page.locator('[data-speed="0"]').click();
  const restored = await page.evaluate(() => ({
    day: transport.game.day, seed: transport.game.seed,
    delivered: transport.game.totalDelivered, routes: transport.game.routes.map(route => route.id),
  }));
  assert.equal(restored.seed, beforeNavigation.seed);
  assert.deepEqual(restored.routes, beforeNavigation.routes);
  assert.ok(restored.day >= beforeNavigation.day && restored.day < beforeNavigation.day + 2);
  assert.ok(restored.delivered >= beforeNavigation.delivered);
  assert.deepEqual(errors, []);
  console.log('Autosave browser check passed: initial save, timed progress, leaving, and automatic restoration; no manual save used.');
} finally {
  await browser.close();
}
