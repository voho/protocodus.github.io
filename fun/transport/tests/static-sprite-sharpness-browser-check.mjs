// Static infrastructure and airport picking bounds must describe the same
// native pixels under a fractional canvas translation. Moving art is separate.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-static-sprite-sharpness';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.3 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/static-sharpness-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0;background:#d7dbc8}canvas{width:1200px;height:800px}</style><canvas></canvas>' }));
  await page.goto(new URL('static-sharpness-qa', base).href);
  const result = await page.evaluate(async () => {
    const [infra, airport, { createSpriteCache }, art] = await Promise.all([import('./isometric-infrastructure.js'), import('./airport-art.js'), import('./sprite-cache.js'), import('./atlas-runtime.js')]);
    await art.preloadWorldArt({ cells: [128], waitMs: 20000 });
    const scale = devicePixelRatio, cache = createSpriteCache({ limit: 8 * 1024 * 1024 });
    const station = infra.createIsometricInfrastructureSprites({ pixelScale: scale, cache }), terminal = airport.createAirportSprites({ pixelScale: scale, detailLevel: 'town', biome: 'taiga', cache });
    const canvas = document.querySelector('canvas'); canvas.width = Math.round(1200 * scale); canvas.height = Math.round(800 * scale);
    const c = canvas.getContext('2d'); c.fillStyle = '#d7dbc8'; c.fillRect(0, 0, canvas.width, canvas.height);
    const calls = [], original = c.drawImage.bind(c); let metadataOnly = false;
    c.drawImage = (image, x, y, w, h) => { const t = c.getTransform(); calls.push({ x, y, w, h, width: image.width, height: image.height, a: t.a, d: t.d, e: t.e, f: t.f, smoothing: c.imageSmoothingEnabled }); if (!metadataOnly) original(image, x, y, w, h); };
    const specs = [
      ...['road', 'rail'].map(mode => ({ name: `stop-${mode}`, bounds: infra.isometricStationBounds(mode), run: (x, y) => station.stop(c, mode, x, y) })),
      ...[[1, 0], [0, 1], [-1, 0], [0, -1]].flatMap(([dx, dy]) => [
        { name: `port-${dx}-${dy}`, bounds: infra.isometricStationBounds('water'), run: (x, y) => station.port(c, dx, dy, x, y) },
        ...['road', 'rail'].map(mode => ({ name: `portal-${mode}-${dx}-${dy}`, bounds: { left: -22, top: -35 }, run: (x, y) => station.portal(c, mode, dx, dy, x, y) })),
      ]),
      ...['x', 'y'].flatMap(axis => Object.entries(airport.PART_BOXES[axis]).map(([kind, box]) => ({ name: `${axis}-${kind}`, bounds: { left: box.left - 2, top: box.top - 2 }, airport: true, run: (x, y) => terminal.part(c, kind, axis, x, y) }))),
    ];
    const rows = [];
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i], x = 90 + i % 7 * 155 + .27, y = 100 + Math.floor(i / 7) * 145 + .43;
      c.setTransform(scale, 0, 0, scale, .37, .61); c.imageSmoothingEnabled = true;
      const first = spec.run(x, y), call = calls.at(-1); const restored = c.imageSmoothingEnabled;
      const returned = spec.airport ? { x: first.x, y: first.y, w: first.w, h: first.h } : null;
      const before = station.getStats().created + terminal.getStats().created; spec.run(x, y);
      rows.push({ name: spec.name, painted: Boolean(first), native: call, returned, restored, reused: before === station.getStats().created + terminal.getStats().created });
      // A genuinely resized preview keeps its fractional anchor and filter.
      c.setTransform(scale * 1.7, 0, 0, scale * 1.7, .37, .61);
      spec.run(x, y); rows.at(-1).preview = calls.at(-1);
      // Chained camera transforms can drift just below an integer. At an
      // image's half-pixel anchor that must not move the sprite one pixel.
      const tieX = 400.5 / scale - spec.bounds.left, tieY = 200.5 / scale - spec.bounds.top;
      metadataOnly = true;
      rows.at(-1).cameraTies = [0, -1e-9, 1e-9].map(drift => {
        c.setTransform(scale, 0, 0, scale, drift, -drift);
        const returned = spec.run(tieX, tieY), draw = calls.at(-1);
        return { drift, x: draw.x * draw.a + draw.e, y: draw.y * draw.d + draw.f, smoothing: draw.smoothing,
          hitMatches: !spec.airport || returned.x === draw.x && returned.y === draw.y && returned.w === draw.w && returned.h === draw.h };
      });
      metadataOnly = false;
    }
    return { rows, cache: cache.getStats() };
  });
  for (const row of result.rows) {
    const draw = row.native;
    assert.equal(row.painted, true, `${row.name} paints authored or native static artwork`);
    assert.equal(draw.smoothing, false, `${row.name} retains prepared antialiasing`);
    assert.ok(Math.abs(draw.width - draw.w * draw.a) < 1e-6 && Math.abs(draw.height - draw.h * draw.d) < 1e-6, `${row.name} copies at native resolution`);
    assert.ok(Math.abs(draw.x * draw.a + draw.e - Math.round(draw.x * draw.a + draw.e)) < 1e-6 && Math.abs(draw.y * draw.d + draw.f - Math.round(draw.y * draw.d + draw.f)) < 1e-6, `${row.name} aligns actual physical pixels`);
    if (row.returned) assert.deepEqual(row.returned, { x: draw.x, y: draw.y, w: draw.w, h: draw.h }, `${row.name} returns the actual drawn hit bounds`);
    assert.equal(row.restored, true, 'local native sampling restores its caller');
    assert.equal(row.reused, true, 'stationary artwork reuses its preparation');
    assert.equal(row.preview.smoothing, true, 'resized menu previews retain high-quality filtering');
    for (const tie of row.cameraTies) {
      assert.ok(Math.abs(tie.x - row.cameraTies[0].x) < 1e-6 && Math.abs(tie.y - row.cameraTies[0].y) < 1e-6, `${row.name} keeps half-pixel anchors stable under integer camera drift`);
      assert.equal(tie.smoothing, false, `${row.name} keeps native sampling at camera ties`);
      assert.equal(tie.hitMatches, true, `${row.name} keeps camera-tie hit bounds aligned`);
    }
  }
  assert.ok(result.cache.bytes <= result.cache.limit); assert.deepEqual(errors, []);
  await page.screenshot({ path: `${output}/fractional-static-sprites.png` });
  await writeFile(`${output}/results.json`, JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ staticProfiles: result.rows.length, resizedProfiles: result.rows.length, cameraTieProfiles: result.rows.length * 3, errors }));
} finally { await browser.close(); }
