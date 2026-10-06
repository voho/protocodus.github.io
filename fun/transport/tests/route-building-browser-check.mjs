// Staged route building through the actual desktop UI. Each browser context has
// fresh storage; deterministic stops are built only after the menu starts a game.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-route-building-qa';
await mkdir(output, { recursive: true });
const errors = [], results = [];
const checkpoint = (stage, details = {}) => { const entry = { stage, ...details }; results.push(entry); console.log(JSON.stringify(entry)); };
const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const field = (page, name) => page.locator(`#route-form [name="${name}"]`);
const cargo = page => page.locator('[data-cargo-choice]');
const launch = page => page.locator('#route-form button[type="submit"]');
const snapshot = page => page.evaluate(() => {
  const g = transport.game;
  return JSON.stringify({ money: g.money, day: g.day, revision: g.revision, nextId: g.nextId, routes: g.routes, vehicles: g.vehicles });
});

async function start({ width = 1440, height = 1000, density = 1, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: density, reducedMotion });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await createWorldFromMenu(page, { generationVersion: 10 });
  await page.evaluate(() => document.querySelector('#dismiss-objective')?.click());
  const fixture = await page.evaluate(async () => {
    const { build, buildPath, getVehiclePurchase, stationCoverage, validateGame } = await import('./model.js');
    const { releaseTerrainObjects } = await import('./terrain-objects.js');
    const g = transport.game, cleared = [];
    for (let y = 90; y <= 130; y++) for (let x = 55; x <= 170; x++) cleared.push({ x, y });
    // A large terrain object's validity includes a one-tile elevation collar.
    // Release sites beside the flattened rectangle as well as sites inside it.
    const released = [];
    for (let y = 89; y <= 131; y++) for (let x = 54; x <= 171; x++) released.push({ x, y });
    releaseTerrainObjects(g, released);
    for (const { x, y } of cleared) {
      Object.assign(g.tiles[y * g.width + x], { terrain: 'grass', detail: '', elevation: .25, variant: 0, publicRoad: false, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null });
    }
    for (const key of ['cities', 'industries', 'stations', 'routes', 'vehicles', 'zones']) g[key] = [];
    const town = (id, name, x) => ({ id, name, x, y: 111, population: 600, passengers: 100, mail: 50, activity: 0, growth: 0, delivered: 0, supplies: 0, lastServiceDay: null });
    g.cities = [town('qa-alpha', 'Alpha', 68), town('qa-beta', 'Beta', 102), town('qa-gamma', 'Gamma', 142), town('qa-delta', 'Delta', 160)];
    g.money = 1_000_000; g.revision++; g.networkRevision++;
    const checked = result => { if (!result.ok) throw new Error(`Route fixture: ${result.message}`); return result; };
    checked(build(g, 'quarry', 64, 102));
    checked(buildPath(g, 'road', Array.from({ length: 75 }, (_, i) => ({ x: 68 + i, y: 108 }))));
    checked(buildPath(g, 'road', Array.from({ length: 3 }, (_, i) => ({ x: 160 + i, y: 108 }))));
    checked(buildPath(g, 'rail', Array.from({ length: 35 }, (_, i) => ({ x: 68 + i, y: 114 }))));
    const stops = {};
    for (const [key, tool, x, y] of [['alpha', 'bus-stop', 68, 108], ['beta', 'bus-stop', 102, 108], ['gamma', 'bus-stop', 142, 108], ['delta', 'bus-stop', 160, 108], ['railAlpha', 'train-stop', 68, 114], ['railBeta', 'train-stop', 102, 114]]) {
      stops[key] = checked(build(g, tool, x, y)).station;
    }
    g.industries[0].inventory.stone = 2000;
    // All following purchases start from a known balance, after fixture costs.
    g.money = 1_000_000; g.revision++;
    if (!validateGame(g)) throw new Error('The route-building fixture must be save-valid.');
    transport.renderer.setGame(g); transport.renderer.setZoom(.75);
    const original = transport.renderer.render;
    window.routeBuildingQA = { lastView: null };
    transport.renderer.render = function (now, view = {}) { routeBuildingQA.lastView = view; return original.call(this, now, view); };
    return { stops, purchase: getVehiclePurchase(g, 'road').cost, coverage: Object.fromEntries(Object.entries(stops).map(([key, stop]) => [key, stationCoverage(g, stop).produces])) };
  });
  await newRoute(page);
  return { page, context, ...fixture };
}

async function newRoute(page) {
  await page.evaluate(() => transport.setView('routes'));
  await page.locator('#new-route-button').click();
  await field(page, 'from').waitFor({ state: 'visible' });
}

async function expandStops(page) {
  const change = page.locator('#change-route-stops');
  if (await change.isVisible()) await change.click();
}

async function chooseStops(page, from, to) {
  await expandStops(page);
  await field(page, 'from').selectOption(from.id);
  await field(page, 'to').selectOption(to.id);
  await page.locator('#route-cargo-step').waitFor({ state: 'visible' });
}

async function clickStop(page, station) {
  await page.evaluate(station => transport.renderer.focus(station.x, station.y), station);
  await settle(page);
  const point = await page.evaluate(station => {
    const rect = document.querySelector('#world').getBoundingClientRect(), marker = transport.renderer.stationMarker(station);
    return { x: rect.left + marker.x + marker.size / 2, y: rect.top + marker.y + marker.size / 2 };
  }, station);
  await page.waitForFunction(({ x, y }) => document.elementFromPoint(x, y)?.id === 'world', point);
  await page.mouse.click(point.x, point.y);
}

async function assertAvailableCargo(page, coverage, keys) {
  const expected = [...new Set(keys.flatMap(key => coverage[key]))].sort();
  const shown = await cargo(page).evaluateAll(buttons => buttons.map(button => button.dataset.cargoChoice).sort());
  assert.deepEqual(shown, expected, 'cargo choices contain exactly the kinds produced at either chosen stop');
  assert.equal(await cargo(page).filter({ hasText: /./ }).count(), shown.length, 'each cargo choice has a visible readable label');
}

async function assertPreview(page, { animated = true, mode = 'road', pixels = '' } = {}) {
  await page.waitForFunction(() => { const stats = transport.renderer.getStats(); return stats.routePreview?.active && !stats.gliding; });
  const before = await page.evaluate(() => ({ preview: transport.renderer.getStats().routePreview, day: transport.game.day }));
  assert.equal(before.preview.mode, mode); assert.equal(before.preview.animated, animated);
  assert.ok(before.preview.segments > 0, 'the route path is visible');
  assert.equal(before.preview.endpoints, 2, 'both route endpoints are marked');
  if (animated) {
    await page.evaluate(() => routeBuildingQA.savedDraft = routeBuildingQA.lastView.draftRoutePreview);
    await page.waitForFunction(alpha => Math.abs(transport.renderer.getStats().routePreview.alpha - alpha) > .025, before.preview.alpha, { timeout: 1800 });
    assert.equal(await page.evaluate(() => routeBuildingQA.savedDraft === routeBuildingQA.lastView.draftRoutePreview), true, 'display-clock frames reuse the same draft object and path');
  } else {
    await page.waitForTimeout(220);
    assert.equal(await page.evaluate(() => transport.renderer.getStats().routePreview.alpha), before.preview.alpha, 'reduced motion keeps a steady preview');
  }
  assert.equal(await page.evaluate(() => transport.game.day), before.day, 'preview animation does not advance the paused world');
  if (pixels) {
    const rendered = await page.evaluate(() => {
      const renderer = transport.renderer, view = routeBuildingQA.lastView, canvas = document.querySelector('#world'), context = canvas.getContext('2d');
      const saved = JSON.stringify({ money: transport.game.money, day: transport.game.day, revision: transport.game.revision, routes: transport.game.routes, vehicles: transport.game.vehicles });
      const builds = renderer.getStats().routePathBuilds;
      const read = () => context.getImageData(0, 0, canvas.width, canvas.height).data;
      renderer.render(0, { ...view, draftRoutePreview: null }); const baseHigh = read();
      renderer.render(0, view); const high = read(), highImage = canvas.toDataURL();
      renderer.render(900, { ...view, draftRoutePreview: null }); const baseLow = read();
      renderer.render(900, view); const low = read(), lowImage = canvas.toDataURL();
      let markedPixels = 0, changedPixels = 0, maxChange = 0;
      for (let i = 0; i < high.length; i += 4) {
        let marked = false, changed = false;
        for (let channel = 0; channel < 3; channel++) {
          const highDelta = high[i + channel] - baseHigh[i + channel], lowDelta = low[i + channel] - baseLow[i + channel];
          if (Math.abs(highDelta) > 2 || Math.abs(lowDelta) > 2) marked = true;
          const delta = Math.abs(highDelta - lowDelta); maxChange = Math.max(maxChange, delta); if (delta > 2) changed = true;
        }
        if (marked) markedPixels++; if (changed) changedPixels++;
      }
      const stablePathBuilds = renderer.getStats().routePathBuilds === builds;
      const unchanged = saved === JSON.stringify({ money: transport.game.money, day: transport.game.day, revision: transport.game.revision, routes: transport.game.routes, vehicles: transport.game.vehicles });
      renderer.render(performance.now(), view);
      return { markedPixels, changedPixels, maxChange, stablePathBuilds, unchanged, highImage, lowImage };
    });
    assert.ok(rendered.markedPixels > 100, 'the draft paints a visible route independently of the routes layer');
    assert.equal(rendered.stablePathBuilds, true, 'pulse phases reuse the cached projected route path');
    assert.equal(rendered.unchanged, true, 'rendering a draft changes no funds, routes, vehicles or simulation time');
    if (animated) assert.ok(rendered.changedPixels > 100 && rendered.maxChange > 10, 'the preview pulse changes actual map pixels');
    else assert.equal(rendered.changedPixels, 0, 'reduced motion keeps the actual preview pixels steady');
    await writeFile(`${output}/${pixels}-preview-high.png`, Buffer.from(rendered.highImage.split(',')[1], 'base64'));
    await writeFile(`${output}/${pixels}-preview-low.png`, Buffer.from(rendered.lowImage.split(',')[1], 'base64'));
    delete rendered.highImage; delete rendered.lowImage;
    before.preview.pixels = rendered;
  }
  return before.preview;
}

async function assertClearedPreview(page, message) {
  await page.waitForFunction(() => transport.renderer.getStats().routePreview?.active === false);
  assert.equal(await page.evaluate(() => transport.renderer.getStats().routePreview.active), false, message);
}

try {
  const { page, context, stops, purchase, coverage } = await start();
  assert.equal(await page.locator('#route-estimate').isVisible(), true, 'the estimate remains visible before any stop is chosen');
  assert.equal(await page.locator('[data-estimate-cost]').isVisible(), true);
  assert.equal(await page.locator('[data-estimate-revenue]').isVisible(), true);
  assert.equal(await page.locator('#route-cargo-step').isVisible(), false);
  assert.equal(await page.locator('#route-vehicles-step').isVisible(), false);
  const initialStops = await field(page, 'from').locator('option').evaluateAll(options => options.map(option => option.value));
  assert.ok(initialStops.includes(stops.railAlpha.id) && initialStops.includes(stops.alpha.id), 'the first stop can be road or rail without choosing transport');
  await field(page, 'from').selectOption(stops.railAlpha.id);
  assert.equal(await field(page, 'mode').inputValue(), 'rail', 'the start stop determines transport');
  const matching = await field(page, 'to').locator('option').evaluateAll(options => options.map(option => option.value));
  assert.ok(matching.includes(stops.railBeta.id));
  assert.ok(!matching.includes(stops.railAlpha.id) && !matching.includes(stops.beta.id), 'end choices exclude the start and other transport types');
  await field(page, 'from').selectOption('');
  const cancelled = await snapshot(page);
  await page.locator('[data-pick-route="from"]').click();
  await page.keyboard.press('Escape');
  await page.locator('#route-pick-banner').waitFor({ state: 'detached' });
  assert.equal(await snapshot(page), cancelled, 'cancelling map picking changes no game state');
  assert.equal(await field(page, 'from').inputValue(), '');
  checkpoint('initial-stops-and-pick-cancellation');

  // Mouse map picking walks through start and end and rejects the same stop.
  await page.locator('[data-pick-route="from"]').click();
  await clickStop(page, stops.alpha);
  assert.equal(await field(page, 'from').inputValue(), stops.alpha.id);
  await clickStop(page, stops.alpha);
  assert.equal(await field(page, 'to').inputValue(), '', 'the same map stop cannot be both ends');
  assert.equal(await page.locator('#route-pick-banner').isVisible(), true);
  await clickStop(page, stops.beta);
  await page.locator('#route-pick-banner').waitFor({ state: 'detached' });
  assert.equal(await field(page, 'to').inputValue(), stops.beta.id);
  await assertAvailableCargo(page, coverage, ['alpha', 'beta']);
  assert.equal(await cargo(page).evaluateAll(buttons => buttons.filter(button => button.getAttribute('aria-pressed') === 'true').length), 0, 'selecting stops does not silently confirm cargo');
  assert.equal(await page.locator('#route-vehicles-step').isVisible(), false);
  await page.screenshot({ path: `${output}/desktop-cargo-step.png` });
  checkpoint('map-picks-and-produced-only-cargo');
  await page.locator('[data-cargo-choice="stone"]').click();
  await page.locator('#route-vehicles-step').waitFor({ state: 'visible' });
  const automatic = await field(page, 'name').inputValue();
  for (const text of ['Alpha', 'Beta', 'Stone']) assert.ok(automatic.toLowerCase().includes(text.toLowerCase()), `automatic name includes ${text}`);
  await field(page, 'name').fill('My quarry service');
  await page.locator('[data-cargo-choice="mail"]').click();
  assert.equal(await field(page, 'name').inputValue(), 'My quarry service', 'changing cargo preserves the manual name');
  await page.locator('[data-cargo-choice="stone"]').click();
  await page.locator('#reset-route-name').click();
  assert.equal(await field(page, 'name').inputValue(), automatic, 'reset restores the current automatic name');
  await field(page, 'name').fill('');
  await field(page, 'name').blur();
  assert.equal(await field(page, 'name').inputValue(), automatic, 'clearing a manual name restores automatic naming');
  await chooseStops(page, stops.beta, stops.alpha);
  await page.locator('[data-cargo-choice="stone"]').click();
  assert.match(await page.locator('#route-connection').textContent(), /Loads at the end stop/, 'freight produced at the second stop is offered and loaded in the right direction');
  assert.equal(await field(page, 'name').inputValue(), automatic, 'reversing selected stops retains the normalized freight name');
  await chooseStops(page, stops.alpha, stops.beta);
  await page.locator('[data-cargo-choice="stone"]').click();
  checkpoint('automatic-manual-and-reversed-freight-naming', { automatic });
  await page.evaluate(() => transport.renderer.setLayers({ routes: false }));
  const preview = await assertPreview(page, { pixels: 'desktop' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => transport.renderer.getStats().routePreview?.animated === false);
  await assertPreview(page, { animated: false });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  checkpoint('paused-preview-and-reduced-motion', { preview });

  // Quantity changes update the actual price and a supply-bounded estimate.
  await field(page, 'vehicleCount').fill('1');
  await field(page, 'vehicleCount').dispatchEvent('change');
  const one = await page.evaluate(async () => {
    const { forecastRoute } = await import('./route-planner.js'), form = document.querySelector('#route-form');
    const forecast = forecastRoute(transport.game, { mode: form.elements.mode.value, from: form.elements.from.value, to: form.elements.to.value, cargo: form.elements.cargo.value, vehicleCount: 1 });
    return { forecast, displayedRevenue: document.querySelector('[data-estimate-revenue]').textContent };
  });
  await page.locator('[data-route-quantity="1"]').click();
  await page.locator('[data-route-quantity="1"]').click();
  assert.equal(await field(page, 'vehicleCount').inputValue(), '3');
  const costText = await page.locator('[data-estimate-cost]').textContent();
  assert.equal(Number(costText.replace(/[^\d.]/g, '')), purchase * 3, 'the displayed upfront cost quotes all three vehicles');
  assert.match(await page.locator('[data-estimate-revenue]').textContent(), /\$/, 'gross revenue stays visible with the purchase price');
  assert.match(await page.locator('[data-estimate-net]').textContent(), /\$/, 'net revenue is identified separately');
  const many = await page.evaluate(async () => {
    const { forecastRoute } = await import('./route-planner.js'), form = document.querySelector('#route-form');
    return forecastRoute(transport.game, { mode: form.elements.mode.value, from: form.elements.from.value, to: form.elements.to.value, cargo: form.elements.cargo.value, vehicleCount: 100 });
  });
  assert.ok(many.movedDay <= many.supplyDay + 1e-8, 'many vehicles cannot carry more than the remaining source supply');
  assert.ok(many.revenueMonth <= one.forecast.revenueMonth * 100 + 1e-8, 'the bulk forecast never multiplies beyond available cargo');

  // Rejected quantities and a changed bank balance cannot partially buy a fleet.
  for (const invalid of ['0', '2.5']) {
    await field(page, 'vehicleCount').fill(invalid); await field(page, 'vehicleCount').dispatchEvent('change');
    const before = await snapshot(page);
    await page.locator('#route-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(await snapshot(page), before, `invalid vehicle count ${invalid} leaves the game untouched`);
  }
  await field(page, 'vehicleCount').fill('3'); await field(page, 'vehicleCount').dispatchEvent('change');
  await page.evaluate(cost => { transport.game.money = cost * 3 - 1; transport.game.revision++; }, purchase);
  const poor = await snapshot(page);
  await page.locator('#route-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(await snapshot(page), poor, 'insufficient total funds buys no vehicles and creates no route');
  await page.evaluate(() => { transport.game.money = 1_000_000; transport.game.revision++; });
  await page.waitForFunction(() => !document.querySelector('#route-form [type="submit"]').disabled);
  await page.screenshot({ path: `${output}/desktop-launch-step.png` });
  const balance = await page.evaluate(() => transport.game.money);
  await launch(page).click();
  await page.locator('#route-form').waitFor({ state: 'detached' });
  const launched = await page.evaluate(() => ({ route: transport.game.routes.at(-1), money: transport.game.money, vehicles: transport.game.vehicles.map(vehicle => ({ id: vehicle.id, routeId: vehicle.routeId })) }));
  assert.equal(launched.route.cargo, 'stone'); assert.equal(launched.route.name, automatic);
  assert.deepEqual(launched.route.stops, [stops.alpha.id, stops.beta.id]);
  assert.equal(launched.vehicles.filter(vehicle => vehicle.routeId === launched.route.id).length, 3);
  assert.equal(balance - launched.money, purchase * 3, 'launch charges exactly the displayed bulk cost');
  assert.equal(await page.evaluate(async () => (await import('./model.js')).validateGame(transport.game)), true, 'the bulk purchase leaves a save-valid company');
  await assertClearedPreview(page, 'launch clears the draft preview');
  checkpoint('bulk-launch-and-atomic-rejections', { bought: 3, cost: purchase * 3 });

  // A repeat pair adds all requested vehicles to the existing service.
  await newRoute(page); await chooseStops(page, stops.beta, stops.alpha);
  await page.locator('[data-cargo-choice="stone"]').click();
  assert.match(await page.locator('#route-connection').textContent(), /Already served/);
  assert.match(await page.locator('#route-connection').textContent(), /Loads at the end|Already served/);
  assert.equal(await field(page, 'name').count(), 0, 'an additional fleet order keeps the existing route name');
  assert.equal(await launch(page).count(), 0, 'an already served pair offers a focused fleet order');
  await field(page, 'vehicleCount').fill('2'); await field(page, 'vehicleCount').dispatchEvent('change');
  const repeatBefore = await page.evaluate(() => ({ money: transport.game.money, routes: transport.game.routes.length, vehicles: transport.game.vehicles.length }));
  assert.equal(await page.locator('#add-route-vehicle').isEnabled(), true, 'the existing route can accept the requested two vehicles');
  await field(page, 'vehicleCount').press('Enter');
  await page.locator('#route-form').waitFor({ state: 'detached' });
  const repeatAfter = await page.evaluate(() => ({ money: transport.game.money, routes: transport.game.routes.length, vehicles: transport.game.vehicles.length }));
  assert.equal(repeatAfter.routes, repeatBefore.routes, 'repeat cargo uses the existing route');
  assert.equal(repeatAfter.vehicles - repeatBefore.vehicles, 2);
  assert.equal(repeatBefore.money - repeatAfter.money, purchase * 2);
  assert.equal(await page.evaluate(async () => (await import('./model.js')).validateGame(transport.game)), true, 'an implicit existing-fleet order leaves a save-valid company');
  checkpoint('duplicate-fleet-order', { bought: 2, cost: purchase * 2 });

  // Editing moves a service while keeping every vehicle and spending nothing.
  const card = page.locator(`[data-route-id="${launched.route.id}"]`);
  await card.locator('[data-edit-route]').click();
  assert.equal(await field(page, 'vehicleCount').count(), 0, 'editing offers no purchase quantity');
  await expandStops(page); await field(page, 'to').selectOption(stops.gamma.id);
  await page.locator('[data-cargo-choice="stone"]').click();
  // Quote the retained fleet after a newer purchase generation becomes
  // available. Advancing the quoted date does not simulate or upgrade a truck.
  const retainedTrip = await page.evaluate(async id => {
    const { getRouteFleet, getVehiclePurchase } = await import('./model.js');
    const { forecastRoute, validateRoutePlan } = await import('./route-planner.js');
    const { planTrip, planText } = await import('./payment-rates.js');
    const g = transport.game, originalDay = g.day, form = document.querySelector('#route-form'), route = g.routes.find(route => route.id === id);
    g.day = originalDay + 365; g.revision++;
    const fleet = getRouteFleet(g, id), purchase = getVehiclePurchase(g, route.mode);
    const draft = { editing: id, mode: route.mode, from: form.elements.from.value, to: form.elements.to.value, cargo: form.elements.cargo.value, vehicleCount: fleet.count, fullLoad: route.fullLoad === true };
    const plan = validateRoutePlan(g, draft, { ignoreFunds: true, ignoreFleet: true }), forecast = forecastRoute(g, draft, plan);
    const retained = planTrip(g, draft.mode, draft.cargo, plan.path, fleet.minLevel, forecast.wait), latest = planTrip(g, draft.mode, draft.cargo, plan.path, purchase.level, forecast.wait);
    return { originalDay, retainedLevel: fleet.minLevel, purchaseLevel: purchase.level, expected: planText(retained), latest: planText(latest), days: retained.days, forecastDays: forecast.days, perUnit: retained.perUnit, forecastPerUnit: forecast.perUnit };
  }, launched.route.id);
  assert.equal(retainedTrip.retainedLevel, 0, 'the original five trucks keep their purchase generation');
  assert.ok(retainedTrip.purchaseLevel > retainedTrip.retainedLevel, 'the quoted year offers a newer truck');
  assert.notEqual(retainedTrip.expected, retainedTrip.latest, 'the route is long enough to distinguish old and new truck timetables');
  assert.equal(retainedTrip.days, retainedTrip.forecastDays); assert.equal(retainedTrip.perUnit, retainedTrip.forecastPerUnit);
  await page.waitForFunction(expected => document.querySelector('.route-forecast-trip')?.textContent === expected, retainedTrip.expected);
  if (!await page.locator('.forecast-details').evaluate(details => details.open)) await page.locator('.forecast-details > summary').click();
  assert.equal(await page.locator('.route-forecast-trip').isVisible(), true, 'retained-fleet trip details are readable while editing');
  assert.equal(await page.locator('.route-forecast-trip').textContent(), retainedTrip.expected, 'Edit quotes the retained fleet rather than the newer vehicle for sale');
  await page.screenshot({ path: `${output}/desktop-retained-fleet-edit.png` });
  // Keep the quoted year: the interface can record notices for that year, so
  // restoring only the day would leave future-dated metadata in the fixture.
  const editBefore = await page.evaluate(() => ({ money: transport.game.money, vehicles: transport.game.vehicles.map(vehicle => vehicle.id) }));
  await launch(page).click();
  await page.locator('#route-form').waitFor({ state: 'detached' });
  const edited = await page.evaluate(id => ({ money: transport.game.money, vehicles: transport.game.vehicles.map(vehicle => vehicle.id), route: transport.game.routes.find(route => route.id === id) }), launched.route.id);
  assert.equal(edited.money, editBefore.money); assert.deepEqual(edited.vehicles, editBefore.vehicles);
  assert.deepEqual(edited.route.stops, [stops.alpha.id, stops.gamma.id]);
  assert.equal(await page.evaluate(async () => (await import('./model.js')).validateGame(transport.game)), true, 'the retained-fleet edit and quoted year leave a save-valid company');
  checkpoint('edit-preserves-fleet-and-funds', { retainedTrip });

  // Changing endpoints removes unavailable cargo and brings the player back to
  // choosing cargo, while an explicit route name survives the change.
  await newRoute(page); await chooseStops(page, stops.beta, stops.alpha);
  await page.locator('[data-cargo-choice="stone"]').click();
  await field(page, 'name').fill('Manual name survives');
  await expandStops(page); await field(page, 'to').selectOption(stops.gamma.id);
  assert.equal(await page.locator('[data-cargo-choice="stone"]').count(), 0);
  assert.equal(await page.locator('#route-vehicles-step').isVisible(), false, 'unavailable cargo does not leave a stale launch step');
  assert.equal(await cargo(page).evaluateAll(buttons => buttons.filter(button => button.getAttribute('aria-pressed') === 'true').length), 0);
  await page.locator('[data-cargo-choice="passengers"]').click();
  assert.equal(await field(page, 'name').inputValue(), 'Manual name survives');
  await expandStops(page); await field(page, 'to').selectOption(stops.delta.id);
  await assertAvailableCargo(page, coverage, ['beta', 'delta']);
  assert.equal(await page.locator('#route-connection').getAttribute('data-state'), 'disconnected');
  assert.equal(await launch(page).isEnabled(), false, 'a supplied but disconnected pair cannot launch');
  await page.locator('#route-back').click();
  await assertClearedPreview(page, 'returning to the list clears the draft');
  checkpoint('stale-cargo-and-disconnected-endpoints');

  // Enter selects real map stops and lands on the cargo step after the end.
  await newRoute(page); await expandStops(page);
  await field(page, 'from').selectOption('');
  await page.locator('[data-pick-route="from"]').focus(); await page.keyboard.press('Enter');
  await page.evaluate(station => transport.renderer.focus(station.x, station.y), stops.beta); await settle(page);
  for (let tries = 0; tries < 2 && await field(page, 'from').inputValue() !== stops.beta.id; tries++) await page.keyboard.press('Enter');
  assert.equal(await field(page, 'from').inputValue(), stops.beta.id, 'Enter picks the start stop');
  // Move the real tile cursor, rather than moving the camera beneath the old
  // cursor and accidentally choosing the start stop again.
  for (let n = stops.beta.x; n < stops.gamma.x; n++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  assert.equal(await field(page, 'to').inputValue(), stops.gamma.id, 'arrows and Enter pick the end stop');
  await page.waitForFunction(() => document.activeElement?.closest('#route-cargo-step'));
  assert.equal(await page.locator('#route-vehicles-step').isVisible(), false);
  await page.locator('[data-cargo-choice="passengers"]').click();
  await assertPreview(page);
  await page.evaluate(() => transport.setTool('road'));
  await assertClearedPreview(page, 'choosing a construction tool clears the route draft overlay');
  await page.evaluate(() => transport.setTool('inspect'));
  await newRoute(page); await chooseStops(page, stops.beta, stops.gamma);
  await page.locator('[data-cargo-choice="passengers"]').click();
  await assertPreview(page);
  await createWorldFromMenu(page, { generationVersion: 10, seed: 1848 });
  await assertClearedPreview(page, 'a replacement world cannot inherit a route preview');
  results.push({ profile: 'desktop', stages: true, inferredMode: true, cargoFiltering: true, reversedFreight: true, manualNaming: true, bulkPurchase: 3, duplicatePurchase: 2, editPreservesFleet: true, preview });
  await context.close();

  const laptop = await start({ width: 1024, height: 768, density: 1.25, reducedMotion: 'reduce' });
  await chooseStops(laptop.page, laptop.stops.beta, laptop.stops.gamma);
  await laptop.page.locator('[data-cargo-choice="passengers"]').click();
  await field(laptop.page, 'vehicleCount').fill('4'); await field(laptop.page, 'vehicleCount').dispatchEvent('change');
  await assertPreview(laptop.page, { animated: false, pixels: 'laptop' });
  const fit = await laptop.page.evaluate(() => {
    const panel = document.querySelector('#panel-content'), estimate = document.querySelector('#route-estimate'), submit = document.querySelector('#route-form [type="submit"]');
    const rect = panel.getBoundingClientRect(), footer = estimate.getBoundingClientRect(), button = submit.getBoundingClientRect();
    return { panelFits: panel.scrollWidth <= panel.clientWidth + 1, footerFits: estimate.scrollWidth <= estimate.clientWidth + 1 && footer.left >= rect.left - 1 && footer.right <= rect.right + 1, footerVisible: footer.top >= rect.top - 1 && footer.bottom <= rect.bottom + 1, buttonVisible: button.top >= rect.top - 1 && button.bottom <= rect.bottom + 1 };
  });
  assert.equal(fit.panelFits, true, 'the laptop planner has no horizontal overflow');
  assert.equal(fit.footerFits, true, 'the estimate fits the laptop panel width');
  assert.equal(fit.footerVisible, true, 'cost and revenue stay visible on a laptop');
  assert.equal(fit.buttonVisible, true, 'the launch action stays visible with its estimate');
  await laptop.page.screenshot({ path: `${output}/laptop-launch-step.png` });
  results.push({ profile: 'laptop-1024x768-dpr1.25', fit, reducedMotion: true });
  await laptop.context.close();
  assert.deepEqual(errors, [], 'route building produces no browser or console errors');
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ results, errors }, null, 2));
} catch (error) {
  let index = 0;
  for (const context of browser.contexts()) for (const page of context.pages()) {
    if (!page.isClosed()) await page.screenshot({ path: `${output}/failure-${index++}.png`, timeout: 5000 }).catch(() => {});
  }
  await writeFile(`${output}/failure.json`, JSON.stringify({ message: error.message, results, errors }, null, 2));
  console.error(JSON.stringify({ failure: error.message, results, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
