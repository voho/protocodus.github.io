// Serve the repository root, then run:
// TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node fun/tyran/tests/timing-check.mjs
// Frame timestamps are controlled; image loading and browser keyboard events are real.
// These are timing/behavior regressions, not hardware-dependent FPS assertions.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const errors = [];
let failures = 0;

async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}
function near(actual, expected, message, tolerance = 1e-7) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} versus ${expected}`);
}

async function flight(mode = 1) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const queued = new Map(); let sequence = 0;
    window.__frameTime = 1000;
    window.requestAnimationFrame = callback => { const id = ++sequence; queued.set(id, callback); return id; };
    window.cancelAnimationFrame = id => queued.delete(id);
    window.__queuedFrames = () => queued.size;
    window.__pumpFrame = timestamp => {
      window.__frameTime = timestamp;
      const callbacks = [...queued.values()]; queued.clear();
      for (const callback of callbacks) callback(timestamp);
      return callbacks.length;
    };
    // The pilot's label shares the ship's rendered coordinates. Observe actual
    // painting to distinguish interpolation from repeated simulation positions.
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
      if (this.canvas.id === 'game-canvas' && text === 'P1') window.__paintedPilot = { x, y };
      return fillText.call(this, text, x, y, ...rest);
    };
    localStorage.clear(); localStorage.setItem('tyran-muted', 'true');
  });
  await page.goto(url);
  // Poll with a timer because Playwright's default wait uses our paused RAF.
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
  await page.evaluate(async mode => {
    await tyran.world.ready;
    document.querySelector(`[data-mode="${mode}"]`).click();
    document.querySelector('#launch-button').click();
    __pumpFrame(__frameTime);
  }, mode);
  return page;
}

async function advance(page, seconds, hz = 60) {
  await page.evaluate(({ seconds, hz }) => {
    const start = __frameTime;
    for (let i = 1; i <= Math.ceil(seconds * hz - 1e-9); i++) __pumpFrame(start + Math.min(seconds, i / hz) * 1000);
  }, { seconds, hz });
}
async function snapshot(page) {
  return page.evaluate(() => ({ time: tyran.state.time, width: tyran.state.width,
    players: tyran.state.players.map(p => ({ x: p.x, y: p.y, px: p.px, py: p.py, vx: p.vx, vy: p.vy, mass: p.mass })),
    teams: [...new Set(tyran.state.bullets.map(b => b.team))], perf: tyran.performance,
    painted: window.__paintedPilot, surfaceWidth: document.querySelector('#game-canvas').width }));
}

try {
  await check('held keyboard input advances equally with 30, 60 and 120 Hz rendering', async () => {
    const results = [];
    for (const hz of [30, 60, 120]) {
      const page = await flight();
      try {
        await page.keyboard.down('KeyD'); await page.keyboard.down('KeyW'); await page.keyboard.down('KeyY');
        await advance(page, 1, hz);
        results.push(await snapshot(page));
      } finally { await page.close(); }
    }
    for (const result of results) {
      near(result.time, 1, 'one second of flight'); assert.equal(result.perf.steps, 60);
      assert.ok(result.teams.includes(0), 'shooting remains active');
      for (const field of ['x', 'y', 'vx', 'vy']) near(result.players[0][field], results[0].players[0][field], `${field} across refresh rates`);
    }
  });

  await check('120 Hz draws interpolate visible pilot movement between fixed updates', async () => {
    const page = await flight();
    try {
      await page.keyboard.down('KeyD');
      await advance(page, 1 / 60, 120);
      const first = await snapshot(page);
      await advance(page, 1 / 120, 120);
      const between = await snapshot(page);
      assert.equal(between.perf.steps, first.perf.steps, 'half a tick must not advance physics');
      near(between.players[0].x, first.players[0].x, 'simulation position remains unchanged');
      assert.ok(between.painted.x > first.painted.x, 'the painted ship moves on the intervening display frame');
      assert.ok(between.painted.x < between.players[0].x && between.painted.x > between.players[0].px, 'paint stays between the adjacent simulation positions');
      near(between.perf.interpolation, .5, 'half-step interpolation');
    } finally { await page.close(); }
  });

  await check('80 ms frames catch up and a 500 ms stall has bounded recovery', async () => {
    const page = await flight();
    try {
      await advance(page, .08, 12.5);
      const caughtUp = await snapshot(page);
      assert.equal(caughtUp.perf.steps, 4);
      assert.ok(caughtUp.time > .06 && Math.abs(caughtUp.time - .08) < caughtUp.perf.fixedStep, 'slow frames retain elapsed simulation time');
      await advance(page, .5, 2);
      const stalled = await snapshot(page);
      assert.equal(stalled.perf.steps - caughtUp.perf.steps, 6, 'long stalls catch up at most six ticks');
      await advance(page, 1 / 60);
      const recovered = await snapshot(page);
      assert.equal(recovered.perf.steps - stalled.perf.steps, 1, 'discarded stall time must not create a continuing backlog');
    } finally { await page.close(); }
  });

  await check('pause freezes physics and painting, then resumes without a time backlog', async () => {
    const page = await flight();
    try {
      await advance(page, .2);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => tyran.scene), 'pause');
      await advance(page, .2, 5); // Paint the newly opened pause state once.
      const paused = await snapshot(page);
      await page.waitForTimeout(220); // Allow the real idle timer to schedule its check.
      assert.ok(await page.evaluate(() => __queuedFrames() > 0), 'idle state schedules a lightweight wakeup');
      await advance(page, 5, .2);
      const idle = await snapshot(page);
      near(idle.time, paused.time, 'pause time');
      assert.equal(idle.perf.frames, paused.perf.frames, 'an unchanged paused arena is not repainted');
      await page.keyboard.press('Escape');
      await advance(page, 3, 1 / 3); // First resumed frame establishes a fresh timestamp.
      near((await snapshot(page)).time, paused.time, 'resume ignores the paused interval');
      await advance(page, 1 / 60);
      near((await snapshot(page)).time, paused.time + 1 / 60, 'resume advances normally on the next frame');
    } finally { await page.close(); }
  });

  await check('adaptive resolution lowers pixel work without moving or resizing the arena', async () => {
    const page = await flight();
    try {
      await advance(page, .2, 60);
      const before = await snapshot(page);
      await advance(page, 4.3, 30);
      const after = await snapshot(page);
      assert.ok(after.perf.renderScale < before.perf.renderScale && after.surfaceWidth < before.surfaceWidth, 'sustained slow frames reduce backing resolution');
      assert.equal(after.width, before.width, 'logical arena size remains unchanged');
      near(after.players[0].x, before.players[0].x, 'adaptive resolution preserves pilot x');
      near(after.players[0].y, before.players[0].y, 'adaptive resolution preserves pilot y');
      near(after.time, 4.5, 'resolution changes preserve elapsed flight time');
    } finally { await page.close(); }
  });

  async function steerSequence(mode, bindings) {
    const page = await flight(mode);
    try {
      const initial = await snapshot(page), samples = [];
      for (const binding of bindings) await page.keyboard.down(binding.fire);
      for (const [part, seconds] of [['forward', .2], ['coast', .1], ['reverse', .15], ['coast', .1]]) {
        for (const binding of bindings) {
          for (const key of [...binding.forward, ...binding.reverse]) await page.keyboard.up(key);
          for (const key of binding[part] || []) await page.keyboard.down(key);
        }
        await advance(page, seconds);
        const current = await snapshot(page);
        samples.push({ teams: current.teams, players: current.players.map((p, i) => ({ x: p.x - initial.players[i].x, y: p.y - initial.players[i].y, vx: p.vx, vy: p.vy })) });
      }
      return samples;
    } finally { await page.close(); }
  }
  const wasd = { forward: ['KeyD', 'KeyW'], reverse: ['KeyA', 'KeyS'], fire: 'KeyY' };
  const ijkl = { forward: ['KeyL', 'KeyI'], reverse: ['KeyJ', 'KeyK'], fire: 'KeyN' };

  await check('solo controls preserve acceleration, coast and reversal', async () => {
    const samples = await steerSequence(1, [wasd]);
    assert.ok(samples.every(sample => sample.teams.includes(0)), 'Y fires the solo pilot throughout steering');
    assert.ok(samples[1].players[0].x > samples[0].players[0].x, 'the pilot coasts after movement keys release');
    assert.ok(samples[2].players[0].vx < 0, 'reverse input changes direction');
  });

  await check('co-op pilots respond equally to their separate keyboard layouts', async () => {
    const samples = await steerSequence(2, [wasd, ijkl]);
    for (let i = 0; i < samples.length; i++) {
      for (const field of ['x', 'y', 'vx', 'vy']) near(samples[i].players[0][field], samples[i].players[1][field], `co-op ${field}, steering phase ${i}`);
      assert.ok(samples[i].teams.includes(0) && samples[i].teams.includes(1), 'Y and N each fire their own pilot');
    }
  });

  await check('browser reports no runtime errors', () => assert.deepEqual(errors, []));
} finally { await browser.close(); }

if (failures) process.exitCode = 1;
else console.log('All browser timing and control checks passed.');
