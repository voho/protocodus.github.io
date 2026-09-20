// Serve repo root, then TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node this file.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  const result = await page.evaluate(async () => {
    const { Effects, EFFECT_LIMITS, effectTextureStats } = await import('./effects.js');
    const { spritesReady } = await import('./sprite-assets.js');
    await spritesReady;
    const fx = new Effects(), records = new Set();
    // Sequential explosions should reuse the same records after their lives finish.
    for (let i = 0; i < 100; i++) {
      fx.emit({ type: 'explosion', x: 100, y: 100, size: 50, ground: true });
      fx.particles.forEach(particle => records.add(particle));
      fx.update(3);
    }
    const recycled = { unique: records.size, memory: fx.memory };
    fx.emit({ type: 'spark', x: 100, y: 100 });
    const clearedFlags = fx.particles.every(particle => !particle.smoke && !particle.debris && !particle.ground && particle.angle === 0 && particle.age === 0);
    fx.reset(); records.clear();
    // An extreme chain reaction must have a fixed ceiling, including delayed bursts.
    let bounded = true;
    for (let frame = 0; frame < 80; frame++) {
      for (let i = 0; i < 6; i++) {
        fx.emit({ type: 'explosion', x: 100, y: 100, size: 110, boss: true, value: 20 });
        fx.emit({ type: 'pickup', x: 100, y: 100, value: 'Bonus', bonus: 'rapid' });
      }
      for (const [key, count] of Object.entries(fx.memory.active)) bounded &&= count <= EFFECT_LIMITS[key];
      fx.particles.forEach(particle => records.add(particle));
      bounded &&= fx.memory.particleRecords <= EFFECT_LIMITS.particles;
      fx.update(1 / 60);
    }
    const stressed = { bounded, unique: records.size, memory: fx.memory };
    for (let i = 0; i < 360; i++) fx.update(1 / 60);
    const finished = fx.memory;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    // Different terrain light colors cannot grow the cache across repeated flights.
    fx.reset();
    for (let i = 0; i < 100; i++) {
      fx.emit({ type: 'blast', x: 128, y: 128, size: 30, color: `#${(i * 65537).toString(16).padStart(6, '0')}` });
      fx.draw(ctx, 256, 256); fx.update(1);
    }
    const textures = effectTextureStats();
    fx.reset();
    return { limits: EFFECT_LIMITS, recycled, clearedFlags, stressed, finished, textures, reset: fx.memory };
  });
  assert.equal(result.recycled.unique, 55, '100 consecutive explosions reuse the same 55 particle records');
  assert.equal(result.recycled.memory.particleRecords, 55, 'only high-water particle storage is retained');
  assert.ok(result.clearedFlags, 'recycled particles do not retain smoke, debris, ground or angular state');
  assert.ok(result.stressed.bounded, 'every transient list stays within its fixed budget during chain reactions');
  assert.equal(result.stressed.unique, result.limits.particles, 'sustained chain reactions reuse at most 700 particle records');
  for (const [kind, count] of Object.entries(result.finished.active)) if (kind !== 'wrecks') assert.equal(count, 0, `${kind} finishes normally after a stress burst`);
  assert.ok(result.textures.count <= result.limits.textures, 'light texture storage is bounded across arbitrary palettes');
  assert.ok(result.textures.bytes <= result.limits.textures * 256 * 256 * 4, 'texture backing memory stays within its worst-case pixel budget');
  assert.equal(result.reset.particleRecords, 0, 'reset releases retained particle records');
  assert.ok(Object.values(result.reset.active).every(count => count === 0), 'reset releases every playback state');
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS bounded animation state, particle reuse, clean recycling, shared texture budgets and full reset');
  console.log(JSON.stringify({ particles: result.stressed.memory.particleRecords, textures: result.textures }));
} finally { await browser.close(); }
