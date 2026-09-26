// Run against the existing server. Browser contexts have isolated storage and
// the renderer fixture never changes the company opened in the user's browser.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-nature';
await mkdir(output, { recursive: true });
const errors = [], report = [];

try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.transport?.renderer);
    await page.evaluate(() => transport.setSpeed(0));
    await page.evaluate(async () => {
      const model = await import('./model.js');
      const { createRenderer } = await import('./renderer.js');
      const { createSprites } = await import('./sprites.js');
      const { forestComposition, drawForest } = await import('./tree-sprites.js');
      const { BIOME_NATURE } = await import('./terrain-sprites.js');
      const { encodeGame } = await import('./save-codec.js');
      const panel = document.createElement('section'); panel.id = 'nature-qa';
      panel.style.cssText = 'position:fixed;inset:0;background:#202923;z-index:99999;overflow:auto;padding:24px;color:#e9e9d9;font:16px system-ui';
      panel.innerHTML = '<h1 id="nature-title" style="margin:0 0 16px;font-size:22px"></h1><canvas id="nature-world" style="display:block;width:1320px;height:800px"></canvas><canvas id="nature-sheet" style="display:none"></canvas>';
      document.body.append(panel);
      const canvas = document.querySelector('#nature-world'), sheet = document.querySelector('#nature-sheet');
      const hash = canvas => { let n = 2166136261; for (const value of canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) n = Math.imul(n ^ value, 16777619); return n; };
      window.natureQA = { ...model, createRenderer, createSprites, forestComposition, drawForest, BIOME_NATURE, encodeGame, canvas, sheet, hash };
    });

    for (const biome of ['taiga', 'tundra', 'desert']) {
      await page.evaluate(biome => {
        const qa = natureQA, game = qa.createGame({ biome, size: 'huge', seed: 1847 });
        const occupied = new Set([...game.cities, ...game.industries, ...game.stations].map(item => item.y * game.width + item.x));
        let best = { x: 40, y: 40, score: -Infinity };
        // Prefer a varied wild patch with woodland, avoiding town infrastructure.
        for (let y = 12; y < game.height - 12; y += 4) for (let x = 12; x < game.width - 12; x += 4) {
          let score = 0; const details = new Set();
          for (let dy = -6; dy <= 6; dy += 2) for (let dx = -6; dx <= 6; dx += 2) {
            const index = (y + dy) * game.width + x + dx, tile = game.tiles[index];
            score += tile.terrain === 'forest' ? 3 : ['water', 'mountain', 'rock'].includes(tile.terrain) ? .8 : 0;
            if (tile.road || tile.rail || tile.building || occupied.has(index)) score -= 15;
            if (tile.terrain === 'forest') details.add(tile.detail);
          }
          score += details.size * 4;
          if (score > best.score) best = { x, y, score };
        }
        qa.game = game; qa.focus = best;
        qa.renderer = qa.createRenderer(qa.canvas, game, { layers: { lighting: false, routes: false, names: false, industryIcons: false, grid: false } });
        qa.renderer.resize(); qa.renderer.focus(best.x, best.y);
      }, biome);

      for (const zoom of [.5, 1, 2]) {
        const raster = await page.evaluate(({ biome, zoom, dpr }) => {
          const qa = natureQA, profile = zoom === .5 ? 'region' : zoom === 2 ? 'detail' : 'town', scale = zoom * dpr;
          const sprite = qa.createSprites(biome, { pixelScale: scale, detailLevel: profile });
          const details = qa.BIOME_NATURE[biome].trees, sheet = qa.sheet, cellW = 142, cellH = 122;
          sheet.width = cellW * 8 * dpr; sheet.height = (cellH * 8 + 44) * dpr;
          sheet.style.width = `${cellW * 8}px`; sheet.style.height = `${cellH * 8 + 44}px`; sheet.style.display = 'block'; qa.canvas.style.display = 'none';
          document.querySelector('#nature-title').textContent = `${biome} · ${profile} · DPR ${dpr} · 64 woodland compositions`;
          const c = sheet.getContext('2d'); c.scale(dpr, dpr); c.fillStyle = '#25352b'; c.fillRect(0, 0, cellW * 8, cellH * 8 + 44);
          c.font = '13px system-ui'; c.fillStyle = '#eee9ce'; c.fillText('Native screen size. The checkerboard shows each transparent 48 × 48 woodland envelope.', 12, 26);
          let minimumTransparency = 1, worstSpill = 0, maxSpillPixels = 0, worstCase = null;
          const hashes = new Set(), compositions = new Set(), counts = new Set(), species = new Set(), bare = new Set();
          for (let sample = 0; sample < details.length * 64; sample++) {
            const variant = sample % 64, detailIndex = Math.floor(sample / 64), detail = details[detailIndex], art = sprite('forest', variant, 1, detail), geometry = qa.forestComposition(biome, detail, variant);
            const shown = detailIndex === Math.floor(variant / 8) % details.length;
            if (shown) compositions.add(JSON.stringify(geometry)); counts.add(geometry.length); for (const tree of geometry) { species.add(tree.species); bare.add(tree.bare); }
            if (detailIndex === 0) hashes.add(qa.hash(art));
            if (art !== sprite('forest', variant + 64, 1, detail)) throw new Error('Nature sprite cache must wrap at 64 variants.');
            if (art.width !== Math.round(48 * scale) || art.height !== Math.round(48 * scale)) throw new Error('Forest raster is not at its physical-pixel density.');
            const pixels = art.getContext('2d').getImageData(0, 0, art.width, art.height).data;
            let transparent = 0, ink = 0; for (let n = 3; n < pixels.length; n += 4) { if (!pixels[n]) transparent++; else ink++; }
            minimumTransparency = Math.min(minimumTransparency, transparent / (pixels.length / 4));
            if (!ink) throw new Error(`Empty forest sprite: ${biome} ${detail} ${variant}`);
            // Draw onto an oversized transparent canvas to measure artwork lost
            // outside the normal source bounds, including antialiased edges.
            const pad = 16, overscan = document.createElement('canvas'); overscan.width = Math.round((48 + pad * 2) * scale); overscan.height = Math.round((48 + pad * 2) * scale);
            const oc = overscan.getContext('2d'); oc.scale(scale, scale); oc.translate(pad + 8, pad + 16); qa.drawForest(oc, biome, detail, variant, profile);
            const expanded = oc.getImageData(0, 0, overscan.width, overscan.height).data, margin = pad * scale;
            let spill = 0, total = 0;
            for (let y = 0; y < overscan.height; y++) for (let x = 0; x < overscan.width; x++) {
              const alpha = expanded[(y * overscan.width + x) * 4 + 3]; if (alpha < 16) continue; total++;
              if (x < margin || y < margin || x >= margin + art.width || y >= margin + art.height) spill++;
            }
            if (spill / Math.max(1, total) > worstSpill) worstCase = { detail, variant, trees: geometry };
            worstSpill = Math.max(worstSpill, spill / Math.max(1, total)); maxSpillPixels = Math.max(maxSpillPixels, spill);
            if (!shown) continue;
            const x = (variant % 8) * cellW, y = 44 + Math.floor(variant / 8) * cellH, w = 48 * zoom, h = 48 * zoom, left = x + (cellW - w) / 2, top = y + 3;
            for (let by = 0; by < h; by += 4) for (let bx = 0; bx < w; bx += 4) { c.fillStyle = ((bx + by) / 4) % 2 ? '#546154' : '#465646'; c.fillRect(left + bx, top + by, Math.min(4, w - bx), Math.min(4, h - by)); }
            c.drawImage(art, left, top, w, h); c.fillStyle = '#dadbc5'; c.fillText(`${variant} · ${detail} · ${geometry.length}`, x + 8, y + 116);
          }
          const stableBuilding = sprite('house-cheap-1', 0); if (stableBuilding !== sprite('house-cheap-1', 12)) throw new Error('Building cache must retain its 12-variant bound.');
          if (stableBuilding.width !== Math.round(32 * scale) || stableBuilding.height !== Math.round(40 * scale)) throw new Error('Nonforest sprite envelopes must retain their original dimensions.');
          return { minimumTransparency, worstSpill, maxSpillPixels, worstCase, checkedSprites: details.length * 64, uniqueRasters: hashes.size, uniqueCompositions: compositions.size, counts: [...counts], species: [...species], bare: [...bare] };
        }, { biome, zoom, dpr });
        await page.locator('#nature-sheet').screenshot({ path: `${output}/forest-${biome}-dpr${dpr}-zoom${zoom}.png` });
        assert.ok(raster.minimumTransparency > .1, `${biome} forest art keeps a transparent background`);
        assert.equal(raster.uniqueRasters, 64, 'each of the 64 forest variants changes visible artwork');
        assert.equal(raster.uniqueCompositions, 64, 'variants change geometry as well as color');
        assert.ok(raster.counts.length >= 3 && raster.counts.every(count => count >= 1 && count <= 5));
        assert.ok(raster.species.length >= 3 && raster.bare.includes(true) && raster.bare.includes(false));

        const world = await page.evaluate(({ biome, zoom, dpr }) => {
          const qa = natureQA, renderer = qa.renderer;
          qa.sheet.style.display = 'none'; qa.canvas.style.display = 'block';
          document.querySelector('#nature-title').textContent = `${biome} wilderness · ${zoom * 100}% · DPR ${dpr}`;
          renderer.resize(); renderer.setZoom(zoom); renderer.focus(qa.focus.x, qa.focus.y);
          const state = JSON.stringify(qa.encodeGame(qa.game));
          renderer.render(1200); const visible = qa.hash(qa.canvas);
          renderer.setLayers({ trees: false }); renderer.render(1200); const hidden = qa.hash(qa.canvas);
          renderer.setLayers({ trees: true }); renderer.render(1200); const restored = qa.hash(qa.canvas);
          const stats = renderer.getStats(), composed = stats.composedChunks;
          renderer.render(1200); const cached = renderer.getStats();
          return { visible, hidden, restored, stableState: state === JSON.stringify(qa.encodeGame(qa.game)), stats, repeatComposed: cached.composedChunks - composed };
        }, { biome, zoom, dpr });
        assert.notEqual(world.visible, world.hidden, 'Trees layer hides visible woodland');
        assert.equal(world.restored, world.visible, 'restoring Trees returns exact original artwork');
        assert.equal(world.stableState, true, 'rendering and visibility changes do not mutate saved state');
        assert.ok(world.stats.cacheBytes <= world.stats.cacheLimit && world.stats.cacheLimit <= world.stats.cacheMax, 'woodland chunk memory remains bounded');
        assert.equal(world.repeatComposed, 0, 'an unchanged wilderness frame reuses its chunks');
        assert.equal(world.stats.pixelScale, zoom * dpr);
        await page.locator('#nature-world').screenshot({ path: `${output}/wilderness-${biome}-dpr${dpr}-zoom${zoom}.png` });
        report.push({ biome, zoom, dpr, raster, cacheBytes: world.stats.cacheBytes, chunks: world.stats.chunkCount });
      }

      const save = await page.evaluate(() => {
        const qa = natureQA, game = qa.game, blocked = new Set([...game.industries, ...game.stations, ...game.cities].map(item => item.y * game.width + item.x));
        const index = game.tiles.findIndex((tile, i) => tile.terrain === 'forest' && !tile.building && !tile.zone && !tile.road && !tile.rail && !blocked.has(i));
        const x = index % game.width, y = Math.floor(index / game.width), cost = qa.constructionCost(game, 'road', x, y), money = game.money;
        const built = qa.build(game, 'road', x, y), saved = qa.saveGame(game), loaded = qa.loadGame();
        const valid = loaded && qa.validateGame(loaded);
        if (loaded) { qa.renderer.setGame(loaded); qa.renderer.focus(qa.focus.x, qa.focus.y); qa.renderer.render(1200); }
        const terrainPreserved = loaded && loaded.tiles.every((tile, index) => Object.keys({ ...tile, ...game.tiles[index] }).every(key => JSON.stringify(tile[key]) === JSON.stringify(game.tiles[index][key])));
        return { found: index >= 0, built: built.ok, cost, actualCost: money - game.money, saved: saved.ok, valid, terrainPreserved, moneyPreserved: loaded?.money === game.money };
      });
      assert.ok(save.found && save.built && save.saved && save.valid && save.terrainPreserved && save.moneyPreserved, `woodland construction and compact saves retain terrain and company state: ${JSON.stringify(save)}`);
      assert.equal(save.actualCost, save.cost, 'forest clearance costs agree with the current placement quote');
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  for (const { biome, zoom, dpr, raster } of report) assert.ok(raster.worstSpill < .005, `${biome} ${zoom}× DPR${dpr} clips ${(raster.worstSpill * 100).toFixed(2)}% of the tree raster: ${JSON.stringify(raster.worstCase)}`);
  console.log(`Nature: 64 varied transparent forests per profile; all biomes at three zooms and DPR1/2; clipping, layers, cache reuse, construction and saves passed. Artifacts: ${output}`);
} finally { await browser.close(); }
