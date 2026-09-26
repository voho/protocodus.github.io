import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { daylightAt } from '../lighting.js';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-daynight';
await mkdir(output, { recursive: true });
assert.deepEqual(daylightAt(0), { phase: 0, night: 0, dusk: 0 });
assert.deepEqual(daylightAt(60), daylightAt(0));
assert.equal(daylightAt(30).night, 1);
assert.ok(daylightAt(15).dusk > .99);
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/');
  await page.waitForFunction(() => window.transport?.renderer);
  await page.evaluate(() => { transport.setSpeed(0); transport.renderer.focus(transport.game.cities[0].x + 2, transport.game.cities[0].y + 2); document.querySelector('#objective-card').hidden = true; });
  await page.waitForTimeout(150);
  for (const zoom of [.5, 1, 2]) {
    const result = await page.evaluate(zoom => {
      const renderer = transport.renderer, game = transport.game, canvas = document.querySelector('#world'), context = canvas.getContext('2d');
      renderer.setZoom(zoom); renderer.setLayers({ lighting: true });
      const capture = day => { game.day = day; renderer.render(1000); const data = context.getImageData(0, 0, canvas.width, canvas.height).data; let hash = 2166136261, light = 0; for (let n = 0; n < data.length; n += 4) { hash = Math.imul(hash ^ data[n], 16777619); hash = Math.imul(hash ^ data[n+1], 16777619); hash = Math.imul(hash ^ data[n+2], 16777619); light += data[n] + data[n+1] + data[n+2]; } return { hash, light: light / (data.length / 4) }; };
      const day = capture(0), night = capture(30), dawn = capture(45), repeat = capture(60);
      renderer.setLayers({ lighting: false }); const disabled = capture(30);
      renderer.setLayers({ lighting: true }); capture(30);
      return { day, night, dawn, repeat, disabled, gameDay: game.day, speed: transport.speed };
    }, zoom);
    assert.ok(result.night.light < result.day.light * .85, 'night gently darkens the map');
    assert.ok(result.night.light > result.day.light * .4, 'terrain remains readable at night');
    assert.notEqual(result.dawn.hash, result.day.hash, 'dawn gives a distinct transitional light');
    assert.equal(result.repeat.hash, result.day.hash, 'one sixty-second simulation cycle returns to identical noon');
    assert.equal(result.disabled.hash, result.day.hash, 'Day/night layer off restores unlit daytime rendering exactly');
    assert.equal(result.speed, 0);
    await page.screenshot({ path: `${output}/night-zoom${zoom}.png` });
    const pausedDay = await page.evaluate(() => transport.game.day);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => transport.game.day), pausedDay, 'paused time preserves the illumination phase');
  }
  const lights = await page.evaluate(async () => {
    const { createLighting } = await import('../transport/lighting.js'), { DEFAULT_LAYERS } = await import('../transport/visibility.js');
    const surface = document.createElement('canvas'); surface.width = 160; surface.height = 160;
    const c = surface.getContext('2d'), draw = createLighting(), game = { day: 30, seed: 19, width: 5, height: 5, tiles: Array.from({ length: 25 }, () => ({ terrain: 'grass' })), vehicles: [{ routeId: 'bus', x: 3, y: 3, angle: 0 } ] };
    game.tiles[6].building = { kind: 'house' }; game.tiles[12].road = true;
    const render = flags => { c.clearRect(0, 0, 160, 160); c.fillStyle = '#668066'; c.fillRect(0, 0, 160, 160); draw(c, { game, layers: { ...DEFAULT_LAYERS, buildings: false, stations: false, roads: false, vehicles: false, ...flags }, camera: { x: 80, y: 80, zoom: 1 }, width: 160, height: 160, bounds: { x0: 0, y0: 0, x1: 5, y1: 5 }, industryIndex: new Map(), stationIndex: new Map([[18, { mode: 'water' }]]), routesById: new Map([['bus', { mode: 'road' }]]) }); let light = 0; const data = c.getImageData(0, 0, 160, 160).data; for (let i = 0; i < data.length; i += 4) light += data[i] + data[i+1] + data[i+2]; return light; };
    return { baseline: render({}), buildings: render({ buildings: true }), ports: render({ stations: true }), vehicles: render({ vehicles: true }) };
  });
  assert.ok(lights.buildings > lights.baseline && lights.ports > lights.baseline && lights.vehicles > lights.baseline, 'building, port and vehicle lights follow their own visibility layers');
  assert.deepEqual(errors, []);
  console.log('Day/night: all zooms, sixty-second cycle, pause, readable ambient light, exact opt-out, and visibility-aware building/port/vehicle lights passed.');
} finally { await browser.close(); }
