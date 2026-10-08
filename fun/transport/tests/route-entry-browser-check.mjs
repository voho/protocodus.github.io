// Fresh route drafts and constructive stop prerequisites through the actual UI.
// Browser storage is isolated; the deterministic fixture starts after the menu.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-route-entry-qa';
await mkdir(output, { recursive: true });
const errors = [], results = [];
const field = (page, name) => page.locator(`#route-form [name="${name}"]`);
const state = page => page.evaluate(() => JSON.stringify({ money: transport.game.money, day: transport.game.day, revision: transport.game.revision, stations: transport.game.stations, routes: transport.game.routes, vehicles: transport.game.vehicles }));

async function newRoute(page) {
  await page.evaluate(() => { transport.setTool('inspect'); transport.setView('routes'); });
  await page.locator('#new-route-button').click();
  await page.locator('#route-form').waitFor({ state: 'visible' });
}

async function stationRoute(page, station) {
  await page.evaluate(station => { transport.setTool('inspect'); transport.inspect(station.x, station.y); }, station);
  await page.locator('#station-route').click();
  await page.locator('#route-form').waitFor({ state: 'visible' });
}

async function stations(page, keys) {
  await page.evaluate(keys => {
    const g = transport.game;
    g.stations = keys.map(key => routeEntryQA.stops[key]);
    g.revision++; g.networkRevision++;
  }, keys);
}

async function chooseStops(page, from, to) {
  await field(page, 'from').selectOption(from.id);
  await field(page, 'to').selectOption(to.id);
  await page.locator('#route-cargo-step').waitFor({ state: 'visible' });
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/');
  await createWorldFromMenu(page, { generationVersion: 10 });
  await page.evaluate(() => document.querySelector('#dismiss-objective')?.click());
  const fixture = await page.evaluate(async () => {
    const { build, buildPath, validateGame } = await import('./model.js'), g = transport.game;
    for (const tile of g.tiles) {
      Object.assign(tile, { terrain: 'grass', detail: '', elevation: .25, publicRoad: false, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null });
      delete tile.terrainObject;
    }
    for (const key of ['cities', 'industries', 'stations', 'routes', 'vehicles', 'zones', 'terrainObjects']) g[key] = [];
    const town = (id, name, x) => ({ id, name, x, y: 83, population: 600, passengers: 100, mail: 50, activity: 0, growth: 0, delivered: 0, supplies: 0, lastServiceDay: null });
    const cities = [town('entry-alpha', 'Alpha', 60), town('entry-beta', 'Beta', 100)];
    g.money = 5_000_000; g.day = g.lastDailyDay = 730; g.lastMonth = 24; g.revision++; g.networkRevision++;
    const checked = result => { if (!result.ok) throw Error(`Route entry fixture: ${result.message}`); return result; };
    checked(buildPath(g, 'road', Array.from({ length: 45 }, (_, n) => ({ x: 60 + n, y: 80 }))));
    checked(buildPath(g, 'rail', Array.from({ length: 41 }, (_, n) => ({ x: 60 + n, y: 86 }))));
    checked(build(g, 'quarry', 58, 72));
    // Seed the compact established towns after the quarry; this route-entry
    // fixture tests shared service, rather than new-site spacing.
    g.cities=cities;g.revision++;
    const stops = {};
    for (const [key, tool, x, y] of [['alpha', 'bus-stop', 60, 80], ['beta', 'bus-stop', 100, 80], ['sameTown', 'bus-stop', 62, 80], ['tooClose', 'bus-stop', 61, 80], ['railAlpha', 'train-stop', 60, 86], ['railBeta', 'train-stop', 100, 86], ['airAlpha', 'airport-x', 130, 80], ['airNear', 'airport-x', 140, 80]]) stops[key] = checked(build(g, tool, x, y)).station;
    for (let x = 60; x <= 100; x++) g.tiles[140 * g.width + x].terrain = 'water';
    stops.port = checked(build(g, 'port', 60, 140)).station;
    g.money = 5_000_000; g.revision++; g.networkRevision++;
    if (!validateGame(g)) throw Error('Route entry fixture must be save-valid.');
    window.routeEntryQA = { stops, cities: g.cities, industries: g.industries };
    transport.renderer.setGame(g); transport.renderer.setZoom(1);
    return { stops };
  });
  const { stops } = fixture;

  await newRoute(page);
  await chooseStops(page, stops.alpha, stops.beta);
  assert.match(await page.locator('#route-connection').textContent(), /Connection ready\. Choose what to carry\./);
  assert.equal(await page.locator('#route-connection').evaluate(element => getComputedStyle(element).color), await page.locator('.route-mode-note').evaluate(element => getComputedStyle(element).color), 'choosing cargo for a usable connection is ordinary guidance rather than an error');
  await page.locator('[data-cargo-choice="stone"]').click();
  await field(page, 'name').fill('Previous custom route');
  await field(page, 'vehicleCount').fill('7');
  await field(page, 'vehicleCount').dispatchEvent('change');
  await page.locator('.route-options > summary').click();
  await page.locator('[data-route-option="full-load"]').check();
  const beforeStation = await state(page);
  await stationRoute(page, stops.beta);
  assert.equal(await state(page), beforeStation, 'opening a station draft changes no world state');
  assert.equal(await field(page, 'from').inputValue(), stops.beta.id);
  assert.equal(await field(page, 'to').inputValue(), '', 'station route entry clears the previous destination');
  assert.equal(await page.locator('#route-cargo-step').isVisible(), false);
  assert.equal(await page.locator('#route-vehicles-step').isVisible(), false);
  assert.equal(await field(page, 'vehicleCount').inputValue(), '1', 'station entry resets the purchase quantity');
  assert.equal(await page.locator('[data-route-option="full-load"]').isChecked(), false, 'station entry resets the previous full-load order');
  await field(page, 'to').selectOption(stops.alpha.id);
  assert.equal(await page.locator('[data-cargo-choice][aria-pressed="true"]').count(), 0, 'a station draft still asks the player to choose cargo');
  await page.locator('[data-cargo-choice="passengers"]').click();
  const name = await field(page, 'name').inputValue();
  assert.notEqual(name, 'Previous custom route');
  for (const word of ['Alpha', 'Beta', 'Passengers']) assert.ok(name.toLowerCase().includes(word.toLowerCase()), `fresh automatic name includes ${word}`);
  await field(page, 'vehicleCount').fill('4');
  await field(page, 'vehicleCount').dispatchEvent('change');
  await newRoute(page);
  assert.equal(await field(page, 'from').inputValue(), '');
  assert.equal(await field(page, 'to').inputValue(), '');
  assert.equal(await field(page, 'vehicleCount').inputValue(), '1', 'New route starts a fresh order');
  results.push({ freshStationDraft: true, freshListDraft: true, cargoExplicit: true });

  await chooseStops(page, stops.alpha, stops.beta);
  await page.locator('[data-cargo-choice="stone"]').click();
  await field(page, 'name').fill('Keep my live draft');
  await field(page, 'name').focus();
  await field(page, 'name').evaluate(input => input.setSelectionRange(7, 7));
  const caretBefore = await field(page, 'name').evaluate(input => ({ start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection }));
  const identities = await page.locator('[data-cargo-choice]').evaluateAll(buttons => buttons.map(button => button.dataset.cargoChoice).sort());
  await page.evaluate(() => {
    // The supplier stays. Removing the receiving town changes suitability while
    // passengers, mail and stone remain the same available cargo identities.
    transport.game.cities = routeEntryQA.cities.filter(city => city.name === 'Alpha');
    transport.game.revision++;
  });
  await page.waitForFunction(() => document.querySelector('.route-unavailable-cargo')?.open);
  assert.deepEqual(await page.locator('[data-cargo-choice]').evaluateAll(buttons => buttons.map(button => button.dataset.cargoChoice).sort()), identities, 'the live update changes cargo suitability without changing cargo identities');
  assert.match(await page.locator('.route-unavailable-cargo').textContent(), /Stone[\s\S]*No cargo fits/);
  assert.equal(await page.evaluate(() => document.activeElement?.name), 'name', 'updating live cargo explanations preserves the focused name field');
  assert.equal(await field(page, 'name').inputValue(), 'Keep my live draft');
  assert.deepEqual(await field(page, 'name').evaluate(input => ({ start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection })), caretBefore, 'live explanation redraw preserves a caret in the middle of a manual name');
  await field(page, 'name').evaluate(input => input.setSelectionRange(3, 9, 'backward'));
  await page.evaluate(() => { transport.game.cities = routeEntryQA.cities; transport.game.revision++; });
  await page.waitForFunction(() => !document.querySelector('.route-unavailable-cargo'));
  assert.equal(await page.evaluate(() => document.activeElement?.name), 'name', 'restoring a viable buyer keeps focus in the draft');
  assert.deepEqual(await field(page, 'name').evaluate(input => ({ start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection })), { start: 3, end: 9, direction: 'backward' }, 'live explanation redraw preserves the range and direction of a text selection');
  await page.keyboard.insertText('X');
  assert.equal(await field(page, 'name').inputValue(), 'Keep my live draft'.slice(0, 3) + 'X' + 'Keep my live draft'.slice(9), 'typing continues at the restored selection');
  await page.evaluate(() => { routeEntryQA.nameNode = document.querySelector('#route-form [name="name"]'); transport.game.money++; transport.game.revision++; });
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => routeEntryQA.nameNode === document.querySelector('#route-form [name="name"]')), true, 'an unrelated balance update preserves the existing draft controls');
  results.push({ liveSuitability: true, sameCargoIdentities: true, focusPreserved: true, caretAndSelectionPreserved: true, unrelatedUpdateKeepsControls: true });

  async function receivingTown(present) {
    await page.evaluate(present => {
      transport.game.cities = present ? routeEntryQA.cities : routeEntryQA.cities.filter(city => city.name === 'Alpha');
      transport.game.revision++;
    }, present);
    await page.waitForFunction(present => Boolean(document.querySelector('.route-unavailable-cargo')) !== present, present);
  }
  const routeOptions = page.locator('.route-options');
  if (!await routeOptions.evaluate(details => details.open)) await routeOptions.locator(':scope > summary').click();
  await page.locator('[data-route-option="full-load"]').check();
  await page.locator('[data-route-option="full-load"]').focus();
  await receivingTown(false);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.routeOption), 'full-load', 'live invalidation preserves the focused full-load checkbox');
  assert.equal(await page.locator('[data-route-option="full-load"]').isChecked(), true, 'redrawing cargo guidance keeps the chosen full-load order');
  assert.equal(await routeOptions.evaluate(details => details.open), true, 'the checkbox remains in its open options disclosure');
  await receivingTown(true);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.routeOption), 'full-load', 'restoring the buyer keeps checkbox focus');

  await routeOptions.locator(':scope > summary').click();
  await routeOptions.locator(':scope > summary').focus();
  await receivingTown(false);
  assert.equal(await page.evaluate(() => document.activeElement?.matches('.route-options > summary')), true, 'a collapsed options summary survives the live redraw');
  assert.equal(await routeOptions.evaluate(details => details.open), false, 'a focused disclosure keeps the player’s collapsed state');
  await receivingTown(true);
  assert.equal(await page.evaluate(() => document.activeElement?.matches('.route-options > summary')), true, 'restoring suitability keeps the options-summary focus');

  const quantityBefore = Number(await field(page, 'vehicleCount').inputValue());
  await page.locator('[data-route-quantity="1"]').focus();
  await receivingTown(false);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.routeQuantity), '1', 'the quantity stepper keeps keyboard focus during invalidation');
  await receivingTown(true);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.routeQuantity), '1', 'the quantity stepper keeps focus when the buyer returns');
  await page.keyboard.press('Space');
  assert.equal(Number(await field(page, 'vehicleCount').inputValue()), quantityBefore + 1, 'the restored stepper can immediately continue buying the chosen quantity');

  await receivingTown(false);
  await page.locator('.route-unavailable-cargo > summary').focus();
  await receivingTown(true);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.cargoChoice), 'stone', 'when a focused warning disappears, focus moves to the selected cargo');
  assert.equal(await field(page, 'name').inputValue(), 'Keep my live draft'.slice(0, 3) + 'X' + 'Keep my live draft'.slice(9), 'all focused-control redraws keep the manual name');
  assert.equal(await page.locator('[data-route-option="full-load"]').isChecked(), true, 'all redraws retain the requested full-load order');
  results.push({ liveControlFocus: ['full-load checkbox', 'collapsed disclosure', 'quantity stepper'], removedWarningFallback: 'selected cargo', fullLoadOrderPreserved: true });

  for (const [mode, keys, expectedHint] of [['road', [], /Missing road included/], ['road', ['alpha'], /Missing road included/], ['rail', ['railAlpha'], /railway/], ['water', ['port'], /water beside land/], ['air', ['airAlpha'], /runway/]]) {
    await stations(page, keys);
    await newRoute(page);
    const button = page.locator(`[data-route-build-stop="${mode}"]`);
    assert.equal(await button.isVisible(), true, `${mode} missing-stop state offers the matching construction tool`);
    assert.equal(await page.locator('#route-cargo-step').isVisible(), false);
    if (keys.length) await field(page, 'from').selectOption(stops[keys[0]].id);
    assert.equal(await page.locator('[data-pick-route="to"]').isDisabled(), true, 'a map picker with no possible destination is disabled');
    if (!keys.length) assert.equal(await page.locator('[data-pick-route="from"]').isDisabled(), true);
    const before = await state(page);
    await page.screenshot({ path: `${output}/stops-needed-${mode}-${keys.length}.png` });
    await button.click();
    assert.match(await page.locator('#active-tool-hint').textContent(), expectedHint, `${mode} prerequisite starts the correct placement mode`);
    assert.equal(await state(page), before, 'choosing the suggested tool spends no funds');
    results.push({ mode, existingStops: keys.length, constructiveNextAction: true });
  }

  await stations(page, ['alpha', 'railAlpha', 'railBeta']);
  await newRoute(page);
  assert.equal(await page.locator('[data-route-build-stop]').count(), 0, 'a compatible pair already exists, so no prerequisite obscures the initial choice');
  await field(page, 'from').selectOption(stops.alpha.id);
  assert.equal(await page.locator('[data-route-build-stop="road"]').isVisible(), true, 'an incompatible rail pair does not satisfy the selected road stop');
  await stations(page, ['alpha', 'railAlpha']);
  await newRoute(page);
  await field(page, 'from').selectOption(stops.railAlpha.id);
  assert.equal(await page.locator('[data-route-build-stop="rail"]').isVisible(), true, 'mixed single stops follow the selected transport');
  for (const width of [1024, 520]) {
    await page.setViewportSize({ width, height: 760 });
    assert.equal(await page.locator('#route-form').evaluate(form => form.scrollWidth <= form.clientWidth + 1), true, 'prerequisite fits the computer panel width');
    await page.screenshot({ path: `${output}/rail-stops-needed-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  await stations(page, ['alpha', 'sameTown', 'tooClose', 'airAlpha', 'airNear']);
  await page.evaluate(() => { transport.game.industries = []; transport.game.revision++; });
  await newRoute(page);
  await chooseStops(page, stops.alpha, stops.sameTown);
  assert.doesNotMatch(await page.locator('#route-connection').textContent(), /Connection ready/, 'physically connected stops with no usable cargo keep their validation reason');
  assert.match(await page.locator('#route-connection').textContent(), /Each stop must serve a different town within 4 tiles/);
  await page.locator('[data-cargo-choice="passengers"]').click();
  assert.equal(await page.locator('.route-unavailable-cargo').evaluate(details => details.open), true, 'selecting unusable cargo makes its reason readable without hovering');
  assert.match(await page.locator('.route-unavailable-cargo').textContent(), /Each stop must serve a different town within 4 tiles/);
  await page.locator('[data-route-review-stops]').click();
  assert.equal(await field(page, 'from').isVisible(), true, 'the cargo explanation offers a direct way to revise the stops');
  await newRoute(page);
  await chooseStops(page, stops.alpha, stops.tooClose);
  assert.match(await page.locator('#route-connection').textContent(), /Stops are too close/, 'physical connectivity does not hide the minimum route distance');
  await newRoute(page);
  await chooseStops(page, stops.airAlpha, stops.airNear);
  assert.match(await page.locator('#route-connection').textContent(), /Airports must be at least/, 'physical connectivity does not hide the minimum flight distance');
  results.push({ impossibleCargoExplained: true, roadDistanceExplained: true, airDistanceExplained: true });

  await page.evaluate(async () => {
    const g = transport.game;
    g.stations = Object.values(routeEntryQA.stops); g.cities = routeEntryQA.cities; g.industries = routeEntryQA.industries; g.revision++; g.networkRevision++;
    if (!(await import('./model.js')).validateGame(g)) throw Error('Route entry checks must leave a save-valid fixture.');
  });
  assert.deepEqual(errors, [], 'route entry produces no browser errors');
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ results, errors }, null, 2));
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) if (!page.isClosed()) await page.screenshot({ path: `${output}/failure.png`, timeout: 5000 }).catch(() => {});
  await writeFile(`${output}/failure.json`, JSON.stringify({ message: error.message, results, errors }, null, 2));
  throw error;
} finally {
  await browser.close();
}
