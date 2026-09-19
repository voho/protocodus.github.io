// Serve the repo root; TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node fun/tyran/tests/campaign-save-browser-check.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const output = process.env.TYRAN_SCREENSHOTS || '/tmp/tyran-campaign-qa';
const errors = [];
await mkdir(output, { recursive: true });
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
};
const ready = page => page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true');
const slot = (page, name) => page.evaluate(name => localStorage.getItem(`tyran-save-v2:${name}`), name);

// Capture observable flight state, including relationships needed to keep a
// formation flying together. Drawing interpolation and transient effects may reset.
const flight = page => page.evaluate(() => {
  const s = tyran.state;
  const pick = (object, names) => Object.fromEntries(names.map(name => [name, object[name]]));
  return {
    ...pick(s, ['mode', 'level', 'status', 'width', 'height', 'time', 'scroll', 'credits', 'score', 'kills', 'destroyed', 'totalKills', 'weapon', 'upgrades', 'spawnTimer', 'formationTimer', 'bossSpawned', 'bossDefeated']),
    players: s.players.map(p => pick(p, ['x', 'y', 'vx', 'vy', 'hull', 'shield', 'maxHull', 'maxShield', 'alive', 'fire', 'lastHit'])),
    enemies: s.enemies.map(e => ({ ...pick(e, ['id', 'type', 'x', 'y', 'vx', 'vy', 'hp', 'maxHp', 'age', 'fire', 'phase']), formationId: e.formation?.id ?? null })),
    bullets: s.bullets.map(b => pick(b, ['x', 'y', 'vx', 'vy', 'damage', 'radius', 'team', 'life', 'kind', 'age'])),
    formations: s.formations.map(f => pick(f, ['id', 'kind', 'age', 'baseX', 'x', 'y', 'offsets', 'members'])),
    attached: s.enemies.filter(e => e.formation).every(e => s.formations.includes(e.formation) && e.formationOffset === e.formation.offsets[e.formationIndex]),
    pickups: s.pickups.map(p => pick(p, ['x', 'y', 'age', 'kind', 'value'])),
    seed: tyran.world.seed,
    damage: [...tyran.world.damage],
    destroyedScenery: [...tyran.world.destroyed],
  };
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  watch(page);
  await page.goto(url); await ready(page);
  await page.locator('[data-world="5"]').click();
  await page.locator('#launch-button').click();
  assert.equal(await page.evaluate(() => tyran.state.level), 0, 'New campaign always begins with sector one');
  assert.equal(JSON.parse(await slot(page, 'auto')).state.level, 0, 'Launch creates an autosave');
  await page.keyboard.press('Escape'); await page.locator('#menu-button').click();
  await page.locator('[data-world="5"]').click();
  await page.locator('#sector-flight-button').click();
  assert.equal(await page.evaluate(() => tyran.state.level), 5, 'Sector exploration uses the selected world');
  await page.keyboard.press('Escape'); await page.locator('#menu-button').click();
  await page.locator('[data-mode="2"]').click(); await page.locator('#launch-button').click();

  // Reach a busy flight using the real simulation, then freeze before saving.
  await page.evaluate(async () => {
    const { spawnFormation, spawnEnemy } = await import('./sim.js');
    const s = tyran.state;
    s.time = 22; s.scroll = 2300; s.credits = 2345; s.score = 8765;
    s.spawnTimer = 100; s.formationTimer = 100; s.showcase = 9;
    spawnFormation(s, 'vee');
    const enemy = spawnEnemy(s, 3, s.width * .2, 260); enemy.fire = 0;
    tyran.step(.15, [{ x: 1, fire: true }, { x: -1, fire: true }]);
    s.players[0].x = 30; s.players[0].hull = 73; s.players[0].shield = 19;
    s.players[1].hull = 42; s.players[1].shield = 8;
    s.players.forEach(p => { p.lastHit = s.time; });
    s.pickups.push({ x: s.width * .8, y: 320, age: .3, kind: 'credit', value: 75 });
    tyran.pause();
  });
  await page.waitForFunction(() => tyran.world.visibleProps.length > 3 && tyran.world.scroll === tyran.state.scroll);
  await page.evaluate(() => {
    const w = tyran.world, p = w.visibleProps.find(p => !p.destroyed);
    w.hit((p.screenX ?? p.x) * w.scale, p.screenY * w.scale, 1, 2, tyran.state.scroll);
    const other = w.visibleProps.find(q => q.id !== p.id && Math.hypot(q.x - p.x, q.y - p.y) > 150);
    w.hit((other.screenX ?? other.x) * w.scale, other.screenY * w.scale, 1, 10000, tyran.state.scroll);
  });
  const savedFlight = await flight(page);
  assert(savedFlight.bullets.some(b => b.team === -1) && savedFlight.bullets.some(b => b.team === 0) && savedFlight.bullets.some(b => b.team === 1), 'Fixture contains both pilots’ projectiles and hostile fire');
  assert(savedFlight.formations.length && savedFlight.attached, 'Fixture contains an active formation');
  assert(savedFlight.damage.length && savedFlight.destroyedScenery.length, 'Fixture contains damaged and destroyed scenery');
  await page.locator('#pause-save-button').click();
  assert.match(await page.locator('#pause-save-status').textContent(), /Game saved/);
  const manualFlight = await slot(page, 'manual'); assert(manualFlight);

  await page.reload(); await ready(page); await page.locator('#load-game-button').click();
  assert(await page.locator('#pause-screen').isVisible(), 'A saved flight loads paused');
  assert.deepEqual(await flight(page), savedFlight, 'Reload preserves the flight, economy, formation links and scenery damage');
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => tyran.state.time), savedFlight.time, 'Loading never advances the clock before Resume');

  // A flight saved on desktop must remain playable on a narrow screen. Resizing
  // a live formation and loading it at that width must preserve its layout.
  const checkNarrow = (actual, label) => {
    const near = (a, b, description) => assert(Math.abs(a - b) < 1e-7, `${label}: ${description}`);
    assert(actual.width < savedFlight.width);
    assert.equal(actual.time, savedFlight.time, `${label}: the paused clock stays fixed`);
    assert.equal(actual.players[0].x, 30, `${label}: a pilot at the edge stays within flight bounds`);
    near(actual.players[1].x / actual.width, savedFlight.players[1].x / savedFlight.width, 'pilot position scales with the arena');
    for (const collection of ['enemies', 'bullets', 'pickups']) actual[collection].forEach((actor, index) => {
      near(actor.x / actual.width, savedFlight[collection][index].x / savedFlight.width, `${collection} preserve horizontal positions`);
      near(actor.y, savedFlight[collection][index].y, `${collection} preserve vertical positions`);
    });
    actual.formations.forEach((formation, index) => {
      const original = savedFlight.formations[index];
      for (const key of ['x', 'baseX']) near(formation[key] / actual.width, original[key] / savedFlight.width, 'formation anchors scale with their ships');
      formation.offsets.forEach((offset, i) => near(offset.x / actual.width, original.offsets[i].x / savedFlight.width, 'formation spacing scales with the arena'));
    });
    assert(actual.attached, `${label}: formation members retain shared anchor and offset references`);
    assert.deepEqual(actual.damage, savedFlight.damage, `${label}: terrain damage remains attached to the same map cells`);
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(width => tyran.state.width < width, savedFlight.width);
  checkNarrow(await flight(page), 'Resize');
  await page.reload(); await ready(page); await page.locator('#load-game-button').click();
  checkNarrow(await flight(page), 'Load at a different width');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForFunction(width => tyran.state.width === width, savedFlight.width);
  await page.locator('#pause-load-button').click();
  assert.deepEqual(await flight(page), savedFlight, 'The original manual save survives viewport changes');
  await page.locator('#resume-button').click();
  await page.waitForFunction(time => tyran.state.time > time, savedFlight.time);
  await page.keyboard.press('Escape');

  // Corruption and storage failures must not destroy a playable in-memory run.
  const beforeCorrupt = await flight(page);
  await page.evaluate(() => localStorage.setItem('tyran-save-v2:manual', '{broken'));
  await page.locator('#pause-load-button').click();
  assert.match(await page.locator('#pause-save-status').textContent(), /could not be read.*unchanged/i);
  assert.deepEqual(await flight(page), beforeCorrupt);
  await page.evaluate(raw => localStorage.setItem('tyran-save-v2:manual', raw), manualFlight);
  await page.evaluate(() => {
    window.qaSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'tyran-save-v2:manual') throw new DOMException('Quota exceeded', 'QuotaExceededError'); return window.qaSetItem.call(this, key, value); };
  });
  await page.locator('#pause-save-button').click();
  assert.match(await page.locator('#pause-save-status').textContent(), /Could not save.*previous save is unchanged/i);
  assert.equal(await slot(page, 'manual'), manualFlight);
  await page.evaluate(() => { Storage.prototype.setItem = window.qaSetItem; delete window.qaSetItem; });
  await page.locator('#menu-button').click(); await page.locator('#launch-button').click();
  assert.equal(await slot(page, 'manual'), manualFlight, 'A new campaign preserves the separate manual save');

  // Use the genuine boss-death event to enter the after-level shop.
  await page.evaluate(async () => {
    const { spawnEnemy, killEnemy } = await import('./sim.js');
    const s = tyran.state; s.credits = 5000;
    s.players[0].hull = 62; s.players[0].shield = 3;
    s.players[1].hull = 0; s.players[1].shield = 0; s.players[1].alive = false;
    killEnemy(s, spawnEnemy(s, 9, s.width / 2, 180)); tyran.step(3.4);
  });
  assert(await page.locator('#hangar-screen').isVisible());
  assert.equal(JSON.parse(await slot(page, 'auto')).scene, 'hangar', 'Sector completion autosaves the shop');
  const startingCredits = await page.evaluate(() => tyran.state.credits);
  for (const id of ['weapon', 'hull', 'shield', 'recharge']) {
    await page.locator(`[data-upgrade="${id}"]`).click();
    assert.equal(await page.evaluate(id => tyran.state.upgrades[id], id), 1);
    assert.equal(JSON.parse(await slot(page, 'auto')).state.upgrades[id], 1, `${id} purchase autosaves`);
  }
  await page.locator('[data-weapon="plasma"]').click();
  assert.equal(JSON.parse(await slot(page, 'auto')).state.weapon, 'plasma', 'Choosing a shop weapon profile autosaves');
  assert(await page.evaluate(credits => tyran.state.credits < credits, startingCredits), 'Upgrades spend earned credits');
  const shopFlight = await flight(page);
  await page.locator('#hangar-save-button').click();
  assert.match(await page.locator('#hangar-save-status').textContent(), /Game saved/);
  await page.screenshot({ path: `${output}/saved-shop.png` });
  await page.locator('#hangar-menu-button').click();
  assert(await page.locator('#menu-screen').isVisible(), 'The shop has a working return to menu');
  await page.reload(); await ready(page); await page.locator('#load-game-button').click();
  assert(await page.locator('#hangar-screen').isVisible(), 'A shop save returns to the same shop');
  assert.deepEqual(await flight(page), shopFlight, 'Loading a shop preserves purchases, credits and the cleared level');
  await page.locator('#next-button').click();
  assert.equal(await page.evaluate(() => tyran.state.level), 1, 'Next sector launches the following world');
  assert(await page.evaluate(() => tyran.state.players.length === 2 && tyran.state.players.every(p => p.alive && p.hull === p.maxHull && p.shield === p.maxShield)), 'Launch repairs and revives both upgraded ships');
  assert.equal(JSON.parse(await slot(page, 'auto')).state.level, 1);
  await page.reload(); await ready(page); await page.locator('#continue-button').click();
  assert.equal(await page.evaluate(() => tyran.state.level), 1, 'Continue uses the latest autosave');
  assert.equal(await page.evaluate(() => tyran.scene), 'pause');

  const legacy = await browser.newPage({ viewport: { width: 1440, height: 960 } }); watch(legacy);
  await legacy.addInitScript(() => localStorage.setItem('tyran-campaign-v1', JSON.stringify({ version: 1, unlocked: 3, checkpoint: { mode: 2, level: 3, credits: 2345, score: 12000, totalKills: 39, weapon: 'lance', upgrades: { weapon: 2, shield: 1, hull: 1, recharge: 2 } } })));
  await legacy.goto(url); await ready(legacy); await legacy.locator('#continue-button').click();
  assert.equal(await legacy.evaluate(() => tyran.state.level), 2, 'Legacy next-level checkpoints open the preceding shop');
  assert(await legacy.locator('#hangar-screen').isVisible());
  assert.equal(await legacy.evaluate(() => tyran.state.credits), 2345);
  await legacy.locator('#next-button').click();
  assert.equal(await legacy.evaluate(() => tyran.state.level), 3, 'Legacy continuation launches the original next level');
  assert.equal(await legacy.evaluate(() => tyran.state.weapon), 'lance');
  assert.equal(await legacy.evaluate(() => tyran.state.mode), 2);

  const restricted = await browser.newPage(); watch(restricted);
  await restricted.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage disabled', 'SecurityError'); } }); });
  await restricted.goto(url); await ready(restricted);
  assert.match(await restricted.locator('#save-summary').textContent(), /storage.*unavailable|cannot save/i);
  await restricted.locator('#launch-button').click();
  assert.equal(await restricted.evaluate(() => tyran.scene), 'playing', 'Blocked storage never prevents playing');
  await restricted.keyboard.press('Escape'); await restricted.locator('#pause-save-button').click();
  assert.match(await restricted.locator('#pause-save-status').textContent(), /Could not save.*keep playing/i);
  await restricted.locator('#resume-button').click();
  const restrictedTime = await restricted.evaluate(() => tyran.state.time);
  await restricted.waitForFunction(time => tyran.state.time > time, restrictedTime);
  assert.deepEqual(errors, [], 'No browser errors throughout campaign save/load flows');
  console.log('Campaign browser checks passed: new campaign and exploration, exact paused co-op saves, viewport changes with active formations, scenery damage, manual-slot protection, shop purchases and healing, legacy continuation, corrupt saves, denied storage and quota failures.');
} finally { await browser.close(); }
