// Serve the repository, then run with TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs.
// Verify real atlas decoding, palette retention and cache/lifetime behavior in Canvas.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  const result = await page.evaluate(async () => {
    const { spriteCell, spritesReady } = await import('./sprite-assets.js');
    const { projectileTexture, projectileLayout, warmProjectileTextures } = await import('./projectile-sprites.js');
    const { Effects } = await import('./effects.js');
    const { WEAPONS, BULLET_SPECTRUM } = await import('./sim.js');
    const assets = await spritesReady;
    const frames = [['effects', 16], ['projectiles', 12]].flatMap(([atlas, count]) => Array.from({ length: count }, (_, index) => {
      const cell = spriteCell(atlas, index);
      if (!cell) return { atlas, index, available: false };
      const pixels = cell.getContext('2d').getImageData(0, 0, cell.width, cell.height).data;
      let opaque = 0, translucent = 0, transparent = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (!pixels[i]) transparent++;
        else if (pixels[i] < 250) translucent++;
        else opaque++;
      }
      return { atlas, index, available: true, opaque, translucent, transparent };
    }));
    warmProjectileTextures(WEAPONS, BULLET_SPECTRUM);
    const bullets = WEAPONS.map(weapon => ({ team: 0, kind: weapon.kind, weaponColor: weapon.color, radius: weapon.radius }));
    bullets.push(...BULLET_SPECTRUM.map((color, type) => ({ team: -1, color, variant: type === 9 ? 5 : type % 5, radius: 2 + type * .65 })));
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 900;
    canvas.style = 'position:fixed;inset:0;z-index:9999;width:1200px;height:900px'; document.body.append(canvas);
    const context = canvas.getContext('2d'); context.fillStyle = '#26322d'; context.fillRect(0, 0, canvas.width, canvas.height);
    let gradients = 0, pixelReads = 0;
    const originals = [];
    for (const prototype of [CanvasRenderingContext2D.prototype, OffscreenCanvasRenderingContext2D.prototype]) {
      for (const method of ['createRadialGradient', 'createLinearGradient', 'getImageData']) {
        const original = prototype[method]; originals.push([prototype, method, original]);
        prototype[method] = function (...args) { if (method === 'getImageData') pixelReads++; else gradients++; return original.apply(this, args); };
      }
    }
    const reused = bullets.every(bullet => projectileTexture(bullet) === projectileTexture(bullet));
    bullets.forEach((bullet, index) => {
      const image = projectileTexture(bullet), { width, height } = projectileLayout(bullet);
      const x = 90 + index % 8 * 145, y = 110 + Math.floor(index / 8) * 180;
      // Actual in-game size alongside a 2× inspection view.
      context.drawImage(image, x - width, y - height, width * 2, height * 2);
      context.drawImage(image, x - width / 2, y + 65 - height / 2, width, height);
    });
    const fx = new Effects();
    fx.emit({ type: 'explosion', x: 320, y: 590, size: 38 });
    fx.emit({ type: 'explosion', x: 850, y: 590, size: 56, ground: true });
    fx.update(.15); fx.draw(context, 1200, 900);
    const warmWork = { gradients, pixelReads };
    for (const [prototype, method, original] of originals) prototype[method] = original;
    const hues = bullets.map(bullet => {
      const image = projectileTexture(bullet), pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
      const channels = [0, 0, 0]; let weight = 0, hash = 2166136261;
      for (let i = 0; i < pixels.length; i++) hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const peak = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
        const low = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
        if (peak < 100 || peak - low < 25 || pixels[i + 3] < 40) continue;
        const amount = pixels[i + 3] / 255; weight += amount;
        channels.forEach((_, channel) => channels[channel] += pixels[i + channel] * amount);
      }
      const color = bullet.weaponColor || bullet.color, value = Number.parseInt(color.slice(1), 16);
      const target = [value >> 16 & 255, value >> 8 & 255, value & 255];
      const hue = rgb => {
        const max = Math.max(...rgb), min = Math.min(...rgb), range = max - min;
        if (!range) return 0;
        return ((max === rgb[0] ? (rgb[1] - rgb[2]) / range : max === rgb[1] ? 2 + (rgb[2] - rgb[0]) / range : 4 + (rgb[0] - rgb[1]) / range) * 60 + 360) % 360;
      };
      const difference = Math.abs(hue(channels) - hue(target));
      return { color, weight, degrees: Math.min(difference, 360 - difference), hash };
    });
    fx.emit({ type: 'explosion', x: 600, y: 400, size: 90, boss: true });
    fx.emit({ type: 'combo', x: 600, y: 400, combo: 5, label: 'Rampage' });
    for (let i = 0; i < 300; i++) fx.update(1 / 60);
    const finished = Object.fromEntries(['particles', 'rings', 'lights', 'texts', 'delayed'].map(key => [key, fx[key].length]));
    fx.reset();
    return { assets, frames, reused, warmWork, hues, finished, resetWrecks: fx.wrecks.length };
  });
  assert.ok(result.assets.loaded.includes('effects') && result.assets.loaded.includes('projectiles'), 'real effects and projectile atlases decode');
  for (const frame of result.frames) {
    assert.ok(frame.available, `${frame.atlas}:${frame.index} is populated`);
    assert.ok(frame.transparent > 0 && frame.translucent > 0, `${frame.atlas}:${frame.index} has actual alpha and soft edges`);
  }
  assert.equal(result.reused, true, 'warm projectile textures retain identity');
  assert.deepEqual(result.warmWork, { gradients: 0, pixelReads: 0 }, 'drawing warmed sprites does no gradient or pixel work');
  assert.equal(new Set(result.hues.map(item => item.hash)).size, 12, 'both player weapons and all ten hostile classes render distinct sprites');
  for (const hue of result.hues) {
    assert.ok(hue.weight > 2, `${hue.color} has a visible saturated body`);
    assert.ok(hue.degrees < 6, `${hue.color} remains within 6 degrees of its established palette`);
  }
  for (const [kind, count] of Object.entries(result.finished)) assert.equal(count, 0, `${kind} finishes after the explosion sequence`);
  assert.equal(result.resetWrecks, 0, 'reset clears ground wrecks');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  const output = process.env.TYRAN_QA_DIR || '/tmp/tyran-projectile-effects-qa';
  await mkdir(output, { recursive: true }); await page.screenshot({ path: `${output}/sprites.png` });
  console.log('PASS real atlas alpha, 12 distinct palette-matched projectiles, warm caches and complete effect lifetimes');
} finally { await browser.close(); }
