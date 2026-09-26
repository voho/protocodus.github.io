// Serve repo root, then TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node this file.
// Compare cropped streaks with their complete source image and preserve edge optics.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  const result = await page.evaluate(async () => {
    const { Effects } = await import('./effects.js');
    await (await import('./sprite-assets.js')).spritesReady;
    const surface = (scale = 1) => {
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(640 * scale); canvas.height = Math.ceil(480 * scale);
      const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
      const calls = [], draw = ctx.drawImage.bind(ctx);
      ctx.drawImage = (...args) => { calls.push(args); return draw(...args); };
      return { canvas, ctx, calls };
    };
    const cropped = [];
    for (const scale of [.75, 1, 1.3]) {
      const current = surface(scale), reference = surface(scale), fx = new Effects(); fx.quality = 'low';
      for (const target of [current, reference]) { target.ctx.fillStyle = '#21302b'; target.ctx.fillRect(0, 0, 640, 480); }
      const flare = { x: 277.3, y: 211.7, age: .12, life: .48, radius: 260, strength: .75 };
      fx.flares.push(flare); fx.draw(current.ctx, 640, 480);
      const call = current.calls[0], t = flare.age / flare.life;
      const radius = Math.min(640 * .45, flare.radius * (1 - t * .25));
      reference.ctx.globalCompositeOperation = 'lighter'; reference.ctx.globalAlpha = (1 - t) ** 2 * flare.strength * .4;
      reference.ctx.drawImage(call[0], flare.x - radius, flare.y - radius, radius * 2, radius * 2);
      const a = current.ctx.getImageData(0, 0, current.canvas.width, current.canvas.height).data;
      const b = reference.ctx.getImageData(0, 0, reference.canvas.width, reference.canvas.height).data;
      let different = 0, maxDifference = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { different++; maxDifference = Math.max(maxDifference, Math.abs(a[i] - b[i])); }
      cropped.push({ scale, different, maxDifference, areaRatio: call.at(-2) * call.at(-1) / (radius * radius * 4) });
    }
    const hidden = new Effects(), hiddenSurface = surface(); let hiddenPaths = 0;
    const arc = hiddenSurface.ctx.arc.bind(hiddenSurface.ctx), ellipse = hiddenSurface.ctx.ellipse.bind(hiddenSurface.ctx);
    hiddenSurface.ctx.arc = (...args) => { hiddenPaths++; return arc(...args); };
    hiddenSurface.ctx.ellipse = (...args) => { hiddenPaths++; return ellipse(...args); };
    for (let i = 0; i < 6; i++) hidden.emit({ type: 'explosion', x: -2000 - i * 100, y: -2000, size: 30 });
    hidden.update(.1); hidden.flash = 0; hidden.draw(hiddenSurface.ctx, 640, 480);
    const edge = new Effects(), edgeSurface = surface(); edgeSurface.ctx.translate(23, 0);
    // A spark outside the unshaken viewport still reaches its edge during camera shake.
    edge.particle(-34, 200, 0, 0, 1, 12, '#fff'); edge.draw(edgeSurface.ctx, 640, 480);
    const edgeAlpha = edgeSurface.ctx.getImageData(0, 200, 1, 1).data[3];
    const ghost = new Effects(), ghostSurface = surface();
    // This source's streak is completely offscreen, but its nearer optical ghost is visible.
    ghost.flares.push({ x: -450, y: 240, age: 0, life: .48, radius: 260, strength: 1 });
    ghost.draw(ghostSurface.ctx, 640, 480);
    const ghostPixels = ghostSurface.ctx.getImageData(480, 210, 65, 65).data;
    let ghostAlpha = 0;
    for (let i = 3; i < ghostPixels.length; i += 4) ghostAlpha += ghostPixels[i];
    let batchDifference = 0, batchRestored = true, maxBatchSaves = 0;
    for (const ground of [false, true]) for (const matrix of [[1,0,0,1,0,0], [1.13,.07,-.04,.91,8,12]]) {
      const current = surface(), reference = surface(), fx = new Effects();
      const items = Array.from({ length: 16 }, (_, i) => ({ x: 65 + i % 4 * 145, y: 65 + Math.floor(i / 4) * 95,
        angle: i * .47, age: .17, life: .9, radius: 4 + i % 3, size: 9 + i % 5, debris: true, smoke: false, ground: i % 2 === 0 }));
      if (ground) fx.wrecks.push(...items); else fx.particles.push(...items);
      for (const target of [current, reference]) {
        target.ctx.fillStyle = '#21302b'; target.ctx.fillRect(0, 0, 640, 480);
        target.ctx.beginPath(); target.ctx.rect(5, 5, 625, 470); target.ctx.clip();
        target.ctx.setTransform(...matrix); target.ctx.globalAlpha = .7; target.ctx.globalCompositeOperation = 'multiply';
      }
      const state = c => JSON.stringify({ matrix: [...['a','b','c','d','e','f'].map(k => c.getTransform()[k])],
        alpha: c.globalAlpha, fill: c.fillStyle, composite: c.globalCompositeOperation });
      const before = state(current.ctx), save = current.ctx.save.bind(current.ctx); let saves = 0;
      current.ctx.save = () => { saves++; return save(); };
      if (ground) fx.drawGround(current.ctx, 13, 480, 7); else fx.draw(current.ctx, 640, 480);
      batchRestored &&= before === state(current.ctx); maxBatchSaves = Math.max(maxBatchSaves, saves);
      items.forEach((item, index) => {
        const c = reference.ctx;
        c.save(); c.translate(item.x + (ground ? 7 : 0), item.y + (ground ? 13 : 0));
        c.rotate(item.angle + (ground ? 0 : item.age * 8));
        if (!ground) c.globalAlpha = 1 - item.age / item.life;
        c.drawImage(...current.calls[index]); c.restore();
      });
      const a = current.ctx.getImageData(0, 0, 640, 480).data, b = reference.ctx.getImageData(0, 0, 640, 480).data;
      for (let i = 0; i < a.length; i++) batchDifference = Math.max(batchDifference, Math.abs(a[i] - b[i]));
    }
    return { cropped, hiddenImages: hiddenSurface.calls.length, hiddenPaths, edgeAlpha, ghostImages: ghostSurface.calls.length, ghostAlpha,
      batchDifference, batchRestored, maxBatchSaves };
  });
  for (const sample of result.cropped) {
    assert.ok(sample.maxDifference <= 1, `cropped streak retains appearance at ${sample.scale}× (only byte rounding allowed)`);
    assert.ok(sample.areaRatio <= .063, 'streak submits at most 6.3% of its original transparent quad area');
  }
  assert.equal(result.hiddenImages, 0, 'fully offscreen explosions submit no image draws');
  assert.equal(result.hiddenPaths, 0, 'fully offscreen explosions submit no particle or ring paths');
  assert.ok(result.edgeAlpha > 0, 'conservative culling preserves effects crossing the shaken viewport edge');
  assert.equal(result.ghostImages, 1, 'only the visible lens ghost is submitted when the streak is offscreen');
  assert.ok(result.ghostAlpha > 0, 'offscreen light sources retain visible optical ghosts');
  assert.ok(result.batchDifference <= 1, 'batched debris and wreck rotations retain reference pixels under transformed, clipped cameras');
  assert.ok(result.batchRestored, 'effect batches restore caller transform, opacity, fill and composite');
  assert.ok(result.maxBatchSaves <= 2, 'effect state copies stay constant as the particle count grows');
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS equivalent cropped streaks, reduced submitted area, conservative edge culling and independent lens ghosts');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
