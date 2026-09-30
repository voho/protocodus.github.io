// Serve the repository root first. Browser storage is isolated from the user's save.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, openGameAction, loadAutosaveFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-features-qa';
await mkdir(output, { recursive: true });
const errors = [];
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
};
const fits = (page, selector) => page.locator(selector).evaluate(element => element.scrollWidth <= element.clientWidth + 1);
// Text, borders and fills in the signal or warn colours (DESIGN.md 4.1 and 4.2) inside an element, as 'class colour'.
const accents = locator => locator.evaluate(root => {
  const probe = document.createElement('span'), colour = name => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
  document.body.append(probe); const orange = new Set(['--signal', '--signal-ink', '--warn'].map(colour)); probe.remove();
  return [root, ...root.querySelectorAll('*')].filter(el => el.getClientRects().length).flatMap(el => { const style = getComputedStyle(el); return [style.color, style.borderTopColor, style.backgroundColor].filter(value => orange.has(value)).map(value => `${el.className || el.tagName} ${value}`); });
});
async function openChains(page) {
  if (await page.locator('.main-nav').isVisible()) {
    await openGameAction(page, 'help-button');
    await page.locator('[data-help-tab="chains"]').click();
  } else {
    if (!(await page.locator('.sidebar').evaluate(element => element.classList.contains('mobile-open')))) await page.locator('.mobile-panel-toggle').click();
    await page.locator('.mobile-management [data-open-chains]').click();
  }
  await page.locator('.chains-explorer').waitFor({ state: 'visible' });
}
async function mapPoint(page, point) {
  return page.evaluate(point => {
    transport.renderer.focus(point.x, point.y);
    const rect = document.querySelector('#world').getBoundingClientRect(), camera = transport.renderer.getCamera();
    return { x: rect.left + rect.width / 2 + ((point.x + .5) * 32 - camera.x) * camera.zoom,
      y: rect.top + rect.height / 2 + ((point.y + .5) * 32 - camera.y) * camera.zoom };
  }, point);
}
async function clickMap(page, point) {
  const screen = await mapPoint(page, point);
  await page.waitForFunction(({ x, y }) => document.elementFromPoint(x, y)?.id === 'world', screen);
  await page.mouse.click(screen.x, screen.y);
}
async function clickStationBadge(page, station) {
  const screen = await mapPoint(page, station), zoom = await page.evaluate(() => transport.renderer.getCamera().zoom);
  const badge = { x: screen.x + 8 * zoom + 7, y: screen.y - 18 * zoom + 7 };
  await page.waitForFunction(({ x, y }) => document.elementFromPoint(x, y)?.id === 'world', badge);
  await page.mouse.click(badge.x, badge.y);
}
async function chooseView(page, view) {
  if (await page.locator('.main-nav').isVisible()) await page.locator(`.main-nav [data-view="${view}"]`).click();
  else {
    if (!(await page.locator('.sidebar').evaluate(element => element.classList.contains('mobile-open')))) await page.locator('.mobile-panel-toggle').click();
    await page.locator(`[data-mobile-view="${view}"]`).click();
  }
}
async function verifyConnection(page, state, valid) {
  await page.waitForFunction(({ state, valid }) => {
    const status = document.querySelector('#route-connection');
    return status?.dataset.state === state && status.dataset.valid === String(valid);
  }, { state, valid });
  assert.equal(await page.locator('#route-form button[type="submit"]').isDisabled(), !valid);
}

try {
  // A first freight route from a new quarry stop: the planner infers the cargo from its stops.
  const quarryPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  watch(quarryPage);
  await quarryPage.goto(url);
  await createWorldFromMenu(quarryPage, { biome: 'taiga', size: 'square512', seed: 1847 });
  const quarry = await quarryPage.evaluate(async () => {
    const { build } = await import('./model.js'), { buildPlan } = await import('./construction-plan.js');
    const game = transport.game, road = buildPlan(game, 'road', [251, 250, 249, 248, 247, 246, 245].map(y => ({ x: 219, y })), { preferredMode: 'road' }), stop = build(game, 'bus-stop', 219, 251);
    if (!road.ok || !stop.ok) throw new Error(`Could not prepare the quarry fixture: ${road.message}; ${stop.message}`);
    transport.inspect(219, 251);
    return { station: stop.station, alder: game.stations.find(station => station.name === 'Alderbrook Central') };
  });
  assert.ok(quarry.alder, 'seed 1847 opens with Alderbrook Central');
  await quarryPage.locator('#station-route').click();
  await quarryPage.locator('#route-connection').waitFor({ state: 'visible' });
  assert.equal(await quarryPage.locator('#route-planner').evaluate(element => element.open), true, 'a stop starts the planner open');
  assert.equal(await quarryPage.locator('[data-cargo-choice="stone"]').getAttribute('aria-pressed'), 'true', 'the start stop suggests its own freight');
  assert.match(await quarryPage.locator('#route-connection').textContent(), /Cargo set to Stone/);
  assert.equal(await quarryPage.locator('#route-forecast').isHidden(), true, 'no forecast before both stops are chosen');
  await quarryPage.locator('[data-pick-route="to"]').click();
  await clickStationBadge(quarryPage, quarry.alder);
  await quarryPage.locator('#route-pick-banner').waitFor({ state: 'hidden' });
  assert.equal(await quarryPage.locator('#route-form [name="to"]').inputValue(), quarry.alder.id);
  assert.equal(await quarryPage.locator('[data-cargo-choice="stone"][aria-pressed="true"]').count(), 1, 'stone stays selected for the pair');
  await verifyConnection(quarryPage, 'connected', true);
  assert.match(await quarryPage.locator('#route-connection').textContent(), /Connected by road, \d+ tiles · Cargo set to Stone/);
  await quarryPage.locator('#route-forecast').waitFor({ state: 'visible' });
  const forecastLine = /^≈ \+\$[\d.,]+k? \/ month · pays back in about \d+\u00a0(months?|years)$/, forecast = await quarryPage.locator('.forecast-summary').textContent();
  assert.match(forecast, forecastLine, 'choosing the end stop forecasts the route');
  assert.equal(await quarryPage.locator('.forecast-details').evaluate(element => element.open), false, 'forecast details start folded');
  await quarryPage.waitForFunction(() => {
    const drawer = document.querySelector('#panel-content').getBoundingClientRect(), launch = document.querySelector('#route-form [type="submit"]').getBoundingClientRect();
    return launch.top >= drawer.top && launch.bottom <= drawer.bottom + 1;
  }, undefined, { timeout: 3000 });
  await quarryPage.locator('.forecast-details summary').click();
  assert.match(await quarryPage.locator('.forecast-facts').innerText(), /^Source makes ≈ [\d.]+ \/ day once served\nOne truck carries ≈ [\d.]+ \/ day\n(Room for ≈ \d+ more trucks?|One truck carries all of it)\nA full truck pays ≈ \$[\d,]+/);
  assert.equal(await quarryPage.locator('[data-cargo-choice="stone"]').getAttribute('data-fits'), 'true');
  assert.equal(await quarryPage.locator('[data-cargo-choice="passengers"]').getAttribute('data-fits'), 'false', 'other cargo is dimmed but stays clickable');
  assert.match(await quarryPage.locator('[data-cargo-choice="passengers"]').getAttribute('title'), /different town/);
  assert.equal(await quarryPage.locator('#route-form [name="name"]').getAttribute('placeholder'), 'Stone quarry to Alderbrook', 'the default name describes the freight flow');
  await quarryPage.screenshot({ path: `${output}/desktop-quarry-planner.png` });
  await quarryPage.locator('.route-stop-field').last().locator('[data-cargo-pick="passengers"]').click();
  assert.equal(await quarryPage.locator('[data-cargo-choice="passengers"]').getAttribute('aria-pressed'), 'true', 'coverage badges choose cargo');
  await verifyConnection(quarryPage, 'connected', false);
  assert.equal(await quarryPage.locator('#route-forecast').isHidden(), true, 'a cargo the stops cannot carry hides the forecast');
  await quarryPage.locator('.route-stop-field').first().locator('[data-cargo-pick="stone"]').click();
  await verifyConnection(quarryPage, 'connected', true);
  assert.equal(await quarryPage.locator('.forecast-summary').textContent(), forecast, 'the forecast returns with the fitting cargo');
  await quarryPage.locator('#swap-route-stops').click();
  assert.equal(await quarryPage.locator('#route-form [name="from"]').inputValue(), quarry.alder.id, 'swap exchanges the stops');
  assert.equal(await quarryPage.locator('#route-form [name="to"]').inputValue(), quarry.station.id);
  await verifyConnection(quarryPage, 'connected', true);
  assert.match(await quarryPage.locator('#route-connection').textContent(), /Loads at the end stop/);
  assert.equal(await quarryPage.locator('.forecast-summary').textContent(), forecast, 'loading at the end stop forecasts the same flow');
  assert.equal(await quarryPage.locator('.forecast-details').evaluate(element => element.open), true, 'the details stay open across a rebuilt form');
  await quarryPage.locator('#swap-route-stops').click();
  await quarryPage.locator('#route-form button[type="submit"]').click();
  const stoneRoute = await quarryPage.evaluate(() => transport.game.routes.at(-1));
  assert.equal(stoneRoute.cargo, 'stone');
  assert.equal(stoneRoute.name, 'Stone quarry to Alderbrook', 'an empty name uses the default');
  assert.equal(stoneRoute.number, 2, 'the stone route is route 2');
  assert.equal(await quarryPage.locator('#route-planner').evaluate(element => element.open), false);
  await quarryPage.waitForFunction(id => {
    const drawer = document.querySelector('#panel-content').getBoundingClientRect(), card = document.querySelector(`[data-route-id="${id}"]`)?.getBoundingClientRect();
    return card && card.top >= drawer.top - 1 && card.bottom <= drawer.bottom + 1;
  }, stoneRoute.id, { timeout: 3000 });
  await quarryPage.screenshot({ path: `${output}/desktop-quarry-launched.png` });
  await quarryPage.setViewportSize({ width: 390, height: 844 });
  await quarryPage.waitForTimeout(250);
  await quarryPage.evaluate(() => transport.setView('routes'));
  await quarryPage.locator('#new-route-button').click();
  assert.equal(await quarryPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '390px planner fits the screen');
  assert.equal(await fits(quarryPage, '#panel-content'), true, '390px planner fits the drawer');
  assert.equal(await fits(quarryPage, '.route-swap'), true);
  assert.match(await quarryPage.locator('#route-connection').textContent(), /Already served by/);
  assert.match(await quarryPage.locator('.forecast-summary').textContent(), /^(≈ \+\$[\d.,]+k? \/ month · pays back in about|Likely to earn less than its upkeep)/, 'the planner forecasts one more truck');
  assert.match(await quarryPage.locator('.forecast-facts').innerText(), /Source makes ≈ [\d.]+ \/ day · (≈ [\d.]+ spare|all taken)/, 'the launched route takes its share of the supply');
  assert.equal(await fits(quarryPage, '#route-forecast'), true, '390px forecast fits');
  await quarryPage.locator('#route-forecast').scrollIntoViewIfNeeded();
  await quarryPage.screenshot({ path: `${output}/mobile-390-route-forecast.png` });
  await quarryPage.locator('#swap-route-stops').scrollIntoViewIfNeeded();
  await quarryPage.screenshot({ path: `${output}/mobile-390-quarry-planner.png` });
  await quarryPage.locator('#route-form [name="mode"]').selectOption('rail');
  assert.equal(await quarryPage.locator('#route-forecast').isHidden(), true, 'changing transport clears the stops and the forecast');
  await quarryPage.close();
  assert.deepEqual(errors, [], 'the route planner runs without console or runtime errors');
  console.log('Route planner checks passed: inferred cargo, fit marks, coverage picks, swap, default name, forecast, folded planner, 390px.');

  // Full load: an optional order under More options, for freight only. A quarry too slow to fill the truck makes it wait
  // at the stop; the card reads Loading, the line survives a reload, the truck's card says where it waits, and unticking
  // the order in Edit lets it leave.
  const quarryStop = page => page.evaluate(async () => {
    const { build } = await import('./model.js'), { buildPlan } = await import('./construction-plan.js');
    const game = transport.game, road = buildPlan(game, 'road', [251, 250, 249, 248, 247, 246, 245].map(y => ({ x: 219, y })), { preferredMode: 'road' }), stop = build(game, 'bus-stop', 219, 251);
    if (!road.ok || !stop.ok) throw new Error(`Could not prepare the quarry fixture: ${road.message}; ${stop.message}`);
    return { station: stop.station, alder: game.stations.find(station => station.name === 'Alderbrook Central') };
  });
  const waitingLine = (page, id) => page.evaluate(id => transport.game.vehicles.filter(vehicle => vehicle.routeId === id && typeof vehicle.fullLoadSince === 'number').map(vehicle => [vehicle.id, vehicle.fullLoadSince]), id);
  const loadPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  watch(loadPage);
  await loadPage.goto(url);
  await createWorldFromMenu(loadPage, { biome: 'taiga', size: 'square512', seed: 1847 });
  const loadStops = await quarryStop(loadPage);
  await loadPage.evaluate(() => transport.setView('routes'));
  await loadPage.locator('#route-form [name="from"]').selectOption(loadStops.station.id);
  await loadPage.locator('#route-form [name="to"]').selectOption(loadStops.alder.id);
  await loadPage.locator('[data-cargo-choice="passengers"]').click();
  assert.equal(await loadPage.locator('.route-options').isHidden(), true, 'passengers never wait, so More options is hidden');
  await loadPage.locator('[data-cargo-choice="stone"]').click();
  await verifyConnection(loadPage, 'connected', true);
  assert.equal(await loadPage.locator('.route-options').isVisible(), true, 'freight offers More options');
  assert.equal(await loadPage.locator('.route-options').evaluate(element => element.open), false, 'More options starts folded');
  assert.equal(await loadPage.locator('.route-options-state').textContent(), '', 'full load is off by default');
  await loadPage.locator('.route-options summary').click();
  await loadPage.locator('[data-route-option="full-load"]').check();
  assert.equal(await loadPage.locator('.route-options-state').textContent(), 'Full load', 'the summary names the order');
  await loadPage.locator('.route-options').scrollIntoViewIfNeeded();
  await loadPage.screenshot({ path: `${output}/desktop-full-load-options.png` });
  await loadPage.locator('#route-form button[type="submit"]').click();
  const loadRoute = await loadPage.evaluate(() => { const route = transport.game.routes.at(-1); return { id: route.id, cargo: route.cargo, fullLoad: route.fullLoad }; });
  assert.deepEqual([loadRoute.cargo, loadRoute.fullLoad], ['stone', true], 'the route launches with full load');
  const loadCard = loadPage.locator(`.route-card[data-route-id="${loadRoute.id}"]`);
  assert.deepEqual(await loadCard.locator('.route-actions button').allTextContents(), ['Show', 'Edit', 'Retire'], 'the route card gains no controls');
  // The truck left full; a quarry at its smallest size, with its store emptied, leaves it waiting when it returns.
  await loadPage.evaluate(stop => { const quarry = transport.game.industries.filter(site => site.kind === 'quarry').sort((a, b) => Math.hypot(a.x - stop.x, a.y - stop.y) - Math.hypot(b.x - stop.x, b.y - stop.y))[0]; quarry.inventory.stone = 0; quarry.capacity = .1; }, loadStops.station);
  await loadPage.locator('[data-speed="8"]').click();
  await loadPage.waitForFunction(id => transport.game.vehicles.some(vehicle => vehicle.routeId === id && typeof vehicle.fullLoadSince === 'number') && document.querySelector(`[data-route-status="${id}"]`)?.textContent === 'Loading', loadRoute.id, { timeout: 10000 });
  await loadPage.locator('[data-speed="0"]').click();
  assert.match(await loadCard.locator('[data-route-health]').textContent(), /^Waiting for a full load, \d+ of \d+\.$/, 'the card says how full the truck is');
  assert.equal(await loadCard.locator('[data-route-status]').evaluate(element => element.classList.contains('route-offline')), false, 'loading is running, never offline');
  await loadCard.screenshot({ path: `${output}/desktop-full-load-card.png` });
  const line = await waitingLine(loadPage, loadRoute.id);
  assert.ok(line.length > 0);
  await loadPage.evaluate(() => transport.persist());
  await loadPage.goto(url);
  await loadAutosaveFromMenu(loadPage);
  assert.equal(await loadPage.evaluate(id => transport.game.routes.find(route => route.id === id)?.fullLoad, loadRoute.id), true, 'the order survives a reload');
  assert.deepEqual(await waitingLine(loadPage, loadRoute.id), line, 'the same trucks wait since the same moments');
  if (await loadPage.locator('.sidebar.mobile-open').count()) await loadPage.locator('#close-management').click();
  const truckAt = await loadPage.evaluate(id => {
    const vehicle = transport.game.vehicles.find(item => item.id === id), at = transport.renderer.vehicleWorldPoint(vehicle), r = document.querySelector('#world').getBoundingClientRect();
    transport.renderer.setZoom(2); transport.renderer.focus(at.x, at.y); transport.renderer.render(performance.now(), {});
    for (let y = -90; y < 40; y += 3) for (let x = -40; x < 40; x += 3) if (transport.renderer.vehicleAt(r.left + r.width / 2 + x, r.top + r.height / 2 + y)?.id === id) return { x: r.left + r.width / 2 + x, y: r.top + r.height / 2 + y };
    return null;
  }, line[0][0]);
  assert.ok(truckAt, 'a waiting truck is pickable where it stands');
  await loadPage.mouse.click(truckAt.x, truckAt.y);
  assert.match(await loadPage.locator('[data-vehicle-live="trip"]').textContent(), /^Waiting for a full load at Stone quarry Stop \d+, \d+ of \d+$/, 'the truck card says where it waits');
  await loadPage.waitForTimeout(300);
  await loadPage.screenshot({ path: `${output}/desktop-full-load-truck.png` });
  await loadPage.locator('#inspector .tiny-button').click();
  await loadPage.evaluate(() => transport.setView('routes'));
  await loadCard.locator('[data-edit-route]').click();
  assert.deepEqual(await loadPage.locator('.route-options').evaluate(element => [element.open, element.hidden]), [true, false], 'Edit opens More options on a full-load route');
  assert.equal(await loadPage.locator('[data-route-option="full-load"]').isChecked(), true);
  assert.equal(await loadPage.locator('#route-form button[type="submit"]').isDisabled(), true, 'nothing to save yet');
  await loadPage.locator('[data-route-option="full-load"]').uncheck();
  assert.equal(await loadPage.locator('#route-form button[type="submit"]').isDisabled(), false, 'the order alone is a change');
  await loadPage.locator('#route-form button[type="submit"]').click();
  await loadPage.locator('#toast-region').filter({ hasText: 'leave as soon as they have loaded' }).waitFor({ timeout: 2000 });
  await loadPage.waitForFunction(id => !transport.game.vehicles.some(vehicle => vehicle.routeId === id && typeof vehicle.fullLoadSince === 'number'), loadRoute.id, { timeout: 2000 });
  assert.equal(await loadPage.evaluate(id => transport.game.routes.find(route => route.id === id).fullLoad, loadRoute.id), false);
  await loadPage.close();
  // On a phone, More options fits the drawer and its rows are finger-sized; the card keeps its height.
  const loadTouch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const loadPhone = await loadTouch.newPage();
  watch(loadPhone);
  await loadPhone.goto(url);
  await createWorldFromMenu(loadPhone, { biome: 'taiga', size: 'square512', seed: 1847 });
  const phoneStops = await quarryStop(loadPhone);
  await loadPhone.evaluate(() => transport.setView('routes'));
  await loadPhone.locator('#route-form [name="from"]').selectOption(phoneStops.station.id);
  await loadPhone.locator('#route-form [name="to"]').selectOption(phoneStops.alder.id);
  await loadPhone.locator('[data-cargo-choice="stone"]').click();
  await loadPhone.locator('.route-options summary').click();
  await loadPhone.locator('[data-route-option="full-load"]').check();
  assert.equal(await loadPhone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '390px planner fits the screen');
  assert.equal(await fits(loadPhone, '#panel-content'), true, '390px More options fits the drawer');
  for (const selector of ['.route-options summary', '.route-option']) assert.ok((await loadPhone.locator(selector).boundingBox()).height >= 44, `${selector} is at least 44px tall on touch`);
  await loadPhone.locator('.route-options').scrollIntoViewIfNeeded();
  await loadPhone.screenshot({ path: `${output}/mobile-390-full-load-options.png` });
  await loadPhone.locator('#route-form button[type="submit"]').click();
  const phoneRoute = await loadPhone.evaluate(() => transport.game.routes.at(-1).id), phoneCard = loadPhone.locator(`.route-card[data-route-id="${phoneRoute}"]`);
  await phoneCard.scrollIntoViewIfNeeded();
  const phoneHeight = (await phoneCard.boundingBox()).height;
  assert.equal(await phoneCard.evaluate(card => card.scrollWidth <= card.clientWidth + 1), true, 'the 390px full-load card does not overflow');
  await phoneCard.screenshot({ path: `${output}/mobile-390-full-load-card.png` });
  await loadPhone.evaluate(async id => { (await import('./model.js')).setRouteFullLoad(transport.game, id, false); transport.setView('routes'); }, phoneRoute);
  await phoneCard.scrollIntoViewIfNeeded();
  assert.equal((await phoneCard.boundingBox()).height, phoneHeight, 'the order adds nothing to the 390px card');
  await loadTouch.close();
  assert.deepEqual(errors, [], 'full load runs without console or runtime errors');
  console.log('Full load checks passed: freight only, folded option, launch, Loading card, reload, truck card, edit off, 390px touch.');

  // A route card buys and sells vehicles on its own service; the fleet survives an autosave reload.
  const fleetPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  watch(fleetPage);
  await fleetPage.goto(url);
  await createWorldFromMenu(fleetPage);
  await fleetPage.evaluate(() => transport.setView('routes'));
  const starterCard = fleetPage.locator('.route-card[data-route-id]').first(), fleetMoney = await fleetPage.evaluate(() => transport.game.money);
  // Spare demand is never a state: the starter card has no orange accent and never asks for a bus.
  assert.deepEqual(await accents(starterCard), [], 'the starter card has no orange accent');
  assert.doesNotMatch(await starterCard.innerText(), /Add a bus|Passengers waiting/i);
  assert.equal(await starterCard.locator('[data-route-room]').isHidden(), true, 'no room line before the route has run a month');
  assert.equal(await starterCard.locator('[data-sell-vehicle]').isDisabled(), true, 'the last vehicle is kept for retirement');
  await starterCard.locator('[data-add-vehicle]').click();
  assert.equal(await fleetPage.evaluate(() => transport.game.vehicles.length), 2, '+ Bus adds a second bus to the starter route');
  assert.equal(await fleetPage.evaluate(() => transport.game.money), fleetMoney - 18000, 'the bus costs its quoted price');
  assert.match(await starterCard.locator('[data-vehicle-spec]').textContent(), /^2 buses · \d+ \/ 48 loaded$/);
  assert.equal(await starterCard.locator('.vehicle-model').textContent(), 'Hollin Mk 1', 'the vehicle row names the model');
  assert.equal(await starterCard.locator('.vehicle-model').getAttribute('title'), '2 Hollin Mk 1. Newer buses arrive in 1951.', 'an up-to-date fleet says when newer models arrive');
  assert.equal(await starterCard.locator('[data-sell-vehicle]').isDisabled(), false);
  assert.deepEqual(await starterCard.locator('.route-actions button').allTextContents(), ['Show', 'Edit', 'Retire'], 'an up-to-date card keeps three actions');
  assert.ok((await starterCard.boundingBox()).height <= 300, `390px route card stays compact: ${(await starterCard.boundingBox()).height}px`);
  assert.equal(await fits(fleetPage, '#panel-content'), true, '390px fleet controls fit the drawer');
  await starterCard.screenshot({ path: `${output}/mobile-390-fleet-card.png` });
  // Delivery pay: the timetable estimate until a delivery, then the measured days; a slow trip shows its share of the fare.
  const trip = starterCard.locator('[data-route-trip]');
  assert.match(await trip.innerText(), /^\d+ tiles, about \d+ days?\n\$[\d,]+ each$/, 'the card estimates the trip before any delivery');
  await fleetPage.evaluate(async () => { const { tick } = await import('./model.js'), route = transport.game.routes[0]; for (let n = 0; n < 200 && !route.delivered; n++) tick(transport.game, .25); });
  await fleetPage.waitForFunction(() => !/about/.test(document.querySelector('[data-route-trip]').innerText));
  assert.match(await trip.innerText(), /^\d+ tiles, \d+ days?\n\$[\d,]+ each$/, 'after a delivery the card shows its measured days, at full pay');
  // Eight recent trips set the row, so the stalled cargo waits 80 days to outweigh the quick ones.
  await fleetPage.evaluate(async () => { const { tick } = await import('./model.js'), game = transport.game; tick(game, 90); for (const vehicle of game.vehicles) vehicle.loadedDay = Math.floor(game.day) - 80; tick(game, 12); });
  await fleetPage.waitForFunction(() => /% of full pay/.test(document.querySelector('[data-route-trip]').innerText));
  assert.match(await trip.innerText(), /^\d+ tiles, \d+ days\n\$[\d,]+ each, \d+% of full pay$/, 'a slow trip keeps less of the fare, and says how much');
  assert.match(await trip.locator('span').first().getAttribute('title'), /^Recent deliveries took \d+ days over \d+ tiles\. Each passenger pays \$[\d,]+ at today’s prices, \d+% of the full fare/);
  // A quarter on, both towns hold four busloads: a quiet ink-2 line under the fleet, still no orange and no request.
  const room = starterCard.locator('[data-route-room]');
  await fleetPage.waitForFunction(() => document.querySelector('[data-route-room]')?.hidden === false);
  assert.equal(await room.innerText(), 'Room for more', 'the count stays on the Waiting tag beside it');
  assert.match(await room.getAttribute('title'), /^Another bus would carry about [\d,]+ more passengers a month\.$/);
  assert.equal(await room.evaluate(el => { const probe = document.createElement('span'); probe.style.color = 'var(--ink-2)'; document.body.append(probe); const ink = getComputedStyle(probe).color; probe.remove(); return getComputedStyle(el).color === ink; }), true, 'the room line is ink-2');
  assert.deepEqual(await accents(starterCard), [], 'room for more adds no orange');
  assert.doesNotMatch(await starterCard.innerText(), /Add a bus|Passengers waiting/i);
  assert.equal(await fleetPage.evaluate(() => document.querySelector('#offline-routes').hidden), true, 'room never counts as attention');
  await starterCard.screenshot({ path: `${output}/mobile-390-slow-trip-card.png` });
  await starterCard.locator('[data-remove-route]').click();
  assert.match(await fleetPage.locator('#modal').innerText(), /Its 2 buses sell for \$16,200/);
  assert.equal(await fleetPage.locator('#confirm-retire').textContent(), 'Retire · +$16,200');
  await fleetPage.locator('#modal [data-close]').click();
  await fleetPage.evaluate(() => transport.persist());
  await fleetPage.goto(url);
  await loadAutosaveFromMenu(fleetPage);
  assert.equal(await fleetPage.evaluate(() => transport.game.vehicles.length), 2, 'the second bus survives an autosave reload');
  await fleetPage.evaluate(() => transport.setView('routes'));
  await fleetPage.locator('#new-route-button').click();
  await fleetPage.locator('#route-form [name="from"]').selectOption('station-1');
  await fleetPage.locator('#route-form [name="to"]').selectOption('station-2');
  await fleetPage.locator('[data-cargo-choice="passengers"]').click();
  assert.match(await fleetPage.locator('#route-connection').textContent(), /Already served by Alderbrook – Pinehaven/);
  assert.equal(await fleetPage.locator('#route-form [type="submit"]').textContent(), 'Launch separate service', 'a duplicate service stays possible');
  await fleetPage.locator('#add-route-vehicle').click();
  assert.deepEqual(await fleetPage.evaluate(() => [transport.game.routes.length, transport.game.vehicles.length]), [1, 3], 'the planner adds to the existing route instead of duplicating it');
  await fleetPage.close();
  assert.deepEqual(errors, [], 'fleet controls run without console or runtime errors');
  console.log('Fleet checks passed: add and sell, price, count, retire refund, autosave reload, planner reuse, 390px card.');

  // Mail: two town stops keep Passengers and offer Mail second; a mail truck launches, delivers with its envelope floater and survives a reload.
  const mailPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  watch(mailPage);
  await mailPage.goto(url);
  await createWorldFromMenu(mailPage);
  await mailPage.evaluate(() => {
    const renderer = transport.renderer, original = renderer.render;
    window.mailFloaters = [];
    renderer.render = function (now, view = {}) { for (const floater of view.floaters || []) if (floater.cargo === 'mail' && !mailFloaters.includes(floater)) mailFloaters.push(floater); return original.apply(this, arguments); };
    transport.setView('routes');
  });
  // The starter bus runs four days ahead, so its income never merges with the first mail floater.
  await mailPage.evaluate(async () => (await import('./model.js')).tick(transport.game, 4));
  await mailPage.locator('#new-route-button').click();
  await mailPage.locator('#route-form [name="from"]').selectOption('station-1');
  await mailPage.locator('#route-form [name="to"]').selectOption('station-2');
  assert.deepEqual(await mailPage.locator('[data-cargo-choice]').evaluateAll(buttons => buttons.slice(0, 2).map(button => button.dataset.cargoChoice)), ['passengers', 'mail'], 'mail is the second cargo');
  assert.equal(await mailPage.locator('[data-cargo-choice="passengers"]').getAttribute('aria-pressed'), 'true', 'two town stops keep Passengers');
  assert.equal(await mailPage.locator('[data-cargo-choice="mail"]').getAttribute('data-fits'), 'true', 'Mail fits two towns');
  assert.equal(await mailPage.locator('.route-stop-field').first().locator('[data-cargo-pick="mail"]').count(), 1, 'a town stop loads mail');
  await mailPage.locator('[data-cargo-choice="mail"]').click();
  assert.equal(await mailPage.locator('#route-form [name="name"]').getAttribute('placeholder'), 'Alderbrook – Pinehaven mail');
  assert.equal(await mailPage.locator('[data-vehicle-sprite="purchase"]').getAttribute('data-cargo'), 'mail', 'the purchase portrait is the mail truck');
  assert.match(await mailPage.locator('#route-connection').textContent(), /^Connected by road, \d+ tiles\.$/, 'mail is a route of its own beside the bus');
  assert.match(await mailPage.locator('#route-form .route-forecast-trip').textContent(), /^\d+ tiles, about \d+ days on the way, about \$[\d,]+ each$/, 'the trip keeps the full fare');
  await mailPage.locator('#route-planner').screenshot({ path: `${output}/desktop-mail-form.png` });
  const mailQuote = await mailPage.evaluate(async () => (await import('./model.js')).getVehiclePurchase(transport.game, 'road').cost), mailMoney = await mailPage.evaluate(() => transport.game.money);
  await mailPage.locator('#route-form button[type="submit"]').click();
  const mail = await mailPage.evaluate(() => { const route = transport.game.routes.find(item => item.cargo === 'mail'); return route && { id: route.id, name: route.name, stop: transport.game.stations.find(stop => stop.id === route.stops[1]) }; });
  assert.ok(mail, 'the mail route launches'); assert.equal(mail.name, 'Alderbrook – Pinehaven mail');
  assert.equal(await mailPage.evaluate(() => transport.game.money), mailMoney - mailQuote, 'the launch costs the quoted mail truck');
  await mailPage.evaluate(stop => transport.renderer.focus(stop.x, stop.y - 1), mail.stop);
  await mailPage.locator('[data-speed="3"]').click();
  await mailPage.waitForFunction(id => transport.game.routes.find(route => route.id === id).delivered > 0, mail.id, { timeout: 90000 });
  await mailPage.waitForFunction(() => mailFloaters.length > 0, undefined, { timeout: 5000 });
  await mailPage.evaluate(() => transport.setSpeed(0));
  await mailPage.screenshot({ path: `${output}/desktop-mail-floater.png` });
  const mailCard = mailPage.locator(`.route-card[data-route-id="${mail.id}"]`);
  await mailPage.waitForFunction(id => document.querySelector(`[data-route-health="${id}"]`)?.textContent === 'Mail travels both ways.', mail.id);
  assert.equal(await mailCard.locator('[data-route-status]').textContent(), 'Running');
  assert.equal(await mailCard.locator('[data-cargo-icon="mail"]').count(), 1, 'the card shows the envelope');
  assert.match(await mailCard.locator('[data-vehicle-spec]').textContent(), /^1 mail truck · /);
  await mailCard.screenshot({ path: `${output}/desktop-mail-card.png` });
  const waitingMail = await mailPage.evaluate(() => transport.game.cities.slice(0, 2).map(city => city.mail));
  assert.ok(waitingMail.every(n => Number.isFinite(n) && n >= 0), `towns keep their waiting mail: ${waitingMail}`);
  await mailPage.evaluate(() => transport.persist());
  await mailPage.setViewportSize({ width: 390, height: 844 });
  await mailPage.goto(url);
  await loadAutosaveFromMenu(mailPage);
  assert.deepEqual(await mailPage.evaluate(id => [transport.game.routes.find(route => route.id === id)?.cargo, transport.game.cities.every(city => Number.isFinite(city.mail))], mail.id), ['mail', true], 'the mail route and waiting mail survive a reload');
  await mailPage.evaluate(() => transport.setView('routes'));
  const phoneMailCard = mailPage.locator(`.route-card[data-route-id="${mail.id}"]`);
  await phoneMailCard.scrollIntoViewIfNeeded();
  assert.equal(await fits(mailPage, '#panel-content'), true, 'the 390px drawer fits the mail card');
  assert.equal(await phoneMailCard.evaluate(card => card.scrollWidth <= card.clientWidth + 1), true, 'the 390px mail card does not overflow');
  await phoneMailCard.screenshot({ path: `${output}/mobile-390-mail-card.png` });
  await mailPage.close();
  assert.deepEqual(errors, [], 'mail runs without console or runtime errors');
  console.log('Mail checks passed: second cargo, Passengers kept, Mail fits, name, truck portrait, quote, delivery floater, card, reload, 390px.');

  // Edit moves the stone route to Pinehaven by Pick on map and keeps its trucks; a new freight asks before dropping the load.
  const editPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  watch(editPage);
  await editPage.goto(url);
  await createWorldFromMenu(editPage, { biome: 'taiga', size: 'square512', seed: 1847 });
  const stone = await editPage.evaluate(async () => {
    const { build, addRoute, addRouteVehicle } = await import('./model.js'), { buildPlan } = await import('./construction-plan.js'), game = transport.game;
    const road = buildPlan(game, 'road', [251, 250, 249, 248, 247, 246, 245].map(y => ({ x: 219, y })), { preferredMode: 'road' }), stop = build(game, 'bus-stop', 219, 251);
    const alder = game.stations.find(station => station.name === 'Alderbrook Central'), pine = game.stations.find(station => station.name === 'Pinehaven Central');
    const launched = addRoute(game, { mode: 'road', stops: [stop.station.id, alder.id], cargo: 'stone' });
    if (!road.ok || !stop.ok || !launched.ok) throw new Error(`Could not prepare the stone route: ${road.message}; ${stop.message}; ${launched.message}`);
    addRouteVehicle(game, launched.route.id); transport.setView('routes');
    return { id: launched.route.id, start: stop.station.id, pine, vehicles: game.vehicles.filter(vehicle => vehicle.routeId === launched.route.id).map(vehicle => vehicle.id) };
  });
  const stoneCard = editPage.locator(`.route-card[data-route-id="${stone.id}"]`), editMoney = await editPage.evaluate(() => transport.game.money);
  await stoneCard.locator('[data-edit-route]').click();
  assert.equal(await editPage.locator('#route-planner summary h3').textContent(), 'Edit route');
  assert.match(await editPage.locator('.route-edit-note').textContent(), /^Stone quarry to Alderbrook keeps its 2 trucks\./);
  assert.equal(await editPage.locator('#route-form [name="mode"]').isDisabled(), true, 'the transport is fixed');
  assert.deepEqual(await editPage.evaluate(() => ['.purchase-vehicle', '#route-form [name="name"]', '[data-cargo-choice="passengers"]'].map(selector => document.querySelectorAll(selector).length)), [0, 0, 0], 'no purchase, no name field, and trucks never carry passengers');
  assert.equal(await editPage.locator('#route-forecast').isHidden(), true);
  assert.equal(await editPage.locator('#route-form [type="submit"]').textContent(), 'Save changes');
  assert.equal(await editPage.locator('#route-form [type="submit"]').isDisabled(), true, 'nothing to save before a change');
  await editPage.locator('[data-pick-route="to"]').click();
  await clickStationBadge(editPage, stone.pine);
  await editPage.locator('#route-pick-banner').waitFor({ state: 'hidden' });
  assert.equal(await editPage.locator('#route-form [name="to"]').inputValue(), stone.pine.id);
  await verifyConnection(editPage, 'connected', true);
  await editPage.screenshot({ path: `${output}/desktop-edit-route.png` });
  await editPage.locator('#route-form [type="submit"]').click();
  await editPage.locator('#route-planner summary h3').filter({ hasText: 'New route' }).waitFor();
  const moved = await editPage.evaluate(id => { const route = transport.game.routes.find(route => route.id === id); return { stops: route.stops, name: route.name, money: transport.game.money, vehicles: transport.game.vehicles.filter(vehicle => vehicle.routeId === id).map(vehicle => vehicle.id) }; }, stone.id);
  assert.deepEqual(moved.stops, [stone.start, stone.pine.id], 'the route now ends at Pinehaven');
  assert.equal(moved.money, editMoney, 'an edit costs nothing');
  assert.deepEqual(moved.vehicles, stone.vehicles, 'the same trucks run the new route');
  assert.equal(moved.name, 'Stone quarry to Pinehaven', 'a default name follows its stops');
  assert.match(await stoneCard.locator('.route-journey').textContent(), /Pinehaven Central$/, 'the card journey shows the new end');
  assert.equal(await editPage.locator('#route-planner').evaluate(element => element.open), false, 'saving folds the planner');
  // A refinery by the quarry lets the same trucks carry fuel to Pinehaven instead.
  const fuelMoney = await editPage.evaluate(async start => {
    const { build, buildProblem } = await import('./model.js'), game = transport.game, stop = game.stations.find(station => station.id === start);
    const site = [[-1, 1], [0, 2], [1, 2], [-5, 2]].find(([dx, dy]) => !buildProblem(game, 'refinery', stop.x + dx, stop.y + dy));
    if (!site || !build(game, 'refinery', stop.x + site[0], stop.y + site[1]).ok) throw new Error('No room for a refinery by the quarry stop');
    transport.setView('routes');
    return game.money;
  }, stone.start);
  await stoneCard.locator('[data-edit-route]').click();
  await editPage.locator('[data-cargo-choice="fuel"]').click();
  await verifyConnection(editPage, 'connected', true);
  await editPage.locator('#route-form [type="submit"]').click();
  assert.match(await editPage.locator('#modal').innerText(), /\d+ units of stone aboard will be discarded\./);
  await editPage.screenshot({ path: `${output}/desktop-edit-route-confirm.png` });
  await editPage.locator('#modal [data-close]').click();
  assert.equal(await editPage.evaluate(id => transport.game.routes.find(route => route.id === id).cargo, stone.id), 'stone', 'Keep editing changes nothing');
  await editPage.locator('#route-form [type="submit"]').click();
  await editPage.locator('#confirm-route-edit').click();
  const fuel = await editPage.evaluate(id => { const route = transport.game.routes.find(route => route.id === id); return { cargo: route.cargo, name: route.name, empty: transport.game.vehicles.filter(vehicle => vehicle.routeId === id).every(vehicle => vehicle.load === 0), money: transport.game.money }; }, stone.id);
  assert.deepEqual([fuel.cargo, fuel.empty, fuel.money], ['fuel', true, fuelMoney], 'the same trucks carry fuel from empty, free of charge');
  assert.equal(fuel.name, 'Oil refinery to Pinehaven', 'the default name follows the new freight');
  await stoneCard.locator('[data-edit-route]').click();
  await editPage.locator('#cancel-route-edit').click();
  assert.equal(await editPage.locator('#route-planner summary h3').textContent(), 'New route', 'Cancel leaves the edit');
  await editPage.setViewportSize({ width: 390, height: 844 });
  await editPage.evaluate(() => transport.setView('routes'));
  await stoneCard.locator('[data-edit-route]').click();
  assert.equal(await fits(editPage, '#panel-content'), true, '390px edit form fits the drawer');
  await editPage.locator('#cancel-route-edit').scrollIntoViewIfNeeded();
  await editPage.screenshot({ path: `${output}/mobile-390-edit-route.png` });
  await editPage.close();
  assert.deepEqual(errors, [], 'editing a route runs without console or runtime errors');
  console.log('Edit checks passed: fixed transport, no purchase, pick the end on the map, same trucks, no cost, default name follows, freight change confirm, Cancel, 390px.');

  // A stop renamed in its inspector reaches the planner's list, the route card and search; a route renames on its card.
  const namePage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  watch(namePage);
  await namePage.goto(url);
  await createWorldFromMenu(namePage);
  const renamedStop = await namePage.evaluate(() => { const stop = transport.game.stations[0]; transport.inspect(stop.x, stop.y); return stop.id; });
  await namePage.locator('#inspector .rename-button').click();
  assert.equal(await namePage.evaluate(() => document.activeElement.matches('#inspector h3 .rename-input') && document.activeElement.selectionEnd - document.activeElement.selectionStart === document.activeElement.value.length), true, 'the pencil opens a selected name field');
  await namePage.keyboard.type('Quay side');
  await namePage.locator('#inspector .tiny-button').click();
  assert.equal(await namePage.locator('#inspector').isHidden(), true, 'the click that leaves the field still closes the inspector');
  assert.equal(await namePage.evaluate(id => transport.game.stations.find(stop => stop.id === id).name, renamedStop), 'Quay side', 'leaving the field saves the stop name');
  await namePage.evaluate(() => { const stop = transport.game.stations[0]; transport.inspect(stop.x, stop.y); });
  await namePage.locator('#inspector .rename-button').click();
  await namePage.keyboard.type('Harbour gate');
  await namePage.screenshot({ path: `${output}/desktop-rename-stop.png`, clip: await namePage.locator('#inspector').boundingBox() });
  await namePage.keyboard.press('Enter');
  assert.equal(await namePage.locator('#inspector h3').textContent(), 'Harbour gate', 'Enter saves the stop name');
  assert.equal(await namePage.evaluate(id => transport.game.stations.find(stop => stop.id === id).name, renamedStop), 'Harbour gate');
  assert.equal(await namePage.evaluate(() => document.activeElement.dataset.rename), 'station', 'keyboard focus returns to the pencil');
  await namePage.evaluate(() => transport.setView('routes'));
  const nameCard = namePage.locator('.route-card[data-route-id]').first(), cardTitle = nameCard.locator('.route-header strong');
  assert.match(await nameCard.locator('.route-journey').textContent(), /^Harbour gate/, 'the route card journey uses the new stop name');
  assert.ok((await namePage.locator('#route-form [name="from"] option').allTextContents()).includes('Harbour gate'), 'the planner lists the new stop name');
  await namePage.locator('#route-search').fill('harbour');
  assert.equal(await namePage.locator('.route-card[data-route-id]').count(), 1, 'route search finds the renamed stop');
  await namePage.locator('#clear-route-filters').click();
  assert.equal(await namePage.evaluate(() => document.activeElement?.id), 'route-search', 'Clear filters hides itself and hands focus to the search field');
  const starterName = await cardTitle.textContent();
  await namePage.mouse.move(0, 0);
  assert.equal(await nameCard.locator('.rename-button').evaluate(el => getComputedStyle(el).opacity), '0', 'the card pencil stays out of sight until pointed at');
  await nameCard.locator('.route-header').hover();
  await namePage.waitForFunction(() => getComputedStyle(document.querySelector('.route-card .rename-button')).opacity === '1');
  await nameCard.locator('.rename-button').click();
  await namePage.keyboard.type('Never kept');
  await namePage.keyboard.press('Escape');
  assert.equal(await cardTitle.textContent(), starterName, 'Escape keeps the route name');
  await nameCard.locator('.rename-button').click();
  await namePage.keyboard.press('Backspace');
  await namePage.keyboard.press('Enter');
  assert.equal(await namePage.locator('#status-message').textContent(), 'Enter a name.', 'an empty name is refused');
  assert.equal(await nameCard.locator('.rename-input').isVisible(), true, 'a refused name keeps the field open');
  await namePage.keyboard.type('Morning line');
  await namePage.screenshot({ path: `${output}/desktop-rename-route.png`, clip: await nameCard.boundingBox() });
  await namePage.keyboard.press('Enter');
  assert.equal(await cardTitle.textContent(), 'Morning line', 'Enter saves the route name');
  await nameCard.locator('.route-header').hover();
  await nameCard.locator('.rename-button').click();
  await namePage.keyboard.type('Valley shuttle');
  await namePage.locator('#panel-content .panel-heading h2').click();
  assert.equal(await cardTitle.textContent(), 'Valley shuttle', 'leaving the field saves too');
  assert.equal(await namePage.evaluate(() => transport.game.routes[0].name), 'Valley shuttle');
  // Older saves may hold two stops of one name; the planner tells them apart by tile.
  const twin = await namePage.evaluate(() => { const [a, b] = transport.game.stations.filter(stop => stop.mode === 'road'); b.name = a.name; transport.setView('routes'); return b; });
  assert.ok((await namePage.locator('#route-form [name="from"] option').allTextContents()).includes(`Harbour gate · ${twin.x}, ${twin.y}`), 'duplicate stop names show their tile');
  await namePage.evaluate(() => transport.persist());
  await namePage.goto(url);
  await loadAutosaveFromMenu(namePage);
  assert.deepEqual(await namePage.evaluate(id => [transport.game.stations.find(stop => stop.id === id).name, transport.game.routes[0].name], renamedStop), ['Harbour gate', 'Valley shuttle'], 'new names survive an autosave reload');
  await namePage.close();
  assert.deepEqual(errors, [], 'renaming runs without console or runtime errors');
  console.log('Rename checks passed: stop in the inspector, planner list, journey, search, route card, Escape, refusal, blur, duplicate labels, reload.');

  // A carrier and its load badge open a vehicle card at every zoom; stop signs open their stop in Explore mode.
  const vehiclePage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  watch(vehiclePage);
  await vehiclePage.goto(url);
  await createWorldFromMenu(vehiclePage);
  const starterRoute = await vehiclePage.evaluate(async () => {
    const { tick } = await import('./model.js');
    for (let n = 0; n < 40; n++) tick(transport.game, .05);
    const route = transport.game.routes[0];
    return { id: route.id, name: route.name, stops: route.stops.map(id => transport.game.stations.find(station => station.id === id)) };
  });
  const vehicleTargets = zoom => vehiclePage.evaluate(zoom => {
    const vehicle = transport.game.vehicles[0], renderer = transport.renderer;
    renderer.setZoom(zoom); renderer.focus(vehicle.x + 2, vehicle.y - 2); renderer.render(performance.now(), {});
    const rect = document.querySelector('#world').getBoundingClientRect(), p = renderer.worldToScreen(vehicle.x, vehicle.y), badge = (zoom === 2 ? 22 : 18) + 13;
    return { point: { x: rect.left + p.x, y: rect.top + p.y }, badge: { x: rect.left + p.x, y: rect.top + p.y - 10 * zoom - badge / 2 - 5 } };
  }, zoom);
  for (const zoom of [.5, 1, 2]) {
    const targets = await vehicleTargets(zoom);
    for (const [part, point] of Object.entries(targets)) {
      await vehiclePage.mouse.click(point.x, point.y);
      assert.equal(await vehiclePage.locator('#inspector h3').textContent(), starterRoute.name, `${zoom}x clicking the bus ${part} opens its route`);
      assert.equal(await vehiclePage.locator('#inspector .eyebrow').textContent(), 'Hollin Mk 1 bus');
      assert.equal(await vehiclePage.locator('#inspector .vehicle-age').textContent(), '1950 model, new this year');
      assert.match(await vehiclePage.locator('[data-vehicle-live="load"]').textContent(), /^\d+ \/ 24$/);
      assert.match(await vehiclePage.locator('[data-vehicle-live="trip"]').textContent(), /^Heading to (Alderbrook|Pinehaven) Central · \d+ tiles?$/);
      await vehiclePage.locator('#inspector .tiny-button').click();
    }
  }
  await vehiclePage.keyboard.press('l');
  await vehiclePage.locator('[data-layer="vehicles"]').setChecked(false);
  await vehiclePage.keyboard.press('Escape');
  const hiddenBus = await vehicleTargets(1);
  await vehiclePage.mouse.click(hiddenBus.point.x, hiddenBus.point.y);
  assert.notEqual(await vehiclePage.locator('#inspector h3').textContent(), starterRoute.name, 'with vehicles hidden the same click inspects the map');
  assert.doesNotMatch(await vehiclePage.locator('#inspector .eyebrow').textContent(), /^Bus/);
  await vehiclePage.keyboard.press('l');
  await vehiclePage.locator('[data-layer="vehicles"]').setChecked(true);
  await vehiclePage.keyboard.press('Escape');
  for (const zoom of [.5, 1, 2]) for (const station of starterRoute.stops) {
    const sign = await vehiclePage.evaluate(({ zoom, station }) => {
      const renderer = transport.renderer; renderer.setZoom(zoom); renderer.focus(station.x, station.y);
      const rect = document.querySelector('#world').getBoundingClientRect(), marker = renderer.stationMarker(station), x = rect.left + marker.x + marker.size / 2, y = rect.top + marker.y + marker.size / 2;
      return { x, y, behind: renderer.screenToTile(x, y) };
    }, { zoom, station });
    if (zoom > .5) assert.notDeepEqual(sign.behind, { x: station.x, y: station.y }, `${zoom}x the sign stands over another tile`);
    await vehiclePage.mouse.click(sign.x, sign.y);
    assert.equal(await vehiclePage.locator('#inspector h3').textContent(), station.name, `${zoom}x the ${station.name} sign opens its stop in Explore mode`);
  }
  // A stop built beside the town centre is unused: a pale sign that steps off its neighbour where they would meet, and still opens its stop.
  // No drawn town name meets a sign, served signs wear their route's ring, and pointing at a sign names its stop.
  await vehiclePage.locator('#inspector .tiny-button').click();
  const beside = await vehiclePage.evaluate(async home => {
    const { build } = await import('./model.js'), g = transport.game;
    for (const [x, y] of [[home.x + 1, home.y], [home.x, home.y + 1], [home.x - 1, home.y], [home.x, home.y - 1]]) if (g.tiles[y * g.width + x]?.road) { const made = build(g, 'bus-stop', x, y); if (made.ok) return made.station; }
    return null;
  }, starterRoute.stops[0]);
  assert.ok(beside, 'a stop fits on the road beside the town centre');
  const meets = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  for (const zoom of [.5, 1, 2]) {
    const scene = await vehiclePage.evaluate(({ zoom, beside }) => {
      const renderer = transport.renderer, rect = document.querySelector('#world').getBoundingClientRect(); renderer.setZoom(zoom); renderer.focus(beside.x, beside.y); renderer.render(performance.now(), {});
      const signs = transport.game.stations.map(station => ({ id: station.id, ...renderer.stationMarker(station) })).filter(sign => sign.x > 0 && sign.y > 0 && sign.x < rect.width && sign.y < rect.height).map(sign => ({ id: sign.id, x: sign.x, y: sign.y, w: sign.size, h: sign.size }));
      const own = signs.find(sign => sign.id === beside.id);
      return { labels: renderer.cityLabels(), signs, stats: renderer.getStats().stopSigns, click: { x: rect.left + own.x + own.w / 2, y: rect.top + own.y + own.h / 2 } };
    }, { zoom, beside });
    for (const label of scene.labels) for (const sign of scene.signs) assert.equal(meets(label, sign), false, `${zoom}x the ${sign.id} sign clears the label of ${label.id}`);
    for (const [n, a] of scene.signs.entries()) for (const b of scene.signs.slice(n + 1)) assert.equal(meets(a, b), false, `${zoom}x the ${a.id} and ${b.id} signs stay apart`);
    assert.ok(scene.stats.active >= 1 && scene.stats.idle === 1 && scene.stats.broken === 0, `${zoom}x the served stop is ringed and the new one is unused: ${JSON.stringify(scene.stats)}`);
    await vehiclePage.mouse.move(scene.click.x, scene.click.y);
    await vehiclePage.waitForFunction(() => transport.renderer.getStats().stopSigns.named === 1);
    if (zoom === 1) await vehiclePage.screenshot({ path: `${output}/desktop-stop-signs.png`, clip: { x: scene.click.x - 200, y: scene.click.y - 120, width: 400, height: 220 } });
    await vehiclePage.mouse.click(scene.click.x, scene.click.y);
    assert.equal(await vehiclePage.locator('#inspector h3').textContent(), beside.name, `${zoom}x the new stop's sign opens its stop`);
    await vehiclePage.locator('#inspector .tiny-button').click();
  }
  const offline = await vehiclePage.evaluate(() => { const route = transport.game.routes[0]; route.active = false; transport.renderer.render(performance.now(), {}); const stats = transport.renderer.getStats().stopSigns; route.active = true; return stats; });
  assert.ok(offline.broken >= 1 && offline.active === 0, `a stop whose only route is offline wears a red ring: ${JSON.stringify(offline)}`);
  // Follow keeps the bus centred at 3× until the map is dragged or Escape is pressed; the speed never changes.
  const followBus = async () => {
    await vehiclePage.locator('[data-speed="0"]').click();
    const targets = await vehicleTargets(1);
    await vehiclePage.mouse.click(targets.badge.x, targets.badge.y);
    await vehiclePage.locator('[data-vehicle-action="follow"]').click();
    assert.equal(await vehiclePage.locator('[data-vehicle-action="follow"]').getAttribute('aria-pressed'), 'true');
    await vehiclePage.locator('[data-speed="3"]').click();
  };
  const followGap = () => vehiclePage.evaluate(() => { const vehicle = transport.game.vehicles[0], camera = transport.renderer.getCamera(); return Math.hypot(camera.x / 32 - .5 - vehicle.x, camera.y / 32 - .5 - vehicle.y); });
  // Once stopped, the camera holds still while the bus travels on.
  const cameraStays = async message => {
    const start = await vehiclePage.evaluate(() => { const vehicle = transport.game.vehicles[0], camera = transport.renderer.getCamera(); return { x: vehicle.x, y: vehicle.y, camera: [camera.x, camera.y] }; });
    await vehiclePage.waitForFunction(start => { const vehicle = transport.game.vehicles[0]; return Math.hypot(vehicle.x - start.x, vehicle.y - start.y) > 2; }, start, { timeout: 15000 });
    assert.deepEqual(await vehiclePage.evaluate(() => { const camera = transport.renderer.getCamera(); return [camera.x, camera.y]; }), start.camera, message);
  };
  await followBus();
  for (let n = 0; n < 6; n++) { await vehiclePage.waitForTimeout(500); const gap = await followGap(); assert.ok(gap < 1, `the camera stays within a tile of the followed bus: ${gap.toFixed(2)}`); }
  assert.equal(await vehiclePage.evaluate(() => transport.speed), 3, 'following keeps the chosen speed');
  await vehiclePage.screenshot({ path: `${output}/desktop-follow-bus.png` });
  await vehiclePage.mouse.move(760, 420); await vehiclePage.mouse.down(); await vehiclePage.mouse.move(860, 470, { steps: 6 }); await vehiclePage.mouse.up();
  assert.equal(await vehiclePage.locator('[data-vehicle-action="follow"]').getAttribute('aria-pressed'), 'false', 'a drag stops following');
  await cameraStays('after a drag the camera stays where it was moved');
  await followBus();
  await vehiclePage.keyboard.press('Escape');
  await vehiclePage.locator('#inspector').waitFor({ state: 'hidden' });
  await cameraStays('Escape closes the card and stops following');
  await vehiclePage.locator('[data-speed="0"]').click();
  // Show route frames and lights the service; Open in Routes flashes its card; + Bus buys another.
  const cardTargets = await vehicleTargets(1);
  await vehiclePage.mouse.click(cardTargets.badge.x, cardTargets.badge.y);
  await vehiclePage.locator('[data-vehicle-action="show"]').click();
  await vehiclePage.waitForFunction(id => transport.renderer.getStats().highlightRoute === id, starterRoute.id);
  assert.equal(await vehiclePage.evaluate(stops => { const rect = document.querySelector('#world').getBoundingClientRect(); return stops.every(station => { const p = transport.renderer.worldToScreen(station.x, station.y); return p.x > 0 && p.y > 0 && p.x < rect.width && p.y < rect.height; }); }, starterRoute.stops), true, 'Show route fits both stops on screen');
  assert.equal(await vehiclePage.locator('#inspector h3').textContent(), starterRoute.name, 'the card stays open while the route is shown');
  await vehiclePage.locator('[data-vehicle-action="add"]').click();
  assert.equal(await vehiclePage.evaluate(() => transport.game.vehicles.length), 2, '+ Bus buys another bus for the route');
  await vehiclePage.locator('[data-vehicle-action="routes"]').click();
  await vehiclePage.waitForFunction(id => document.querySelector(`.route-card[data-route-id="${id}"]`)?.classList.contains('route-flash'), starterRoute.id);
  await vehiclePage.screenshot({ path: `${output}/desktop-vehicle-card.png` });
  await vehiclePage.evaluate(async id => { const { removeRoute } = await import('./model.js'); removeRoute(transport.game, id); }, starterRoute.id);
  await vehiclePage.locator('#inspector').waitFor({ state: 'hidden' });
  const retired = await vehiclePage.evaluate(stop => { transport.renderer.focus(stop.x, stop.y); transport.renderer.render(performance.now(), {}); return transport.renderer.getStats().stopSigns; }, starterRoute.stops[0]);
  assert.ok(retired.drawn >= 1 && retired.idle === retired.drawn, `with its route retired the stop's sign turns pale: ${JSON.stringify(retired)}`);
  // Air: the route form offers planes once air travel arrives, and a plane's card names its model and its trip.
  const modes = () => vehiclePage.evaluate(() => { transport.setView('routes'); return [...document.querySelectorAll('#route-form [name="mode"] option')].map(option => option.textContent); });
  assert.ok(!(await modes()).includes('Air'), 'no planes before 1952');
  const plane = await vehiclePage.evaluate(async () => {
    const model = await import('./model.js'), g = transport.game; g.day = 730.02; g.lastDailyDay = 730; g.lastMonth = 24; g.money = 5e6;
    const a = model.build(g, 'airport-x', 192, 200).station, b = model.build(g, 'airport-y', 230, 270).station, route = model.addRoute(g, { mode: 'air', stops: [a.id, b.id], cargo: 'passengers' }).route;
    for (let n = 0; n < 60; n++) model.tick(g, .05);
    g.revision++; return g.vehicles.find(vehicle => vehicle.routeId === route.id).id;
  });
  assert.ok((await modes()).includes('Air'), 'Air joins the route form in 1952');
  await vehiclePage.keyboard.press('Escape');
  const planeAt = await vehiclePage.evaluate(id => {
    const g = transport.game, v = g.vehicles.find(vehicle => vehicle.id === id), w = transport.renderer.vehicleWorldPoint(v), r = document.querySelector('#world').getBoundingClientRect();
    transport.renderer.setZoom(1); transport.renderer.focus(w.x, w.y); transport.renderer.render(performance.now(), {});
    for (let y = -90; y < 40; y += 3) for (let x = -40; x < 40; x += 3) if (transport.renderer.vehicleAt(r.left + r.width / 2 + x, r.top + r.height / 2 + y)?.id === id) return { x: r.left + r.width / 2 + x, y: r.top + r.height / 2 + y };
    return null;
  }, plane);
  assert.ok(planeAt, 'a plane is pickable where it is drawn');
  await vehiclePage.mouse.click(planeAt.x, planeAt.y);
  assert.match(await vehiclePage.locator('#inspector .eyebrow').textContent(), /^Aldwyn Mk \d+ plane$/);
  assert.match(await vehiclePage.locator('[data-vehicle-live="trip"]').textContent(), /^(Heading to Elmhaven Airport · \d+ tiles?|(Landing at|Taxiing at|Boarding at|Taking off from) (Fernford|Elmhaven) Airport)$/);
  await vehiclePage.locator('#inspector .tiny-button').click();
  await vehiclePage.close();

  // On a touch screen the route picker says Tap and takes a stop sign within a finger's reach.
  const touchContext = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
  const touchPage = await touchContext.newPage();
  watch(touchPage);
  await touchPage.goto(url);
  await createWorldFromMenu(touchPage);
  await touchPage.evaluate(() => transport.setView('routes'));
  await touchPage.locator('[data-pick-route="from"]').tap();
  assert.match(await touchPage.locator('#route-pick-banner').innerText(), /^Tap the start road stop/);
  const reach = await touchPage.evaluate(() => {
    const station = transport.game.stations[0]; transport.renderer.focus(station.x, station.y);
    const rect = document.querySelector('#world').getBoundingClientRect(), marker = transport.renderer.stationMarker(station);
    return { id: station.id, x: rect.left + marker.x + marker.size + 12, y: rect.top + marker.y + marker.size / 2 };
  });
  await touchPage.touchscreen.tap(reach.x, reach.y);
  await touchPage.locator('#route-pick-banner').filter({ hasText: 'Tap the end road stop' }).waitFor();
  assert.equal(await touchPage.locator('#route-form [name="from"]').inputValue(), reach.id, 'a tap 12 px beside a sign picks its stop');
  assert.equal(await touchPage.locator('.toast.error').count(), 0, 'a near tap raises no error');
  await touchContext.close();
  assert.deepEqual(errors, [], 'vehicle cards and stop signs run without console or runtime errors');
  console.log('Vehicle and stop sign checks passed: badge and bus picks at 3 zooms, hidden vehicles, sign picks, Follow, Show route, touch picking, plane card.');

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  watch(page);
  await page.goto(url);
  await createWorldFromMenu(page);
  assert.ok((await page.locator('.topbar').boundingBox()).height <= 68, 'desktop header uses one compact lane');
  assert.equal(await page.locator('.statsbar, .region-header').count(), 0, 'the map no longer loses space to duplicate header rows');
  await page.locator('#company-stats').click();
  assert.equal(await page.locator('#company-stats').getAttribute('aria-expanded'), 'true');
  assert.match(await page.locator('#company-tooltip').innerText(), /Delivered[\s\S]*Connected towns/, 'company details remain available on demand');
  await page.locator('#company-stats').click();

  const definitions = await page.evaluate(async () => {
    const { INDUSTRIES, TOWN_CARGO } = await import('./data.js');
    return { industries: INDUSTRIES, townCargo: TOWN_CARGO, biome: transport.game.biome };
  });
  await openChains(page);
  await page.locator('#chain-product').selectOption('all');
  const available = Object.entries(definitions.industries).filter(([, definition]) => definition.biomes.includes(definitions.biome)).map(([kind]) => kind).sort();
  assert.deepEqual(await page.locator('[data-chain-industry]').evaluateAll(nodes => nodes.map(node => node.dataset.chainIndustry).filter(kind => kind !== 'towns').sort()), available, 'the graph contains the entire local industry catalog');
  await page.waitForFunction(() => document.querySelectorAll('[data-chain-edge]').length >= 10);
  assert.ok(await page.locator('[data-chain-edge]').count() >= 10, 'the graph draws recipe dependencies');
  await page.locator('#chain-product').selectOption('machinery');
  const machinery = await page.locator('[data-chain-industry]').evaluateAll(nodes => nodes.map(node => node.dataset.chainIndustry));
  for (const kind of ['coal-mine', 'iron-mine', 'steel-mill', 'oil-well', 'refinery', 'machine-works']) assert.ok(machinery.includes(kind), `machinery includes its ${kind} dependency`);
  assert.equal(machinery.includes('logging-camp'), false, 'an unrelated timber chain is excluded from machinery');
  await page.screenshot({ path: `${output}/desktop-machinery-chain.png` });
  await page.locator('#chain-product').selectOption('all');
  await page.locator('[data-chain-industry="towns"]').click();
  const chainTown = await page.evaluate(() => transport.game.cities.at(-1));
  assert.equal(await page.locator('[data-chain-site]').count(), await page.evaluate(() => transport.game.cities.length), 'the customer node lists every town');
  await page.locator(`[data-chain-locate="${chainTown.id}"]`).click();
  assert.equal(await page.locator('#inspector h3').textContent(), chainTown.name, 'the graph locates towns as well as industries');
  await page.locator('#inspector .tiny-button').click();
  await openChains(page);
  await page.locator('#chain-product').selectOption('all');
  await page.locator('[data-chain-industry="steel-mill"]').click();
  const steelSites = await page.evaluate(() => transport.game.industries.filter(industry => industry.kind === 'steel-mill'));
  assert.deepEqual(await page.locator('[data-chain-site]').evaluateAll(nodes => nodes.map(node => node.dataset.chainSite).sort()), steelSites.map(site => site.id).sort(), 'every steel mill in a huge world is listed');
  assert.equal(await page.locator('[data-chain-locate]').count(), steelSites.length, 'every site can be located');
  await page.screenshot({ path: `${output}/desktop-steel-sites.png` });
  const steel = steelSites.at(-1);
  await page.locator(`[data-chain-locate="${steel.id}"]`).click();
  assert.equal(await page.locator('#modal').evaluate(dialog => dialog.open), false, 'Locate returns to the live map');
  assert.equal(await page.locator('#inspector h3').textContent(), steel.name, 'Locate inspects the selected site');
  // Locate glides or cuts to the site and frames it in the visible band, the map right of the inspector (DESIGN.md 10.2).
  await page.waitForFunction(() => !transport.renderer.getStats().gliding);
  const centred = await page.evaluate(steel => {
    const middle = (steel.footprint || 1) / 2, p = transport.renderer.worldToScreen(steel.x + middle - .5, steel.y + middle - .5), map = document.querySelector('.map-section'), s = getComputedStyle(map), band = side => parseFloat(s.getPropertyValue(`--band-${side}`)) || 0;
    return { dx: p.x - (band('l') + map.clientWidth - band('r')) / 2, dy: p.y - (band('t') + map.clientHeight - band('b')) / 2 };
  }, steel);
  assert.ok(Math.abs(centred.dx) < 2 && Math.abs(centred.dy) < 2, `Locate centers the actual instance in the visible band: ${JSON.stringify(centred)}`);

  const expectedSteelTargets = await page.evaluate(steel => {
    return transport.game.industries.filter(industry => ['machine-works', 'furniture-factory'].includes(industry.kind))
      .sort((a, b) => Math.hypot(a.x - steel.x, a.y - steel.y) - Math.hypot(b.x - steel.x, b.y - steel.y)).slice(0, 5).map(industry => industry.id);
  }, steel);
  assert.deepEqual(await page.locator('#inspector [data-target-id]').evaluateAll(nodes => nodes.map(node => node.dataset.targetId)), expectedSteelTargets, 'steel customers are the five closest compatible industries');
  assert.match(await page.locator('#inspector .industry-use').innerText(), /Furniture works/);
  assert.match(await page.locator('#inspector .industry-use').innerText(), /Machine works/);
  await page.screenshot({ path: `${output}/desktop-industry-destinations.png` });
  await page.locator(`#inspector [data-target-id="${expectedSteelTargets[0]}"]`).click();
  assert.equal(await page.locator('#inspector h3').textContent(), await page.evaluate(id => transport.game.industries.find(industry => industry.id === id).name, expectedSteelTargets[0]), 'a destination opens its actual industry');
  await page.locator('#industry-chain').click();
  await page.locator('.chains-explorer').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  const foodSite = await page.evaluate(() => { const site = transport.game.industries.find(industry => industry.kind === 'food-plant'); transport.renderer.focus(site.x, site.y); return site; });
  await chooseView(page, 'industry');
  assert.equal(await page.locator('#entity-list [data-industry]').first().getAttribute('data-industry'), foodSite.id, 'the site in the middle of the view heads the list');
  await page.locator(`[data-industry="${foodSite.id}"]`).click();
  assert.match(await page.locator('#inspector .industry-use').innerText(), /Towns/, 'town demand appears as an output consumer');
  const townTargets = await page.evaluate(foodSite => transport.game.cities.slice().sort((a,b) => Math.hypot(a.x-foodSite.x,a.y-foodSite.y)-Math.hypot(b.x-foodSite.x,b.y-foodSite.y)).slice(0,5).map(city=>city.id), foodSite);
  assert.deepEqual(await page.locator('#inspector [data-target-id]').evaluateAll(nodes => nodes.map(node => node.dataset.targetId)), townTargets, 'food destinations are the five nearest towns');
  assert.equal(await page.locator('#inspector [data-target-kind="city"]').count(), 5);
  await page.locator(`#inspector [data-target-id="${townTargets[0]}"]`).click();
  assert.equal(await page.locator('#inspector h3').textContent(), await page.evaluate(id => transport.game.cities.find(city => city.id === id).name, townTargets[0]), 'town destination opens town details rather than its colocated station');
  await page.locator('#inspector .tiny-button').click();

  // Industries and Towns list the places nearest the middle of the view first, 40 to a page, each with its distance and an industry's nearest town.
  const nearestPlaces = () => page.evaluate(async () => {
    const { industrySize } = await import('./industry-sites.js'), game = transport.game, camera = transport.renderer.getCamera(), x = camera.x / 32 - .5, y = camera.y / 32 - .5;
    const centre = site => ({ x: site.x + (industrySize(site) - 1) / 2, y: site.y + (industrySize(site) - 1) / 2 }), squared = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    const away = at => { const n = Math.round(Math.sqrt(squared(at, { x, y }))); return n < 1 ? 'Right here' : `${n.toLocaleString('en-US')} ${n === 1 ? 'tile' : 'tiles'} away`; };
    const near = site => game.cities.reduce((best, city) => !best || squared(city, centre(site)) < squared(best, centre(site)) ? city : best, null);
    const byDistance = (list, at) => list.map(item => ({ item, d: squared(at(item), { x, y }) })).sort((a, b) => a.d - b.d).map(({ item }) => item);
    return {
      towns: byDistance(game.cities, city => city).map(city => ({ id: city.id, place: away(city) })),
      sites: byDistance(game.industries, centre).map(site => ({ id: site.id, place: `Near ${near(site).name} · ${away(centre(site))}` })),
      kinds: Object.fromEntries(game.industries.map(site => [site.id, site.kind])),
    };
  });
  const cards = selector => page.locator(`#entity-list ${selector}`).evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.city || node.dataset.industry, place: node.querySelector('.entity-place').textContent })));
  await page.evaluate(() => { const site = transport.game.industries.at(-1); transport.renderer.focus(site.x + 7, site.y - 5); });
  let places = await nearestPlaces();
  await chooseView(page, 'towns');
  assert.deepEqual(await cards('[data-city]'), places.towns.slice(0, 40), 'Towns opens with the 40 towns nearest the view, each with its distance');
  assert.equal(await page.locator('#entity-list .route-pagination span').first().textContent(), 'Page 1 of 2');
  await page.locator('#entity-sort').selectOption('population');
  const populous = await page.evaluate(() => transport.game.cities.reduce((best, city) => city.population > best.population ? city : best).id);
  assert.equal(await page.locator('#entity-list [data-city]').first().getAttribute('data-city'), populous, 'Population puts the largest town first');
  await page.locator('#entity-sort').selectOption('nearby');
  await chooseView(page, 'industry');
  assert.deepEqual(await cards('[data-industry]'), places.sites.slice(0, 40), 'Industries opens with the 40 sites nearest the view, near their closest town');
  assert.equal(await page.locator('#entity-list .route-pagination span').first().textContent(), `Page 1 of ${Math.ceil(places.sites.length / 40)}`);
  await page.locator('#entity-list [data-entity-page="next"]').first().click();
  assert.deepEqual(await cards('[data-industry]'), places.sites.slice(40, 80), 'Next shows the following 40 sites');
  // The periodic refresh keeps the page, its order and the scroll, even after the view moves.
  await page.locator('#panel-content').evaluate(panel => { panel.scrollTop = 600; document.querySelector('#entity-list .entity-card').dataset.stale = 'yes'; });
  await page.evaluate(() => { transport.renderer.focus(40, 40); transport.game.revision++; });
  await page.waitForFunction(() => !document.querySelector('#entity-list [data-stale]'), undefined, { timeout: 10000 });
  assert.deepEqual(await cards('[data-industry]'), places.sites.slice(40, 80), 'a refresh keeps the page and its order');
  assert.equal(await page.locator('#panel-content').evaluate(panel => panel.scrollTop), 600, 'a refresh keeps the scroll position');
  await page.locator('#entity-sort').selectOption('name');
  assert.equal(await page.locator('#entity-list .route-pagination span').first().textContent(), `Page 1 of ${Math.ceil(places.sites.length / 40)}`, 'a new sort returns to the first page');
  const names = await page.locator('#entity-list [data-industry] h3').allTextContents();
  assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b, 'en-US')), 'Name sorts the sites alphabetically');
  await page.locator('#entity-sort').selectOption('attention');
  const order = ['full', 'backlog', 'waiting', 'producing'], states = await page.locator('#entity-list .site-status').evaluateAll(nodes => nodes.map(node => node.dataset.state));
  assert.deepEqual(states, states.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)), 'Status puts the sites that need attention first');
  assert.equal(states[0], 'waiting', 'factories without inputs lead a new world');
  // A site whose status changes keeps its place until the list is sorted again.
  const waiting = await page.locator('#entity-list [data-industry]').first().getAttribute('data-industry');
  const stock = await page.evaluate(async id => { const { INDUSTRIES } = await import('./data.js'), site = transport.game.industries.find(industry => industry.id === id), before = { ...site.inventory }; for (const key of Object.keys(INDUSTRIES[site.kind].inputs)) site.inventory[key] = 10; document.querySelector('#entity-list .entity-card').dataset.stale = 'yes'; transport.game.revision++; return before; }, waiting);
  await page.waitForFunction(() => !document.querySelector('#entity-list [data-stale]'), undefined, { timeout: 10000 });
  assert.equal(await page.locator('#entity-list [data-industry]').first().getAttribute('data-industry'), waiting, 'a refresh never reorders the list');
  assert.equal(await page.locator('#entity-list .site-status').first().getAttribute('data-state'), 'producing', 'a refresh updates the status in place');
  await page.evaluate(({ id, stock }) => { transport.game.industries.find(industry => industry.id === id).inventory = stock; }, { id: waiting, stock });
  await page.locator('#entity-sort').selectOption('nearby');
  places = await nearestPlaces();
  await page.locator('#industry-kind').selectOption('sawmill');
  assert.deepEqual(await cards('[data-industry]'), places.sites.filter(site => places.kinds[site.id] === 'sawmill'), 'the type filter keeps the nearest-first order');
  assert.equal(await page.locator('#entity-list .route-pagination').count(), 0, 'a short list has no pages');
  await page.locator('#industry-kind').selectOption('all');
  await page.locator('#entity-search').fill('timber');
  const timber = await page.evaluate(async () => { const { INDUSTRIES } = await import('./data.js'); return Object.keys(INDUSTRIES).filter(kind => INDUSTRIES[kind].inputs.timber || INDUSTRIES[kind].outputs.timber); });
  assert.deepEqual(await cards('[data-industry]'), places.sites.filter(site => timber.includes(places.kinds[site.id])).slice(0, 40), 'search matches cargo and keeps the nearest-first order');
  await page.locator('#entity-search').fill('');
  const first = page.locator('#entity-list [data-industry]').first(), listed = { id: await first.getAttribute('data-industry'), name: await first.locator('h3').textContent(), place: await first.locator('.entity-place').textContent() };
  await first.click();
  assert.equal(await page.locator('#inspector h3').textContent(), listed.name, 'a card locates and inspects its site');
  await page.waitForFunction(() => !transport.renderer.getStats().gliding);
  const located = await page.evaluate(async () => {
    // The site under the middle of the visible band, the map right of the inspector.
    const { industrySize } = await import('./industry-sites.js'), game = transport.game, map = document.querySelector('.map-section'), s = getComputedStyle(map), band = side => parseFloat(s.getPropertyValue(`--band-${side}`)) || 0, r = map.getBoundingClientRect();
    const at = transport.renderer.screenToTile(r.left + (band('l') + map.clientWidth - band('r')) / 2, r.top + (band('t') + map.clientHeight - band('b')) / 2);
    const site = game.industries.find(industry => at.x >= industry.x && at.y >= industry.y && at.x <= industry.x + industrySize(industry) - 1 && at.y <= industry.y + industrySize(industry) - 1), x = site.x + (industrySize(site) - 1) / 2, y = site.y + (industrySize(site) - 1) / 2;
    return { id: site.id, town: game.cities.reduce((best, city) => !best || Math.hypot(city.x - x, city.y - y) < Math.hypot(best.x - x, best.y - y) ? city : best, null).name };
  });
  assert.equal(located.id, listed.id, 'the camera centres the listed site');
  assert.ok(listed.place.startsWith(`Near ${located.town} · `), 'the card names the town nearest the located site');
  await page.locator('#inspector .tiny-button').click();

  // Selecting an industry arcs to the targets its inspector lists; pointing at a row picks out its arc and closing the card clears them.
  const nextFrames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const mineArc = await page.evaluate(() => {
    const game = transport.game, mine = game.industries.find(industry => industry.x === 217 && industry.y === 232), mill = game.industries.find(industry => industry.x === 207 && industry.y === 258);
    transport.renderer.setZoom(.5); transport.renderer.focus(mine.x + 1, mine.y + 1);
    return { mine: mine.id, mill: mill.id };
  });
  const arcPixels = () => page.evaluate(({ mine, mill }) => {
    const renderer = transport.renderer, site = id => transport.game.industries.find(industry => industry.id === id), from = renderer.industryMarker(site(mine)), to = renderer.industryMarker(site(mill));
    const side = to.x > from.x ? -1 : 1, c = { x: (from.x + to.x) / 2 - side * (to.y - from.y) * .18, y: (from.y + to.y) / 2 + side * (to.x - from.x) * .18 }, s = .3;
    const x = (1 - s) ** 2 * from.x + 2 * (1 - s) * s * c.x + s * s * to.x, y = (1 - s) ** 2 * from.y + 2 * (1 - s) * s * c.y + s * s * to.y;
    const canvas = document.querySelector('#world'), scale = canvas.width / canvas.getBoundingClientRect().width;
    return Array.from(canvas.getContext('2d').getImageData(Math.round((x - 6) * scale), Math.round((y - 6) * scale), Math.round(12 * scale), Math.round(12 * scale)).data);
  }, mineArc);
  await nextFrames();
  const unselectedArc = await arcPixels();
  assert.equal(await page.evaluate(() => transport.renderer.getStats().contextTargets), 0, 'no arcs without a selected industry');
  const mineBadge = await page.evaluate(id => { const rect = document.querySelector('#world').getBoundingClientRect(), marker = transport.renderer.industryMarker(transport.game.industries.find(industry => industry.id === id)); return { x: rect.left + marker.x, y: rect.top + marker.y }; }, mineArc.mine);
  await page.waitForFunction(({ x, y }) => document.elementFromPoint(x, y)?.id === 'world', mineBadge);
  await page.mouse.click(mineBadge.x, mineBadge.y);
  assert.equal(await page.locator('#inspector h3').textContent(), 'Iron mine', 'the badge opens the iron mine');
  assert.equal(await page.locator('#inspector [data-target-id]').first().getAttribute('data-target-id'), mineArc.mill, 'the nearest steel mill heads the list');
  const targetRows = await page.locator('#inspector [data-target-id]').count();
  await page.waitForFunction(rows => transport.renderer.getStats().contextTargets === rows, targetRows);
  const selectedArc = await arcPixels();
  assert.notDeepEqual(selectedArc, unselectedArc, 'an arc runs toward the nearest steel mill');
  await page.locator('#inspector [data-target-id]').first().hover();
  await nextFrames();
  assert.notDeepEqual(await arcPixels(), selectedArc, 'pointing at its row picks out the arc');
  await page.screenshot({ path: `${output}/desktop-industry-arcs.png` });
  await page.locator('#inspector .tiny-button').click();
  await page.waitForFunction(() => transport.renderer.getStats().contextTargets === 0);
  await page.evaluate(() => transport.renderer.setZoom(1));

  // Controlled nearby freight and a parallel railway exercise the real route form.
  // Only this fresh browser context is modified; production game saves are untouched.
  const fixture = await page.evaluate(async () => {
    const { build } = await import('./model.js');
    const game = transport.game, [from, to] = game.stations;
    const food = game.industries.find(industry => industry.kind === 'food-plant');
    food.x = from.x + 1; food.y = from.y + 1; food.inventory.food = 150;
    const railY = from.y + 2;
    for (let x = from.x; x <= to.x; x++) {
      Object.assign(game.tiles[railY * game.width + x], { terrain: 'grass', detail: '', publicRoad: false, road: false, rail: true, bridge: false, tunnel: false, building: null, zone: null });
    }
    game.networkRevision++; game.revision++;
    const a = build(game, 'train-stop', from.x, railY), b = build(game, 'train-stop', to.x, railY);
    if (!a.ok || !b.ok) throw new Error(`Could not prepare rail fixture: ${a.message}; ${b.message}`);
    const railFrom = game.stations.find(station => station.mode === 'rail' && station.x === from.x && station.y === railY);
    const railTo = game.stations.find(station => station.mode === 'rail' && station.x === to.x && station.y === railY);
    return { from, to, railFrom, railTo, gap: { x: from.x + 12, y: from.y }, railGap: { x: from.x + 12, y: railY } };
  });
  await chooseView(page, 'routes');
  await page.locator('#route-form [name="name"]').fill('Orchard food delivery');
  await page.locator('[data-cargo-choice="food"]').click();
  await page.locator('[data-pick-route="from"]').click();
  await page.locator('#route-pick-banner').waitFor({ state: 'visible' });
  await clickMap(page, fixture.railFrom);
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(), '', 'road picking rejects a rail station');
  await clickMap(page, fixture.from);
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(), fixture.from.id, 'map selection fills the departure');
  await clickMap(page, fixture.from);
  assert.equal(await page.locator('#route-form [name="to"]').inputValue(), '', 'the departure cannot also be the arrival');
  await clickMap(page, fixture.to);
  assert.equal(await page.locator('#route-form [name="to"]').inputValue(), fixture.to.id, 'map selection fills the arrival');
  await page.locator('#route-pick-banner').waitFor({ state: 'hidden' });
  await verifyConnection(page, 'connected', true);
  // The starter route runs through the gap: once broken it pins the gap on the map and names itself in the top bar.
  const aboveGap = () => page.evaluate(point => {
    transport.renderer.focus(point.x, point.y); transport.renderer.render(performance.now(), {});
    const canvas = document.querySelector('#world'), scale = canvas.width / canvas.getBoundingClientRect().width, p = transport.renderer.worldToScreen(point.x, point.y);
    return Array.from(canvas.getContext('2d').getImageData(Math.round((p.x - 30) * scale), Math.round((p.y - 32) * scale), Math.round(60 * scale), 1).data);
  }, fixture.gap);
  const intactAboveGap = await aboveGap();

  await page.evaluate(async point => {
    const { build } = await import('./model.js');
    const result = build(transport.game, 'bulldoze', point.x, point.y);
    if (!result.ok) throw new Error(result.message);
  }, fixture.gap);
  await verifyConnection(page, 'disconnected', false);
  await page.evaluate(async () => { const { tick } = await import('./model.js'); tick(transport.game, .01); });
  await page.locator('#offline-routes').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#offline-routes').getAttribute('aria-label'), '1 route needs attention', 'the top bar counts the offline route');
  const brokenAboveGap = await aboveGap();
  assert.equal(await page.evaluate(() => transport.renderer.getStats().routeBreaks), 1, 'the broken route pins its gap');
  assert.notDeepEqual(brokenAboveGap, intactAboveGap, 'the pin changes the map above the gap');
  assert.ok(brokenAboveGap.every((value, index) => index % 4 === 3 || value > 200), 'a paper "Not connected" plate sits above the gap');
  await page.screenshot({ path: `${output}/desktop-disconnected-route.png` });
  await page.evaluate(() => transport.setTool('road'));
  await clickMap(page, fixture.gap);
  await page.keyboard.press('Escape');
  // A construction tool closes the drawer; Routes reopens the planner with its stops.
  await chooseView(page, 'routes');
  await verifyConnection(page, 'connected', true);
  await page.locator('#offline-routes').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => transport.renderer.getStats().routeBreaks), 0, 'a repaired route drops its pin');
  const beforeFreight = await page.evaluate(() => transport.game.money);
  await page.locator('#route-form button[type="submit"]').click();
  assert.equal(await page.evaluate(() => transport.game.money), beforeFreight - 18000, 'a verified road connection buys one truck');
  const freight = await page.evaluate(() => transport.game.routes.find(route => route.name === 'Orchard food delivery'));
  assert.equal(freight.cargo, 'food');
  assert.equal(await page.evaluate(id => transport.game.vehicles.find(vehicle => vehicle.routeId === id).load, freight.id), 24, 'new freight loads the selected resource');
  assert.equal(await page.locator('#route-planner').evaluate(element => element.open), false, 'a launch folds the planner away');
  assert.equal(await page.locator(`.route-card[data-route-id="${freight.id}"]`).evaluate(element => element.classList.contains('route-flash')), true, 'the new route card flashes');
  await page.locator('#new-route-button').click();
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(), fixture.from.id, 'the planner keeps its stops for another vehicle');

  await page.locator('#route-form [name="mode"]').selectOption('rail');
  await page.locator('#route-form [name="name"]').fill('Valley passenger express');
  await page.locator('[data-cargo-choice="passengers"]').click();
  await page.locator('#route-form [name="from"]').selectOption(fixture.railFrom.id);
  await page.locator('#route-form [name="to"]').selectOption(fixture.railTo.id);
  await verifyConnection(page, 'connected', true);
  const beforeRail = await page.evaluate(() => transport.game.money);
  await page.locator('#route-form button[type="submit"]').click();
  assert.equal(await page.evaluate(() => transport.game.money), beforeRail - 78000, 'the rail planner buys a train');
  assert.equal(await page.locator('.route-card[data-route-id]').count(), 3);

  await page.locator('#route-search').fill('ORCHARD');
  assert.equal(await page.locator('.route-card[data-route-id]').count(), 1, 'route search ignores letter case');
  assert.match(await page.locator('.route-card[data-route-id]').innerText(), /Orchard food delivery/);
  await page.locator('#route-search').fill('no such connection');
  assert.equal(await page.locator('.route-card[data-route-id]').count(), 0, 'no-match search does not retain unrelated routes');
  await page.locator('#route-search').fill('');
  await page.locator('#route-filter-mode').selectOption('rail');
  assert.equal(await page.locator('.route-card[data-route-id]').count(), 1);
  assert.match(await page.locator('.route-card[data-route-id]').innerText(), /Valley passenger express/);
  await page.locator('#route-filter-mode').selectOption('all');
  await page.locator('#route-filter-cargo').selectOption('food');
  assert.equal(await page.locator('.route-card[data-route-id]').count(), 1);
  assert.match(await page.locator('.route-card[data-route-id]').innerText(), /Orchard food delivery/);
  await page.locator('#route-filter-cargo').selectOption('all');
  await page.evaluate(async point => {
    const { build, tick } = await import('./model.js');
    const result = build(transport.game, 'bulldoze', point.x, point.y);
    if (!result.ok) throw new Error(result.message);
    tick(transport.game, .01);
  }, fixture.railGap);
  await page.locator('#offline-routes').click();
  assert.equal(await page.locator('#route-filter-status').inputValue(), 'attention', 'the chip lists only the routes that need attention');
  assert.equal(await page.locator('.route-card[data-route-id]').count(), 1);
  const offlineRoute = await page.locator('.route-card[data-route-id]').getAttribute('data-route-id');
  await page.locator('.route-card[data-route-id] .route-journey').hover();
  await page.waitForFunction(id => transport.renderer.getStats().highlightRoute === id, offlineRoute);
  await page.mouse.move(900, 500);
  await page.waitForFunction(() => transport.renderer.getStats().highlightRoute === null);
  await page.locator('#route-filter-status').selectOption('disconnected');
  assert.equal(await page.locator('.route-card[data-route-id]').count(), 1, 'status filter follows actual broken infrastructure');
  assert.match(await page.locator('.route-card[data-route-id]').innerText(), /Valley passenger express/);
  await page.locator('#route-filter-status').selectOption('running');
  assert.equal(await page.locator('.route-card[data-route-id]').count(), 2);
  await page.locator('#route-filter-status').selectOption('all');
  await page.screenshot({ path: `${output}/desktop-routes.png` });

  await page.locator('#new-route-button').click();
  await page.locator('#route-form [name="mode"]').selectOption('road');
  await page.locator('[data-pick-route="from"]').click();
  await page.locator('#cancel-route-pick').click();
  await page.locator('#route-pick-banner').waitFor({ state: 'hidden' });
  await page.locator('[data-pick-route="from"]').click();
  await page.keyboard.press('Escape');
  await page.locator('#route-pick-banner').waitFor({ state: 'hidden' });
  await chooseView(page, 'routes');
  await page.evaluate(() => transport.renderer.setZoom(.5));
  await page.locator('[data-pick-route="from"]').click();
  await clickStationBadge(page, fixture.from);
  await clickStationBadge(page, fixture.to);
  await page.locator('#route-pick-banner').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(), fixture.from.id, 'Region view accepts the departure stop badge beyond its tile');
  assert.equal(await page.locator('#route-form [name="to"]').inputValue(), fixture.to.id, 'Region view accepts the arrival stop badge beyond its tile');
  await page.evaluate(() => transport.renderer.setZoom(1));
  // Show frames the whole starter route, then lights it for a few seconds.
  const starter = await page.evaluate(() => transport.game.routes[0].id);
  await page.locator(`[data-focus-route="${starter}"]`).click();
  await page.waitForFunction(() => !transport.renderer.getStats().gliding);
  assert.equal(await page.evaluate(id => {
    const route = transport.game.routes.find(route => route.id === id), rect = document.querySelector('#world').getBoundingClientRect();
    return route.stops.every(stop => { const station = transport.game.stations.find(station => station.id === stop), p = transport.renderer.worldToScreen(station.x, station.y); return p.x > 0 && p.y > 0 && p.x < rect.width && p.y < rect.height; });
  }, starter), true, 'Show fits both stops on screen');
  await page.waitForFunction(id => transport.renderer.getStats().highlightRoute === id, starter);
  await page.screenshot({ path: `${output}/desktop-show-route.png` });
  await page.waitForFunction(() => transport.renderer.getStats().highlightRoute === null, undefined, { timeout: 6000 });
  await page.evaluate(() => transport.setView('routes'));

  // Real renderer output distinguishes empty, partial and full carriers in each
  // view. The fixture has its own canvas/state and never replaces the live save.
  await page.evaluate(async () => {
    const { createRenderer } = await import('./renderer.js');
    const canvas = document.createElement('canvas'); canvas.id = 'vehicle-load-qa';
    canvas.style.cssText = 'position:fixed;left:20px;top:100px;width:900px;height:360px;z-index:1000';
    document.body.append(canvas);
    const game = { width:128, height:96, seed:1847, biome:'taiga', revision:1, industries:[], stations:[], cities:[], routes:[], vehicles:[], tiles:Array.from({length:128*96},(_,index)=>({terrain:'grass',elevation:.2,detail:'',variant:0,road:Math.floor(index/128)===32,rail:false,bridge:false,tunnel:false,building:null,zone:null})) };
    for(const [index,cargo] of ['passengers','food','timber'].entries()){
      game.routes.push({id:`indicator-${index}`,mode:'road',cargo,color:'#bd8b52'});
      game.vehicles.push({id:`vehicle-${index}`,routeId:`indicator-${index}`,x:44+index*4,y:32,angle:0,load:[24,7,0][index],capacity:24});
    }
    const renderer = createRenderer(canvas,game); renderer.focus(48,32);
    window.vehicleLoadQA={canvas,game,renderer};
  });
  for(const zoom of [.5,1,2]){
    await page.evaluate(zoom=>{vehicleLoadQA.renderer.setZoom(zoom);vehicleLoadQA.renderer.render(0,{showRoutes:false});},zoom);
    await page.waitForTimeout(80);
    const state = await page.evaluate(()=>{vehicleLoadQA.renderer.render(0,{showRoutes:false});return vehicleLoadQA.renderer.getStats().vehicleIndicators;});
    assert.deepEqual(state,{empty:1,partial:1,full:1},`${zoom}x shows all three load states`);
    await page.locator('#vehicle-load-qa').screenshot({path:`${output}/vehicle-loads-${zoom}x.png`});
  }
  const distinctLoads=await page.evaluate(()=>{
    const {renderer,game,canvas}=vehicleLoadQA;renderer.setZoom(1);
    const samples=[];for(const load of [0,7,24]){game.vehicles[1].load=load;renderer.render(0,{showRoutes:false});samples.push(canvas.toDataURL());}
    return new Set(samples).size;
  });
  assert.equal(distinctLoads,3,'empty, partial and full meters produce different rendered pixels');
  await page.evaluate(()=>{vehicleLoadQA.canvas.remove();delete window.vehicleLoadQA;});

  // A highlighted route is restroked at every zoom, even with route lines hidden, while other routes dim.
  // Freight flow follows the simulated day, so a paused world renders the same pixels twice.
  const highlights = await page.evaluate(async () => {
    const { createRenderer } = await import('./renderer.js');
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;left:20px;top:100px;width:900px;height:360px;z-index:1000';
    document.body.append(canvas);
    const game = { width:96, height:96, seed:1847, biome:'taiga', day:10, revision:1, industries:[], cities:[], vehicles:[], routes:[], stations:[{id:'a',name:'A',x:30,y:40,mode:'road'},{id:'b',name:'B',x:62,y:40,mode:'road'},{id:'c',name:'C',x:30,y:44,mode:'road'},{id:'d',name:'D',x:62,y:44,mode:'road'}], tiles:Array.from({length:96*96},(_,index)=>({terrain:'grass',elevation:.2,detail:'',variant:0,road:[40,44].includes(Math.floor(index/96)),rail:false,bridge:false,tunnel:false,building:null,zone:null})) };
    const line = y => Array.from({ length:33 }, (_, n) => ({ x:30 + n, y }));
    game.routes.push({ id:'lit', mode:'road', cargo:'coal', color:'#69c6bc', stops:['a','b'], path:line(40), active:true }, { id:'other', mode:'road', cargo:'passengers', color:'#efc16f', stops:['c','d'], path:line(44), active:true });
    const renderer = createRenderer(canvas, game, { layers:{ weather:false, names:false } }), scale = canvas.width / canvas.getBoundingClientRect().width;
    const sample = (y, view) => { renderer.render(1000, view); const context = canvas.getContext('2d'); return [44, 46, 48].flatMap(x => { const p = renderer.worldToScreen(x, y); return Array.from(context.getImageData(Math.round(p.x * scale), Math.round((p.y - 5) * scale), 1, Math.round(10 * scale)).data); }); };
    const distance = (a, b) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0);
    const zooms = [];
    for (const zoom of [.5, 1, 2]) {
      renderer.setZoom(zoom); renderer.focus(46, 42); for (let n = 0; n < 3; n++) renderer.render(1000, {});
      const base = { lit:sample(40, {}), other:sample(44, {}) }, lit = { lit:sample(40, { highlightRoute:'lit' }), other:sample(44, { highlightRoute:'lit' }) };
      const stats = renderer.getStats().highlightRoute, hidden = { lit:sample(40, { showRoutes:false }), other:sample(44, { showRoutes:false }) }, hiddenLit = { lit:sample(40, { showRoutes:false, highlightRoute:'lit' }), other:sample(44, { showRoutes:false, highlightRoute:'lit' }) };
      zooms.push({ zoom, stats, litChanged:distance(lit.lit, base.lit) > 0, otherDimmed:distance(lit.other, hidden.other) < distance(base.other, hidden.other), hiddenLitChanged:distance(hiddenLit.lit, hidden.lit) > 0, hiddenOtherSame:distance(hiddenLit.other, hidden.other) === 0 });
    }
    renderer.setZoom(1); renderer.focus(46, 42);
    renderer.render(1000, {}); const first = canvas.toDataURL(); renderer.render(9000, {}); const second = canvas.toDataURL();
    game.day += .05; renderer.render(9000, {}); const later = canvas.toDataURL();
    // The legacy teal line draws in its mapped Cobalt, and a stop is a roundel: a paper centre in an ink ring, with none of
    // the old lettered sign's disc, glyph or rim colours in its box.
    const { lineFor } = await import('./route-lines.js'), { COLORS } = await import('./design-tokens.js'), hex = value => '#' + value.slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
    game.routes[0].cargo = 'passengers'; renderer.render(9000, {});
    const context = canvas.getContext('2d'), at = (x, y) => Array.from(context.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data), mid = renderer.worldToScreen(46, 40);
    const legacy = { pixel:hex(at(mid.x, mid.y)), mapped:lineFor(game.routes[0]).fill, name:lineFor(game.routes[0]).name };
    renderer.focus(32, 40); renderer.render(9000, {});
    const marker = renderer.stationMarker(game.stations[0]), cx = marker.x + marker.size / 2, cy = marker.y + marker.size / 2, box = context.getImageData(Math.round(marker.x * scale), Math.round(marker.y * scale), Math.round(marker.size * scale), Math.round(marker.size * scale)).data;
    const old = ['#516d53', '#3f655a', '#376e7e', '#f0eacb', '#fbf6e3'].map(c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))), signPixels = [];
    for (let i = 0; i < box.length; i += 4) if (old.some(([r, g, b]) => Math.abs(box[i] - r) + Math.abs(box[i + 1] - g) + Math.abs(box[i + 2] - b) <= 6)) signPixels.push(hex([box[i], box[i + 1], box[i + 2]]));
    const ring = at(cx + 3.75, cy), stop = { centre:hex(at(cx, cy)), ringDark:ring[0] + ring[1] + ring[2] < 240, signPixels:signPixels.length, paper:COLORS.paper };
    canvas.remove();
    return { zooms, pausedSame:first === second, flowMoves:later !== second, line:legacy, stop };
  });
  for (const view of highlights.zooms) {
    assert.equal(view.stats, 'lit', `${view.zoom}x reports the highlighted route`);
    assert.equal(view.litChanged, true, `${view.zoom}x restrokes the highlighted route`);
    assert.equal(view.otherDimmed, true, `${view.zoom}x dims the other routes`);
    assert.equal(view.hiddenLitChanged, true, `${view.zoom}x highlights with route lines hidden`);
    assert.equal(view.hiddenOtherSame, true, `${view.zoom}x keeps hidden route lines hidden`);
  }
  assert.equal(highlights.pausedSame, true, 'two renders of a paused world are identical');
  assert.equal(highlights.flowMoves, true, 'freight flow advances with the simulated day');
  assert.equal(highlights.line.name, 'Cobalt', 'a saved #69c6bc route reads as Cobalt');
  assert.equal(highlights.line.pixel, highlights.line.mapped, `the legacy line's midpoint draws in the Cobalt fill: ${JSON.stringify(highlights.line)}`);
  assert.equal(highlights.stop.centre, highlights.stop.paper, `a stop is a roundel with a paper centre: ${JSON.stringify(highlights.stop)}`);
  assert.equal(highlights.stop.ringDark, true, 'the roundel has an ink ring');
  assert.equal(highlights.stop.signPixels, 0, 'no lettered B/T sign pixels remain');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(250);
    assert.ok((await page.locator('.topbar').boundingBox()).height <= 60, `${width}px header stays in one lane`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px page fits the screen`);
    const finances = await page.evaluate(() => {
      const game=transport.game, original={money:game.money,monthlyIncome:game.monthlyIncome,monthlyExpenses:game.monthlyExpenses};
      game.money=12345678;game.monthlyIncome=12345678;game.monthlyExpenses=0;return original;
    });
    await page.waitForFunction(() => document.querySelector('#balance').textContent.includes('M'));
    assert.equal(await page.locator('#balance').textContent(), '$12.3M', 'the cached compact formatter keeps the HUD balance');
    assert.equal(await fits(page,'.topbar'),true,`${width}px header fits a wealthy company`);
    await page.locator('#company-stats').click();
    assert.equal(await page.locator('#balance-exact').textContent(),'$12,345,678','compact money retains its exact value in company details');
    await page.locator('#company-stats').click();
    await page.evaluate(finances=>Object.assign(transport.game,finances),finances);
    await openChains(page);
    await page.locator('#chain-product').selectOption('machinery');
    assert.equal(await fits(page, '#modal'), true, `${width}px chains dialog fits`);
    assert.equal(await fits(page, '.chains-explorer'), true, `${width}px explorer contains its scrolling graph`);
    await page.locator('[data-chain-industry="steel-mill"]').click();
    assert.equal(await page.locator('[data-chain-site]').count(), steelSites.length);
    await page.screenshot({ path: `${output}/mobile-${width}-chains.png` });
    await page.keyboard.press('Escape');
    await chooseView(page, 'routes');
    assert.equal(await fits(page, '#panel-content'), true, `${width}px route panel fits`);
    await page.locator('#route-form [name="mode"]').selectOption('road');
    await page.locator('[data-cargo-choice="passengers"]').click();
    await page.locator('[data-pick-route="from"]').click();
    await page.locator('#route-pick-banner').waitFor({ state: 'visible' });
    await clickMap(page, fixture.from);
    await clickMap(page, fixture.to);
    await page.locator('#route-pick-banner').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#route-form').waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false), true, `${width}px picking returns to the route form`);
    assert.equal(await page.locator('#route-form [name="from"]').inputValue(), fixture.from.id);
    assert.equal(await page.locator('#route-form [name="to"]').inputValue(), fixture.to.id);
    await verifyConnection(page, 'connected', true);
    await page.locator('#route-connection').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => scrollY), 0, `${width}px route selection only scrolls the management panel`);
    assert.equal((await page.locator('.topbar').boundingBox()).y, 0, `${width}px header remains visible after station selection`);
    await page.screenshot({ path: `${output}/mobile-${width}-route-picker.png` });
    await page.locator('.mobile-panel-toggle').click();
  }
  assert.deepEqual(errors, [], 'no browser console or runtime errors');
  console.log(`Transport chain and network-planning checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
