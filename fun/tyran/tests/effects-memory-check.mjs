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
    const bossBursts = [];
    for (const quality of ['high', 'low']) for (const reduced of [false, true]) {
      fx.reset(); fx.quality = quality; fx.reduced = reduced;
      // Recycle metal fragments first: pooled flags must not leak into a boss burst.
      fx.emit({ type: 'explosion', x: 100, y: 100, size: 20 });
      fx.update(3); fx.wrecks.length = 0;
      fx.emit({ type: 'explosion', x: 400, y: 240, size: 110, boss: true }, 200, 15);
      const initial = { particles: fx.particles.length, smoke: fx.particles.some(p => p.smoke),
        sparks: fx.particles.some(p => !p.smoke && !p.debris), rings: fx.rings.length,
        fire: fx.lights.some(light => light.fire), charges: fx.delayed.length, flares: fx.flares.length,
        shake: fx.shake, flash: fx.flash, impact: fx.impactPeak };
      let debrisFree = fx.wrecks.length === 0 && fx.particles.every(p => !p.debris), emitted = 0;
      const emit = fx.emit;
      fx.emit = function (...args) { emitted++; return emit.apply(this, args); };
      for (let frame = 0; frame < 240; frame++) {
        fx.update(1 / 60);
        debrisFree &&= fx.wrecks.length === 0 && fx.particles.every(p => !p.debris);
      }
      delete fx.emit;
      bossBursts.push({ quality, reduced, initial, debrisFree, emitted, finished: fx.memory.active });
    }
    fx.reset(); fx.quality = 'high'; fx.reduced = false;
    // The killing bolt can break a boss weak point immediately before the main explosion.
    fx.emit({ type: 'weak-break', x: 420, y: 245, size: 40 }, 200, 15);
    const weakBreak = { fire: fx.lights.some(light => light.fire), rings: fx.rings.length,
      debrisFree: fx.wrecks.length === 0 && fx.particles.every(p => !p.debris) };
    fx.emit({ type: 'explosion', x: 400, y: 240, size: 110, boss: true }, 200, 15);
    for (let frame = 0; frame < 240; frame++) {
      fx.update(1 / 60);
      weakBreak.debrisFree &&= fx.wrecks.length === 0 && fx.particles.every(p => !p.debris);
    }
    weakBreak.finished = fx.memory.active;
    const ordinary = [];
    for (const event of [{ size: 20 }, { size: 54, midboss: true }, { size: 30, ground: true }]) {
      fx.reset(); fx.emit({ type: 'explosion', x: 400, y: 240, ...event }, 200, 15);
      ordinary.push({ ground: !!event.ground, fragments: fx.particles.some(p => p.debris),
        wrecks: fx.wrecks.map(({ x, y, size }) => ({ x, y, size })), size: event.size });
    }
    fx.reset();
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
    return { limits: EFFECT_LIMITS, bossBursts, weakBreak, ordinary, recycled, clearedFlags, stressed, finished, textures, reset: fx.memory };
  });
  for (const { quality, reduced, initial, debrisFree, emitted, finished } of result.bossBursts) {
    const label = `${quality} quality, reduced motion ${reduced}`;
    assert(debrisFree, `boss and delayed detonations leave no flying fragments or ground wreckage (${label})`);
    assert.equal(initial.particles, Math.ceil(121 * (quality === 'high' ? 1 : .55)), 'boss retains its particle budget');
    assert(initial.smoke && initial.sparks && initial.fire, 'boss keeps smoke, sparks and fire light');
    assert.equal(initial.rings, 2); assert.equal(initial.charges, 18); assert.equal(emitted, 18, 'every delayed detonation still plays');
    assert.equal(initial.flares, reduced ? 0 : 1); assert(initial.shake > 0); assert.equal(initial.flash, .32);
    assert.equal(initial.impact, reduced ? 0 : 1, 'boss impact continues to respect reduced motion');
    assert(Object.values(finished).every(count => count === 0), `boss leaves no active effect after four seconds (${label})`);
  }
  assert(result.weakBreak.fire && result.weakBreak.rings > 0, 'boss weak-point destruction keeps its explosion');
  assert(result.weakBreak.debrisFree, 'a weak point breaking on the killing shot leaves no boss debris');
  assert(Object.values(result.weakBreak.finished).every(count => count === 0), 'weak-point and death effects fully finish');
  for (const item of result.ordinary) {
    assert(item.fragments, 'ordinary ships, midbosses and buildings keep metal fragments');
    assert.deepEqual(item.wrecks, item.ground ? [] : [{ x: 385, y: 40, size: item.size }], 'ordinary ship wreckage retains its ground anchoring');
  }
  assert.equal(result.recycled.unique, 55, '100 consecutive explosions reuse the same 55 particle records');
  assert.equal(result.recycled.memory.particleRecords, 55, 'only high-water particle storage is retained');
  assert.ok(result.clearedFlags, 'recycled particles do not retain smoke, debris, ground or angular state');
  assert.ok(result.stressed.bounded, 'every transient list stays within its fixed budget during chain reactions');
  assert.equal(result.stressed.unique, result.limits.particles, 'sustained chain reactions reuse at most 700 particle records');
  for (const [kind, count] of Object.entries(result.finished.active)) assert.equal(count, 0, `${kind} finishes normally after a stress burst`);
  assert.ok(result.textures.count <= result.limits.textures, 'light texture storage is bounded across arbitrary palettes');
  assert.ok(result.textures.bytes <= result.limits.textures * 256 * 256 * 4, 'texture backing memory stays within its worst-case pixel budget');
  assert.equal(result.reset.particleRecords, 0, 'reset releases retained particle records');
  assert.ok(Object.values(result.reset.active).every(count => count === 0), 'reset releases every playback state');
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS debris-free boss destruction, preserved ordinary wreckage, bounded animation state, particle reuse, clean recycling, shared texture budgets and full reset');
  console.log(JSON.stringify({ particles: result.stressed.memory.particleRecords, textures: result.textures }));
} finally { await browser.close(); }
