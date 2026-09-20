// Atlas frames stay shared; visiting new sectors cannot retain old derived fleets.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  await page.waitForFunction(() => window.tyran);
  const result = await page.evaluate(async () => {
    const { spritesReady, spriteMemory, spriteCell, spriteStatus } = await import('./sprite-assets.js');
    const { drawShip, warmShipSprites, shipSpriteMemory, SHIP_PALETTES } = await import('./ships.js');
    await spritesReady;
    const before = spriteMemory();
    const frames = [];
    for (const name of ['structures', 'structureLight', 'structureHeavy', 'structureCrater', 'effects']) {
      for (let index = 0; index < 16; index++) {
        const cell = spriteCell(name, index);
        if (!cell || cell.width < 4 || cell.height < 4) throw new Error(`Missing ${name}:${index} after atlas release`);
        frames.push({ name, index, cell });
      }
    }
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 384;
    const ctx = canvas.getContext('2d');
    const snapshot = () => {
      ctx.clearRect(0, 0, 384, 384);
      drawShip(ctx, 192, 192, 64, 9, null, 0, { world: 0, motion: false, hit: .3 });
      return canvas.toDataURL();
    };
    const imageBefore = snapshot();
    const cycles = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let world = 0; world < 10; world++) {
        warmShipSprites(SHIP_PALETTES[world], world);
        warmShipSprites('#a4ffee', world, true);
        warmShipSprites('#ffc18b', world, true);
      }
      cycles.push(shipSpriteMemory());
    }
    return {
      before, after: spriteMemory(), cycles,
      imagePreserved: snapshot() === imageBefore,
      framesReused: frames.every(({ name, index, cell }) => spriteCell(name, index) === cell),
      ready: Object.values(spriteStatus()).every(status => status.state === 'ready'),
    };
  });
  assert.equal(result.ready, true, 'Every source atlas prepared successfully');
  assert.equal(result.before.atlasCount, 0, 'Full decoded sheets are released after cell preparation');
  assert.equal(result.before.atlasBytes, 0, 'No duplicate full-sheet pixel buffers are retained');
  assert.ok(result.before.cellBytes < 80 * 1024 ** 2, 'Full-resolution shared source cells fit within 80 MiB');
  assert.deepEqual(result.after, result.before, 'Animation and fleet changes never duplicate source cells');
  assert.equal(result.framesReused, true, 'Damage and animation states reuse their prepared source canvases');
  assert.equal(result.imagePreserved, true, 'An evicted fleet regenerates pixel-identical hulls, shadows and lighting');
  for (const cycle of result.cycles) {
    assert.ok(cycle.estimatedBytes < 40 * 1024 ** 2, 'Derived ship artwork remains below 40 MiB across every sector');
    for (const [name, cache] of Object.entries(cycle.caches)) assert.ok(cache.count <= cache.limit, `${name} stays bounded`);
    assert.equal(cycle.caches.flames.count, 2, 'All fleet palettes share the same two exhaust textures');
  }
  assert.equal(result.cycles[1].estimatedBytes, result.cycles[2].estimatedBytes, 'Repeated sector visits cannot grow the ship cache');
  assert.deepEqual(errors, []);
  console.log(`Sprite memory QA passed: ${(result.before.estimatedBytes / 1024 ** 2).toFixed(1)} MiB shared sources, ${(result.cycles[2].estimatedBytes / 1024 ** 2).toFixed(1)} MiB bounded ship artwork, pixel-identical cache rebuilds.`);
} finally { await browser.close(); }
