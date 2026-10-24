// Serve repo root; TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node this file.
// Flying sector after sector must not pile stale textures onto the GPU: the renderer keeps the
// artwork of the sector being flown, not that of every sector since the page opened. Dropped
// sprites free their textures, so the cache stays far below its budget and never has to evict.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('tyran-muted', 'true'));
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
  assert.equal(await page.evaluate(() => tyran.renderer.backend), 'webgl2', 'the batched renderer is active');
  const sectors = await page.evaluate(async () => {
    const rows = [];
    for (let level = 0; level < 12; level++) {
      tyran.launch(level);
      await tyran.world.ready;
      // Let frames run so lazily created textures (effects, projectiles) upload too.
      await new Promise(resolve => setTimeout(resolve, 1000));
      const { textureBytes, textureCount, evictions } = tyran.renderer;
      rows.push({ level, textureBytes, textureCount, evictions });
    }
    return rows;
  });
  const MiB = 1024 ** 2, settled = sectors[2], last = sectors.at(-1);
  assert.equal(last.evictions, 0, 'twelve sectors never push the texture cache into eviction');
  assert.ok(last.textureBytes < 1.4 * settled.textureBytes, `texture bytes stay flat across sectors (${(settled.textureBytes / MiB).toFixed(1)} → ${(last.textureBytes / MiB).toFixed(1)} MiB)`);
  assert.ok(last.textureCount < 1.4 * settled.textureCount, `texture count stays flat across sectors (${settled.textureCount} → ${last.textureCount})`);
  assert.ok(last.textureBytes < 128 * MiB, 'one sector of artwork fits comfortably in GPU memory');
  assert.deepEqual(errors, []);
  console.log(`GPU memory QA passed: ${(settled.textureBytes / MiB).toFixed(1)} MiB after three sectors, ${(last.textureBytes / MiB).toFixed(1)} MiB after twelve, no evictions.`);
} finally { await browser.close(); }
