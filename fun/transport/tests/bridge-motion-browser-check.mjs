// Follow real rendered bodies through fractional bridge positions. Centre-only
// checks miss a deck or route segment painting over a vehicle between tile centres.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-bridge-motion-qa';
await mkdir(output, { recursive: true });
const errors = [], results = [];
try {
  for (const { zoom, dpr } of [{ zoom: 2, dpr: 1 }, { zoom: 1, dpr: 2 }]) {
    const page = await browser.newPage({ viewport: { width: 800, height: 520 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/bridge-motion-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{width:800px;height:520px;display:block}</style><canvas></canvas>' }));
    await page.goto(new URL('bridge-motion-qa', base).href);
    await page.evaluate(async () => {
      const [{ createRenderer }, geometry, { placeVehicle, shownProgress }, { railConsistPoses }, art] = await Promise.all([import('./renderer.js'), import('./terrain-geometry.js'), import('./model.js'), import('./rail-consist.js'), import('./atlas-runtime.js')]);
      await art.preloadWorldArt({ waitMs: 12000 });
      window.bridgeMotionQA = { createRenderer, geometry, placeVehicle, shownProgress, railConsistPoses, canvas: document.querySelector('canvas') };
    });
    for (const mode of ['road', 'rail']) for (const axis of ['x', 'y']) for (const direction of [1, -1]) {
      const result = await page.evaluate(({ mode, axis, direction, zoom }) => {
        const q = bridgeMotionQA, width = 80, height = 80;
        const game = { width, height, seed: 1, biome: 'taiga', day: 1, revision: 1, networkRevision: 1, industries: [], cities: [], stations: [], routes: [], vehicles: [], zones: [], tiles: Array.from({ length: width * height }, (_, i) => {
          const along = axis === 'x' ? i % width : Math.floor(i / width), wet = along >= 33 && along <= 47;
          return { terrain: wet ? 'water' : 'grass', elevation: 0, detail: '', variant: 0, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null };
        }) };
        const path = Array.from({ length: 23 }, (_, i) => ({ x: axis === 'x' ? 29 + i : 40, y: axis === 'y' ? 29 + i : 40 }));
        for (const point of path) {
          const tile = game.tiles[point.y * width + point.x]; tile[mode] = true;
          if (tile.terrain === 'water') Object.assign(tile, { bridge: true, structureAxis: axis, structureLevel: 0 });
        }
        const route = { id: 'route', mode, cargo: 'grain', active: true, stops: [], path, color: '#2D5DA8', number: 1 };
        const vehicle = { id: 'carrier', routeId: route.id, progress: 0, direction, load: 10, capacity: 20, level: 1 };
        game.routes = [route]; game.vehicles = [vehicle];
        const renderer = q.createRenderer(q.canvas, game, { layers: { grid: false, names: false, industryIcons: false, trees: false, buildings: false, weather: false, vehicles: true, vehicleLoads: false, stations: false, routes: true } });
        renderer.setZoom(zoom);
        const context = q.canvas.getContext('2d'), mask = document.createElement('canvas'); mask.width = q.canvas.width; mask.height = q.canvas.height;
        const ink = mask.getContext('2d', { willReadFrequently: true }), frames = [];
        const film = document.createElement('canvas'); film.width = 960; film.height = 360; const strip = film.getContext('2d');
        let filmIndex = 0;
        // Each shore and the open deck get a fixed camera and a continuous
        // 1/8-tile sequence, including every integer, half and quarter tile.
        for (const [name, start] of [['near-bank', 31.5], ['deck', 39], ['far-bank', 46.5]]) {
          const positions = Array.from({ length: 17 }, (_, index) => start + index / 8);
          if (direction < 0) positions.reverse();
          renderer.focus(axis === 'x' ? start + 1 : 40, axis === 'y' ? start + 1 : 40);
          for (const along of positions) {
            // Sample the same physical engine positions after trains gained a
            // fixed consist that remains on the track when travel reverses.
            const max = path.length - 1, span = mode === 'rail' ? q.railConsistPoses(path, 0).engine.progress : 0;
            vehicle.progress = mode === 'rail' ? (along - 29 - span) * max / (max - span) : along - 29;
            q.placeVehicle(route, vehicle);
            const carrier = mode === 'rail' ? q.railConsistPoses(path, q.shownProgress(route, vehicle)).engine : vehicle;
            const calls = [], draw = context.drawImage;
            context.drawImage = function (image, ...args) {
              if (image.vehicleFrame) calls.push({ image, args, transform: this.getTransform(), smoothing: this.imageSmoothingEnabled, quality: this.imageSmoothingQuality, kind: image.vehicleFrame.kind });
              return draw.call(this, image, ...args);
            };
            try { renderer.render(1000, { settle: true }); } finally { context.drawImage = draw; }
            // Replay just the vehicle images onto transparency. Every opaque
            // body pixel must survive in the real scene; shadows/edge alpha
            // are intentionally excluded so terrain blending is not mistaken for clipping.
            ink.setTransform(1, 0, 0, 1, 0, 0); ink.clearRect(0, 0, mask.width, mask.height);
            let left = mask.width, right = 0, top = mask.height, bottom = 0;
            for (const call of calls) {
              ink.setTransform(call.transform); ink.imageSmoothingEnabled = call.smoothing; ink.imageSmoothingQuality = call.quality;
              ink.drawImage(call.image, ...call.args);
              const [x, y, w, h] = call.args;
              for (const [u, v] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
                const p = call.transform.transformPoint(new DOMPoint(u, v)); left = Math.min(left, p.x); right = Math.max(right, p.x); top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
              }
            }
            left = Math.max(0, Math.floor(left)); top = Math.max(0, Math.floor(top)); right = Math.min(mask.width, Math.ceil(right)); bottom = Math.min(mask.height, Math.ceil(bottom));
            let bodyPixels = 0, coveredPixels = 0;
            if (right > left && bottom > top) {
              const expected = ink.getImageData(left, top, right - left, bottom - top).data, actual = context.getImageData(left, top, right - left, bottom - top).data;
              for (let i = 0; i < expected.length; i += 4) if (expected[i + 3] >= 254) {
                bodyPixels++;
                if (Math.abs(expected[i] - actual[i]) + Math.abs(expected[i + 1] - actual[i + 1]) + Math.abs(expected[i + 2] - actual[i + 2]) > 24) coveredPixels++;
              }
            }
            const height = q.geometry.transportHeight(game, carrier.x, carrier.y, mode);
            // On these level banks the complete shore tile is a uniform grade.
            const expectedHeight = along < 32.5 ? Math.max(0, along - 31.5) : along > 47.5 ? Math.max(0, 48.5 - along) : 1;
            const p = renderer.worldToScreen(carrier.x, carrier.y); p.y += (q.geometry.surfaceHeight(game, carrier.x + .5, carrier.y + .5) - expectedHeight) * 12 * zoom;
            const sprites = calls.map(call => ({ kind: call.kind, x: call.transform.e / devicePixelRatio, y: call.transform.f / devicePixelRatio }));
            const bank = along > 31.5 && along < 32.5 ? 32 : along > 47.5 && along < 48.5 ? 48 : null;
            const rect = q.canvas.getBoundingClientRect();
            const bankPick = bank === null ? null : { expected: { x: axis === 'x' ? bank : 40, y: axis === 'y' ? bank : 40 }, picked: renderer.screenToTile(rect.left + p.x, rect.top + p.y) };
            frames.push({ name, along, height, expectedHeight, expectedAnchor: p, sprites, bodyPixels, coveredPixels, bankPick });
            if (devicePixelRatio === 1 && name === 'near-bank' && [31.75, 32, 32.25, 32.5, 32.75, 33].includes(along)) {
              const x = (filmIndex % 3) * 320, y = Math.floor(filmIndex / 3) * 180;
              strip.drawImage(q.canvas, 240, 180, 320, 160, x, y + 20, 320, 160);
              strip.fillStyle = '#f7f6ef'; strip.fillRect(x, y, 320, 20); strip.fillStyle = '#1e3228'; strip.font = '12px sans-serif';
              strip.fillText(`${mode} ${axis} ${direction > 0 ? '→' : '←'} ${along.toFixed(3)} covered:${coveredPixels}`, x + 5, y + 14); filmIndex++;
            }
          }
        }
        const feedbackPoints = [47, 48].map(along => ({ x: axis === 'x' ? along : 40, y: axis === 'y' ? along : 40 }));
        renderer.render(1000, { settle: true, constructionFeedback: [{ points: feedbackPoints, kind: 'build', alpha: 1 }] });
        const feedbackCells = renderer.getStats().constructionFeedback.cells;
        return { frames, feedbackCells, png: devicePixelRatio === 1 ? film.toDataURL('image/png') : null };
      }, { mode, axis, direction, zoom });
      if (result.png) await writeFile(`${output}/${mode}-${axis}-${direction}.png`, Buffer.from(result.png.split(',')[1], 'base64'));
      results.push({ mode, axis, direction, zoom, dpr, frames: result.frames, feedbackCells: result.feedbackCells });
      await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
      assert.equal(result.feedbackCells, 2, `${mode}/${axis}/${direction}/zoom${zoom}/DPR${dpr}: construction confirmation renders on both the lifted bank and bridge`);
      for (const frame of result.frames) {
        const label = `${mode}/${axis}/${direction}/${frame.name}/${frame.along}/zoom${zoom}/DPR${dpr}`;
        assert.equal(frame.sprites.length, mode === 'rail' ? 3 : 1, `${label}: every vehicle body is drawn`);
        assert.ok(frame.bodyPixels > 20, `${label}: actual opaque body pixels are present`);
        assert.equal(frame.coveredPixels, 0, `${label}: bridge surfaces and route lines cannot cut into an opaque vehicle body`);
        if (frame.bankPick) assert.deepEqual(frame.bankPick.picked, frame.bankPick.expected, `${label}: picking follows the lifted bank surface between tile centres`);
        assert.ok(Math.abs(frame.height - frame.expectedHeight) < 1e-8, `${label}: the shore climb spans a complete tile without a dip or step`);
        const engine = frame.sprites.find(sprite => sprite.kind === (mode === 'rail' ? 'locomotive' : 'truck'));
        assert.ok(Math.abs(engine.x - frame.expectedAnchor.x) < 1.1 && Math.abs(engine.y - frame.expectedAnchor.y) < 1.1, `${label}: the actual rendered body follows the continuous deck and ramp`);
        const depths = frame.sprites.map(sprite => sprite.x * (axis === 'x' ? 1 : -1));
        assert.ok(depths.every((value, index) => index === 0 || value >= depths[index - 1] - .01), `${label}: coaches retain their continuous depth order between tile centres`);
      }
    }
    await page.close();
  }
  assert.deepEqual(errors, [], 'continuous bridge crossings have no uncaught browser errors');
  console.log(`Bridge motion: ${results.length} mode/axis/direction/zoom/density cases, ${results.reduce((n, result) => n + result.frames.length, 0)} fractional frames passed. Evidence: ${output}`);
} finally { await browser.close(); }
