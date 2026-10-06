// Real image decodes, native recovery, density scaling, and industry placement.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-food-industry-qa';
await mkdir(output, { recursive: true });
const results = [], errors = [];
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: dpr });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/food-industry-art-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#e7e8da;font:16px system-ui"><canvas id="world" style="width:1400px;height:900px"></canvas><p style="margin:12px 24px">Dairy farm · Vegetable farm · Orchard · Livestock farm · Dairy plant · Cannery · Meat packing plant</p></body>' }));
    await page.route('**/*.png', route => route.abort());
    await page.goto(new URL('food-industry-art-qa', base).href);
    const native = await page.evaluate(async () => {
      const art = await import('./atlas-runtime.js'), industries = await import('./raster-industries.js');
      const { createSprites, rng } = await import('./sprites.js'), { drawProcessingPlant } = await import('./processing-sprites.js');
      const model = await import('./model.js'), { createRenderer } = await import('./renderer.js'), houses = await import('./raster-houses.js');
      const hash = canvas => { let h = 2166136261; for (const b of canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) h = Math.imul(h ^ b, 16777619); return h >>> 0; };
      window.foodQA = { art, industries, createSprites, model, createRenderer, houses, hash };
      const checks = [];
      for (const biome of ['taiga', 'desert', 'tundra']) {
        const sprites = createSprites(biome, { pixelScale: devicePixelRatio });
        for (const kind of industries.FOOD_INDUSTRY_KINDS) {
          const sprite = sprites(kind, 0, 3), c = document.createElement('canvas'); c.width = 40; c.height = 40;
          checks.push({ biome, kind, drawn: drawProcessingPlant(c.getContext('2d'), kind, rng(1), biome), hash: hash(sprite), width: sprite.width, height: sprite.height });
        }
      }
      await art.preloadWorldArt({ waitMs: 1500 });
      return checks;
    });
    for (const check of native) {
      assert.equal(check.drawn, true, `${check.biome} ${check.kind} has recognizable native recovery artwork`);
      assert.equal(check.width, 96 * dpr); assert.equal(check.height, 104 * dpr);
    }
    for (const biome of ['taiga', 'desert', 'tundra']) assert.equal(new Set(native.filter(v => v.biome === biome).map(v => v.hash)).size, 7, `${biome} native sites have seven different silhouettes`);
    await page.unroute('**/*.png');
    for (const biome of ['taiga', 'desert']) {
      const checks = await page.evaluate(async biome => {
        const q = foodQA;
        await q.art.preloadWorldArt({ biome, cells: [16, 32, 64, 128, 256], retry: true, waitMs: 8000 });
        const profiles = [];
        for (const zoom of [.5, 1, 2]) {
          const density = zoom * devicePixelRatio, sprites = q.createSprites(biome, { pixelScale: density });
          for (const kind of q.industries.FOOD_INDUSTRY_KINDS) {
            const sprite = sprites(kind, 0, 3), expected = document.createElement('canvas'); expected.width = sprite.width; expected.height = sprite.height;
            const c = expected.getContext('2d'); c.scale(density, density); c.translate(0, 8);
            const drawn = q.industries.drawRasterIndustry(c, kind, biome, density, { size: 96 });
            profiles.push({ kind, zoom, density, drawn, same: q.hash(sprite) === q.hash(expected), hash: q.hash(sprite), width: sprite.width, height: sprite.height });
          }
        }
        const master = new Image(); master.src = new URL(`./assets/world/food-industry-v1/${biome}/atlas-256.png`, location.href).href; await master.decode();
        const c = document.createElement('canvas'); c.width = c.height = 768; c.getContext('2d').drawImage(master, 0, 0);
        const data = c.getContext('2d').getImageData(0, 0, 768, 768).data, alpha = [];
        for (let index = 0; index < 9; index++) {
          const ox = index % 3 * 256, oy = Math.floor(index / 3) * 256; let ink = 0, border = 0;
          for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
            const a = data[((oy + y) * 768 + ox + x) * 4 + 3]; if (a > 16) ink++;
            if ((x < 8 || x >= 248 || y < 8 || y >= 248) && a > 0) border++;
          }
          alpha.push({ index, ink, border });
        }
        return { profiles, alpha };
      }, biome);
      for (const p of checks.profiles) {
        assert.equal(p.drawn, true, `${biome} ${p.kind} decoded`); assert.equal(p.same, true, `${biome} ${p.kind} draws the same generated pixels through createSprites`);
        assert.equal(p.width, Math.round(96 * p.density)); assert.equal(p.height, Math.round(104 * p.density));
        if (p.zoom === 1) assert.notEqual(p.hash, native.find(n => n.biome === biome && n.kind === p.kind).hash, 'late generated artwork replaces the native cache entry');
      }
      for (const cell of checks.alpha) {
        assert.equal(cell.border, 0, 'isolated cell margins remain transparent');
        if (cell.index < 7) assert.ok(cell.ink > 10000, 'every generated industry has a complete detailed silhouette');
        else assert.equal(cell.ink, 0, 'unused cells stay transparent');
      }
      const world = await page.evaluate(async biome => {
        const q = foodQA, game = q.model.createGame({ biome, size: 'regional', seed: 1847 });
        for (const tile of game.tiles) {
          Object.assign(tile, { terrain: biome === 'desert' ? 'sand' : 'grass', detail: '', elevation: .25, publicRoad: false, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null }); delete tile.terrainObject;
        }
        for (const key of ['cities', 'industries', 'stations', 'routes', 'vehicles', 'zones']) game[key] = [];
        game.money = 1_000_000; game.revision++; game.networkRevision++;
        // Explicit 3×3 footprints represent existing compact saved farms.
        // Large new plots have their own field-renderer browser checks.
        const sites = q.industries.FOOD_INDUSTRY_KINDS.map((kind, index) => {
          const placed = q.model.build(game, kind, 19 + index % 3 * 8, 17 + Math.floor(index / 3) * 8);
          if (placed.ok) placed.industry.footprint = 3;
          return placed;
        });
        for (const y of [22, 30, 38]) for (let x = 16; x <= 45; x++) q.model.build(game, 'road', x, y);
        for (let y = 14; y <= 41; y++) q.model.build(game, 'road', 16, y);
        game.cities.push({ id: 'food-market', name: 'City food shops', x: 45, y: 30, population: 120, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, lastServiceDay: null });
        q.model.build(game, 'shop-grocery', 42, 28); q.model.build(game, 'shop-bakery', 43, 29);
        for (let x = 41; x <= 44; x++) q.model.build(game, 'house-cheap-1', x, 31);
        const a = q.model.build(game, 'bus-stop', 28, 30), b = q.model.build(game, 'bus-stop', 45, 30);
        const service = q.model.addRoute(game, { mode: 'road', stops: [a.station.id, b.station.id], cargo: 'food' });
        if (service.ok) {
          q.model.addRouteVehicle(game, service.route.id); q.model.addRouteVehicle(game, service.route.id);
          game.vehicles.forEach((v, i) => { v.progress = (service.route.path.length - 1) * (.22 + i * .27); q.model.placeVehicle(service.route, v); });
        }
        const canvas = document.querySelector('#world'), renderer = q.createRenderer(canvas, game, { layers: { weather: false, routes: false, names: true, industryIcons: true } });
        renderer.setZoom(1); renderer.focus(31, 26); renderer.render(0);
        await Promise.all([q.art.preloadWorldArt({ biome, retry: true, waitMs: 8000 }), q.houses.preloadHouses({ biome, retry: true, waitMs: 8000 })]); renderer.render(0);
        window.foodWorld = { game, renderer };
        return { placed: sites.every(s => s.ok), footprints: game.industries.map(s => s.footprint), vehicles: game.vehicles.length, routeMessage: service.message, width: canvas.width, height: canvas.height };
      }, biome);
      assert.equal(world.placed, true); assert.deepEqual(world.footprints, [3, 3, 3, 3, 3, 3, 3]); assert.equal(world.vehicles, 3, world.routeMessage);
      await page.locator('#world').screenshot({ path: `${output}/${biome}-farms-food-world-dpr${dpr}.png` });
      results.push({ biome, dpr, profiles: checks.profiles.length, sites: world.footprints.length, trucks: world.vehicles });
    }
    await context.close();
  }
  assert.deepEqual(errors, []); await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ profiles: results.reduce((n, r) => n + r.profiles, 0), results, errors }, null, 2));
} finally { await browser.close(); }
