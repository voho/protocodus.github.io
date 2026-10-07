// Review every current architectural cutout on several unrelated textures.
// Authored alpha, rather than a terrain colour, must control compositing.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-building-plot-alpha';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [], failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failures.push(response.url()); });
  await page.route('**/plot-alpha-qa', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto(new URL('plot-alpha-qa', base).href);
  const result = await page.evaluate(async () => {
    const [{ PLOT_BUILDING_ATLASES }, { createSprites }, { preloadWorldArt }, { preloadHouses }, { drawRasterFarmCore }, { SPRITE_SCALE, buildingGroundEnvelope }] = await Promise.all([
      import('./plot-building-catalog.js'), import('./sprites.js'), import('./atlas-runtime.js'), import('./raster-houses.js'), import('./raster-industries.js'), import('./sprite-art-direction.js'),
    ]);
    await Promise.all([preloadWorldArt({ cells: [256, 512], waitMs: 30000 }), preloadHouses({ cells: [256, 512], waitMs: 30000 })]);
    const load = url => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = url; });
    const canvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
    const rows = [], captures = [];
    const colours = [[103, 132, 72], [189, 202, 191], [197, 167, 115], [68, 107, 140]];
    const density = SPRITE_SCALE.billboardPixelsPerTile / 32;
    for (const atlas of PLOT_BUILDING_ATLASES) {
      const image = await load(new URL(`${atlas.path}-256.png`, location.href));
      const original = canvas(image.width, image.height), oc = original.getContext('2d'); oc.drawImage(image, 0, 0);
      const out = canvas(atlas.columns * 256, atlas.rows * 256 * colours.length), context = out.getContext('2d');
      for (let texture = 0; texture < colours.length; texture++) {
        const offset = texture * atlas.rows * 256, pixels = context.createImageData(out.width, atlas.rows * 256);
        for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
          const n = (y * pixels.width + x) * 4, grain = ((x * 13 + y * 17 + (x ^ y) * 7) % 13) - 6;
          colours[texture].forEach((value, channel) => { pixels.data[n + channel] = value + grain; }); pixels.data[n + 3] = 255;
        }
        context.putImageData(pixels, 0, offset); context.drawImage(image, 0, offset);
      }
      for (let index = 0; index < atlas.entries.length; index++) {
        const entry = atlas.entries[index], x = index % atlas.columns * 256, y = Math.floor(index / atlas.columns) * 256;
        const alpha = oc.getImageData(x, y, 256, 256).data;
        if (!entry) { rows.push({ atlas: atlas.id, empty: true, meaningful: alpha.filter((value, n) => n % 4 === 3 && value > 8).length }); continue; }
        let zero = 0, opaque = 0, transparentMatches = 0, opaqueMatches = 0, groundZero = 0, groundPixels = 0;
        const ground = buildingGroundEnvelope(entry.footprint), cx = 128, cy = 192, halfWidth = ground[1][0] - cx;
        const rendered = colours.map((_, texture) => context.getImageData(x, y + texture * atlas.rows * 256, 256, 256).data);
        for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
          const n = (py * 256 + px) * 4, a = alpha[n + 3];
          if (py >= cy && py < cy + halfWidth / 2 - Math.abs(px - cx) / 2) { groundPixels++; if (a === 0) groundZero++; }
          if (a === 0) {
            zero++;
            for (let texture = 0; texture < colours.length; texture++) {
              const gx = x + px, gy = y + py, grain = ((gx * 13 + gy * 17 + (gx ^ gy) * 7) % 13) - 6;
              if (colours[texture].every((value, channel) => rendered[texture][n + channel] === value + grain)) transparentMatches++;
            }
          } else if (a >= 250) {
            opaque++;
            // Generated PNG interiors can have alpha 254 rather than 255.
            // Browser premultiplication and that tiny background contribution
            // can change a channel by a few units, while the artwork stays solid.
            for (const pixels of rendered) if ([0, 1, 2].every(channel => Math.abs(pixels[n + channel] - alpha[n + channel]) <= 6)) opaqueMatches++;
          }
        }
        const biome = entry.eligibleBiomes[0], options = { pixelScale: density, detailLevel: 'town', gardenGround: 'terrain' };
        let sprite;
        if (atlas.type === 'farm-core') {
          sprite = canvas(SPRITE_SCALE.billboardPixelsPerTile * 2, SPRITE_SCALE.billboardPixelsPerTile * 2 + SPRITE_SCALE.billboardPixelsPerTile / 4); const c = sprite.getContext('2d'); c.scale(density, density); c.translate(0, 8);
          if (!drawRasterFarmCore(c, entry.kind, biome, density)) throw Error(`Missing core ${entry.kind}`);
        } else {
          const variant = atlas.type === 'house' ? entry.design * 6 + entry.rotation : (entry.design || 0) * 5;
          sprite = createSprites(biome, options)(entry.kind, variant, atlas.type === 'industry' ? entry.footprint : 1, '', entry.footprint);
        }
        rows.push({ atlas: atlas.id, kind: entry.kind, footprint: entry.footprint, zero, opaque, transparentMatches, opaqueMatches, textures: colours.length, groundZero, groundPixels, spriteWidth: sprite.width, spriteHeight: sprite.height });
      }
      captures.push({ id: atlas.id, data: out.toDataURL('image/png').split(',')[1] });
    }
    return { rows, captures, frame: SPRITE_SCALE.billboardPixelsPerTile };
  });
  for (const row of result.rows) {
    if (row.empty) { assert.equal(row.meaningful, 0, `${row.atlas}: empty slot remains clear`); continue; }
    const name = `${row.atlas}/${row.kind}`;
    assert.ok(row.zero > 1024 && row.opaque > 300, `${name}: real cutout contains both clear and opaque pixels`);
    assert.equal(row.transparentMatches, row.zero * row.textures, `${name}: every alpha-zero pixel reveals each texture exactly`);
    assert.equal(row.opaqueMatches, row.opaque * row.textures, `${name}: architecture is unchanged by the terrain texture`);
    assert.equal(row.spriteWidth, result.frame * row.footprint, `${name}: shared full-plot billboard width`);
    assert.equal(row.spriteHeight, result.frame * row.footprint + result.frame / 4, `${name}: shared registered top gutter`);
  }
  const entries = result.rows.filter(row => !row.empty);
  assert.equal(entries.length, 132, 'every current design, rotation, civic identity, industry and farm core is reviewed');
  for (const capture of result.captures) await writeFile(`${output}/${capture.id}.png`, Buffer.from(capture.data, 'base64'));
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ rows: result.rows, errors, failures }, null, 2));
  console.log(JSON.stringify({ entries: entries.length, textures: 4, output }));
} finally { await browser.close(); }
