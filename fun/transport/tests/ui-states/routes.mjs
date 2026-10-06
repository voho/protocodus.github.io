// Routes states over the audit's stone route: the list, room for more, a route being edited, a filled New route form,
// picking a stop on the map and the retire confirmation. Creation and editing use separate focused screens.
import { freshWorld, openView, rest, settle, stoneRoute } from './setup.mjs';
import { clearToasts } from './setup.mjs';

async function routes(page) {
  await freshWorld(page);
  const id = await stoneRoute(page);
  await openView(page, 'routes');
  return id;
}

// A paused, save-valid scene for route prerequisites: one town, a short flat
// connection and zero, one or two stops. The UI chooses the draft and cargo.
async function prerequisiteRoute(page, { mode = 'road', count = 0 } = {}) {
  await freshWorld(page);
  const stops = await page.evaluate(async ({ mode, count }) => {
    const { build, buildPath, validateGame } = await import('./model.js'), game = transport.game;
    for (const tile of game.tiles) {
      Object.assign(tile, { terrain: 'grass', detail: '', elevation: .25, publicRoad: false, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null });
      delete tile.terrainObject;
    }
    for (const key of ['cities', 'industries', 'stations', 'routes', 'vehicles', 'zones', 'terrainObjects']) game[key] = [];
    game.cities = [{ id: 'route-ui-town', name: 'Alderbrook', x: 64, y: 83, population: 600, passengers: 100, mail: 50, activity: 0, growth: 0, delivered: 0, supplies: 0, lastServiceDay: null }];
    game.money = 400_000; game.revision++; game.networkRevision++;
    const checked = result => { if (!result.ok) throw Error(`Route UI fixture: ${result.message}`); return result; };
    if (count) checked(buildPath(game, mode, Array.from({ length: 9 }, (_, n) => ({ x: 60 + n, y: 80 }))));
    for (let n = 0; n < count; n++) checked(build(game, mode === 'rail' ? 'train-stop' : 'bus-stop', 60 + n * 8, 80));
    if (!validateGame(game)) throw Error('The route prerequisite scene must be save-valid.');
    transport.renderer.setGame(game); transport.renderer.setZoom(1); transport.renderer.focus(64, 80);
    return game.stations.map(stop => String(stop.id));
  }, { mode, count });
  await page.locator('.main-nav [data-view="routes"]').click();
  await page.locator('#new-route-button').click();
  await page.locator('#route-form').waitFor({ state: 'visible' });
  return stops;
}

export const states = [
  { name: 'routes-list', async setup(page) {
    await routes(page);
    await rest(page);
    await settle(page);
  } },
  { name: 'routes-edit', async setup(page) {
    const id = await routes(page);
    await page.locator(`[data-edit-route="${id}"]`).click();
    await page.locator('#route-form').waitFor({ state: 'visible' });
    // Edit scrolls the drawer to the form smoothly, reduced motion or not: capture once it has held still for 8 frames.
    await page.evaluate(() => new Promise(resolve => { const el = document.querySelector('#panel-content'); let last = NaN, still = 0; const frame = () => { still = el.scrollTop === last ? still + 1 : 0; last = el.scrollTop; if (still < 8) requestAnimationFrame(frame); else resolve(); }; requestAnimationFrame(frame); setTimeout(resolve, 3000); }));
    await rest(page);
    await settle(page);
  } },
  { name: 'routes-new-form', async setup(page) {
    await routes(page);
    await page.locator('#new-route-button').click();
    const stop = await page.evaluate(() => String(transport.game.stations.find(station => station.x === 219 && station.y === 251).id));
    await page.locator('#route-form select[name="from"]').selectOption(stop);
    await page.locator('#route-form select[name="to"]').selectOption('station-2');
    await page.locator('[data-cargo-choice="stone"]').click();
    await page.locator('#route-form [name="vehicleCount"]').fill('2');
    await page.locator('#route-form [name="vehicleCount"]').evaluate(el => el.blur());
    await rest(page);
    await settle(page);
  } },
  { name: 'routes-choose-cargo', async setup(page) {
    await routes(page);
    await page.locator('#new-route-button').click();
    const stop = await page.evaluate(() => String(transport.game.stations.find(station => station.x === 219 && station.y === 251).id));
    await page.locator('#route-form select[name="from"]').selectOption(stop);
    await page.locator('#route-form select[name="to"]').selectOption('station-2');
    await clearToasts(page);
    await rest(page);
    await settle(page);
  } },
  { name: 'routes-no-stops', async setup(page) {
    await prerequisiteRoute(page);
    await page.locator('[data-route-build-stop="road"]').waitFor({ state: 'visible' });
    await clearToasts(page);
    await rest(page);
    await settle(page);
  } },
  { name: 'routes-one-rail-station', async setup(page) {
    const [stop] = await prerequisiteRoute(page, { mode: 'rail', count: 1 });
    await page.locator('#route-form select[name="from"]').selectOption(stop);
    await page.locator('[data-route-build-stop="rail"]').waitFor({ state: 'visible' });
    await clearToasts(page);
    await rest(page);
    await settle(page);
  } },
  { name: 'routes-unavailable-cargo', async setup(page) {
    const [from, to] = await prerequisiteRoute(page, { count: 2 });
    await page.locator('#route-form select[name="from"]').selectOption(from);
    await page.locator('#route-form select[name="to"]').selectOption(to);
    await page.locator('[data-cargo-choice="passengers"][data-fits="false"]').click();
    await page.waitForFunction(() => document.querySelector('.route-unavailable-cargo')?.open);
    await page.locator('[data-route-review-stops]').waitFor({ state: 'visible' });
    await clearToasts(page);
    await rest(page);
    await settle(page);
  } },
  { name: 'routes-picking', async setup(page) {
    await routes(page);
    await page.locator('#new-route-button').click();
    await page.locator('[data-pick-route="from"]').click();
    await page.locator('#route-pick-banner').waitFor({ state: 'visible' });
    await settle(page);
  } },
  // A quarter on, the starter bus and the stone truck have room for more: a quiet ink-2 line under each card's vehicles.
  { name: 'routes-room', async setup(page) {
    await routes(page);
    await page.evaluate(async () => { const { tick } = await import('./model.js'); for (let day = 0; day < 90; day++) tick(transport.game, 1); });
    await page.locator('.route-card-details').evaluateAll(list => list.forEach(el => el.open=true));
    const room = page.locator('[data-route-room]:not([hidden])').first();
    await room.waitFor();
    await room.evaluate(el => el.closest('.route-card').scrollIntoView({ block: 'center' }));
    await clearToasts(page);
    await rest(page);
    await settle(page);
  } },
  { name: 'routes-retire-confirm', async setup(page) {
    const id = await routes(page);
    await page.locator(`[data-remove-route="${id}"]`).click();
    await page.locator('#modal[open]').waitFor();
    await settle(page);
  } },
];
