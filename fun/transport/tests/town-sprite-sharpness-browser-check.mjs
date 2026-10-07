// Prepared art is sampled once at its display density, including rounded
// fractional DPR sizes. A read-only flat scene isolates sprites from relief.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-town-sprite-sharpness';
const baseline = process.env.TRANSPORT_BLUR_BASELINE;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const errors = [], rows = [];
try {
  for (const dpr of (process.env.TRANSPORT_DPRS || '1,1.1,1.3,2').split(',').map(Number)) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    const requests = [];
    page.on('request', request => { if (/atlas(?:-\d+)?\.png$/.test(request.url())) requests.push(request.url()); });
    if (baseline) for (const name of ['renderer.js', 'atlas-runtime.js', 'raster-houses.js', 'sprites.js', 'raster-industries.js']) {
      await page.route(`**/${name}`, async route => route.fulfill({ contentType: 'application/javascript', body: await readFile(`${baseline}/${name}`, 'utf8') }));
    }
    await page.route('**/town-sharpness-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas.world{width:1200px;height:800px;position:absolute;left:0;top:0}#cached{visibility:hidden}</style><canvas id="direct" class="world"></canvas><canvas id="cached" class="world"></canvas>' }));
    await page.goto(new URL('town-sharpness-qa', base).href);
    await page.evaluate(async () => {
      const [{ createRenderer }, { createGame }, art, houses] = await Promise.all([import('./renderer.js'), import('./model.js'), import('./atlas-runtime.js'), import('./raster-houses.js')]);
      const canvases = [document.querySelector('#direct'), document.querySelector('#cached')];
      const original = CanvasRenderingContext2D.prototype.drawImage;
      window.spriteDraws = []; window.atlasDraws = [];
      CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
        const transform = this.getTransform();
        if (image instanceof HTMLImageElement && args.length === 2 && /atlas(?:-\d+)?\.png$/.test(image.src)) this.canvas.qaAtlas = { url: image.src, cell: image.naturalWidth / 3 };
        const atlasUrl = image instanceof HTMLImageElement ? image.src : image.qaAtlas?.url;
        if (atlasUrl && args.length === 8 && /atlas(?:-\d+)?\.png$/.test(atlasUrl)) {
          const entry = { url: atlasUrl, cell: args[2], needed: Math.max(args[6] * Math.abs(transform.a), args[7] * Math.abs(transform.d)) };
          atlasDraws.push(entry); this.canvas.qaAtlas = entry;
        }
        if (canvases.includes(this.canvas) && image instanceof HTMLCanvasElement && image.qaAtlas && args.length === 4) {
          const [x, y, w, h] = args;
          // Prepared billboards have these calibrated envelopes; full-view
          // shadow caches and projected terrain meshes remain separate passes.
          if (w >= 20 && w <= 361 && h / w >= .95 && h / w <= 1.4) spriteDraws.push({ canvas: this.canvas.id, x, y, w, h, sourceWidth: image.width, sourceHeight: image.height, a: transform.a, d: transform.d, e: transform.e, f: transform.f, smoothing: this.imageSmoothingEnabled, atlas: image.qaAtlas });
        }
        return original.call(this, image, ...args);
      };
      const originalGame = createGame({ biome: 'taiga', size: 'regional', seed: 418 });
      const game = { ...originalGame, tiles: originalGame.tiles.map(() => ({ terrain: 'grass', elevation: 4 / 7, detail: '', variant: 0, cleared: true })), cities: [], industries: [], stations: [], zones: [], routes: [], vehicles: [], terrainObjects: [], revision: 1, networkRevision: 1 };
      const at = (x, y) => game.tiles[y * game.width + x];
      for (let y = 35; y < 59; y += 4) for (let x = 45; x < 70; x += 4) {
        const kinds = ['house-cheap-1', 'house-normal-2', 'house-expensive-3', 'shop-pharmacy', 'town-hall', 'sports-hall'];
        const index = (y - 35) / 4 * 7 + (x - 45) / 4;
        at(x, y).building = { kind: kinds[index % kinds.length], footprint: [2, 4, 5].includes(index % kinds.length) ? 2 : 1, level: 1 };
        at(x, y).variant = index % 18;
        Object.assign(at(x + 2, y + 1), { terrain: 'forest', detail: 'mixed', variant: index % 64 });
      }
      game.industries = [{ id: 'refinery', kind: 'refinery', name: 'Refinery', x: 58, y: 44, footprint: 5, stock: {}, delivered: {}, inputs: {} }];
      for (let y = 44; y < 49; y++) for (let x = 58; x < 63; x++) Object.assign(at(x, y), { terrain: 'grass', detail: '', building: null });
      const layers = { weather: false, names: false, industryIcons: false, routes: false };
      const renderers = canvases.map((canvas, i) => createRenderer(canvas, game, { sceneryBatching: Boolean(i), sceneryViewCaching: false, layers }));
      const readers = canvases.map(() => document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
      const hash = index => { const source = canvases[index], c = readers[index]; c.canvas.width = source.width; c.canvas.height = source.height; c.drawImage(source, 0, 0); const data = c.getImageData(0, 0, source.width, source.height).data; let result = 2166136261; for (const byte of data) result = Math.imul(result ^ byte, 16777619); return { hash: result >>> 0, data }; };
      window.sharpQA = { renderers, canvases, game, art, houses, readers, hash,
        async climate(biome) {
          game.biome = biome; game.revision++;
          for (const tile of game.tiles) if (tile.terrain !== 'forest') tile.terrain = biome === 'desert' ? 'sand' : 'grass';
          for (const renderer of renderers) renderer.setGame(game);
          await Promise.all([art.preloadWorldArt({ biome, cells: art.startupArtCells(devicePixelRatio), waitMs: 20000 }), houses.preloadHouses({ biome, cells: art.startupArtCells(devicePixelRatio), waitMs: 20000 })]);
        },
        async show(zoom, heightStep = 12, pan = false) {
          for (const renderer of renderers) { renderer.setZoom(zoom); renderer.setTerrainHeight(heightStep); renderer.focus(59, 45); if (pan) renderer.pan(3.7, -2.1); }
          for (let frame = 0; frame < 240; frame++) {
            for (const renderer of renderers) renderer.render(1000, { settle: true });
            if (renderers.every(renderer => !renderer.getStats().sceneryBatches.pending) && !art.worldArtStats().loading && houses.getHouseAssetStats(game.biome).status !== 'loading') break;
            await new Promise(requestAnimationFrame);
          }
          spriteDraws.length = 0; atlasDraws.length = 0;
          for (const renderer of renderers) renderer.render(1000, { settle: true });
          const [direct, cached] = [hash(0), hash(1)]; let max = 0, total = 0, changed = 0;
          for (let i = 0; i < direct.data.length; i++) { const delta = Math.abs(direct.data[i] - cached.data[i]); max = Math.max(max, delta); total += delta; if (delta) changed++; }
          const points = [];
          for (let y = 35; y < 59; y += 4) for (let x = 45; x < 70; x += 4) {
            if (!game.tiles[y * game.width + x].building) continue;
            const p = renderers[0].worldToScreen(x, y), picks = renderers.map((renderer, i) => { const rect = canvases[i].getBoundingClientRect(); return renderer.screenToInspectTile(p.x + rect.left, p.y - 6 * zoom + rect.top); }); points.push({ x, y, picks });
          }
          return { biome: game.biome, zoom, heightStep, pan, dpr: devicePixelRatio, hash: direct.hash, cachedHash: cached.hash, parity: { max, mean: total / direct.data.length, changed }, sprites: [...spriteDraws], atlasDraws: [...atlasDraws], picks: points, stats: renderers.map(renderer => renderer.getStats()) };
        }
      };
    });
    for (const biome of ['taiga', 'tundra', 'desert']) {
      await page.evaluate(biome => sharpQA.climate(biome), biome);
      if (biome === 'taiga') assert.equal(requests.filter(url => url.endsWith('atlas-512.png')).length, 0, `DPR${dpr} startup loads compact densities before drawing`);
      for (const zoom of [.5, 1, 2]) {
        const row = await page.evaluate(zoom => sharpQA.show(zoom), zoom); rows.push(row);
        const label = `${biome}/${zoom}/DPR${dpr}`;
        assert.ok(row.sprites.filter(draw => draw.canvas === 'direct').length >= 15, `${label} exercises actual building/tree billboard draws`);
        if (!baseline) for (const draw of row.sprites.filter(draw => draw.canvas === 'direct')) {
          assert.ok(Math.abs(draw.sourceWidth - draw.w * draw.a) < 1e-6 && Math.abs(draw.sourceHeight - draw.h * draw.d) < 1e-6, `${label} keeps rounded native bitmap dimensions`);
          assert.equal(draw.smoothing, false, `${label} does not filter prepared sprite pixels a second time`);
          assert.ok(Math.abs(draw.x * draw.a - Math.round(draw.x * draw.a)) < 1e-6 && Math.abs(draw.y * draw.d - Math.round(draw.y * draw.d)) < 1e-6, `${label} uses the shared physical world pixel grid`);
        }
        if (!baseline) assert.ok(row.parity.max <= 4 && row.parity.mean <= .12, `${label} direct and batched scenery remain equivalent: ${JSON.stringify(row.parity)}`);
        assert.ok(row.picks.every(point => point.picks[0].x === point.picks[1].x && point.picks[0].y === point.picks[1].y), `${label} native and cached hit masks agree`);
        if (!baseline && zoom * dpr >= 2) assert.ok(row.sprites.some(draw => draw.atlas.url.includes('industries-') && draw.atlas.cell === 512), `${label} draws the high-density 5×5 industry artwork`);
        if (zoom === 1) { await page.screenshot({ path: `${output}/${biome}-town-dpr${dpr}.png` }); }
      }
      const original = rows.findLast(row => row.biome === biome && row.zoom === 1 && Math.abs(row.dpr - dpr) < 1e-6);
      const returned = await page.evaluate(() => sharpQA.show(1));
      assert.equal(returned.hash, original.hash, `${biome}/DPR${dpr} restores identical Town pixels after zooming`);
      for (const heightStep of [6, 14]) {
        const row = await page.evaluate(heightStep => sharpQA.show(1, heightStep, true), heightStep); rows.push(row);
        if (!baseline) for (const draw of row.sprites.filter(draw => draw.canvas === 'direct')) {
          assert.equal(draw.smoothing, false, `${biome}/DPR${dpr}/height${heightStep} preserves native art while panning`);
          assert.ok(Math.abs(draw.sourceWidth - draw.w * draw.a) < 1e-6 && Math.abs(draw.sourceHeight - draw.h * draw.d) < 1e-6, 'varied relief does not reintroduce fractional sprite scaling');
        }
        if (!baseline) assert.ok(row.parity.max <= 4 && row.parity.mean <= .12, `varied relief and camera movement preserve batching parity: ${JSON.stringify(row.parity)}`);
      }
    }
    await writeFile(`${output}/results-progress.json`, JSON.stringify({ rows, errors }, null, 2));
    await page.close();
  }
  assert.deepEqual(errors, []);
  const summary = { profiles: rows.length, billboardDraws: rows.reduce((sum, row) => sum + row.sprites.filter(draw => draw.canvas === 'direct').length, 0), errors };
  await writeFile(`${output}/results.json`, JSON.stringify({ summary, rows }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally { await browser.close(); }
