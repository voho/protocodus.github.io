// Town streets in a real browser: a served flat town lays the street the simulation predicts,
// but a road stroke held over those tiles keeps them for the player, who then builds there.
// Serve the repository root first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { loadAutosaveFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-town-streets-qa';
await mkdir(output, { recursive: true });
const errors = [];

async function open(save) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  await context.addInitScript(({ key, value }) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(key, value); localStorage.setItem('transport-autosave-at', new Date().toISOString()); sessionStorage.setItem('seeded', '1'); } }, save);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await loadAutosaveFromMenu(page);
  return page;
}
const passDay = async (page, day) => { await page.evaluate(() => transport.setSpeed(1)); await page.waitForFunction(day => transport.game.day >= day + .2, day, { timeout: 60000 }); await page.evaluate(() => transport.setSpeed(0)); };
const tiles = (page, points) => page.evaluate(points => points.map(({ x, y }) => { const tile = transport.game.tiles[y * transport.game.width + x]; return { road: tile.road, publicRoad: tile.publicRoad === true }; }), points);
// Hover until the game itself reads the pointer as this tile: raised ground shifts the projection.
async function pointAt(page, target) {
  const { point, ex, ey } = await page.evaluate(({ x, y }) => {
    const rect = document.querySelector('canvas').getBoundingClientRect(), at = (px, py) => transport.renderer.worldToScreen(px, py), a = at(x, y), b = at(x + 1, y), c = at(x, y + 1), p = at(x + .5, y + .5);
    return { point: { x: p.x + rect.left, y: p.y + rect.top }, ex: { x: b.x - a.x, y: b.y - a.y }, ey: { x: c.x - a.x, y: c.y - a.y } };
  }, target);
  for (let n = 0; n < 12; n++) {
    await page.mouse.move(point.x, point.y);
    const [hx, hy] = (await page.locator('#tile-coordinates').textContent()).split(' · ')[0].split(', ').map(Number);
    if (hx === target.x && hy === target.y) return point;
    point.x += (target.x - hx) * ex.x + (target.y - hy) * ey.x; point.y += (target.x - hx) * ex.y + (target.y - hy) * ey.y;
  }
  throw new Error(`Tile ${target.x},${target.y} is not reachable on screen.`);
}

try {
  // Two flat towns and a two-bus line, as in natural-settlement.test.mjs, saved the day before their first street.
  const builder = await (await browser.newContext()).newPage();
  await builder.goto(url);
  const plan = await builder.evaluate(async () => {
    const { build, buildPath, addRoute, addRouteVehicle, tick, createGame, SAVE_KEY } = await import('./model.js'), { encodeGame } = await import('./save-codec.js');
    const line = (x1, x2, y) => Array.from({ length: x2 - x1 + 1 }, (_, index) => ({ x: x1 + index, y }));
    const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });
    for (const tile of game.tiles) { Object.assign(tile, { terrain: 'grass', detail: '', elevation: .25, publicRoad: false, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null }); delete tile.terrainObject; }
    for (const key of ['cities', 'industries', 'stations', 'routes', 'vehicles', 'zones']) game[key] = [];
    game.money = 1_000_000; game.revision++; game.networkRevision++;
    build(game, 'city', 30, 30); build(game, 'city', 56, 30);
    buildPath(game, 'road', line(24, 62, 30));
    for (const x of [30, 56]) buildPath(game, 'road', [27, 28, 29, 31, 32, 33].map(y => ({ x, y })));
    build(game, 'bus-stop', 32, 30); build(game, 'bus-stop', 54, 30);
    addRoute(game, { mode: 'road', cargo: 'passengers', stops: game.stations.map(stop => stop.id) });
    addRouteVehicle(game, game.routes[0].id);
    for (const city of game.cities) city.population = 600;
    for (let day = 0; day < 1080; day++) {
      const before = structuredClone(game);
      tick(game, 1);
      const street = game.tiles.flatMap((tile, index) => tile.road && !before.tiles[index].road ? [{ x: index % game.width, y: Math.floor(index / game.width) }] : []);
      if (street.length) return { save: { key: SAVE_KEY, value: JSON.stringify(encodeGame(before)) }, day: before.day, street };
    }
    return null;
  });
  await builder.context().close();
  assert.ok(plan && plan.street.length >= 2 && plan.street.length <= 3, 'the fixture lays a two- or three-tile street');

  // Left alone, the town lays exactly that street as a public road.
  const control = await open(plan.save);
  await passDay(control, plan.day + 1);
  assert.deepEqual(await tiles(control, plan.street), plan.street.map(() => ({ road: true, publicRoad: true })));
  await control.evaluate(({ x, y }) => { transport.renderer.focus(x, y); transport.renderer.setZoom(2); }, plan.street[0]);
  await control.waitForTimeout(800);
  await control.screenshot({ path: `${output}/town-street.png` });
  await control.context().close();

  // A road stroke held over the same tiles keeps them free while the day passes.
  const page = await open(plan.save);
  await page.evaluate(({ x, y }) => { transport.renderer.focus(x, y); transport.renderer.setZoom(2); transport.setTool('road'); }, plan.street[0]);
  await page.waitForTimeout(500);
  const ends = [await pointAt(page, plan.street[0]), await pointAt(page, plan.street.at(-1))];
  await page.mouse.move(ends[0].x, ends[0].y); await page.mouse.down();
  await page.mouse.move(ends[1].x, ends[1].y, { steps: 8 });
  await passDay(page, plan.day + 1);
  assert.deepEqual(await tiles(page, plan.street), plan.street.map(() => ({ road: false, publicRoad: false })), 'the town keeps off the stroke');
  await page.mouse.up();
  await page.waitForFunction(({ x, y }) => transport.game.tiles[y * transport.game.width + x].road, plan.street[0]);
  assert.deepEqual(await tiles(page, plan.street), plan.street.map(() => ({ road: true, publicRoad: false })), 'the player builds their own road there');
  await page.screenshot({ path: `${output}/stroke-kept.png` });
  assert.deepEqual(errors, []);
  console.log(`Town streets browser check passed · ${output}`);
} finally {
  await browser.close();
}
