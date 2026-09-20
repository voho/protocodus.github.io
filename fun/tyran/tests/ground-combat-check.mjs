import assert from 'node:assert/strict';
import { createCampaign, beginLevel, update, hurtPlayer, spawnEnemy, applyGroundReward, WEAPONS, weaponStats, selectWeapon } from '../sim.js';
import { serializeRun, restoreRun } from '../save-game.js';

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}
function quiet(mode = 1) {
  const state = createCampaign(mode);
  state.showcase = 9; state.spawnTimer = state.formationTimer = state.duration = Infinity;
  return state;
}
function advance(state, seconds, controls = [], targets = []) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) update(state, Math.min(1 / 60, seconds - t), controls, null, targets);
}
function collect(state, kind, pilot = 0) {
  const player = state.players[pilot];
  state.pickups.push({ x: player.x, y: player.y, age: 0, kind, value: 0 });
  update(state, 1 / 60);
}
const turret = (id = 'turret:one', x = 600, y = 220) => ({ id, x, y, radius: 22, phase: .23 });

check('cache destruction pays and drops its marked bonus once, including collateral rewards', () => {
  const state = quiet(), prop = { id: 'cache:one', x: 600, y: 220, size: 60, structural: true, value: 16, bonus: 'rapid' };
  state.bullets.push({ x: 600, y: 220, px: 600, py: 220, vx: 0, vy: 0, team: 0, radius: 4, life: 1, damage: 100 });
  let destroyed = false;
  const worldHit = () => { if (destroyed) return []; destroyed = true; return [prop]; };
  update(state, 1 / 60, [], worldHit);
  update(state, 1 / 60, [], worldHit);
  assert.equal(state.pickups.length, 1);
  assert.equal(state.pickups[0].kind, 'rapid');
  assert.equal(state.destroyed, 1); assert.equal(state.credits, 16); assert.equal(state.score, 25);
  applyGroundReward(state, { ...prop, id: 'cache:two', bonus: 'invulnerable' });
  assert.equal(state.pickups.length, 2);
  assert.equal(state.pickups[1].kind, 'invulnerable');
  assert.equal(state.events.filter(event => event.type === 'explosion' && event.ground).length, 2);
});

check('ten-second bonuses are per pilot, refresh without stacking, and pause with simulation', () => {
  const state = quiet(2), [first, second] = state.players;
  collect(state, 'rapid', 1);
  assert.equal(first.rapidFireTime, 0); assert.equal(second.rapidFireTime, 10);
  collect(state, 'invulnerable');
  assert.equal(first.invulnerableTime, 10); assert.equal(second.invulnerableTime, 0);
  advance(state, 3);
  assert(Math.abs(first.invulnerableTime - 7) < 1e-9);
  collect(state, 'invulnerable');
  assert.equal(first.invulnerableTime, 10);
  collect(state, 'rapid', 1);
  assert.equal(second.rapidFireTime, 10);
  const remaining = [first.invulnerableTime, second.rapidFireTime];
  state.status = 'hangar'; advance(state, 2);
  assert.deepEqual([first.invulnerableTime, second.rapidFireTime], remaining);
  state.status = 'playing'; advance(state, 10.02);
  assert.equal(first.invulnerableTime, 0); assert.equal(second.rapidFireTime, 0);
  const event = state.events.find(item => item.type === 'pickup' && item.bonus === 'rapid');
  assert.equal(event.player, 1); assert.equal(event.value, 'Rapid fire · 10s');
});

check('rapid fire increases every weapon cadence while preserving shot damage and co-op isolation', () => {
  for (const weapon of WEAPONS) {
    const baseline = quiet(2), boosted = quiet(2);
    for (const state of [baseline, boosted]) for (const player of state.players) selectWeapon(state, weapon.id, player.id);
    boosted.players[0].rapidFireTime = 10;
    advance(baseline, 5, [{ fire: true }, { fire: true }]);
    advance(boosted, 5, [{ fire: true }, { fire: true }]);
    const shots = (state, player) => state.events.filter(event => event.type === 'shot' && event.player === player).length;
    const ratio = shots(boosted, 0) / shots(baseline, 0);
    assert(ratio >= 1.5 && ratio <= 1.75, `${weapon.id}: ${ratio}x sustained cadence`);
    assert.equal(shots(boosted, 1), shots(baseline, 1), `${weapon.id}: other pilot unchanged`);
    for (const bullet of boosted.bullets) assert.equal(bullet.damage, weaponStats(boosted).damage);
  }
});

check('invulnerability blocks projectiles and collisions, expires normally, and death/new level clear buffs', () => {
  const state = quiet(), player = state.players[0];
  player.invulnerableTime = 1; player.rapidFireTime = 5;
  const health = [player.hull, player.shield];
  hurtPlayer(state, player, 1000);
  assert.deepEqual([player.hull, player.shield], health);
  const enemy = spawnEnemy(state, 0, player.x, player.y); enemy.fire = Infinity;
  state.bullets.push({ x: player.x, y: player.y - 5, px: player.x, py: player.y - 5, vx: 0, vy: 150, team: -1, radius: 4, life: 2, damage: 1000 });
  update(state, 1 / 60);
  assert.deepEqual([player.hull, player.shield], health);
  state.enemies = []; advance(state, 1);
  hurtPlayer(state, player, 1000);
  assert.equal(player.alive, false); assert.equal(player.rapidFireTime, 0); assert.equal(player.invulnerableTime, 0);
  beginLevel(state, 1);
  assert.equal(state.players[0].rapidFireTime, 0); assert.equal(state.players[0].invulnerableTime, 0);
  assert.deepEqual(state.turrets, []);
});

check('turrets warn before firing, lock aim, preserve cadence by ID, and disappear with their targets', () => {
  const state = quiet(), target = turret();
  advance(state, 1, [], [target]);
  assert.equal(state.bullets.length, 0); assert(state.turrets[0].charge > 0);
  const angle = state.turrets[0].angle, cooldown = state.turrets[0].cooldown;
  state.players[0].x += 160;
  update(state, 1 / 60, [], null, [{ ...target, y: target.y + 1 }]);
  assert.equal(state.turrets[0].angle, angle);
  assert(state.turrets[0].cooldown < cooldown);
  advance(state, .5, [], [target]);
  assert.equal(state.bullets.length, 1);
  const bullet = state.bullets[0];
  assert.equal(bullet.color, '#ffc76c'); assert.equal(bullet.variant, 3);
  assert(Math.abs(Math.atan2(bullet.vy, bullet.vx) - angle) < 1e-9);
  update(state, 1 / 60, [], null, []);
  assert.deepEqual(state.turrets, []);
});

check('turrets use current-step scenery positions and never consume simulation random numbers', () => {
  const state = quiet(), random = Math.random;
  let callbackScroll;
  Math.random = () => { throw new Error('Turret cadence consumed the game RNG'); };
  try {
    advance(state, 2, [], current => { callbackScroll = current.scroll; return [turret()]; });
  } finally { Math.random = random; }
  assert.equal(callbackScroll, state.scroll);
  assert.equal(state.bullets.length, 1);
});

check('turrets respect the shared bullet limit, maximum count, safe firing lane, and boss silence', () => {
  const state = quiet(), targets = [turret('a', 450), turret('b', 600), turret('c', 750), turret('d', 850)];
  for (let i = 0; i < 77; i++) state.bullets.push({ x: 100, y: 100, px: 100, py: 100, vx: 0, vy: 0, team: -1, radius: 2, damage: 1, life: 20 });
  advance(state, 2, [], targets);
  assert.equal(state.turrets.length, 3); assert.equal(state.bullets.length, 78);
  const unsafeTargets = [turret('offscreen', 600, -20), turret('behind', 600, 750), turret('close', 600, state.players[0].y - 60)];
  const unsafe = quiet(); advance(unsafe, 5, [], unsafeTargets);
  assert.equal(unsafe.bullets.length, 0); assert(unsafe.turrets.every(item => !item.charge));
  for (const flag of ['bossSpawned', 'bossDefeated']) {
    const boss = quiet(); boss[flag] = true;
    update(boss, 1 / 60, [], null, targets);
    assert.deepEqual(boss.turrets, []); assert.equal(boss.bullets.length, 0);
  }
});

check('autosaves preserve timers, charging turret aim, and uncollected boosts with bounded older-save defaults', () => {
  const state = quiet(2), targets = [turret()];
  advance(state, 1, [], targets);
  state.players[0].rapidFireTime = 4.125; state.players[1].invulnerableTime = 8.25;
  state.pickups.push({ x: 100, y: 100, age: 1.5, kind: 'invulnerable', value: 0 }, { x: 900, y: 90, age: 2, kind: 'rapid', value: 0 });
  const encoded = serializeRun(state), restored = restoreRun(encoded).state;
  assert.equal(restored.players[0].rapidFireTime, 4.125); assert.equal(restored.players[1].invulnerableTime, 8.25);
  assert.deepEqual(restored.turrets, state.turrets); assert.deepEqual(restored.pickups, state.pickups);
  update(state, 1 / 60, [], null, targets); update(restored, 1 / 60, [], null, targets);
  assert.deepEqual(restored.turrets, state.turrets);
  assert.equal(restored.players[0].rapidFireTime, state.players[0].rapidFireTime);
  const old = JSON.parse(encoded);
  delete old.state.turrets;
  for (const player of old.state.players) { delete player.rapidFireTime; delete player.invulnerableTime; }
  const legacy = restoreRun(old).state;
  assert.deepEqual(legacy.turrets, []);
  assert(legacy.players.every(player => !player.rapidFireTime && !player.invulnerableTime));
  const oversized = JSON.parse(encoded); oversized.state.turrets = Array.from({ length: 4 }, (_, index) => ({ ...state.turrets[0], id: String(index) }));
  assert.equal(restoreRun(oversized), null);
  const duplicate = JSON.parse(encoded); duplicate.state.turrets.push(duplicate.state.turrets[0]);
  assert.equal(restoreRun(duplicate), null);
});

if (failures) process.exitCode = 1;
else console.log('All ground-combat and timed-bonus checks passed.');
