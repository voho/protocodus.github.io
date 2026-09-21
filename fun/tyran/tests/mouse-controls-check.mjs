// Serve repo root; run with TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs.
// Real mouse events must leave flight controls to the keyboard and touch controls.
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
  window.__advance = frames => {
    for (let i = 0; i < frames; i++) {
      time += 1000 / 60;
      const callbacks = [...queued.values()]; queued.clear();
      for (const callback of callbacks) callback(time);
    }
  };
  localStorage.clear(); localStorage.setItem('tyran-muted', 'true');
});
const advance = frames => page.evaluate(frames => __advance(frames), frames);
const snapshot = () => page.evaluate(() => ({
  pilots: tyran.state.players.map(({ x, y, vx, vy }) => ({ x, y, vx, vy })),
  shots: tyran.state.players.map(p => tyran.state.bullets.filter(b => b.team === p.id).length),
}));
async function fixture(mode) {
  await page.evaluate(mode => {
    document.querySelector(`[data-mode="${mode}"]`).click(); tyran.launch();
    const s = tyran.state;
    Object.assign(s, { spawnTimer: Infinity, formationTimer: Infinity, showcase: 9, duration: 1e6 });
    s.players.forEach((p, i) => Object.assign(p, { x: s.width * (i ? .7 : 1 / 3), px: s.width * (i ? .7 : 1 / 3), y: 650, py: 650, vx: 0, vy: 0, hurt: Infinity }));
    tyran.world.hit = () => []; __advance(2);
  }, mode);
}
async function point(fractionX, y) {
  const target = await page.evaluate(({ fractionX, y }) => {
    const rect = document.querySelector('#game-canvas').getBoundingClientRect();
    return { x: rect.left + rect.width * fractionX, y: rect.top + rect.height * y / tyran.state.height };
  }, { fractionX, y });
  await page.mouse.move(target.x, target.y, { steps: 3 });
}
async function click(id) {
  const box = await page.locator(`#${id}`).boundingBox();
  assert.ok(box, `${id} is visible`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
async function keyboardFlight(mode, withMouse) {
  await fixture(mode);
  const keys = ['KeyD', 'KeyW', 'KeyY', ...(mode === 2 ? ['KeyJ', 'KeyI', 'KeyN'] : [])];
  for (const key of keys) await page.keyboard.down(key);
  if (withMouse) { await point(.15, 730); await page.mouse.down(); }
  await advance(18);
  if (withMouse) await point(.85, 220);
  await advance(12);
  for (const key of keys) await page.keyboard.up(key);
  if (withMouse) { await page.mouse.up(); await point(.15, 730); }
  await advance(12);
  return snapshot();
}

try {
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
  for (const mode of [1, 2]) {
    await fixture(mode);
    const start = await snapshot();
    await point(.85, 300); await advance(18);
    assert.deepEqual(await snapshot(), start, `${mode}-pilot flight ignores mouse movement`);
    await page.evaluate(() => document.querySelector('#pause-button').focus());
    await page.mouse.down(); await advance(18);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'game-canvas', 'a canvas click focuses the keyboard arena');
    assert.deepEqual(await snapshot(), start, `${mode}-pilot flight ignores held mouse fire`);
    await point(.15, 730); await advance(18);
    assert.deepEqual(await snapshot(), start, `${mode}-pilot flight ignores mouse dragging`);
    await page.mouse.move(-20, 950); await page.mouse.up(); await point(.65, 200); await advance(18);
    assert.deepEqual(await snapshot(), start, `${mode}-pilot flight stays stationary and silent after outside release`);

    const keyboard = await keyboardFlight(mode, false), mixed = await keyboardFlight(mode, true);
    assert.deepEqual(mixed, keyboard, `${mode}-pilot keyboard movement and shot counts are unchanged by mouse activity`);
    assert.ok(keyboard.pilots[0].x > start.pilots[0].x && keyboard.pilots[0].y < start.pilots[0].y, 'WASD still steers pilot one');
    if (mode === 2) assert.ok(keyboard.pilots[1].x < start.pilots[1].x && keyboard.pilots[1].y < start.pilots[1].y, 'IJKL still steers pilot two independently');
    assert.ok(keyboard.shots.every(count => count > 0), 'held primary keys still fire for every active pilot');
  }
  console.log('PASS real mouse move/hold/drag/release cannot steer, fire or override solo/co-op keyboard controls');

  await fixture(1);
  // Expose the touch overlay to model a hybrid device with both input methods.
  await page.evaluate(() => { document.querySelector('#touch-controls').style.display = 'flex'; });
  const touchStart = await snapshot(), stick = await page.locator('#touch-stick').boundingBox(), fire = await page.locator('#touch-fire').boundingBox();
  assert.ok(stick && fire, 'touch controls are visible for the hybrid-input fixture');
  await page.mouse.move(stick.x + stick.width / 2, stick.y + stick.height / 2); await page.mouse.down();
  await page.mouse.move(stick.x + stick.width / 2 + 35, stick.y + stick.height / 2 - 30); await advance(18); await page.mouse.up();
  await page.mouse.move(fire.x + fire.width / 2, fire.y + fire.height / 2); await page.mouse.down(); await advance(18); await page.mouse.up();
  const secondary = await page.locator('#touch-secondary').boundingBox();
  assert.ok(secondary, 'secondary touch fire is visible');
  await page.mouse.move(secondary.x + secondary.width / 2, secondary.y + secondary.height / 2); await page.mouse.down(); await advance(18); await page.mouse.up();
  assert.deepEqual(await snapshot(), touchStart, 'mouse input on visible touch controls cannot steer or fire either channel');
  await page.evaluate(() => document.querySelector('#touch-controls').style.removeProperty('display'));
  console.log('PASS visible touch controls also reject mouse input on hybrid devices');

  await click('pause-button'); assert.equal(await page.evaluate(() => tyran.scene), 'pause');
  await click('resume-button'); assert.equal(await page.evaluate(() => tyran.scene), 'playing');
  await click('pause-button'); await click('menu-button');
  assert.equal(await page.evaluate(() => tyran.scene), 'menu', 'pause/menu buttons remain clickable');
  const quality = await page.locator('#quality-toggle').getAttribute('aria-pressed');
  await click('quality-toggle');
  assert.notEqual(await page.locator('#quality-toggle').getAttribute('aria-pressed'), quality, 'menu settings still accept mouse clicks');
  assert.deepEqual(errors, [], 'no runtime errors');
  console.log('PASS arena click focus and native pause, resume and menu buttons');
} finally { await browser.close(); }
