// Rendered lighting checks: smooth hills, independently built chunks, water,
// authored flat colors and transparent source art at desktop display densities.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-terrain-lighting';
await mkdir(output, { recursive: true });
const profiles = [], errors = [];

try {
  for (const dpr of process.env.TRANSPORT_DPR ? [Number(process.env.TRANSPORT_DPR)] : [1, 1.3, 2]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/terrain-lighting-qa', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0;background:#eee8d7}canvas{display:block;width:1200px;height:900px}</style><canvas></canvas>',
    }));
    await page.goto(new URL('terrain-lighting-qa', base).href);
    const result = await page.evaluate(async () => {
      const { drawTerrainMesh } = await import('./terrain-mesh.js');
      const { projectGround, tileSurface } = await import('./terrain-geometry.js');
      const canvas = document.querySelector('canvas'), c = canvas.getContext('2d'), dpr = devicePixelRatio;
      canvas.width = 1200 * dpr; canvas.height = 900 * dpr;
      const bounds = { x0: 4, y0: 4, x1: 12, y1: 12 }, color = [108, 141, 84], waterColor = [68, 127, 147], materials = [[194, 37, 29], [21, 64, 207]];
      const world = makeWorld((x, y) => ({ terrain: 'grass', elevation: .1 + .8 * Math.max(0, 1 - Math.hypot(x - 8, y - 8) / 6) }));
      const flat = makeWorld(() => ({ terrain: 'grass', elevation: 4 / 7 }));
      const rising = makeWorld(x => ({ terrain: 'grass', elevation: Math.max(0, Math.min(7, x - 4)) / 7 }));
      const falling = makeWorld(x => ({ terrain: 'grass', elevation: Math.max(0, Math.min(7, 12 - x)) / 7 }));
      const coast = makeWorld(x => ({ terrain: x < 6 ? 'water' : 'grass', elevation: Math.max(0, Math.min(7, x - 5)) / 7 }));
      const original = JSON.stringify(world), rows = [];

      function makeWorld(tile) {
        return { width: 16, height: 16, revision: 1, tiles: Array.from({ length: 256 }, (_, i) => ({ detail: '', variant: 0, ...tile(i % 16, Math.floor(i / 16)) })) };
      }
      function texture(b, scale, rgba = [...color, 1], transparent = false, materialEdge = false) {
        // Register both source origins and their gutters on physical pixels,
        // just as independently cached renderer chunks do at fractional DPR.
        const left = Math.floor((b.x0 * 32 - 8) * scale), top = Math.floor((b.y0 * 32 - 8) * scale);
        const image = document.createElement('canvas');
        image.width = Math.ceil((b.x1 * 32 + 8) * scale) - left;
        image.height = Math.ceil((b.y1 * 32 + 8) * scale) - top;
        const t = image.getContext('2d');
        t.fillStyle = `rgba(${rgba.join(',')})`; t.fillRect(0, 0, image.width, image.height);
        if (materialEdge) {
          t.fillStyle = `rgb(${materials[0].join(',')})`; t.fillRect(0, 0, image.width, image.height);
          t.fillStyle = `rgb(${materials[1].join(',')})`; t.fillRect(7.5 * 32 * scale - left, 0, image.width, image.height);
        }
        if (transparent) t.clearRect(7 * 32 * scale - left, 7 * 32 * scale - top, 32 * scale, 32 * scale);
        return { canvas: image, sourceX: left / scale, sourceY: top / scale, sourceScale: scale };
      }

      for (const zoom of [.5, 1, 2]) {
        const density = zoom * dpr, center = projectGround(world, 8, 8), offset = { x: 600 - center.x * zoom, y: 450 - center.y * zoom };
        function render(game, { split = false, shade = true, rgba, transparent = false, materialEdge = false } = {}) {
          c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height);
          c.setTransform(density, 0, 0, density, offset.x * dpr, offset.y * dpr); c.imageSmoothingEnabled = false;
          const chunks = split ? Array.from({ length: 4 }, (_, i) => ({ x0: 4 + i % 2 * 4, y0: 4 + Math.floor(i / 2) * 4, x1: 8 + i % 2 * 4, y1: 8 + Math.floor(i / 2) * 4 })) : [bounds];
          for (const b of chunks) drawTerrainMesh(c, { game, ...texture(b, density, rgba, transparent, materialEdge), bounds: b, shade });
          return c.getImageData(0, 0, canvas.width, canvas.height).data;
        }
        function sample(pixels, game, u, v) {
          const p = projectGround(game, u, v), x = Math.floor((p.x * zoom + offset.x) * dpr), y = Math.floor((p.y * zoom + offset.y) * dpr), index = (y * canvas.width + x) * 4;
          return Array.from(pixels.slice(index, index + 4));
        }
        function difference(a, b, channels = 3) { return Math.max(...a.slice(0, channels).map((value, i) => Math.abs(value - b[i]))); }
        const whole = render(world), split = render(world, { split: true }), unlit = render(world, { shade: false });
        let chunkError = 0, seamError = 0, minimumAlpha = 255, authoredError = 0, shadeDifference = 0, samples = 0;
        for (let v = 4.5; v <= 11.5; v += .125) for (let u = 4.5; u <= 11.5; u += .125) {
          const a = sample(whole, world, u, v), b = sample(split, world, u, v), raw = sample(unlit, world, u, v), error = difference(a, b, 4);
          chunkError = Math.max(chunkError, error);
          if (Math.abs(u - 8) <= .125 || Math.abs(v - 8) <= .125) seamError = Math.max(seamError, error);
          minimumAlpha = Math.min(minimumAlpha, a[3], b[3]); authoredError = Math.max(authoredError, difference(raw, color));
          shadeDifference = Math.max(shadeDifference, difference(a, raw)); samples++;
        }
        // On nonplanar cells the two geometric triangles used to have distinct
        // uniform colors. Closely spaced samples across their shared diagonal
        // now change gradually, without a triangular patch boundary.
        let diagonalJump = 0, diagonalPairs = 0;
        for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) {
          const surface = tileSurface(world, x, y);
          if (surface.nw.height + surface.se.height === surface.ne.height + surface.sw.height) continue;
          const points = surface.slope.diagonal === 'ne-sw' ? [[.44, .44], [.56, .56]] : [[.44, .56], [.56, .44]];
          const [a, b] = points.map(([u, v]) => sample(whole, world, x + u, y + v));
          diagonalJump = Math.max(diagonalJump, difference(a, b)); diagonalPairs++;
        }
        const flatPixels = render(flat), brightPixels = render(rising), darkPixels = render(falling);
        let flatError = 0, brightTotal = 0, darkTotal = 0, rampSamples = 0;
        for (let v = 6.25; v <= 9.75; v += .5) for (let u = 6.25; u <= 9.75; u += .5) {
          flatError = Math.max(flatError, difference(sample(flatPixels, flat, u, v), color));
          brightTotal += sample(brightPixels, rising, u, v).slice(0, 3).reduce((a, b) => a + b, 0);
          darkTotal += sample(darkPixels, falling, u, v).slice(0, 3).reduce((a, b) => a + b, 0); rampSamples++;
        }
        const water = render(coast, { rgba: [...waterColor, 1] }), waterRaw = render(coast, { rgba: [...waterColor, 1], shade: false });
        let waterError = 0, waterLightingError = 0, waterWorst = null, waterAlpha = 255;
        for (let v = 4.5; v <= 11.5; v += .25) for (let u = 4.25; u <= 5.9375; u += .0625) {
          const pixel = sample(water, coast, u, v);
          const raw = sample(waterRaw, coast, u, v), error = difference(pixel, raw);
          if (error > waterLightingError) { waterLightingError = error; waterWorst = { u, v, pixel, raw }; }
          waterError = Math.max(waterError, difference(pixel, waterColor)); waterAlpha = Math.min(waterAlpha, pixel[3]);
        }
        const transparentRaw = render(world, { rgba: [...color, .45], transparent: true, shade: false });
        const transparentLit = render(world, { rgba: [...color, .45], transparent: true });
        let alphaError = 0, translucentSamples = 0;
        for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) for (const triangle of tileSurface(world, x, y).triangles) {
          const u = triangle.reduce((sum, p) => sum + p.u, 0) / 3, v = triangle.reduce((sum, p) => sum + p.v, 0) / 3;
          const a = sample(transparentRaw, world, u, v), b = sample(transparentLit, world, u, v);
          alphaError = Math.max(alphaError, Math.abs(a[3] - b[3])); if (a[3] > 0 && a[3] < 255) translucentSamples++;
        }
        const clearAlpha = sample(transparentLit, world, 7.5, 7.5)[3];
        const materialRaw = render(world, { materialEdge: true, shade: false }), materialLit = render(world, { materialEdge: true });
        let materialRawError = 0, materialShadeDelta = 0, materialContrast = 255;
        for (let v = 4.5; v <= 11.5; v += .25) {
          const lit = [];
          for (let side = 0; side < 2; side++) {
            // On the steepest low-zoom triangles four world pixels project
            // to less than one screen pixel. Use a wider golden-color probe,
            // then compare the same raster pixels immediately at the edge.
            const u = 7.5 + (side ? .375 : -.375), raw = sample(materialRaw, world, u, v), shaded = sample(materialLit, world, u, v);
            materialRawError = Math.max(materialRawError, difference(raw, materials[side]));
            materialShadeDelta = Math.max(materialShadeDelta, difference(raw, shaded)); lit.push(shaded);
            const near = 7.5 + (side ? .125 : -.125);
            materialShadeDelta = Math.max(materialShadeDelta, difference(sample(materialRaw, world, near, v), sample(materialLit, world, near, v)));
          }
          materialContrast = Math.min(materialContrast, difference(...lit));
        }
        rows.push({ dpr, zoom, samples, chunkError, seamError, minimumAlpha, authoredError, shadeDifference, diagonalJump, diagonalPairs, flatError, brightSum: brightTotal / rampSamples, darkSum: darkTotal / rampSamples, authoredSum: color.reduce((a, b) => a + b, 0), waterError, waterLightingError, waterWorst, waterAlpha, alphaError, clearAlpha, translucentSamples, materialRawError, materialShadeDelta, materialContrast });
      }
      // Keep the last full-size hill on screen for screenshot review.
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height);
      const center = projectGround(world, 8, 8);
      c.setTransform(dpr, 0, 0, dpr, (600 - center.x) * dpr, (450 - center.y) * dpr); c.imageSmoothingEnabled = true;
      drawTerrainMesh(c, { game: world, ...texture(bounds, dpr), bounds });
      return { rows, unchanged: JSON.stringify(world) === original };
    });
    await page.locator('canvas').screenshot({ path: `${output}/smooth-hill-dpr${dpr}.png` });
    for (const row of result.rows) {
      const info = JSON.stringify(row);
      assert.ok(row.chunkError <= 3 && row.seamError <= 3, `chunk lighting continuity: ${info}`);
      // Canvas clip overlaps round unshaded colors by up to three levels at
      // fractional source origins; this tolerance also covers the raw path.
      assert.equal(row.minimumAlpha, 255, info); assert.ok(row.authoredError <= 3, info);
      assert.ok(row.shadeDifference >= 10, `hill relief remains visible: ${info}`);
      assert.ok(row.diagonalPairs > 0 && row.diagonalJump <= 8, `smooth internal diagonals: ${info}`);
      assert.ok(row.flatError <= 1, info);
      assert.ok(row.brightSum > row.authoredSum + 15 && row.darkSum < row.authoredSum - 20, `directional ramp light: ${info}`);
      assert.ok(row.waterError <= 2, `water retains authored color: ${info}`); assert.equal(row.waterLightingError, 0, `water lighting stays neutral: ${info}`); assert.equal(row.waterAlpha, 255, info);
      assert.equal(row.alphaError, 0, `lighting preserves source alpha: ${info}`); assert.equal(row.clearAlpha, 0, info); assert.ok(row.translucentSamples > 0, info);
      assert.ok(row.materialRawError <= 2, `authored material edge stays registered: ${info}`);
      assert.ok(row.materialShadeDelta <= 35 && row.materialContrast >= 125, `illumination does not blur material boundaries: ${info}`);
    }
    assert.ok(result.unchanged); profiles.push(...result.rows); await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ profiles, output }, null, 2));
} finally {
  await browser.close();
}
