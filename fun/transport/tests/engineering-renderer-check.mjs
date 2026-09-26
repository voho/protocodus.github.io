import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-engineering';
const baseURL = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
await mkdir(output, { recursive: true });
const errors = [], results = [];
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: dpr });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/engineering-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><style>body{margin:0}canvas{width:1200px;height:800px}</style><canvas></canvas>' }));
    await page.goto(new URL('engineering-qa', baseURL).href);
    await page.evaluate(async () => {
      const { createRenderer } = await import('./renderer.js'), { createGame } = await import('./model.js');
      const { preloadWorldArt } = await import('./atlas-runtime.js'); await preloadWorldArt({ waitMs: 12000 });
      const g = createGame({ biome: 'taiga', size: 'regional', seed: 418 });
      g.cities = []; g.industries = []; g.stations = []; g.routes = []; g.vehicles = []; g.zones = []; g.day = 0;
      for (const t of g.tiles) Object.assign(t, { terrain: 'grass', elevation: .25, detail: '', road: false, rail: false, building: null, zone: null, bridge: false, tunnel: false });
      const tile = (x, y) => g.tiles[y * g.width + x];
      // Long horizontal tunnel and a horizontal valley viaduct, then matching
      // north–south spans ensure all portal/deck orientations are exercised.
      for (let x = 36; x <= 48; x++) {
        const interior = x > 36 && x < 48;
        Object.assign(tile(x, 34), { road: true, elevation: interior ? .625 : .25, terrain: interior ? 'mountain' : 'grass' });
        Object.assign(tile(x, 41), { road: true, elevation: interior ? .0625 : .25 });
        if (interior) { Object.assign(tile(x, 34), { tunnel: true, structureLevel: 4, structureAxis: 'x' }); Object.assign(tile(x, 41), { bridge: true, structureLevel: 4, structureAxis: 'x' }); }
      }
      for (let y = 28; y <= 40; y++) {
        const interior = y > 28 && y < 40;
        Object.assign(tile(56, y), { rail: true, elevation: interior ? .625 : .25, terrain: interior ? 'mountain' : 'grass' });
        Object.assign(tile(63, y), { rail: true, elevation: interior ? .0625 : .25 });
        if (interior) { Object.assign(tile(56, y), { tunnel: true, structureLevel: 4, structureAxis: 'y' }); Object.assign(tile(63, y), { bridge: true, structureLevel: 4, structureAxis: 'y' }); }
      }
      g.revision++;
      const canvas = document.querySelector('canvas'), renderer = createRenderer(canvas, g, { layers: { names: false, industryIcons: false, trees: false, routes: false, lighting: false } });
      const hash = () => { let h = 2166136261; for (const v of canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) h = Math.imul(h ^ v, 16777619); return h >>> 0; };
      const crop = (x, y) => {
        const camera = renderer.getCamera(), scale = camera.zoom * devicePixelRatio, px = canvas.width / 2 + (x * 32 - camera.x) * scale, py = canvas.height / 2 + (y * 32 - camera.y) * scale;
        return Array.from(canvas.getContext('2d').getImageData(Math.round(px), Math.round(py), Math.round(32 * scale), Math.round(32 * scale)).data);
      };
      window.engineeringQA = { g, tile, canvas, renderer, hash, crop };
    });
    for (const zoom of [.5, 1, 2]) {
      const check = await page.evaluate(zoom => {
        const { g, tile, renderer, hash, crop } = engineeringQA;
        renderer.setZoom(zoom); renderer.focus(46, 36); renderer.setLayers({ lighting: false, trees: true }); g.day = 0; g.vehicles = []; g.routes = []; renderer.render(0);
        const underground = crop(42, 34), withRoads = hash();
        renderer.setLayers({ roads: false }); renderer.render(0); const withoutRoads = crop(42, 34); renderer.setLayers({ roads: true }); renderer.render(0);
        const restored = hash();
        const path = Array.from({ length: 13 }, (_, i) => ({ x: 36 + i, y: 34 }));
        const route = { id: 'test', mode: 'road', cargo: 'coal', color: '#aa8855', path };
        g.routes = [route]; g.vehicles = [{ routeId: route.id, x: 42, y: 34, angle: 0, capacity: 100, load: 100, progress: 6, direction: 1 }]; renderer.render(0);
        const hiddenVehicle = hash(), hiddenIndicators = renderer.getStats().vehicleIndicators;
        g.vehicles[0].x = 48; renderer.render(0); const exposedVehicle = hash(), exposedIndicators = renderer.getStats().vehicleIndicators;
        // Test train carriages individually; engine and both carriages fit underground.
        g.vehicles[0].x = 43; g.vehicles[0].progress = 7; route.mode = 'rail'; renderer.render(0); const hiddenTrain = hash();
        g.vehicles = []; renderer.setLayers({ lighting: true }); g.day = 30; renderer.render(0); const night = hash();
        g.vehicles = [{ routeId: route.id, x: 42, y: 34, angle: 0, capacity: 100, load: 100, progress: 6, direction: 1 }]; renderer.render(0); const hiddenNight = hash();
        g.vehicles = []; g.routes = []; renderer.setLayers({ lighting: false }); g.day = 0; renderer.focus(49, 36); renderer.render(0);
        const stable = renderer.getStats().composedChunks; renderer.render(0);
        return { underground, withoutRoads, withRoads, restored, hiddenVehicle, exposedVehicle, hiddenTrain, hiddenIndicators, exposedIndicators, night, hiddenNight, extra: renderer.getStats().composedChunks - stable, ...renderer.getStats() };
      }, zoom);
      assert.deepEqual(check.underground, check.withoutRoads, `tunnel middle has undisturbed ground at ${zoom}×, DPR${dpr}`);
      assert.equal(check.restored, check.withRoads, 'network visibility restores exact view');
      assert.equal(check.hiddenVehicle, check.withRoads, 'buried road vehicles are invisible');
      assert.equal(check.hiddenTrain, check.withRoads, 'buried train and carriages are invisible');
      assert.deepEqual(check.hiddenIndicators, { empty: 0, partial: 0, full: 0 });
      assert.notEqual(check.exposedVehicle, check.withRoads, 'vehicle visible on approach');
      assert.equal(check.exposedIndicators.full, 1); assert.equal(check.hiddenNight, check.night, 'underground headlights stay hidden');
      assert.equal(check.extra, 0); assert.ok(check.cacheBytes <= check.cacheLimit);
      results.push({ zoom, dpr, cacheMiB: check.cacheBytes / 1048576 });
      await page.locator('canvas').screenshot({ path: `${output}/engineering-zoom${zoom}-dpr${dpr}.png` });
    }
    const previews = await page.evaluate(() => {
      const { g, tile, canvas, renderer } = engineeringQA, c = canvas.getContext('2d'), original = c.strokeRect.bind(c), colors = [];
      c.strokeRect = (...args) => { colors.push(c.strokeStyle); original(...args); };
      const points = Array.from({ length: 13 }, (_, i) => ({ x: 36 + i, y: 41 }));
      const capture = view => { colors.length = 0; renderer.render(0, view); return [...colors]; };
      try {
        const good = capture({ tool: 'bridge', preview: points });
        tile(48, 41).elevation = 5 / 16; g.revision++;
        const bad = capture({ tool: 'bridge', preview: points });
        tile(48, 41).elevation = .25; g.revision++;
        const money = g.money; g.money = 0;
        const unaffordable = capture({ tool: 'raise', hover: { x: 49, y: 37 } });
        g.money = money;
        const terraform = capture({ tool: 'raise', hover: { x: 49, y: 37 } });
        return { good, bad, unaffordable, terraform };
      } finally { c.strokeRect = original; }
    });
    assert.deepEqual(previews.good, Array(13).fill('#f2d88d'), 'valid span preview covers every tile');
    assert.deepEqual(previews.bad, Array(13).fill('#d7725f'), 'one invalid endpoint marks the whole span invalid');
    assert.deepEqual(previews.unaffordable, ['#d7725f'], 'terrain preview reflects funds');
    assert.deepEqual(previews.terraform, ['#f4d090'], 'editable affordable terrain preview is valid');
    await context.close();
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: true, results, output }, null, 2));
} finally { await browser.close(); }
