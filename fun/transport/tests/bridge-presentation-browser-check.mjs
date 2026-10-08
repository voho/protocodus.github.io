// Low riverbanks and Flat terrain view must still read as a constructed bridge.
// Actual deck projection, picking, layer visibility and warm rendering stay intact.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-bridge-presentation';
await mkdir(output, { recursive: true });
const errors = [], profiles = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/bridge-presentation-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{display:block;width:1200px;height:800px}</style><canvas></canvas>' }));
    await page.goto(new URL('bridge-presentation-qa', base).href);
    await page.evaluate(async () => {
      const [{ createRenderer }, geometry, art, { BRIDGE_ART_PALETTE }] = await Promise.all([import('./renderer.js'), import('./terrain-geometry.js'), import('./atlas-runtime.js'), import('./bridge-art.js')]);
      await art.preloadWorldArt({ waitMs: 12000 });
      const canvas = document.querySelector('canvas');
      const fixture = ({ mode, axis, raised = false, legacy = false }) => {
        const width = 80, height = 80;
        const game = { width, height, seed: 1, biome: 'taiga', day: 1, revision: 1, networkRevision: 1, industries: [], cities: [], stations: [], routes: [], vehicles: [], zones: [], tiles: Array.from({ length: width * height }, (_, i) => {
          const along = axis === 'x' ? i % width : Math.floor(i / width), wet = along >= 33 && along <= 47;
          return { terrain: wet ? 'water' : 'grass', elevation: !wet && raised ? 3 / 7 : 0, detail: '', variant: 0, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null };
        }) };
        const path = Array.from({ length: 23 }, (_, i) => ({ x: axis === 'x' ? 29 + i : 40, y: axis === 'y' ? 29 + i : 40 }));
        for (const p of path) {
          const tile = game.tiles[p.y * width + p.x]; tile[mode] = true;
          if (tile.terrain === 'water') Object.assign(tile, { bridge: true, ...legacy ? {} : { structureAxis: axis, structureLevel: raised ? 3 : 0 } });
        }
        game.routes = [{ id: 'bridge-route', mode, cargo: 'grain', active: true, stops: [], path, color: '#2D5DA8', number: 1 }];
        game.vehicles = [{ id: 'bridge-vehicle', routeId: 'bridge-route', x: 40, y: 40, angle: axis === 'x' ? 0 : Math.PI / 2, progress: 11, load: 0, capacity: 20, level: 1, direction: 1 }];
        const renderer = createRenderer(canvas, game, { layers: { grid: false, names: false, industryIcons: false, trees: false, buildings: false, weather: false, vehicles: false, stations: false, routes: false } });
        renderer.focus(40, 40);
        return { game, renderer, path, mode, axis, raised, legacy };
      };
      window.bridgePresentationQA = { fixture, geometry, canvas, palette: BRIDGE_ART_PALETTE };
    });
    for (const mode of ['road', 'rail']) for (const axis of ['x', 'y']) for (const { raised, legacy } of [{ raised: false, legacy: false }, { raised: true, legacy: false }, { raised: false, legacy: true }]) {
      await page.evaluate(options => Object.assign(bridgePresentationQA, bridgePresentationQA.fixture(options)), { mode, axis, raised, legacy });
      for (const heightStep of [0, 6, 12]) for (const zoom of [.5, 1, 2]) {
        if (legacy && (heightStep !== 12 || zoom !== 1)) continue;
        const result = await page.evaluate(({ heightStep, zoom }) => {
          const q = bridgePresentationQA, { game, renderer: r, geometry: g, canvas } = q, before = JSON.stringify(game);
          r.setTerrainHeight(heightStep); r.setZoom(zoom); r.render(1000, { settle: true }); r.render(1000, { settle: true });
          const context = canvas.getContext('2d'), image = () => context.getImageData(0, 0, canvas.width, canvas.height).data;
          const shown = image(), first = r.getStats(), rect = canvas.getBoundingClientRect();
          const picks = [35, 40, 45].map(along => {
            const x = q.axis === 'x' ? along : 40, y = q.axis === 'y' ? along : 40, p = r.worldToScreen(x, y), height = g.bridgeDeckHeight(game, x, y, q.mode);
            p.y += (g.surfaceHeight(game, x + .5, y + .5) - height) * heightStep * zoom;
            return { expected: { x, y }, picked: r.screenToTile(rect.left + p.x, rect.top + p.y), height };
          });
          r.render(1000, { settle: true });
          const warm = r.getStats(), warmPixels = image();
          const layer = q.mode === 'road' ? 'roads' : 'rails';
          r.setLayers({ [layer]: false }); r.render(1000, { settle: true }); const hidden = image();
          r.setLayers({ [layer]: true }); r.render(1000, { settle: true }); const restored = image();
          const middle = r.worldToScreen(40, 40), deckHeight = g.bridgeDeckHeight(game, 40, 40, q.mode);
          middle.y += (g.surfaceHeight(game, 40.5, 40.5) - deckHeight) * heightStep * zoom;
          const colors = [q.palette.fascia, q.palette.steel, q.palette.cap].map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
          let changed = 0, unstable = 0, unRestored = 0, raisedInk = 0;
          // The far parapet extends above the 18px-wide planar deck. Sample only
          // the middle of the span, where approaches and shore cannot contribute.
          for (let py = Math.floor((middle.y - 120 * zoom) * devicePixelRatio); py < Math.ceil((middle.y + 120 * zoom) * devicePixelRatio); py++) for (let px = Math.floor((middle.x - 130 * zoom) * devicePixelRatio); px < Math.ceil((middle.x + 130 * zoom) * devicePixelRatio); px++) {
            if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
            const dx = (px + .5) / devicePixelRatio - middle.x, dy = (py + .5) / devicePixelRatio - middle.y, across = dy - (q.axis === 'x' ? .5 : -.5) * dx;
            if (across >= -10.2 * zoom || across < -14.5 * zoom) continue;
            const index = (py * canvas.width + px) * 4;
            if (colors.some(rgb => rgb.every((value, channel) => Math.abs(value - shown[index + channel]) < 22)) && shown.slice(index, index + 3).some((value, channel) => Math.abs(value - hidden[index + channel]) > 12)) raisedInk++;
          }
          for (let i = 0; i < shown.length; i += 4) {
            if (shown[i] !== hidden[i] || shown[i + 1] !== hidden[i + 1] || shown[i + 2] !== hidden[i + 2]) changed++;
            if (shown[i] !== warmPixels[i] || shown[i + 1] !== warmPixels[i + 1] || shown[i + 2] !== warmPixels[i + 2]) unstable++;
            if (shown[i] !== restored[i] || shown[i + 1] !== restored[i + 1] || shown[i + 2] !== restored[i + 2]) unRestored++;
          }
          r.setLayers({ vehicles: true });
          let carrier = null; const draw = context.drawImage;
          context.drawImage = function (image, ...args) {
            if (image.vehicleFrame?.kind === (q.mode === 'rail' ? 'locomotive' : 'truck')) {
              const transform = this.getTransform(); carrier = { x: transform.e / devicePixelRatio, y: transform.f / devicePixelRatio };
            }
            return draw.call(this, image, ...args);
          };
          try { r.render(1000, { settle: true }); } finally { context.drawImage = draw; }
          const vehiclePoint = r.worldToScreen(40, 40);
          vehiclePoint.y += (g.surfaceHeight(game, 40.5, 40.5) - g.bridgeDeckHeight(game, 40, 40, q.mode)) * heightStep * zoom;
          const vehiclePick = r.vehicleAt(rect.left + vehiclePoint.x, rect.top + vehiclePoint.y)?.id;
          r.setLayers({ vehicles: false }); r.render(1000, { settle: true });
          return { picks, vehiclePoint, carrier, vehiclePick, raisedInk, changed, unstable, unRestored, extraChunks: warm.composedChunks - first.composedChunks, unchanged: before === JSON.stringify(game), cacheBytes: warm.cacheBytes, cacheLimit: warm.cacheLimit };
        }, { heightStep, zoom });
        const label = `${mode}/${axis}/${legacy ? 'legacy' : raised ? 'raised' : 'low-bank'}/relief${heightStep}/zoom${zoom}/DPR${dpr}`;
        for (const pick of result.picks) assert.deepEqual(pick.picked, pick.expected, `${label}: elevated deck owns its visible centre`);
        if (!raised) assert.ok(result.picks.every(pick => pick.height > 0), `${label}: a low-bank water crossing clears the water surface`);
        assert.equal(result.vehiclePick, 'bridge-vehicle', `${label}: the vehicle is selectable on the deck`);
        assert.ok(result.carrier, `${label}: the vehicle is rendered`);
        assert.ok(Math.abs(result.carrier.x - result.vehiclePoint.x) < 1.1 && Math.abs(result.carrier.y - result.vehiclePoint.y) < 1.1, `${label}: the vehicle is drawn at the same deck height as picking`);
        assert.ok(result.raisedInk > 8 * zoom * dpr, `${label}: a structural parapet is visible above the planar deck`);
        assert.ok(result.changed > 100, `${label}: bridge layer is visible`);
        assert.equal(result.unstable, 0, `${label}: paused warm frames are identical`);
        assert.equal(result.unRestored, 0, `${label}: hiding and restoring the transport layer restores the same bridge`);
        assert.equal(result.extraChunks, 0, `${label}: warm frames reuse terrain chunks`);
        assert.equal(result.unchanged, true, `${label}: presentation does not alter the world`);
        assert.ok(result.cacheBytes <= result.cacheLimit, `${label}: cache remains bounded`);
        profiles.push({ mode, axis, raised, legacy, heightStep, zoom, dpr, ...result });
        if (dpr === 1 && !legacy && !raised && heightStep === 12) await page.locator('canvas').screenshot({ path: `${output}/${mode}-${axis}-${legacy ? 'legacy' : raised ? 'raised' : 'low-bank'}-relief${heightStep}-zoom${zoom}.png` });
      }
    }
    await page.close();
  }
  assert.deepEqual(errors, [], 'bridge presentation has no uncaught browser errors');
  await writeFile(`${output}/results.json`, JSON.stringify(profiles, null, 2));
  console.log(`Bridge presentation: ${profiles.length} mode/axis/bank/relief/zoom/density profiles passed. Screenshots: ${output}`);
} finally { await browser.close(); }
