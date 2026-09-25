// Serve repo root; TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node this file.
// Drives the wave script, power cores, wing drones, captor, lancer beams, novas,
// reserve ships, the challenging stage and the gun shop through the real page.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
await page.addInitScript(() => {
  const queued = new Map(); let next = 0;
  window.__frameTime = 1000;
  window.requestAnimationFrame = callback => { const id = ++next; queued.set(id, callback); return id; };
  window.cancelAnimationFrame = id => queued.delete(id);
  window.__pumpFrame = timestamp => { __frameTime = timestamp; const callbacks = [...queued.values()]; queued.clear(); for (const callback of callbacks) callback(timestamp); };
  window.__advance = seconds => { const start = __frameTime; for (let i = 1; i <= Math.ceil(seconds * 60); i++) __pumpFrame(start + i * 1000 / 60); };
  localStorage.setItem('tyran-muted', 'true');
});
const text = id => page.locator(`#${id}`).textContent();

try {
  await page.goto(url);
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
  await page.evaluate(() => { document.querySelector('#launch-button').click(); __pumpFrame(__frameTime + 16); });
  assert.equal(await page.evaluate(() => tyran.scene), 'playing');
  assert.equal(await text('p1-bombs'), '3'); assert.equal(await text('p1-lives'), '2'); assert.equal(await text('p1-drones'), '0');
  assert.equal(await page.locator('#p1-power i.on').count(), 1);

  // The script opens with a swarm; its squadrons fly in from offscreen.
  await page.evaluate(() => { tyran.state.players[0].hurt = 1e6; __advance(4); });
  const opening = await page.evaluate(() => ({ wave: tyran.state.director.wave, kind: tyran.state.director.kind, label: document.querySelector('#wave-label').textContent }));
  assert.deepEqual([opening.wave, opening.kind], [0, 'hive']);
  assert.match(opening.label, /Wave 01 \/ 0\d/);

  // Real keyboard: Space fires the primary; E detonates one nova per press.
  await page.evaluate(() => { tyran.state.bullets.push({ x: 500, y: 300, px: 500, py: 300, vx: 0, vy: 40, team: -1, radius: 4, life: 5, damage: 5, kind: 'hostile', color: '#75f5ff', variant: 0, age: 0 }); });
  await page.keyboard.down('Space'); await page.keyboard.down('KeyE');
  await page.evaluate(() => __advance(.3));
  await page.keyboard.up('KeyE'); await page.keyboard.up('Space');
  const nova = await page.evaluate(() => ({ bombs: tyran.state.players[0].bombs, hostile: tyran.state.bullets.filter(b => b.team < 0).length, guard: tyran.state.players[0].guard }));
  assert.equal(nova.bombs, 2, 'holding E detonates exactly one nova');
  assert.equal(nova.hostile, 0); assert.ok(nova.guard > 0);
  await page.evaluate(() => __advance(.2));
  assert.equal(await text('p1-bombs'), '2');

  // Power cores widen the gun and show in the HUD; drones join the wing.
  await page.evaluate(() => {
    const s = tyran.state, p = s.players[0];
    for (const kind of ['power', 'power', 'drone', 'drone']) s.pickups.push({ x: p.x, y: p.y, age: 0, kind, value: 0 });
    __advance(.5);
  });
  assert.equal(await page.locator('#p1-power i.on').count(), 3);
  assert.match(await text('weapon-level'), /^P3 ·/);
  assert.equal(await text('p1-drones'), '2');
  assert.equal(await page.evaluate(() => tyran.state.players[0].wing.length), 2);

  // Captor tractor beam, captured drone and lancer telegraph all render.
  const captor = await page.evaluate(() => {
    const s = tyran.state; s.enemies.length = 0; s.bullets.length = 0;
    s.director.wave = 5; s.director.state = 'rest'; s.director.clock = 99; s.director.abandon = false;
    for (let i = 0; i < 60 * 9; i++) {
      const cap = s.enemies.find(e => e.ai === 'captor'), p = s.players[0];
      tyran.step(1 / 60, [{ x: cap ? Math.sign(cap.x - p.x) * (Math.abs(cap.x - p.x) > 12) : 0 }]);
      if (cap?.captive) break;
    }
    __advance(.2);
    return { captive: s.enemies.some(e => e.captive), drones: s.players[0].drones };
  });
  assert.deepEqual(captor, { captive: true, drones: 1 });
  assert.equal(await text('p1-drones'), '1');
  await page.evaluate(async () => {
    const { spawnEnemy } = await import('./sim.js');
    const s = tyran.state, p = s.players[0], lancer = spawnEnemy(s, 5, p.x + 200, 220);
    Object.assign(lancer, { ai: 'station', stationX: p.x + 200, stationY: 220, hold: 30, sway: 0, fire: 0 });
    tyran.step(1 / 60); __advance(.5);
  });
  assert.ok(await page.evaluate(() => tyran.state.beams.length >= 1), 'a lancer paints its firing line');
  await page.screenshot({ path: `${process.env.TYRAN_SCREENSHOTS || '/tmp/tyran-qa'}/features-captor-lancer.png` });

  // Rescue: shooting the captor down brings the drone home.
  await page.evaluate(async () => {
    const { killEnemy } = await import('./sim.js');
    killEnemy(tyran.state, tyran.state.enemies.find(e => e.captive)); __advance(.2);
  });
  assert.equal(await text('p1-drones'), '2');

  // Losing a ship with reserves relaunches instead of ending the flight.
  await page.evaluate(async () => {
    const { hurtPlayer } = await import('./sim.js');
    const s = tyran.state, p = s.players[0]; s.enemies.length = 0; s.bullets.length = 0; s.beams.length = 0;
    Object.assign(p, { hurt: 0, guard: 0, invulnerableTime: 0, shield: 0 });
    hurtPlayer(s, p, 10000); __advance(.4);
  });
  assert.equal(await page.evaluate(() => tyran.scene), 'playing');
  assert.equal(await page.evaluate(() => tyran.state.players[0].alive), false);
  await page.evaluate(() => __advance(1.8));
  assert.equal(await page.evaluate(() => tyran.state.players[0].alive), true);
  assert.equal(await text('p1-lives'), '1');
  assert.match(await text('p1-reserve'), /1 ship in reserve/);

  // Guardian, then the challenging stage with its own HUD readout.
  await page.evaluate(async () => {
    const { spawnEnemy, killEnemy } = await import('./sim.js');
    const s = tyran.state; s.players[0].hurt = 1e6;
    killEnemy(s, spawnEnemy(s, 9, s.width / 2, 180)); tyran.step(3.4); __advance(2);
  });
  assert.ok(await page.evaluate(() => tyran.state.challenge && !tyran.state.challenge.done));
  assert.match(await text('wave-label'), /Bonus stage · \d+ \/ 40/);
  const result = await page.evaluate(async () => {
    const { killEnemy } = await import('./sim.js');
    const s = tyran.state;
    for (let i = 0; i < 60 * 40 && !s.challenge.done; i++) {
      tyran.step(1 / 60);
      for (const e of s.enemies) if (e.challenge && !e.dead && e.pathD >= 0 && e.y > 0 && e.x > 0 && e.x < s.width) killEnemy(s, e);
    }
    __advance(3);
    return { scene: tyran.scene, hits: s.challenge.hits };
  });
  assert.deepEqual(result, { scene: 'hangar', hits: 40 });
  assert.match(await page.locator('#hangar-report').textContent(), /40 \/ 40/);
  assert.match(await page.locator('#hangar-report').textContent(), /Perfect/);

  // Gun shop: buy, equip and switch back; supplies respect their limits.
  await page.evaluate(() => { tyran.state.credits = 50000; document.querySelector('#hangar-credits'); });
  await page.locator('[data-supply="drone"]').click();
  assert.ok(await page.locator('[data-supply="drone"]').isDisabled(), 'the wing is full at two drones');
  await page.locator('[data-primary="lance"]').click();
  assert.equal(await page.evaluate(() => tyran.state.primary), 'lance');
  assert.equal(await page.locator('[data-primary="lance"]').getAttribute('data-state'), 'equipped');
  const credits = await page.evaluate(() => tyran.state.credits);
  await page.locator('[data-primary="pulse"]').click();
  await page.locator('[data-primary="lance"]').click();
  assert.equal(await page.evaluate(() => tyran.state.credits), credits, 'owned guns switch for free');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tyran-campaign')));
  assert.equal(saved.state.primary, 'lance'); assert.deepEqual(saved.state.owned, ['pulse', 'lance']);
  await page.locator('#next-button').click();
  assert.equal(await page.evaluate(() => tyran.state.level), 1);
  assert.equal(await text('weapon-value'), 'Lance Driver');
  await page.keyboard.down('Space'); await page.evaluate(() => __advance(.2)); await page.keyboard.up('Space');
  assert.ok(await page.evaluate(() => tyran.state.bullets.some(b => b.kind === 'lance')));
  assert.deepEqual(errors, []);
  console.log('PASS wave script, keyboard nova, power and drone HUD, captor rescue, lancer telegraph, reserve ships, challenge stage and gun shop');
} finally {
  await browser.close();
}
