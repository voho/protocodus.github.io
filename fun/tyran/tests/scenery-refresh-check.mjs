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
    const structures = new Set(['temple','ruin','bunker','station','radar','dome','solar','refinery','building','tower','pylon','fortress','hut','satellite']);
    const world = new WorldRenderer(); await world.ready;
    world.warmEpoch++; world.warmJobs.length = 0; world.queueWarm = () => {};
    const prototype = OffscreenCanvasRenderingContext2D.prototype;
    const drawImage = prototype.drawImage;
    let draws = 0;
    prototype.drawImage = function (...args) { draws++; return drawImage.apply(this, args); };
    const checks = [], protectedChecks = [], pixels = source => new Uint32Array(source.getContext('2d').getImageData(0, 0, source.width, source.height).data.buffer);
    try {
      for (const density of [1, 2]) for (let sector = 0; sector < 10; sector++) {
        world.setWorld(sector, 'scenery-refresh-qa');
        world.setDetailScale(density === 2 ? 2400 : 1200, 'high');
        const props = Array.from({ length: 5 }, (_, n) => world.getBand(n - 3)).flat();
        const buildings = props.filter(p => structures.has(p.type));
        const boundary = [...buildings].sort((a, b) => Math.min(a.y - a.row * 800, (a.row + 1) * 800 - a.y) - Math.min(b.y - b.row * 800, (b.row + 1) * 800 - b.y))[0];
        const structural = [...buildings].sort((a, b) => b.size - a.size)[0];
        for (const target of [...new Set([boundary, structural].filter(Boolean))]) {
          const band = world.getBand(target.row);
          for (let row = target.row - 1; row <= target.row + 1; row++) world.getSceneryLayer(row, world.getBand(row));
          world.scale = 1; world.scroll = 400 - target.y; world.parallaxX = 0;
          for (const fraction of [.4, .4, .3]) {
            const before = new Map(world.sceneryLayers[0]);
            world.hit(target.x, 400, 0, target.maxHp * fraction);
            if (!world.sceneryDirty.has(target.row)) continue;
            // Exclude preparation of a previously unseen appearance from redraw counts.
            for (const p of band) world.getSprite(p.type, p.variant, structures.has(p.type) ? structureStage(p) : 0);
            for (const row of [...world.sceneryDirty.keys()]) {
              draws = 0;
              const patched = world.getSceneryLayer(row, world.getBand(row)), patchDraws = draws, actual = pixels(patched);
              world.sceneryLayers[0].delete(row);
              draws = 0;
              const rebuilt = world.getSceneryLayer(row, world.getBand(row)), rebuildDraws = draws, expected = pixels(rebuilt);
              let changedPixels = 0;
              for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) changedPixels++;
              checks.push({ density, sector, type: target.type, stage: structureStage(target), neighboring: row !== target.row,
                reused: before.get(row) === patched, changedPixels, patchDraws, rebuildDraws,
                opaque: actual.every(pixel => (pixel >>> 24) === 255), height: patched.height });
            }
          }
        }
        for (const target of [props.find(p => !structures.has(p.type) && p.type !== 'crawler' && p.type !== 'hauler'), props.find(p => p.type === 'crawler'), props.find(p => p.type === 'hauler')].filter(Boolean)) {
          const hp = target.hp;
          world.scale = 1; world.scroll = 400 - target.y; world.parallaxX = 0;
          const events = world.hit(target.x, 400, 0, 100000);
          protectedChecks.push({ density, sector, type: target.type, unchanged: target.hp === hp && !world.damage.has(target.id) && !world.destroyed.has(target.id) && !events.some(event => event.id === target.id) });
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
    return { checks, protectedChecks, targets, expected, inspected, considered, cachedDetails, bounded, memory: world.memoryStats() };
  });
  assert.ok(result.checks.length >= 60, 'Damage refresh covers every biome and both strip densities, including large buildings and band edges');
  assert.deepEqual([...new Set(result.checks.map(check => check.density))], [1, 2]);
  assert.ok(result.checks.some(check => check.neighboring), 'Damage crossing a strip boundary refreshes the neighboring fused ground too');
  assert.ok(result.protectedChecks.length >= 20, 'Protected scenery is exercised in every biome at both densities');
  for (const check of result.protectedChecks) assert.ok(check.unchanged, `${check.density}x:${check.sector}:${check.type} survives direct damage without a reward or destruction record`);
  for (const check of result.checks) {
    assert.equal(check.changedPixels, 0, `${check.density}x:${check.sector}:${check.type}:${check.stage} matches a full rebuild pixel for pixel`);
    assert.equal(check.reused, true, 'The existing scenery strip survives a damage change');
    assert.equal(check.opaque, true, 'Fused scenery includes opaque terrain throughout the strip');
    assert.equal(check.height, 800 * check.density, 'Opaque strips contain only their central world region, with no overlapping opaque padding');
  }
  const patchDraws = result.checks.reduce((sum, check) => sum + check.patchDraws, 0);
  const rebuildDraws = result.checks.reduce((sum, check) => sum + check.rebuildDraws, 0);
  assert.ok(patchDraws < rebuildDraws * .4, 'Local damage avoids at least 60% of scenery image draws');
  assert.deepEqual(result.expected, [], 'Generated buildings never regain retired ground-gun roles');
  assert.deepEqual(result.targets, [], 'Legacy ground-target queries remain empty');
  assert.ok(result.inspected < result.considered / 4, 'Retired ground-target queries do not inspect every scenery prop');
  assert.equal(result.cachedDetails, true, 'Seeded decoration geometry is reused between damage changes');
  assert.equal(result.bounded, true, 'Streaming evicts old decoration geometry and pending dirty regions');
  assert.ok(result.memory.scratchBytes <= 24 * 1024 ** 2, 'All shared scenery scratch surfaces stay below 24 MiB at high density');
  assert.deepEqual(errors, []);
  console.log(`PASS ${result.checks.length} pixel-exact damage refreshes: ${patchDraws}/${rebuildDraws} image draws (${(100 * (1 - patchDraws / rebuildDraws)).toFixed(1)}% fewer); turret scans ${result.inspected}/${result.considered} props.`);
} finally { await browser.close(); }
