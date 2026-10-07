// Construct complete flat farm cutouts from the actual game field geometry
// and registered painted 2x2 cores. Bare meadow/yard is RGBA transparent.
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const output = process.argv[2] || '/tmp/transport-farm-compounds';
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/farm-compound-qa', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto(new URL('farm-compound-qa', base).href);
  const result = await page.evaluate(async () => {
    const [{ FARM_CORE_KINDS, drawRasterFarmCore }, { preloadWorldArt }, fields, { SPRITE_SCALE }] = await Promise.all([
      import('./raster-industries.js'), import('./atlas-runtime.js'), import('./farm-fields-art.js'), import('./sprite-art-direction.js'),
    ]);
    await preloadWorldArt({ cells: [512], waitMs: 30000 });
    const cell = 512, span = 5, tile = 32, frame = SPRITE_SCALE.billboardPixelsPerTile * span, scale = cell / frame;
    const results = [];
    for (const kind of FARM_CORE_KINDS) {
      const site = { kind, x: 0, y: 0, footprint: span, variant: 0 };
      const image = Object.assign(document.createElement('canvas'), { width: cell, height: cell }), c = image.getContext('2d');
      // Ground centre is exactly the same 128,192 master datum as industry.
      const origin = [frame / 2, frame * .75 - span * tile / 2];
      const project = (u, v) => ({ x: origin[0] + (u - v) * tile, y: origin[1] + (u + v) * tile / 2 });
      c.scale(scale, scale);
      c.save(); c.transform(1, .5, -1, .5, ...origin);
      fields.paintFarmFields(c, { x0: 0, y0: 0, x1: span, y1: span }, () => site, 'taiga', 0, { transparentGround: true }); c.restore();
      const objects = [];
      for (let y = 0; y < span; y++) for (let x = 0; x < span; x++) {
        for (const section of fields.farmFenceSections(site, x, y)) objects.push({ depth: (section.a[0] + section.a[1] + section.b[0] + section.b[1]) / 2, draw: () => fields.paintFarmFence(c, section, project, 'taiga') });
        for (const object of fields.farmFieldObjects(site, x, y, 0)) objects.push({ depth: object.x + object.y, draw: () => fields.paintFarmFieldObject(c, object, project(object.x, object.y), 'taiga') });
      }
      objects.push({ depth: 5, draw: () => {
        const p = project(2, 2), size = SPRITE_SCALE.billboardPixelsPerTile * 2;
        c.save(); c.translate(p.x - size / 2, p.y - size * .75);
        if (!drawRasterFarmCore(c, kind, 'taiga', scale, { size })) throw Error(`Missing painted farm core ${kind}`);
        c.restore();
      } });
      objects.sort((a, b) => a.depth - b.depth); for (const object of objects) object.draw();
      const edges = [[.12, .12], [4.88, .12], [4.88, 4.88], [.12, 4.88]].map(([u, v]) => { const p = project(u, v); return [p.x * scale, p.y * scale]; });
      results.push({ kind, data: image.toDataURL('image/png').split(',')[1], sourceCellPixels: cell, groundVerticesSource: edges, groundCenterSource: [cell / 2, cell * .75], coreSourceOrigin: [(project(2, 2).x - 72) * scale, (project(2, 2).y - 108) * scale], coreMasterToCompoundSourceScale: 144 / 256 * scale });
    }
    return results;
  });
  for (const entry of result) { await writeFile(`${output}/${entry.kind}.png`, Buffer.from(entry.data, 'base64')); delete entry.data; }
  await writeFile(`${output}/geometry.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, farms: result.length }));
} finally { await browser.close(); }
