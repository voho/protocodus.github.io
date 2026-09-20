// Verify bounded raster state, exact regeneration and compatibility with old saves.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  await page.waitForFunction(() => window.tyran);
  await page.waitForFunction(() => !tyran.world.warmJobs.length);
  const result = await page.evaluate(async () => {
    const { WorldRenderer, structureStage } = await import('./worlds.js');
    const { serializeRun, restoreRun } = await import('./save-game.js');
    const { createCampaign } = await import('./sim.js');
    const world = tyran.world, initial = world.memoryStats();
    const hash = sprite => {
      const pixels = sprite.getContext('2d').getImageData(0, 0, sprite.width, sprite.height).data;
      let value = 2166136261;
      for (const byte of pixels) value = Math.imul(value ^ byte, 16777619) >>> 0;
      return value;
    };
    const before = hash(world.getSprite('temple', 0, 1));
    let maxDamageSprites = 0;
    for (const type of ['temple','bunker','station','radar','dome','solar','refinery','tower']) {
      for (let variant = 0; variant < 5; variant++) for (let stage = 1; stage <= 3; stage++) {
        world.getSprite(type, variant, stage);
        maxDamageSprites = Math.max(maxDamageSprites, world.memoryStats().damageSpriteCount);
      }
    }
    const evicted = !world.sprites.has('temple:0:1');
    const regenerated = hash(world.getSprite('temple', 0, 1));
    const loaded = new WorldRenderer(); await loaded.ready;
    let target;
    for (let row = 0; row >= -20 && !target; row--) target = loaded.getBand(row).find(prop => ['temple', 'bunker'].includes(prop.type) && prop.x > 150 && prop.x < 1050);
    if (!target) throw new Error('Missing structure fixture');
    const row = target.row;
    const injured = loaded.getBand(row).find(prop => prop.id !== target.id && prop.x > 150 && prop.x < 1050);
    loaded.restoreDamage(new Map([[target.id, 0], [injured.id, injured.maxHp * .54]]), new Set([target.id]));
    const prop = loaded.getBand(row).find(prop => prop.id === target.id);
    const normalized = !loaded.damage.has(target.id) && loaded.destroyed.has(target.id) && prop.hp === 0;
    const run = restoreRun(serializeRun(createCampaign(), { damage: loaded.damage, destroyed: loaded.destroyed }));
    const restored = new WorldRenderer(); await restored.ready;
    restored.restoreDamage(run.damage, run.destroyed, run.sceneryVersion);
    const dead = restored.getBand(row).find(prop => prop.id === target.id);
    const living = restored.getBand(row).find(prop => prop.id === injured.id);
    const persisted = structureStage(dead) === 3 && living.hp === injured.maxHp * .54;
    const surface = new OffscreenCanvas(1200, 900);
    const scroll = 450 - dead.y;
    restored.draw(surface.getContext('2d'), 1200, 900, scroll, 0);
    const paidTwice = restored.hit(dead.x, dead.y + scroll, 0, 1e6).some(hit => hit.id === dead.id);
    // Cross every HP boundary of a live fixture and ensure terminal state is stored once.
    const hits = [];
    for (const bucket of restored.hitBuckets.values()) bucket.splice(0, bucket.length, ...bucket.filter(p => p.id === living.id));
    restored.hit(living.x, living.y + scroll, 0, living.maxHp);
    hits.push(restored.damage.has(living.id), restored.destroyed.has(living.id));
    return { initial, maxDamageSprites, evicted, samePixels: before === regenerated, normalized, persisted, paidTwice, hits,
      final: world.memoryStats() };
  });
  assert.equal(result.initial.damageSpriteCount, 0, 'untouched world does not prebuild destruction art');
  assert.ok(result.initial.spriteBytes < 15 * 1024 * 1024, 'fresh jungle scenery retains under 15 MiB (previously 36 MiB)');
  assert.equal(result.maxDamageSprites, result.final.damageSpriteLimit);
  assert.equal(result.evicted, true);
  assert.equal(result.samePixels, true, 'evicted damage art regenerates pixel-exactly');
  assert.equal(result.normalized, true, 'old duplicate destruction records use a single crater marker');
  assert.equal(result.persisted, true, 'exact HP and crater state survive save/load');
  assert.equal(result.paidTwice, false);
  assert.deepEqual(result.hits, [false, true], 'new destruction removes obsolete HP state');
  assert.deepEqual(errors, []);
  console.log('PASS lazy destruction art, bounded cache, pixel-exact regeneration and single crater records');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
