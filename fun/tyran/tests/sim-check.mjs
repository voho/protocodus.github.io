import assert from 'node:assert/strict';
import { ENEMY_TYPES } from '../ships.js';
import { createCampaign, beginLevel, update, spawnEnemy, killEnemy, hurtPlayer,
  spawnFormation, selectWeapon, weaponStats, WEAPONS, buyUpgrade, upgradeCost, shipStats, UPGRADES, MAX_UPGRADE, applyStructureBlast, missionScrollSpeed, SECONDARY_ENERGY_COST, SECONDARY_RESTART_ENERGY,
  PRIMARIES, primaryStats, buyPrimary, buySupply, supplyCost, MAX_POWER, MAX_DRONES, MAX_BOMBS, MAX_LIVES, START_LIVES, FIRST_EXTRA_LIFE, RESPAWN_DELAY, challengeSector } from '../sim.js';
import { sectorPlan, isDormant, hiveSlot, pathTable, pathPoint, PATHS, CHALLENGE_SIZE } from '../waves.js';
import { serializeRun, restoreRun } from '../save-game.js';

// Run with: node fun/tyran/tests/sim-check.mjs
// Add --balance for reproducible keyboard-style autopilot campaign trials.
let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}
function seeded(seed, fn) {
  const original = Math.random;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  try { return fn(); } finally { Math.random = original; }
}
function advance(state, seconds, controls = []) {
  for (let t = 0; t < seconds - 1e-8; t += .025) { update(state, Math.min(.025, seconds - t), controls); state.events.length = 0; }
}
function isolated(level = 0) {
  const state = createCampaign(level);
  state.bossSpawned = true;
  return state;
}
function bolt(x, y, team, damage, vx = 0, vy = 0) {
  return { x, y, px: x, py: y, team, damage, vx, vy, radius: 4, life: 1.4 };
}

check('ten progressively stronger enemy classes with distinct names', () => {
  assert.equal(ENEMY_TYPES.length, 10);
  assert.equal(new Set(ENEMY_TYPES.map(e => e.name)).size, 10);
  for (let i = 1; i < 10; i++) {
    assert.ok(ENEMY_TYPES[i].hp > ENEMY_TYPES[i - 1].hp);
    assert.ok(ENEMY_TYPES[i].radius > ENEMY_TYPES[i - 1].radius);
  }
});

check('mission scrolling accelerates within each sector, stays bounded, and resets for the next mission', () => {
  for (let level = 0; level < 10; level++) {
    const state = createCampaign(level), opening = missionScrollSpeed(state);
    const speeds = [0, .25, .5, .75, 1].map(progress => missionScrollSpeed(state, state.duration * progress));
    assert.equal(opening, 92 + level * 3);
    for (let index = 1; index < speeds.length; index++) assert(speeds[index] > speeds[index - 1]);
    assert.equal(speeds.at(-1), opening * 1.75);
    assert.equal(missionScrollSpeed(state, state.duration * 10), opening * 1.75, 'acceleration has a finite ceiling');
    state.time = state.duration * .9; state.scroll = 1000; state.bossSpawned = true;
    assert.equal(missionScrollSpeed(state), 42, 'guardians keep their readable battle pacing');
    const before = state.scroll; update(state, .025);
    assert(Math.abs(state.scroll - before - 42 * .025) < 1e-9);
    beginLevel(state, level);
    assert.equal(state.time, 0); assert.equal(state.scroll, 0); assert.equal(missionScrollSpeed(state), opening);
  }
});

check('accelerating terrain travels consistently at 30, 60 and 120 Hz', () => {
  const distances = [30, 60, 120].map(hz => {
    const state = createCampaign();
    state.director.hold = true;
    let firstSecond = 0, lastSecondStart = 0;
    const seconds = Math.ceil(state.duration);
    for (let tick = 0; tick < seconds * hz; tick++) {
      update(state, 1 / hz);
      if (tick === hz - 1) firstSecond = state.scroll;
      if (tick === (seconds - 1) * hz - 1) lastSecondStart = state.scroll;
    }
    assert(state.scroll - lastSecondStart > firstSecond * 1.5, 'actual late-flight displacement increases');
    assert.equal(state.bossSpawned, false);
    return state.scroll;
  });
  assert(Math.max(...distances) - Math.min(...distances) < .001, 'refresh rate cannot change the traveled map');
});

check('resuming preserves the speed ramp and ground targets receive the current scroll position', () => {
  const state = createCampaign(6);
  state.time = 63.25; state.scroll = 7432.5;
  state.director.hold = true;
  const restored = restoreRun(serializeRun(state)).state;
  assert.equal(missionScrollSpeed(restored), missionScrollSpeed(state));
  let targetScroll;
  update(state, 1 / 60, [], null, current => { targetScroll = current.scroll; return []; });
  update(restored, 1 / 60);
  assert.equal(restored.scroll, state.scroll); assert.equal(restored.time, state.time);
  assert.equal(targetScroll, state.scroll, 'turret aiming and scenery hits use the newly advanced terrain');
});

check('one pilot uses two dedicated fire channels with a shared cooldown', () => {
  const state = isolated(), player = state.players[0];
  assert.equal(state.mode, 1); assert.equal(state.players.length, 1);
  assert.deepEqual(WEAPONS.map(weapon => weapon.id), ['pulse', 'plasma']);
  const pulse = weaponStats(state, 'pulse'), plasma = weaponStats(state, 'plasma');
  assert(plasma.damage > pulse.damage * 5); assert(plasma.splash > 0);
  assert(plasma.damage / plasma.interval > pulse.damage * pulse.count / pulse.interval);
  selectWeapon(state, 'plasma'); update(state, .01, [{ fire: true }, { secondary: true }]);
  assert.deepEqual(state.bullets.map(b => b.kind), ['pulse', 'pulse']);
  assert.equal(player.fireEnergy, 100);
  const cooldown = player.fire;
  for (let i = 0; i < 20; i++) for (const id of ['plasma', 'pulse']) selectWeapon(state, id);
  assert.equal(player.fire, cooldown);
  advance(state, .15, [{ secondary: true }]);
  assert.equal(state.bullets.length, 2, 'alternating inputs cannot bypass the shot cooldown');
  player.fire = 0; update(state, .01, [{ secondary: true }]);
  assert.equal(state.bullets.at(-1).kind, 'plasma'); assert.equal(player.fireEnergy, 80);
  for (const playerId of [-1, 1, 2, .5]) assert.equal(selectWeapon(state, 'pulse', playerId), false);
});

check('secondary bursts consume energy and holding an empty weapon waits for a useful recharge', () => {
  const state = isolated(), player = state.players[0];
  let shots = 0;
  for (let tick = 0; tick < 110; tick++) {
    update(state, .025, [{ secondary: true }]);
    shots += state.events.filter(event => event.type === 'shot').length;
    state.events.length = 0;
  }
  assert.equal(shots, 5, 'a full reserve buys exactly five shots before recharging');
  assert(player.fireEnergyLocked); assert(player.fireEnergy < SECONDARY_ENERGY_COST);
  update(state, .025, [{ fire: true, secondary: true }]);
  assert.equal(state.events.at(-1).weapon, 'pulse', 'primary remains usable while secondary recharges');
  advance(state, .3); advance(state, .3, [{ secondary: true }]);
  assert(player.fireEnergyLocked, 'releasing and pressing again cannot bypass the recharge threshold');
  let restarted = false;
  for (let tick = 0; tick < 300 && !restarted; tick++) {
    state.events.length = 0;
    update(state, .025, [{ secondary: true }]);
    restarted = state.events.some(event => event.type === 'shot');
    if (!restarted) assert(player.fireEnergyLocked);
  }
  assert(restarted, 'holding the secondary automatically resumes after recovery');
  assert(player.fireEnergy >= SECONDARY_RESTART_ENERGY - SECONDARY_ENERGY_COST, 'an empty weapon cannot resume at just one shot of energy');
  advance(state, .5);
  update(state, .025, [{ fire: true, secondary: true }]);
  assert.equal(state.events.at(-1).weapon, 'plasma', 'secondary has priority when both triggers are held');
  assert(player.fireEnergy >= 0);
});

check('fire energy recharge is frame-rate independent, upgraded, bounded, and paused with simulation', () => {
  for (const recharge of [0, 6]) {
    const reserves = [30, 60, 120].map(hz => {
      const state = isolated(), player = state.players[0]; state.upgrades.recharge = recharge;
      const stats = shipStats(state.upgrades);
      player.fireEnergy = 0; player.fireEnergyDelay = stats.energyDelay; player.fireEnergyLocked = true;
      for (let tick = 0; tick < 1.5 * hz; tick++) update(state, 1 / hz, [{ fire: true }]);
      assert(Math.abs(player.fireEnergy - (1.5 - stats.energyDelay) * stats.energyRecharge) < 1e-8, 'primary fire does not delay regeneration');
      const snapshot = [player.fireEnergy, player.fireEnergyDelay, player.fireEnergyLocked, player.fire];
      state.status = 'hangar'; advance(state, 1);
      assert.deepEqual([player.fireEnergy, player.fireEnergyDelay, player.fireEnergyLocked, player.fire], snapshot);
      state.status = 'playing'; advance(state, 10);
      assert.equal(player.fireEnergy, stats.energy); assert.equal(player.fireEnergyLocked, false);
      return snapshot[0];
    });
    assert(Math.max(...reserves) - Math.min(...reserves) < 1e-8);
  }
});

check('shared upgrades improve both channels and new stages and retries refill fire energy', () => {
  const state = isolated(), before = WEAPONS.map(weapon => weaponStats(state, weapon.id).damage);
  for (const player of state.players) { player.fireEnergy = 3; player.fireEnergyDelay = .8; player.fireEnergyLocked = true; }
  state.status = 'hangar'; state.credits = 1000;
  assert.equal(buyUpgrade(state, 'weapon'), true);
  WEAPONS.forEach((weapon, index) => assert(weaponStats(state, weapon.id).damage > before[index]));
  const retry = createCampaign(state.level, state);
  beginLevel(state, 1);
  for (const run of [state, retry]) for (const player of run.players) {
    assert.equal(player.fireEnergy, 100); assert.equal(player.fireEnergyDelay, 0); assert.equal(player.fireEnergyLocked, false);
  }
});

check('hostile rounds scale with ship class and use spectrum colors', () => {
  const smallState = isolated(), small = spawnEnemy(smallState, 0, 300, 200); small.fire = 0;
  update(smallState, .016, [{}]);
  const smallBullet = smallState.bullets.find(b => b.team < 0);
  const largeState = isolated(), large = spawnEnemy(largeState, 8, 300, 200); large.fire = 0;
  update(largeState, .016, [{}]);
  const largeBullet = largeState.bullets.find(b => b.team < 0);
  assert.ok(smallBullet && largeBullet);
  assert.ok(largeBullet.radius > smallBullet.radius);
  assert.ok(largeBullet.damage > smallBullet.damage);
  assert.notEqual(largeBullet.color, smallBullet.color);
});

check('large structure blasts push both teams outward with mass and distance falloff',()=>{
  const state=isolated(),left=state.players[0],right=spawnEnemy(state,0,650,600);
  Object.assign(left,{x:550,y:600,mass:1});Object.assign(right,{x:650,y:600,mass:2});
  const nearby=spawnEnemy(state,0,600,545),far=spawnEnemy(state,0,950,600),heavy=spawnEnemy(state,8,630,600),boss=spawnEnemy(state,9,590,600),dead=spawnEnemy(state,0,590,600);
  dead.dead=true;
  const ships=[left,right,nearby,far,heavy,boss,dead],positions=ships.map(p=>[p.x,p.y]),health=ships.map(p=>[p.hp,p.hull,p.shield]);
  applyStructureBlast(state,{x:600,y:600,size:80,footprint:80,blastRadius:224,structural:true});
  assert(left.blastVx<0&&right.blastVx>0&&nearby.blastVy<0,'all nearby light craft move away from the center');
  assert(Math.abs(left.blastVx/right.blastVx+2)<1e-9,'double mass receives half the initial shove');
  for(const p of [far,heavy,boss,dead])assert.equal(Math.hypot(p.blastVx,p.blastVy),0,'distant, heavy, boss and dead hulls are unaffected');
  assert.deepEqual(ships.map(p=>[p.x,p.y]),positions,'an impulse never teleports ships');
  assert.deepEqual(ships.map(p=>[p.hp,p.hull,p.shield]),health,'shoves cause no damage');
  const edge=spawnEnemy(state,0,810,600);applyStructureBlast(state,{x:600,y:600,size:80,blastRadius:224,structural:true});
  assert(Math.abs(edge.blastVx)<Math.abs(nearby.blastVy)*.1,'the impulse fades smoothly near its boundary');
});

check('structure blast drift survives steering, decays smoothly and stays frame-rate independent',()=>{
  const initial=isolated(),pilot=initial.players[0];Object.assign(pilot,{x:650,y:600,px:650,py:600});
  const explosion={x:600,y:600,size:80,structural:true};
  applyStructureBlast(initial,explosion);const speed=pilot.blastVx,positions=[];
  for(const hz of [30,60,120]){
    const state=structuredClone(initial);
    for(let step=0;step<hz;step++)update(state,1/hz,[{}]);
    positions.push(state.players[0].x);
    assert(state.players[0].blastVx>0&&state.players[0].blastVx<speed*.03);
    assert(Math.abs(state.players[0].x-(650+speed*.28*(1-Math.exp(-1/.28))))<1e-8);
  }
  assert(Math.max(...positions)-Math.min(...positions)<1e-8);
  const enemy=spawnEnemy(initial,0,550,300);enemy.fire=100;
  const baseline=structuredClone(initial);applyStructureBlast(initial,{x:600,y:300,size:80,structural:true});
  update(initial,.025);update(baseline,.025);
  assert(initial.enemies[0].x<baseline.enemies[0].x,'flight pattern steering does not erase the external shove');
});

check('only large structural destruction emits a finite bounded one-time shove',()=>{
  const state=isolated(),pilot=state.players[0];Object.assign(pilot,{x:600,y:600});
  for(const prop of [{size:80,structural:false},{size:40,footprint:40,structural:true}])applyStructureBlast(state,{x:600,y:600,...prop});
  assert.equal(pilot.blastVx,0);assert.equal(pilot.blastVy,0);
  const prop={x:600,y:600,size:80,structural:true,value:12};
  applyStructureBlast(state,prop);const first=[pilot.blastVx,pilot.blastVy];
  pilot.blastVx=pilot.blastVy=0;applyStructureBlast(state,prop);
  assert.deepEqual([pilot.blastVx,pilot.blastVy],first,'coincident centers use a stable finite direction');
  for(let i=0;i<100;i++)applyStructureBlast(state,prop);
  assert(Math.hypot(pilot.blastVx,pilot.blastVy)<=110.00000001,'chain detonations cannot build excessive drift');
  const eventState=isolated();Object.assign(eventState.players[0],{x:650,y:600});eventState.bullets.push(bolt(400,400,0,1));
  let destroyed=false;
  const hit=()=>{if(destroyed)return[];destroyed=true;return[prop];};
  update(eventState,.01,[],hit);
  assert(eventState.players[0].blastVx>0&&eventState.destroyed===1,'actual scenery destruction invokes the shove');
  const impulse=eventState.players[0].blastVx;update(eventState,.01,[],hit);
  assert(eventState.players[0].blastVx<impulse&&eventState.destroyed===1,'a persistent crater never repeats its impulse');
});

check('boss volleys respect the hostile projectile limit', () => {
  const state = isolated(), boss = spawnEnemy(state, 9, 600, 155);
  for (let i = 0; i < 77; i++) state.bullets.push({ ...bolt(100, 100, -1, 1), life: 10 });
  for (let tick = 0; tick < 4; tick++) { boss.fire = 0; update(state, .016); }
  assert.equal(state.bullets.filter(bullet => bullet.team < 0).length, 78);
});

check('double and multi kill overcharge damage and blast radius, then expire', () => {
  const state = isolated();
  killEnemy(state, spawnEnemy(state, 0, 300, 200));
  assert.equal(state.combo, 1);
  killEnemy(state, spawnEnemy(state, 0, 420, 200));
  assert.equal(state.combo, 2);
  assert.equal(state.comboLabel, 'Double kill');
  assert.ok(state.comboDamage > 1 && state.comboBlast > 1);
  killEnemy(state, spawnEnemy(state, 0, 540, 200));
  assert.equal(state.comboLabel, 'Multi kill');
  assert.ok(state.comboDamage >= 1.18 && state.comboBlast >= 1.24);
  advance(state, 6);
  assert.equal(state.combo, 0);
  assert.equal(state.comboDamage, 1);
  assert.equal(state.comboBlast, 1);
});

check('enemy formations keep a coordinated anchor and readable membership', () => {
  const state = createCampaign();
  const formation = spawnFormation(state, 'vee');
  assert.ok(formation && formation.members === 5);
  assert.equal(state.enemies.filter(enemy => enemy.formation === formation).length, 5);
  const before = state.enemies.map(enemy => enemy.x);
  advance(state, .4);
  assert.ok(formation.age > 0 && formation.y > -150);
  assert.ok(state.enemies.some((enemy, index) => Math.abs(enemy.x - before[index]) > .01));
});

check('ordinary craft pass through the pilot lane and leave without a bottom-row pileup', () => {
  const state = isolated();
  state.players[0].hurt = Infinity;
  for (const type of [0, 4, 8]) { const enemy = spawnEnemy(state, type, 300, state.height * .62); enemy.fire = Infinity; }
  advance(state, .5);
  assert.ok(state.enemies.every(enemy => enemy.y > state.height * .62 && enemy.vy > 0));
  advance(state, 18);
  assert.equal(state.enemies.length, 0);
});

check('formation survivors depart and keep moving until the last heavy hull exits', () => {
  for (const kind of ['vee', 'wall', 'orbit', 'escort', 'pincer']) {
    const state = createCampaign(9);
    state.time = 80;
    const formation = spawnFormation(state, kind);
    state.bossSpawned = true; state.players[0].hurt = Infinity;
    state.enemies.forEach(enemy => { enemy.fire = Infinity; });
    advance(state, 25);
    assert.ok(formation.y > state.height, `${kind} anchor must depart`);
    assert.ok(state.enemies.every(enemy => enemy.vy > 0), `${kind} survivors keep flying`);
    advance(state, 20);
    assert.equal(state.enemies.length, 0, `${kind} hulls leave the viewport`);
    assert.equal(state.formations.length, 0, `${kind} releases its formation slot`);
  }
});

check('boss armor blocks real shots between windows and weak points open fire lanes', () => {
  const state = isolated(), boss = spawnEnemy(state, 9, 600, 155);
  boss.fire = 100; boss.windowClock = 5; state.players[0].x = 600; state.players[0].y = 700;
  const shot = () => ({ x: 600, y: 300, px: 600, py: 300, vx: 0, vy: -2500, damage: 1000, radius: 4, team: 0, life: 1, kind: 'pulse', weaponColor: '#fff', hitIds: [] });
  const sealed = boss.hp;
  state.bullets.push(shot()); update(state, .1, [{}]);
  assert.equal(boss.hp, sealed);
  boss.vulnerable = true; boss.windowClock = 3;
  state.bullets.push(shot()); update(state, .1, [{}]);
  assert.ok(boss.hp < sealed, 'an exposed core can be damaged');
});

check('all ten sectors fly every wave, introduce all nine normal classes and end with one boss', () => seeded(7261, () => {
  for (let level = 0; level < 10; level++) {
    const state = createCampaign(level), seen = new Set(), kinds = [];
    // Ignore damage only for this spawn-schedule check; balance trials use real HP.
    state.players[0].hurt = Infinity;
    let bossEvents = 0;
    for (let t = 0; t < 900 && !state.bossSpawned; t += .05) {
      update(state, .05);
      state.enemies.forEach(e => { if (!isDormant(e)) seen.add(e.type); });
      bossEvents += state.events.filter(e => e.type === 'boss').length;
      kinds.push(...state.events.filter(e => e.type === 'wave').map(e => e.kind));
      state.events.length = 0;
    }
    update(state, .05); bossEvents += state.events.filter(e => e.type === 'boss').length;
    assert.deepEqual(kinds, sectorPlan(level), `sector ${level + 1} flies its script in order`);
    assert.deepEqual([...seen].sort((a, b) => a - b), [0,1,2,3,4,5,6,7,8,9], `sector ${level + 1}`);
    assert.equal(bossEvents, 1, `sector ${level + 1}`);
    const boss = state.enemies.find(e => e.boss);
    assert.ok(boss.hp >= 2600);
    assert.ok(Number.isFinite(boss.x) && Number.isFinite(boss.y));
  }
}));

check('swept projectile collision hits a small ship between frames', () => {
  const state = isolated(), enemy = spawnEnemy(state, 0, 600, 579);
  enemy.seed = 0;
  state.bullets.push(bolt(600, 604, 0, 100, 0, -850));
  update(state, .05);
  assert.ok(enemy.dead);
  assert.equal(state.kills, 1);
  assert.equal(state.bullets.length, 0);
});

check('swept collision preserves near misses, exact tangency, and stationary bolts', () => {
  for (const [offsetX, y, vx, vy, hit] of [
    [26, 315, 0, -600, false], [26.01, 315, 0, -600, false], [25.99, 315, 0, -600, true],
    [0, 326, 0, 0, false], [0, 325.99, 0, 0, true], [-20, 280, 800, 800, true],
  ]) {
    const state = isolated(), enemy = spawnEnemy(state, 2, 600, 300);
    enemy.speed = enemy.vy = 0;
    enemy.seed = -.025 * 1.2 / Math.sqrt(enemy.mass);
    state.bullets.push(bolt(600 + offsetX, y, 0, 10000, vx, vy));
    update(state, .05);
    assert.equal(enemy.dead, hit, `offset ${offsetX}, y ${y}, velocity ${vx}/${vy}`);
  }
});

check('enemy destruction rewards once and boss clears remaining enemies', () => seeded(122, () => {
  const state = isolated();
  for (let kind = 0; kind < 9; kind++) {
    const enemy = spawnEnemy(state, kind, 100 + kind * 90, 200);
    killEnemy(state, enemy);
    const credits = state.credits, score = state.score;
    killEnemy(state, enemy);
    assert.equal(state.credits, credits);
    assert.equal(state.score, score);
  }
  const survivor = spawnEnemy(state, 8, 150, 250), boss = spawnEnemy(state, 9, 600, 155);
  state.bullets.push(bolt(100, 400, -1, 10));
  killEnemy(state, boss);
  assert.ok(survivor.dead && state.bossDefeated);
  assert.equal(state.kills, 10);
  assert.equal(state.totalKills, 10);
  assert.equal(state.bullets.filter(b => b.team < 0).length, 0);
}));

check('boss destruction cancels hostile collisions later in the same frame', () => {
  const state = isolated(1), player = state.players[0];
  player.hull = 1; player.shield = 0; player.lastHit = 0;
  const boss = spawnEnemy(state, 9, 600, 155); boss.fire = 100;
  state.bullets = [bolt(600, 155, 0, 999999), bolt(player.x, player.y, -1, 99)];
  update(state, .016);
  assert.ok(state.bossDefeated);
  assert.ok(player.alive, 'cleared hostile shot must not kill the pilot');
  assert.ok(state.bullets.every(b => b.team >= 0), 'compaction must not restore cleared hostile shots');
  advance(state, 3.3);
  assert.equal(state.status, 'hangar');
});

check('every sector completes, pays its bonus once, and final sector wins', () => {
  for (let level = 0; level < 10; level++) {
    const state = isolated(level), boss = spawnEnemy(state, 9, 600, 155);
    killEnemy(state, boss);
    let priorCredits = state.credits, priorScore = state.score;
    advance(state, 3);
    assert.equal(state.status, 'playing');
    advance(state, .3);
    if (challengeSector(state)) {
      // Odd-numbered sectors fly a challenging stage before the shop.
      assert.equal(state.status, 'playing'); assert.ok(state.challenge && !state.challenge.done);
      for (let t = 0; t < 45 && !state.challenge.done; t += .025) { update(state, .025); state.events.length = 0; }
      assert.ok(state.challenge.done); assert.equal(state.status, 'playing');
      priorCredits = state.credits; priorScore = state.score;
      advance(state, 3);
    }
    assert.equal(state.status, level === 9 ? 'victory' : 'hangar');
    assert.equal(state.credits, priorCredits + 650 + level * 100);
    assert.equal(state.score, priorScore + 2500 * (level + 1));
    const credits = state.credits;
    advance(state, 5);
    assert.equal(state.credits, credits);
  }
});

check('shields absorb first, damage immunity expires, and hull can be destroyed', () => {
  const state = isolated(), player = state.players[0];
  state.lives = 0;
  hurtPlayer(state, player, 100);
  assert.equal(player.shield, 0);
  assert.equal(player.hull, 105);
  hurtPlayer(state, player, 100);
  assert.equal(player.hull, 105, 'brief hit immunity prevents stacked damage');
  advance(state, .375);
  hurtPlayer(state, player, 106);
  update(state, .016);
  assert.equal(player.hull, 0);
  assert.equal(state.status, 'defeat');
});

check('shield recharge waits after damage, respects capacity, and improves with capacitor', () => {
  for (const recharge of [0, 6]) {
    const state = createCampaign(0, { upgrades: { recharge } }), player = state.players[0];
    state.bossSpawned = true;
    const stats = shipStats(state.upgrades);
    hurtPlayer(state, player, 50);
    advance(state, stats.delay - .1);
    assert.equal(player.shield, stats.shield - 50);
    advance(state, .4);
    assert.ok(player.shield > stats.shield - 50);
    advance(state, 15);
    assert.equal(player.shield, stats.shield);
  }
});

check('shop rejects unavailable purchases and charges exactly through maximum tier', () => {
  const state = createCampaign();
  state.credits = 1000000;
  assert.equal(buyUpgrade(state, 'weapon'), false, 'shop is only available between levels');
  state.status = 'hangar';
  assert.equal(buyUpgrade(state, 'unknown'), false);
  for (const upgrade of UPGRADES) {
    for (let tier = 0; tier < MAX_UPGRADE; tier++) {
      const cost = upgradeCost(state, upgrade.id);
      state.credits = cost - 1;
      assert.equal(buyUpgrade(state, upgrade.id), false);
      assert.equal(state.credits, cost - 1);
      state.credits = cost;
      assert.equal(buyUpgrade(state, upgrade.id), true);
      assert.equal(state.credits, 0);
      assert.equal(state.upgrades[upgrade.id], tier + 1);
    }
    state.credits = 1000000;
    assert.equal(buyUpgrade(state, upgrade.id), false);
    assert.equal(state.credits, 1000000);
  }
});

check('one pilot is restored with purchased upgrades next sector and defeat ends the flight', () => {
  const state = isolated(1);
  killEnemy(state, spawnEnemy(state, 9, 600, 155)); advance(state, 3.3);
  assert.equal(state.status, 'hangar');
  assert(buyUpgrade(state, 'hull')); assert(buyUpgrade(state, 'shield'));
  const credits = state.credits, score = state.score;
  beginLevel(state, 1);
  assert.equal(state.players.length, 1); assert.equal(state.players[0].id, 0);
  assert.equal(state.credits, credits); assert.equal(state.score, score);
  assert.equal(state.players[0].hull, 165); assert.equal(state.players[0].shield, 123);
  state.lives = 0; hurtPlayer(state, state.players[0], 10000); update(state, .016);
  assert.equal(state.status, 'defeat');
});

check('boss attacks change at damage thresholds', () => {
  for (const [fraction, phase, bullets] of [[1,0,9],[.6,1,13],[.25,2,17]]) {
    const state = isolated(), boss = spawnEnemy(state, 9, 600, 155);
    boss.hp = boss.maxHp * fraction; boss.fire = 0;
    update(state, .016);
    assert.equal(boss.phase, phase);
    assert.equal(state.bullets.filter(b => b.team < 0).length, bullets);
  }
});

check('diagonal acceleration and top speed are normalized', () => {
  const diagonal = isolated(), straight = isolated();
  const initial = { ...diagonal.players[0] };
  update(diagonal, .05, [{ x: 1, y: -1 }]);
  update(straight, .05, [{ x: 1 }]);
  const player = diagonal.players[0];
  assert.ok(Math.abs(Math.hypot(player.x - initial.x, player.y - initial.y) - (straight.players[0].x - initial.x)) < 1e-8);
  assert.ok(Math.abs(Math.hypot(player.vx, player.vy) - straight.players[0].vx) < 1e-8);
  assert.ok(player.vx > 0 && player.vy < 0);
  assert.ok(Math.hypot(player.vx, player.vy) < 365, 'velocity builds gradually from rest');
});

check('pilots coast on release and reverse through their existing momentum', () => {
  const state = isolated(), player = state.players[0];
  advance(state, .3, [{ x: 1 }]);
  const initialX = player.x, speed = player.vx;
  update(state, .025);
  assert.ok(player.x > initialX && player.vx > 0 && player.vx < speed);
  update(state, .025, [{ x: -1 }]);
  assert.ok(player.vx > 0, 'reverse thrust brakes before changing direction');
  advance(state, .15, [{ x: -1 }]);
  assert.ok(player.vx < -200, 'reverse thrust remains responsive');
  advance(state, .8);
  assert.ok(Math.abs(player.vx) < 1);
});

check('heavy equipment increases inertia while preserving attainable cruise speed', () => {
  const light = isolated(), heavy = createCampaign(0, { upgrades: { hull: 6, weapon: 6, shield: 6, recharge: 6 } });
  heavy.bossSpawned = true;
  const a = light.players[0], b = heavy.players[0];
  assert.ok(b.mass > a.mass * 1.5);
  update(light, .05, [{ x: 1 }]); update(heavy, .05, [{ x: 1 }]);
  assert.ok(b.vx < a.vx && b.x < a.x, 'extra mass accelerates more gradually');
  advance(light, .85, [{ x: 1 }]); advance(heavy, .85, [{ x: 1 }]);
  assert.ok(a.vx > 364 && b.vx > 364, 'both loadouts reach the same top speed');
  const ax = a.x, bx = b.x;
  advance(light, .3); advance(heavy, .3);
  assert.ok(b.x - bx > a.x - ax && b.vx > a.vx, 'extra mass coasts farther');
});

check('steering produces equivalent positions at 30, 60 and 120 Hz', () => {
  const results = [30, 60, 120].map(hz => {
    const state = isolated();
    for (const [seconds, control] of [[.5, { x: 1 }], [.25, {}], [.5, { x: -1, y: -1 }], [.25, {}]]) {
      for (let t = 0; t < seconds - 1e-9; t += 1 / hz) update(state, Math.min(1 / hz, seconds - t), [control]);
    }
    return state.players[0];
  });
  for (const player of results.slice(1)) for (const field of ['x', 'y', 'vx', 'vy']) {
    assert.ok(Math.abs(player[field] - results[0][field]) < 1e-7, `${field} must not depend on refresh rate`);
  }
});

check('arena edges discard outward velocity and level entry resets movement history', () => {
  const state = isolated(), player = state.players[0];
  player.x = state.width - 31; player.y = state.height - 43;
  advance(state, .2, [{ x: 1, y: 1 }]);
  assert.equal(player.x, state.width - 30); assert.equal(player.y, state.height - 42);
  assert.equal(player.vx, 0); assert.equal(player.vy, 0);
  update(state, .025, [{ x: -1, y: -1 }]);
  assert.ok(player.x < state.width - 30 && player.y < state.height - 42);
  assert.equal(player.px, state.width - 30); assert.equal(player.py, state.height - 42);
  beginLevel(state, 1);
  const next = state.players[0];
  assert.equal(next.x, next.px); assert.equal(next.y, next.py);
  assert.equal(next.vx, 0); assert.equal(next.vy, 0);
});

check('enemies enter without phase teleports and larger hulls turn more slowly', () => {
  const state = isolated(), small = spawnEnemy(state, 0, 600), heavy = spawnEnemy(state, 6, 600), boss = spawnEnemy(state, 9, 600, -160);
  small.seed = heavy.seed = Math.PI / 2;
  update(state, 1 / 120);
  for (const enemy of [small, heavy, boss]) {
    assert.ok(Math.abs(enemy.x - 600) < .1, 'spawn begins at the requested location');
    assert.equal(enemy.px, 600);
    assert.ok(Number.isFinite(enemy.vx) && Number.isFinite(enemy.vy) && enemy.thrust > 0);
  }
  small.seed = heavy.seed = 0;
  advance(state, .2);
  assert.ok(heavy.mass > small.mass);
  assert.ok(heavy.vx < small.vx);
});

check('pickups repair without exceeding stats', () => {
  const state = isolated(), player = state.players[0];
  player.hull = 115; player.shield = 80;
  state.pickups.push({ x: player.x, y: player.y, age: 0, kind: 'repair' });
  update(state, .016);
  assert.equal(player.hull, player.maxHull);
  assert.equal(player.shield, player.maxShield);
  assert.equal(state.pickups.length, 0);
});

check('checkpoint restoration sanitizes upgrade tiers and preserves earned progress', () => {
  const state = createCampaign(7, { upgrades: { weapon: 100, hull: -2, shield: '3', recharge: 'bad' }, credits: 1234, score: 78901, totalKills: 72 });
  assert.deepEqual(state.upgrades, { weapon: 6, hull: 0, shield: 3, recharge: 0 });
  assert.equal(state.players.length, 1);
  assert.equal(state.level, 7);
  assert.equal(state.credits, 1234);
  assert.equal(state.score, 78901);
  assert.equal(state.totalKills, 72);
});

// ——— Choreography, power, drones, novas, reserve ships and challenging stages ———
function scripted(level = 0) {
  const state = createCampaign(level);
  state.players[0].hurt = Infinity;
  return state;
}
function runUntil(state, predicate, seconds = 120, controls = []) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    if (predicate(state)) return true;
    update(state, 1 / 60, controls); state.events.length = 0;
  }
  return predicate(state);
}

check('flight paths are smooth, start offscreen and exit paths leave the arena', () => {
  for (const name of Object.keys(PATHS)) for (const width of [430, 1200, 1900]) {
    const table = pathTable(name, width), start = pathPoint(table, 0);
    const x = width / 2 + start.x;
    assert.ok(start.y < -80 || x < -60 || x > width + 60, `${name} begins out of sight at ${width}`);
    let previous = start;
    for (let d = 20; d <= table.length; d += 20) {
      const point = pathPoint(table, d);
      assert.ok(Math.hypot(point.x - previous.x, point.y - previous.y) < 21, `${name} has no jumps`);
      previous = point;
    }
    if (PATHS[name].exit) {
      const end = pathPoint(table, table.length), ex = width / 2 + end.x;
      assert.ok(end.y > 1000 || end.y < -100 || ex < -60 || ex > width + 60, `${name} exits the arena`);
    }
  }
});

check('squadrons enter in conga lines, settle into a breathing hive and never collide with the HUD', () => seeded(31, () => {
  const state = scripted(3);
  assert.ok(runUntil(state, s => s.director.kind === 'hive' && s.director.clock > .1, 10));
  const members = state.enemies.filter(enemy => enemy.wave === 0);
  assert.equal(members.length, 28);
  assert.ok(members.every(enemy => enemy.ai === 'entry'));
  assert.ok(members.filter(isDormant).length > 20, 'later ships wait their turn offscreen');
  assert.ok(runUntil(state, s => s.enemies.filter(enemy => enemy.ai === 'hive').length >= 12, 25));
  const slots = state.enemies.filter(enemy => enemy.ai === 'hive').map(enemy => hiveSlot(state, enemy));
  assert.ok(slots.every(slot => slot.y > 150 && slot.y < 400), 'the hive sits below the HUD and above the pilot');
  assert.equal(new Set(slots.map(slot => `${Math.round(slot.x)}:${Math.round(slot.y)}`)).size, slots.length, 'every ship has its own slot');
}));

check('hive ships dive at the pilot, fire during the swoop, wrap to the top and return to their slot', () => seeded(44, () => {
  const state = scripted(2);
  let diver = null, fired = false;
  for (let t = 0; t < 40 && !diver; t += 1 / 60) {
    update(state, 1 / 60); fired ||= state.bullets.some(b => b.team < 0); state.events.length = 0;
    diver = state.enemies.find(enemy => enemy.ai === 'dive' && enemy.slotCount && enemy.type !== 0);
  }
  assert.ok(diver, 'a ship leaves the hive to dive');
  const id = diver.id;
  let wrapped = false, lowest = 0;
  for (let t = 0; t < 12; t += 1 / 60) {
    update(state, 1 / 60); fired ||= state.bullets.some(b => b.team < 0); state.events.length = 0;
    const ship = state.enemies.find(enemy => enemy.id === id);
    if (!ship) break;
    lowest = Math.max(lowest, ship.y);
    if (ship.ai === 'join' && ship.y < 100) wrapped = true;
    if (wrapped && ship.ai === 'hive') break;
  }
  assert.ok(lowest > state.height * .75, 'the dive reaches the pilot lane');
  assert.ok(wrapped, 'the diver reappears above the arena');
  assert.ok(fired, 'divers return fire');
}));

check('a ship destroyed mid-dive is worth double', () => {
  const calm = scripted(), diving = scripted();
  for (const state of [calm, diving]) { state.director.hold = true; state.bossSpawned = true; }
  const a = spawnEnemy(calm, 2, 400, 300), b = spawnEnemy(diving, 2, 400, 300);
  b.ai = 'dive';
  killEnemy(calm, a); killEnemy(diving, b);
  assert.equal(diving.score, calm.score * 2);
  assert.equal(diving.stats.dives, 1);
});

check('wiping a whole squadron pays once; an escapee cancels the bonus', () => {
  const state = scripted(); state.director.hold = true;
  const squad = { id: 7, size: 3, killed: 0, broken: false, wave: 0 };
  state.squadrons.push(squad);
  const ships = [0, 1, 2].map(i => Object.assign(spawnEnemy(state, 1, 300 + i * 80, 300), { squad: 7 }));
  killEnemy(state, ships[0]); killEnemy(state, ships[1]);
  const before = state.score;
  killEnemy(state, ships[2]);
  assert.ok(state.events.some(event => event.type === 'squadron'));
  assert.ok(state.score > before + 200);
  assert.equal(state.stats.squads, 1);
  assert.ok(state.pickups.some(pickup => pickup.kind === 'power'), 'the first wiped squadron drops a power core');
  const broken = scripted(); broken.director.hold = true;
  broken.squadrons.push({ id: 9, size: 2, killed: 0, broken: false, wave: 0 });
  const [stay, leave] = [0, 1].map(i => Object.assign(spawnEnemy(broken, 1, 300 + i * 80, 300), { squad: 9 }));
  Object.assign(leave, { ai: 'leave', leaveDx: 0, leaveDy: -1, y: -400 });
  update(broken, 1 / 60); broken.events.length = 0;
  killEnemy(broken, stay);
  assert.ok(!broken.events.some(event => event.type === 'squadron'));
});

check('the sector director advances wave by wave to the guardian when the sky is cleared', () => seeded(5, () => {
  const state = scripted(0), waves = [];
  for (let t = 0; t < 400 && !state.bossSpawned; t += 1 / 30) {
    update(state, 1 / 30);
    waves.push(...state.events.filter(event => event.type === 'wave').map(event => event.wave));
    state.events.length = 0;
    for (const enemy of state.enemies) if (!enemy.dead && !isDormant(enemy) && enemy.y > 0 && enemy.y < state.height && enemy.x > 0 && enemy.x < state.width) killEnemy(state, enemy);
  }
  assert.ok(state.bossSpawned);
  assert.deepEqual(waves, sectorPlan(0).map((_, index) => index + 1));
  assert.ok(state.time < 200, `cleared quickly, sector took ${state.time.toFixed(1)}s`);
}));

check('power cores widen every primary, cap at five levels, and a hull breach knocks one loose', () => {
  for (const weapon of PRIMARIES) {
    const counts = [];
    for (let power = 0; power <= MAX_POWER; power++) {
      const state = isolated(); state.primary = weapon.id; state.players[0].power = power;
      counts.push(primaryStats(state).count);
      const dps = primaryStats(state).volley.reduce((sum, bolt) => sum + (bolt[2] ?? 1), 0) * primaryStats(state).damage / primaryStats(state).interval;
      if (power) assert.ok(dps > counts.dps, `${weapon.id} power ${power + 1} is stronger`);
      counts.dps = dps;
    }
    for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1], `${weapon.id} volley never shrinks`);
  }
  const state = isolated(), player = state.players[0];
  for (let i = 0; i < 6; i++) { state.pickups.push({ x: player.x, y: player.y, age: 0, kind: 'power', value: 0 }); update(state, 1 / 60); }
  assert.equal(player.power, MAX_POWER);
  hurtPlayer(state, player, 20);
  assert.equal(player.power, MAX_POWER, 'shield-absorbed hits keep power');
  player.shield = 0; player.hurt = 0;
  hurtPlayer(state, player, 20);
  assert.equal(player.power, MAX_POWER - 1);
  const core = state.pickups.find(pickup => pickup.kind === 'power');
  assert.ok(core && core.lock > 0, 'the dropped core cannot be collected instantly');
  update(state, 1 / 60); assert.equal(player.power, MAX_POWER - 1);
  update(state, 1.2); for (let i = 0; i < 90 && player.power < MAX_POWER; i++) update(state, 1 / 60, [{ x: Math.sign(core.x - player.x), y: Math.sign(core.y - player.y) }]);
  assert.equal(player.power, MAX_POWER, 'the loose core can be caught again');
});

check('the shop sells primaries once, equips owned guns and caps supplies', () => {
  const state = isolated(); state.status = 'hangar'; state.credits = 100000;
  assert.equal(buyPrimary(state, 'scatter'), true); assert.equal(state.primary, 'scatter');
  const afterScatter = state.credits;
  assert.equal(buyPrimary(state, 'pulse'), true); assert.equal(buyPrimary(state, 'scatter'), true);
  assert.equal(state.credits, afterScatter, 'owned guns switch for free');
  assert.equal(buyPrimary(state, 'railgun'), false);
  for (let i = 0; i < 9; i++) buySupply(state, 'drone');
  assert.equal(state.players[0].drones, MAX_DRONES);
  for (let i = 0; i < 9; i++) buySupply(state, 'bomb');
  assert.equal(state.players[0].bombs, MAX_BOMBS);
  const first = supplyCost(state, 'life'); buySupply(state, 'life');
  assert.ok(supplyCost(state, 'life') > first, 'reserve ships grow more expensive');
  for (let i = 0; i < 9; i++) buySupply(state, 'life');
  assert.equal(state.lives, MAX_LIVES);
  state.status = 'playing'; assert.equal(buySupply(state, 'bomb'), false);
  beginLevel(state, 2);
  assert.equal(state.primary, 'scatter'); assert.equal(state.players[0].drones, MAX_DRONES); assert.equal(state.players[0].bombs, MAX_BOMBS);
  const retry = createCampaign(2, state);
  assert.equal(retry.primary, 'scatter'); assert.deepEqual(retry.owned, ['pulse', 'scatter']);
  update(state, .01, [{ fire: true }]);
  assert.ok(state.bullets.filter(b => b.kind === 'scatter').length >= 3);
  assert.equal(state.bullets.filter(b => b.drone).length, 2, 'each drone echoes the primary volley');
});

check('wing drones follow in formation and soak up hostile rounds', () => {
  const state = isolated(), player = state.players[0];
  player.drones = 2; advance(state, .5);
  assert.equal(player.wing.length, 2);
  assert.ok(player.wing[0].x < player.x && player.wing[1].x > player.x);
  const drone = player.wing[1];
  state.bullets.push({ ...bolt(drone.x, drone.y - 30, -1, 50, 0, 300), kind: 'hostile' });
  const hull = player.hull, shield = player.shield;
  advance(state, .2);
  assert.equal(state.bullets.filter(b => b.team < 0).length, 0);
  assert.deepEqual([player.hull, player.shield], [hull, shield]);
});

check('a captor steals a drone with its tractor beam, and destroying it brings the drone home', () => {
  const state = createCampaign(0), player = state.players[0];
  state.director.wave = 5; state.director.clock = 99; player.drones = 2; player.hurt = Infinity;
  let captor = null;
  for (let t = 0; t < 12 && !captor?.captive; t += 1 / 60) {
    captor = state.enemies.find(enemy => enemy.ai === 'captor');
    const dx = captor ? Math.sign(captor.x - player.x) * (Math.abs(captor.x - player.x) > 12) : 0;
    update(state, 1 / 60, [{ x: dx }]); state.events.length = 0;
  }
  assert.ok(captor?.captive, 'the beam captures a drone');
  assert.equal(player.drones, 1);
  let captiveShot = false;
  for (let t = 0; t < 4; t += 1 / 60) { update(state, 1 / 60); captiveShot ||= state.bullets.some(b => b.team < 0 && b.y > captor.y + captor.radius); state.events.length = 0; }
  assert.ok(captiveShot, 'the captured drone fires on its pilot');
  killEnemy(state, captor);
  assert.equal(player.drones, 2);
  assert.equal(state.stats.rescues, 1);
  assert.ok(state.events.some(event => event.type === 'rescue'));
});

check('without a drone to steal, the tractor beam drains shields and energy', () => {
  const state = createCampaign(0), player = state.players[0];
  state.director.wave = 5; state.director.clock = 99; player.hurt = Infinity;
  let drained = false;
  for (let t = 0; t < 10 && !drained; t += 1 / 60) {
    const captor = state.enemies.find(enemy => enemy.ai === 'captor');
    const dx = captor ? Math.sign(captor.x - player.x) * (Math.abs(captor.x - player.x) > 12) : 0;
    update(state, 1 / 60, [{ x: dx }]); state.events.length = 0;
    drained = player.shield < player.maxShield - 20 && player.fireEnergy < 60;
  }
  assert.ok(drained);
  assert.equal(player.hull, player.maxHull, 'the beam never breaches the hull');
});

check('a nova clears hostile fire, strikes every visible ship, shields the pilot and needs a fresh press', () => {
  const state = isolated(1), player = state.players[0];
  for (let i = 0; i < 20; i++) state.bullets.push({ ...bolt(100 + i * 40, 300, -1, 10, 0, 50), kind: 'hostile' });
  const small = spawnEnemy(state, 0, 400, 300), heavy = spawnEnemy(state, 8, 800, 250), hidden = spawnEnemy(state, 0, 600, -300);
  for (const enemy of [small, heavy, hidden]) enemy.fire = Infinity;
  const bombs = player.bombs, score = state.score;
  update(state, 1 / 60, [{ bomb: true }]);
  assert.equal(player.bombs, bombs - 1);
  assert.equal(state.bullets.filter(b => b.team < 0).length, 0);
  assert.ok(small.dead && !heavy.dead && heavy.hp < heavy.maxHp && !hidden.dead);
  assert.ok(state.score > score + 20 * 10);
  assert.ok(player.guard > 1);
  update(state, 1 / 60, [{ bomb: true }]);
  assert.equal(player.bombs, bombs - 1, 'holding the key does not chain detonations');
  update(state, 1 / 60, [{}]); update(state, 1 / 60, [{ bomb: true }]);
  assert.equal(player.bombs, bombs - 2);
  player.bombs = 0; update(state, 1 / 60, [{}]); update(state, 1 / 60, [{ bomb: true }]);
  assert.equal(player.bombs, 0);
});

check('reserve ships relaunch after a delay with a launch shield and a lighter loadout', () => {
  const state = isolated(1), player = state.players[0];
  assert.equal(state.lives, START_LIVES);
  Object.assign(player, { power: 3, drones: 2, bombs: 0 });
  player.shield = 0; hurtPlayer(state, player, 10000);
  assert.equal(player.alive, false); assert.equal(player.power, 1); assert.equal(player.drones, 1);
  advance(state, RESPAWN_DELAY - .1);
  assert.equal(player.alive, false); assert.equal(state.status, 'playing');
  advance(state, .2);
  assert.equal(player.alive, true); assert.equal(state.lives, START_LIVES - 1);
  assert.equal(player.hull, player.maxHull); assert.ok(player.guard > 2); assert.equal(player.bombs, 2);
  hurtPlayer(state, player, 500);
  assert.equal(player.hull, player.maxHull, 'the launch shield blocks damage');
  state.lives = 0; player.guard = 0; player.shield = 0; hurtPlayer(state, player, 10000); update(state, 1 / 60);
  assert.equal(state.status, 'defeat');
});

check('score milestones award extra ships up to the hangar limit', () => {
  const state = isolated(1), lives = state.lives;
  state.score = FIRST_EXTRA_LIFE; update(state, 1 / 60);
  assert.equal(state.lives, lives + 1);
  update(state, 1 / 60); assert.equal(state.lives, lives + 1, 'each milestone pays once');
  state.lives = MAX_LIVES; state.score = state.nextLife; const credits = state.credits; update(state, 1 / 60);
  assert.equal(state.lives, MAX_LIVES); assert.ok(state.credits > credits);
});

check('challenging stages follow odd sectors, never fire back, and pay a perfect bonus once', () => {
  assert.deepEqual([...Array(10).keys()].filter(level => challengeSector({ level })), [0, 2, 4, 6, 8]);
  const state = isolated(0);
  killEnemy(state, spawnEnemy(state, 9, 600, 155));
  advance(state, 3.4);
  assert.ok(state.challenge && state.challenge.total === CHALLENGE_SIZE);
  const ships = state.enemies.filter(enemy => enemy.challenge);
  assert.equal(ships.length, CHALLENGE_SIZE);
  assert.ok(ships.every(enemy => enemy.harmless && enemy.noFire));
  const hull = state.players[0].hull;
  for (let t = 0; t < 40 && !state.challenge.done; t += 1 / 60) {
    update(state, 1 / 60); state.events.length = 0;
    for (const enemy of state.enemies) if (enemy.challenge && !enemy.dead && !isDormant(enemy) && enemy.y > 0 && enemy.x > 0 && enemy.x < state.width) killEnemy(state, enemy);
  }
  assert.equal(state.challenge.hits, CHALLENGE_SIZE);
  assert.equal(state.bullets.filter(b => b.team < 0).length, 0);
  assert.equal(state.players[0].hull, hull);
  assert.ok(state.challenge.credits >= 700, 'a perfect stage pays its bonus');
  const credits = state.credits;
  advance(state, 3);
  assert.equal(state.status, 'hangar');
  assert.equal(state.credits, credits + 650);
});

check('lancers paint a firing line before a short beam that only hurts inside the line', () => {
  const state = isolated(1), player = state.players[0];
  const lancer = spawnEnemy(state, 5, player.x, 200);
  Object.assign(lancer, { ai: 'station', stationX: player.x, stationY: 200, hold: 60, sway: 0, fire: 0 });
  update(state, 1 / 60);
  assert.equal(state.beams.length, 1);
  const hull = player.hull + player.shield;
  advance(state, state.beams[0].warn - .1);
  assert.equal(player.hull + player.shield, hull, 'the telegraph is harmless');
  advance(state, .3);
  assert.ok(player.hull + player.shield < hull, 'standing in the line is punished');
  const dodge = isolated(1), pilot = dodge.players[0];
  const other = spawnEnemy(dodge, 5, pilot.x, 200);
  Object.assign(other, { ai: 'station', stationX: pilot.x, stationY: 200, hold: 60, sway: 0, fire: 0 });
  update(dodge, 1 / 60);
  const total = pilot.hull + pilot.shield;
  advance(dodge, 1.2, [{ x: 1 }]);
  assert.equal(pilot.hull + pilot.shield, total, 'leaving the line avoids the beam');
});

check('central bolts strike the ground; wide volley bolts and drone bolts fly over it', () => {
  const state = isolated(), player = state.players[0];
  player.power = MAX_POWER; player.drones = 2; advance(state, .3);
  state.bullets.length = 0; player.fire = 0;
  update(state, 1 / 60, [{ fire: true }]);
  const ground = state.bullets.filter(b => b.ground !== false);
  assert.ok(ground.length >= 2 && ground.length <= 3);
  assert.ok(state.bullets.filter(b => b.drone).every(b => b.ground === false));
});

check('pickups dropped past either edge move into the flight lane and stay collectible', () => {
  const state = isolated(1);
  state.pickups.push({ x: -40, y: 300, age: 0, kind: 'power', value: 0 }, { x: state.width + 60, y: 300, age: 0, kind: 'credit', value: 50 });
  update(state, 1 / 60);
  assert.ok(state.pickups.every(pickup => pickup.x >= 30 && pickup.x <= state.width - 30));
});

// Human-like bot: only the public update() input surface; no edits to HP, enemy
// state, projectiles, currency, timer, or positions. Controls refresh at 10 Hz.
function pilotControls(state, pilot) {
  if (!pilot.alive) return {};
  let target = null, priority = -Infinity;
  for (const enemy of state.enemies) {
    if (enemy.dead || enemy.y > pilot.y - 35 || enemy.y < 0 || isDormant(enemy)) continue;
    const score = enemy.boss ? 2000 : enemy.y - Math.abs(enemy.x - pilot.x) * .5 + enemy.radius * 2;
    if (score > priority) { target = enemy; priority = score; }
  }
  let aimX = state.width * .5;
  if (target) {
    const flight = Math.max(0, (pilot.y - target.y) / 850);
    aimX = target.boss ? state.width / 2 + Math.sin((target.age + flight) * .48) * Math.min(235, state.width * .24) : target.x;
  }
  const threats = state.bullets.filter(b => b.team < 0 && Math.hypot(b.x - pilot.x, b.y - pilot.y) < 290);
  let best = null, bestScore = Infinity;
  for (const x of [-1,0,1]) for (const y of [-1,0,1]) {
    const norm = Math.max(1, Math.hypot(x,y)), vx = x / norm * 365, vy = y / norm * 365;
    const px = pilot.x + vx * .23, py = pilot.y + vy * .23;
    let score = Math.abs(px - aimX) * .08 + Math.abs(py - state.height * .77) * .016;
    if (px < 35 || px > state.width - 35 || py < 115 || py > state.height - 50) score += 80;
    for (const bullet of threats) {
      const rx = bullet.x - pilot.x, ry = bullet.y - pilot.y;
      const dx = bullet.vx - vx, dy = bullet.vy - vy;
      const time = Math.max(0, Math.min(.48, -(rx * dx + ry * dy) / (dx * dx + dy * dy || 1)));
      const separation = Math.hypot(rx + dx * time, ry + dy * time);
      score += Math.max(0, 1 - separation / 70) ** 3 * 85 * (1 - time);
    }
    for (const enemy of state.enemies) {
      if (enemy.dead || isDormant(enemy)) continue;
      const separation = Math.hypot(enemy.x - px, enemy.y + enemy.speed * .23 - py);
      score += Math.max(0, 1 - separation / (enemy.radius + 50)) ** 2 * 100;
    }
    if (score < bestScore) { bestScore = score; best = { x, y, fire: true }; }
  }
  return best;
}

function buyBalanced(state) {
  // Prioritize enough firepower to kill capital ships; buy defense in between.
  const desired = [2,4,5,6,6,6,6,6,6][state.level];
  while (state.upgrades.weapon < desired && buyUpgrade(state, 'weapon')) {}
  for (let i = 0; i < 18; i++) {
    const choices = ['recharge','shield','hull'].filter(id => state.upgrades[id] < MAX_UPGRADE)
      .sort((a,b) => state.upgrades[a] - state.upgrades[b] || upgradeCost(state,a) - upgradeCost(state,b));
    if (!choices.some(id => buyUpgrade(state, id))) break;
  }
}

function runCampaign(seed) {
  return seeded(seed, () => {
    const state = createCampaign(), results = [];
    let controls = [], tick = 0;
    while (state.status !== 'victory' && state.status !== 'defeat') {
      const startingCredits = state.credits, startingUpgrades = { ...state.upgrades };
      while (state.status === 'playing' && state.time < 600) {
        if (tick++ % 3 === 0) controls = state.players.map(p => pilotControls(state, p));
        update(state, 1 / 30, controls);
        state.events.length = 0;
      }
      results.push({ sector: state.level + 1, status: state.status, seconds: Math.round(state.time), kills: state.kills,
        earned: state.credits - startingCredits, hull: state.players.map(p => Math.round(p.hull)), lives: state.lives, power: state.players[0].power, drones: state.players[0].drones,
        bossHP: Math.round(state.enemies.find(e => e.boss)?.hp || 0), upgrades: startingUpgrades });
      if (state.status !== 'hangar') break;
      buyBalanced(state);
      beginLevel(state, state.level + 1);
    }
    return { seed, status: state.status, results };
  });
}

if (process.argv.includes('--balance')) {
  for (const seed of [2907]) {
    const result = runCampaign(seed);
    console.log(`BALANCE ${JSON.stringify(result)}`);
    check('campaign is winnable using movement, shooting, and earned upgrades', () => assert.equal(result.status, 'victory'));
  }
  const stationary = seeded(817, () => {
    // Reserve ships can carry a motionless pilot through the gentle opening
    // sectors, but never without losses, and never through the third.
    const state = createCampaign(), sectors = [];
    for (let sector = 0; sector < 3 && state.status !== 'defeat'; sector++) {
      while (state.status === 'playing' && state.time < 500) { update(state, .05, [{ fire: true }]); state.events.length = 0; }
      sectors.push({ status: state.status, seconds: Math.round(state.time), kills: state.kills, lives: state.lives });
      if (state.status === 'hangar') beginLevel(state, state.level + 1);
    }
    return { status: state.status, sectors };
  });
  console.log(`STATIONARY ${JSON.stringify(stationary)}`);
  check('stationary firing costs ships in the first sector and cannot survive the third', () => {
    assert.equal(stationary.status, 'defeat');
    assert.ok(stationary.sectors[0].status === 'defeat' || stationary.sectors[0].lives < START_LIVES + 1, 'the first sector costs ships');
  });
}

if (failures) process.exitCode = 1;
else console.log('All simulation checks passed.');
