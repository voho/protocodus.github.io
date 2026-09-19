import assert from 'node:assert/strict';
import { ENEMY_TYPES } from '../ships.js';
import { createCampaign, beginLevel, update, spawnEnemy, killEnemy, hurtPlayer,
  spawnFormation, selectWeapon, weaponStats, WEAPONS, buyUpgrade, upgradeCost, shipStats, UPGRADES, MAX_UPGRADE } from '../sim.js';

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
function isolated(mode = 1, level = 0) {
  const state = createCampaign(mode, level);
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

check('weapon profiles trade power for speed, range and utility', () => {
  assert.equal(WEAPONS.length, 6);
  assert.equal(new Set(WEAPONS.map(weapon => weapon.id)).size, WEAPONS.length);
  const state = isolated();
  const dps = WEAPONS.map(weapon => {
    const stats = weaponStats(state, weapon.id);
    assert.ok(stats.damage > 0 && stats.interval > 0 && stats.count > 0);
    return stats.damage * stats.count / stats.interval;
  });
  assert.ok(Math.max(...dps) / Math.min(...dps) < 2.6, 'no profile is an automatic best pick');
  assert.ok(weaponStats(state, 'lance').pierce > 0);
  assert.ok(weaponStats(state, 'seeker').homing > 0);
  assert.ok(weaponStats(state, 'plasma').splash > 0);
  assert.ok(weaponStats(state, 'arc').chain > 0);
  for (const weapon of WEAPONS) {
    selectWeapon(state, weapon.id);
    state.players[0].fire = 0;
    update(state, .01, [{ fire: true }]);
    assert.ok(state.bullets.some(b => b.kind === weapon.kind), `${weapon.id} emits its projectile type`);
    state.bullets.length = 0;
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
    const state = createCampaign(1, 9);
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

check('all ten sectors introduce all nine normal classes and one boss', () => seeded(7261, () => {
  for (let level = 0; level < 10; level++) {
    const state = createCampaign(1, level), seen = new Set();
    // Ignore damage only for this spawn-schedule check; balance trials use real HP.
    state.players[0].hurt = Infinity;
    let bossEvents = 0;
    for (let t = 0; t < state.duration + 3; t += .05) {
      update(state, .05);
      state.enemies.forEach(e => seen.add(e.type));
      bossEvents += state.events.filter(e => e.type === 'boss').length;
      state.events.length = 0;
    }
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
  const state = isolated(), player = state.players[0];
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
    const state = isolated(1, level), boss = spawnEnemy(state, 9, 600, 155);
    killEnemy(state, boss);
    const priorCredits = state.credits, priorScore = state.score;
    advance(state, 3);
    assert.equal(state.status, 'playing');
    advance(state, .3);
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
    const state = createCampaign(1, 0, { upgrades: { recharge } }), player = state.players[0];
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

check('co-op survives one loss and restores both pilots with shared upgrades next sector', () => {
  const state = isolated(2), first = state.players[0];
  hurtPlayer(state, first, 10000);
  update(state, .016);
  assert.equal(state.status, 'playing');
  assert.equal(first.alive, false);
  killEnemy(state, spawnEnemy(state, 9, 600, 155));
  advance(state, 3.3);
  assert.equal(state.status, 'hangar');
  assert.ok(buyUpgrade(state, 'hull'));
  assert.ok(buyUpgrade(state, 'shield'));
  const credits = state.credits, score = state.score;
  beginLevel(state, 1);
  assert.equal(state.credits, credits);
  assert.equal(state.score, score);
  assert.equal(state.enemies.length, 0);
  for (const pilot of state.players) {
    assert.ok(pilot.alive);
    assert.equal(pilot.hull, 165);
    assert.equal(pilot.shield, 123);
  }
  for (const pilot of state.players) hurtPlayer(state, pilot, 10000);
  update(state, .016);
  assert.equal(state.status, 'defeat');
});

check('boss attacks change at damage thresholds and co-op enemy HP scales', () => {
  for (const [fraction, phase, bullets] of [[1,0,9],[.6,1,13],[.25,2,17]]) {
    const state = isolated(), boss = spawnEnemy(state, 9, 600, 155);
    boss.hp = boss.maxHp * fraction; boss.fire = 0;
    update(state, .016);
    assert.equal(boss.phase, phase);
    assert.equal(state.bullets.filter(b => b.team < 0).length, bullets);
  }
  const solo = spawnEnemy(isolated(1, 9), 9, 600, 155);
  const duo = spawnEnemy(isolated(2, 9), 9, 600, 155);
  assert.ok(Math.abs(duo.maxHp / solo.maxHp - 1.65) < .0001);
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
  const light = isolated(), heavy = createCampaign(1, 0, { upgrades: { hull: 6, weapon: 6, shield: 6, recharge: 6 } });
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
  assert.equal(next.vx, 0); assert.equal(next.vy, 0); assert.equal(next.bank, 0);
});

check('enemies enter without phase teleports and larger hulls turn and bank more slowly', () => {
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
  assert.ok(heavy.vx < small.vx && Math.abs(heavy.bank) < Math.abs(small.bank));
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
  const state = createCampaign(2, 7, { upgrades: { weapon: 100, hull: -2, shield: '3', recharge: 'bad' }, credits: 1234, score: 78901, totalKills: 72 });
  assert.deepEqual(state.upgrades, { weapon: 6, hull: 0, shield: 3, recharge: 0 });
  assert.equal(state.players.length, 2);
  assert.equal(state.level, 7);
  assert.equal(state.credits, 1234);
  assert.equal(state.score, 78901);
  assert.equal(state.totalKills, 72);
});

// Human-like bot: only the public update() input surface; no edits to HP, enemy
// state, projectiles, currency, timer, or positions. Controls refresh at 10 Hz.
function pilotControls(state, pilot) {
  if (!pilot.alive) return {};
  let target = null, priority = -Infinity;
  for (const enemy of state.enemies) {
    if (enemy.dead || enemy.y > pilot.y - 35) continue;
    const score = enemy.boss ? 2000 : enemy.y - Math.abs(enemy.x - pilot.x) * .5 + enemy.radius * 2;
    if (score > priority) { target = enemy; priority = score; }
  }
  let aimX = state.width * (.5 + (state.mode === 2 ? pilot.id ? .16 : -.16 : 0));
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
      if (enemy.dead) continue;
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

function runCampaign(mode, seed) {
  return seeded(seed, () => {
    const state = createCampaign(mode), results = [];
    let controls = [], tick = 0;
    while (state.status !== 'victory' && state.status !== 'defeat') {
      const startingCredits = state.credits, startingUpgrades = { ...state.upgrades };
      while (state.status === 'playing' && state.time < 240) {
        if (tick++ % 3 === 0) controls = state.players.map(p => pilotControls(state, p));
        update(state, 1 / 30, controls);
        state.events.length = 0;
      }
      results.push({ sector: state.level + 1, status: state.status, seconds: Math.round(state.time), kills: state.kills,
        earned: state.credits - startingCredits, hull: state.players.map(p => Math.round(p.hull)),
        bossHP: Math.round(state.enemies.find(e => e.boss)?.hp || 0), upgrades: startingUpgrades });
      if (state.status !== 'hangar') break;
      buyBalanced(state);
      beginLevel(state, state.level + 1);
    }
    return { mode, seed, status: state.status, results };
  });
}

if (process.argv.includes('--balance')) {
  for (const mode of [1,2]) {
    const result = runCampaign(mode, 2907);
    console.log(`BALANCE ${JSON.stringify(result)}`);
    check(`${mode === 1 ? 'solo' : 'co-op'} campaign is winnable using movement, shooting, and earned upgrades`, () => assert.equal(result.status, 'victory'));
  }
  const stationary = seeded(817, () => {
    const state = createCampaign();
    while (state.status === 'playing' && state.time < 220) { update(state, .05, [{ fire: true }]); state.events.length = 0; }
    return { status: state.status, seconds: Math.round(state.time), kills: state.kills, hull: Math.round(state.players[0].hull) };
  });
  console.log(`STATIONARY ${JSON.stringify(stationary)}`);
  check('stationary firing cannot survive the first sector', () => assert.equal(stationary.status, 'defeat'));
}

if (failures) process.exitCode = 1;
else console.log('All simulation checks passed.');
