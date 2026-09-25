// Serve the repository; controlled RAF timestamps make short impact effects deterministic.
// TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node fun/tyran/tests/impact-effects-check.mjs
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const errors = [];
const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} versus ${expected}`);

async function flight(reducedMotion = 'no-preference') {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1, reducedMotion });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const queued = new Map(); let sequence = 0, time = 1000;
    window.requestAnimationFrame = callback => { const id = ++sequence; queued.set(id, callback); return id; };
    window.cancelAnimationFrame = id => queued.delete(id);
    window.__impactFrame = (milliseconds = 1000 / 60) => {
      time += milliseconds;
      const callbacks = [...queued.values()]; queued.clear();
      for (const callback of callbacks) callback(time);
    };
    window.__impactAdvance = seconds => {
      for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) __impactFrame();
    };
    localStorage.clear(); localStorage.setItem('tyran-muted', 'true');
  });
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  await page.waitForFunction(() => window.tyran, null, { polling: 20 });
  await page.evaluate(async () => {
    const { Effects } = await import('./effects.js');
    const { hurtPlayer } = await import('./sim.js');
    const draw = Effects.prototype.draw;
    let effects;
    // Observe the actual renderer without adding a production-only debugging API.
    Effects.prototype.draw = function (...args) { effects = this; return draw.apply(this, args); };
    tyran.launch(); tyran.state.bossSpawned = true; __impactFrame(0);
    window.impactQA = {
      get effects() { return effects; },
      hit(shield = true, damage = 9) {
        const pilot = tyran.state.players[0];
        pilot.hurt = 0; pilot.shield = shield ? pilot.maxShield : 0;
        hurtPlayer(tyran.state, pilot, damage); tyran.step(1 / 60);
        return effects.damagePulse;
      },
      snapshot() {
        return { pulse: effects.damagePulse, filter: document.querySelector('#game-canvas').style.filter,
          flares: effects.flares.length, scene: tyran.scene, frames: tyran.performance.frames };
      },
    };
  });
  return page;
}

try {
  const page = await flight();
  try {
    const damage = await page.evaluate(() => {
      const fx = impactQA.effects;
      const shield = impactQA.hit(); __impactFrame();
      const shieldFrame = impactQA.snapshot();
      __impactAdvance(1);
      const settled = impactQA.snapshot();
      fx.reset(); const hull = impactQA.hit(false); __impactFrame();
      const hullFrame = impactQA.snapshot();
      tyran.pause();
      const paused = impactQA.snapshot(); __impactAdvance(.5);
      const pausedLater = impactQA.snapshot();
      tyran.pause(); __impactFrame(0); __impactAdvance(1);
      const resumed = impactQA.snapshot();
      return { shield, shieldFrame, settled, hull, hullFrame, paused, pausedLater, resumed };
    });
    near(damage.shield, .65, 'shield hit pulse'); near(damage.hull, 1, 'hull hit pulse');
    near(damage.shieldFrame.pulse, .65 * Math.exp(-12 / 60), 'damage pulse decays by elapsed render time');
    assert.match(damage.shieldFrame.filter, /^blur\([\d.]+px\)$/, 'a real shield hit briefly blurs the playfield');
    assert(parseFloat(damage.hullFrame.filter.slice(5)) > parseFloat(damage.shieldFrame.filter.slice(5)), 'hull damage has a stronger impact than shield damage');
    assert.equal(damage.settled.filter, '', 'the brief filter is removed rather than retaining blur(0px)');
    assert(damage.settled.pulse < .001);
    assert.equal(damage.paused.scene, 'pause'); assert.equal(damage.paused.filter, '', 'pausing removes blur immediately');
    near(damage.paused.pulse, damage.pausedLater.pulse, 'paused effects remain frozen');
    assert.equal(damage.resumed.scene, 'playing'); assert.equal(damage.resumed.filter, '', 'the resumed impact finishes and clears the filter');
    console.log('PASS real shield/hull impacts, short blur decay, pause clarity and resume cleanup');

    const preferences = await page.evaluate(() => {
      const fx = impactQA.effects;
      fx.reset(); impactQA.hit(); __impactFrame();
      document.querySelector('#quality-toggle').click(); __impactFrame(0);
      const low = { ...impactQA.snapshot(), quality: fx.quality };
      __impactAdvance(1); document.querySelector('#quality-toggle').click();
      fx.reset();
      const pilot = tyran.state.players[0]; pilot.invulnerableTime = 10;
      const hull = pilot.hull;
      impactQA.hit(false); __impactFrame();
      const immune = { ...impactQA.snapshot(), hull: pilot.hull, previousHull: hull };
      pilot.invulnerableTime = 0;
      fx.reset(); impactQA.hit(); __impactFrame();
      tyran.pause(); document.querySelector('#menu-button').click(); __impactFrame(0);
      const menu = impactQA.snapshot();
      tyran.launch(); tyran.state.bossSpawned = true; __impactFrame(0);
      return { low, immune, menu, newFlight: impactQA.snapshot() };
    });
    assert.equal(preferences.low.quality, 'low'); assert.equal(preferences.low.filter, '', 'low effects quality suppresses damage blur');
    assert.equal(preferences.immune.pulse, 0, 'invulnerable pilots emit no damage pulse');
    assert.equal(preferences.immune.filter, ''); assert.equal(preferences.immune.hull, preferences.immune.previousHull);
    for (const state of [preferences.menu, preferences.newFlight]) {
      assert.equal(state.pulse, 0); assert.equal(state.filter, ''); assert.equal(state.flares, 0);
    }
    console.log('PASS low-quality suppression, invulnerability and flight/menu reset');

    const flares = await page.evaluate(async () => {
      const { Effects, EFFECT_LIMITS } = await import('./effects.js');
      const fx = new Effects(); fx.reduced = false;
      fx.emit({ type: 'explosion', x: 200, y: 150, size: 20 }); const small = fx.flares.length;
      fx.emit({ type: 'explosion', x: 200, y: 150, size: 80, secondary: true }); const secondary = fx.flares.length;
      fx.emit({ type: 'explosion', x: 200, y: 150, size: 80 }); const large = fx.flares.length;
      for (let i = 0; i < 20; i++) fx.emit({ type: 'explosion', x: i * 20, y: 150, size: 60 });
      const capped = { count: fx.flares.length, memory: fx.memory.active.flares, limit: EFFECT_LIMITS.flares };
      fx.update(1); const expired = fx.flares.length;
      fx.reset(); fx.quality = 'low'; fx.emit({ type: 'explosion', x: 200, y: 150, size: 80 }); const low = fx.flares.length;
      fx.reset(); fx.reduced = true; fx.emit({ type: 'explosion', x: 200, y: 150, size: 80 }); const reduced = fx.flares.length;
      fx.reset(); return { small, secondary, large, capped, expired, low, reduced, reset: fx.memory.active.flares, pulse: fx.damagePulse };
    });
    assert.equal(flares.small, 0); assert.equal(flares.secondary, 0, 'secondary bursts do not fill the view with lens flares');
    assert.equal(flares.large, 1); assert.equal(flares.capped.limit, 6); assert.equal(flares.capped.count, 6);
    assert.equal(flares.capped.memory, 6, 'flare playback is included in memory accounting');
    assert.equal(flares.expired, 0); assert.equal(flares.low, 1); assert.equal(flares.reduced, 0);
    assert.equal(flares.reset, 0); assert.equal(flares.pulse, 0);
    console.log('PASS selective large-explosion flares, six-flare budget, preferences, aging and reset');

    const bloom = await page.evaluate(async () => {
      const { Effects, EFFECT_LIMITS, effectTextureStats } = await import('./effects.js');
      const fx = new Effects(); fx.reduced = false;
      fx.emit({ type: 'explosion', x: 256, y: 256, size: 50, ground: true });
      // Isolate the light pass so particles, flare streaks and fire frames cannot
      // disguise a missing bloom or contaminate the spatial comparison.
      fx.particles.length = fx.rings.length = fx.flares.length = 0; fx.flash = 0;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
      const ctx = canvas.getContext('2d');
      const render = (fire, quality = 'high') => {
        fx.lights[0].fire = fire; fx.quality = quality;
        ctx.fillStyle = '#07101b'; ctx.fillRect(0, 0, 512, 512); fx.draw(ctx, 512, 512);
        return ctx.getImageData(0, 0, 512, 512).data;
      };
      const baseline = render(false), high = render(true), low = render(true, 'low');
      let brightened = 0, warmPixels = 0, highGain = 0, lowGain = 0, distantChanges = 0;
      for (let i = 0; i < baseline.length; i += 4) {
        const x = i / 4 % 512, y = Math.floor(i / 4 / 512);
        const red = high[i] - baseline[i], green = high[i + 1] - baseline[i + 1], blue = high[i + 2] - baseline[i + 2];
        const gain = red + green + blue;
        if (gain > 0) brightened++;
        if (red > blue + 3) warmPixels++;
        highGain += gain;
        lowGain += low[i] + low[i + 1] + low[i + 2] - baseline[i] - baseline[i + 1] - baseline[i + 2];
        if (Math.hypot(x - 256, y - 256) > 140 && gain) distantChanges++;
      }
      return { brightened, warmPixels, highGain, lowGain, distantChanges,
        textureCount: effectTextureStats().count, textureLimit: EFFECT_LIMITS.textures };
    });
    assert(bloom.brightened > 1000 && bloom.warmPixels > 500, 'fire adds a visible warm halo beyond its original light');
    assert(bloom.highGain > bloom.lowGain && bloom.lowGain > 0, 'low effects quality keeps a more restrained fire glow');
    assert.equal(bloom.distantChanges, 0, 'bloom stays around the explosion without washing out the playfield');
    assert(bloom.textureCount <= bloom.textureLimit, 'bloom and lens artwork share the bounded texture cache');
    console.log('PASS warm localized fire bloom, restrained low-quality glow and bounded shared artwork');

    const ending = await page.evaluate(() => {
      const fx = impactQA.effects, pilot = tyran.state.players[0];
      fx.reset(); pilot.hull = 1; pilot.hurt = 0; pilot.invulnerableTime = 0; tyran.state.lives = 0;
      impactQA.hit(false, 1000); __impactFrame(0);
      const impact = impactQA.snapshot();
      __impactAdvance(3);
      const finished = impactQA.snapshot(); __impactAdvance(1);
      return { impact, finished, idle: impactQA.snapshot() };
    });
    assert.equal(ending.impact.scene, 'end'); assert(ending.impact.pulse > 0); assert(ending.impact.flares > 0);
    assert.equal(ending.finished.filter, ''); assert.equal(ending.finished.flares, 0); assert(ending.finished.pulse <= .02);
    assert.equal(ending.finished.frames, ending.idle.frames, 'the end screen stops drawing once impact effects finish');
    console.log('PASS fatal-hit blur and flares finish before the end screen becomes idle');
  } finally { await page.close(); }

  const reduced = await flight('reduce');
  try {
    const result = await reduced.evaluate(() => {
      impactQA.hit(); __impactFrame();
      impactQA.effects.emit({ type: 'explosion', x: 600, y: 300, size: 100 });
      return { ...impactQA.snapshot(), reduced: impactQA.effects.reduced };
    });
    assert.equal(result.reduced, true); assert(result.pulse > 0);
    assert.equal(result.filter, ''); assert.equal(result.flares, 0);
    console.log('PASS system reduced-motion preference suppresses damage blur and lens flares');
  } finally { await reduced.close(); }
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('All impact-effects checks passed.');
} finally { await browser.close(); }
