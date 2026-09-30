// Projection, interaction and visual coverage in isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-isometric';
await mkdir(output, { recursive: true });
const errors = [], profiles = [], interactions = [];
const watch = page => page.on('pageerror', error => errors.push(error.message));
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr });
    const page = await context.newPage(); watch(page);
    await page.route('**/isometric-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{display:block;width:1280px;height:900px}</style><canvas id="scene"></canvas>' }));
    await page.goto(new URL('isometric-qa', url).href);
    await page.evaluate(async () => {
      const { createGame } = await import('./model.js'), { createRenderer } = await import('./renderer.js');
      const { preloadWorldArt, worldArtStats } = await import('./atlas-runtime.js');
      const { preloadHouses } = await import('./raster-houses.js');
      const { surfaceHeight, HEIGHT_STEP } = await import('./terrain-geometry.js');
      await Promise.all([preloadWorldArt({ waitMs: 12000 }), preloadHouses({ waitMs: 12000 })]);
      window.isoQA = { createGame, createRenderer, worldArtStats, surfaceHeight, HEIGHT_STEP, canvas: document.querySelector('canvas') };
    });
    for (const biome of ['taiga', 'tundra', 'desert']) {
      const scenes = await page.evaluate(biome => {
        const q = isoQA, game = q.createGame({ biome, seed: 1847, size: 'square512' }); q.game = game;
        if (q.renderer) q.renderer.setGame(game); else q.renderer = q.createRenderer(q.canvas, game, { layers: { names: false, industryIcons: false, routes: false, vehicleLoads: false } });
        const best = { forest: { score: -Infinity }, coast: { score: -Infinity } };
        for (let y = 24; y < game.height - 24; y += 12) for (let x = 24; x < game.width - 24; x += 12) {
          let forest = 0, water = 0;
          for (let dy = -12; dy <= 12; dy += 3) for (let dx = -12; dx <= 12; dx += 3) {
            const t = game.tiles[(y + dy) * game.width + x + dx]; forest += t.terrain === 'forest'; water += t.terrain === 'water';
          }
          const scores = { forest: 50 - Math.abs(forest - 50) - water * .3, coast: 50 - Math.abs(water - 35) + forest * .1 };
          for (const key of Object.keys(best)) if (scores[key] > best[key].score) best[key] = { x, y, score: scores[key] };
        }
        const home = game.cities[0], industry = game.industries.find(item => item.footprint === 2) || game.industries[0];
        return [{ name: 'town', x: home.x + 3, y: home.y, zooms: [.5, 1, 2] }, ...Object.entries(best).map(([name, p]) => ({ name, ...p, zooms: [1] })), { name: 'industry', x: industry.x, y: industry.y, zooms: [1] }];
      }, biome);
      for (const scene of scenes) for (const zoom of scene.zooms) {
        const result = await page.evaluate(({ scene, zoom }) => {
          const q = isoQA, r = q.renderer; q.game.day = scene.day || 0; r.setZoom(zoom); r.focus(scene.x, scene.y);
          const rect = q.canvas.getBoundingClientRect(), p = r.worldToScreen(scene.x, scene.y), east = r.worldToScreen(scene.x + 1, scene.y), south = r.worldToScreen(scene.x, scene.y + 1);
          const height = q.surfaceHeight(q.game, scene.x + .5, scene.y + .5);
          const heightDrop = (dx,dy) => (height - q.surfaceHeight(q.game, scene.x + dx + .5, scene.y + dy + .5)) * q.HEIGHT_STEP * zoom;
          const picked = r.screenToTile(rect.left + p.x, rect.top + p.y);
          const c = q.canvas.getContext('2d'), original = c.drawImage, objectTransforms = [];
          c.drawImage = function(image, ...args) {
            if (image instanceof HTMLCanvasElement && image.width <= 128 * zoom * devicePixelRatio && image.height <= 128 * zoom * devicePixelRatio) {
              const m = this.getTransform(); objectTransforms.push({ b: m.b, c: m.c });
            }
            return original.call(this, image, ...args);
          };
          const start = performance.now(); try { r.render(0); } finally { c.drawImage = original; }
          const coldMs = performance.now() - start, before = r.getStats().composedChunks; r.render(0);
          return { picked, east: { x: east.x - p.x, y: east.y - p.y - heightDrop(1,0) }, south: { x: south.x - p.x, y: south.y - p.y - heightDrop(0,1) }, objectTransforms, coldMs, repeated: r.getStats().composedChunks - before, stats: r.getStats(), art: q.worldArtStats() };
        }, { scene, zoom });
        assert.deepEqual(result.picked, { x: scene.x, y: scene.y }, 'projected tile centers pick the same tile');
        assert.deepEqual(result.east, { x: 32 * zoom, y: 16 * zoom }, 'east follows the southeast diamond axis');
        assert.deepEqual(result.south, { x: -32 * zoom, y: 16 * zoom }, 'south follows the southwest diamond axis');
        assert.ok(result.objectTransforms.every(m => Math.abs(m.b) < 1e-8 && Math.abs(m.c) < 1e-8), 'scenery and buildings stay upright instead of inheriting the ground shear');
        if (scene.name === 'town') assert.ok(result.objectTransforms.length > 0, 'town draws upright objects');
        assert.equal(result.repeated, 0, 'warm frames reuse terrain chunks');
        assert.ok(result.stats.cacheBytes <= result.stats.cacheLimit, 'cache stays within its budget');
        assert.deepEqual(result.art.errors, []); assert.equal(result.art.ready, result.art.atlases);
        const file = `${output}/${biome}-${scene.name}-zoom${zoom}-dpr${dpr}.png`;
        await page.locator('#scene').screenshot({ path: file });
        profiles.push({ biome, scene: scene.name, zoom, dpr, coldMs: result.coldMs, cacheMiB: result.stats.cacheBytes / 1048576, file });
      }
    }
    const navigation = await page.evaluate(() => {
      const { renderer: r, canvas, game } = isoQA, rect = canvas.getBoundingClientRect(), checks = [];
      for (const zoom of [.5, 1, 2]) {
        r.setZoom(zoom); r.focus(240, 240);
        const before = r.worldToScreen(242, 241); r.pan(72, -40); const after = r.worldToScreen(242, 241);
        checks.push({ name: 'pan', zoom, x: after.x - before.x, y: after.y - before.y });
        const anchor = r.worldToScreen(242, 241); r.zoomAt(zoom === 2 ? .5 : 2, rect.left + anchor.x, rect.top + anchor.y);
        checks.push({ name: 'zoom', picked: r.screenToTile(rect.left + anchor.x, rect.top + anchor.y) });
        for (const [x, y] of [[0, 0], [game.width - 1, 0], [0, game.height - 1], [game.width - 1, game.height - 1]]) {
          r.focus(x, y); const p = r.worldToScreen(x, y); r.render(0);
          checks.push({ name: 'corner', x, y, picked: r.screenToTile(rect.left + p.x, rect.top + p.y), visible: p.x >= 0 && p.x <= rect.width && p.y >= 0 && p.y <= rect.height });
        }
      }
      return checks;
    });
    for (const check of navigation) {
      if (check.name === 'pan') assert.deepEqual([check.x, check.y], [72, -40], 'panning follows screen axes');
      if (check.name === 'zoom') assert.deepEqual(check.picked, { x: 242, y: 241 }, 'zoom keeps its projected anchor');
      if (check.name === 'corner') { assert.deepEqual(check.picked, { x: check.x, y: check.y }); assert.ok(check.visible, 'all four map corners are reachable'); }
    }
    if (dpr === 1) {
      const occlusion = await page.evaluate(() => {
        const q = isoQA, g = q.createGame({ biome: 'taiga', seed: 418, size: 'regional' });
        for (const tile of g.tiles) { delete tile.terrainObject; Object.assign(tile, { terrain: 'grass', elevation: .25, detail: '', building: null, zone: null, road: false, rail: false, bridge: false, tunnel: false }); }
        g.cities = []; g.industries = []; g.stations = []; g.routes = [{ id: 'depth-route', mode: 'road', cargo: 'passengers', color: '#a78050', path: [] }]; g.day = 0;
        q.renderer.setGame(g); q.renderer.setZoom(2); q.renderer.focus(40, 40);
        const c = q.canvas.getContext('2d'), original = c.drawImage, captures = [];
        const capture = span => {
          const order = [];
          c.drawImage = function(image, ...args) {
            // Vehicles draw from prepared canvases that name their frame.
            if (image?.vehicleFrame || image instanceof HTMLImageElement && image.src.includes('/vehicle-bus-dimetric-v2/')) order.push('vehicle');
            if (image instanceof HTMLCanvasElement && args.length === 4 && args[2] === 48 * span && args[3] === 48 * span + 12) order.push(span === 1 ? 'building' : 'industry');
            return original.call(this, image, ...args);
          };
          try { q.renderer.render(0); } finally { c.drawImage = original; }
          return order;
        };
        g.tiles[40 * g.width + 40].building = { kind: 'house-normal-1', level: 1 };
        g.vehicles = [{ routeId: 'depth-route', x: 39.8, y: 40, angle: 0, load: 0, capacity: 30 }, { routeId: 'depth-route', x: 40.2, y: 40, angle: 0, load: 0, capacity: 30 }]; g.revision++;
        captures.push(capture(1));
        g.tiles[40 * g.width + 40].building = null; g.industries = [{ id: 'depth-industry', kind: 'steel-mill', x: 40, y: 40, footprint: 2 }];
        g.vehicles = [{ routeId: 'depth-route', x: 40.6, y: 40.6, angle: 0, load: 0, capacity: 30 }, { routeId: 'depth-route', x: 41.1, y: 41.1, angle: 0, load: 0, capacity: 30 }]; g.revision++;
        captures.push(capture(2)); return captures;
      });
      assert.deepEqual(occlusion, [['vehicle', 'building', 'vehicle'], ['vehicle', 'industry', 'vehicle']], 'vehicles behind and in front of buildings and 2×2 industry sites use the same depth order');
      const huge = await page.evaluate(() => {
        const q = isoQA; q.game = q.createGame({ biome: 'taiga', seed: 418, size: 'square2048' }); q.renderer.setGame(q.game); q.renderer.setZoom(.5);
        const samples = [];
        for (const [x, y] of [[1024, 1024], [2035, 24], [26, 2021]]) {
          q.renderer.focus(x, y); q.renderer.render(0); const n = q.renderer.getStats().composedChunks; q.renderer.render(0);
          samples.push({ ...q.renderer.getStats(), repeated: q.renderer.getStats().composedChunks - n });
        }
        return { size: [q.game.width, q.game.height], samples };
      });
      assert.deepEqual(huge.size, [2048, 2048]);
      for (const sample of huge.samples) { assert.equal(sample.repeated, 0); assert.ok(sample.cacheBytes <= sample.cacheLimit); assert.ok(sample.maxSurfaceWidth <= 2048 && sample.maxSurfaceHeight <= 2048); }
    }
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } }), app = await context.newPage(); watch(app);
  await app.goto(url); await createWorldFromMenu(app);
  const site = await app.evaluate(async () => {
    const g = transport.game; let site;
    for (let y = 40; y < g.height - 40 && !site; y += 24) for (let x = 40; x < g.width - 40; x += 24) {
      if (![...g.cities, ...g.industries, ...g.stations].some(p => Math.abs(p.x - x) < 15 && Math.abs(p.y - y) < 15)) { site = { x, y }; break; }
    }
    if (!site) throw new Error('No unoccupied test site');
    const { releaseTerrainObjects } = await import('./terrain-objects.js'), cleared = [];
    for (let dy = -5; dy <= 11; dy++) for (let dx = -5; dx <= 11; dx++) cleared.push({ x: site.x + dx, y: site.y + dy });
    releaseTerrainObjects(g, cleared);
    for (let dy = -4; dy <= 10; dy++) for (let dx = -4; dx <= 10; dx++) Object.assign(g.tiles[(site.y + dy) * g.width + site.x + dx], { terrain: 'grass', elevation: 3 / 7, detail: '', road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null, publicRoad: false });
    g.money = 1000000; g.revision++; g.networkRevision++; transport.renderer.setZoom(1); transport.renderer.focus(site.x + 3, site.y + 2); return site;
  });
  async function point(x, y) { return app.evaluate(({ x, y }) => { const p = transport.renderer.worldToScreen(x, y), rect = document.querySelector('#world').getBoundingClientRect(); return { x: rect.left + p.x, y: rect.top + p.y }; }, { x, y }); }
  await app.locator('.main-nav [data-view="build"]').click(); await app.locator('[data-tool="road"]').click();
  const start = await point(site.x, site.y), end = await point(site.x + 4, site.y);
  await app.mouse.move(start.x, start.y); await app.mouse.down(); await app.mouse.move(end.x, end.y, { steps: 6 }); await app.mouse.up();
  const roads = await app.evaluate(({ x, y }) => [0, 1, 2, 3, 4].map(dx => transport.game.tiles[y * transport.game.width + x + dx].road), site);
  assert.deepEqual(roads, [true, true, true, true, true], 'a diagonal screen drag builds a straight five-tile world road');
  await app.evaluate(() => transport.setTool('raise'));
  const earth = await app.evaluate(({x,y}) => { const p=transport.renderer.gridPointToScreen(x+2,y+3),rect=document.querySelector('#world').getBoundingClientRect();return{x:rect.left+p.x,y:rect.top+p.y}; },site);
  await app.mouse.click(earth.x, earth.y);
  assert.equal(await app.evaluate(({ x, y }) => transport.game.tiles[(y + 3) * transport.game.width + x + 2].elevation, site), 4 / 7, 'earthworks target the raised grid vertex');
  await app.evaluate(() => transport.setTool('inspect')); const panBefore = await point(site.x, site.y);
  await app.mouse.move(start.x, start.y); await app.mouse.down({ button: 'middle' }); await app.mouse.move(start.x + 65, start.y + 35, { steps: 4 }); await app.mouse.up({ button: 'middle' });
  const panAfter = await point(site.x, site.y); assert.ok(Math.abs(panAfter.x - panBefore.x - 65) < 2 && Math.abs(panAfter.y - panBefore.y - 35) < 2, 'real pointer panning follows screen axes');
  const roof = await app.evaluate(({ x, y }) => {
    const g = transport.game, r = transport.renderer, canvas = document.querySelector('#world'), c = canvas.getContext('2d'), rect = canvas.getBoundingClientRect();
    const house = { x: x + 6, y: y + 6 }; g.tiles[house.y * g.width + house.x].building = { kind: 'house-normal-1', level: 1 }; g.revision++;
    r.setZoom(2); r.focus(house.x, house.y); r.setLayers({ names: false, industryIcons: false, buildings: false }); r.render(0);
    const plain = c.getImageData(0, 0, canvas.width, canvas.height).data;
    r.setLayers({ buildings: true }); r.render(0); const drawn = c.getImageData(0, 0, canvas.width, canvas.height).data, p = r.worldToScreen(house.x, house.y), scale = canvas.width / rect.width;
    for (let dy = -78; dy < -32; dy++) for (let dx = -36; dx <= 36; dx++) {
      const px = Math.round((p.x + dx) * scale), py = Math.round((p.y + dy) * scale), i = (py * canvas.width + px) * 4;
      if (Math.abs(drawn[i] - plain[i]) + Math.abs(drawn[i + 1] - plain[i + 1]) + Math.abs(drawn[i + 2] - plain[i + 2]) < 80) continue;
      const sx = rect.left + p.x + dx, sy = rect.top + p.y + dy, ground = r.screenToTile(sx, sy), inspected = r.screenToInspectTile(sx, sy);
      if (ground.x !== house.x || ground.y !== house.y) return { house, ground, inspected, x: sx, y: sy };
    }
    throw new Error('No opaque roof above the building ground tile');
  }, site);
  assert.deepEqual(roof.inspected, roof.house, 'an opaque roof selects its own building instead of the ground behind it');
  await app.mouse.click(roof.x, roof.y);
  await app.evaluate(() => transport.persist());
  const saved = await app.evaluate(() => { const g = transport.game; return { seed: g.seed, generationVersion: g.generationVersion, size: [g.width, g.height], money: g.money, stations: g.stations, routes: g.routes.map(({ pathRevision, ...route }) => route) }; });
  await app.reload(); await loadAutosaveFromMenu(app);
  const restored = await app.evaluate(() => { const g = transport.game; return { seed: g.seed, generationVersion: g.generationVersion, size: [g.width, g.height], money: g.money, stations: g.stations, routes: g.routes.map(({ pathRevision, ...route }) => route) }; });
  assert.deepEqual(restored, saved, 'projection conversion preserves saved company data');
  assert.equal(await app.evaluate(({ x, y }) => transport.game.tiles[(y + 3) * transport.game.width + x + 2].elevation, site), 4 / 7);
  await app.evaluate(() => { const city = transport.game.cities[0]; transport.renderer.setZoom(2); transport.renderer.focus(city.x + 2, city.y); });
  await app.screenshot({ path: `${output}/app-desktop.png` }); interactions.push('road drag', 'raise terrain', 'pointer pan', 'opaque roof inspection', 'local save reload');
  await openGameAction(app, 'world-button'); await app.locator('#start-world-form').waitFor(); await app.screenshot({ path: `${output}/new-world-preview.png` }); await app.keyboard.press('Escape');
  await app.setViewportSize({ width: 390, height: 844 }); await app.evaluate(() => { transport.renderer.resize(); transport.renderer.focus(transport.game.cities[0].x, transport.game.cities[0].y); });
  await app.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1);
  assert.ok(await app.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile has no horizontal overflow');
  await app.screenshot({ path: `${output}/app-mobile.png` }); await context.close();
  assert.deepEqual(errors, []);
  const report = { passed: true, profiles, interactions, errors };
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, profiles: profiles.length, interactions, output, maxColdMs: Math.max(...profiles.map(p => p.coldMs)), maxCacheMiB: Math.max(...profiles.map(p => p.cacheMiB)) }, null, 2));
} finally { await browser.close(); }
