// Serve the repo root; set TYRAN_PLAYWRIGHT and TYRAN_URL when needed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const output = process.env.TYRAN_SCREENSHOTS || '/tmp/tyran-endless-qa';
await mkdir(output, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.addInitScript(() => {
  // Deterministic frames let checks cover exact transition and save boundaries.
  const frames = new Map(); let next = 0;
  window.__frameTime = 1000;
  window.requestAnimationFrame = callback => { frames.set(++next, callback); return next; };
  window.cancelAnimationFrame = id => frames.delete(id);
  window.__pumpFrame = () => { __frameTime += 16.7; const ready = [...frames.values()]; frames.clear(); for (const callback of ready) callback(__frameTime); };
  localStorage.setItem('tyran-muted', 'true');
});
const ready = () => page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
const click = id => page.locator(`#${id}`).evaluate(element => element.click());
const gear = () => page.evaluate(() => {
  const s = tyran.state, p = s.players[0];
  return { credits: s.credits, upgrades: s.upgrades, primary: s.primary, owned: s.owned, weapon: p.weapon,
    power: p.power, drones: p.drones, bombs: p.bombs, lives: s.lives, startLevel: s.startLevel };
});
const clearSector = () => page.evaluate(async () => {
  const { spawnEnemy, killEnemy } = await import('./sim.js');
  const s = tyran.state;
  s.players[0].hurt = 1e6; s.director.hold = true;
  killEnemy(s, spawnEnemy(s, 9, s.width / 2, 180)); tyran.step(3.4);
  if (s.challenge) { for (const enemy of s.enemies) if (enemy.challenge) enemy.gone = true; tyran.step(5); }
  if (tyran.scene !== 'hangar') throw new Error(`Sector ${s.level} did not reach the hangar`);
});
const assertFlight = async level => {
  const actual = await page.evaluate(async level => {
    const { drawShip } = await import('./ships.js');
    const { spawnEnemy } = await import('./sim.js');
    const s = tyran.state, index = level % 10, palette = tyran.shipPalettes[index];
    // Identify this environment's actual cached hull, then observe the gameplay
    // canvas draw it. This catches wrong palette/index use in the live renderer.
    const probe = document.createElement('canvas').getContext('2d');
    let expectedHull;
    probe.drawImage = (image, ...args) => { if (args.join(',') === '-140,-140,280,280') expectedHull = image; };
    drawShip(probe, 0, 0, 22, 2, palette.primary, 0, { world: index, palette });
    const enemy = spawnEnemy(s, 2, s.width / 2, 250); enemy.noFire = true;
    const canvas = document.querySelector('#game-canvas'), context = canvas.getContext('2d'), draw = context.drawImage;
    let fleetDrawn = false;
    context.drawImage = function (image, ...args) { if (image === expectedHull) fleetDrawn = true; return draw.call(this, image, ...args); };
    try { tyran.step(0); __pumpFrame(); } finally { context.drawImage = draw; s.enemies = s.enemies.filter(item => item !== enemy); }
    return { level: s.level, status: s.status, scene: tyran.scene, index: tyran.world.index, id: tyran.world.world.id,
      expectedId: tyran.worlds[index].id, seed: tyran.world.seed, fleetDrawn, name: document.querySelector('#level-name').textContent,
      expectedName: tyran.worlds[index].name, label: document.querySelector('#level-number').textContent };
  }, level);
  assert.equal(actual.level, level); assert.equal(actual.status, 'playing'); assert.equal(actual.scene, 'playing');
  assert.equal(actual.index, level % 10); assert.equal(actual.id, actual.expectedId); assert.equal(actual.name, actual.expectedName);
  assert.equal(actual.seed, level < 10 ? 'tyran-v2' : `tyran-v2-cycle-${Math.floor(level / 10) + 1}`);
  assert.equal(actual.label, `${String(level + 1).padStart(2, '0')} · Cycle ${Math.floor(level / 10) + 1}`);
  assert(actual.fleetDrawn, `sector ${level + 1} draws its environment's ship livery`);
};
const assertRoute = async (cycle, first, current) => {
  assert.equal(await page.locator('#campaign-route').getAttribute('aria-label'), `Cycle ${cycle} flight path`);
  assert.equal(await page.locator('#campaign-route li').count(), 10);
  assert.equal((await page.locator('#campaign-route li:first-child span').textContent()).replace(' ✓', ''), String(first).padStart(2, '0'));
  assert.equal(await page.locator('#campaign-route [aria-current="step"] span').textContent(), String(current).padStart(2, '0'));
};

try {
  await page.goto(url); await ready();
  await page.evaluate(() => tyran.launch(9, { startLevel: 3, credits: 4000, score: 12000,
    upgrades: { weapon: 3, hull: 2, shield: 4, recharge: 2 }, owned: ['pulse', 'scatter', 'lance'], primary: 'lance', weapon: 'plasma',
    lives: 4, players: [{ weapon: 'plasma', power: 3, drones: 2, bombs: 5 }] }));
  await assertFlight(9);
  await clearSector();
  await assertRoute(2, 11, 11);
  assert.match(await page.locator('#hangar-subtitle').textContent(), /new cycle awaits/i);
  const firstCycleGear = await gear();
  const legacyVictory = await page.evaluate(() => {
    const record = JSON.parse(localStorage.getItem('tyran-campaign'));
    record.state.status = 'victory'; record.scene = 'end'; record.unlocked = 9;
    return record;
  });
  await page.screenshot({ path: `${output}/cycle-two-hangar.png` });
  await click('next-button'); await assertFlight(10);
  assert.deepEqual(await gear(), firstCycleGear, 'A new cycle keeps purchased equipment, earned credits, supplies and starting sector');

  await page.evaluate(() => tyran.pause());
  const savedTime = await page.evaluate(() => tyran.state.time), savedGear = await gear();
  await page.reload(); await ready(); await click('continue-button');
  assert.equal(await page.evaluate(() => tyran.scene), 'pause');
  assert.equal(await page.evaluate(() => tyran.state.level), 10);
  assert.equal(await page.evaluate(() => tyran.world.seed), 'tyran-v2-cycle-2');
  assert.deepEqual(await gear(), savedGear);
  await page.evaluate(() => { for (let i = 0; i < 4; i++) __pumpFrame(); });
  assert.equal(await page.evaluate(() => tyran.state.time), savedTime, 'A later-cycle save remains paused until resumed');
  await click('resume-button'); await assertFlight(10);

  // The defeat/retry route must use the absolute sector instead of restarting
  // the campaign or treating a repeated environment as its first visit.
  const retryGear = await gear();
  await page.evaluate(() => { tyran.state.status = 'defeat'; tyran.state.events.push({ type: 'defeat' }); tyran.step(1 / 60); });
  assert.equal(await page.evaluate(() => tyran.scene), 'end');
  assert.match(await page.locator('#end-description').textContent(), /Sector 11.*Cycle 2/);
  await page.evaluate(() => { for (let i = 0; i < 120; i++) __pumpFrame(); });
  await click('retry-button'); await assertFlight(10);
  assert.deepEqual(await gear(), retryGear, 'Retrying a later sector retains purchased gear and campaign credits');
  await clearSector(); await assertRoute(2, 11, 12);
  const secondSectorGear = await gear();
  await click('next-button'); await assertFlight(11);
  assert.deepEqual(await gear(), secondSectorGear);
  await page.screenshot({ path: `${output}/cycle-two-snow.png` });

  await page.evaluate(() => tyran.launch(19, tyran.state));
  await assertFlight(19); await clearSector(); await assertRoute(3, 21, 21);
  const thirdCycleGear = await gear();
  await click('next-button'); await assertFlight(20);
  assert.deepEqual(await gear(), thirdCycleGear, 'The third cycle also continues with the same campaign resources');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('tyran-campaign')).state.level), 20);

  await page.evaluate(() => tyran.pause()); await click('menu-button');
  await page.evaluate(record => localStorage.setItem('tyran-campaign', JSON.stringify(record)), legacyVictory);
  await page.reload(); await ready(); await click('continue-button');
  assert.equal(await page.evaluate(() => tyran.scene), 'hangar');
  assert.equal(await page.evaluate(() => tyran.state.level), 9); await assertRoute(2, 11, 11);
  assert.deepEqual(await gear(), firstCycleGear, 'An old completed campaign retains its full equipment and balance');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('tyran-campaign')).scene), 'hangar', 'Legacy victory migrates into a continuing autosave');
  await click('next-button'); await assertFlight(10);
  assert.deepEqual(await gear(), firstCycleGear, 'Continuing a migrated victory never resets equipment or awards the old bonus again');
  assert.deepEqual(errors, [], 'No browser errors across repeated environments or save migrations');
  console.log('PASS endless campaign browser flow: 9→10→11 and 19→20, environment and rendered fleet cycling, route/HUD, equipment, credits, later-cycle save/resume/retry, and legacy victory continuation.');
} finally { await browser.close(); }
