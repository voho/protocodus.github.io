// A recorded vehicle must render exactly like its historical pose, while map
// picking returns the authoritative object that inspectors and tools mutate.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-renderer-presentation';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const errors = [], results = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/renderer-presentation-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{position:absolute;inset:0;width:960px;height:640px}</style><canvas id="presented"></canvas><canvas id="reference"></canvas>' }));
    await page.goto(new URL('renderer-presentation-qa', base).href);
    const rows = await page.evaluate(async () => {
      const [{ createRenderer }, { createVehicleMotion }, { placeVehicle }, { airPath }, { DEFAULT_LAYERS }, art] = await Promise.all([import('./renderer.js'), import('./vehicle-motion.js'), import('./model.js'), import('./station-sites.js'), import('./visibility.js'), import('./atlas-runtime.js')]);
      await art.preloadWorldArt({ waitMs: 12000 });
      const canvases = ['presented', 'reference'].map(id => document.getElementById(id));
      const readers = canvases.map(() => { const canvas = document.createElement('canvas'); return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) }; });
      const layers = { ...DEFAULT_LAYERS, names: false, grid: false, industryIcons: false, deliveries: false };
      const rows = [], states = ['road', 'rail', 'water', 'airborne', 'airport-ground'];
      const pixels = index => {
        const { canvas, context } = readers[index], source = canvases[index];
        canvas.width = source.width; canvas.height = source.height; context.drawImage(source, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const makeGame = state => {
        const mode = state.startsWith('air') ? 'air' : state;
        const game = { day: 1, width: 64, height: 64, seed: 1847, biome: 'taiga', revision: 1, industries: [], stations: [], cities: [], routes: [], vehicles: [], zones: [], tiles: Array.from({ length: 64 * 64 }, () => ({ terrain: mode === 'water' ? 'water' : 'grass', elevation: 0, detail: '', variant: 0, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null })) };
        let path = Array.from({ length: 8 }, (_, i) => ({ x: 20 + i, y: 26 })).concat(Array.from({ length: 13 }, (_, i) => ({ x: 27, y: 27 + i })));
        if (mode === 'air') {
          game.stations = [{ id: 'a', name: 'A', mode: 'air', axis: 'x', x: 20, y: 24 }, { id: 'b', name: 'B', mode: 'air', axis: 'y', x: 42, y: 44 }];
          path = airPath(game, game.stations[0], game.stations[1]);
        }
        for (const p of path) { const tile = game.tiles[p.y * game.width + p.x]; tile.road = mode === 'road'; tile.rail = mode === 'rail'; }
        const route = { id: 'route', mode, cargo: mode === 'air' ? 'passengers' : 'food', color: '#bd7862', active: true, path, stops: mode === 'air' ? ['a', 'b'] : [] };
        const vehicle = { id: 'vehicle', routeId: route.id, direction: 1, tripSerial: 2, level: 1, capacity: 30, load: 18, progress: 2, dwellRemaining: 0, totalDistance: 20 };
        game.routes.push(route); game.vehicles.push(vehicle); placeVehicle(route, vehicle);
        return { game, route, vehicle };
      };
      let renderers = null;
      for (const state of states) {
        const { game, route, vehicle } = makeGame(state), motion = createVehicleMotion();
        const grounded = state === 'airport-ground', start = grounded ? 0 : state === 'airborne' ? (route.path.length - 1) * .2 : 2, end = grounded ? 0 : state === 'airborne' ? (route.path.length - 1) * .7 : 12;
        const fromDwell = grounded ? 1.55 : 0, toDwell = grounded ? .55 : 0;
        Object.assign(vehicle, { progress: start, dwellRemaining: fromDwell }); placeVehicle(route, vehicle); motion.checkpoint(vehicle, route, 0);
        Object.assign(vehicle, { progress: end, dwellRemaining: toDwell, totalDistance: 30 }); placeVehicle(route, vehicle);
        motion.segment(vehicle, route, 0, 1, start, end, fromDwell, toDwell, 20, 30); motion.captureFinal(game);
        const reference = structuredClone(game), realBefore = JSON.stringify(game);
        if (!renderers) renderers = [createRenderer(canvases[0], game, { layers, sceneryBatching: false }), createRenderer(canvases[1], reference, { layers, sceneryBatching: false })];
        else { renderers[0].setGame(game); renderers[1].setGame(reference); }
        for (const zoom of [.5, 1, 2]) for (const day of [.25, .5, .75]) {
          const expected = reference.vehicles[0], expectedRoute = reference.routes[0];
          reference.day = day; Object.assign(expected, { progress: start + (end - start) * day, dwellRemaining: fromDwell + (toDwell - fromDwell) * day, totalDistance: 20 + 10 * day }); placeVehicle(expectedRoute, expected);
          renderers[0].setPresentation(motion, day);
          // This getter is called by Follow before render, including after the
          // last frame's plane pose has already been cached.
          const follow = renderers[0].vehicleWorldPoint(vehicle), expectedFollow = renderers[1].vehicleWorldPoint(expected);
          const sameFollow = follow.x === expectedFollow.x && follow.y === expectedFollow.y;
          for (const renderer of renderers) { renderer.setZoom(zoom); renderer.focus(follow.x, follow.y); renderer.render(1000, { selectedVehicleId: vehicle.id, hoverRef: `vehicle:${vehicle.id}`, settle: true }); }
          // A second frame makes selected/hovered locator fades comparable.
          for (const renderer of renderers) renderer.render(1200, { selectedVehicleId: vehicle.id, hoverRef: `vehicle:${vehicle.id}`, settle: true });
          const a = pixels(0), b = pixels(1); let max = 0, changed = 0;
          for (let i = 0; i < a.length; i++) { const delta = Math.abs(a[i] - b[i]); max = Math.max(max, delta); if (delta) changed++; }
          const rect = canvases[0].getBoundingClientRect(); let body = false, badge = false;
          renderers[0].setLayers({ vehicleLoads: false }); renderers[0].render(1200);
          for (let y = 170; y <= 350 && !body; y += 3) for (let x = 445; x <= 515 && !body; x += 3) body = renderers[0].vehicleAt(rect.left + x, rect.top + y) === vehicle;
          renderers[0].setLayers({ vehicleLoads: true }); renderers[0].render(1200);
          for (let y = 130; y <= 320 && !badge; y += 3) for (let x = 445; x <= 515 && !badge; x += 3) {
            if (renderers[0].vehicleAt(rect.left + x, rect.top + y) !== vehicle) continue;
            renderers[0].setLayers({ vehicleLoads: false }); renderers[0].render(1200);
            badge = renderers[0].vehicleAt(rect.left + x, rect.top + y) == null;
            renderers[0].setLayers({ vehicleLoads: true }); renderers[0].render(1200);
          }
          rows.push({ state, zoom, day, sameFollow, max, changed, body, badge, unchanged: JSON.stringify(game) === realBefore, candidates: renderers[0].getStats().visibleVehicleCandidates, presentationDay: renderers[0].getStats().presentationDay });
        }
      }
      // Loading a different company drops all previous presentation state.
      const next = makeGame('road'); renderers[0].setGame(next.game); renderers[0].render(1300);
      if (renderers[0].getStats().presentationDay !== next.game.day) throw new Error('setGame did not reset presentation time');
      const near = next.vehicle, far = { ...near, id:'far', x:0, y:0 };
      next.game.vehicles.push(far);
      const selected = createVehicleMotion(); selected.setTracked([near]);
      const sampler = selected.sample; let sampled = 0;
      selected.sample = (...args) => { sampled++; return sampler(...args); };
      renderers[0].setPresentation(selected, 1); renderers[0].focus(near.x, near.y); renderers[0].render(1400);
      if (sampled !== 1) throw new Error('untracked offscreen vehicles received per-frame proxy work');
      const candidates = renderers[0].motionVehicles(0);
      if (!candidates.includes(near) || candidates.includes(far)) throw new Error('motion candidates did not follow visible authoritative vehicles');
      renderers[0].setLayers({vehicles:false});
      if (renderers[0].motionVehicles(16).length) throw new Error('hidden vehicle artwork still requests motion traces');
      return rows;
    });
    for (const row of rows) {
      const label = `${row.state} zoom ${row.zoom} day ${row.day} DPR ${dpr}`;
      assert.equal(row.sameFollow, true, `${label}: Follow uses the historical point before drawing`);
      assert.equal(row.max, 0, `${label}: historical pose has identical pixels`);
      assert.equal(row.body, true, `${label}: the body returns its authoritative identity`);
      assert.equal(row.badge, true, `${label}: the badge returns its authoritative identity`);
      assert.equal(row.unchanged, true, `${label}: drawing and sampling leave the world unchanged`);
      assert.equal(row.candidates, 1, `${label}: sampled vehicle survives culling`);
      assert.equal(row.presentationDay, row.day);
      results.push({ ...row, dpr });
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(`Renderer presentation: ${results.length} road, rail, water and air profiles passed.`);
} finally { await browser.close(); }
