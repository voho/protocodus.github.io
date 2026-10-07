// Sloping building sites must replay real world ground on their raised tops.
// Observe the canvases actually submitted to the renderer, then inspect their
// decoded pixels. A cache entry or a green base fill alone cannot satisfy this.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-foundation-ground';
const dprs = (process.env.TRANSPORT_DPRS || '1,2').split(',').map(Number);
const biomes = (process.env.TRANSPORT_BIOMES || 'taiga,tundra,desert').split(',');
const modes = (process.env.TRANSPORT_ART_MODES || 'loaded,native').split(',');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const results = [], errors = [];

function checkTexture(texture, label) {
  assert.ok(texture.pixels >= 100, `${label}: inspect an actual decoded surface`);
  assert.ok(texture.opaqueFraction > .98, `${label}: world ground covers the raised parcel`);
  assert.ok(texture.colours >= 10, `${label}: terrain has varied colours, not a flat foundation tint (${JSON.stringify(texture)})`);
  assert.ok(texture.dominantFraction < .65, `${label}: no single slab colour covers the parcel`);
  assert.ok(texture.grainFraction > .05, `${label}: neighbouring pixels retain terrain grain`);
}

try {
  for (const mode of modes) for (const dpr of dprs) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: dpr, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/foundation-ground-qa', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0}canvas{display:block;width:1600px;height:1000px}</style><canvas id="world"></canvas>',
    }));
    if (mode === 'native') await page.route('**/assets/**', route => route.abort());
    await page.goto(new URL('foundation-ground-qa', base).href);
    await page.evaluate(async mode => {
      const [model, render, art, houses, industries, simulation, terrain] = await Promise.all([
        import('./model.js'), import('./renderer.js'), import('./atlas-runtime.js'),
        import('./raster-houses.js'), import('./raster-industries.js'),
        import('./industry-simulation.js'), import('./terrain-geometry.js'),
      ]);
      // Native recovery is a separate browser context: no decoded image from
      // the healthy path can conceal a failed building or material request.
      await Promise.all([
        art.preloadWorldArt({ cells: [64, 128, 256, 512], waitMs: mode === 'loaded' ? 30000 : 2000 }),
        houses.preloadHouses({ cells: [64, 128, 256], waitMs: mode === 'loaded' ? 30000 : 2000 }),
      ]);
      const hash = canvas => {
        let value = 2166136261;
        for (const byte of canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) value = Math.imul(value ^ byte, 16777619);
        return value >>> 0;
      };
      const pixels = canvas => {
        const width = canvas.width, height = canvas.height;
        const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
        const colours = new Map();
        let count = 0, opaque = 0, grain = 0, pairs = 0;
        // Ignore antialiasing at the surface perimeter. Quantized colour bins
        // distinguish broad variation from a nominal one-byte colour change.
        const pad = Math.max(1, Math.floor(Math.min(width, height) * .04));
        for (let y = pad; y < height - pad; y++) for (let x = pad; x < width - pad; x++) {
          const n = (y * width + x) * 4;
          count++; if (data[n + 3] > 250) opaque++;
          const colour = `${data[n] >> 2}:${data[n + 1] >> 2}:${data[n + 2] >> 2}`;
          colours.set(colour, (colours.get(colour) || 0) + 1);
          if (x + 1 < width - pad) {
            pairs++;
            if (Math.abs(data[n] - data[n + 4]) + Math.abs(data[n + 1] - data[n + 5]) + Math.abs(data[n + 2] - data[n + 6]) >= 3) grain++;
          }
        }
        return { width, height, pixels: count, opaqueFraction: opaque / count, colours: colours.size, dominantFraction: Math.max(...colours.values()) / count, grainFraction: grain / pairs, hash: hash(canvas) };
      };
      const q = window.foundationQA = { ...model, ...render, art, houses, industries, simulation, terrain, hash, pixels, canvas: document.querySelector('#world'), capture: new Map(), current: new WeakMap(), patterns: new WeakMap(), patternPixels: new WeakMap(), active: false };
      const prototype = CanvasRenderingContext2D.prototype;
      const drawImage = prototype.drawImage, createPattern = prototype.createPattern, fillRect = prototype.fillRect;
      prototype.createPattern = function (image, ...args) {
        const pattern = createPattern.call(this, image, ...args);
        if (pattern && image?.getContext) q.patterns.set(pattern, image);
        return pattern;
      };
      prototype.drawImage = function (image, ...args) {
        // All three foundation callers submit a square ground canvas in
        // unprojected world units. Match the known fixture sites, not sprites
        // with similarly sized source cells or ordinary terrain mesh copies.
        if (q.active && image?.getContext && args.length === 4) {
          const site = q.sites.find(site => args[0] === site.x * 32 && args[1] === site.y * 32 && args[2] === site.span * 32 && args[3] === site.span * 32);
          if (site) {
            const transform = this.getTransform();
            const observation = { id: site.id, span: site.span, texture: pixels(image), projection: [transform.a, transform.b, transform.c, transform.d], image, walls: [] };
            q.capture.set(site.id, observation); q.current.set(this, observation);
          }
        }
        return drawImage.call(this, image, ...args);
      };
      prototype.fillRect = function (...args) {
        const observation = q.active && q.current.get(this), source = q.patterns.get(this.fillStyle);
        // Stone material is painted over the exposed front faces after the
        // top replay. Read the pattern's real pixels, not its fillStyle type.
        if (observation && source && args[0] === 0 && args[1] === 0 && args[2] === observation.span * 32 && args[3] > .5) {
          let texture = q.patternPixels.get(source);
          if (!texture) { texture = pixels(source); q.patternPixels.set(source, texture); }
          observation.walls.push(texture);
        }
        return fillRect.apply(this, args);
      };
      q.observe = () => {
        q.capture.clear(); q.current = new WeakMap(); q.active = true;
        try { q.renderer.render(1000, { settle: true, showGrid: false }); } finally { q.active = false; }
        return [...q.capture.values()].map(({ image, ...row }) => row);
      };
    }, mode);

    for (const biome of biomes) {
      const flat = await page.evaluate(biome => {
        const q = foundationQA, game = q.createGame({ biome, size: 'compact', seed: 924 });
        game.width = game.height = 32;
        const terrain = biome === 'desert' ? 'sand' : biome === 'tundra' ? 'snow' : 'grass';
        game.tiles = Array.from({ length: 32 * 32 }, (_, i) => ({ terrain: i % 32 >= 27 || Math.floor(i / 32) >= 26 ? 'water' : terrain, elevation: i % 32 >= 27 || Math.floor(i / 32) >= 26 ? 0 : 2 / 7, variant: i % 7, detail: '', cleared: true, building: null, zone: null, road: false, rail: false, bridge: false, tunnel: false }));
        for (const key of ['cities', 'industries', 'stations', 'routes', 'vehicles', 'zones', 'terrainObjects']) game[key] = [];
        const sites = [
          { id: 'house', x: 10, y: 10, span: 1, kind: 'house-cheap-1' },
          { id: 'town-building', x: 10, y: 14, span: biome === 'tundra' ? 2 : 1, kind: biome === 'tundra' ? 'townhall' : 'pharmacy' },
          { id: 'industry', x: 15, y: 9, span: 5, kind: biome === 'taiga' ? 'machine-works' : 'refinery' },
        ];
        for (const site of sites.slice(0, 2)) game.tiles[site.y * 32 + site.x].building = { kind: site.kind, footprint: site.span, level: 1 };
        const industry = { id: 'ground-industry', name: 'Ground manufacturing', x: 15, y: 9, kind: sites[2].kind, footprint: 5, capacity: 1, inventory: {}, activity: 0 };
        q.simulation.initializeIndustry(game, industry); game.industries.push(industry);
        // Agriculture is available in Taiga and Desert. Its raised core is
        // two tiles inside a full five-tile field and fenced parcel.
        if (biome !== 'tundra') {
          const farm = { id: 'ground-farm', name: 'Ground farm', kind: 'farm', x: 12, y: 18, footprint: 5, capacity: 1, inventory: {}, activity: 0 };
          q.simulation.initializeIndustry(game, farm); game.industries.push(farm);
          sites.push({ id: 'farm-core', x: 13, y: 19, span: 2, kind: 'farm' });
        }
        game.revision++; game.networkRevision++; game.day = 0;
        Object.assign(q, { game, sites, renderer: q.createRenderer(q.canvas, game, { heightStep: 24, zoom: 1, layers: { names: false, industryIcons: false, weather: false, trees: false, routes: false, grid: false, goal: false } }) });
        q.renderer.focus(15.5, 15.5);
        const before = JSON.stringify(game), surfaces = q.observe();
        return { surfaces, stats: q.renderer.getStats(), unchanged: before === JSON.stringify(game), sites };
      }, biome);
      assert.equal(flat.surfaces.length, 0, `${biome}/${mode}: flat sites do not gain an artificial raised surface`);
      assert.equal(flat.stats.gardenSurfaces.entries, 0, 'flat land does not allocate raised terrain images');
      assert.equal(flat.unchanged, true);
      await page.evaluate(() => {
        const q = foundationQA;
        // One raised back vertex creates a visible drop at the front edges.
        // The rest of each plot remains ordinary terrain; foundations alone
        // flatten the building plane without modifying saved elevation.
        for (const site of q.sites) q.game.tiles[site.y * 32 + site.x].elevation = 3 / 7;
        q.game.revision++; q.renderer.setGame(q.game);
      });

      // Healthy art covers every supported view. Town is sufficient to check
      // the independent failed-art recovery path without duplicating the full
      // sprite-density suite.
      for (const zoom of mode === 'loaded' ? [.5, 1, 2] : [1]) {
        const row = await page.evaluate(zoom => {
          const q = foundationQA, before = JSON.stringify(q.game), r = q.renderer;
          r.setZoom(zoom); r.focus(15.5, 15.5);
          const surfaces = q.observe(), first = r.getStats(), firstHash = q.hash(q.canvas);
          r.render(1000, { settle: true, showGrid: false });
          const warm = r.getStats(), warmHash = q.hash(q.canvas);
          r.pan(48, -24); r.render(1000, { settle: true, showGrid: false });
          r.pan(-48, 24); r.render(1000, { settle: true, showGrid: false });
          const returned = r.getStats(), returnHash = q.hash(q.canvas);
          const loaded = q.industries.hasRasterIndustry(q.sites.find(site => site.id === 'industry').kind, q.game.biome);
          const positions = q.sites.map(site => ({ id: site.id, ...r.worldToScreen(site.x + site.span / 2 - .5, site.y + site.span / 2 - .5) }));
          return { zoom, surfaces, positions, loaded, unchanged: before === JSON.stringify(q.game), firstHash, warmHash, returnHash, first: { foundationBuilds: first.foundationBuilds, composedChunks: first.composedChunks, surfaces: first.gardenSurfaces }, warm: { foundationBuilds: warm.foundationBuilds, composedChunks: warm.composedChunks, surfaces: warm.gardenSurfaces }, returned: { foundationBuilds: returned.foundationBuilds, surfaces: returned.gardenSurfaces } };
        }, zoom);
        const label = `${biome}/${mode}/zoom ${zoom}/DPR ${dpr}`;
        assert.equal(row.loaded, mode === 'loaded', `${label}: exercises the intended authored/native art path`);
        assert.deepEqual(row.surfaces.map(surface => surface.id).sort(), flat.sites.map(site => site.id).sort(), `${label}: every actual building/farm/industry caller submits textured ground`);
        for (const surface of row.surfaces) {
          checkTexture(surface.texture, `${label}/${surface.id}`);
          const [a, b, c, d] = surface.projection;
          assert.ok(a > 0 && Math.abs(b / a - .5) < 1e-6 && Math.abs(c / a + 1) < 1e-6 && Math.abs(d / a - .5) < 1e-6, `${label}/${surface.id}: the terrain surface follows the native isometric grid`);
          assert.ok(surface.walls.length > 0, `${label}/${surface.id}: exposed foundation faces keep their stone material`);
          for (const texture of surface.walls) checkTexture(texture, `${label}/${surface.id}/stone`);
        }
        assert.equal(row.unchanged, true, 'terrain replay never alters buildings, fields, elevations or the simulation');
        assert.equal(row.firstHash, row.warmHash, `${label}: warm rendering retains identical visible pixels`);
        assert.equal(row.firstHash, row.returnHash, `${label}: a pan return preserves ground and stone registration`);
        assert.equal(row.first.composedChunks, row.warm.composedChunks, 'a warm frame does not rebuild terrain');
        assert.equal(row.first.foundationBuilds, row.warm.foundationBuilds, 'a warm frame does not rebuild foundations');
        assert.equal(row.first.foundationBuilds, row.returned.foundationBuilds, 'panning reuses foundation geometry');
        assert.deepEqual(row.first.surfaces, row.warm.surfaces, 'a warm frame reuses the actual terrain image bank');
        assert.deepEqual(row.first.surfaces, row.returned.surfaces, 'panning reuses raised terrain images');
        assert.ok(row.first.surfaces.bytes <= row.first.surfaces.limit);
        if (zoom === 1) {
          for (const position of row.positions) assert.ok(position.x > 30 && position.x < 1570 && position.y > 60 && position.y < 940, `${label}/${position.id}: visible in the Town screenshot`);
          await page.locator('#world').screenshot({ path: `${output}/${biome}-${mode}-town-dpr${dpr}.png` });
        }
        results.push({ biome, mode, dpr, ...row });
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(`PASS ${results.length} real foundation-ground profiles: decoded terrain grain, stone walls, flat/slope sites, native recovery, warm/pan reuse and unchanged simulation. Screenshots: ${output}`);
} finally { await browser.close(); }
