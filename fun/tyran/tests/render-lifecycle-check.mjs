// Serve repo root, then TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node this file.
// Controlled RAF timestamps exercise overload recovery and end-screen cleanup reliably.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const errors = [];

async function flight() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const queued = new Map(); let sequence = 0;
    window.requestAnimationFrame = callback => { const id = ++sequence; queued.set(id, callback); return id; };
    window.cancelAnimationFrame = id => queued.delete(id);
    window.__pumpFrame = timestamp => {
      const callbacks = [...queued.values()]; queued.clear();
      for (const callback of callbacks) callback(timestamp);
    };
    localStorage.clear(); localStorage.setItem('tyran-muted', 'true');
  });
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  await page.waitForFunction(() => window.tyran, null, { polling: 20 });
  await page.evaluate(async () => {
    await tyran.world.ready;
    tyran.launch(); __pumpFrame(1000);
  });
  return page;
}

try {
  const overloaded = await flight();
  try {
    const result = await overloaded.evaluate(() => {
      tyran.state.players[0].hurt = 1e6;
      for (let i = 1; i <= 12; i++) __pumpFrame(1000 + i * 1000 / 60);
      const before = { ...tyran.performance, width: tyran.state.width, surfaceWidth: document.querySelector('#game-canvas').width };
      // Frames above 100 ms used to be omitted from load sampling altogether.
      for (let i = 1; i <= 56; i++) __pumpFrame(1200 + i * 125);
      return { before, after: { ...tyran.performance, width: tyran.state.width,
        surfaceWidth: document.querySelector('#game-canvas').width }, scene: tyran.scene };
    });
    assert.equal(result.scene, 'playing');
    assert.ok(result.after.fps < 15, 'sustained 8 FPS frames must update measured load');
    assert.ok(result.after.renderScale < result.before.renderScale, 'very slow frames must trigger adaptive resolution');
    assert.ok(result.after.surfaceWidth < result.before.surfaceWidth, 'adaptive resolution reduces actual pixel work');
    assert.equal(result.after.width, result.before.width, 'overload recovery preserves logical arena dimensions');
    console.log('PASS adaptive resolution responds to sustained frame times above 100 ms');
  } finally { await overloaded.close(); }

  const ending = await flight();
  try {
    const result = await ending.evaluate(async () => {
      const { Effects } = await import('./effects.js');
      const { hurtPlayer } = await import('./sim.js');
      // Observe the real Effects instance without exposing a production-only test API.
      const original = Effects.prototype.draw;
      let effects;
      Effects.prototype.draw = function (...args) { effects = this; return original.apply(this, args); };
      Math.random = () => 0; // Deterministic particle lifetimes during end-screen cleanup.
      const pilot = tyran.state.players[0];
      tyran.state.pickups.push({ x: pilot.x, y: pilot.y, age: 0, kind: 'credit', value: 80 });
      tyran.step(1 / 60);
      const hadReward = tyran.feedback.visible && tyran.feedback.credits === 80;
      pilot.shield = 0; pilot.hull = 1; pilot.hurt = 0; tyran.state.lives = 0;
      hurtPlayer(tyran.state, pilot, 100); tyran.step(1 / 60);
      __pumpFrame(1100);
      const feedbackHidden = getComputedStyle(document.querySelector('#combat-feedback')).visibility === 'hidden' || document.querySelector('#combat-feedback').hidden || getComputedStyle(document.querySelector('#combat-feedback')).display === 'none';
      for (let i = 1; i <= 120; i++) __pumpFrame(1100 + i * 1000 / 60);
      const finished = { scene: tyran.scene, hadReward, feedbackHidden,
        particles: effects.particles.length, rings: effects.rings.length,
        lights: effects.lights.length, delayed: effects.delayed.length,
        flash: effects.flash, shake: effects.shake, frames: tyran.performance.frames };
      for (let i = 1; i <= 60; i++) __pumpFrame(3100 + i * 1000 / 60);
      return { ...finished, idleFrames: tyran.performance.frames };
    });
    assert.equal(result.scene, 'end');
    assert.equal(result.hadReward, true, 'the fatal-hit scenario includes a real collected reward');
    assert.equal(result.feedbackHidden, true, 'ending the flight hides its transient reward indicator');
    for (const kind of ['particles', 'rings', 'lights', 'delayed']) {
      assert.equal(result[kind], 0, `end-screen ${kind} must finish their lifetimes`);
    }
    assert.ok(result.flash <= .01 && result.shake <= .3, 'visible impact motion finishes before idling');
    assert.equal(result.idleFrames, result.frames, 'the completed end screen stops repainting');
    console.log('PASS reward feedback hides on flight end, final explosions finish, and the end screen becomes idle');
  } finally { await ending.close(); }
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('Render lifecycle checks passed.');
} finally { await browser.close(); }
