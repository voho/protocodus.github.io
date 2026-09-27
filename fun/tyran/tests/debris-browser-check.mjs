// Serve repo root, then TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node this file.
// Debris is prepared before flight, varied without per-particle art, and dry-ground only.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage(), errors = [], lateRequests = [];
let ready = false;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (ready && /^(https?:|blob:)/.test(request.url())) lateRequests.push(request.url()); });
try {
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true');
  ready = true;
  await context.setOffline(true);
  const result = await page.evaluate(async () => {
    const { Effects, warmEffectsTextures, warmGpuEffectTextures, effectTextureStats } = await import('./effects.js');
    const { debrisFragment, debrisWreck, debrisTextureSources, debrisTextureStats, warmDebrisSprites } = await import('./debris-sprites.js');
    const { WorldRenderer } = await import('./worlds.js');
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    // Readiness itself must include the atlas; warming again must preserve source identity.
    const startupStats = debrisTextureStats(), sources = [...debrisTextureSources()];
    check(startupStats.count === 2 && sources.length === 2, 'startup must prepare both debris atlases');
    warmDebrisSprites(); warmEffectsTextures();
    check(debrisTextureSources().every((source, index) => source === sources[index]), 'warming must reuse atlas canvases');
    const gpuSources = [];
    warmGpuEffectTextures({ prewarm(items) { gpuSources.push(...(Array.isArray(items) ? items : [items])); } });
    check(sources.every(source => gpuSources.includes(source)), 'GPU startup/recovery must prewarm both debris atlases');

    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d'), calls = [], draw = ctx.drawImage.bind(ctx);
    ctx.drawImage = (...args) => { calls.push(args); return draw(...args); };
    const cell = document.createElement('canvas'); cell.width = cell.height = 256;
    const reader = cell.getContext('2d', { willReadFrequently: true });
    const signature = sprite => {
      check(sprite?.source && sprite.sw > 0 && sprite.sh > 0, 'each variant needs a valid atlas rectangle');
      check(sprite.sx >= 0 && sprite.sy >= 0 && sprite.sx + sprite.sw <= sprite.source.width
        && sprite.sy + sprite.sh <= sprite.source.height, 'atlas crop must stay inside its source');
      reader.clearRect(0, 0, 256, 256);
      reader.drawImage(sprite.source, sprite.sx, sprite.sy, sprite.sw, sprite.sh, 0, 0, 256, 256);
      const data = reader.getImageData(0, 0, 256, 256).data;
      let hash = 2166136261, opaque = 0, transparent = 0;
      for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i], 16777619);
      for (let i = 3; i < data.length; i += 4) { if (data[i]) opaque++; else transparent++; }
      check(opaque > 50 && transparent > 50, 'every debris variant has visible detail and a transparent silhouette');
      return hash >>> 0;
    };
    const fragmentDescriptors = [
      ...Array.from({ length: 8 }, (_, variant) => debrisFragment(variant, false)),
      ...Array.from({ length: 4 }, (_, variant) => debrisFragment(variant, true)),
    ];
    const wreckDescriptors = Array.from({ length: 12 }, (_, variant) => debrisWreck(variant));
    const fragmentHashes = fragmentDescriptors.map(signature), wreckHashes = wreckDescriptors.map(signature);
    check(new Set(fragmentHashes).size === 12, 'all eight metal and four masonry fragments must look distinct');
    check(new Set(wreckHashes).size === 12, 'all twelve wreck assemblies must look distinct');
    check(new Set([...fragmentDescriptors, ...wreckDescriptors].map(sprite => sprite.source)).size === 2, 'all 24 appearances share two atlas textures');

    const fx = new Effects(); fx.reduced = false;
    const oneQuad = (sprite, label) => {
      check(calls.length === 1 && calls[0].length === 9, `${label} must draw exactly one atlas quad`);
      const call = calls[0];
      check(call[0] === sprite.source && call[1] === sprite.sx && call[2] === sprite.sy
        && call[3] === sprite.sw && call[4] === sprite.sh, `${label} must use its stored variant`);
    };
    const allocations = { canvases: 0, gradients: 0, pixelReads: 0 };
    const originalCreate = document.createElement, OriginalCanvas = window.OffscreenCanvas;
    const originalGradient = CanvasRenderingContext2D.prototype.createRadialGradient;
    const originalLinear = CanvasRenderingContext2D.prototype.createLinearGradient;
    const originalPixels = CanvasRenderingContext2D.prototype.getImageData;
    document.createElement = function (name, ...args) { if (String(name).toLowerCase() === 'canvas') allocations.canvases++; return originalCreate.call(this, name, ...args); };
    if (OriginalCanvas) window.OffscreenCanvas = new Proxy(OriginalCanvas, { construct(target, args) { allocations.canvases++; return Reflect.construct(target, args); } });
    CanvasRenderingContext2D.prototype.createRadialGradient = function (...args) { allocations.gradients++; return originalGradient.apply(this, args); };
    CanvasRenderingContext2D.prototype.createLinearGradient = function (...args) { allocations.gradients++; return originalLinear.apply(this, args); };
    CanvasRenderingContext2D.prototype.getImageData = function (...args) { allocations.pixelReads++; return originalPixels.apply(this, args); };
    try {
      for (const ground of [false, true]) for (let variant = 0; variant < (ground ? 4 : 8); variant++) {
        fx.reset(); calls.length = 0;
        fx.particles.push({ x: 150, y: 150, vx: 0, vy: 0, angle: .31, spin: -3, flip: -1,
          age: .1, life: 1, radius: 8, smoke: false, debris: true, ground, variant });
        fx.draw(ctx, 640, 480, 125); oneQuad(debrisFragment(variant, ground), `fragment ${ground}/${variant}`);
      }
      for (let variant = 0; variant < 12; variant++) {
        fx.reset(); calls.length = 0;
        fx.wrecks.push({ x: 150, y: 25, angle: .31, size: 20, variant, age: 0 });
        fx.drawGround(ctx, 125, 480, 7); oneQuad(debrisWreck(variant), `wreck ${variant}`);
      }
      // The initializer cycles through the artwork; drawing must not pick a new random image.
      fx.reset();
      for (let i = 0; i < 16; i++) fx.particle(150, 150, 0, 0, 1, 4, '#ffbb6b', false, true);
      check(new Set(fx.particles.map(p => p.variant)).size === 8, 'ordinary metal fragments use all eight variants');
      check(fx.particles.every(p => Number.isFinite(p.spin) && (p.flip === 1 || p.flip === -1)), 'fragment angular state is finite');
      fx.update(2); fx.particle(150, 150, 0, 0, 1, 4, '#ffbb6b');
      check(fx.particles.every(p => p.variant === 0 && p.spin === 0 && p.flip === 1), 'recycling must clear fragment art, spin and mirroring');
      fx.reset();
      for (let i = 0; i < 12; i++) fx.emit({ type: 'explosion', x: 150, y: 150, size: 20 });
      check(new Set(fx.wrecks.map(wreck => wreck.variant)).size === 12, 'ordinary wrecks cycle through all twelve variants');
      fx.draw(ctx, 640, 480); fx.drawGround(ctx, 0, 480); warmDebrisSprites();
    } finally {
      document.createElement = originalCreate; window.OffscreenCanvas = OriginalCanvas;
      CanvasRenderingContext2D.prototype.createRadialGradient = originalGradient;
      CanvasRenderingContext2D.prototype.createLinearGradient = originalLinear;
      CanvasRenderingContext2D.prototype.getImageData = originalPixels;
    }
    check(Object.values(allocations).every(value => value === 0), 'prepared debris must never allocate art canvases, gradients or pixel reads during playback');

    const forbidden = new Effects(() => false);
    forbidden.emit({ type: 'explosion', x: 150, y: 150, size: 20 });
    check(!forbidden.particles.some(p => p.debris) && forbidden.wrecks.length === 0, 'forbidden origins never create metal or wreckage');
    check(forbidden.particles.some(p => p.smoke) && forbidden.particles.some(p => !p.smoke && !p.debris)
      && forbidden.lights.some(light => light.fire) && forbidden.rings.length > 0, 'surface filtering retains fire, smoke, sparks and shockwaves');
    // The center is legal but the maximal rotated footprint overlaps the forbidden half-plane.
    const halfPlane = new Effects((x, _y, _scroll, radius) => x - radius >= 100);
    halfPlane.emit({ type: 'explosion', x: 110, y: 150, size: 20 });
    check(!halfPlane.particles.some(p => p.debris) && halfPlane.wrecks.length === 0, 'origin checks include the complete fragment and wreck footprints');
    halfPlane.reset(); halfPlane.particle(150, 150, -100, 0, 2, 5, '#fff', false, true);
    halfPlane.update(.4, 23);
    check(halfPlane.particles.length === 0 && halfPlane.particlePool.length === 1, 'fragments crossing a shoreline are immediately recycled');
    const queries = [], scrolling = new Effects((x, y, scroll, radius) => { queries.push({ x, y, scroll, radius }); return y - scroll - radius >= 100; });
    scrolling.particle(150, 150, 0, 0, 2, 5, '#fff', false, true);
    calls.length = 0; scrolling.draw(ctx, 640, 480, 40);
    check(calls.length === 0 && scrolling.particles.length === 1, 'render interpolation suppresses newly invalid fragments without requiring an update');
    check(queries.at(-1).scroll === 40 && queries.at(-1).radius === 15, 'fragment rendering checks the current scroll and conservative rotated radius');
    scrolling.wrecks.push({ x: 140, y: 130, size: 20, angle: .4, variant: 5, age: 0 });
    calls.length = 0; scrolling.drawGround(ctx, 40, 480, 10);
    check(calls.length === 0 && scrolling.wrecks.length === 0, 'cached wrecks whose full footprint is forbidden are removed');
    const lastQuery = queries.at(-1);
    check(lastQuery.x === 150 && lastQuery.y === 170 && lastQuery.scroll === 40 && lastQuery.radius === 40, 'wreck checks reconstruct screen coordinates including lateral drift');
    const waterBoss = new Effects(() => true);
    waterBoss.emit({ type: 'weak-break', x: 150, y: 150, size: 40 });
    waterBoss.emit({ type: 'explosion', x: 150, y: 150, size: 110, boss: true });
    for (let frame = 0; frame < 240; frame++) {
      waterBoss.update(1 / 60, frame);
      check(waterBoss.wrecks.length === 0 && waterBoss.particles.every(p => !p.debris), 'boss/weak-point delayed detonations must remain debris-free even over dry land');
    }

    // Exercise the actual game-owned callback, using the current world's seeded map.
    const world = tyran.world, gameFx = tyran.fx;
    check(world instanceof WorldRenderer && typeof gameFx.debrisSurface === 'function', 'game effects must use the production world surface predicate');
    let dry, wet;
    for (let row = -50; row < 50 && (!dry || !wet); row++) for (let col = -3; col < 16; col++) {
      const point = { x: col * 100 + 50 + world.parallaxX, y: row * 100 + 50 };
      if (!dry && world.canPlaceDebris(point.x, point.y, 0, 40)) dry = point;
      if (!wet && !world.canPlaceDebris(point.x, point.y, 0, 0)) wet = point;
    }
    check(dry && wet, 'seeded jungle fixture must include open dry ground and water');
    const realSurfaces = [];
    for (const [name, point] of [['dry', dry], ['water', wet]]) {
      gameFx.reset(); gameFx.emit({ type: 'explosion', ...point, size: 20 }, 0, world.parallaxX);
      const debris = gameFx.particles.some(p => p.debris), wrecks = gameFx.wrecks.length;
      check(debris === (name === 'dry') && wrecks === (name === 'dry' ? 1 : 0), `game callback must enforce ${name} origin semantics`);
      realSurfaces.push({ name, debris, wrecks });
    }
    const originalIndex = world.index;
    try {
      for (const index of [4, 9]) {
        // Surface identity is sufficient; changing the art cache is unrelated to this predicate.
        world.index = index; gameFx.reset();
        gameFx.emit({ type: 'explosion', x: 150, y: 150, size: 20 });
        check(gameFx.particles.every(p => !p.debris) && gameFx.wrecks.length === 0, `space sector ${index} cannot retain debris`);
        gameFx.particle(150, 150, 0, 0, 2, 5, '#fff', false, true);
        calls.length = 0; gameFx.rings.length = gameFx.lights.length = 0;
        gameFx.particles.splice(0, gameFx.particles.length - 1); gameFx.flash = 0;
        gameFx.draw(ctx, 640, 480, 0);
        check(calls.length === 0, 'space suppresses any legacy airborne fragment before drawing');
        gameFx.update(.01, 0); check(gameFx.particles.length === 0, 'space removes any legacy airborne fragment at the next update');
        realSurfaces.push({ name: `space-${index}`, debris: false, wrecks: 0 });
      }
    } finally { world.index = originalIndex; gameFx.reset(); }
    return { startupStats, stats: effectTextureStats(), allocations, fragmentHashes, wreckHashes, realSurfaces };
  });
  assert.equal(result.stats.debris.count, 2);
  assert.equal(result.stats.debris.fragments, 12); assert.equal(result.stats.debris.wrecks, 12);
  assert(result.stats.debris.bytes <= 4 * 1024 * 1024, 'debris atlas backing is capped at 4 MiB');
  assert(result.stats.count <= 24, 'dedicated debris atlas does not enlarge the generic effect texture limit');
  // Run actual offline flight after the isolated checks, then pause cleanly.
  await page.evaluate(() => { tyran.launch(0, null, false); tyran.state.players.forEach(player => player.hurt = 1e8); tyran.step(.1); });
  await page.waitForFunction(() => tyran.scene === 'playing' && (tyran.renderer.backend === 'canvas2d' || tyran.renderer.frames > 0));
  await page.evaluate(() => tyran.pause());
  assert.deepEqual(lateRequests, [], 'ready/offline debris rendering and launch issue no new network or Blob requests');
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS distinct cached debris, one-quad variants, pooled reset, full-footprint dry-ground gates, boss exclusion and offline startup');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
