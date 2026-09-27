// Lighting caches survive camera movement and exact dusk transitions while
// invalidating changed worlds/art and retaining every authored lamp.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const baseURL = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/lighting-cache-qa', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto(new URL('lighting-cache-qa', baseURL).href);
  const result = await page.evaluate(async () => {
    const { createLighting } = await import('./lighting.js'), { preloadHouses } = await import('./raster-houses.js');
    const { DEFAULT_LAYERS } = await import('./visibility.js');
    await preloadHouses({ biome: 'taiga', waitMs: 10000 });
    const canvas = document.querySelector('canvas'); canvas.width = 1800; canvas.height = 1200;
    const context = canvas.getContext('2d'), lighting = createLighting(), stats = () => lighting.getStats();
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const game = { width: 64, height: 64, revision: 1, seed: 1, biome: 'taiga', day: 30, tiles: Array.from({ length: 64 * 64 }, () => ({ terrain: 'grass' })), vehicles: [] };
    for (let y = 8; y < 24; y += 2) for (let x = 8; x < 24; x += 2) game.tiles[y * 64 + x].building = { kind: 'house-cheap-1', footprint: 1 };
    let phase = 0, projectionCalls = 0;
    const project = (x, y) => { projectionCalls++; return { x: (x - y) * 8 + 450 + phase, y: (x + y) * 4 + 100 + phase }; };
    const options = { game, layers: { ...DEFAULT_LAYERS, roads: false, stations: false }, camera: { zoom: .5 }, width: 900, height: 600,
      bounds: { x0: 8, y0: 8, x1: 24, y1: 24 }, industryIndex: new Map(), stationIndex: new Map(), routesById: new Map(),
      project, projectBuilding: project, projectVehicle: project, projected: true, dpr: 2, artRevision: 'fixture:1' };
    const draw = () => { context.setTransform(2, 0, 0, 2, 0, 0); context.fillStyle = '#819676'; context.fillRect(0, 0, 900, 600); lighting(context, options); };
    draw(); const first = stats();
    check(projectionCalls === 64, 'Only the 64 building emitters are projected; no empty tiles or repeated building centers');
    check(first.windowBuilds === 1 && first.windowPaints === 1, 'Identical buildings share one pane image');
    draw(); check(stats().emitterBuilds === first.emitterBuilds && stats().windowPaints === first.windowPaints, 'Stationary full night reuses metadata and pane pixels');
    phase = .137; draw(); check(stats().windowPaints === first.windowPaints + 1, 'Fractional camera phase is repainted once per building type');
    game.day = 17.123; draw(); let previous = stats();
    game.day += .001; draw(); check(stats().windowBuilds === previous.windowBuilds && stats().windowPaints === previous.windowPaints + 1, 'Continuous twilight repaints the exact new opacity without allocating surfaces');
    check(stats().emitterBuilds === first.emitterBuilds, 'Time and camera phase do not rebuild the sparse map index');
    options.bounds = { x0: 10, y0: 10, x1: 26, y1: 26 }; draw(); check(stats().emitterBuilds === first.emitterBuilds, 'Panning inside padded bounds reuses emitters');
    options.bounds = { x0: 30, y0: 30, x1: 46, y1: 46 }; draw(); check(stats().emitterBuilds === first.emitterBuilds + 1, 'Panning beyond the padded area refreshes emitters');
    options.bounds = { x0: 8, y0: 8, x1: 24, y1: 24 }; draw(); previous = stats();
    game.tiles[8 * 64 + 8].building.kind = 'house-normal-1'; game.revision++; draw(); check(stats().emitterBuilds === previous.emitterBuilds + 1 && stats().windowCount === 2, 'Construction revision refreshes panes and styles');
    previous = stats(); options.artRevision = 'fixture:2'; draw(); check(stats().emitterBuilds === previous.emitterBuilds + 1, 'Late artwork invalidates light anchors');
    previous = stats(); game.tiles = game.tiles.slice(); draw(); check(stats().emitterBuilds === previous.emitterBuilds + 1, 'Replaced tile data invalidates emitter metadata');
    options.layers.buildings = false; options.layers.vehicles = true; options.camera.zoom = 2;
    for (const mode of ['road', 'water']) options.routesById.set(mode, { mode });
    game.vehicles = ['road', 'water'].flatMap(mode => Array.from({ length: 8 }, (_, n) => ({ x: 14 + n / 4, y: 14, angle: n * Math.PI / 4, routeId: mode })));
    draw(); previous = stats(); draw();
    check(stats().beamBuilds === previous.beamBuilds, 'All sixteen land/ship headings stay resident together at Detail DPR2');
    check(stats().beamBytes <= stats().beamLimit && stats().windowBytes <= stats().windowLimit, 'Light texture memory is bounded');
    const final = stats(); lighting.clear(); check(stats().staticEmitters === 0, 'Changing worlds can release references to the old map immediately');
    return final;
  });
  assert.deepEqual(errors, []); console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
