import assert from 'node:assert/strict';
import { SECTOR_TACTICS, waveTactics } from '../tactics.js';
import { createCampaign, spawnEnemy, spawnFormation, update, FORMATIONS } from '../sim.js';
import { sectorPlan, updateDirector, hiveSlot, PATHS } from '../waves.js';
import { ENEMY_TYPES } from '../ships.js';
import { combatTier, cycleScale } from '../campaign.js';

const seeded = (seed, run) => {
  const original = Math.random;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  try { return run(); } finally { Math.random = original; }
};
const observed = { classes: new Set(), paths: new Set(), mirrors: new Set(), speeds: new Set(), armor: new Set(), fire: new Set(),
  shapes: new Set(), formations: new Set(), entries: new Set(), compositions: new Set(), roles: new Set() };
// Specialist roles scale a hull once, on top of the authored tactic armor.
const ROLE_ARMOR = { elite: 1.6, ace: 2.4, convoy: .7 };

assert.equal(SECTOR_TACTICS.length, 10, 'Every environment has an authored strategy');
const plans = Array.from({ length: 10 }, (_, level) => sectorPlan(level));
assert.equal(new Set(plans.map(JSON.stringify)).size, 10, 'The first circuit has ten distinct wave orders');
assert.equal(plans[0][0], 'hive', 'The first flight retains its familiar swarm opening');

// Tactical selection must not consume the simulation RNG: rendering, saves and
// unrelated enemy deaths cannot change the next authored flight arrangement.
const originalRandom = Math.random;
try {
  Math.random = () => { throw Error('Tactical selection consumed the combat RNG'); };
  for (const level of [...Array(30).keys(), 10000, Number.MAX_SAFE_INTEGER]) {
    const plan = sectorPlan(level);
    assert(plan.length >= 8 && plan.length <= 10, 'Wave density remains bounded in endless cycles');
    for (let wave = 0; wave < plan.length; wave++) {
      const first = waveTactics(level, wave);
      assert.deepEqual(waveTactics(level, wave), first, 'Repeated selection is deterministic');
      assert(first && typeof first === 'object');
      assert(first.armor >= .85 && first.armor <= 1.2);
      assert(first.speed >= .84 && first.speed <= 1.2);
      assert(first.fire >= .5 && first.fire <= 2);
      assert.notEqual(first.formationKinds[0], first.formationKinds[1], 'Returning formations retain different groups');
    }
  }
  for (let level = 0; level < 10; level++) {
    assert.notDeepEqual(waveTactics(level + 10, 0), waveTactics(level, 0), 'A returning environment changes its opening tactics');
  }
} finally { Math.random = originalRandom; }

// Exercise the real director and both scheduled formation groups, not merely
// the exported tables. Preserve actual hull stats and all squad membership.
for (const level of [...Array(10).keys(), 10, 20, 10000, Number.MAX_SAFE_INTEGER]) seeded(0x54595241 + level, () => {
  const state = createCampaign(level); state.width = 1600; state.height = 900;
  for (let wave = 0; wave < state.director.plan.length; wave++) {
    const tactics = waveTactics(level, wave);
    state.enemies.length = state.formations.length = state.squadrons.length = state.events.length = 0;
    Object.assign(state.director, { state: 'rest', clock: 0 });
    updateDirector(state, 3, spawnEnemy, spawnFormation, state.players[0]);
    assert.equal(state.director.wave, wave);
    assert(state.enemies.length > 0 && state.enemies.length <= 28, 'Each wave has a bounded initial allocation');
    assert(state.director.timeout > 0 && state.director.timeout <= 44);
    if (state.director.pending) updateDirector(state, state.director.pendingAt + .01, spawnEnemy, spawnFormation, state.players[0]);
    assert(state.enemies.length <= 28, 'A delayed formation group does not inflate wave density');
    if (state.director.kind === 'formation') {
      assert.equal(state.formations.length, 2, 'Both tactical groups actually launch');
      assert.notEqual(state.formations[0].kind, state.formations[1].kind, 'A tactical wave combines different formations');
    }
    const composition = Array.from({ length: 9 }, (_, type) => state.enemies.filter(enemy => enemy.type === type).length);
    if (level < 10) observed.compositions.add(composition.join(','));
    for (const enemy of state.enemies) {
      assert([enemy.x, enemy.y, enemy.hp, enemy.maxHp, enemy.speed].every(Number.isFinite));
      assert(enemy.hp > 0 && enemy.hp === enemy.maxHp);
      const reinforcement = (enemy.role === 'midboss' ? 4 : enemy.ai === 'station' && [4, 5].includes(enemy.type) ? 1.6 : 1) * (ROLE_ARMOR[enemy.role] || 1);
      const baseHp = ENEMY_TYPES[enemy.type].hp * (1 + combatTier(level) * .24) * cycleScale(level, .22) * reinforcement;
      assert(Math.abs(enemy.maxHp / baseHp - tactics.armor) < 1e-12, 'Authored armor applies exactly once to each real hull');
      assert(Math.abs(enemy.speed / ENEMY_TYPES[enemy.type].speed - tactics.speed) < 1e-12, 'Hull movement uses the authored speed tradeoff');
      if (enemy.path) assert(PATHS[enemy.path], 'Every launched path exists');
      if (enemy.pathSpeed != null) assert(enemy.pathSpeed > 0 && enemy.pathSpeed <= 650, 'Path speed stays bounded');
      for (const key of ['tacticSpeed', 'tacticFire']) if (enemy[key] != null) assert(enemy[key] >= .5 && enemy[key] <= 2);
      if (level < 10) {
        observed.classes.add(enemy.type);
        if (enemy.path) { observed.paths.add(enemy.path); observed.mirrors.add(enemy.mirror); }
        if (enemy.tacticSpeed != null) observed.speeds.add(enemy.tacticSpeed);
        observed.armor.add(Number((enemy.maxHp / baseHp).toFixed(8)));
        if (enemy.tacticFire != null) observed.fire.add(enemy.tacticFire);
        if (enemy.hiveShape) observed.shapes.add(enemy.hiveShape);
        if (enemy.role) observed.roles.add(enemy.role);
        if (enemy.formation) { observed.formations.add(enemy.formation.kind); observed.entries.add(enemy.formation.entry || 'top'); }
      }
    }
  }
});
assert.deepEqual([...observed.classes].sort((a, b) => a - b), [...Array(9).keys()], 'All nine normal hull classes participate');
assert(observed.paths.size >= 8, 'The first circuit uses visibly different flight paths');
assert.deepEqual([...observed.mirrors].sort(), [-1, 1], 'Flights approach in both directions');
assert(observed.speeds.size >= 4 && observed.fire.size >= 4, 'Actual enemies receive several speed and firing tradeoffs');
assert(Math.min(...observed.armor) < 1 && Math.max(...observed.armor) > 1, 'Actual flights include both lighter and reinforced hulls');
assert.deepEqual([...observed.shapes].sort(), ['chevron', 'diamond', 'orbit', 'ranks', 'split', 'stagger']);
assert.deepEqual([...observed.formations].sort(), [...FORMATIONS].sort(), 'Normal scripted waves use every formation kind');
assert.deepEqual([...observed.entries].sort(), ['left', 'right', 'top'], 'Formations enter from three directions');
assert(observed.compositions.size >= 12, 'Class mixes vary across the authored circuit');
console.log(`roles in the authored circuit: ${[...observed.roles].sort().join(', ')}`);

// Sample actual normal hive waves through a full breathing/rotation interval.
// Diamond ranks must not compress heavy hulls, and orbit rings must retain
// physical clearance rather than intersecting when fitted to a narrow arena.
let separatedHives = 0;
for (const [level, profile] of SECTOR_TACTICS.entries()) {
  if (!['diamond', 'orbit'].includes(profile.shape)) continue;
  for (const width of [320, 430, 600, 1200]) for (const [wave, kind] of sectorPlan(level).entries()) {
    if (kind !== 'hive') continue;
    const state = createCampaign(level); state.width = width; state.height = 900;
    state.director.wave = wave - 1;
    updateDirector(state, 3, spawnEnemy, spawnFormation, state.players[0]);
    assert.equal(state.director.kind, 'hive');
    assert(state.enemies.length > 1 && state.enemies.every(enemy => enemy.slotCount && enemy.hiveShape === profile.shape));
    for (let sample = 0; sample <= 120; sample++) {
      state.hive.age = sample / 4;
      const goals = state.enemies.map(enemy => hiveSlot(state, enemy));
      const context = `${profile.shape} sector ${level + 1}, wave ${wave + 1}, width ${width}, age ${state.hive.age}`;
      for (let i = 0; i < goals.length; i++) {
        const goal = goals[i], enemy = state.enemies[i];
        assert(goal.x >= enemy.radius && goal.x <= width - enemy.radius, `Whole hive hull stays inside the arena: ${context}`);
        assert(goal.y > 70 && goal.y + enemy.radius < state.height * .6 && goal.y >= enemy.radius,
          `Hive hull stays in the upper field and leaves the pilot lane clear: ${context}`);
        for (let j = i + 1; j < goals.length; j++) {
          const distance = Math.hypot(goal.x - goals[j].x, goal.y - goals[j].y);
          assert(distance + 1e-6 >= enemy.radius + state.enemies[j].radius,
            `Hive hulls ${i}/${j} retain physical clearance: ${context}`);
        }
      }
    }
    separatedHives++;
  }
}
assert(separatedHives >= 12, 'Both shapes are checked in real waves at every narrow and wide size');

// No-fire timelines exercise entry, station, dives, retreat and the director's
// timeout route. Invulnerability is confined to this choreography/bounds check;
// this is not a win-rate or difficulty calibration.
const timelines = [];
for (const [level, width] of [...Array.from({ length: 10 }, (_, level) => [level, 1600]), [0, 430], [9, 430], [0, 3200], [9, 3200]]) seeded(0x54595241 + level, () => {
  const state = createCampaign(level); state.width = width; state.height = 900; state.players[0].hurt = Infinity;
  let peakEnemies = 0, peakBullets = 0, ticks = 0;
  const waveKinds = [];
  for (; ticks < 600 * 60 && !state.bossSpawned; ticks++) {
    update(state, 1 / 60);
    peakEnemies = Math.max(peakEnemies, state.enemies.length);
    peakBullets = Math.max(peakBullets, state.bullets.filter(bullet => bullet.team < 0).length);
    assert(peakBullets <= 78, 'Tactics retain the global hostile projectile budget');
    assert(peakEnemies <= 56, 'Departing survivors cannot accumulate beyond two full wave allocations');
    for (const enemy of state.enemies) {
      assert([enemy.x, enemy.y, enemy.vx, enemy.vy].every(Number.isFinite), `Finite movement at width ${width}`);
      assert(Math.abs(enemy.x) < width * 3 + 3000 && Math.abs(enemy.y) < 5000, 'Entry and departure remain within a bounded simulation region');
      if (enemy.ai === 'hive') {
        const slot = hiveSlot(state, enemy);
        assert(slot.x >= enemy.radius && slot.x <= width - enemy.radius, 'Hive goals keep the whole ship inside the arena');
        assert(slot.y > 70 && slot.y < state.height * .6, 'Hive goals leave the pilot lane clear');
      }
    }
    waveKinds.push(...state.events.filter(event => event.type === 'wave').map(event => event.kind));
    state.events.length = 0;
  }
  assert(state.bossSpawned, `Sector ${level + 1} at width ${width} completes its script without stalled survivors`);
  assert.deepEqual(waveKinds, sectorPlan(level), 'The runtime follows every authored wave exactly once');
  timelines.push({ sector: level + 1, width, seconds: Math.round(ticks / 60), peakEnemies, peakBullets });
});
console.log('PASS authored tactics: deterministic circuit/cycle variety, actual hull/path/hive/formation diversity, bounded allocations and 60 Hz narrow/wide flight timelines.');
console.log(JSON.stringify({ variety: Object.fromEntries(Object.entries(observed).map(([key, values]) => [key, values.size])), separatedHives, timelines }));
