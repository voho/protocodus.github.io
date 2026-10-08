// Desktop fields, native panel scrolling and the map each keep their own keys.
// Start through the real menu in isolated browser storage; serve the repo first.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, openGameMenu } from './browser-start.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-keyboard-panel-qa';
await mkdir(output, { recursive: true });
const errors = [];
const camera = page => page.evaluate(() => {
  const { x, y, zoom } = transport.renderer.getCamera();
  return { x, y, zoom };
});
const company = page => page.evaluate(() => ({
  money: transport.game.money, day: transport.game.day, revision: transport.game.revision,
  routes: transport.game.routes.length, vehicles: transport.game.vehicles.length,
}));
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/');
  await createWorldFromMenu(page, { generationVersion: 10, size: 'square512' });
  await page.evaluate(() => document.querySelector('#dismiss-objective')?.click());

  async function escapeField(selector, view) {
    const field = page.locator(selector), value = await field.inputValue(), before = await company(page);
    await field.focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'true', `${selector}: Escape closes its management panel`);
    assert.equal(await field.inputValue(), value, `${selector}: Escape preserves the field value`);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.view), view, `${selector}: focus returns to its toolbar tab`);
    assert.deepEqual(await company(page), before, `${selector}: dismissing a field does not spend money or change the world`);
  }

  // Searches retain their filters instead of swallowing Escape or clearing them.
  await page.locator('.main-nav [data-view="routes"]').click();
  await page.locator('#route-search').fill('keyboard check');
  await escapeField('#route-search', 'routes');
  await page.locator('.main-nav [data-view="routes"]').click();
  assert.equal(await page.locator('#route-search').inputValue(), 'keyboard check', 'reopening Routes keeps its search');
  await page.locator('#route-search').fill('');

  // A rename owns its first Escape; the shared panel handler must not also close.
  const rename = page.locator('[data-rename="route"]').first();
  const routeId = await rename.getAttribute('data-id');
  const routeName = await page.evaluate(id => transport.game.routes.find(route => String(route.id) === id).name, routeId);
  await rename.click();
  await page.locator('.rename-input').fill('Cancel this rename');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.rename-input').count(), 0, 'inline rename ends on Escape');
  assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'false', 'inline rename consumes Escape before the panel');
  assert.equal(await page.evaluate(id => transport.game.routes.find(route => String(route.id) === id).name, routeId), routeName, 'Escape cancels the rename');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.rename), 'route', 'rename cancellation returns focus to its pencil');

  // Mail is supplied by the starter towns and differs from their passenger route.
  // No route or vehicle needs to be purchased to exercise the draft fields.
  const stops = await page.evaluate(() => transport.game.stations.filter(stop => stop.mode === 'road').slice(0, 2).map(stop => String(stop.id)));
  assert.equal(stops.length, 2, 'the menu-created world supplies two starter road stops');
  await page.locator('#new-route-button').click();
  await page.locator('#route-form [name="from"]').selectOption(stops[0]);
  await page.locator('#route-form [name="to"]').selectOption(stops[1]);
  await page.locator('[data-cargo-choice="mail"]').click();
  await page.waitForFunction(() => !transport.renderer.getStats().gliding);
  await page.locator('#route-form [name="name"]').fill('Keyboard mail');
  await escapeField('#route-form [name="name"]', 'routes');
  await page.evaluate(() => transport.setView('routes', { routeScreen: 'new' }));
  assert.equal(await page.locator('#route-form [name="name"]').inputValue(), 'Keyboard mail', 'the route name survives closing its draft');
  await page.locator('#route-form [name="vehicleCount"]').fill('4');
  await escapeField('#route-form [name="vehicleCount"]', 'routes');
  await page.evaluate(() => transport.setView('routes', { routeScreen: 'new' }));
  assert.equal(await page.locator('#route-form [name="vehicleCount"]').inputValue(), '4', 'the vehicle quantity survives closing its draft');

  for (const [view, query] of [['towns', 'alder'], ['industry', 'mill']]) {
    await page.evaluate(view => transport.setView(view), view);
    await page.locator('#entity-search').fill(query);
    await escapeField('#entity-search', view);
    await page.evaluate(view => transport.setView(view), view);
    assert.equal(await page.locator('#entity-search').inputValue(), query, `${view} keeps its search after reopening`);
  }

  // Native select arrows retain their choice and never move the underlying map.
  await page.locator('#entity-search').fill('');
  const sort = page.locator('#entity-sort');
  await sort.selectOption('nearby');
  await sort.focus();
  const beforeSort = await camera(page);
  await page.keyboard.press('ArrowDown');
  assert.equal(await sort.inputValue(), 'attention', 'ArrowDown changes the native industry sort');
  assert.deepEqual(await camera(page), beforeSort, 'select arrow keys do not pan the map');
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'false', 'the first Escape dismisses an open native select');
  await escapeField('#entity-sort', 'industry');

  // A short laptop window makes the actual management list scrollable. Arrows
  // on its focused buttons must scroll that panel, without stealing map focus.
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.evaluate(() => transport.setView('industry'));
  await page.locator('#entity-list .entity-card').first().evaluate(button => button.focus({ preventScroll: true }));
  await page.locator('#panel-content').evaluate(panel => { panel.scrollTop = 0; });
  const beforePanelArrows = await camera(page);
  for (let count = 0; count < 8; count++) await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('#panel-content').scrollTop > 0);
  assert.deepEqual(await camera(page), beforePanelArrows, 'focused management arrows scroll the panel, keeping the map fixed');
  await page.screenshot({ path: `${output}/keyboard-panel-scroll.png` });
  await page.keyboard.press('Escape');

  // Header controls likewise keep arrows out of the map. Then the focused
  // canvas still pans, and its Enter tile cursor keeps one-tile navigation.
  await page.locator('[data-speed="0"]').focus();
  const beforeHeaderArrows = await camera(page);
  await page.keyboard.press('ArrowLeft');
  assert.deepEqual(await camera(page), beforeHeaderArrows, 'header arrows do not move the map');
  await page.locator('#world').focus();
  const beforeMapArrows = await camera(page);
  await page.keyboard.press('ArrowRight');
  assert.notDeepEqual(await camera(page), beforeMapArrows, 'arrows still pan a focused map');
  await page.keyboard.press('Enter');
  // Spoken cursor announcements intentionally debounce for 400 ms. Read its
  // immediate coordinates for exact movement, then wait for the announcement.
  const cursorTile = async () => (await page.locator('#tile-coordinates').textContent()).match(/^(\d+), (\d+)/).slice(1).map(Number);
  const tileBefore = await cursorTile();
  await page.waitForFunction(() => /^\d+, \d+/.test(document.querySelector('#map-cursor-status').textContent));
  const cursorBefore = await page.locator('#map-cursor-status').textContent();
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await cursorTile(), [tileBefore[0] + 1, tileBefore[1]], 'the keyboard tile cursor still moves exactly one tile');
  await page.waitForFunction(before => document.querySelector('#map-cursor-status').textContent !== before, cursorBefore);
  await page.keyboard.press('Escape');

  // Modal Escape remains native and closes exactly that surface.
  const gallery = await openGameMenu(page, '#game-menu [data-open-gallery]');
  await gallery.click();
  await page.locator('#gallery-search').fill('town');
  await page.keyboard.press('Escape');
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await settle(page);
  assert.deepEqual(errors, [], 'keyboard interactions raise no runtime errors');
  console.log(JSON.stringify({ escapeFields: ['route search', 'town search', 'industry search', 'route name', 'vehicle quantity', 'native select'], inlineRename: 'Escape cancels only the edit', panelArrows: 'native scrolling', mapArrows: 'pan and tile cursor', errors }));
} finally {
  await browser.close();
}
