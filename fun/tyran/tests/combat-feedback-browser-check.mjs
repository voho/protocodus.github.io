// Real reward events aggregate once into a stationary, refreshable flight indicator.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8774/fun/tyran/';
const output = process.env.TYRAN_FEEDBACK_OUTPUT || '/tmp/tyran-feedback-qa';
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir(output, { recursive: true });
await page.addInitScript(() => {
  const queued = new Map(); let sequence = 0, time = 1000;
  window.requestAnimationFrame = callback => { const id = ++sequence; queued.set(id, callback); return id; };
  window.cancelAnimationFrame = id => queued.delete(id);
  window.__frame = (elapsed = 0) => {
    time += elapsed;
    const callbacks = [...queued.values()]; queued.clear();
    for (const callback of callbacks) callback(time);
  };
  window.__seconds = seconds => { for (let i = 0; i < Math.round(seconds * 60); i++) __frame(1000 / 60); };
  window.canvasLabels = [];
  const fillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
    if (this.canvas.id === 'game-canvas') canvasLabels.push(String(text));
    return fillText.call(this, text, ...args);
  };
  localStorage.setItem('tyran-muted', 'true');
});
const snapshot = () => page.evaluate(() => {
  const f = tyran.feedback, el = document.querySelector('#combat-feedback'), rect = el.getBoundingClientRect(), css = getComputedStyle(el);
  return { score: f.score, credits: f.credits, chain: f.chain, label: f.label, details: f.details, revision: f.revision, visible: f.visible, opacity: f.opacity,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    displayed: !el.hidden && css.display !== 'none' && css.visibility !== 'hidden', cssOpacity: Number(css.opacity),
    text: el.textContent.replace(/\s+/g, ' ').trim(), childScore: document.querySelector('#combat-feedback-score').textContent,
    childCredits: document.querySelector('#combat-feedback-credits').textContent,
  };
});
try {
  await page.goto(url); await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
  await page.evaluate(() => {
    tyran.launch(7); tyran.state.director.hold = true; tyran.state.players[0].guard = 1e8;
    __frame(); canvasLabels.length = 0;
  });
  const initial = await snapshot();
  assert.equal(initial.visible, false);
  const reward = await page.evaluate(async () => {
    const { spawnEnemy, killEnemy, applyGroundReward } = await import('./sim.js');
    const s = tyran.state, p = s.players[0], before = { score: s.score, credits: s.credits };
    s.squadrons.push({ id: 100, size: 2, killed: 0, broken: false, wave: 0 });
    for (let i = 0; i < 5; i++) {
      const enemy = spawnEnemy(s, 0, 220 + i * 170, 170 + i * 30);
      if (i < 2) enemy.squad = 100;
      if (i === 0) enemy.ai = 'dive';
      killEnemy(s, enemy);
    }
    const captor = spawnEnemy(s, 6, 1200, 260); captor.captive = 1; killEnemy(s, captor);
    p.power = 4; p.drones = 2; p.bombs = 5;
    for (const kind of ['power', 'drone', 'bomb', 'credit', 'repair', 'rapid']) s.pickups.push({ x: p.x, y: p.y, age: 0, kind, value: kind === 'credit' ? 80 : 0 });
    applyGroundReward(s, { structural: true, value: 12, x: 700, y: 440, size: 30 });
    tyran.step(1 / 60);
    s.pickups.length = 0; // Ignore loose drops; subsequent increments are explicit fixtures.
    for (let i = 0; i < 20; i++) s.bullets.push({ x: 100 + i * 30, y: 150, px: 100 + i * 30, py: 150, vx: 0, vy: 0, life: 2, team: -1, radius: 3, damage: 1, age: 0 });
    tyran.step(1 / 60, [{ bomb: true }]);
    __frame();
    return { score: s.score - before.score, credits: s.credits - before.credits, chain: s.combo, bombs: p.bombs,
      labels: [...canvasLabels], worldTexts: tyran.fx.texts?.length || 0 };
  });
  const combined = await snapshot();
  assert.equal(combined.score, reward.score, 'kills, dive multipliers, squad bonus, rescue, overflow pickups, ground reward and nova score are each counted once');
  assert.equal(combined.credits, reward.credits, 'ground/ship salvage, full drone and credit pickups are counted once');
  assert(reward.score > 3000 && reward.credits > 180 && reward.chain >= 5, 'the fixture covers mixed numeric rewards and Rampage');
  assert.equal(combined.chain, reward.chain); assert.match(combined.label, /Rampage/i);
  assert.equal(combined.visible, true); assert.equal(combined.displayed, true); assert.equal(combined.opacity, 1);
  assert.equal(reward.worldTexts, 0, 'rewards never create world-position text objects');
  assert(!reward.labels.some(text => /Rampage|Multi kill|Double kill|Squadron|Drone rescued|rounds cleared|^\+/.test(text)), 'reward/streak labels are absent from the gameplay canvas');
  assert.equal(await page.locator('#combat-feedback').count(), 1, 'one indicator serves all reward events');
  await page.screenshot({ path: `${output}/combined-desktop.png` });

  await page.evaluate(() => __seconds(1.5));
  const faded = await snapshot();
  assert(faded.opacity > 0 && faded.opacity < combined.opacity, 'the single indicator gradually fades');
  assert.deepEqual(faded.rect, combined.rect, 'fading never moves the indicator');
  await page.evaluate(() => {
    const p = tyran.state.players[0]; tyran.state.pickups.push({ x: p.x, y: p.y, age: 0, kind: 'credit', value: 70 });
    tyran.step(1 / 60); __frame();
  });
  const refreshed = await snapshot();
  assert.equal(refreshed.credits, combined.credits + 70); assert.equal(refreshed.score, combined.score);
  assert.equal(refreshed.opacity, 1, 'new rewards refresh the same indicator to full opacity');
  assert(refreshed.revision > combined.revision); assert.deepEqual(refreshed.rect, combined.rect, 'growing totals do not change the stationary layout');

  await page.evaluate(() => { tyran.pause(); __seconds(2); });
  const paused = await snapshot();
  assert.equal(paused.opacity, refreshed.opacity, 'pause freezes the feedback timer');
  assert.equal(paused.displayed, false, 'the pause menu hides gameplay feedback');
  await page.evaluate(() => { tyran.pause(); __frame(); });
  const resumed = await snapshot();
  assert.equal(resumed.displayed, true); assert.equal(resumed.credits, refreshed.credits);
  await page.evaluate(() => __seconds(4.2));
  const expired = await snapshot();
  assert.equal(expired.visible, false); assert.equal(expired.opacity, 0);
  await page.evaluate(() => {
    const p = tyran.state.players[0]; tyran.state.pickups.push({ x: p.x, y: p.y, age: 0, kind: 'credit', value: 30 });
    tyran.step(1 / 60); __frame();
  });
  const fresh = await snapshot();
  assert.equal(fresh.score, 0); assert.equal(fresh.credits, 30, 'a reward after expiration starts a fresh burst');

  const responsive = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 5120, height: 1440 }]) {
    await page.setViewportSize(viewport); await page.evaluate(() => __frame());
    const current = await snapshot();
    assert(current.displayed && current.rect.width > 0 && current.rect.height > 0);
    assert(current.rect.x >= 0 && current.rect.y >= 0 && current.rect.x + current.rect.width <= viewport.width + .5 && current.rect.y + current.rect.height <= viewport.height + .5, 'feedback remains inside narrow and ultrawide viewports');
    assert.equal(current.credits, 30); assert.equal(current.score, 0);
    responsive.push({ viewport, ...current });
    await page.screenshot({ path: `${output}/feedback-${viewport.width}x${viewport.height}.png` });
  }
  await page.evaluate(() => { tyran.launch(0); tyran.state.director.hold = true; __frame(); });
  const restarted = await snapshot();
  assert.equal(restarted.score, 0); assert.equal(restarted.credits, 0); assert.equal(restarted.visible, false, 'new flight resets all transient reward feedback');
  const touchLayouts = [];
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const touch = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    touch.on('pageerror', error => errors.push(error.message));
    await touch.addInitScript(() => {
      const queued = new Map(); let sequence = 0;
      window.requestAnimationFrame = callback => { const id = ++sequence; queued.set(id, callback); return id; };
      window.cancelAnimationFrame = id => queued.delete(id);
      window.__touchFrame = () => { const callbacks = [...queued.values()]; queued.clear(); for (const callback of callbacks) callback(1000); };
      localStorage.setItem('tyran-muted', 'true');
    });
    await touch.goto(url); await touch.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
    const layout = await touch.evaluate(async () => {
      const { spawnEnemy, killEnemy } = await import('./sim.js');
      tyran.launch(7); const s = tyran.state, p = s.players[0]; s.director.hold = true; p.guard = 10000;
      for (let i = 0; i < 5; i++) killEnemy(s, spawnEnemy(s, 0, 80 + i * 50, 180));
      p.power = 4; p.drones = 2;
      for (const kind of ['power', 'drone', 'rapid', 'invulnerable', 'credit']) s.pickups.push({ x: p.x, y: p.y, age: 0, kind, value: kind === 'credit' ? 12345 : 0 });
      tyran.step(1 / 60); __touchFrame();
      const bounds = selector => {
        const el = document.querySelector(selector), r = el.getBoundingClientRect(), css = getComputedStyle(el);
        return { selector, x: r.x, y: r.y, width: r.width, height: r.height, visible: css.display !== 'none' && css.visibility !== 'hidden' && r.width > 0 && r.height > 0 };
      };
      const el = document.querySelector('#combat-feedback');
      return { coarse: matchMedia('(pointer: coarse)').matches, feedback: bounds('#combat-feedback'), score: tyran.feedback.score, credits: tyran.feedback.credits, chain: tyran.feedback.chain,
        text: el.textContent.replace(/\s+/g, ' ').trim(), overflowX: el.scrollWidth > el.clientWidth, overflowY: el.scrollHeight > el.clientHeight,
        obstacles: ['#p1-panel', '#touch-stick', '#touch-fire', '#touch-secondary', '#touch-bomb'].map(bounds) };
    });
    assert(layout.coarse && layout.feedback.visible, 'coarse pointer flight shows its feedback');
    assert(layout.score > 1000 && layout.credits > 12345 && layout.chain >= 5, 'touch layout shows a full mixed-reward readout');
    assert(!layout.overflowX && !layout.overflowY, 'mixed rewards fit inside the compact panel');
    const f = layout.feedback;
    assert(f.x >= 0 && f.y >= 0 && f.x + f.width <= viewport.width + .5 && f.y + f.height <= viewport.height + .5);
    for (const o of layout.obstacles) if (o.visible) {
      const overlapX = Math.max(0, Math.min(f.x + f.width, o.x + o.width) - Math.max(f.x, o.x));
      const overlapY = Math.max(0, Math.min(f.y + f.height, o.y + o.height) - Math.max(f.y, o.y));
      assert(overlapX * overlapY < .5, `feedback clears ${o.selector} on ${viewport.width}×${viewport.height}`);
    }
    await touch.screenshot({ path: `${output}/touch-${viewport.width}x${viewport.height}.png` });
    touchLayouts.push({ viewport, ...layout }); await touch.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ initial, reward, combined, faded, refreshed, paused, resumed, expired, fresh, responsive, restarted, touchLayouts, errors }, null, 2));
  console.log('PASS one stationary combat indicator: real reward accounting, Rampage, no floating labels, fade refresh, pause, expiry, restart and responsive layout.');
} finally { await browser.close(); }
