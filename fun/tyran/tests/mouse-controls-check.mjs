// Serve the repo root; run with TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs.
// Drive real pointer/keyboard events and fixed RAF times to inspect steering.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  const queued = new Map(); let id = 0, time = 1000;
  window.requestAnimationFrame = callback => { queued.set(++id, callback); return id; };
  window.cancelAnimationFrame = id => queued.delete(id);
  window.__advance = (frames, hz = 60) => {
    for (let i = 0; i < frames; i++) {
      time += 1000 / hz;
      const callbacks = [...queued.values()]; queued.clear();
      callbacks.forEach(callback => callback(time));
    }
    return tyran.state.players.map(({ x, y, vx, vy, fire }) => ({ x, y, vx, vy, fire }));
  };
  window.addEventListener('pointerdown', event => { if (event.pointerType === 'mouse') window.__mouseId = event.pointerId; }, true);
  localStorage.clear(); localStorage.setItem('tyran-muted', 'true');
});
const advance = (frames, hz = 60) => page.evaluate(([frames, hz]) => __advance(frames, hz), [frames, hz]);
async function fixture(mode = 1, heavy = false) {
  await page.evaluate(({ mode, heavy }) => {
    document.querySelector(`[data-mode="${mode}"]`).click(); tyran.launch();
    const state = tyran.state;
    Object.assign(state, { spawnTimer: Infinity, formationTimer: Infinity, showcase: 9, duration: 1e6 });
    for (const key of Object.keys(state.upgrades)) state.upgrades[key] = heavy ? 6 : 0;
    state.players.forEach((pilot, index) => Object.assign(pilot, { x: state.width * (index ? .7 : 1 / 3), y: 650,
      px: state.width * (index ? .7 : 1 / 3), py: 650, vx: 0, vy: 0, hurt: Infinity }));
    tyran.world.hit = () => [];
    __advance(2);
  }, { mode, heavy });
}
async function aim(x, y) {
  const point = await page.evaluate(({ x, y }) => {
    const rect = document.querySelector('#game-canvas').getBoundingClientRect();
    return { x: rect.left + x / tyran.state.width * rect.width, y: rect.top + y / tyran.state.height * rect.height };
  }, { x, y });
  await page.mouse.move(point.x + .1, point.y + .1); await page.mouse.move(point.x, point.y);
}
try {
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
  const flights = [];
  for (const heavy of [false, true]) for (const hz of [30, 60, 120]) {
    await fixture(1, heavy); await aim(850, 450);
    const early = (await advance(hz / 10, hz))[0];
    const trajectory = await page.evaluate(hz => {
      const positions = [];
      for (let i = 0; i < hz * 2; i++) positions.push(__advance(1, hz)[0]);
      return { end: positions.at(-1), maxX: Math.max(...positions.map(p => p.x)), minY: Math.min(...positions.map(p => p.y)) };
    }, hz);
    assert.ok(Math.hypot(trajectory.end.x - 850, trajectory.end.y - 450) < 1, 'the ship settles at the cursor');
    assert.ok(trajectory.maxX <= 850.5 && trajectory.minY >= 449.5, 'the approach has no visible overshoot');
    flights.push({ heavy, hz, early, ...trajectory });
  }
  assert.ok(flights.find(f => !f.heavy && f.hz === 60).early.x > flights.find(f => f.heavy && f.hz === 60).early.x + 1, 'armor mass still slows initial acceleration');
  for (const heavy of [false, true]) {
    const variants = flights.filter(f => f.heavy === heavy);
    assert.ok(Math.max(...variants.map(f => f.end.x)) - Math.min(...variants.map(f => f.end.x)) < .05, 'steering remains consistent at 30/60/120 Hz');
  }

  await fixture(); await aim(850, 450); await advance(15);
  const beforeKeyboard = (await advance(1))[0];
  await page.keyboard.down('a'); const keyboard = (await advance(30))[0]; await page.keyboard.up('a');
  assert.ok(keyboard.x < beforeKeyboard.x - 40, 'WASD takes over from the mouse');
  const settledKeyboard = (await advance(60))[0], noMouseMove = (await advance(30))[0];
  assert.ok(Math.abs(settledKeyboard.x - noMouseMove.x) < 1, 'releasing keys does not pull the ship back to an old cursor target');
  await aim(851, 451); const restoredMouse = (await advance(150))[0];
  assert.ok(Math.hypot(restoredMouse.x - 851, restoredMouse.y - 451) < 1, 'a new mouse move restores pointer steering');
  await page.keyboard.down('ArrowLeft'); const soloArrow = (await advance(30))[0]; await page.keyboard.up('ArrowLeft');
  assert.ok(soloArrow.x < restoredMouse.x - 90, 'solo arrow controls remain equivalent to WASD');

  await fixture(2); await aim(650, 420);
  await page.keyboard.down('ArrowLeft'); const coop = await advance(30); await page.keyboard.up('ArrowLeft');
  assert.ok(coop[0].x > 480 && coop[1].x < 750, 'mouse steers P1 while arrows independently steer P2');
  await page.mouse.down(); const firing = await advance(15); await page.mouse.up();
  assert.ok(firing[0].fire > 0 && firing[1].fire < 0, 'left mouse fires only player one');
  await page.keyboard.down('ControlRight'); const wingmateFire = await advance(30); await page.keyboard.up('ControlRight');
  assert.ok(wingmateFire[0].fire < 0 && wingmateFire[1].fire > 0, 'right Control still fires only the wingmate');

  for (const end of ['release', 'cancel', 'pause', 'blur']) {
    await fixture(); await aim(650, 450); await page.mouse.down();
    assert.ok((await advance(15))[0].fire > 0, `${end}: holding left mouse fires`);
    if (end === 'cancel') await page.evaluate(() => document.querySelector('#game-canvas').dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'mouse', pointerId: __mouseId, bubbles: true })));
    if (end === 'pause') await page.evaluate(() => tyran.pause());
    if (end === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    // Release outside the arena exercises window-level cleanup and capture.
    await page.mouse.move(-20, 950); await page.mouse.up();
    if (end === 'pause' || end === 'blur') {
      assert.equal(await page.evaluate(() => tyran.scene), 'pause');
      await page.evaluate(() => tyran.pause());
    }
    assert.ok((await advance(35))[0].fire < 0, `${end} clears firing before the next flight frames`);
  }

  await fixture();
  const ignored = await page.evaluate(() => {
    const canvas = document.querySelector('#game-canvas');
    for (const pointerType of ['touch', 'pen']) for (const type of ['pointermove', 'pointerdown']) {
      canvas.dispatchEvent(new PointerEvent(type, { pointerType, clientX: 850, clientY: 350, button: 0, buttons: 1, bubbles: true }));
    }
    return __advance(30)[0];
  });
  assert.ok(Math.abs(ignored.x - 400) < .01 && ignored.fire < 0, 'touch and pen events on the canvas never enter mouse control');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => tyran.state.width === 430, null, { polling: 20 });
  await fixture(); await aim(350, 400);
  const narrow = (await advance(120))[0];
  assert.ok(Math.hypot(narrow.x - 350, narrow.y - 400) < 1, 'CSS pointer positions map to the narrow logical arena');
  await page.mouse.down(); await page.mouse.move(-100, 1000); const edge = (await advance(150))[0]; await page.mouse.up();
  assert.ok(Math.abs(edge.x - 30) < 1 && Math.abs(edge.y - 858) < 1, 'captured pointers outside the viewport clamp to playable bounds');
  assert.deepEqual(errors, [], 'no runtime errors');
  console.log('PASS mouse momentum and mass, 30/60/120 Hz steering, keyboard takeover, co-op, firing cleanup and narrow-screen bounds');
} finally { await browser.close(); }
