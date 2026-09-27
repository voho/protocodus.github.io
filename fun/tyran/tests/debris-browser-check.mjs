// Debris is completely retired; explosions and cleared building sites remain visible and cached.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage(), errors = [], lateRequests = [], retiredRequests = [];
let ready = false;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (/debris-sprites|structure-crater/.test(request.url())) retiredRequests.push(request.url());
  if (ready && /^(https?:|blob:)/.test(request.url())) lateRequests.push(request.url());
});
await page.addInitScript(() => localStorage.setItem('tyran-muted', 'true'));
try {
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8774/fun/tyran/');
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true');
  ready = true; await context.setOffline(true);
  const result = await page.evaluate(async () => {
    const { Effects, warmEffectsTextures, effectTextureStats, warmGpuEffectTextures } = await import('./effects.js');
    const { WorldRenderer } = await import('./worlds.js');
    const { spriteCell, spriteStatus } = await import('./sprite-assets.js');
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    warmEffectsTextures();
    const sources = [];
    warmGpuEffectTextures({ prewarm(value) { sources.push(...(Array.isArray(value) ? value : [value])); } });
    check(sources.length > 0 && sources.every(source => source.width <= 512 && source.height <= 512), 'effect prewarm retains its ordinary sprites, without the large debris atlases');
    check(!('structureCrater' in spriteStatus()) && spriteCell('structureCrater', 0) === null, 'no crater atlas is prepared');
    for (let index = 10; index <= 13; index++) check(spriteCell('effects', index) === null, 'retired fragment frames are not retained');
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d');
    const fx = new Effects(), cases = [];
    check(!('wrecks' in fx) && !('drawGround' in fx) && !('debris' in effectTextureStats()), 'all wreck playback and atlas storage is gone');
    const allocations = { canvases: 0, gradients: 0, reads: 0 }, originals = [];
    const create = document.createElement, OriginalCanvas = window.OffscreenCanvas;
    document.createElement = function (name, ...args) { if (name === 'canvas') allocations.canvases++; return create.call(this, name, ...args); };
    if (OriginalCanvas) window.OffscreenCanvas = new Proxy(OriginalCanvas, { construct(target, args) { allocations.canvases++; return Reflect.construct(target, args); } });
    for (const proto of [CanvasRenderingContext2D.prototype, OffscreenCanvasRenderingContext2D.prototype]) for (const name of ['getImageData', 'createLinearGradient', 'createRadialGradient']) {
      const original = proto[name]; originals.push([proto, name, original]);
      proto[name] = function (...args) { allocations[name === 'getImageData' ? 'reads' : 'gradients']++; return original.apply(this, args); };
    }
    try {
      for (const quality of ['high', 'low']) for (const reduced of [false, true]) for (const event of [
        { type: 'explosion', size: 20 }, { type: 'explosion', size: 54, midboss: true },
        { type: 'explosion', size: 110, boss: true }, { type: 'explosion', size: 36, player: true },
        { type: 'explosion', size: 30, ground: true }, { type: 'phase', size: 60 },
        { type: 'weak-break', size: 40 },
      ]) {
        fx.reset(); fx.quality = quality; fx.reduced = reduced; fx.emit({ x: 320, y: 240, ...event });
        const surviving = { smoke: fx.particles.some(p => p.smoke), sparks: fx.particles.some(p => !p.smoke), fire: fx.lights.some(light => light.fire), rings: fx.rings.length };
        check(surviving.smoke && surviving.sparks && surviving.fire && surviving.rings > 0, 'every explosion keeps smoke, sparks, fire and shockwaves');
        for (let frame = 0; frame < 240; frame++) {
          check(fx.particles.every(p => ['debris', 'variant', 'spin', 'flip', 'angle'].every(key => !(key in p))), 'neither initial nor delayed bursts create fragment playback');
          if (frame % 20 === 0) fx.draw(ctx, 640, 480);
          fx.update(1 / 60);
        }
        check(Object.values(fx.memory.active).every(count => count === 0), 'explosions leave no permanent residue');
        cases.push({ quality, reduced, ...event, ...surviving });
      }
    } finally {
      document.createElement = create; window.OffscreenCanvas = OriginalCanvas;
      for (const [proto, name, original] of originals) proto[name] = original;
    }
    check(Object.values(allocations).every(count => count === 0), 'warmed playback performs no artwork allocation or pixel work');
    // Compare an actually destroyed building with the same seeded scene where
    // that building never draws. This catches foundations, craters and rubble.
    const world = new WorldRenderer(); world.setWorld(0, 'debris-removed'); await world.ready;
    let target;
    for (let row = -1; row >= -20 && !target; row--) target = world.getBand(row).find(prop => ['temple', 'bunker', 'station'].includes(prop.type) && prop.x > 160 && prop.x < 1000 && prop.y - row * 800 > 160 && prop.y - row * 800 < 640);
    check(target, 'a seeded building fixture exists');
    const band = world.getBand(target.row), copyPixels = source => {
      const d = world.detailScale;
      return source.getContext('2d').getImageData(Math.floor((target.x + 100 - 150) * d), Math.floor((target.y - target.row * 800 - 150) * d), 300 * d, 300 * d).data;
    };
    const expected = copyPixels(world.getSceneryLayer(target.row, band.filter(prop => prop !== target)));
    world.dirtyScenery(target); world.getSceneryLayer(target.row, band);
    world.prepareGround(1200, 900, 450 - target.y, 600);
    const hits = world.hit(target.x + world.parallaxX, 450, 0, target.maxHp * 2);
    check(hits.some(hit => hit.id === target.id), 'the fixture was destroyed by a real hit');
    const actual = copyPixels(world.getSceneryLayer(target.row, band));
    let difference = 0;
    for (let i = 0; i < expected.length; i++) difference = Math.max(difference, Math.abs(expected[i] - actual[i]));
    check(difference <= 1, `destroyed site must equal its original ground without the building: ${difference}`);
    check(world.destroyed.has(target.id) && !world.hit(target.x + world.parallaxX, 450, 0, 1e6).some(hit => hit.id === target.id), 'cleared sites retain their ledger and cannot pay twice');
    return { cases: cases.length, allocations, sourceCount: sources.length, emptySiteDifference: difference, textures: effectTextureStats() };
  });
  assert.equal(result.cases, 28);
  assert(result.textures.count <= 24);
  await page.evaluate(() => {
    tyran.launch(0, null, false); tyran.state.players.forEach(player => player.hurt = 1e8);
    for (const flags of [{}, { ground: true }, { boss: true }, { player: true }]) tyran.state.events.push({ type: 'explosion', x: 300, y: 300, size: 60, ...flags });
    tyran.step(.1);
  });
  await page.waitForFunction(() => tyran.scene === 'playing' && (tyran.renderer.backend === 'canvas2d' || tyran.renderer.frames > 0));
  assert.equal(await page.evaluate(() => !('wrecks' in tyran.fx) && tyran.fx.particles.every(p => !('debris' in p))), true);
  await page.evaluate(() => tyran.pause());
  assert.deepEqual(retiredRequests, [], 'no retired debris module or crater atlas is requested, including during startup');
  assert.deepEqual(lateRequests, [], 'offline explosions and flight start request no new HTTP or Blob assets');
  assert.deepEqual(errors, []);
  console.log('PASS debris-free explosions in both qualities/reduced-motion modes, preserved fire/smoke/sparks/shockwaves, empty destroyed sites, no retired artwork and offline caches.');
  console.log(JSON.stringify(result));
} finally { await context.close(); await browser.close(); }
