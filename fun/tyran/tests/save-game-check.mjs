import assert from 'node:assert/strict';
import { createCampaign, beginLevel, spawnEnemy, spawnFormation, update, buyUpgrade, shipStats } from '../sim.js';
import { serializeRun, restoreRun, readSave, writeSave, clearSave, SAVE_KEYS, LEGACY_SAVE_KEY } from '../save-game.js';

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
  const state = createCampaign(2, 4);
  state.startLevel = 1; state.upgrades = { weapon: 2, shield: 3, hull: 1, recharge: 4 };
  beginLevel(state, 4);
  state.time = 22.3; state.scroll = 2452.75; state.spawnTimer = 1.3; state.formationTimer = 5.4;
  state.credits = 2421; state.score = 39200; state.totalKills = 289;
  state.combo = 3; state.comboTime = 2.8; state.comboDamage = 1.18; state.comboBlast = 1.24; state.comboLabel = 'Multi kill';
  state.players[0].hull -= 23; state.players[0].shield -= 32;
  state.players[0].vx = 120; state.players[0].bank = .12;
  state.players[1].hull = 0; state.players[1].alive = false;
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

check('co-op flight preserves equipment, motion, formation identity, boss windows and scenery', () => {
  const state = seeded(17, flight), originalAnchor = state.formations[0];
  const damage = new Map([['1894:1:2:3:0', 18.5], ['1894:1:2:3:1', -12]]), destroyed = new Set(['1894:1:2:3:1']);
  const before = JSON.stringify(state);
  const run = restoreRun(serializeRun(state, { scene: 'pause', seed: 'campaign-gamma', damage, destroyed, unlocked: 6 }));
  assert.ok(run); assert.equal(run.scene, 'pause'); assert.equal(run.seed, 'campaign-gamma'); assert.equal(run.unlocked, 6);
  assert.equal(run.state.startLevel, 1); assert.equal(run.state.level, 4); assert.equal(run.state.mode, 2);
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

check('hangar purchases persist and next sector restores both upgraded ships', () => {
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

check('victory reloads as a finished campaign without replaying rewards', () => {
  const state = createCampaign(1, 9); state.status = 'victory'; state.score = 45600;
  const run = restoreRun(serializeRun(state, { scene: 'end', unlocked: 9 }));
  assert.equal(run.scene, 'end'); assert.equal(run.state.status, 'victory');
  update(run.state, 1 / 60, [{ fire: true }]);
  assert.equal(run.state.score, 45600); assert.deepEqual(run.state.events, []);
});

check('manual and automatic slots stay independent and report missing saves', () => {
  const storage = memoryStorage(), state = createCampaign();
  assert.deepEqual(readSave('auto', storage), { ok: true, run: null, error: null });
  assert.equal(writeSave('manual', state, { seed: 'manual-seed' }, storage).ok, true);
  state.credits = 300;
  assert.equal(writeSave('auto', state, { seed: 'auto-seed' }, storage).ok, true);
  assert.equal(readSave('manual', storage).run.state.credits, 0);
  assert.equal(readSave('auto', storage).run.state.credits, 300);
  assert.equal(readSave('manual', storage).run.seed, 'manual-seed');
  assert.equal(clearSave('auto', storage).ok, true);
  assert.equal(readSave('auto', storage).run, null);
  assert.ok(readSave('manual', storage).run);
});

check('legacy checkpoints resume at the preceding shop with campaign progress intact', () => {
  const storage = memoryStorage();
  storage.setItem(LEGACY_SAVE_KEY, JSON.stringify({ version: 1, unlocked: 6, checkpoint: { mode: 2, level: 5, upgrades: { weapon: 3, hull: 2, shield: 1, recharge: 4 }, credits: 2340, score: 56780, totalKills: 348, weapon: 'plasma' } }));
  const result = readSave('auto', storage), run = result.run;
  assert.equal(result.ok, true); assert.equal(run.migrated, true); assert.equal(run.savedAt, 0);
  assert.equal(run.scene, 'hangar'); assert.equal(run.state.level, 4); assert.equal(run.state.mode, 2);
  assert.equal(run.state.upgrades.weapon, 3); assert.equal(run.state.weapon, 'plasma');
  assert.equal(run.state.credits, 2340); assert.equal(run.unlocked, 6);
  assert.equal(run.state.events.length, 0);
  assert.equal(buyUpgrade(run.state, 'shield'), true);
  beginLevel(run.state, run.state.level + 1); assert.equal(run.state.level, 5);
  assert.equal(writeSave('auto', run.state, run, storage).ok, true);
  assert.equal(readSave('auto', storage).run.migrated, false);
  storage.data.delete(SAVE_KEYS.auto);
  storage.setItem(LEGACY_SAVE_KEY, '{"version":1,"unlocked":9,"checkpoint":null}');
  assert.deepEqual(readSave('auto', storage), { ok: true, run: null, error: null });
});

check('storage rejection and corrupt saves report failures without damaging another slot', () => {
  const storage = memoryStorage(), state = createCampaign();
  writeSave('manual', state, {}, storage);
  const before = storage.getItem(SAVE_KEYS.manual);
  const denied = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } };
  assert.equal(readSave('auto', denied).error, 'unavailable');
  assert.equal(writeSave('auto', state, {}, denied).error, 'unavailable');
  assert.equal(clearSave('auto', denied).error, 'unavailable');
  assert.equal(writeSave('manual', { ...state, status: 'defeat' }, {}, storage).error, 'invalid-run');
  assert.equal(storage.getItem(SAVE_KEYS.manual), before);
  storage.setItem(SAVE_KEYS.auto, '{broken');
  assert.equal(readSave('auto', storage).error, 'corrupt');
  assert.equal(readSave('__proto__', storage).error, 'invalid-slot');
  assert.equal(writeSave('other', state, {}, storage).error, 'invalid-slot');
});

check('untrusted save data is bounded and unknown properties never enter live state', () => {
  const record = JSON.parse(serializeRun(flight()));
  record.state.upgrades.hull = 999; record.state.credits = 1e20;
  record.state.players[0].hull = 1e20; record.state.players[0].maxHull = 1e20;
  record.state.bullets[0].splash = 1e20; record.state.bullets[0].comboBlast = 1e20;
  record.state.__proto__ = { polluted: 'yes' }; record.state.customCode = 'alert(1)';
  const run = restoreRun(record);
  assert.ok(run); assert.equal(run.state.upgrades.hull, 6); assert.equal(run.state.credits, 100_000_000);
  assert.equal(run.state.players[0].hull, shipStats(run.state.upgrades).hull);
  assert.ok(run.state.bullets[0].splash * run.state.bullets[0].comboBlast < 221);
  assert.equal(Object.hasOwn(run.state, 'customCode'), false); assert.equal(run.state.polluted, undefined);
  record.state.players[0].x = '@infinity'; assert.equal(restoreRun(record), null);
});

check('scenery health versions distinguish older absolute-HP saves without losing damage', () => {
  const state = flight(), damage = new Map([['1894:1:2:3:0', 18.5]]);
  const current = JSON.parse(serializeRun(state, { damage }));
  assert.equal(current.sceneryVersion, 2);
  assert.equal(restoreRun(current).sceneryVersion, 2);
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
  corrupt(record => { record.state.level = 9; record.state.status = 'hangar'; record.scene = 'hangar'; });
  corrupt(record => { record.state.status = 'victory'; record.scene = 'end'; });
  corrupt(record => { record.state.enemies[0].formationId = 999999; });
  corrupt(record => { record.state.enemies[1].id = record.state.enemies[0].id; });
  corrupt(record => { record.state.formations.push(record.state.formations[0]); });
  corrupt(record => { record.state.enemies.at(-1).weakPoints = []; });
  corrupt(record => { record.state.bullets[0].color = 'url(x)'; });
  corrupt(record => { record.state.bullets[0].color = '#f00'; });
  corrupt(record => { record.state.bullets[0].weaponColor = '#ff000080'; });
  corrupt(record => { record.state.players[0].alive = 'true'; });
  corrupt(record => { record.state.bullets = Array(1025).fill(record.state.bullets[0]); });
  corrupt(record => { record.damage = Array(24001).fill(['prop', 1]); });
  assert.equal(restoreRun(' '.repeat(4_000_001)), null);
});

if (failures) process.exitCode = 1;
