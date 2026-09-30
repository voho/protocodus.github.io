import assert from 'node:assert/strict';
import { ENCOUNTER_KINDS, ENCOUNTER_BUDGET, ENCOUNTER_BRIEFS, ACE_NAMES, BUSY_WAVES, sectorEncounters, encounterShips, encounterSummary } from '../encounters.js';
import { FORMATION_KINDS, tacticalPlan, waveTactics } from '../tactics.js';
import { sectorPlan, updateDirector, ENCOUNTER_WAVE, isDormant, PATHS } from '../waves.js';
import { createCampaign, beginLevel, update, spawnEnemy, spawnFormation, killEnemy, damageEnemy, missionScrollSpeed, FORMATIONS, freshSalt, MAX_BOMBS } from '../sim.js';
import { ROLES, HAZARD_ROLES, applyRole, PHANTOM_CYCLE, PHANTOM_VISIBLE, MINE_LIFETIME, roleScoreScale } from '../roles.js';
import { serializeRun, restoreRun } from '../save-game.js';
import { ENEMY_TYPES } from '../ships.js';

// Run with: node fun/tyran/tests/encounters-check.mjs
// Replay variety: campaign salts, the six newer formations, specialist roles
// and scheduled encounters, plus their save round trips.
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
function isolated(level = 0, salt = 0) {
  const state = createCampaign(level, null, 'easy', salt);
  state.bossSpawned = true;
  state.players[0].hull = state.players[0].maxHull = 1e9;
  return state;
}
function advance(state, seconds, controls = [{}], onTick = null) {
  for (let t = 0; t < seconds - 1e-8; t += 1 / 60) { update(state, 1 / 60, controls); onTick?.(state); state.events.length = 0; }
}
const roleFields = enemy => Object.fromEntries(['role', 'shieldMax', 'shieldHp', 'shieldHit', 'cloak', 'cloaked', 'healClock', 'dropTimer', 'mineBudget', 'driftX', 'spinRate', 'variant', 'aceName', 'meteorWorld', 'wave', 'harmless', 'noFire']
  .filter(key => enemy[key] !== undefined).map(key => [key, enemy[key]]));

check('encounter schedules are deterministic, bounded, calm at first, and vary with the campaign salt', () => {
  const salts = [0, 1, 0x9e3779b1, 4294967295], kinds = new Set();
  let varied = 0;
  for (const level of [...Array(30).keys(), 10000, Number.MAX_SAFE_INTEGER]) {
    const schedules = salts.map(salt => sectorEncounters(level, sectorPlan(level, salt), salt));
    salts.forEach((salt, i) => {
      const plan = sectorPlan(level, salt), schedule = schedules[i];
      assert.deepEqual(sectorEncounters(level, plan, salt), schedule, 'the same campaign draws the same schedule');
      assert(schedule.length >= 1 && schedule.length <= 3, 'one to three encounters per sector');
      const waves = schedule.map(entry => entry.wave);
      assert.deepEqual(waves, [...waves].sort((a, b) => a - b));
      for (let j = 1; j < waves.length; j++) assert(waves[j] - waves[j - 1] >= 2, 'encounters keep a full wave between them');
      for (const entry of schedule) {
        assert(ENCOUNTER_KINDS.includes(entry.kind));
        assert(entry.wave >= 1 && entry.wave < plan.length && !BUSY_WAVES.has(plan[entry.wave]), 'cruiser and captor waves stay clear');
        assert(entry.time >= 1.2 && entry.time <= 11 && entry.size >= 0 && entry.size <= 2 && entry.done === false);
        assert(encounterShips(entry.kind, entry.size) >= 1 && encounterShips(entry.kind, entry.size) <= 12);
        if (level === 0) assert(['convoy', 'bonusFlight'].includes(entry.kind) && entry.wave >= 2, 'the first sector only offers calm opportunities after the basics');
        kinds.add(entry.kind);
      }
    });
    if (new Set(schedules.map(JSON.stringify)).size > 1) varied++;
  }
  assert(varied >= 24, `most sectors draw different encounters for different campaigns (${varied})`);
  assert.deepEqual([...kinds].sort(), [...ENCOUNTER_KINDS].sort(), 'every encounter kind is scheduled somewhere');
  for (const kind of ENCOUNTER_KINDS) assert(ENCOUNTER_BRIEFS[kind]?.title && ENCOUNTER_BRIEFS[kind].label, `${kind} has a briefing`);
  assert.equal(new Set(ACE_NAMES).size, ACE_NAMES.length);
  assert.equal(encounterSummary({ aces: 1, convoys: 2, hazards: 0 }), '1 ace downed · 2 cargo haulers plundered');
  assert.equal(encounterSummary({}), '');
});

check('campaign salts reorder later sectors, keep the opening sector, and stay deterministic', () => {
  for (const salt of [1, 77, 0xdeadbeef]) {
    assert.deepEqual(tacticalPlan(0, salt), tacticalPlan(0, 0), 'the first sector keeps its teaching order');
    let reordered = 0, alternatives = 0;
    for (let level = 1; level < 30; level++) {
      const reference = tacticalPlan(level, 0), salted = tacticalPlan(level, salt);
      assert.deepEqual(tacticalPlan(level, salt), salted);
      assert.deepEqual([...salted].sort(), [...reference].sort(), 'a salted plan is a permutation of the authored roles');
      if (JSON.stringify(salted) !== JSON.stringify(reference)) reordered++;
      for (let wave = 0; wave < salted.length; wave++) {
        const tactics = waveTactics(level, wave, salt);
        assert.deepEqual(waveTactics(level, wave, salt), tactics);
        assert(FORMATION_KINDS.includes(tactics.formationKinds[0]) && FORMATION_KINDS.includes(tactics.formationKinds[1]));
        assert.notEqual(tactics.formationKinds[0], tactics.formationKinds[1]);
        assert(tactics.armor >= .85 && tactics.armor <= 1.2 && tactics.speed >= .84 && tactics.speed <= 1.2);
        if (JSON.stringify(tactics.formationKinds) !== JSON.stringify(waveTactics(level, wave, 0).formationKinds)) alternatives++;
      }
    }
    assert(reordered >= 20, `salt ${salt} reorders most later sectors (${reordered})`);
    assert(alternatives >= 10, `salt ${salt} swaps formation pairs in some waves (${alternatives})`);
  }
  for (let level = 0; level < 3; level++) for (let wave = 0; wave < 10; wave++) for (const salt of [0, 5, 99]) {
    const tactics = waveTactics(level, wave, salt);
    assert(!tactics.eliteLeader && !tactics.shieldedHeavies && !tactics.splitterRow, 'roles wait until the campaign has taught the basics');
  }
  const salts = new Set(Array.from({ length: 50 }, freshSalt));
  assert(salts.size >= 45 && [...salts].every(salt => Number.isInteger(salt) && salt >= 0 && salt <= 4294967295));
  assert.equal(createCampaign(3, null, 'easy', 123).salt, 123);
  assert.equal(createCampaign(3, { salt: 9, difficulty: 'easy' }, 'easy', 123).salt, 9, 'retries keep their campaign salt');
  const carried = createCampaign(2, null, 'easy', 55); beginLevel(carried, 3);
  assert.equal(carried.salt, 55); assert.deepEqual(carried.director.plan, tacticalPlan(3, 55));
  assert.deepEqual(carried.director.encounters, sectorEncounters(3, carried.director.plan, 55));
});

const TURNING = new Set(['orbit', 'diamond', 'ring', 'helix']);
check('every formation kind fits narrow and wide arenas, keeps hull clearance, and departs', () => {
  assert.deepEqual([...FORMATIONS].sort(), [...FORMATION_KINDS].sort());
  for (const kind of FORMATIONS) for (const width of [320, 600, 1200]) seeded(kind.length * 31 + width, () => {
    const state = createCampaign(6); state.width = width; state.height = 900; state.time = 80;
    const formation = spawnFormation(state, kind);
    assert(formation, `${kind} spawns at width ${width}`);
    state.bossSpawned = true; state.players[0].hull = state.players[0].maxHull = 1e9;
    const members = state.enemies.filter(enemy => enemy.formation === formation);
    assert(members.length >= 3 && members.length === formation.offsets.length, `${kind} fills its offsets`);
    for (const offset of formation.offsets) assert(Number.isFinite(offset.x) && Number.isFinite(offset.y));
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
      const a = members[i].formationOffset, b = members[j].formationOffset, distance = Math.hypot(a.x - b.x, a.y - b.y);
      assert(distance > 1, `${kind} hulls ${i}/${j} never share a slot at width ${width}`);
      // Turning shapes grow their circle for heavy hulls once the arena allows it; line shapes keep their authored spacing.
      if (TURNING.has(kind) && width >= 600) assert(distance + 1e-6 >= members[i].radius + members[j].radius, `${kind} hulls ${i}/${j} keep clearance at width ${width}`);
    }
    state.players[0].hurt = Infinity;
    for (const enemy of state.enemies) enemy.fire = Infinity;
    let inside = 0, samples = 0;
    advance(state, 30, [{}], s => {
      for (const enemy of s.enemies) {
        assert(Number.isFinite(enemy.x) && Number.isFinite(enemy.y), `${kind} stays finite`);
        if (enemy.formation && enemy.y > 0 && enemy.y < s.height) { samples++; if (enemy.x >= 0 && enemy.x <= s.width) inside++; }
      }
    });
    assert(samples > 0 && inside / samples > .9, `${kind} flies inside a ${width}-wide arena (${inside}/${samples})`);
    advance(state, 25);
    assert.equal(state.formations.length, 0, `${kind} releases its formation slot`);
    assert.equal(state.enemies.length, 0, `${kind} hulls leave the viewport`);
  });
});

check('shields absorb damage and recharge, phantoms cloak on a cycle and ignore shots while hidden', () => {
  const state = isolated(5);
  const heavy = applyRole(spawnEnemy(state, 5, 600, 300), 'shielded');
  const hull = heavy.hp;
  assert(heavy.shieldMax > 0 && heavy.shieldHp === heavy.shieldMax);
  damageEnemy(state, heavy, 10);
  assert.equal(heavy.hp, hull); assert.equal(heavy.shieldHp, heavy.shieldMax - 10);
  assert(state.events.some(event => event.type === 'blocked' && event.shield));
  damageEnemy(state, heavy, heavy.shieldHp + 5);
  assert.equal(heavy.shieldHp, 0); assert.equal(heavy.hp, hull - 5, 'overflow damage reaches the hull');
  state.events.length = 0;
  advance(state, 2.5);
  assert.equal(heavy.shieldHp, 0, 'a barrier stays down while recently hit');
  advance(state, 2);
  assert(heavy.shieldHp > 0 && heavy.shieldHp < heavy.shieldMax, 'the barrier recharges after three quiet seconds');

  const phantom = applyRole(spawnEnemy(state, 1, 300, 250), 'phantom', { cloak: 0 });
  phantom.vy = 0; phantom.speed = 0;
  const seen = new Set();
  advance(state, PHANTOM_CYCLE * 2, [{}], () => seen.add(phantom.cloaked));
  assert.deepEqual([...seen].sort(), [false, true], 'a phantom shows and hides within two cycles');
  phantom.cloak = PHANTOM_VISIBLE + .1; update(state, 1 / 60); assert.equal(phantom.cloaked, true);
  const hp = phantom.hp;
  state.bullets.push({ x: phantom.x, y: phantom.y + 30, px: phantom.x, py: phantom.y + 30, vx: 0, vy: -900, radius: 5, team: 0, damage: 30, life: 1, color: '#9cfff0' });
  update(state, 1 / 30);
  assert.equal(phantom.hp, hp, 'shots pass through a cloaked hull');
  phantom.cloak = .1; update(state, 1 / 60); assert.equal(phantom.cloaked, false);
  state.bullets.push({ x: phantom.x, y: phantom.y + 30, px: phantom.x, py: phantom.y + 30, vx: 0, vy: -900, radius: 5, team: 0, damage: 30, life: 1, color: '#9cfff0' });
  update(state, 1 / 30);
  assert(phantom.hp < hp, 'a visible phantom takes damage');
});

check('splitters release diving needles, medics repair neighbours, bombers drop fused bombs and minelayers seed drifting mines', () => {
  const state = isolated(6);
  const splitter = applyRole(spawnEnemy(state, 2, 500, 200), 'splitter');
  const before = state.enemies.length;
  killEnemy(state, splitter);
  const needles = state.enemies.filter(enemy => enemy.type === 0 && !enemy.dead);
  assert.equal(state.enemies.length, before + 3); assert.equal(needles.length, 3);
  assert(needles.every(needle => needle.ai === 'dive' && !needle.returnToHive));
  assert(state.events.some(event => event.type === 'split'));

  const patient = spawnEnemy(state, 3, 700, 260); patient.hp = patient.maxHp * .5;
  const medic = applyRole(spawnEnemy(state, 6, 740, 300), 'medic');
  medic.vy = 0; medic.speed = 0; patient.vy = 0; patient.speed = 0;
  let arcs = 0;
  advance(state, 1.5, [{}], s => { arcs += s.events.filter(event => event.type === 'arc' && event.color === '#8affd7').length; });
  assert(arcs >= 2 && patient.hp > patient.maxHp * .5, 'a medic repairs the nearest damaged hull');
  assert(medic.noFire, 'medics never fire');

  const bombs = isolated(7);
  const bomber = applyRole(spawnEnemy(bombs, 7, 600, 150), 'bomber');
  bomber.vy = 0; bomber.speed = 0; bomber.fire = .05;
  let bursts = 0, fused = 0;
  advance(bombs, 4, [{}], s => {
    fused = Math.max(fused, s.bullets.filter(bullet => bullet.fuse !== undefined && bullet.team < 0).length);
    bursts += s.events.filter(event => event.type === 'blast' && event.color === '#ff9a4b').length;
  });
  assert(fused >= 1 && bursts >= 1, 'fused bombs fall and burst into rings');
  assert(bombs.bullets.some(bullet => bullet.team < 0 && bullet.fuse === undefined), 'a burst leaves a ring of hostile rounds');

  const field = isolated(4);
  const miner = applyRole(spawnEnemy(field, 3, 600, 200), 'miner');
  miner.vy = 0; miner.speed = 0; miner.mineBudget = 3; miner.dropTimer = .1;
  advance(field, 2.5);
  const mines = field.enemies.filter(enemy => enemy.role === 'mine');
  assert.equal(mines.length, 3); assert.equal(miner.mineBudget, 0);
  assert(mines.every(mine => mine.wave === ENCOUNTER_WAVE && mine.noFire && mine.vy > 0 && Math.abs(mine.driftX) <= 24 && HAZARD_ROLES.has(mine.role)));
  const crowded = missionScrollSpeed(field);
  for (const mine of mines) mine.dead = true;
  assert.equal(missionScrollSpeed(field), crowded, 'hazards never slow the terrain');
  for (const mine of mines) mine.dead = false;
  const pilot = field.players[0]; pilot.shield = 0; pilot.invulnerableTime = 0;
  const hullBefore = pilot.hull;
  Object.assign(mines[0], { x: pilot.x, y: pilot.y, px: pilot.x, py: pilot.y, vy: 0 });
  update(field, 1 / 60);
  assert(pilot.hull < hullBefore, 'a mine detonates on contact');
  assert(mines[0].dead, 'a spent mine is gone');
  const expired = isolated(4), late = applyRole(spawnEnemy(expired, 0, 600, 300), 'mine');
  late.age = MINE_LIFETIME + .1; late.vy = 0;
  update(expired, 1 / 60);
  assert(late.gone && expired.events.some(event => event.type === 'blast'), 'old mines fizzle out');
});

check('aces, elites, convoys and bonus flights pay their rewards and count in the flight report', () => {
  const state = isolated(5);
  const plainScore = seeded(1, () => { const s = isolated(5); killEnemy(s, spawnEnemy(s, 6, 600, 300)); return s.score; });
  const ace = applyRole(spawnEnemy(state, 6, 600, 300), 'ace', { aceName: 3 });
  assert(ace.maxHp > ENEMY_TYPES[6].hp * 2 && ace.tacticFire <= 2);
  seeded(1, () => killEnemy(state, ace));
  assert.equal(state.stats.aces, 1);
  assert.equal(state.score, plainScore * roleScoreScale(ace), 'an ace is worth double');
  const prizes = state.pickups.map(pickup => pickup.kind);
  assert(prizes.includes('bomb') && prizes.includes('power') && prizes.includes('credit'), `an ace drops a power core, a nova charge and salvage (${prizes})`);
  assert(state.events.some(event => event.type === 'ace-down' && event.aceName === 3));
  state.players[0].bombs = MAX_BOMBS; state.pickups.length = 0;
  killEnemy(state, applyRole(spawnEnemy(state, 6, 600, 300), 'ace'));
  assert(state.pickups.some(pickup => pickup.kind === 'repair'), 'a full nova rack turns the second prize into repairs');

  const elite = applyRole(spawnEnemy(state, 1, 500, 300), 'elite');
  assert(Math.abs(elite.maxHp / ENEMY_TYPES[1].hp / (1 + 5 * .24) - 1.6) < 1e-9 && elite.tacticFire <= 2);

  const convoy = isolated(5), credits = convoy.credits;
  killEnemy(convoy, applyRole(spawnEnemy(convoy, 3, 500, 300), 'convoy'));
  assert.equal(convoy.stats.convoys, 1);
  assert(convoy.credits > credits && convoy.pickups.some(pickup => pickup.kind === 'credit' && pickup.value >= 110), 'haulers pay salvage twice over');

  const flights = [false, true].map(bonusFlight => {
    const s = isolated(5);
    const squad = { id: s.nextSquadId++, size: 3, killed: 0, broken: false, wave: bonusFlight ? ENCOUNTER_WAVE : 0 };
    if (bonusFlight) squad.bonusFlight = true;
    s.squadrons.push(squad);
    const ships = [0, 1, 2].map(i => Object.assign(spawnEnemy(s, 0, 300 + i * 80, 300), { squad: squad.id, wave: squad.wave, harmless: bonusFlight, noFire: bonusFlight }));
    const scoreBefore = s.score;
    for (const ship of ships) killEnemy(s, ship);
    const event = s.events.find(item => item.type === 'squadron');
    assert(event, 'wiping the squadron pays a bonus');
    return event.bonus;
  });
  assert(Math.abs(flights[1] - flights[0] * 2) <= 1, `a bonus flight doubles the squadron bonus (${flights})`);
});

// Every encounter kind launches in real sectors under a scripted pilot that
// clears each wave, and the live budget holds whenever one launches.
check('scheduled encounters launch inside the live budget across real sectors and survive a save', () => {
  const targets = [];
  const remaining = new Set(ENCOUNTER_KINDS);
  for (let level = 1; level < 40 && remaining.size; level++) for (const salt of [0, 3, 91]) {
    const schedule = sectorEncounters(level, sectorPlan(level, salt), salt);
    if (!schedule.some(entry => remaining.has(entry.kind))) continue;
    for (const entry of schedule) remaining.delete(entry.kind);
    targets.push({ level, salt });
    break;
  }
  assert.equal(remaining.size, 0, 'a handful of sectors covers every encounter kind');
  const launched = new Set(), roles = new Set(), saved = new Set();
  let peakAtLaunch = 0, cloakStates = new Set(), mines = 0, bombs = 0;
  for (const { level, salt } of targets) seeded(level * 97 + salt, () => {
    const state = createCampaign(level, null, 'easy', salt);
    state.width = 1200; state.height = 900;
    state.players[0].hull = state.players[0].maxHull = 1e9;
    const schedule = state.director.encounters.map(entry => entry.kind);
    let ticks = 0;
    while (state.status === 'playing' && ticks++ < 60 * 400) {
      update(state, 1 / 60, [{}]);
      for (const event of state.events) if (event.type === 'encounter') {
        launched.add(event.kind);
        const live = state.enemies.filter(enemy => !enemy.dead).length;
        peakAtLaunch = Math.max(peakAtLaunch, live);
        assert(live <= ENCOUNTER_BUDGET, `${event.kind} launches only into a bounded arena (${live})`);
        assert(state.enemies.filter(enemy => enemy.wave === ENCOUNTER_WAVE && !enemy.dead).length >= 1);
        if (!saved.has(event.kind)) {
          saved.add(event.kind);
          const run = restoreRun(serializeRun(state));
          assert(run, `${event.kind} flights save`);
          assert.equal(run.state.salt, salt);
          assert.deepEqual(run.state.director.encounters, state.director.encounters);
          assert.deepEqual(run.state.enemies.map(roleFields), state.enemies.map(roleFields), `${event.kind} roles round-trip`);
          assert.deepEqual(run.state.squadrons.map(squad => squad.bonusFlight), state.squadrons.map(squad => squad.bonusFlight));
        }
      }
      for (const enemy of state.enemies) {
        assert(Number.isFinite(enemy.x) && Number.isFinite(enemy.y) && Number.isFinite(enemy.hp), 'every actor stays finite');
        if (enemy.role) roles.add(enemy.role);
        if (enemy.role === 'phantom') cloakStates.add(enemy.cloaked);
        if (enemy.role === 'mine') mines++;
        if (enemy.dead || enemy.boss || isDormant(enemy) || enemy.y < 0 || enemy.y > state.height) continue;
        if (enemy.age > (enemy.wave === ENCOUNTER_WAVE ? 5 : 4)) killEnemy(state, enemy);
      }
      bombs += state.bullets.filter(bullet => bullet.fuse !== undefined).length;
      const boss = state.enemies.find(enemy => enemy.boss && !enemy.dead);
      if (boss && boss.age > 2) killEnemy(state, boss);
      state.events.length = 0;
    }
    assert.equal(state.status, 'hangar', `sector ${level + 1} (salt ${salt}) completes`);
    assert(state.stats.encounters >= 1, `sector ${level + 1} delivers at least one of ${schedule.join('/')}`);
    assert(state.stats.encounters <= schedule.length);
  });
  assert.deepEqual([...launched].sort(), [...ENCOUNTER_KINDS].sort(), 'every encounter kind launched');
  for (const role of ['convoy', 'meteor', 'miner', 'mine', 'ace', 'phantom', 'bomber', 'medic']) assert(roles.has(role), `${role} took part`);
  assert.deepEqual([...cloakStates].sort(), [false, true]);
  assert(mines > 0 && bombs > 0 && peakAtLaunch <= ENCOUNTER_BUDGET);
});

check('save records validate roles, salts and encounter schedules, and older saves adopt a schedule', () => {
  const state = isolated(6, 42);
  for (const role of ROLES) if (!['midboss', 'captor'].includes(role)) applyRole(spawnEnemy(state, 3, 100 + ROLES.indexOf(role) * 60, 300), role, { aceName: 2, driftX: 5, radius: 22, speed: 140, spinRate: .5, variant: 3, cloak: 1 });
  state.enemies.find(enemy => enemy.role === 'meteor').meteorWorld = 4;
  state.bullets.push({ x: 300, y: 240, px: 301, py: 237, vx: 0, vy: 150, damage: 8, radius: 9, team: -1, life: 6, color: '#ffb36b', kind: 'hostile', variant: 5, sourceRadius: 18, age: 1, fuse: 1.2 });
  const run = restoreRun(serializeRun(state));
  assert.equal(run.state.salt, 42);
  assert.deepEqual(run.state.enemies.map(roleFields), state.enemies.map(roleFields));
  assert.equal(run.state.bullets.find(bullet => bullet.fuse !== undefined).fuse, 1.2);
  assert.deepEqual(run.state.stats, state.stats);
  const source = serializeRun(state);
  const corrupt = mutate => { const record = JSON.parse(source); mutate(record); return restoreRun(record); };
  assert.equal(corrupt(record => { record.state.enemies[0].role = 'warlord'; }), null);
  assert.equal(corrupt(record => { record.state.salt = 'abc'; }), null);
  assert.equal(corrupt(record => { record.state.director.encounters = [{ kind: 'dragon', wave: 2, time: 5, size: 0, done: false }]; }), null);
  assert.equal(corrupt(record => { record.state.director.encounters = 'none'; }), null);
  assert.equal(corrupt(record => { record.state.enemies[0].wave = -9; }).state.enemies[0].wave, -2, 'waves clamp to the encounter marker');
  assert.equal(corrupt(record => { record.state.salt = -5; }).state.salt, 0);
  const shielded = corrupt(record => { const heavy = record.state.enemies.find(enemy => enemy.role === 'shielded'); heavy.shieldHp = heavy.shieldMax * 9; }).state.enemies.find(enemy => enemy.role === 'shielded');
  assert.equal(shielded.shieldHp, shielded.shieldMax, 'a barrier never exceeds its capacity');
  // A record from before salts and encounters flies the reference schedule from its current wave.
  const legacy = corrupt(record => { delete record.state.salt; delete record.state.director.encounters; record.state.director.wave = 4; });
  assert.equal(legacy.state.salt, 0);
  const expected = sectorEncounters(6, legacy.state.director.plan, 0).map(entry => ({ ...entry, done: entry.wave <= 4 }));
  assert.deepEqual(legacy.state.director.encounters, expected);
});

if (failures) process.exitCode = 1;
else console.log('All encounter and replay-variety checks passed.');
