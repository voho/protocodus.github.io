import assert from 'node:assert/strict';
import { createCampaign, beginLevel, update, spawnEnemy, spawnFormation, resumeFromCheckpoint, sectorClearBonus, damageEnemy, hurtPlayer, killEnemy, shipStats, applyStructureBlast, BARRIER_RESPONSE, KINETIC_BLEED, SHIELD_BREAK_DELAY, SHIELD_COLLAPSE_RADIUS } from '../sim.js';
import { applyRole, addBarrier } from '../roles.js';
import { waveTactics } from '../tactics.js';
import { createDirector, checkpointWave } from '../waves.js';
import { OBJECTIVES, OBJECTIVE_KINDS, sectorObjectives, objectiveReward, sectorRank, RANK_BONUS } from '../objectives.js';
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

// Formations never spawn during a guardian fight; hold the director instead.
function formationArena(level = 0) {
  const state = createCampaign(level);
  state.director.hold = true;
  return state;
}
const membersOf = (state, formation) => state.enemies.filter(enemy => enemy.formation === formation && !enemy.dead);
const calm = state => { for (const enemy of state.enemies) Object.assign(enemy, { noFire: true, harmless: true }); };

check('ring survivors spread evenly around the anchor after losses', () => {
  const state = formationArena(), ring = spawnFormation(state, 'ring', 1, 0);
  calm(state); state.players[0].guard = 1e9;
  const members = membersOf(state, ring);
  assert.equal(members.length, 8);
  advance(state, 6);
  for (const index of [1, 2, 5, 6]) killEnemy(state, members[index]);
  advance(state, 1.5);
  const angles = membersOf(state, ring).map(enemy => Math.atan2(enemy.y - ring.y, enemy.x - ring.x)).sort((a, b) => a - b);
  assert.equal(angles.length, 4);
  for (let i = 0; i < 4; i++) {
    const gap = ((angles[(i + 1) % 4] - angles[i]) + Math.PI * 2) % (Math.PI * 2);
    assert(Math.abs(gap - Math.PI / 2) < .2, `even spacing (${gap.toFixed(3)})`);
  }
});

check('a broken line re-centres its survivors on the anchor', () => {
  const state = formationArena(), wall = spawnFormation(state, 'wall', 1, 0);
  calm(state); state.players[0].guard = 1e9;
  const members = membersOf(state, wall);
  advance(state, 6);
  for (const index of [0, 1, 2]) killEnemy(state, members[index]);
  advance(state, 1.5);
  const survivors = membersOf(state, wall), mean = survivors.reduce((sum, enemy) => sum + enemy.x, 0) / survivors.length;
  assert(Math.abs(mean - wall.x) < 10, `survivors centre on the anchor (${(mean - wall.x).toFixed(1)})`);
});

check('downing a leader breaks its formation: half dive, half scatter, and a bonus is paid', () => {
  for (const kind of ['escort', 'diamond', 'spear']) {
    const state = formationArena(2), formation = spawnFormation(state, kind);
    const members = membersOf(state, formation), leader = members.find(enemy => enemy.type === Math.max(...members.map(m => m.type)) && [0, 4].includes(enemy.formationIndex));
    const score = state.score;
    killEnemy(state, leader);
    const broken = state.events.find(event => event.type === 'formation-broken');
    assert(broken && broken.bonus > 0, `${kind} announces the break`);
    assert(state.score >= score + broken.bonus);
    const survivors = members.filter(enemy => enemy !== leader);
    assert(survivors.every(enemy => enemy.formation === null && enemy.formationIndex === undefined), 'survivors leave the formation');
    const divers = survivors.filter(enemy => enemy.ai === 'dive').length, fleeing = survivors.filter(enemy => enemy.ai === 'retreat').length;
    assert.equal(divers + fleeing, survivors.length);
    assert(Math.abs(divers - fleeing) <= 1, `${kind}: ${divers} dive, ${fleeing} scatter`);
    update(state, 1 / 60, [{}]);
    assert(!state.formations.includes(formation), 'the broken group releases its slot');
    // A follower's death never breaks the group.
    const intact = formationArena(2), group = spawnFormation(intact, kind);
    killEnemy(intact, membersOf(intact, group).find(enemy => enemy.formationIndex === 1));
    assert(!intact.events.some(event => event.type === 'formation-broken'));
  }
});

check('tactical formations fire a rippled salvo at their combined rate, and keep it through a save', () => {
  const state = createCampaign(3), formation = spawnFormation(state, null, 1, 0);
  const members = membersOf(state, formation);
  assert(Number.isFinite(formation.salvo) && formation.salvo > .5);
  members.forEach((enemy, index) => assert(Math.abs(enemy.fire - (1.2 + index * .12)) < 1e-9, 'members ripple in order'));
  const run = restoreRun(serializeRun(state));
  assert.equal(run.state.formations.find(entry => entry.id === formation.id).salvo, formation.salvo);
  // Members fire in their ripple order once the group has entered.
  state.players[0].guard = 1e9;
  const order = [];
  for (let i = 0; i < 60 * 12 && order.length < members.length; i++) {
    const before = members.map(enemy => enemy.fire);
    update(state, 1 / 60, [{}]); state.events.length = 0;
    members.forEach((enemy, index) => { if (!enemy.dead && enemy.fire > before[index] + .3 && !order.includes(index)) order.push(index); });
  }
  assert(order.length >= 3, `the salvo fires (${order})`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), `in ripple order (${order})`);
});

check('every sector draws two distinct, salted objectives with at most one judged at the clear', () => {
  const kinds = new Set();
  for (let level = 0; level < 30; level++) for (const salt of [0, 7, 991]) {
    const director = createDirector(level, salt), objectives = director.objectives;
    assert.deepEqual(objectives, createDirector(level, salt).objectives, 'deterministic');
    assert.equal(objectives.length, 2);
    assert.notEqual(objectives[0].kind, objectives[1].kind);
    assert(objectives.filter(objective => OBJECTIVES[objective.kind].final).length <= 1);
    if (level === 0) assert(objectives.every(objective => ['squads', 'demolition', 'dives'].includes(objective.kind)), 'the opening sector teaches gently');
    if (objectives.some(objective => objective.kind === 'ace')) assert(director.encounters.some(encounter => encounter.kind === 'ace'), 'ace goals need an ace');
    for (const objective of objectives) { kinds.add(objective.kind); assert(objective.target >= 1 && !objective.done); }
  }
  assert.deepEqual([...kinds].sort(), [...OBJECTIVE_KINDS].sort(), 'every objective appears somewhere');
  const differs = Array.from({ length: 10 }, (_, level) => JSON.stringify(sectorObjectives(level + 1, createDirector(level + 1, 1).plan, [], 1)) !== JSON.stringify(sectorObjectives(level + 1, createDirector(level + 1, 2).plan, [], 2)));
  assert(differs.some(Boolean), 'salts vary the goals');
});

check('progress objectives pay once when met; flight-long goals are judged at the clear', () => {
  const state = isolated(3);
  state.director.objectives = [{ kind: 'squads', target: 2, done: false }, { kind: 'survivor', target: 1, done: false }];
  const reward = objectiveReward(3), credits = state.credits;
  state.stats.squads = 2;
  update(state, 1 / 60, [{}]);
  assert(state.director.objectives[0].done && state.events.filter(event => event.type === 'objective').length === 1);
  assert.equal(state.credits, credits + reward.credits);
  state.events.length = 0; update(state, 1 / 60, [{}]);
  assert(!state.events.some(event => event.type === 'objective'), 'never paid twice');
  assert(!state.director.objectives[1].done, 'flight-long goals wait for the clear');
  killEnemy(state, spawnEnemy(state, 9, 600, 155));
  const events = [];
  for (let i = 0; i < 60 * 4 && state.status === 'playing'; i++) { update(state, 1 / 60, [{}]); events.push(...state.events); state.events.length = 0; }
  assert.equal(state.status, 'hangar');
  assert(state.director.objectives[1].done, 'no ship lost: survivor met');
  const clear = events.find(event => event.type === 'hangar');
  assert.equal(clear.rank, sectorRank(state).grade);
  assert.equal(clear.bonus, sectorClearBonus(3) + Math.round(sectorClearBonus(3) * RANK_BONUS[clear.rank]));
  // A lost ship misses the survivor goal.
  const lossy = isolated(3);
  lossy.director.objectives = [{ kind: 'survivor', target: 1, done: false }];
  lossy.stats.lost = 1;
  killEnemy(lossy, spawnEnemy(lossy, 9, 600, 155));
  for (let i = 0; i < 60 * 4 && lossy.status === 'playing'; i++) { update(lossy, 1 / 60, [{}]); lossy.events.length = 0; }
  assert(!lossy.director.objectives[0].done);
});

check('sector ranks reward objectives, accuracy and clean flying', () => {
  const graded = (stats, done) => sectorRank({ stats, director: { objectives: [{ done }, { done }] } }).grade;
  assert.equal(graded({ shots: 100, hits: 60, lost: 0, hullHits: 0 }, true), 'S');
  assert.equal(graded({ shots: 100, hits: 40, lost: 1, hullHits: 2 }, true), 'A');
  assert.equal(graded({ shots: 100, hits: 10, lost: 3, hullHits: 9 }, false), 'D');
  assert(RANK_BONUS.S > RANK_BONUS.A && RANK_BONUS.A > RANK_BONUS.B && RANK_BONUS.D === 0);
});

check('the middle wave marks a checkpoint that a lost flight resumes from', () => {
  const state = createCampaign(2), d = state.director, middle = checkpointWave(d.plan);
  Object.assign(d, { wave: middle - 1, state: 'rest', clock: 0, rest: 0 });
  state.time = 61; state.scroll = 4321; state.stats.squads = 3; state.stats.lost = 1;
  update(state, 1 / 60, [{}]);
  const marked = state.events.find(event => event.type === 'checkpoint');
  assert(marked && state.checkpoint.wave === middle);
  assert.equal(state.checkpoint.stats.squads, 3);
  const run = restoreRun(serializeRun(state));
  assert.deepEqual(run.state.checkpoint, state.checkpoint, 'the checkpoint survives a save');
  // A later defeat retries from here; goals already paid stay paid.
  state.director.objectives[0].done = true;
  const retry = createCampaign(2, state); retry.width = state.width; beginLevel(retry, 2);
  resumeFromCheckpoint(retry, state.checkpoint, state.director.objectives);
  assert.equal(retry.director.wave, middle - 1); assert.equal(retry.director.state, 'rest');
  assert.equal(retry.time, state.checkpoint.time); assert.equal(retry.scroll, state.checkpoint.scroll);
  assert.equal(retry.stats.squads, 3);
  assert(retry.director.objectives[0].done && !retry.director.objectives[1].done);
  assert(retry.director.encounters.every(encounter => encounter.wave >= middle || encounter.done), 'earlier encounters stay flown');
  update(retry, 1 / 60, [{}]); for (let i = 0; i < 200 && retry.director.wave < middle; i++) update(retry, 1 / 60, [{}]);
  assert.equal(retry.director.wave, middle, 'the resumed flight starts with the checkpoint wave');
  assert(!retry.events.some(event => event.type === 'checkpoint'), 'resuming does not announce the checkpoint again');
  assert(!createCampaign(3).checkpoint, 'a new sector starts without a checkpoint');
});

check('a battered pilot gets a longer breather between waves', () => {
  const rest = hull => {
    const state = createCampaign(1), d = state.director;
    Object.assign(d, { wave: 0, kind: 'sweep', state: 'wave', clock: 5, timeout: 99, pending: 0 });
    state.players[0].hull = state.players[0].maxHull * hull;
    update(state, 1 / 60, [{}]);
    return d.rest;
  };
  assert.equal(rest(1), 1.5);
  assert(rest(.2) > 2.5 && rest(.2) <= 3.9);
});

check('older saves adopt their sector objectives and flights without checkpoints stay valid', () => {
  const state = createCampaign(5), source = JSON.parse(serializeRun(state));
  delete source.state.director.objectives; delete source.state.checkpoint;
  const run = restoreRun(source);
  assert.deepEqual(run.state.director.objectives, createDirector(5, state.salt).objectives);
  assert.equal(run.state.checkpoint, null);
  const corrupt = JSON.parse(serializeRun(state)); corrupt.state.director.objectives = [{ kind: 'pacifist', target: 1, done: false }];
  assert.equal(restoreRun(corrupt), null);
});

if (failures) process.exitCode = 1;
else console.log('All combat system checks passed.');
