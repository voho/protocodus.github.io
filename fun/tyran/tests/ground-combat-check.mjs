import assert from 'node:assert/strict';
import { createCampaign, beginLevel, update, hurtPlayer, spawnEnemy, applyGroundReward, WEAPONS, weaponStats, SECONDARY_ENERGY_COST } from '../sim.js';
import { serializeRun, restoreRun } from '../save-game.js';

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}
function quiet() {
  const state = createCampaign();
  state.showcase = 9; state.spawnTimer = state.formationTimer = state.duration = Infinity; state.director.hold = true;
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

check('ten-second bonuses coexist, refresh without stacking, and pause with simulation', () => {
  const state = quiet(), player = state.players[0];
  collect(state, 'rapid'); collect(state, 'invulnerable');
  assert(player.rapidFireTime > 9.9); assert.equal(player.invulnerableTime, 10);
  advance(state, 3); assert(Math.abs(player.invulnerableTime - 7) < 1e-9);
  collect(state, 'invulnerable'); assert.equal(player.invulnerableTime, 10);
  collect(state, 'rapid'); assert.equal(player.rapidFireTime, 10);
  const remaining = [player.invulnerableTime, player.rapidFireTime];
  state.status = 'hangar'; advance(state, 2);
  assert.deepEqual([player.invulnerableTime, player.rapidFireTime], remaining);
  state.status = 'playing'; advance(state, 10.02);
  assert.equal(player.invulnerableTime, 0); assert.equal(player.rapidFireTime, 0);
  const event = state.events.find(item => item.type === 'pickup' && item.bonus === 'rapid');
  assert.equal(event.player, 0); assert.equal(event.value, 'Rapid fire · 10s');
});

check('rapid fire accelerates both channels without free plasma energy', () => {
  for (const weapon of WEAPONS) {
    const baseline = quiet(), boosted = quiet(), seconds = weapon.id === 'plasma' ? .99 : 5;
    const controls = weapon.id === 'plasma' ? { secondary: true } : { fire: true };
    boosted.players[0].rapidFireTime = 10;
    advance(baseline, seconds, [controls]);
    advance(boosted, seconds, [controls]);
    const shots = (state, player) => state.events.filter(event => event.type === 'shot' && event.player === player).length;
    const ratio = shots(boosted, 0) / shots(baseline, 0);
    assert(ratio >= 1.3 && ratio <= 1.75, `${weapon.id}: ${ratio}x burst cadence`);
    for (const bullet of boosted.bullets) assert.equal(bullet.damage, weaponStats(boosted, weapon.id).damage * 1.35);
    if (weapon.id === 'plasma') {
      assert.equal(boosted.players[0].fireEnergy, 100 - shots(boosted, 0) * SECONDARY_ENERGY_COST);
      assert(boosted.players[0].fireEnergy < baseline.players[0].fireEnergy, 'rapid plasma uses its reserve sooner');
      advance(boosted, .5, [controls]);
      assert.equal(shots(boosted, 0), 5); assert.equal(boosted.players[0].fireEnergy, 0); assert(boosted.players[0].fireEnergyLocked);
    }
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

check('natural scenery never creates explosions, salvage or blast impulses', () => {
  const state = quiet(), pilot = state.players[0];
  for (const type of ['tree', 'rock', 'fern', 'crystal', 'cactus']) applyGroundReward(state, {
    id: type, type, x: pilot.x - 20, y: pilot.y, size: 80, structural: false, value: 12, bonus: 'rapid',
  });
  assert.equal(state.destroyed, 0); assert.equal(state.credits, 0); assert.equal(state.score, 0);
  assert.deepEqual(state.pickups, []); assert.deepEqual(state.events, []);
  assert.equal(pilot.blastVx || 0, 0); assert.equal(pilot.blastVy || 0, 0);
});

check('ground sites cannot emit hostile fire', () => {
  const state = quiet();
  advance(state, 8, [], [{ id: 'retired-turret', x: 600, y: 220, radius: 22, phase: .23 }]);
  assert.deepEqual(state.turrets, []); assert.equal(state.bullets.length, 0);
  assert.equal(state.events.some(event => event.type === 'turret-shot'), false);
});

check('autosaves preserve bonuses while retiring saved ground defenses', () => {
  const state = quiet();
  advance(state, 1);
  state.players[0].rapidFireTime = 4.125; state.players[0].invulnerableTime = 8.25;
  state.pickups.push({ x: 100, y: 100, age: 1.5, kind: 'invulnerable', value: 0 }, { x: 900, y: 90, age: 2, kind: 'rapid', value: 0 });
  const encoded = serializeRun(state), restored = restoreRun(encoded).state;
  assert.equal(restored.players[0].rapidFireTime, 4.125); assert.equal(restored.players[0].invulnerableTime, 8.25);
  assert.deepEqual(restored.turrets, state.turrets); assert.deepEqual(restored.pickups, state.pickups);
  update(state, 1 / 60); update(restored, 1 / 60);
  assert.deepEqual(restored.turrets, state.turrets);
  assert.equal(restored.players[0].rapidFireTime, state.players[0].rapidFireTime);
  const old = JSON.parse(encoded);
  delete old.state.turrets;
  for (const player of old.state.players) { delete player.rapidFireTime; delete player.invulnerableTime; }
  const legacy = restoreRun(old).state;
  assert.deepEqual(legacy.turrets, []);
  assert(legacy.players.every(player => !player.rapidFireTime && !player.invulnerableTime));
  const retired = JSON.parse(encoded);
  retired.state.turrets = [{ id: 'legacy-turret', x: 600, y: 220, charge: 1, cooldown: 0 }];
  retired.state.bullets.push(
    { x: 400, y: 200, vx: 0, vy: 180, team: -1, color: '#ffc76c', kind: 'hostile', variant: 3 },
    { x: 450, y: 200, vx: 0, vy: 180, team: -1, color: '#ffe16a', kind: 'hostile', variant: 3 },
  );
  const resumed = restoreRun(retired).state;
  assert.deepEqual(resumed.turrets, []);
  assert.equal(resumed.bullets.length, 1, 'Only retired turret rounds disappear');
  assert.equal(resumed.bullets[0].color, '#ffe16a', 'Ship-fired ammunition survives restoration');
  assert.equal(resumed.hostileCount, 1);

});

if (failures) process.exitCode = 1;
else console.log('All ground-combat and timed-bonus checks passed.');
