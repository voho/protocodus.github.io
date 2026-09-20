// Serve the repository, then run with TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  const result = await page.evaluate(async () => {
    const { WorldRenderer, structureStage } = await import('./worlds.js');
    const { createCampaign } = await import('./sim.js');
    const { serializeRun, restoreRun } = await import('./save-game.js');
    const { Effects } = await import('./effects.js');
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 900;
    const context = canvas.getContext('2d');
    const findProp = (world, types) => {
      for (let row = -1; row >= -40; row--) {
        const found = world.getBand(row).find(prop => types.includes(prop.type) && prop.x > 150 && prop.x < 1050);
        if (found) return found;
      }
      throw new Error(`No scenery fixture: ${types.join(', ')}`);
    };
    const freshWorld = async index => {
      const world = new WorldRenderer(); world.setWorld(index, 'destruction-persistence'); await world.ready;
      return world;
    };
    const pixelHash = (world, prop) => {
      const source = world.getSceneryLayer(prop.row, world.getBand(prop.row), prop.depth);
      const crop = document.createElement('canvas'); crop.width = crop.height = 160;
      const c = crop.getContext('2d');
      c.drawImage(source, prop.x + 100 - 80, prop.y - prop.row * 800 + 140 - 80, 160, 160, 0, 0, 160, 160);
      const bytes = c.getImageData(0, 0, 160, 160).data;
      let hash = 2166136261;
      for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      return hash;
    };
    const world = await freshWorld(0), target = findProp(world, ['temple', 'bunker', 'station']);
    const scroll = 450 - target.y, stages = [];
    for (let expected = 0; expected < 4; expected++) {
      world.draw(context, 1200, 900, scroll, 0, 'high');
      if (expected) world.hit(target.screenX, target.screenY, 0, target.maxHp * (expected === 3 ? .3 : .4), scroll);
      world.draw(context, 1200, 900, scroll, 0, 'high');
      const hash = pixelHash(world, target);
      const run = restoreRun(serializeRun(createCampaign(1, 0), { seed: world.seed, damage: world.damage, destroyed: world.destroyed }));
      const loaded = await freshWorld(0); loaded.restoreDamage(run.damage, run.destroyed, run.sceneryVersion);
      loaded.draw(context, 1200, 900, scroll, 0, 'high');
      const first = loaded.getBand(target.row).find(prop => prop.id === target.id);
      const savedHp = first.hp, savedStage = structureStage(first), savedHash = pixelHash(loaded, first);
      loaded.draw(context, 1200, 900, 150000, 0, 'high');
      loaded.draw(context, 1200, 900, scroll, 0, 'high');
      const regenerated = loaded.getBand(target.row).find(prop => prop.id === target.id);
      const view = loaded.layerViews[regenerated.depth];
      const x = regenerated.x * view.zoom + view.x, y = regenerated.y * view.zoom + view.y;
      const paidTwice = expected === 3 && loaded.hit(x, y, 0, 100000, scroll).some(event => event.id === regenerated.id);
      stages.push({ expected, stage: structureStage(target), savedStage, restoredStage: structureStage(regenerated),
        healthPreserved: Math.abs(target.hp - savedHp) < 1e-9 && Math.abs(savedHp - regenerated.hp) < 1e-9,
        evicted: first !== regenerated, hash, savedHash, paidTwice, sceneryVersion: run.sceneryVersion });
    }
    const cachedWorld = await freshWorld(0), cachedTarget = findProp(cachedWorld, ['temple', 'bunker', 'station']);
    const cachedScroll = 450 - cachedTarget.y, cacheTransitions = [];
    cachedWorld.draw(context, 1200, 900, cachedScroll, 0, 'high');
    // Isolate this collider so nearby foliage cannot invalidate the same strip.
    for (const [key, bucket] of cachedWorld.hitBuckets) cachedWorld.hitBuckets.set(key, bucket.filter(prop => prop.id === cachedTarget.id));
    for (const [fraction, crossesStage] of [[.01, false], [.30, true], [.01, false], [.34, true], [.01, false], [.35, true]]) {
      const cache = cachedWorld.sceneryLayers[cachedTarget.depth], before = cache.get(cachedTarget.row);
      cachedWorld.hit(cachedTarget.screenX, cachedTarget.screenY, 0, cachedTarget.maxHp * fraction, cachedScroll);
      const invalidated = cachedWorld.sceneryDirty.has(cachedTarget.row);
      cachedWorld.draw(context, 1200, 900, cachedScroll, 0, 'high');
      cacheTransitions.push({ crossesStage, invalidated, reused: before === cache.get(cachedTarget.row) });
    }
    // Original structure membership matters: ruins and vehicles formerly used
    // the same linear health as natural scenery, despite their new armor.
    const oldStructures = new Set(['temple', 'bunker', 'station', 'radar', 'dome', 'solar', 'refinery', 'building', 'tower', 'pylon', 'fortress', 'hut', 'satellite']);
    const migrations = [];
    for (const fixture of [
      { index: 0, types: ['temple', 'bunker'], fraction: .84 },
      { index: 0, types: ['ruin'], fraction: .54 },
      { index: 0, types: ['tree', 'fern'], fraction: .22 },
      { index: 5, types: ['crawler', 'hauler'], fraction: .54 },
    ]) {
      const original = await freshWorld(fixture.index), prop = findProp(original, fixture.types);
      const oldMaxHp = oldStructures.has(prop.type) ? 45 + prop.size * .45 : 12 + prop.size * .22;
      const record = JSON.parse(serializeRun(createCampaign(1, fixture.index), { seed: original.seed, damage: new Map([[prop.id, oldMaxHp * fixture.fraction]]) }));
      delete record.sceneryVersion;
      const run = restoreRun(record), loaded = await freshWorld(fixture.index);
      loaded.restoreDamage(run.damage, run.destroyed, run.sceneryVersion);
      const migrated = loaded.getBand(prop.row).find(candidate => candidate.id === prop.id);
      const newRun = restoreRun(serializeRun(run.state, { seed: loaded.seed, damage: loaded.damage, destroyed: loaded.destroyed }));
      const reloaded = await freshWorld(fixture.index); reloaded.restoreDamage(newRun.damage, newRun.destroyed, newRun.sceneryVersion);
      const again = reloaded.getBand(prop.row).find(candidate => candidate.id === prop.id);
      migrations.push({ type: prop.type, expected: fixture.fraction, fraction: migrated.hp / migrated.maxHp,
        stable: migrated.hp === again.hp, oldVersion: run.sceneryVersion, newVersion: newRun.sceneryVersion });
    }
    const fx = new Effects(); fx.emit({ type: 'explosion', x: 400, y: 330, size: 20, ground: true }, 200, 10);
    const groundWrecks = fx.wrecks.length;
    fx.emit({ type: 'explosion', x: 400, y: 330, size: 20 }, 200, 10);
    const positions = [], drawImage = context.drawImage;
    context.drawImage = function (...args) { const { e, f } = this.getTransform(); positions.push([e, f]); return drawImage.apply(this, args); };
    fx.drawGround(context, 240, 900, -8); context.drawImage = drawImage;
    return { stages, cacheTransitions, migrations, groundWrecks, positions };
  });
  for (const stage of result.stages) {
    assert.equal(stage.stage, stage.expected, 'hits advance the intended damage stage');
    assert.equal(stage.savedStage, stage.expected, 'save/load preserves the damage stage');
    assert.equal(stage.restoredStage, stage.expected, 'cache eviction preserves the damage stage');
    assert.equal(stage.healthPreserved, true, 'absolute HP survives current-format saves');
    assert.equal(stage.evicted, true, 'fixture actually regenerates the scenery band');
    assert.equal(stage.hash, stage.savedHash, 'restored damage uses the same raster stage');
    assert.equal(stage.paidTwice, false, 'saved craters cannot pay destruction rewards again');
    assert.equal(stage.sceneryVersion, 2);
  }
  assert.equal(new Set(result.stages.map(stage => stage.hash)).size, 4, 'fresh, light, heavy and crater stages visibly differ');
  for (const transition of result.cacheTransitions) {
    assert.equal(transition.invalidated, transition.crossesStage, 'a structural hit marks a dirty region only when its stage changes');
    assert.equal(transition.reused, true, 'damage refreshes the existing raster strip in place');
  }
  for (const migration of result.migrations) {
    assert.ok(Math.abs(migration.fraction - migration.expected) < 1e-9, `${migration.type}: legacy remaining-health percentage survives stronger armor`);
    assert.equal(migration.stable, true, `${migration.type}: migration runs only once`);
    assert.equal(migration.oldVersion, 1); assert.equal(migration.newVersion, 2);
  }
  assert.equal(result.groundWrecks, 0, 'ground explosions leave crater ownership to the scenery renderer');
  assert.deepEqual(result.positions, [[382, 370]], 'ship wrecks remain anchored to the tile-ground scroll and lateral offset');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('PASS four destruction stages, save/load and eviction, legacy armor migration, and ground-effect alignment');
} finally { await browser.close(); }
