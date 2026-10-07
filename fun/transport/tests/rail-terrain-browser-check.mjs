// Railway material must remain visible through the actual terrain projection,
// including raised decks and exposed tunnel mouths in every climate.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-rail-terrain';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const errors = [], profiles = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/rail-terrain-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{display:block;width:1280px;height:900px}</style><canvas></canvas>' }));
    await page.goto(new URL('rail-terrain-qa', base).href);
    await page.evaluate(async () => {
      const { createGame, buildStructureSpan, findPath } = await import('./model.js');
      const { createRenderer } = await import('./renderer.js');
      const { preloadWorldArt, worldArtStats } = await import('./atlas-runtime.js');
      const { RAIL_PALETTE } = await import('./rail-surface-art.js');
      await preloadWorldArt({ waitMs: 30000 });
      window.railTerrainQA = { createGame, buildStructureSpan, findPath, createRenderer, worldArtStats, RAIL_PALETTE, canvas: document.querySelector('canvas') };
    });
    for (const biome of ['taiga', 'tundra', 'desert']) {
      const fixture = await page.evaluate(biome => {
        const q = railTerrainQA, game = q.createGame({ biome, size: 'compact', seed: 418 });
        for (const tile of game.tiles) {
          Object.assign(tile, { terrain: biome === 'desert' ? 'sand' : biome === 'tundra' ? 'snow' : 'grass', elevation: 2 / 7, detail: '', cleared: true, building: null, zone: null, road: false, rail: false, bridge: false, tunnel: false });
          for (const key of ['terrainObject', 'publicRoad', 'structureAxis', 'structureLevel']) delete tile[key];
        }
        for (const key of ['cities', 'industries', 'stations', 'vehicles', 'routes', 'zones', 'terrainObjects']) game[key] = [];
        game.money = 1e9;
        const tile = (x, y) => game.tiles[y * game.width + x];
        const line = (x, y, axis, count = 5) => Array.from({ length: count }, (_, i) => ({ x: x + (axis === 'x' ? i : 0), y: y + (axis === 'y' ? i : 0) }));
        const cases = [
          { name: 'Both rail axes', x: 13, y: 17, points: [...line(11, 17, 'x'), ...line(18, 14, 'y')] },
          { name: 'Elbow', x: 25, y: 16, points: [{ x: 24, y: 16 }, { x: 25, y: 16 }, { x: 25, y: 15 }] },
          { name: 'T and four-way', x: 13, y: 28, points: [...line(11, 28, 'x'), ...line(13, 26, 'y'), ...line(19, 27, 'x', 3), { x: 20, y: 26 }] },
          { name: 'Road crossing', x: 28, y: 27, points: line(26, 27, 'x') },
          { name: 'Incline', x: 23, y: 33, points: line(21, 33, 'x') },
        ];
        for (const item of cases) for (const p of item.points) tile(p.x, p.y).rail = true;
        for (const p of line(28, 25, 'y')) tile(p.x, p.y).road = true;
        for (let x = 20; x <= 26; x++) for (let y = 31; y <= 35; y++) tile(x, y).elevation = (2 + Math.min(3, Math.max(0, x - 21))) / 7;
        const structures = [];
        for (const [tool, axis, x, y] of [['railbridge', 'x', 29, 36], ['railtunnel', 'x', 31, 16], ['railbridge', 'y', 16, 29], ['railtunnel', 'y', 20, 8]]) {
          const points = line(x, y, axis), tunnel = tool.includes('tunnel');
          for (const [index, p] of points.entries()) for (let across = -3; across <= 3; across++) tile(p.x + (axis === 'y' ? across : 0), p.y + (axis === 'x' ? across : 0)).elevation = (index <= 1 || index === points.length - 1 ? 2 : tunnel ? 3 : 1) / 7;
          game.revision++;
          const result = q.buildStructureSpan(game, tool, points);
          structures.push({ tool, axis, result, connected: JSON.stringify(q.findPath(game, points[0], points.at(-1), 'rail')) === JSON.stringify(points) });
          cases.push({ name: `${tunnel ? 'Tunnel' : 'Bridge and banks'} ${axis}`, x: x + (axis === 'x' ? 2 : 0), y: y + (axis === 'y' ? 2 : 0), points });
        }
        game.revision++; game.networkRevision++;
        Object.assign(q, { game, cases, renderer: q.createRenderer(q.canvas, game, { heightStep: 18, layers: { names: false, industryIcons: false, trees: false, buildings: false, weather: false, routes: false } }) });
        q.renderer.focus(23, 23);
        return structures;
      }, biome);
      for (const structure of fixture) {
        assert.equal(structure.result.ok, true, `${biome}/${structure.tool}/${structure.axis}: ${structure.result.message}`);
        assert.equal(structure.connected, true, 'the rendered structure also carries a connected railway');
      }
      for (const zoom of [.5, 1, 2]) {
        const result = await page.evaluate(zoom => {
          const q = railTerrainQA, before = JSON.stringify(q.game), strokes = [], original = CanvasRenderingContext2D.prototype.stroke;
          CanvasRenderingContext2D.prototype.stroke = function (...args) { if (this.strokeStyle === q.RAIL_PALETTE.steel) strokes.push(this.lineWidth); return original.apply(this, args); };
          try { q.renderer.setZoom(zoom); q.renderer.render(1000, { settle: true }); } finally { CanvasRenderingContext2D.prototype.stroke = original; }
          const first = q.renderer.getStats(); q.renderer.render(1000, { settle: true });
          const warm = q.renderer.getStats(), c = q.canvas.getContext('2d');
          c.save(); c.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); c.font = '13px sans-serif'; c.lineWidth = 3; c.strokeStyle = '#f4f1e2'; c.fillStyle = '#354440';
          const visible = [];
          for (const item of q.cases) {
            const p = q.renderer.worldToScreen(item.x, item.y);
            visible.push({ name: item.name, x: p.x, y: p.y });
            c.strokeText(item.name, p.x - 25, p.y + 36 * zoom); c.fillText(item.name, p.x - 25, p.y + 36 * zoom);
          }
          c.restore();
          return { strokes: strokes.length, visible, extra: warm.composedChunks - first.composedChunks, unchanged: before === JSON.stringify(q.game), stats: warm, art: q.worldArtStats() };
        }, zoom);
        assert.ok(result.strokes > 20, 'real ground meshes and decks paint pale railway steel');
        assert.equal(result.extra, 0, 'unchanged railway surfaces reuse terrain chunks');
        assert.equal(result.unchanged, true);
        assert.deepEqual(result.art.errors, []);
        assert.ok(result.stats.cacheBytes <= result.stats.cacheLimit);
        if (zoom === 1) for (const item of result.visible) assert.ok(item.x > 24 && item.x < 1256 && item.y > 48 && item.y < 852, `${item.name}: visible in Town review`);
        profiles.push({ biome, dpr, zoom, steelStrokes: result.strokes, extra: result.extra });
        await page.locator('canvas').screenshot({ path: `${output}/${biome}-zoom${zoom}-dpr${dpr}.png` });
      }
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, profiles, output }, null, 2));
} finally { await browser.close(); }
