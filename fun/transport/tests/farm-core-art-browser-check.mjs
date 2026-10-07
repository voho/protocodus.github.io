// Farm barns retain their 2×2 human scale inside a 5×5 field parcel.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-farm-core-qa';
await mkdir(output, { recursive: true });
const results = [], errors = [];
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 620 }, deviceScaleFactor: dpr });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/farm-core-art-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#e8ebdc;font:16px system-ui"><canvas id="cores" width="1280" height="560" style="width:1280px;height:560px"></canvas></body>' }));
    await page.route('**/assets/world/farm-cores-v1/**', route => route.abort());
    await page.goto(new URL('farm-core-art-qa', base).href);
    const native = await page.evaluate(async () => {
      const art = await import('./atlas-runtime.js'), industries = await import('./raster-industries.js');
      const { drawNativeFarmCore } = await import('./processing-sprites.js');
      const hash = canvas => { let h = 2166136261; for (const b of canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) h = Math.imul(h ^ b, 16777619); return h >>> 0; };
      const rng = seed => () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
      window.coreQA = { art, industries, drawNativeFarmCore, hash, rng };
      const checks = [];
      for (const biome of ['taiga', 'desert']) for (const kind of industries.FARM_CORE_KINDS) {
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 72; const c = canvas.getContext('2d'); c.translate(0, 8);
        const generated = industries.drawRasterFarmCore(c, kind, biome);
        c.scale(2, 2); const recovered = drawNativeFarmCore(c, kind, rng(99), biome);
        checks.push({ biome, kind, generated, recovered, hash: hash(canvas) });
      }
      await art.preloadWorldArt({ cells: [64], waitMs: 2000 });
      return checks;
    });
    for (const item of native) { assert.equal(item.generated, false); assert.equal(item.recovered, true); }
    for (const biome of ['taiga', 'desert']) assert.equal(new Set(native.filter(n => n.biome === biome).map(n => n.hash)).size, 5, 'all five cores have distinct native recovery drawings');
    await page.unroute('**/assets/world/farm-cores-v1/**');
    for (const biome of ['taiga', 'desert']) {
      const checks = await page.evaluate(async biome => {
        const q = coreQA; await q.art.preloadWorldArt({ biome, cells: [16, 32, 64, 128, 256], retry: true, waitMs: 8000 });
        const profiles = [];
        for (const zoom of [.5, 1, 2]) {
          const density = zoom * devicePixelRatio;
          for (const [index, kind] of q.industries.FARM_CORE_KINDS.entries()) {
            const canvas = document.createElement('canvas'); canvas.width = 64 * density; canvas.height = 72 * density;
            const c = canvas.getContext('2d'); c.scale(density, density); c.translate(0, 8);
            const generated = q.industries.drawRasterFarmCore(c, kind, biome, density);
            const legacy = document.createElement('canvas'); legacy.width = legacy.height = 96;
            const compact = q.industries.drawRasterIndustry(legacy.getContext('2d'), kind, biome, 1, { size: 96, footprint: 3 });
            const cell = [16, 32, 64, 128, 256].find(s => s >= 64 * density), image = new Image();
            image.src = new URL(`./assets/world/farm-cores-v1/${biome}/atlas-${cell}.png`, location.href).href; await image.decode();
            const expected = document.createElement('canvas'); expected.width = canvas.width; expected.height = canvas.height;
            const e = expected.getContext('2d'); e.scale(density, density); e.translate(0, 8); e.imageSmoothingEnabled = 64 * density !== cell; e.imageSmoothingQuality = 'high';
            e.drawImage(image, index % 3 * cell, Math.floor(index / 3) * cell, cell, cell, 0, 0, 64, 64);
            profiles.push({ kind, zoom, generated, compact, same: q.hash(canvas) === q.hash(expected), hash: q.hash(canvas), width: canvas.width, height: canvas.height });
          }
        }
        const image = new Image(); image.src = new URL(`./assets/world/farm-cores-v1/${biome}/atlas-256.png`, location.href).href; await image.decode();
        const master = document.createElement('canvas'); master.width = 768; master.height = 512; master.getContext('2d').drawImage(image, 0, 0);
        const data = master.getContext('2d').getImageData(0, 0, 768, 512).data, alpha = [];
        for (let i = 0; i < 6; i++) {
          const ox = i % 3 * 256, oy = Math.floor(i / 3) * 256; let ink = 0, border = 0;
          for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
            const a = data[((oy + y) * 768 + ox + x) * 4 + 3]; if (a > 16) ink++;
            if ((x < 8 || x >= 248 || y < 8 || y >= 248) && a) border++;
          }
          alpha.push({ index: i, ink, border });
        }
        const canvas = document.querySelector('#cores'), c = canvas.getContext('2d'); c.clearRect(0, 0, 1280, 560);
        c.fillStyle = biome === 'desert' ? '#c6b48b' : '#91a77a'; c.fillRect(0, 0, 1280, 560);
        c.fillStyle = '#263b32'; c.font = '20px system-ui'; c.fillText(`${biome} / 2×2 farm building cores`, 24, 32);
        q.industries.FARM_CORE_KINDS.forEach((kind, i) => {
          c.save(); c.translate(24 + i * 250, 72); q.industries.drawRasterFarmCore(c, kind, biome, 1, { size: 232 }); c.restore();
          c.fillStyle = '#263b32'; c.font = '16px system-ui'; c.fillText(kind, 24 + i * 250, 330);
          c.save(); c.translate(24 + i * 250, 370); q.industries.drawRasterFarmCore(c, kind, biome); c.restore();
          c.fillText('64px core source', 24 + i * 250, 480);
        });
        const metadata = await fetch(`./assets/world/farm-cores-v1/${biome}/atlas.json`).then(response => response.json());
        const densityCanvas = document.createElement('canvas'); densityCanvas.width = densityCanvas.height = 512;
        const dc = densityCanvas.getContext('2d'), draws = [], drawImage = dc.drawImage.bind(dc);
        dc.drawImage = (image, ...args) => { draws.push({ src: image.src, cell: args[2] }); return drawImage(image, ...args); };
        q.industries.drawRasterFarmCore(dc, 'farm', biome, 6);
        await q.art.preloadWorldArt({ biome, cells: [512], waitMs: 8000 });
        draws.length = 0; q.industries.drawRasterFarmCore(dc, 'farm', biome, 6);
        return { profiles, alpha, calibration: metadata.physicalCalibration.cells.filter(cell => cell.id), denseDraws: draws };
      }, biome);
      for (const p of checks.profiles) { assert.equal(p.generated, true); assert.equal(p.compact, false, 'compact saved farms use calibrated native art instead of shrinking the five-tile parcel'); assert.equal(p.same, true, 'core atlas draws the exact isolated source density'); }
      // Physically calibrated architecture can occupy less of its cell than
      // the old silhouette-fitted compounds. Verify visibility and real scale.
      for (const cell of checks.alpha) { assert.equal(cell.border, 0); if (cell.index < 5) assert.ok(cell.ink > 1000); else assert.equal(cell.ink, 0); }
      assert.equal(checks.calibration.length, 5);
      for (const cell of checks.calibration) {
        const door = cell.sourceDoorMeasurement;
        assert.ok(Math.abs(door.sillSource[1] - door.headSource[1] - door.heightPixels) < .01, 'recorded door heights follow actual vertical source landmarks');
        assert.ok(Math.abs(door.heightPixels * cell.uniformScale - cell.masterDoorHeightPixels) < .001, 'packing preserves the measured personnel scale');
        const worldDoor = cell.masterDoorHeightPixels * 48 * cell.footprint / 256;
        assert.ok(worldDoor >= 3.4 && worldDoor <= 5, `${cell.id}: human-sized personnel opening`);
        assert.ok(cell.groundCenterAfterPackingMaster.every((value, axis) => Math.abs(value - [128, 192][axis]) <= .5), 'physical ground datum remains registered independently of silhouette bounds');
      }
      assert.ok(checks.denseDraws.some(draw => draw.src.endsWith('atlas-512.png') && draw.cell === 512), 'upright Detail on a dense display samples the direct 512px source');
      assert.equal(new Set(checks.profiles.filter(p => p.zoom === 1).map(p => p.hash)).size, 5);
      await page.locator('#cores').screenshot({ path: `${output}/${biome}-cores-dpr${dpr}.png` });
      results.push({ biome, dpr, profiles: checks.profiles.length });
    }
    await context.close();
  }
  assert.deepEqual(errors, []); await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ profiles: results.reduce((n, r) => n + r.profiles, 0), results, errors }, null, 2));
} finally { await browser.close(); }
