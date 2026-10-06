// Actionable notices remain usable while hovered or focused, and close one
// layer at a time. Use real menus and construction in isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-notice-actions-qa';
await mkdir(output, { recursive: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/');
  await createWorldFromMenu(page, { generationVersion: 10, size: 'square512' });
  await page.evaluate(() => document.querySelector('#dismiss-objective')?.click());
  const clearToasts = () => page.evaluate(() => {
    for (const toast of [...document.querySelector('#toast-region').children]) {
      if (toast.dismissToast) toast.dismissToast(); else { clearTimeout(toast.toastTimer); toast.remove(); }
    }
  });
  await clearToasts();
  const point = await page.evaluate(async () => {
    const game = transport.game, { quoteBuildPlan } = await import('./construction-plan.js');
    for (const route of game.routes) for (const raw of route.path) {
      const point = Array.isArray(raw) ? { x: raw[0], y: raw[1] } : raw;
      const tile = game.tiles[point.y * game.width + point.x];
      if (tile?.road && !tile.building && !game.stations.some(stop => stop.x === point.x && stop.y === point.y)
        && quoteBuildPlan(game, 'bus-stop', [point]).ok) return { x: point.x, y: point.y };
    }
    throw Error('No clear starter-road tile for the notice-action check');
  });
  const away = () => page.mouse.move(1240, 700);
  const undoAction = () => page.locator('#toast-region .toast-action', { hasText: /^Undo$/ });
  async function buildStop() {
    await clearToasts();
    const money = await page.evaluate(() => transport.game.money);
    await page.evaluate(point => transport.inspect(point.x, point.y), point);
    await page.locator('[data-build-selected-stop="road"]').click();
    await undoAction().waitFor({ state: 'visible' });
    assert.ok(await page.evaluate(money => transport.game.money < money, money), 'the real stop build spends its quoted amount');
    return money;
  }

  const money = await buildStop();
  await page.locator('#toast-region .toast').filter({ has: page.locator('.toast-action', { hasText: /^Undo$/ }) }).locator(':scope > span').hover();
  await page.waitForTimeout(5200);
  assert.equal(await undoAction().isVisible(), true, 'Undo survives its five-second lifetime while hovered');
  await page.locator('#world').focus();
  await undoAction().focus();
  await away();
  await page.waitForTimeout(5200);
  assert.equal(await undoAction().isVisible(), true, 'leaving the pointer keeps Undo paused while keyboard focus remains');
  await page.screenshot({ path: `${output}/focused-undo.png` });
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => transport.game.money), money, 'keyboard activation still undoes the real build after a long pause');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'world', 'removing the focused action restores map focus');
  assert.equal(await undoAction().count(), 0, 'the used action disappears once');

  const keyboardMoney = await buildStop();
  await page.locator('#world').focus();
  await undoAction().focus();
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => transport.game.money), keyboardMoney, 'the Undo shortcut refunds the build while its notice action has focus');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'world', 'shortcut removal of the focused Undo notice restores map focus');
  assert.equal(await undoAction().count(), 0, 'the shortcut also removes the used action');

  // Focus alone pauses; moving focus out while the pointer stays still pauses.
  // Only after both interactions end may the remaining reading time expire.
  await buildStop();
  await away();
  await page.locator('#world').focus();
  await undoAction().focus();
  await page.waitForTimeout(5200);
  assert.equal(await undoAction().isVisible(), true, 'an action stays available with only keyboard focus');
  await undoAction().hover();
  await page.locator('#world').focus();
  await page.waitForTimeout(700);
  assert.equal(await undoAction().isVisible(), true, 'pointer hover remains a separate pause after focus leaves');
  await away();
  await undoAction().waitFor({ state: 'hidden', timeout: 6500 });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'world', 'eventual expiry keeps the player at their current map focus');
  assert.ok(await page.evaluate(point => transport.game.stations.some(stop => stop.x === point.x && stop.y === point.y), point), 'toast expiry leaves the completed stop in place');

  // A production-opening notice exercises the other common contextual action.
  await clearToasts();
  const site = await page.evaluate(async () => {
    const { openIndustry } = await import('./model.js');
    for (let month = 24; month <= 120; month++) {
      const site = openIndustry(transport.game, month, { force: true });
      if (site) { transport.game.money += 1; return { id: site.id, name: site.name }; }
    }
    throw Error('No plot for an actionable industry-opening notice');
  });
  const show = page.locator('#toast-region .toast-action', { hasText: /^Show$/ });
  await show.waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#world').focus();
  await show.focus();
  await page.keyboard.press('Enter');
  await page.locator('#inspector').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#inspector-title').textContent(), site.name, 'the focused Show action opens the correct production site');

  // Finance is a popover above the inspector or tool, so the first Escape must
  // dismiss finance only. The second Escape can then return from that context.
  await away();
  await page.locator('#company-stats').click();
  await away();
  assert.equal(await page.locator('#company-stats').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#company-stats').getAttribute('aria-expanded'), 'false', 'Escape closes finance');
  assert.equal(await page.locator('#inspector').isVisible(), true, 'the same Escape does not also close the inspector');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'world', 'finance dismissal keeps keyboard focus visible on the map');
  await page.locator('#company-stats').click();
  await away();
  await page.locator('#open-report').focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#company-stats').getAttribute('aria-expanded'), 'false', 'Escape from the focused report action also closes finance');
  assert.equal(await page.locator('#inspector').isVisible(), true, 'report-action Escape preserves the inspector underneath');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#inspector').isHidden(), true, 'the next Escape closes the inspector');

  await page.locator('[data-toolbar-tool="road"]').click();
  await page.locator('#company-stats').click();
  await away();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#active-tool-name').textContent(), 'Road', 'finance Escape keeps the active construction tool');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#active-tool-bar').isHidden(), true, 'the next Escape finishes the tool');
  assert.deepEqual(errors, [], 'actionable notices and finance dismissal raise no runtime errors');
  console.log(JSON.stringify({ toastTiming: 'hover and focus pause independently; expiry resumes after both leave', actions: ['Undo', 'Show'], undoShortcut: 'refund and focus return', focusReturn: 'map', financeEscape: 'one layer', errors }));
} finally {
  await browser.close();
}
