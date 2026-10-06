// Every commerce identity is regenerated, including a dedicated town workshop.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-commerce-camera-qa';
await mkdir(output, { recursive: true });
const errors = [], integrity = [];
try {
  {
    const page = await browser.newPage({ viewport: { width: 720, height: 560 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/commerce-camera-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto(new URL('commerce-camera-qa', base).href);
    const result = await page.evaluate(async () => {
      const atlas = await import('./atlas-runtime.js');
      await atlas.preloadWorldArt({ waitMs: 12000 });
      if (atlas.worldArtStats().errors.length) throw Error('Registered artwork failed to decode');
      const load = async url => { const im = new Image(); im.src = url; await im.decode(); return im; };
      const integrity = [];
      const make = (w, h) => { const a = document.createElement('canvas'); a.width = w; a.height = h; return a; };
      for (const biome of ['taiga', 'tundra', 'desert']) {
        const oldPath = `assets/world/buildings-commerce/${biome}`, newPath = `assets/world/buildings-commerce-camera-v2/${biome}`;
        const meta = await fetch(`${newPath}/atlas.json`).then(r => r.json());
        for (const size of [16, 32, 64, 128, 256]) {
          const old = await load(`${oldPath}/atlas-${size}.png`), next = await load(`${newPath}/atlas-${size}.png`), a = make(size, size), ac = a.getContext('2d', { willReadFrequently: true });
          for (let index = 0; index < 9; index++) {
            const crop = im => { ac.clearRect(0, 0, size, size); ac.drawImage(im,index%3*size,Math.floor(index/3)*size,size,size,0,0,size,size);return ac.getImageData(0,0,size,size).data; };
            const before = crop(old), after = crop(next);let changed = 0;
            for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed++;
            integrity.push({ biome, size, id: meta.order[index], changed, expectedChange: true });
          }
        }
      }
      return {integrity,stats:atlas.worldArtStats()};
    });
    integrity.push(...result.integrity);await page.close();
  }
  for(const row of integrity){assert.ok(row.id,`${row.biome}/${row.size}: every commerce cell has an identity`);assert.ok(row.changed>0,`${row.biome}/${row.id}/${row.size}: regenerated artwork replaces every original cell`);}
  assert.equal(integrity.length,135);assert.deepEqual(errors,[]);
  await writeFile(`${output}/results.json`,JSON.stringify({integrity,errors},null,2));console.log(JSON.stringify({verifiedCells:integrity.length,unchangedCells:integrity.filter(r=>!r.expectedChange).length,errors},null,2));
} finally { await browser.close(); }
