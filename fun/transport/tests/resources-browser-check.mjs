// Serve the repository root first. Override TRANSPORT_URL / TRANSPORT_PLAYWRIGHT if needed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, openGameAction } from './browser-start.mjs';
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
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  watch(page);
  await page.goto(url);
  await createWorldFromMenu(page);
  const cargo = await page.evaluate(async () => (await import('./data.js')).CARGO);

  // Check complete resource identification in the field guide, including cargos from other biomes.
  await openGameAction(page, 'help-button');
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
      const p=transport.renderer.industryMarker(steel),x=rect.left+p.x,y=rect.top+p.y;
      return { x, y, ground: transport.renderer.screenToTile(x, y), industry: transport.renderer.screenToInspectTile(x, y) };
    }, { steel, zoom });
    assert.deepEqual(marker.industry, { x: steel.x, y: steel.y }, `${zoom}x marker resolves to its industry`);
    assert.notDeepEqual(marker.ground, marker.industry, `${zoom}x ordinary picking still resolves to the underlying ground`);
    await page.mouse.click(marker.x, marker.y);
    assert.equal(await page.locator('#inspector h3').textContent(), steel.name, `${zoom}x resource marker opens the industry inspector`);
    await page.locator('#inspector .tiny-button').click();

    const originalTile = await page.evaluate(async ({ ground }) => {
      const tile = transport.game.tiles[ground.y * transport.game.width + ground.x], original = structuredClone(tile);
      delete original.terrainObject;
      const { releaseTerrainObjects } = await import('./terrain-objects.js');
      releaseTerrainObjects(transport.game, Array.from({ length: 9 }, (_, n) => ({ x: ground.x + n % 3 - 1, y: ground.y + Math.floor(n / 3) - 1 })));
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
  // No marker stands on another site. One whose front is taken sits on its own building, or beside the front on a stem,
  // and still opens its own industry.
  for (const zoom of [.5, 1, 2]) {
    const placed = await page.evaluate(zoom => {
      const g = transport.game, r = transport.renderer, rect = document.querySelector('#world').getBoundingClientRect(), wrong = [];let moved = null;
      const inside = (site, p) => p.x >= site.x && p.y >= site.y && p.x < site.x + (site.footprint || 1) && p.y < site.y + (site.footprint || 1);
      r.setZoom(zoom);
      for (const site of g.industries) {
        r.focus(site.x, site.y);
        const m = r.industryMarker(site), ground = r.screenToTile(rect.left + m.x, rect.top + m.y), other = g.industries.find(o => o !== site && inside(o, ground));
        if (other) wrong.push(`${site.name} ${site.x},${site.y} on ${other.name}`);
        if (!moved && inside(site, ground)) moved = site;
      }
      if (!moved) return { wrong, moved };
      r.focus(moved.x, moved.y); r.render(performance.now(), {});
      const m = r.industryMarker(moved);
      return { wrong, moved: { name: moved.name, x: rect.left + m.x, y: rect.top + m.y }, stats: r.getStats().overlays };
    }, zoom);
    assert.deepEqual(placed.wrong, [], `${zoom}x no marker stands on another site`);
    assert.ok(placed.moved && placed.stats.own > 0, `${zoom}x some markers sit on their own building: ${JSON.stringify(placed.stats)}`);
    await page.waitForFunction(({ x, y }) => document.elementFromPoint(x, y)?.id === 'world', placed.moved);
    await page.mouse.click(placed.moved.x, placed.moved.y);
    assert.equal(await page.locator('#inspector h3').textContent(), placed.moved.name, `${zoom}x a marker on its own building opens its industry`);
    await page.locator('#inspector .tiny-button').click();
  }
  // Placement is kept per half-view cell of the camera; a long pan across cells leaves every marker in view where it was beside its site.
  const drift = await page.evaluate(() => {
    const g = transport.game, r = transport.renderer, rect = document.querySelector('#world').getBoundingClientRect(), offsets = new Map(), moved = [], builds = r.getStats().overlays.builds;
    r.setZoom(.5); r.focus(40, 299);
    for (let step = 0; step < 14; step++) {
      for (const site of g.industries) {
        const m = r.industryMarker(site), p = r.worldToScreen(site.x, site.y);if (m.x < 0 || m.y < 0 || m.x > rect.width || m.y > rect.height) continue;
        const offset = `${Math.round((m.x - p.x) * 4)},${Math.round((m.y - p.y) * 4)}`;if (offsets.has(site.id) && offsets.get(site.id) !== offset) moved.push(`${site.name} ${offsets.get(site.id)} → ${offset}`);offsets.set(site.id, offset);
      }
      r.pan(-150, -60);
    }
    return { moved, seen: offsets.size, builds: r.getStats().overlays.builds - builds };
  });
  assert.deepEqual(drift.moved, [], 'markers keep their places while the map pans');
  assert.ok(drift.seen >= 10 && drift.builds >= 3, `the pan passes ${drift.seen} markers across ${drift.builds} placements`);
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

  // Inspectors link places to their services: a quarry plans its stone route, then the stop, the road and the bulldozer name it.
  // The open drawer covers the inspector, so each inspection closes it first.
  const closeDrawer = async () => { if (await page.locator('.sidebar').evaluate(el => el.classList.contains('mobile-open'))) await page.locator('#close-management').click(); };
  const inspectAt = async (point, kind = '') => { await closeDrawer(); await page.evaluate(({ point, kind }) => transport.inspect(point.x, point.y, kind), { point, kind }); };
  await closeDrawer();
  const quarry = await page.evaluate(async () => {
    const { build } = await import('./model.js'), { buildPlan } = await import('./construction-plan.js');
    const game = transport.game, road = buildPlan(game, 'road', [251, 250, 249, 248, 247, 246, 245].map(y => ({ x: 219, y })), { preferredMode: 'road' }), stop = build(game, 'bus-stop', 219, 251);
    if (!road.ok || !stop.ok) throw new Error(`Could not prepare the quarry fixture: ${road.message}; ${stop.message}`);
    const site = game.industries.find(industry => industry.kind === 'quarry' && Math.hypot(industry.x - 219, industry.y - 253) < 5);
    transport.renderer.focus(site.x, site.y); transport.inspect(site.x, site.y, 'industry');
    return { site: { x: site.x, y: site.y }, stop: stop.station, alder: game.stations.find(station => station.name === 'Alderbrook Central') };
  });
  const clickStop = async station => {
    const point = await page.evaluate(station => {
      transport.renderer.focus(station.x, station.y); transport.renderer.render(performance.now(), {});
      const rect = document.querySelector('#world').getBoundingClientRect(), marker = transport.renderer.stationMarker(station);
      return { x: rect.left + marker.x + marker.size / 2, y: rect.top + marker.y + marker.size / 2 };
    }, station);
    await page.waitForFunction(({ x, y }) => document.elementFromPoint(x, y)?.id === 'world', point);
    await page.mouse.click(point.x, point.y);
  };
  const planned = async () => page.evaluate(() => ({ from: document.querySelector('#route-form [name="from"]').value, to: document.querySelector('#route-form [name="to"]').value, cargo: document.querySelector('#route-form [name="cargo"]').value, valid: document.querySelector('#route-connection').dataset.valid, banner: document.querySelector('#route-pick-banner')?.innerText || '' }));
  assert.equal(await page.locator('#inspector .service-summary').textContent(), `Served by ${quarry.stop.name} · no route yet`, 'the quarry names the stop in reach');
  await page.locator('#inspector').screenshot({ path: `${output}/desktop-quarry-service.png` });
  await page.locator('#inspector .industry-target-row').filter({ hasText: 'Alderbrook' }).locator('.target-plan').click();
  await page.waitForFunction(() => document.querySelector('#route-connection')?.dataset.valid === 'true');
  assert.deepEqual(await planned(), { from: quarry.stop.id, to: quarry.alder.id, cargo: 'stone', valid: 'true', banner: '' }, 'Plan on a covered target fills both stops and the cargo');
  await inspectAt(quarry.site, 'industry');
  await page.locator('#inspector button', { hasText: 'Plan route from here' }).click();
  await page.locator('#route-pick-banner').waitFor({ state: 'visible' });
  const picking = await planned();
  assert.equal(picking.from, quarry.stop.id); assert.equal(picking.to, ''); assert.equal(picking.cargo, 'stone');
  assert.match(picking.banner, /^Click the end road stop/, 'Plan route from here picks the end on the map');
  await clickStop(quarry.alder);
  await page.locator('#route-pick-banner').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('#route-connection')?.dataset.valid === 'true');
  assert.deepEqual(await planned(), { from: quarry.stop.id, to: quarry.alder.id, cargo: 'stone', valid: 'true', banner: '' }, 'Alderbrook Central completes a valid stone route');
  await page.locator('#route-form button[type="submit"]').click();
  const stone = await page.evaluate(stop => transport.game.routes.find(route => route.stops[0] === stop && route.cargo === 'stone'), quarry.stop.id);
  assert.ok(stone, 'the planned stone route launches');
  // The served quarry wears the stone route's ring at every zoom, storage bars appear from Town view in, and a served marker still inspects its site.
  for (const zoom of [.5, 1, 2]) {
    const seen = await page.evaluate(({ at, zoom }) => {
      const site = transport.game.industries.find(industry => industry.x === at.x && industry.y === at.y), rect = document.querySelector('#world').getBoundingClientRect();
      transport.renderer.setZoom(zoom); transport.renderer.focus(site.x, site.y); transport.renderer.render(performance.now(), {});
      const p = transport.renderer.industryMarker(site);
      return { name: site.name, stats: transport.renderer.getStats().industryMarkers, x: rect.left + p.x, y: rect.top + p.y };
    }, { at: quarry.site, zoom });
    assert.ok(seen.stats.served >= 1 && seen.stats.served <= seen.stats.drawn, `${zoom}x counts the served quarry: ${JSON.stringify(seen.stats)}`);
    assert.equal(seen.stats.meters > 0, zoom > .5, `${zoom}x storage bars show only from Town view in: ${JSON.stringify(seen.stats)}`);
    await closeDrawer();
    await page.waitForFunction(({ x, y }) => document.elementFromPoint(x, y)?.id === 'world', seen);
    await page.mouse.click(seen.x, seen.y);
    assert.equal(await page.locator('#inspector h3').textContent(), seen.name, `${zoom}x a served marker still opens its industry`);
  }
  await page.evaluate(() => transport.renderer.setZoom(1));
  await inspectAt(quarry.stop);
  assert.equal(await page.locator('#inspector [data-service-route]').count(), 1, 'the stop inspector lists its service');
  const service = await page.locator('#inspector [data-service-route]').innerText();
  assert.ok(service.startsWith(stone.name) && service.includes('1 truck · '), service);
  assert.match(await page.locator('#inspector .coverage-names').textContent(), /^Covers .*Stone quarry/);
  await page.locator('#inspector').screenshot({ path: `${output}/desktop-stop-services.png` });
  await page.locator('#inspector [data-service-route]').click();
  await page.waitForFunction(id => transport.renderer.getStats().highlightRoute === id, stone.id);
  await inspectAt(quarry.site, 'industry');
  assert.equal(await page.locator('#inspector .service-summary').textContent(), `Served by ${quarry.stop.name} · 1 route`);
  await inspectAt(quarry.alder);
  await page.locator('#inspector [aria-label="Deliver stone here"]').click();
  await page.locator('#route-pick-banner').filter({ hasText: 'Click the start road stop' }).waitFor();
  await clickStop(quarry.stop);
  await page.locator('#route-pick-banner').waitFor({ state: 'detached' });
  assert.deepEqual(await planned(), { from: quarry.stop.id, to: quarry.alder.id, cargo: 'stone', valid: 'true', banner: '' }, 'Deliver here keeps the end and picks only the start');
  const refusal = await page.evaluate(async stop => (await import('./model.js')).build(transport.game, 'bulldoze', stop.x, stop.y), quarry.stop);
  assert.equal(refusal.ok, false); assert.equal(refusal.message, `${stone.name} uses this stop. Retire the route first, then remove the stop.`, 'bulldozing a served stop names its route');
  const middle = stone.path[Math.floor(stone.path.length / 2)];
  await inspectAt(middle);
  const use = await page.locator('#inspector .network-use').textContent();
  assert.ok(use.startsWith('Used by ') && use.includes(stone.name), `the road inspector names the routes on it: ${use}`);
  await page.locator('#inspector').screenshot({ path: `${output}/desktop-road-use.png` });
  await closeDrawer();
  const far = await page.evaluate(() => { const g = transport.game, site = g.industries.find(industry => !g.stations.some(stop => Math.hypot(stop.x - industry.x, stop.y - industry.y) < 12)); transport.renderer.focus(site.x, site.y); transport.inspect(site.x, site.y, 'industry'); return site.name; });
  assert.equal(await page.locator('#inspector .service-summary').textContent(), 'No stop within 5 tiles yet.', `${far} has no stop in reach`);
  await page.locator('#inspector button', { hasText: 'Place a stop nearby' }).click();
  assert.equal(await page.locator('.tool-card[data-tool="stop"]').getAttribute('aria-pressed'), 'true', 'Place a stop nearby picks the Stop tool');
  await page.keyboard.press('Escape');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px page has no horizontal overflow`);
    if (!(await page.locator('.sidebar').evaluate(el => el.classList.contains('mobile-open')))) await page.locator('.mobile-panel-toggle').click();
    await page.waitForTimeout(300);
    await page.locator('[data-mobile-view="routes"]').click();
    await page.locator('#new-route-button').click();
    assert.equal(await fits(page, '#panel-content'), true, `${width}px route panel fits`);
    assert.equal(await page.locator('.cargo-choice').evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth + 1)), true, `${width}px cargo names fit their buttons`);
    await page.locator('.cargo-field').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `${output}/mobile-${width}-cargo.png` });
    await page.locator('[data-mobile-view="industry"]').click();
    assert.equal(await fits(page, '#panel-content'), true, `${width}px industry panel fits`);
    const typeSize = await page.locator('.entity-card h3').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(typeSize >= 13, `${width}px industry names remain large enough to read (${typeSize}px)`);
    await page.screenshot({ path: `${output}/mobile-${width}-industry.png` });
    await openGameAction(page, 'help-button');
    await page.locator('[data-help-tab="chains"]').click();
    assert.equal(await fits(page, '#modal'), true, `${width}px production guide fits`);
    await page.screenshot({ path: `${output}/mobile-${width}-guide.png` });
    await page.keyboard.press('Escape');
    await openGameAction(page, 'help-button');
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
