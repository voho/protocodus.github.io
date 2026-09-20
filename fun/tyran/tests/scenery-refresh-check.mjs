// A damage change redraws its neighborhood while preserving full-rebuild pixels.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
// A software reference avoids GPU readback rounding between independent canvases;
// production keeps the scenery canvases GPU backed (covered by destruction-save).
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true, args: ['--disable-accelerated-2d-canvas'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('worlds.js', process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/').href);
  await page.setContent('');
  const result = await page.evaluate(async () => {
    const { WorldRenderer, structureStage } = await import('./worlds.js');
    const structures = new Set(['temple','ruin','bunker','station','radar','dome','solar','refinery','building','tower','pylon','fortress','hut','satellite','crawler','hauler']);
    const world = new WorldRenderer(); await world.ready;
    world.warmEpoch++; world.warmJobs.length = 0; world.queueWarm = () => {};
    const prototype = OffscreenCanvasRenderingContext2D.prototype;
    const drawImage = prototype.drawImage;
    let draws = 0;
    prototype.drawImage = function (...args) { draws++; return drawImage.apply(this, args); };
    const checks = [], pixels = source => new Uint32Array(source.getContext('2d').getImageData(0, 0, source.width, source.height).data.buffer);
    try {
      for (let sector = 0; sector < 10; sector++) {
        world.setWorld(sector, 'scenery-refresh-qa');
        const props = Array.from({ length: 5 }, (_, n) => world.getBand(n - 3)).flat();
        const boundary = [...props].sort((a, b) => Math.min(a.y - a.row * 800, (a.row + 1) * 800 - a.y) - Math.min(b.y - b.row * 800, (b.row + 1) * 800 - b.y))[0];
        const structural = props.filter(p => structures.has(p.type)).sort((a, b) => b.size - a.size)[0];
        const natural = props.find(p => !structures.has(p.type));
        for (const target of [...new Set([boundary, structural, natural].filter(Boolean))]) {
          const band = world.getBand(target.row);
          world.getSceneryLayer(target.row, band);
          world.scale = 1; world.scroll = 400 - target.y; world.parallaxX = 0;
          for (const fraction of [.4, .4, .3]) {
            const before = world.getSceneryLayer(target.row, band);
            world.hit(target.x, 400, 0, target.maxHp * fraction);
            if (!world.sceneryDirty.has(target.row)) continue;
            // Exclude preparation of a previously unseen appearance from redraw counts.
            for (const p of band) world.getSprite(p.type, p.variant, structures.has(p.type) ? structureStage(p) : 0);
            draws = 0;
            const patched = world.getSceneryLayer(target.row, band), patchDraws = draws, actual = pixels(patched);
            world.sceneryLayers[0].delete(target.row);
            draws = 0;
            const rebuilt = world.getSceneryLayer(target.row, band), rebuildDraws = draws, expected = pixels(rebuilt);
            let changedPixels = 0;
            for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) changedPixels++;
            checks.push({ sector, type: target.type, stage: structureStage(target), reused: before === patched, changedPixels, patchDraws, rebuildDraws });
          }
        }
      }
    } finally { prototype.drawImage = drawImage; }

    world.setWorld(0, 'turret-scan-qa');
    const expected = [], bands = [-1, 0, 1].map(row => world.getBand(row));
    let inspected = 0;
    for (const band of bands) for (const prop of band) {
      if (prop.groundRole === 'turret' && prop.hp > 0 && prop.y >= -140 && prop.y <= 1040) expected.push(prop.id);
      let hp = prop.hp;
      Object.defineProperty(prop, 'hp', { get() { inspected++; return hp; }, set(value) { hp = value; }, configurable: true });
    }
    const targets = world.getGroundTargets(1200, 900, 0).map(target => target.id);
    const considered = bands.reduce((count, band) => count + band.length, 0);
    const cachedDetails = world.getGroundDetails(0) === world.getGroundDetails(0);
    const surface = new OffscreenCanvas(1200, 900);
    world.draw(surface.getContext('2d'), 1200, 900, 90000, 0, 'low');
    const bounded = world.bands.size <= 5 && world.sceneryDirty.size === 0;
    return { checks, targets, expected, inspected, considered, cachedDetails, bounded, memory: world.memoryStats() };
  });
  assert.ok(result.checks.length >= 50, 'Damage refresh covers every biome, natural objects, structures and band edges');
  for (const check of result.checks) {
    assert.equal(check.changedPixels, 0, `${check.sector}:${check.type}:${check.stage} matches a full rebuild pixel for pixel`);
    assert.equal(check.reused, true, 'The existing scenery strip survives a damage change');
  }
  const patchDraws = result.checks.reduce((sum, check) => sum + check.patchDraws, 0);
  const rebuildDraws = result.checks.reduce((sum, check) => sum + check.rebuildDraws, 0);
  assert.ok(patchDraws < rebuildDraws * .4, 'Local damage avoids at least 60% of scenery image draws');
  assert.deepEqual(result.targets, result.expected, 'Mounted-gun indexing preserves ground-target order and coordinates');
  assert.ok(result.inspected < result.considered / 4, 'Ground queries inspect mounted guns instead of every scenery prop');
  assert.equal(result.cachedDetails, true, 'Seeded decoration geometry is reused between damage changes');
  assert.equal(result.bounded, true, 'Streaming evicts old decoration geometry and pending dirty regions');
  assert.ok(result.memory.scratchBytes <= 7 * 1024 ** 2, 'All shared scenery scratch surfaces stay below 7 MiB');
  assert.deepEqual(errors, []);
  console.log(`PASS ${result.checks.length} pixel-exact damage refreshes: ${patchDraws}/${rebuildDraws} image draws (${(100 * (1 - patchDraws / rebuildDraws)).toFixed(1)}% fewer); turret scans ${result.inspected}/${result.considered} props.`);
} finally { await browser.close(); }
