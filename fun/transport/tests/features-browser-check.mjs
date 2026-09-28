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
  assert.match(await quarryPage.locator('#route-connection').textContent(), /Connected · \d+ tiles · Cargo set to Stone/);
  await quarryPage.locator('#route-forecast').waitFor({ state: 'visible' });
  const forecastLine = /^≈ \+\$[\d.,]+k? \/ month · pays back in about \d+\u00a0(months?|years)$/, forecast = await quarryPage.locator('.forecast-summary').textContent();
  assert.match(forecast, forecastLine, 'choosing the end stop forecasts the route');
  assert.equal(await quarryPage.locator('.forecast-details').evaluate(element => element.open), false, 'forecast details start folded');
  await quarryPage.waitForFunction(() => {
    const drawer = document.querySelector('#panel-content').getBoundingClientRect(), launch = document.querySelector('#route-form [type="submit"]').getBoundingClientRect();
    return launch.top >= drawer.top && launch.bottom <= drawer.bottom + 1;
  }, undefined, { timeout: 3000 });
  await quarryPage.locator('.forecast-details summary').click();
  assert.match(await quarryPage.locator('.forecast-facts').innerText(), /^Source makes ≈ [\d.]+ \/ day once served\nOne truck carries ≈ [\d.]+ \/ day\n(Room for ≈ \d+ more trucks?|One truck carries all of it)\nFull load ≈ \$[\d,]+/);
  assert.equal(await quarryPage.locator('[data-cargo-choice="stone"]').getAttribute('data-fits'), 'true');
  assert.equal(await quarryPage.locator('[data-cargo-choice="passengers"]').getAttribute('data-fits'), 'false', 'other cargo is dimmed but stays clickable');
  assert.match(await quarryPage.locator('[data-cargo-choice="passengers"]').getAttribute('title'), /different town/);
  assert.equal(await quarryPage.locator('#route-form [name="name"]').getAttribute('placeholder'), 'Stone · Stone quarry → Alderbrook', 'the default name describes the freight flow');
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
  assert.match(await quarryPage.locator('#route-connection').textContent(), /Loads at end stop/);
  assert.equal(await quarryPage.locator('.forecast-summary').textContent(), forecast, 'loading at the end stop forecasts the same flow');
  assert.equal(await quarryPage.locator('.forecast-details').evaluate(element => element.open), true, 'the details stay open across a rebuilt form');
  await quarryPage.locator('#swap-route-stops').click();
  await quarryPage.locator('#route-form button[type="submit"]').click();
  const stoneRoute = await quarryPage.evaluate(() => transport.game.routes.at(-1));
  assert.equal(stoneRoute.cargo, 'stone');
  assert.equal(stoneRoute.name, 'Stone · Stone quarry → Alderbrook', 'an empty name uses the default');
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

  // A route card buys and sells vehicles on its own service; the fleet survives an autosave reload.
  const fleetPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  watch(fleetPage);
  await fleetPage.goto(url);
  await createWorldFromMenu(fleetPage);
  await fleetPage.evaluate(() => transport.setView('routes'));
  const starterCard = fleetPage.locator('.route-card[data-route-id]').first(), fleetMoney = await fleetPage.evaluate(() => transport.game.money);
  assert.equal(await starterCard.locator('[data-sell-vehicle]').isDisabled(), true, 'the last vehicle is kept for retirement');
  await starterCard.locator('[data-add-vehicle]').click();
  assert.equal(await fleetPage.evaluate(() => transport.game.vehicles.length), 2, '+ Bus adds a second bus to the starter route');
  assert.equal(await fleetPage.evaluate(() => transport.game.money), fleetMoney - 18000, 'the bus costs its quoted price');
  assert.match(await starterCard.locator('[data-vehicle-spec]').textContent(), /^2 buses · \d+ \/ 48 loaded$/);
  assert.equal(await starterCard.locator('[data-sell-vehicle]').isDisabled(), false);
  assert.ok((await starterCard.boundingBox()).height <= 280, `390px route card stays compact: ${(await starterCard.boundingBox()).height}px`);
  assert.equal(await fits(fleetPage, '#panel-content'), true, '390px fleet controls fit the drawer');
  await starterCard.screenshot({ path: `${output}/mobile-390-fleet-card.png` });
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
  assert.match(await fleetPage.locator('#route-connection').textContent(), /Already served by Alderbrook · Pinehaven/);
  assert.equal(await fleetPage.locator('#route-form [type="submit"]').textContent(), 'Launch separate service', 'a duplicate service stays possible');
  await fleetPage.locator('#add-route-vehicle').click();
  assert.deepEqual(await fleetPage.evaluate(() => [transport.game.routes.length, transport.game.vehicles.length]), [1, 3], 'the planner adds to the existing route instead of duplicating it');
  await fleetPage.close();
  assert.deepEqual(errors, [], 'fleet controls run without console or runtime errors');
  console.log('Fleet checks passed: add and sell, price, count, retire refund, autosave reload, planner reuse, 390px card.');

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
  await namePage.locator('#route-results-count').click();
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
      assert.equal(await vehiclePage.locator('#inspector .eyebrow').textContent(), 'Bus · Gen 1');
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
  console.log('Vehicle and stop sign checks passed: badge and bus picks at 3 zooms, hidden vehicles, sign picks, Follow, Show route, touch picking.');

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
  const camera = await page.evaluate(() => transport.renderer.getCamera());
  const middle = (steel.footprint || 1) / 2;
  assert.ok(Math.abs(camera.x - (steel.x + middle) * 32) < 1 && Math.abs(camera.y - (steel.y + middle) * 32) < 1, 'Locate centers the actual instance');

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
  await chooseView(page, 'industry');
  const foodSite = await page.evaluate(() => transport.game.industries.find(industry => industry.kind === 'food-plant'));
  await page.locator(`[data-industry="${foodSite.id}"]`).click();
  assert.match(await page.locator('#inspector .industry-use').innerText(), /Towns/, 'town demand appears as an output consumer');
  const townTargets = await page.evaluate(foodSite => transport.game.cities.slice().sort((a,b) => Math.hypot(a.x-foodSite.x,a.y-foodSite.y)-Math.hypot(b.x-foodSite.x,b.y-foodSite.y)).slice(0,5).map(city=>city.id), foodSite);
  assert.deepEqual(await page.locator('#inspector [data-target-id]').evaluateAll(nodes => nodes.map(node => node.dataset.targetId)), townTargets, 'food destinations are the five nearest towns');
  assert.equal(await page.locator('#inspector [data-target-kind="city"]').count(), 5);
  await page.locator(`#inspector [data-target-id="${townTargets[0]}"]`).click();
  assert.equal(await page.locator('#inspector h3').textContent(), await page.evaluate(id => transport.game.cities.find(city => city.id === id).name, townTargets[0]), 'town destination opens town details rather than its colocated station');
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
  assert.ok(brokenAboveGap.every((value, index) => index % 4 === 3 || value > 200), 'a pale "Connection broken" pill sits above the gap');
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
    const renderer = createRenderer(canvas, game, { layers:{ lighting:false, weather:false, names:false } }), scale = canvas.width / canvas.getBoundingClientRect().width;
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
    canvas.remove();
    return { zooms, pausedSame:first === second, flowMoves:later !== second };
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
