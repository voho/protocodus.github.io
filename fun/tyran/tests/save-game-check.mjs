import assert from 'node:assert/strict';
import { createCampaign, beginLevel, spawnEnemy, spawnFormation, update, buyUpgrade, shipStats, selectWeapon, killEnemy, buyPrimary, buySupply, START_LIVES } from '../sim.js';
import { serializeRun, restoreRun, readCampaign, writeCampaign, clearCampaign, SAVE_KEY, LEGACY_SAVE_KEY } from '../save-game.js';

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}
function seeded(seed, fn) {
  const original = Math.random;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  try { return fn(); } finally { Math.random = original; }
}
function memoryStorage() {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
}
function flight() {
  const state = createCampaign(4);
  state.startLevel = 1; state.upgrades = { weapon: 2, shield: 3, hull: 1, recharge: 4 };
  beginLevel(state, 4);
  selectWeapon(state, 'plasma');
  state.time = 22.3; state.scroll = 2452.75; state.spawnTimer = 1.3; state.formationTimer = 5.4;
  state.credits = 2421; state.score = 39200; state.totalKills = 289;
  state.combo = 3; state.comboTime = 2.8; state.comboDamage = 1.18; state.comboBlast = 1.24; state.comboLabel = 'Multi kill';
  state.players[0].hull -= 23; state.players[0].shield -= 32;
  state.players[0].vx = 120;
  const formation = spawnFormation(state, 'orbit');
  formation.age = 3.6; formation.y = 220;
  const boss = spawnEnemy(state, 9, 800, 180);
  boss.age = 10; boss.hp -= 300; boss.weakPoints[0].hp = -3; boss.weakPoints[0].alive = false;
  boss.vulnerable = true; boss.windowCount = 2; boss.windowClock = 1.8;
  state.bullets.push({ x: 350, y: 680, px: 349, py: 684, vx: 30, vy: -420, damage: 15, baseDamage: 12.3, radius: 5.8, team: 0, life: 3.2,
    color: '#9cfff0', weaponColor: '#9ee8ff', kind: 'seeker', pierce: 0, homing: 4.7, splash: 0, splashFactor: 0, chain: 0, chainRange: 0, chainFactor: .6, hitIds: [formation.id], age: .4, comboBlast: 1.24 });
  state.bullets.push({ x: 300, y: 240, px: 301, py: 237, vx: -60, vy: 180, damage: 7, radius: 3, team: -1, life: 6,
    color: '#75f5ff', kind: 'hostile', variant: 0, sourceRadius: 18, age: 1 });
  state.pickups.push({ x: 240, y: 700, age: 2, kind: 'credit', value: 80 });
  state.events.push({ type: 'explosion', size: 100 }, { type: 'hangar', bonus: 950 });
  return state;
}

check('flight preserves equipment, motion, formation identity, boss windows and scenery', () => {
  const state = seeded(17, flight), originalAnchor = state.formations[0];
  const damage = new Map([['1894:1:2:3:0', 18.5], ['1894:1:2:3:1', -12]]), destroyed = new Set(['1894:1:2:3:1']);
  const before = JSON.stringify(state);
  const run = restoreRun(serializeRun(state, { scene: 'pause', seed: 'campaign-gamma', damage, destroyed, unlocked: 6 }));
  assert.ok(run); assert.equal(run.scene, 'pause'); assert.equal(run.seed, 'campaign-gamma'); assert.equal(run.unlocked, 6);
  assert.equal(run.state.startLevel, 1); assert.equal(run.state.level, 4); assert.equal(run.state.mode, 1);
  assert.equal(run.state.time, state.time); assert.equal(run.state.scroll, state.scroll);
  assert.deepEqual(run.state.upgrades, state.upgrades); assert.deepEqual(run.state.players, state.players);
  assert.equal(run.state.enemies[0].formation, run.state.formations[0]);
  assert.equal(run.state.enemies[1].formation, run.state.formations[0]);
  assert.equal(run.state.enemies[1].formationOffset, run.state.formations[0].offsets[1]);
  assert.notEqual(run.state.formations[0], originalAnchor);
  assert.deepEqual(run.state.enemies.at(-1).weakPoints, state.enemies.at(-1).weakPoints);
  assert.equal(run.state.enemies.at(-1).windowClock, 1.8);
  assert.equal(run.state.enemies.at(-1).vulnerable, true);
  assert.deepEqual(run.damage, damage); assert.deepEqual(run.destroyed, destroyed);
  assert.deepEqual(run.state.events, []); assert.equal(JSON.stringify(state), before);
  assert.ok(run.savedAt > Date.now() - 1000);
});

check('a restored flight produces the same next combat step', () => {
  const state = seeded(9, flight), restored = restoreRun(serializeRun(state)).state;
  state.events.length = 0;
  const input = [{ x: -.5, y: .25, fire: true }, {}];
  seeded(18, () => update(state, 1 / 60, input));
  seeded(18, () => update(restored, 1 / 60, input));
  const originalRecord = JSON.parse(serializeRun(state)), restoredRecord = JSON.parse(serializeRun(restored));
  originalRecord.savedAt = restoredRecord.savedAt = 0;
  assert.deepEqual(restoredRecord, originalRecord);
  assert.deepEqual(restored.events, state.events);
});

check('autosaves preserve fire energy, exhaustion and cadence through mixed primary and secondary fire', () => {
  const state = createCampaign(), storage = memoryStorage();
  selectWeapon(state, 'plasma');
  state.players[0].fire = .31;
  Object.assign(state.players[0], { fireEnergy: 13.75, fireEnergyDelay: .37, fireEnergyLocked: true });
  assert.equal(writeCampaign(state, {}, storage).ok, true);
  const resumed = readCampaign(storage).run.state;
  assert.deepEqual(resumed.players.map(player => player.weapon), ['plasma']);
  assert.deepEqual(resumed.players.map(player => player.fire), [.31]);
  assert.deepEqual(resumed.players, state.players);
  assert.equal(resumed.weapon, 'plasma');
  state.bossSpawned = resumed.bossSpawned = true;
  state.events.length = 0;
  for (let tick = 0; tick < 120; tick++) {
    update(state, .05, [{ secondary: true, fire: tick < 50 }]);
    update(resumed, .05, [{ secondary: true, fire: tick < 50 }]);
    assert.deepEqual(resumed.players, state.players, 'resuming must neither refill energy nor shorten exhaustion or cooldown');
    assert.deepEqual(resumed.events, state.events);
  }
  assert.deepEqual(resumed.bullets, state.bullets, 'resuming keeps both firing cadences and projectile types');
});

check('legacy saves start with full fire energy while retaining old in-flight projectiles', () => {
  for (const [legacy, expected] of Object.entries({ pulse: 'pulse', plasma: 'plasma', scatter: 'plasma', lance: 'pulse', seeker: 'plasma', arc: 'plasma' })) {
    const record = JSON.parse(serializeRun(flight()));
    record.state.weapon = legacy;
    for (const player of record.state.players) {
      delete player.weapon; delete player.fireEnergy; delete player.fireEnergyDelay; delete player.fireEnergyLocked;
    }
    const reference = record.state.bullets[0];
    record.state.bullets = ['pulse', 'plasma', 'scatter', 'lance', 'seeker', 'arc'].map(kind => ({ ...reference, kind }));
    const restored = restoreRun(record).state;
    assert.deepEqual(restored.players.map(player => player.weapon), [expected], `${legacy} shared selection migrates for the pilot`);
    assert.equal(restored.weapon, expected);
    for (const player of restored.players) {
      assert.equal(player.fireEnergy, 100); assert.equal(player.fireEnergyDelay, 0); assert.equal(player.fireEnergyLocked, false);
    }
    assert.deepEqual(restored.bullets.map(bullet => bullet.kind), record.state.bullets.map(bullet => bullet.kind));
    assert.equal(restored.bullets[4].homing, reference.homing);
  }
  const state = createCampaign(); selectWeapon(state, 'plasma');
  const inconsistent = JSON.parse(serializeRun(state)); inconsistent.state.weapon = 'pulse';
  assert.equal(restoreRun(inconsistent).state.weapon, 'plasma', 'pilot one is authoritative if a compatibility mirror is stale');
  const legacyStorage = memoryStorage();
  legacyStorage.setItem(LEGACY_SAVE_KEY, JSON.stringify({ version: 1, checkpoint: { mode: 2, level: 2, weapon: 'arc' } }));
  assert.deepEqual(readCampaign(legacyStorage).run.state.players.map(player => player.weapon), ['plasma']);
  assert(readCampaign(legacyStorage).run.state.players.every(player => player.fireEnergy === 100 && !player.fireEnergyDelay && !player.fireEnergyLocked));
});

check('old co-op saves keep a surviving ship, remap ownership and convert enemy health once', () => {
  for (const firstAlive of [true, false]) for (const status of ['playing', 'hangar']) {
    const record = JSON.parse(serializeRun(flight())), raw = record.state;
    raw.mode = 2; raw.status = status; record.scene = status === 'playing' ? 'pause' : 'hangar';
    const wingmate = { ...raw.players[0], id: 1, x: 820, hull: 64, shield: 19, fireEnergy: 27, fireEnergyDelay: .2, fireEnergyLocked: true, rapidFireTime: 3 };
    raw.players.push(wingmate);
    if (!firstAlive) { raw.players[0].alive = false; raw.players[0].hull = 0; }
    raw.bullets[0].team = 1;
    raw.turrets = [{ id: 'legacy-turret', x: 400, y: 200, targetId: 1, charge: .5 }];
    const before = structuredClone(raw);
    const restored = restoreRun(record);
    assert(restored?.migrated); assert.equal(restored.state.mode, 1);
    assert.equal(restored.state.players.length, 1);
    const pilot = restored.state.players[0], expected = before.players[firstAlive ? 0 : 1];
    for (const field of ['x', 'y', 'hull', 'shield', 'fireEnergy', 'fireEnergyDelay', 'fireEnergyLocked', 'rapidFireTime']) assert.equal(pilot[field], expected[field]);
    assert.equal(pilot.id, 0); assert.equal(restored.state.bullets[0].team, 0); assert.deepEqual(restored.state.turrets, []);
    for (const field of ['level', 'credits', 'score', 'totalKills', 'time', 'scroll']) assert.equal(restored.state[field], before[field]);
    assert.deepEqual(restored.state.upgrades, before.upgrades);
    restored.state.enemies.forEach((enemy, i) => {
      assert.equal(enemy.maxHp, before.enemies[i].maxHp / 1.65); assert.equal(enemy.hp, before.enemies[i].hp / 1.65);
      (enemy.weakPoints || []).forEach((point, j) => {
        assert.equal(point.hp, before.enemies[i].weakPoints[j].hp / 1.65);
        assert.equal(point.maxHp, before.enemies[i].weakPoints[j].maxHp / 1.65);
      });
    });
    const again = restoreRun(serializeRun(restored.state));
    assert.equal(again.migrated, false); assert.deepEqual(again.state.enemies, restored.state.enemies);
    assert.deepEqual(record.state, before, 'migration never mutates the saved record');
    beginLevel(again.state, 5); assert.equal(again.state.players.length, 1); assert.equal(again.state.players[0].x, again.state.width / 2);
  }
});

check('older banking saves restore movement without obsolete sprite state', () => {
  const record = JSON.parse(serializeRun(flight()));
  record.state.players[0].bank = .18;
  record.state.enemies[0].bank = -.2;
  const run = restoreRun(JSON.stringify(record));
  assert.ok(run);
  assert.equal(run.state.players[0].vx, 120);
  assert.equal('bank' in run.state.players[0], false);
  assert.equal('bank' in run.state.enemies[0], false);
});

check('hangar purchases persist and next sector restores the upgraded ship', () => {
  const state = flight(); state.status = 'hangar';
  const creditBefore = state.credits;
  assert.equal(buyUpgrade(state, 'hull'), true);
  const run = restoreRun(serializeRun(state, { scene: 'hangar' }));
  assert.equal(run.scene, 'hangar'); assert.equal(run.state.status, 'hangar');
  assert.equal(run.state.upgrades.hull, 2); assert.ok(run.state.credits < creditBefore);
  beginLevel(run.state, run.state.level + 1);
  assert.equal(run.state.level, 5);
  for (const player of run.state.players) { assert.equal(player.alive, true); assert.equal(player.hull, shipStats(run.state.upgrades).hull); }
});

check('Infinity timers survive JSON without becoming null or NaN', () => {
  const state = flight(); state.spawnTimer = Infinity; state.formationTimer = Infinity;
  state.players[0].lastHit = -Infinity; state.players[0].fire = Infinity; state.players[0].hurt = Infinity;
  state.enemies[0].fire = Infinity; state.bullets[0].life = Infinity;
  const run = restoreRun(serializeRun(state));
  assert.equal(run.state.spawnTimer, Infinity); assert.equal(run.state.formationTimer, Infinity);
  assert.equal(run.state.players[0].lastHit, -Infinity); assert.equal(run.state.players[0].fire, Infinity); assert.equal(run.state.players[0].hurt, Infinity);
  assert.equal(run.state.enemies[0].fire, Infinity); assert.equal(run.state.bullets[0].life, Infinity);
  update(run.state, 1 / 60, []);
  assert.ok(run.state.players.every(player => Number.isFinite(player.x)));
});

check('former victory saves reopen the hangar and continue into the next environment cycle', () => {
  const state = createCampaign(9); state.status = 'hangar'; state.score = 45600; state.credits = 3210;
  state.upgrades.weapon = 3; state.players[0].power = 4; state.players[0].drones = 2; state.players[0].bombs = 5;
  const record = JSON.parse(serializeRun(state, { unlocked: 9 }));
  record.scene = 'end'; record.state.status = 'victory';
  const run = restoreRun(record);
  assert.equal(run.scene, 'hangar'); assert.equal(run.state.status, 'hangar'); assert.equal(run.state.level, 9);
  assert.equal(run.migrated, true); assert.equal(run.unlocked, 10);
  update(run.state, 1 / 60, [{ fire: true }]);
  assert.equal(run.state.score, 45600); assert.equal(run.state.credits, 3210); assert.deepEqual(run.state.events, []);
  assert.equal(run.state.upgrades.weapon, 3);
  assert.deepEqual(['power', 'drones', 'bombs'].map(key => run.state.players[0][key]), [4, 2, 5]);
  const normalized = restoreRun(serializeRun({ ...state, status: 'victory' }, { unlocked: 9 }));
  assert.equal(normalized.scene, 'hangar'); assert.equal(normalized.unlocked, 10);
  const promoted = restoreRun(serializeRun(run.state, run));
  assert.equal(promoted.scene, 'hangar'); assert.equal(promoted.migrated, false);
  assert.equal(promoted.unlocked, 10); assert.equal(promoted.state.score, 45600);
  beginLevel(run.state, run.state.level + 1);
  assert.equal(run.state.level, 10); assert.equal(run.state.status, 'playing');
  assert.equal(run.state.credits, 3210); assert.equal(run.state.upgrades.weapon, 3);
});

check('absolute sectors, starting sectors and unlocked progress survive later campaign cycles', () => {
  for (const level of [9, 10, 29, 1001, 100_000_001, Number.MAX_SAFE_INTEGER]) for (const status of ['playing', 'hangar']) {
    const state = createCampaign(level);
    state.status = status; state.startLevel = Math.max(0, level - 7);
    state.score = 45000; state.credits = 2500; state.upgrades.shield = 3;
    const damage = new Map([['1894:1:2:3:0', 18.5]]), destroyed = new Set(['1894:1:2:3:1']);
    const unlocked = Math.min(Number.MAX_SAFE_INTEGER, level + 1);
    const run = restoreRun(serializeRun(state, { unlocked, damage, destroyed }));
    assert.ok(run, `sector ${level} ${status} round-trips`);
    assert.equal(run.state.level, level); assert.equal(run.state.startLevel, state.startLevel); assert.equal(run.unlocked, unlocked);
    assert.equal(run.scene, status === 'playing' ? 'pause' : 'hangar'); assert.equal(run.migrated, false);
    assert.equal(run.state.score, 45000); assert.equal(run.state.credits, 2500); assert.equal(run.state.upgrades.shield, 3);
    assert.deepEqual(run.damage, damage); assert.deepEqual(run.destroyed, destroyed, 'environment-specific scenery IDs stay intact');
  }
});

check('long campaign totals and extra-ship milestones survive saves without truncation', () => {
  for (const total of [100_000_123, 4_000_000_001, Number.MAX_SAFE_INTEGER]) {
    const state = createCampaign(1001);
    state.credits = state.score = state.totalKills = total;
    state.nextLife = Math.min(Number.MAX_SAFE_INTEGER, total + 10000);
    const record = JSON.parse(serializeRun(state)), restored = restoreRun(record).state;
    for (const key of ['credits', 'score', 'totalKills', 'nextLife']) assert.equal(restored[key], state[key], `${key} keeps ${total}`);
    delete record.state.nextLife;
    const legacy = restoreRun(record).state;
    assert(legacy.nextLife > legacy.score || legacy.nextLife === Number.MAX_SAFE_INTEGER, 'Old saves skip earned milestones in constant time');
    const credits = legacy.credits, lives = legacy.lives;
    update(legacy, 1 / 60);
    assert.equal(legacy.credits, credits); assert.equal(legacy.lives, lives, 'Loading never pays old or exhausted milestones');
    assert.ok(!legacy.events.some(event => event.type === 'extra-life'));
  }
});

check('invalid absolute sector numbers cannot enter a restored campaign', () => {
  const source = serializeRun(createCampaign());
  for (const key of ['level', 'startLevel']) for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '10', null]) {
    const record = JSON.parse(source); record.state[key] = value;
    assert.equal(restoreRun(record), null, `${key} rejects ${value}`);
  }
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '10', null]) {
    const record = JSON.parse(source); record.unlocked = value;
    assert.equal(restoreRun(record), null, `unlocked rejects ${value}`);
  }
});

check('one campaign autosave replaces progress and reports missing saves', () => {
  const storage = memoryStorage(), state = createCampaign();
  assert.deepEqual(readCampaign(storage), { ok: true, run: null, error: null });
  assert.equal(writeCampaign(state, { seed: 'campaign-seed' }, storage).ok, true);
  state.credits = 300; state.score = 800; state.totalKills = 12;
  assert.equal(writeCampaign(state, { seed: 'campaign-seed' }, storage).ok, true);
  const run = readCampaign(storage).run;
  assert.equal(run.state.credits, 300); assert.equal(run.state.score, 800); assert.equal(run.state.totalKills, 12);
  assert.equal(run.seed, 'campaign-seed'); assert.equal(run.migrated, false);
  assert.deepEqual([...storage.data.keys()], [SAVE_KEY]);
  assert.equal(clearCampaign(storage).ok, true);
  assert.equal(readCampaign(storage).run, null);
});

check('the newest valid historical slot migrates, with automatic saves winning ties', () => {
  const storage = memoryStorage(), state = createCampaign();
  const oldSave = (savedAt, credits) => {
    state.credits = credits;
    return JSON.stringify({ ...JSON.parse(serializeRun(state)), savedAt });
  };
  storage.setItem('tyran-save-v2:auto', oldSave(100, 100));
  storage.setItem('tyran-save-v2:manual', oldSave(200, 200));
  const newest = readCampaign(storage).run;
  assert.equal(newest.state.credits, 200); assert.equal(newest.migrated, true);
  assert.equal(storage.getItem(SAVE_KEY), null, 'reading never overwrites progress');
  storage.setItem('tyran-save-v2:auto', oldSave(200, 300));
  assert.equal(readCampaign(storage).run.state.credits, 300);
  storage.setItem('tyran-save-v2:manual', '{broken');
  assert.equal(readCampaign(storage).run.state.credits, 300);
  storage.setItem('tyran-save-v2:auto', '{broken');
  assert.deepEqual(readCampaign(storage), { ok: false, run: null, error: 'corrupt' });
});

check('canonical progress wins over historical slots, even if corrupted', () => {
  const storage = memoryStorage(), state = createCampaign();
  storage.setItem('tyran-save-v2:manual', serializeRun(state));
  state.credits = 200;
  assert.equal(writeCampaign(state, {}, storage).ok, true);
  assert.equal(readCampaign(storage).run.state.credits, 200);
  storage.setItem(SAVE_KEY, '{broken');
  assert.deepEqual(readCampaign(storage), { ok: false, run: null, error: 'corrupt' });
  assert.equal(clearCampaign(storage).ok, true);
  assert.deepEqual([...storage.data.keys()], []);
  assert.equal(readCampaign(storage).run, null, 'clearing does not revive an old slot');
});

check('legacy checkpoints resume at the preceding shop with campaign progress intact', () => {
  const storage = memoryStorage();
  storage.setItem('tyran-save-v2:auto', '{broken');
  storage.setItem(LEGACY_SAVE_KEY, JSON.stringify({ version: 1, unlocked: 6, checkpoint: { mode: 2, level: 5, upgrades: { weapon: 3, hull: 2, shield: 1, recharge: 4 }, credits: 2340, score: 56780, totalKills: 348, weapon: 'plasma' } }));
  const result = readCampaign(storage), run = result.run;
  assert.equal(result.ok, true); assert.equal(run.migrated, true); assert.equal(run.savedAt, 0);
  assert.equal(run.scene, 'hangar'); assert.equal(run.state.level, 4); assert.equal(run.state.mode, 1);
  assert.equal(run.state.upgrades.weapon, 3); assert.equal(run.state.weapon, 'plasma');
  assert.equal(run.state.credits, 2340); assert.equal(run.unlocked, 6);
  assert.equal(run.state.events.length, 0);
  assert.equal(buyUpgrade(run.state, 'shield'), true);
  beginLevel(run.state, run.state.level + 1); assert.equal(run.state.level, 5);
  const oldCheckpoint = storage.getItem(LEGACY_SAVE_KEY);
  assert.equal(writeCampaign(run.state, run, storage).ok, true);
  assert.equal(readCampaign(storage).run.migrated, false);
  assert.equal(storage.getItem(LEGACY_SAVE_KEY), oldCheckpoint, 'promotion leaves historical data intact');
  clearCampaign(storage);
  storage.setItem(LEGACY_SAVE_KEY, '{"version":1,"unlocked":9,"checkpoint":null}');
  assert.deepEqual(readCampaign(storage), { ok: true, run: null, error: null });
});

check('storage rejection and invalid saves preserve the last valid campaign', () => {
  const storage = memoryStorage(), state = createCampaign();
  writeCampaign(state, {}, storage);
  const before = storage.getItem(SAVE_KEY);
  const denied = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } };
  assert.equal(readCampaign(denied).error, 'unavailable');
  assert.equal(writeCampaign(state, {}, denied).error, 'unavailable');
  assert.equal(clearCampaign(denied).error, 'unavailable');
  assert.equal(writeCampaign({ ...state, status: 'defeat' }, {}, storage).error, 'invalid-run');
  assert.equal(storage.getItem(SAVE_KEY), before);
  const full = { ...storage, setItem() { throw new Error('QuotaExceededError'); } };
  state.credits = 400;
  assert.equal(writeCampaign(state, {}, full).error, 'unavailable');
  assert.equal(storage.getItem(SAVE_KEY), before);
  assert.equal(readCampaign(storage).run.state.credits, 0);
});

check('failed migration or clearing keeps the resumable campaign available', () => {
  const storage = memoryStorage(), state = createCampaign();
  storage.setItem('tyran-save-v2:auto', serializeRun(state));
  const before = storage.getItem('tyran-save-v2:auto');
  const full = { ...storage, setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(writeCampaign(readCampaign(storage).run.state, {}, full).error, 'unavailable');
  assert.equal(storage.getItem('tyran-save-v2:auto'), before);
  assert.equal(readCampaign(storage).run.migrated, true);
  writeCampaign(state, {}, storage);
  const denied = { ...storage, removeItem() { throw new Error('SecurityError'); } };
  assert.equal(clearCampaign(denied).error, 'unavailable');
  assert.equal(readCampaign(storage).run.migrated, false);
});

check('untrusted save data is bounded and unknown properties never enter live state', () => {
  const record = JSON.parse(serializeRun(flight()));
  record.state.upgrades.hull = 999; record.state.credits = 1e20;
  record.state.players[0].hull = 1e20; record.state.players[0].maxHull = 1e20;
  record.state.bullets[0].splash = 1e20; record.state.bullets[0].comboBlast = 1e20;
  record.state.__proto__ = { polluted: 'yes' }; record.state.customCode = 'alert(1)';
  const run = restoreRun(record);
  assert.ok(run); assert.equal(run.state.upgrades.hull, 6); assert.equal(run.state.credits, Number.MAX_SAFE_INTEGER);
  assert.equal(run.state.players[0].hull, shipStats(run.state.upgrades).hull);
  assert.ok(run.state.bullets[0].splash * run.state.bullets[0].comboBlast < 221);
  assert.equal(Object.hasOwn(run.state, 'customCode'), false); assert.equal(run.state.polluted, undefined);
  record.state.players[0].x = '@infinity'; assert.equal(restoreRun(record), null);
});

check('scenery health versions distinguish older absolute-HP saves without losing damage', () => {
  const state = flight(), damage = new Map([['1894:1:2:3:0', 18.5]]);
  const current = JSON.parse(serializeRun(state, { damage }));
  assert.equal(current.sceneryVersion, 3);
  assert.equal(restoreRun(current).sceneryVersion, 3);
  current.sceneryVersion = 2;
  const areaBased = restoreRun(current);
  assert.equal(areaBased.sceneryVersion, 2); assert.deepEqual(areaBased.damage, damage);
  assert.equal(restoreRun(serializeRun(areaBased.state, areaBased)).sceneryVersion, 2);
  delete current.sceneryVersion;
  const legacy = restoreRun(current);
  assert.equal(legacy.sceneryVersion, 1);
  assert.deepEqual(legacy.damage, damage);
  // Re-encoding a save without visiting its map must keep the pending migration.
  assert.equal(restoreRun(serializeRun(legacy.state, legacy)).sceneryVersion, 1);
  current.sceneryVersion = 999;
  assert.equal(restoreRun(current), null);
});

check('blast momentum survives saves and older actors default to zero impulse', () => {
  const state = flight();
  state.players[0].blastVx = 35; state.players[0].blastVy = -48;
  state.enemies[0].blastVx = -27; state.enemies[0].blastVy = 61;
  const record = JSON.parse(serializeRun(state)), restored = restoreRun(record).state;
  assert.equal(restored.players[0].blastVx, 35); assert.equal(restored.players[0].blastVy, -48);
  assert.equal(restored.enemies[0].blastVx, -27); assert.equal(restored.enemies[0].blastVy, 61);
  delete record.state.players[0].blastVx; delete record.state.players[0].blastVy;
  record.state.enemies[0].blastVx = 1000; record.state.enemies[0].blastVy = -1000;
  const legacy = restoreRun(record).state;
  assert.equal(legacy.players[0].blastVx, 0); assert.equal(legacy.players[0].blastVy, 0);
  assert.equal(legacy.enemies[0].blastVx, 110); assert.equal(legacy.enemies[0].blastVy, -110);
});

check('invalid relationships, versions, statuses and oversized collections are rejected', () => {
  const source = serializeRun(flight());
  const corrupt = edit => { const record = JSON.parse(source); edit(record); assert.equal(restoreRun(record), null); };
  corrupt(record => { record.version = 900; });
  corrupt(record => { record.scene = 'hangar'; });
  corrupt(record => { record.state.status = 'defeat'; });
  corrupt(record => { record.state.status = 'victory'; record.scene = 'end'; });
  corrupt(record => { record.state.enemies[0].formationId = 999999; });
  corrupt(record => { record.state.enemies[1].id = record.state.enemies[0].id; });
  corrupt(record => { record.state.formations.push(record.state.formations[0]); });
  corrupt(record => { record.state.enemies.at(-1).weakPoints = []; });
  corrupt(record => { record.state.bullets[0].color = 'url(x)'; });
  corrupt(record => { record.state.bullets[0].color = '#f00'; });
  corrupt(record => { record.state.bullets[0].weaponColor = '#ff000080'; });
  corrupt(record => { record.state.players[0].alive = 'true'; });
  corrupt(record => { record.state.players[0].fireEnergy = 'full'; });
  corrupt(record => { record.state.players[0].fireEnergyDelay = '@infinity'; });
  corrupt(record => { record.state.players[0].fireEnergyLocked = 'false'; });
  corrupt(record => { record.state.bullets = Array(1025).fill(record.state.bullets[0]); });
  corrupt(record => { record.damage = Array(24001).fill(['prop', 1]); });
  assert.equal(restoreRun(' '.repeat(4_000_001)), null);
});

check('mid-wave flights keep the script, hive, squadrons, dives, beams and drones step for step', () => seeded(71, () => {
  const state = createCampaign(2), player = state.players[0];
  Object.assign(player, { power: 3, drones: 2, bombs: 4, hurt: 1e6 });
  let snapshot = null;
  for (let t = 0; t < 120 && !snapshot; t += 1 / 60) {
    update(state, 1 / 60, [{ x: Math.sin(t) }]); state.events.length = 0;
    const diving = state.enemies.some(enemy => enemy.ai === 'dive'), entering = state.enemies.some(enemy => enemy.ai === 'entry');
    if (diving && entering && state.squadrons.length && player.wing.length === 2) snapshot = true;
  }
  assert.ok(snapshot, 'reached a busy hive wave');
  state.beams.push({ owner: state.enemies[0].id, angle: 1.2, t: .3, warn: .9, dx: 0, dy: 20 });
  state.pickups.push({ x: 300, y: 300, age: 1, kind: 'power', value: 0, vx: 40, vy: -120, lock: .6 });
  const restored = restoreRun(serializeRun(state)).state;
  assert.deepEqual(restored.players, state.players);
  assert.deepEqual(restored.director, state.director);
  assert.deepEqual(restored.squadrons, state.squadrons);
  assert.deepEqual(restored.beams, state.beams);
  assert.deepEqual(restored.pickups, state.pickups);
  for (let tick = 0; tick < 90; tick++) {
    const input = [{ fire: tick % 3 > 0, x: tick % 40 < 20 ? 1 : -1, bomb: tick === 50 }];
    seeded(100 + tick, () => update(state, 1 / 60, input));
    seeded(100 + tick, () => update(restored, 1 / 60, input));
  }
  const a = JSON.parse(serializeRun(state)), b = JSON.parse(serializeRun(restored));
  a.savedAt = b.savedAt = 0;
  assert.deepEqual(b, a);
  assert.deepEqual(restored.events, state.events);
}));

check('shop loadout, reserve ships and challenge results survive the hangar and a reload', () => {
  const state = createCampaign(0);
  killEnemy(state, spawnEnemy(state, 9, 600, 155));
  for (let t = 0; t < 60 && state.status === 'playing'; t += 1 / 30) {
    update(state, 1 / 30); state.events.length = 0;
    for (const enemy of state.enemies) if (enemy.challenge && !enemy.dead && enemy.y > 0 && enemy.x > 0 && enemy.x < state.width && enemy.pathD >= 0) killEnemy(state, enemy);
  }
  assert.equal(state.status, 'hangar');
  state.credits = 20000;
  assert.ok(buyPrimary(state, 'lance')); assert.ok(buySupply(state, 'drone')); assert.ok(buySupply(state, 'life'));
  const run = restoreRun(serializeRun(state));
  assert.equal(run.scene, 'hangar');
  assert.equal(run.state.primary, 'lance'); assert.deepEqual(run.state.owned, ['pulse', 'lance']);
  assert.equal(run.state.players[0].drones, 1); assert.equal(run.state.lives, START_LIVES + 1 + (state.lives - START_LIVES - 1));
  assert.equal(run.state.livesBought, 1);
  assert.deepEqual(run.state.challenge, state.challenge); assert.deepEqual(run.state.stats, state.stats);
  beginLevel(run.state, 1);
  assert.equal(run.state.primary, 'lance'); assert.equal(run.state.players[0].drones, 1); assert.equal(run.state.challenge, null);
});

check('saves from before the wave director resume with a fresh script and default loadout', () => {
  const record = JSON.parse(serializeRun(flight()));
  for (const key of ['director', 'hive', 'squadrons', 'nextSquadId', 'challenge', 'beams', 'primary', 'owned', 'lives', 'livesBought', 'nextLife', 'respawn', 'stats']) delete record.state[key];
  for (const player of record.state.players) for (const key of ['power', 'drones', 'bombs', 'guard', 'bombHeld', 'wing']) delete player[key];
  const restored = restoreRun(record).state;
  assert.equal(restored.primary, 'pulse'); assert.deepEqual(restored.owned, ['pulse']); assert.equal(restored.lives, START_LIVES);
  assert.equal(restored.director.wave, -1); assert.deepEqual(restored.squadrons, []); assert.deepEqual(restored.beams, []);
  assert.deepEqual([restored.players[0].power, restored.players[0].drones, restored.players[0].bombs, restored.players[0].wing.length], [0, 0, 3, 0]);
  update(restored, 1 / 60, [{ fire: true }]);
});

check('corrupt scripted state is rejected', () => {
  const state = createCampaign(1);
  for (let t = 0; t < 6; t += 1 / 30) { update(state, 1 / 30); state.events.length = 0; }
  state.players[0].drones = 1; update(state, 1 / 30);
  const source = serializeRun(state);
  const corrupt = edit => { const record = JSON.parse(source); edit(record); assert.equal(restoreRun(record), null); };
  corrupt(record => { record.state.director.plan = ['hive', 'party']; });
  corrupt(record => { record.state.director.plan = []; });
  corrupt(record => { record.state.enemies[0].ai = 'teleport'; });
  corrupt(record => { record.state.enemies[0].path = 'secret'; });
  corrupt(record => { record.state.players[0].wing.push({ x: 1, y: 2 }, { x: 3, y: 4 }); });
  corrupt(record => { record.state.pickups.push({ x: 1, y: 1, age: 0, kind: 'jackpot', value: 1 }); });
  corrupt(record => { record.state.beams = [{ owner: 999999, angle: 0, t: 0, warn: 1, dx: 0, dy: 0 }]; });
  corrupt(record => { record.state.squadrons = [{ id: 1, size: 2 }, { id: 1, size: 2 }]; });
  const bounded = JSON.parse(source);
  bounded.state.lives = 99; bounded.state.players[0].power = 99; bounded.state.players[0].bombs = -4; bounded.state.owned = ['pulse', 'railgun', 'scatter']; bounded.state.primary = 'lance';
  const run = restoreRun(bounded).state;
  assert.equal(run.lives, 5); assert.equal(run.players[0].power, 4); assert.equal(run.players[0].bombs, 0);
  assert.deepEqual(run.owned, ['pulse', 'scatter']); assert.equal(run.primary, 'pulse', 'an unowned primary cannot be equipped from a save');
});

check('saving the step a lancer dies mid-beam succeeds, and a tractor pull round-trips exactly', () => {
  const state = createCampaign(3); state.director.hold = true; state.bossSpawned = true;
  const pilot = state.players[0]; pilot.hurt = 1e6;
  const lancer = spawnEnemy(state, 5, pilot.x, 200);
  Object.assign(lancer, { ai: 'station', stationX: pilot.x, stationY: 200, hold: 60, sway: 0, fire: 0 });
  update(state, 1 / 60);
  assert.equal(state.beams.length, 1);
  state.bullets.push({ x: lancer.x, y: lancer.y + 30, px: lancer.x, py: lancer.y + 30, vx: 0, vy: -900, team: 0, damage: 1e6, radius: 4, life: 1 });
  update(state, 1 / 60);
  assert.ok(lancer.dead); assert.equal(state.beams.length, 0, 'the beam leaves with its lancer');
  assert.ok(restoreRun(serializeRun(state)), 'the save is valid on the very step the lancer dies');
  const beam = createCampaign(0), player = beam.players[0];
  beam.director.wave = 5; beam.director.clock = 99; player.hurt = 1e6;
  for (let t = 0; t < 8 && !(player.blastVy < -60); t += 1 / 60) {
    const captor = beam.enemies.find(enemy => enemy.ai === 'captor');
    update(beam, 1 / 60, [{ x: captor ? Math.sign(captor.x - player.x) * (Math.abs(captor.x - player.x) > 12) : 0 }]); beam.events.length = 0;
  }
  assert.ok(player.blastVy < -60, 'the tractor beam is pulling');
  const restored = restoreRun(serializeRun(beam)).state;
  for (let i = 0; i < 20; i++) { seeded(i, () => update(beam, 1 / 60)); seeded(i, () => update(restored, 1 / 60)); }
  assert.deepEqual(restored.players, beam.players);
});

check('an older high-score save does not pay out every past extra-ship milestone at once', () => {
  const record = JSON.parse(serializeRun(flight()));
  record.state.score = 1_500_000; delete record.state.nextLife; delete record.state.lives;
  const restored = restoreRun(record).state, credits = restored.credits;
  assert.ok(restored.nextLife > restored.score);
  update(restored, 1 / 60);
  assert.equal(restored.lives, START_LIVES); assert.equal(restored.credits, credits);
  assert.ok(!restored.events.some(event => event.type === 'extra-life'));
});

if (failures) process.exitCode = 1;
