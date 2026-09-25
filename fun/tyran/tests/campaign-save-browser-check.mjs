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
const campaign = page => page.evaluate(() => localStorage.getItem('tyran-campaign'));
const record = async page => JSON.parse(await campaign(page));
const newPage = async (options = {}) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, ...options });
  watch(page);
  await page.addInitScript(() => { try { localStorage.setItem('tyran-muted', 'true'); } catch { /* storage denial is covered below */ } });
  return page;
};

// Capture observable flight state, including relationships needed to keep a
// formation flying together. Drawing interpolation and transient effects may reset.
const flight = page => page.evaluate(() => {
  const s = tyran.state;
  const pick = (object, names) => Object.fromEntries(names.map(name => [name, object[name]]));
  return {
    ...pick(s, ['mode', 'level', 'status', 'width', 'height', 'time', 'scroll', 'credits', 'score', 'kills', 'destroyed', 'totalKills', 'weapon', 'upgrades', 'spawnTimer', 'formationTimer', 'bossSpawned', 'bossDefeated']),
    players: s.players.map(p => pick(p, ['x', 'y', 'vx', 'vy', 'hull', 'shield', 'maxHull', 'maxShield', 'alive', 'fire', 'lastHit', 'weapon', 'fireEnergy', 'fireEnergyDelay', 'fireEnergyLocked'])),
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
  const page = await newPage();
  await page.goto(url); await ready(page);
  assert.match(await page.locator('#launch-button').textContent(), /New campaign/);
  assert(await page.locator('#continue-button').isDisabled(), 'Resume is unavailable without a campaign');
  assert.equal(await page.locator('#load-game-button, #pause-save-button, #pause-load-button, #hangar-save-button, #hangar-load-button, #end-load-button').count(), 0, 'There are no manual save/load controls');
  await page.locator('[data-world="5"]').click();
  await page.locator('#launch-button').click();
  assert.equal(await page.evaluate(() => tyran.state.level), 0, 'New campaign always begins with sector one');
  assert.equal((await record(page)).state.level, 0, 'A new campaign saves immediately');

  // Five seconds of simulated combat save progress without any button press.
  await page.evaluate(() => {
    const s = tyran.state; s.credits = 432; s.score = 1234;
    s.spawnTimer = 100; s.formationTimer = 100; s.showcase = 9;
    tyran.step(5.2);
  });
  let saved = await record(page);
  assert(saved.state.time >= 5 && saved.state.time < 6, 'The periodic autosave captures an active flight');
  assert.equal(saved.state.credits, 432); assert.equal(saved.state.score, 1234);
  await page.keyboard.press('Escape');
  assert.equal((await record(page)).state.time, await page.evaluate(() => tyran.state.time), 'Pausing saves the latest flight');
  await page.locator('#menu-button').click();
  assert.match(await page.locator('#continue-label').textContent(), /Resume campaign/);
  const beforePractice = await campaign(page);
  await page.locator('[data-world="5"]').click();
  await page.locator('#sector-flight-button').click();
  assert.equal(await page.evaluate(() => tyran.state.level), 5, 'Sector exploration uses the selected world');
  await page.evaluate(async () => {
    const { spawnEnemy, killEnemy } = await import('./sim.js');
    tyran.state.credits = 98765; tyran.step(5.2);
    killEnemy(tyran.state, spawnEnemy(tyran.state, 9, tyran.state.width / 2, 180)); tyran.step(3.4);
  });
  await page.locator('[data-upgrade="hull"]').click();
  await page.locator('#next-button').click();
  await page.keyboard.press('Escape'); await page.locator('#menu-button').click();
  assert.equal(await campaign(page), beforePractice, 'Practice never replaces campaign progress, including periodic/pause/menu saves');
  await page.locator('#continue-button').click();
  assert.equal(await page.evaluate(() => tyran.state.credits), 432, 'Resume still opens the campaign after practice');
  await page.locator('#menu-button').click();
  assert.equal((await record(page)).unlocked, 0, 'Practice clears do not unlock stages in the campaign');
  await page.locator('#launch-button').click();
  saved = await record(page);
  assert.equal(saved.state.level, 0); assert.equal(saved.state.mode, 1);
  assert.equal(saved.state.score, 0); assert.equal(saved.state.credits, 0, 'New campaign replaces prior progress');

  // Reach a busy single-player flight through the real simulation, then leave to the
  // menu. The automatic checkpoint must include scenery and shared formations.
  await page.evaluate(async () => {
    const { spawnFormation, spawnEnemy } = await import('./sim.js');
    const s = tyran.state;
    s.time = 22; s.scroll = 2300; s.credits = 2345; s.score = 8765;
    s.spawnTimer = 100; s.formationTimer = 100; s.showcase = 9;
    spawnFormation(s, 'vee');
    const enemy = spawnEnemy(s, 3, s.width * .2, 260); enemy.fire = 0;
    tyran.step(.15, [{ x: 1, secondary: true }]);
    s.players[0].x = 30; s.players[0].hull = 73; s.players[0].shield = 19;
    s.players.forEach(p => { p.lastHit = s.time; });
    s.pickups.push({ x: s.width * .8, y: 320, age: .3, kind: 'credit', value: 75 });
    tyran.pause();
  });
  await page.waitForFunction(() => tyran.world.visibleProps.length > 3 && tyran.world.visibleProps.every(p => Math.abs(p.screenY - p.y - tyran.state.scroll) < 1e-7));
  await page.evaluate(() => {
    const w = tyran.world, p = w.visibleProps.find(p => p.hp > 2 && !w.destroyed.has(p.id));
    w.hit((p.screenX ?? p.x) * w.scale, p.screenY * w.scale, 1, 2, tyran.state.scroll);
    const other = w.visibleProps.find(q => q.id !== p.id && Math.hypot(q.x - p.x, q.y - p.y) > 150);
    w.hit((other.screenX ?? other.x) * w.scale, other.screenY * w.scale, 1, 10000, tyran.state.scroll);
  });
  const savedFlight = await flight(page);
  assert(savedFlight.players.length === 1 && savedFlight.players[0].fireEnergy < 100, 'The checkpoint captures spent secondary energy');
  assert(savedFlight.bullets.some(b => b.team === -1) && savedFlight.bullets.some(b => b.team === 0), 'Fixture contains player projectiles and hostile fire');
  assert(savedFlight.formations.length && savedFlight.attached, 'Fixture contains an active formation');
  assert(savedFlight.damage.length && savedFlight.destroyedScenery.length, 'Fixture contains damaged and destroyed scenery');
  await page.locator('#menu-button').click();
  const busyCampaign = await campaign(page);
  await page.reload(); await ready(page); await page.locator('#continue-button').click();
  assert(await page.locator('#pause-screen').isVisible(), 'Resume opens a saved flight paused');
  assert.deepEqual(await flight(page), savedFlight, 'Reload preserves the flight, economy, formation links and scenery damage');
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => tyran.state.time), savedFlight.time, 'The saved flight waits for the pilot to resume');

  // Automatic saves remain playable when resumed on a different screen size.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(width => tyran.state.width < width, savedFlight.width);
  const narrowFlight = await flight(page);
  const near = (a, b, label) => assert(Math.abs(a - b) < 1e-7, label);
  assert.equal(narrowFlight.time, savedFlight.time);
  assert.equal(narrowFlight.players[0].x, 30, 'A pilot at the edge stays within flight bounds');
  for (const collection of ['enemies', 'bullets', 'pickups']) narrowFlight[collection].forEach((actor, index) => {
    near(actor.x / narrowFlight.width, savedFlight[collection][index].x / savedFlight.width, `${collection} preserve horizontal positions`);
    near(actor.y, savedFlight[collection][index].y, `${collection} preserve vertical positions`);
  });
  narrowFlight.formations.forEach((formation, index) => {
    const original = savedFlight.formations[index];
    for (const key of ['x', 'baseX']) near(formation[key] / narrowFlight.width, original[key] / savedFlight.width, 'Formation anchors scale with their ships');
    formation.offsets.forEach((offset, i) => near(offset.x / narrowFlight.width, original.offsets[i].x / savedFlight.width, 'Formation spacing scales with the arena'));
  });
  assert(narrowFlight.attached); assert.deepEqual(narrowFlight.damage, savedFlight.damage);
  await page.reload(); await ready(page); await page.locator('#continue-button').click();
  assert.deepEqual(await flight(page), narrowFlight, 'Reloading a resized flight keeps its layout and scenery');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForFunction(width => tyran.state.width === width, savedFlight.width);
  await page.locator('#resume-button').click();
  await page.waitForFunction(time => tyran.state.time > time, savedFlight.time);

  // Quota failure cannot damage the last checkpoint or interrupt the run.
  const beforeQuota = await campaign(page);
  await page.evaluate(() => {
    window.qaSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'tyran-campaign') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return window.qaSetItem.call(this, key, value);
    };
    tyran.state.credits = 3456; tyran.pause();
  });
  assert.match(await page.locator('#pause-save-status').textContent(), /could not (?:auto)?save|cannot save|unavailable/i);
  assert.equal(await campaign(page), beforeQuota, 'A failed automatic write preserves the previous campaign');
  assert.equal(await page.evaluate(() => tyran.state.credits), 3456, 'Storage failure preserves the live run');
  await page.evaluate(() => { Storage.prototype.setItem = window.qaSetItem; delete window.qaSetItem; });
  await page.locator('#menu-button').click();
  assert.equal((await record(page)).state.credits, 3456, 'The next checkpoint recovers when storage is available');
  await page.locator('#launch-button').click();
  assert.equal((await record(page)).state.credits, 0, 'Starting fresh replaces the single saved campaign');

  // Use the genuine boss-death event to enter the shop; purchases and loadout
  // selection persist immediately, without any explicit save action.
  await page.evaluate(async () => {
    const { spawnEnemy, killEnemy } = await import('./sim.js');
    const s = tyran.state; s.credits = 5000;
    s.players[0].hull = 62; s.players[0].shield = 3;
    killEnemy(s, spawnEnemy(s, 9, s.width / 2, 180)); tyran.step(3.4);
    // Sector one continues into its challenging stage; let the formation pass.
    if (s.challenge) { for (const enemy of s.enemies) if (enemy.challenge) enemy.gone = true; tyran.step(5); }
  });
  assert(await page.locator('#hangar-screen').isVisible());
  assert.equal((await record(page)).scene, 'hangar', 'Sector completion autosaves the shop');
  const startingCredits = await page.evaluate(() => tyran.state.credits);
  for (const id of ['weapon', 'hull', 'shield', 'recharge']) {
    await page.locator(`[data-upgrade="${id}"]`).click();
    assert.equal(await page.evaluate(id => tyran.state.upgrades[id], id), 1);
    assert.equal((await record(page)).state.upgrades[id], 1, `${id} purchase autosaves`);
  }
  assert.equal(await page.locator('#weapon-list [data-primary]').count(), 3, 'The shop offers three primary guns');
  assert.equal(await page.locator('#weapon-list article[data-weapon="plasma"]').count(), 1, 'The shop explains the secondary fire channel');
  await page.locator('[data-primary="scatter"]').click();
  assert.equal(await page.evaluate(() => tyran.state.primary), 'scatter');
  assert.equal((await record(page)).state.primary, 'scatter', 'Buying a gun autosaves');
  await page.locator('[data-supply="bomb"]').click();
  assert.equal((await record(page)).state.players[0].bombs, 4, 'Supplies autosave');
  assert(await page.evaluate(credits => tyran.state.credits < credits, startingCredits), 'Upgrades spend earned credits');
  const shopFlight = await flight(page);
  await page.screenshot({ path: `${output}/autosaved-shop.png` });
  await page.locator('#hangar-menu-button').click();
  await page.reload(); await ready(page); await page.locator('#continue-button').click();
  assert(await page.locator('#hangar-screen').isVisible(), 'Resume returns to the same shop');
  assert.deepEqual(await flight(page), shopFlight, 'The shop retains purchases, credits and the cleared level');
  await page.locator('#next-button').click();
  assert.equal(await page.evaluate(() => tyran.state.level), 1, 'Next sector launches the following world');
  assert(await page.evaluate(() => tyran.state.players.length === 1 && tyran.state.players.every(p => p.alive && p.hull === p.maxHull && p.shield === p.maxShield)), 'Launch repairs the upgraded ship');
  assert.equal((await record(page)).state.level, 1);
  assert(await page.evaluate(() => tyran.state.players.every(p => p.fireEnergy === 100 && !p.fireEnergyLocked)), 'Next-sector launch restores secondary energy');
  await page.evaluate(() => { tyran.state.credits = 777; window.dispatchEvent(new Event('pagehide')); });
  assert.equal((await record(page)).state.credits, 777, 'Leaving the page saves the latest campaign');
  await page.reload(); await ready(page); await page.locator('#continue-button').click();
  assert.equal(await page.evaluate(() => tyran.state.level), 1);
  assert.equal(await page.evaluate(() => tyran.scene), 'pause');
  assert.equal(await page.evaluate(() => tyran.state.credits), 777);

  // Victory is a resumable final campaign state, with no repeated award.
  await page.evaluate(async () => {
    const { spawnEnemy, killEnemy } = await import('./sim.js');
    tyran.launch(9, { credits: 5000, score: 1000, upgrades: { weapon: 6, shield: 6, hull: 6, recharge: 6 } });
    killEnemy(tyran.state, spawnEnemy(tyran.state, 9, tyran.state.width / 2, 180)); tyran.step(3.4);
  });
  assert.equal((await record(page)).state.status, 'victory');
  const finalCampaign = await flight(page);
  await page.locator('#end-menu-button').click();
  await page.reload(); await ready(page); await page.locator('#continue-button').click();
  assert(await page.locator('#end-screen').isVisible());
  assert.deepEqual(await flight(page), finalCampaign, 'Victory survives reload without awarding the final bonus twice');

  // Old saves are migrated by recency, while an existing canonical campaign
  // remains authoritative even when damaged (no silent fallback to old progress).
  const migrated = await newPage();
  await migrated.addInitScript(raw => {
    const older = JSON.parse(raw), newer = JSON.parse(raw);
    older.savedAt = 1000; older.state.credits = 10;
    newer.savedAt = 2000; newer.state.credits = 2468;
    localStorage.setItem('tyran-save-v2:auto', JSON.stringify(older));
    localStorage.setItem('tyran-save-v2:manual', JSON.stringify(newer));
  }, busyCampaign);
  await migrated.goto(url); await ready(migrated); await migrated.locator('#continue-button').click();
  assert.equal(await migrated.evaluate(() => tyran.state.credits), 2468, 'Resume migrates the newest valid legacy slot');
  await migrated.locator('#menu-button').click();
  assert.equal((await record(migrated)).state.credits, 2468, 'Migrated progress becomes the single automatic campaign');

  const legacy = await newPage();
  await legacy.addInitScript(() => localStorage.setItem('tyran-campaign-v1', JSON.stringify({ version: 1, unlocked: 3, checkpoint: { mode: 2, level: 3, credits: 2345, score: 12000, totalKills: 39, weapon: 'lance', upgrades: { weapon: 2, shield: 1, hull: 1, recharge: 2 } } })));
  await legacy.goto(url); await ready(legacy); await legacy.locator('#continue-button').click();
  assert.equal(await legacy.evaluate(() => tyran.state.level), 2, 'Legacy next-level checkpoints open the preceding shop');
  assert(await legacy.locator('#hangar-screen').isVisible());
  assert.equal(await legacy.evaluate(() => tyran.state.credits), 2345);
  await legacy.locator('#next-button').click();
  assert.equal(await legacy.evaluate(() => tyran.state.level), 3);
  assert.equal(await legacy.evaluate(() => tyran.state.weapon), 'pulse', 'Legacy lance equipment migrates to the precise pulse weapon');
  assert.deepEqual(await legacy.evaluate(() => tyran.state.players.map(p => p.weapon)), ['pulse'], 'The legacy campaign continues with one ship');
  assert.equal(await legacy.evaluate(() => tyran.state.mode), 1);

  const corrupt = await newPage();
  await corrupt.addInitScript(raw => {
    localStorage.setItem('tyran-campaign', '{broken');
    localStorage.setItem('tyran-save-v2:manual', raw);
  }, busyCampaign);
  await corrupt.goto(url); await ready(corrupt);
  assert(await corrupt.locator('#continue-button').isDisabled(), 'Corrupt campaign cannot resume an unrelated stale legacy save');
  assert.match(await corrupt.locator('#save-summary').textContent(), /could not be read|unreadable|invalid|damaged/i);
  await corrupt.locator('#launch-button').click();
  assert.equal((await record(corrupt)).state.level, 0, 'New campaign recovers from unreadable storage');

  const restricted = await newPage();
  await restricted.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage disabled', 'SecurityError'); } }); });
  await restricted.goto(url); await ready(restricted);
  assert.match(await restricted.locator('#save-summary').textContent(), /storage.*unavailable|cannot save/i);
  await restricted.locator('#launch-button').click();
  assert.equal(await restricted.evaluate(() => tyran.scene), 'playing', 'Blocked storage never prevents playing');
  await restricted.keyboard.press('Escape');
  assert.match(await restricted.locator('#pause-save-status').textContent(), /could not (?:auto)?save|cannot save|unavailable/i);
  await restricted.locator('#resume-button').click();
  const restrictedTime = await restricted.evaluate(() => tyran.state.time);
  await restricted.waitForFunction(time => tyran.state.time > time, restrictedTime);
  assert.deepEqual(errors, [], 'No browser errors throughout automatic campaign flows');
  console.log('Campaign browser checks passed: new/resume UI, periodic/pause/menu/pagehide autosaves, exact single-player flight and scenery restoration, responsive formations, practice isolation, shop upgrades, stage progression, victory, legacy migration, corruption and storage failures.');
} finally { await browser.close(); }
