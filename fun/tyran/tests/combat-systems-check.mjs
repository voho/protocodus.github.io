import assert from 'node:assert/strict';
import { createCampaign, update, spawnEnemy, damageEnemy, hurtPlayer, killEnemy, shipStats, applyStructureBlast, BARRIER_RESPONSE, KINETIC_BLEED, SHIELD_BREAK_DELAY, SHIELD_COLLAPSE_RADIUS } from '../sim.js';
import { applyRole, addBarrier } from '../roles.js';
import { waveTactics } from '../tactics.js';
import { serializeRun, restoreRun } from '../save-game.js';

// Run with: node fun/tyran/tests/combat-systems-check.mjs
// Weapon classes against barriers, the pilot's shield collapse and reboot,
// and the save round trip of every new combat field.
let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}
function isolated(level = 0) {
  const state = createCampaign(level);
  state.bossSpawned = true;
  return state;
}
function advance(state, seconds, controls = [{}]) {
  for (let t = 0; t < seconds - 1e-8; t += 1 / 60) { update(state, 1 / 60, controls); state.events.length = 0; }
}
const hostileRound = (x, y) => ({ x, y, px: x, py: y, vx: 0, vy: 0, team: -1, damage: 5, radius: 4, life: 5, color: '#ff718f', kind: 'hostile' });
// Fly the director straight into the first wave of this kind that matches.
function launchWave(level, kind, accept = () => true) {
  const state = createCampaign(level), d = state.director;
  const wave = d.plan.findIndex((entry, index) => entry === kind && accept(index));
  if (wave < 0) return null;
  Object.assign(d, { wave: wave - 1, state: 'rest', clock: 0, rest: 0, encounters: [] });
  update(state, 1 / 60, [{}]);
  return state;
}
const close = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} ≠ ${expected}`);

check('energy strips barriers, kinetic glances off, piercing bleeds through, and the hull takes unscaled overflow', () => {
  const state = isolated(5);
  const ship = () => Object.assign(addBarrier(spawnEnemy(state, 5, 600, 300), .5), { ai: 'fixture', noFire: true });
  for (const [kind, response] of Object.entries(BARRIER_RESPONSE)) {
    const enemy = ship(), hull = enemy.hp, barrier = enemy.shieldHp;
    damageEnemy(state, enemy, 10, kind);
    close(enemy.hp, hull - 10 * response.bleed, `${kind} hull`);
    close(enemy.shieldHp, barrier - 10 * (1 - response.bleed) * response.barrier, `${kind} barrier`);
  }
  assert(BARRIER_RESPONSE.pulse.barrier > 1 && BARRIER_RESPONSE.scatter.barrier < 1 && BARRIER_RESPONSE.lance.bleed > 0, 'each class has a distinct role');
  // Overflow beyond the barrier returns to raw damage, never to scaled damage.
  const enemy = ship(), hull = enemy.hp, barrier = enemy.shieldHp;
  state.events.length = 0;
  damageEnemy(state, enemy, barrier / 1.5 + 20, 'pulse');
  assert.equal(enemy.shieldHp, 0);
  close(enemy.hp, hull - 20, 'pulse overflow');
  assert(state.events.some(event => event.type === 'barrier-break'), 'a collapsing barrier is announced');
  // Unclassified damage (novas, chains, QA bolts) keeps the neutral rule.
  const neutral = ship(), neutralHull = neutral.hp;
  damageEnemy(state, neutral, neutral.shieldHp + 5);
  close(neutral.hp, neutralHull - 5, 'neutral overflow');
});

check('aces always, veteran elites and later cruisers carry barriers', () => {
  const state = isolated(6);
  const ace = applyRole(spawnEnemy(state, 6, 600, 300), 'ace');
  assert(ace.shieldMax > 0 && ace.shieldHp === ace.shieldMax);
  const plain = applyRole(spawnEnemy(state, 6, 600, 300), 'elite');
  assert(!plain.shieldMax, 'the role alone adds no barrier; the wave decides');
  // Real sweep waves: elites gain a barrier only once the campaign is veteran.
  const elites = [];
  for (let level = 3; level < 10; level++) {
    const flight = launchWave(level, 'sweep', wave => waveTactics(level, wave, 0).eliteLeader);
    if (flight) elites.push([level, flight.enemies.find(enemy => enemy.role === 'elite')]);
  }
  assert(elites.some(([level]) => level < 5) && elites.some(([level]) => level >= 5), 'elite sweeps exist on both sides of the threshold');
  for (const [level, elite] of elites) assert.equal(!!elite.shieldMax, level >= 5, `sector ${level + 1} elite barrier`);
  for (const level of [1, 2, 6]) {
    const cruiser = launchWave(level, 'midboss').enemies.find(enemy => enemy.role === 'midboss');
    assert.equal(!!cruiser.shieldMax, level >= 2, `sector ${level + 1} cruiser barrier`);
  }
});

check('kinetic impacts bleed through the shield while energy rounds do not', () => {
  const state = isolated(), pilot = state.players[0], stats = shipStats(state.upgrades);
  hurtPlayer(state, pilot, 20);
  assert.equal(pilot.hull, stats.hull); assert.equal(pilot.shield, stats.shield - 20);
  pilot.hurt = 0;
  hurtPlayer(state, pilot, 20, 'kinetic');
  close(pilot.hull, stats.hull - 20 * KINETIC_BLEED, 'hull bleed');
  close(pilot.shield, stats.shield - 20 - 20 * (1 - KINETIC_BLEED), 'shield share');
  assert(state.events.some(event => event.type === 'hit' && event.kinetic && event.shield && event.hull));
});

check('a collapsing shield clears nearby rounds, reboots later and reports coming back online', () => {
  const state = isolated(), pilot = state.players[0], stats = shipStats(state.upgrades);
  const near = hostileRound(pilot.x + 40, pilot.y - 40), far = hostileRound(pilot.x + SHIELD_COLLAPSE_RADIUS + 60, pilot.y);
  state.bullets.push(near, far);
  hurtPlayer(state, pilot, pilot.shield + 4);
  assert.equal(pilot.shield, 0);
  assert.equal(near.life, 0, 'rounds inside the pulse are spent');
  assert(far.life > 0, 'rounds outside the pulse survive');
  const pulse = state.events.find(event => event.type === 'shield-break');
  assert(pulse && pulse.cancels.length === 1);
  state.events.length = 0; state.bullets.length = 0;
  // An ordinary hit would recharge after stats.delay; a collapse waits longer.
  advance(state, stats.delay + SHIELD_BREAK_DELAY - .1);
  assert.equal(pilot.shield, 0, 'the shield is still rebooting');
  let online = false;
  for (let i = 0; i < 30 && !online; i++) { update(state, 1 / 60, [{}]); online = state.events.some(event => event.type === 'shield-online'); state.events.length = 0; }
  assert(online && pilot.shield > 0, 'the shield comes back online after its reboot');
  // A hit during the reboot never shortens it.
  pilot.shield = 0; pilot.lastHit = state.time + SHIELD_BREAK_DELAY; pilot.hurt = 0;
  const restart = pilot.lastHit;
  hurtPlayer(state, pilot, 1);
  assert.equal(pilot.lastHit, restart);
  // A hit that destroys the ship never vents a pulse.
  const doomed = isolated(), victim = doomed.players[0];
  doomed.lives = 0; victim.hull = 1;
  hurtPlayer(doomed, victim, victim.shield + 50);
  assert(!doomed.events.some(event => event.type === 'shield-break'));
});

check('barriers on any role and rebooting shields survive a save', () => {
  const state = isolated(6);
  const ace = applyRole(spawnEnemy(state, 6, 600, 300), 'ace');
  ace.shieldHp = ace.shieldMax * .4; ace.shieldHit = 3;
  const elite = addBarrier(applyRole(spawnEnemy(state, 4, 400, 300), 'elite'), .25);
  state.players[0].lastHit = 7.5;
  const run = restoreRun(serializeRun(state));
  const restoredAce = run.state.enemies.find(enemy => enemy.id === ace.id), restoredElite = run.state.enemies.find(enemy => enemy.id === elite.id);
  assert.deepEqual([restoredAce.shieldMax, restoredAce.shieldHp, restoredAce.shieldHit], [ace.shieldMax, ace.shieldHp, ace.shieldHit]);
  assert.deepEqual([restoredElite.shieldMax, restoredElite.shieldHp], [elite.shieldMax, elite.shieldHp]);
  assert.equal(run.state.players[0].lastHit, 7.5);
});


check('heavy hulls shove the pilot clear after a ram; light hulls are destroyed by it', () => {
  const state = isolated(4), pilot = state.players[0];
  pilot.guard = 0;
  const heavy = Object.assign(spawnEnemy(state, 8, pilot.x + 10, pilot.y - 20), { ai: 'fixture', vx: 0, vy: 0, noFire: true });
  const before = Math.hypot(pilot.x - heavy.x, pilot.y - heavy.y);
  update(state, 1 / 60, [{}]);
  assert(!heavy.dead, 'a heavy hull survives the ram');
  assert(Math.hypot(pilot.x - heavy.x, pilot.y - heavy.y) > before, 'the pilot is pushed away');
  // The hull sits up and to the right of the pilot.
  assert(pilot.blastVx < 0 && pilot.blastVy > 0, 'the shove points away from the hull');
  // The shove carries the pilot out of the hull before its hit immunity ends.
  for (let i = 0; i < 30; i++) update(state, 1 / 60, [{}]);
  assert(Math.hypot(pilot.x - heavy.x, pilot.y - heavy.y) >= pilot.radius + heavy.radius * .75, 'no longer overlapping');
  const light = isolated(), ship = light.players[0]; ship.guard = 0;
  const rammer = Object.assign(spawnEnemy(light, 1, ship.x, ship.y - 5), { ai: 'fixture', vx: 0, vy: 0, noFire: true });
  update(light, 1 / 60, [{}]);
  assert(rammer.dead && light.events.some(event => event.type === 'explosion' && event.cause === 'ram'));
});

check('explosions carry the momentum of the hull that died', () => {
  const state = isolated(), enemy = spawnEnemy(state, 2, 500, 300);
  Object.assign(enemy, { vx: 240, vy: -60, blastVx: 10, blastVy: 0 });
  killEnemy(state, enemy);
  const blast = state.events.find(event => event.type === 'explosion');
  assert.deepEqual([blast.vx, blast.vy], [250, -60]);
});

check('wing drones swing past their slot on a spring, settle, and keep their velocity through a save', () => {
  const state = isolated(), pilot = state.players[0];
  pilot.drones = 1;
  advance(state, 1.5);
  const slot = () => pilot.x - 50;
  assert(Math.abs(pilot.wing[0].x - slot()) < 1, 'a resting drone sits in its slot');
  advance(state, .6, [{ x: 1 }]);
  let overshoot = 0;
  for (let i = 0; i < 60; i++) { update(state, 1 / 60, [{}]); state.events.length = 0; overshoot = Math.max(overshoot, pilot.wing[0].x - slot()); }
  assert(overshoot > 2, `the drone swings past its slot (${overshoot})`);
  advance(state, 1.5);
  assert(Math.abs(pilot.wing[0].x - slot()) < 1 && Math.abs(pilot.wing[0].vx) < 5, 'and settles');
  pilot.wing[0].vx = 120; pilot.wing[0].vy = -30;
  const run = restoreRun(serializeRun(state));
  assert.deepEqual([run.state.players[0].wing[0].vx, run.state.players[0].wing[0].vy], [120, -30]);
});

if (failures) process.exitCode = 1;
else console.log('All combat system checks passed.');
