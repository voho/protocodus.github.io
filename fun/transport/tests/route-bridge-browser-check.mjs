// Route ink must follow bridge decks and bank ramps without covering vehicles
// or entering static scenery caches. Both axes share the transport projection.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-route-bridge';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const errors = [], results = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/route-bridge-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{width:960px;height:640px}</style><canvas></canvas>' }));
    await page.goto(new URL('route-bridge-qa', base).href);
    await page.evaluate(async () => {
      const [{ createRenderer }, geometry, { placeVehicle }, art] = await Promise.all([import('./renderer.js'), import('./terrain-geometry.js'), import('./model.js'), import('./atlas-runtime.js')]);
      await art.preloadWorldArt({ waitMs: 12000 });
      const canvas = document.querySelector('canvas'), reader = document.createElement('canvas'), read = reader.getContext('2d', { willReadFrequently: true });
      window.bridgeRouteQA = { createRenderer, geometry, placeVehicle, canvas, reader, read, renderer: null };
    });
    for (const mode of ['road', 'rail']) for (const axis of ['x', 'y']) for (const zoom of [.5, 1, 2]) {
      const row = await page.evaluate(({ mode, axis, zoom }) => {
        const q = bridgeRouteQA, game = { day: 1, width: 64, height: 64, seed: 1847, biome: 'taiga', revision: 1, networkRevision: 1, industries: [], stations: [], cities: [], routes: [], vehicles: [], zones: [], tiles: Array.from({ length: 4096 }, () => ({ terrain: 'grass', elevation: .25, detail: '', variant: 0, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null })) };
        const point = n => axis === 'x' ? { x: n, y: 28 } : { x: 28, y: n };
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if ((axis === 'x' ? x : y) >= 25 && (axis === 'x' ? x : y) <= 29) Object.assign(game.tiles[y * 64 + x], { terrain: 'water', elevation: 0 });
        const path = Array.from({ length: 15 }, (_, i) => point(20 + i));
        for (const p of path) { const t = game.tiles[p.y * 64 + p.x]; t[mode] = true; if (t.terrain === 'water') Object.assign(t, { bridge: true, structureAxis: axis }); }
        const route = { id: 'crossing', number: 1, mode, cargo: 'passengers', color: '#2D5DA8', active: true, paused: false, path, stops: ['a', 'b'] };
        game.routes.push(route); game.stations = [{ id: 'a', name: 'A', mode, ...path[0] }, { id: 'b', name: 'B', mode, ...path.at(-1) }];
        const layers = { names: false, trees: false, buildings: false, industryIcons: false, stations: false, vehicleLoads: false, routes: true, grid: false, deliveries: false };
        if (!q.renderer) q.renderer = q.createRenderer(q.canvas, game, { layers }); else { q.renderer.setGame(game); q.renderer.setLayers(layers); }
        const r = q.renderer; r.setZoom(zoom); r.focus(27, 28); if (axis === 'y') r.focus(28, 27);
        const saved = JSON.stringify(game);
        const pixels = (view = {}) => { r.render(900, { settle: true, ...view }); q.reader.width = q.canvas.width; q.reader.height = q.canvas.height; q.read.drawImage(q.canvas, 0, 0); return q.read.getImageData(0, 0, q.reader.width, q.reader.height).data; };
        const screen = n => { const p = point(n), s = r.worldToScreen(p.x, p.y); s.y -= (q.geometry.transportHeight(game, p.x, p.y, mode) - q.geometry.surfaceHeight(game, p.x + .5, p.y + .5)) * r.getStats().heightStep * zoom; return s; };
        const blue = (data, n) => { const p = screen(n), x = Math.round(p.x * devicePixelRatio), y = Math.round(p.y * devicePixelRatio); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = ((y + dy) * q.canvas.width + x + dx) * 4; if (Math.max(Math.abs(data[i] - 45), Math.abs(data[i + 1] - 93), Math.abs(data[i + 2] - 168)) < 25) return true; } return false; };
        const samples = Array.from({ length: 41 }, (_, i) => 22 + i / 4);
        const first = pixels(), cold = samples.filter(n => blue(first, n)).length, before = r.getStats();
        const warm = pixels(), after = r.getStats(), warmCount = samples.filter(n => blue(warm, n)).length;
        r.setLayers({ routes: false }); const hidden = pixels(), hiddenCount = samples.filter(n => blue(hidden, n)).length;
        const highlighted = pixels({ highlightRoute: route.id }), highlightCount = samples.filter(n => blue(highlighted, n)).length;
        const draft = { mode, cargo: 'passengers', path, stops: ['a', 'b'] }; pixels({ draftRoutePreview: draft }); const preview = r.getStats().routePreview;
        r.setLayers({ routes: true, roads: false, rails: false }); const noNetwork = pixels(), layerCount = samples.filter(n => blue(noNetwork, n)).length;
        r.setLayers({ roads: true, rails: true });
        route.paused = true; const paused = pixels(); route.paused = false; const resumed = pixels();
        let pausedChanges = 0; for (let i = 0; i < resumed.length; i++) if (paused[i] !== resumed[i]) pausedChanges++;
        const stable = JSON.stringify(game) === saved;
        // Existing depth merging must keep a vehicle's opaque body over the crossing line.
        const vehicle = { id: 'vehicle', routeId: route.id, direction: 1, level: 1, capacity: 30, load: 0, progress: 7.4, dwellRemaining: 0, totalDistance: 0 };
        game.vehicles.push(vehicle);
        const vehicles = [];
        for (const progress of zoom === 2 ? [7, 7.05, 7.4, 7.65, 7.9] : [7.4]) {
          vehicle.progress = progress; q.placeVehicle(route, vehicle);
          r.setLayers({ routes: false }); const vehiclePlain = pixels(); r.setLayers({ routes: true }); const vehicleLine = pixels();
          let bodySamples = 0, overpainted = 0;
          for (let i = 0; i < first.length; i += 4) {
            const isLine = Math.max(Math.abs(resumed[i] - 45), Math.abs(resumed[i + 1] - 93), Math.abs(resumed[i + 2] - 168)) < 25;
            if (!isLine || Math.max(...[0, 1, 2].map(k => Math.abs(vehiclePlain[i + k] - hidden[i + k]))) < 70) continue;
            bodySamples++; if (Math.max(...[0, 1, 2].map(k => Math.abs(vehiclePlain[i + k] - vehicleLine[i + k]))) > 35) overpainted++;
          }
          vehicles.push({ progress, bodySamples, overpainted });
        }
        return { mode, axis, zoom, cold, warm: warmCount, total: samples.length, hidden: hiddenCount, highlight: highlightCount, networkHidden: layerCount, preview, cached: after.routePathBuilds === before.routePathBuilds && after.sceneBuilds === before.sceneBuilds, pausedChanges, stable, vehicles };
      }, { mode, axis, zoom });
      const label = `${mode} ${axis} zoom ${zoom} DPR ${dpr}`;
      assert.equal(row.cold, row.total, `${label}: continuous route on ground, both bank ramps and every deck tile`);
      assert.equal(row.warm, row.total, `${label}: continuous route on cached scenery`);
      assert.equal(row.hidden, 0, `${label}: hiding routes removes crossing ink`);
      assert.equal(row.highlight, row.total, `${label}: highlighted route remains visible with routes hidden`);
      assert.equal(row.networkHidden, row.total, `${label}: route visibility is independent of infrastructure layers`);
      assert.equal(row.preview.active, true); assert.equal(row.preview.segments, 14);
      assert.equal(row.cached, true, `${label}: static scene and path caches survive a warm frame`);
      assert.ok(row.pausedChanges > 0, `${label}: paused line style updates without rebuilding scenery`);
      assert.equal(row.stable, true, `${label}: rendering does not change the game`);
      // At Region size the two-pixel body edge is mostly antialiasing; Detail
      // supplies an interior mask large enough to distinguish real overpaint.
      if (zoom === 2) for (const v of row.vehicles) {
        assert.ok(v.bodySamples > 0, `${label} at ${v.progress}: crossing line intersects visible vehicle artwork`);
        assert.ok(v.overpainted / v.bodySamples < .3, `${label} at ${v.progress}: route must not cover the vehicle (${v.overpainted}/${v.bodySamples})`);
      }
      results.push({ ...row, dpr });
      if (zoom === 2) await page.locator('canvas').screenshot({ path: `${output}/${mode}-${axis}-dpr${dpr}.png` });
    }
    await page.close();
  }
  assert.deepEqual(errors, []); await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(`Route bridges: ${results.length} road/rail, axis, zoom and display-density profiles passed.`);
} finally { await browser.close(); }
