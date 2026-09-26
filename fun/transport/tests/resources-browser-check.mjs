// Serve the repository root first. Override TRANSPORT_URL / TRANSPORT_PLAYWRIGHT if needed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-resource-qa';
await mkdir(output, { recursive: true });
const errors = [];
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
};
const fits = async (page, selector) => page.locator(selector).evaluate(el => el.scrollWidth <= el.clientWidth + 1);
const gameReady = page => page.waitForFunction(() => window.transport?.game && window.transport?.renderer);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  watch(page);
  await page.goto(url);
  await gameReady(page);
  await page.locator('[data-speed="0"]').click();
  const cargo = await page.evaluate(async () => (await import('./data.js')).CARGO);

  // Check complete resource identification in the field guide, including cargos from other biomes.
  await page.locator('#help-button').click();
  await page.locator('[data-help-tab="resources"]').click();
  assert.equal(await page.locator('.resource-legend .resource-entry').count(), Object.keys(cargo).length, 'every cargo has an illustrated key');
  for (const [key, definition] of Object.entries(cargo)) {
    const entry = page.locator('.resource-legend .resource-entry').filter({ has: page.locator(`[data-cargo-icon="${key}"]`) });
    assert.equal(await entry.count(), 1, `${definition.name} has one legend entry`);
    assert.match(await entry.innerText(), new RegExp(definition.name), `${definition.name} is visible beside its symbol`);
    assert.equal(await entry.locator('svg').getAttribute('aria-hidden'), 'true', `${definition.name} avoids repeating the adjacent accessible text`);
  }
  await page.locator('.resource-legend').screenshot({ path: `${output}/resource-contact-sheet.png` });
  await page.locator('[data-help-tab="chains"]').click();
  await page.locator('.modal-heading').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/desktop-production-guide.png` });
  await page.keyboard.press('Escape');

  await page.locator('.main-nav [data-view="industry"]').click();
  const steel = await page.evaluate(() => transport.game.industries.find(industry => industry.kind === 'steel-mill'));
  const steelCard = page.locator(`[data-industry="${steel.id}"]`);
  assert.match(await steelCard.locator('.cargo-recipe').getAttribute('aria-label'), /Consumes 3 Iron ore, 2 Coal; produces 3 Steel/i, 'multi-input production stays explicit for screen readers');
  assert.equal(await steelCard.locator('.cargo-inputs [data-cargo="iron"] .cargo-count').textContent(), '3');
  assert.equal(await steelCard.locator('.cargo-inputs [data-cargo="coal"] .cargo-count').textContent(), '2');
  assert.equal(await steelCard.locator('.cargo-outputs [data-cargo="steel"] .cargo-count').textContent(), '3');
  await steelCard.click();
  for (const key of ['iron', 'coal', 'steel']) assert.ok(await page.locator(`#inspector .ledger [data-cargo-icon="${key}"]`).count() > 0, `${key} inventory has a recognizable symbol`);
  await page.screenshot({ path: `${output}/desktop-industry-inspector.png` });
  await page.locator('#inspector .tiny-button').click();

  // Markers extend below their map tile. They inspect the industry at every zoom,
  // while a construction click at that same screen position still targets the land.
  for (const zoom of [.5, 1, 2]) {
    const marker = await page.evaluate(({ steel, zoom }) => {
      transport.setTool('inspect');
      transport.renderer.setZoom(zoom);
      transport.renderer.focus(steel.x, steel.y);
      const rect = document.querySelector('#world').getBoundingClientRect();
      const size = zoom === 2 ? 28 : 24;
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2 + 16 * zoom + 5 + (size + 6) / 2;
      return { x, y, ground: transport.renderer.screenToTile(x, y), industry: transport.renderer.screenToInspectTile(x, y) };
    }, { steel, zoom });
    assert.deepEqual(marker.industry, { x: steel.x, y: steel.y }, `${zoom}x marker resolves to its industry`);
    assert.notDeepEqual(marker.ground, marker.industry, `${zoom}x ordinary picking still resolves to the underlying ground`);
    await page.mouse.click(marker.x, marker.y);
    assert.equal(await page.locator('#inspector h3').textContent(), steel.name, `${zoom}x resource marker opens the industry inspector`);
    await page.locator('#inspector .tiny-button').click();

    const originalTile = await page.evaluate(({ ground }) => {
      const tile = transport.game.tiles[ground.y * transport.game.width + ground.x], original = structuredClone(tile);
      Object.assign(tile, { terrain: 'grass', detail: '', publicRoad: false, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null });
      transport.game.revision++;
      transport.setTool('road');
      return original;
    }, marker);
    await page.mouse.move(marker.x + 1, marker.y);
    await page.mouse.move(marker.x, marker.y);
    assert.match(await page.locator('#tile-coordinates').textContent(), new RegExp(`^${marker.ground.x}, ${marker.ground.y} ·`), `${zoom}x build hover uses the actual tile`);
    await page.mouse.click(marker.x, marker.y);
    assert.equal(await page.evaluate(({ ground }) => transport.game.tiles[ground.y * transport.game.width + ground.x].road, marker), true, `${zoom}x construction is not redirected to the industry`);
    assert.equal(await page.locator('#inspector').isVisible(), false, 'building on a marker does not open an inspector');
    await page.evaluate(({ ground, originalTile }) => {
      Object.assign(transport.game.tiles[ground.y * transport.game.width + ground.x], originalTile);
      transport.game.revision++;
      transport.setTool('inspect');
    }, { ground: marker.ground, originalTile });
  }
  await page.evaluate(() => transport.renderer.setZoom(1));

  // A deterministic producer beside the existing road makes this a real freight-form test.
  // The route must load and deliver the selected cargo, rather than silently retaining Passengers.
  await page.evaluate(() => {
    const source = transport.game.industries.find(industry => industry.kind === 'food-plant');
    const station = transport.game.stations[0];
    source.x = station.x + 1;
    source.y = station.y + 1;
    source.inventory.food = 120;
    transport.game.revision++;
  });
  await page.locator('.main-nav [data-view="routes"]').click();
  await page.locator('#route-form [name="name"]').fill('Icon-selected freight');
  await page.locator('#route-form [name="from"]').selectOption('station-1');
  assert.ok(await page.locator('.coverage-note [data-cargo-icon="food"]').count() > 0, 'departure coverage shows available resources');
  await page.locator('[data-cargo-choice="food"]').click();
  await page.locator('#route-form [name="to"]').selectOption('station-2');
  assert.equal(await page.locator('#route-form [name="cargo"]').inputValue(), 'food');
  assert.equal(await page.locator('[data-cargo-choice="food"]').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: `${output}/desktop-route-cargo.png` });
  const moneyBefore = await page.evaluate(() => transport.game.money);
  await page.locator('#route-form button[type="submit"]').click();
  const launched = await page.evaluate(() => {
    const route = transport.game.routes.find(route => route.name === 'Icon-selected freight');
    return { cargo: route?.cargo, load: transport.game.vehicles.find(vehicle => vehicle.routeId === route?.id)?.load, money: transport.game.money };
  });
  assert.equal(launched.cargo, 'food', 'the visible cargo choice is submitted to the simulation');
  assert.equal(launched.load, 24, 'the freight truck loads the selected resource');
  assert.equal(launched.money, moneyBefore - 18000);
  const routeCard = page.locator('.route-card').filter({ hasText: 'Icon-selected freight' });
  assert.equal(await routeCard.locator('[data-cargo-icon="food"]').count(), 1, 'launched service displays its cargo symbol');
  await page.evaluate(async () => { const { tick } = await import('./model.js'); tick(transport.game, 14); });
  assert.ok(await page.evaluate(() => transport.game.routes.find(route => route.name === 'Icon-selected freight').delivered) > 0, 'the new freight service delivers the selected resource');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px page has no horizontal overflow`);
    await page.locator('.mobile-panel-toggle').click();
    await page.waitForTimeout(300);
    await page.locator('[data-mobile-view="routes"]').click();
    assert.equal(await fits(page, '#panel-content'), true, `${width}px route panel fits`);
    assert.equal(await page.locator('.cargo-choice').evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth + 1)), true, `${width}px cargo names fit their buttons`);
    await page.locator('.cargo-field').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `${output}/mobile-${width}-cargo.png` });
    await page.locator('[data-mobile-view="industry"]').click();
    assert.equal(await fits(page, '#panel-content'), true, `${width}px industry panel fits`);
    const typeSize = await page.locator('.entity-card h3').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(typeSize >= 13, `${width}px industry names remain large enough to read (${typeSize}px)`);
    await page.screenshot({ path: `${output}/mobile-${width}-industry.png` });
    await page.locator('#panel-help').click();
    await page.locator('[data-help-tab="chains"]').click();
    assert.equal(await fits(page, '#modal'), true, `${width}px production guide fits`);
    await page.screenshot({ path: `${output}/mobile-${width}-guide.png` });
    await page.keyboard.press('Escape');
    await page.locator('.mobile-panel-toggle').click();
    await page.locator('#panel-help').click();
    await page.locator('[data-help-tab="resources"]').click();
    assert.equal(await fits(page, '#modal'), true, `${width}px resource key fits`);
    assert.equal(await page.locator('.resource-entry').evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth + 1)), true, `${width}px resource names fit their cards`);
    await page.screenshot({ path: `${output}/mobile-${width}-resource-key.png` });
    await page.keyboard.press('Escape');
    await page.locator('.mobile-panel-toggle').click();
  }
  assert.equal(Object.keys(cargo).length, 20);
  assert.deepEqual(errors, [], 'no browser console or runtime errors');
  console.log(`Transport resource UI checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
