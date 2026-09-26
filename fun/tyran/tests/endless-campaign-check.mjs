import assert from 'node:assert/strict';
import { normalizeLevel, environmentIndex, campaignCycle } from '../campaign.js';
import { ENEMY_TYPES } from '../ships.js';
import { createCampaign, beginLevel, spawnEnemy, spawnFormation, killEnemy, update, challengeSector, missionScrollSpeed, sectorDuration, nextLifeAfterScore, FIRST_EXTRA_LIFE, EXTRA_LIFE_STEP } from '../sim.js';
import { createDirector, updateDirector, startDive, startChallenge, CHALLENGE_SIZE } from '../waves.js';

const advance = (state, seconds) => {
  for (let t = 0; t < seconds; t += .025) { update(state, .025); state.events.length = 0; }
};
const isolated = level => {
  const state = createCampaign(level);
  state.director.hold = true;
  state.players[0].guard = 1e6;
  return state;
};

for (const value of [-1, 1.5, NaN, Infinity, '10', null, Number.MAX_SAFE_INTEGER + 1]) assert.equal(normalizeLevel(value), 0);
for (const level of [0, 9, 10, 19, 20, 99999, Number.MAX_SAFE_INTEGER]) {
  assert.equal(createCampaign(level).level, level);
  assert.equal(environmentIndex(level), level % 10);
  assert.equal(campaignCycle(level), Math.floor(level / 10));
}

// Long-run totals survive retry without old finite-campaign ceilings.
const high = createCampaign(200);
Object.assign(high, { credits: 123456789, score: 2345678910, totalKills: 12345678, nextLife: 2345679000 });
const retry = createCampaign(high.level, high);
for (const key of ['level', 'credits', 'score', 'totalKills', 'nextLife']) assert.equal(retry[key], high[key]);
assert.equal(nextLifeAfterScore(FIRST_EXTRA_LIFE), FIRST_EXTRA_LIFE + EXTRA_LIFE_STEP);
assert.equal(nextLifeAfterScore(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
const ceiling = isolated(200);
ceiling.score = Number.MAX_SAFE_INTEGER;
update(ceiling, .025);
assert.equal(ceiling.nextLife, Number.MAX_SAFE_INTEGER);
assert(ceiling.events.filter(event => event.type === 'extra-life').length <= 6, 'milestone catch-up has bounded work');
const caughtUpCredits = ceiling.credits; update(ceiling, .025);
assert.equal(ceiling.credits, caughtUpCredits, 'numeric ceiling never repeats milestone rewards');

// Crossing either circuit boundary offers a real shop and retains progression.
for (const last of [9, 19]) {
  const state = isolated(last);
  state.upgrades.weapon = 3; state.players[0].power = 4; state.players[0].drones = 2;
  state.primary = 'lance'; state.owned.push('lance');
  killEnemy(state, spawnEnemy(state, 9, 600, 155));
  advance(state, 3.5);
  assert.equal(state.status, 'hangar');
  const credits = state.credits, score = state.score, lives = state.lives;
  advance(state, 5);
  assert.equal(state.credits, credits, 'sector reward is paid only once');
  beginLevel(state, last + 1);
  assert.equal(state.status, 'playing'); assert.equal(state.level, last + 1);
  assert.equal(environmentIndex(state.level), 0);
  assert.equal(state.upgrades.weapon, 3); assert.equal(state.primary, 'lance');
  assert.equal(state.players[0].power, 4); assert.equal(state.players[0].drones, 2);
  assert.equal(state.credits, credits); assert.equal(state.score, score); assert.equal(state.lives, lives);
}

// Challenge flights continue every other sector after the first circuit.
for (const level of [10, 20, 100]) {
  const state = isolated(level);
  assert(challengeSector(state)); assert(!challengeSector({ level: level + 1 }));
  killEnemy(state, spawnEnemy(state, 9, 600, 155));
  advance(state, 3.5);
  assert.equal(state.status, 'playing'); assert.equal(state.challenge.total, CHALLENGE_SIZE);
  for (const enemy of state.enemies) if (enemy.challenge) killEnemy(state, enemy);
  advance(state, 5.3);
  assert.equal(state.status, 'hangar');
  assert(Number.isSafeInteger(state.credits) && Number.isSafeInteger(state.score));
  assert(Number.isSafeInteger(state.challenge.credits), 'challenge rewards remain integer through every cycle');
}

// Keep authored balance in the first circuit; returning fleets grow stronger.
for (let level = 0; level < 10; level++) for (let type = 0; type < 10; type++) {
  const enemy = spawnEnemy(isolated(level), type, 300, 180), boss = type === 9;
  assert.equal(enemy.hp, ENEMY_TYPES[type].hp * (1 + level * (boss ? .08 : .24)) * (boss ? 1.8 : 1));
}
let previous;
for (const level of [9, 10, 20, 100, 10000, Number.MAX_SAFE_INTEGER]) {
  const state = isolated(level), enemy = spawnEnemy(state, 9, 600, 180);
  enemy.fire = 0; enemy.phase = 2; enemy.hp = enemy.maxHp * .2;
  update(state, .025);
  const bullet = state.bullets.find(round => round.team < 0);
  assert(bullet); assert(Number.isFinite(enemy.maxHp) && enemy.maxHp < 1e7);
  assert(Number.isFinite(bullet.damage) && bullet.damage < 1e6);
  const speed = Math.hypot(bullet.vx, bullet.vy), fire = enemy.fire;
  const credits = state.credits, score = state.score;
  killEnemy(state, enemy);
  const result = { hp: enemy.maxHp, damage: bullet.damage, reward: state.credits - credits, score: state.score - score, speed, fire };
  if (previous) {
    assert(result.hp > previous.hp); assert(result.damage > previous.damage);
    assert(result.reward > previous.reward); assert(result.score > previous.score);
    assert.equal(result.speed, previous.speed, 'projectiles remain dodgeable');
    assert.equal(result.fire, previous.fire, 'shot frequency never grows without bound');
  }
  previous = result;
}

// Extreme sector indices cannot inflate waves, flight times, or scrolling.
for (const level of [9, 10, 19, 20, 10000, Number.MAX_SAFE_INTEGER]) {
  const state = isolated(level); state.director = createDirector(level);
  assert(state.director.plan.length <= 10);
  assert.equal(sectorDuration(level), 194);
  assert(missionScrollSpeed(state, state.duration * 2) <= 208.25);
  for (let wave = 0; wave < state.director.plan.length; wave++) {
    state.enemies.length = 0; state.formations.length = 0; state.squadrons.length = 0;
    state.director.state = 'rest'; state.director.clock = 0;
    updateDirector(state, 3, spawnEnemy, spawnFormation, state.players[0]);
    assert.equal(state.director.wave, wave); assert(state.enemies.length <= 28);
    assert(state.director.timeout <= 44);
    for (const enemy of state.enemies) {
      if (enemy.pathSpeed != null) assert(enemy.pathSpeed <= 518);
      if (enemy.hold != null) assert(enemy.hold <= 40);
      assert(Number.isFinite(enemy.hp));
    }
  }
  const diver = spawnEnemy(state, 0, 300, 200);
  startDive(state, diver, state.players[0]);
  assert.equal(diver.diveSpeed, 349);
  state.enemies.length = 0;
  startChallenge(state, spawnEnemy);
  assert.equal(state.enemies.length, CHALLENGE_SIZE);
  assert(state.enemies.every(enemy => enemy.pathSpeed <= 474 && enemy.harmless && enemy.noFire));
}

// Sustained high-cycle combat retains the existing global hostile round limit.
const stress = isolated(1000000);
for (let type = 0; type < 10; type++) {
  const enemy = spawnEnemy(stress, type, 150 + type * 85, 180);
  enemy.ai = 'station'; enemy.stationX = enemy.x; enemy.stationY = 180; enemy.hold = 100; enemy.fire = 0;
}
for (let tick = 0; tick < 60 * 60; tick++) {
  update(stress, 1 / 60); stress.events.length = 0;
  assert(stress.bullets.filter(round => round.team < 0).length <= 78);
  assert(stress.enemies.length < 40);
}
console.log('Endless campaign checks passed: circuit transitions, repeated challenges, preserved upgrades, increasing power/rewards, and bounded extreme-sector combat.');
