// Exhaustive slope-art review uses the production texture projection/lighting.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-terrain-slopes';
await mkdir(output, { recursive: true });
const errors = [], profiles = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/terrain-slope-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{display:block;width:1200px;height:800px}</style><canvas></canvas>' }));
    await page.goto(new URL('terrain-slope-qa', base).href);
    for (const biome of ['taiga', 'tundra', 'desert']) {
      const result = await page.evaluate(async biome => {
        const { TERRAIN_SLOPE_SHAPES } = await import('./terrain-slope-shapes.js');
        const { tileSurface, projectGround, pickGround } = await import('./terrain-geometry.js');
        const { paintTerrainTile, facetLight } = await import('./terrain-mesh.js');
        const { terrainReliefRaster } = await import('./terrain-elevation.js');
        const { TERRAIN_HEIGHT_VIEWS } = await import('./terrain-view.js');
        const canvas = document.querySelector('canvas'), c = canvas.getContext('2d'), dpr = devicePixelRatio;
        canvas.width = 1200 * dpr; canvas.height = 800 * dpr;
        c.scale(dpr, dpr); c.fillStyle = '#eee9dc'; c.fillRect(0, 0, 1200, 800);
        c.fillStyle = '#263b33'; c.font = '600 24px system-ui'; c.fillText(`${biome} · fifteen terrain shapes`, 32, 42);
        c.font = '14px system-ui'; c.fillText('Shared whole-level corners · two triangles per tile · northwest daylight', 32, 69);
        let faces = 0, samples = 0, minimumAlpha = 255, maximumPickError = 0;
        for (const [index, shape] of TERRAIN_SLOPE_SHAPES.entries()) {
          const game = { width: 6, height: 6, seed: 1847, biome, revision: 0, tiles: Array.from({ length: 36 }, () => ({ terrain: biome === 'desert' ? 'sand' : biome === 'tundra' ? 'snow' : 'grass', elevation: 3 / 7 })) };
          for (const [i, [x, y]] of [[2, 2], [3, 2], [3, 3], [2, 3]].entries()) if (shape.mask & (1 << i)) game.tiles[y * 6 + x].elevation = 4 / 7;
          const raster = terrainReliefRaster(game, { x0: 1, y0: 1, x1: 4, y1: 4 }, 16, { lighting: false });
          const texture = document.createElement('canvas'); texture.width = raster.width; texture.height = raster.height;
          texture.getContext('2d').putImageData(new ImageData(raster.pixels, raster.width, raster.height), 0, 0);
          for (const { value: heightStep } of TERRAIN_HEIGHT_VIEWS) for (const zoom of [.5, 1, 2]) {
            const surface = tileSurface(game, 2, 2, heightStep), scratch = document.createElement('canvas');
            scratch.width = 256 * dpr; scratch.height = 256 * dpr;
            const sc = scratch.getContext('2d'); sc.scale(dpr * zoom, dpr * zoom); sc.translate(128 / zoom - surface.center.x, 128 / zoom - surface.center.y);
            faces += paintTerrainTile(sc, texture, { game, x: 2, y: 2, surface, heightStep, sourceX: 32, sourceY: 32, sourceScale: .5 });
            for (const triangle of surface.triangles) {
              const u = triangle.reduce((sum, p) => sum + p.u, 0) / 3, v = triangle.reduce((sum, p) => sum + p.v, 0) / 3;
              const p = projectGround(game, u, v, heightStep), picked = pickGround(game, p.x, p.y, heightStep);
              maximumPickError = Math.max(maximumPickError, picked ? Math.hypot(picked.x - u, picked.y - v) : Infinity);
              const sx = Math.round((128 + (p.x - surface.center.x) * zoom) * dpr), sy = Math.round((128 + (p.y - surface.center.y) * zoom) * dpr);
              minimumAlpha = Math.min(minimumAlpha, sc.getImageData(sx, sy, 1, 1).data[3]); samples++;
            }
          }
          const surface = tileSurface(game, 2, 2), x = 120 + (index % 5) * 240, y = 157 + Math.floor(index / 5) * 221;
          c.save(); c.translate(x, y); c.scale(3, 3); c.translate(-surface.center.x, -surface.center.y);
          paintTerrainTile(c, texture, { game, x: 2, y: 2, surface, sourceX: 32, sourceY: 32, sourceScale: .5 });
          c.restore(); c.fillStyle = '#263b33'; c.font = '600 14px system-ui'; c.textAlign = 'center'; c.fillText(shape.name, x, y + 106);
          c.fillStyle = '#67746a'; c.font = '12px system-ui'; c.fillText(surface.triangles.map(t => facetLight(t).toFixed(2)).join(' / ') + ' light', x, y + 125);
        }
        return { biome, dpr, faces, samples, minimumAlpha, maximumPickError };
      }, biome);
      profiles.push(result);
      assert.equal(result.faces, 360); assert.equal(result.samples, 360);
      assert.equal(result.minimumAlpha, 255, 'every canonical face has continuous opaque ground');
      assert.ok(result.maximumPickError < 1e-8, 'all view and zoom combinations pick the same geometry they render');
      await page.screenshot({ path: `${output}/${biome}-slopes-dpr${dpr}.png` });
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ profiles, errors }, null, 2));
  console.log(`Canonical terrain: 15 shapes × 4 views × 3 zooms × 3 climates × 2 densities passed; screenshots in ${output}.`);
} finally { await browser.close(); }
