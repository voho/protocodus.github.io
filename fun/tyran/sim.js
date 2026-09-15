import { ENEMY_TYPES } from './ships.js';

export const UPGRADES = [
  { id: 'weapon', name: 'Ion armament', subtitle: 'More damage. Wider volleys.', base: 420, icon: '⌁' },
  { id: 'shield', name: 'Flux shield', subtitle: 'A larger energy barrier.', base: 340, icon: '◇' },
  { id: 'hull', name: 'Titanium hull', subtitle: 'Stronger armor. More inertia.', base: 300, icon: '⬡' },
  { id: 'recharge', name: 'Fusion capacitor', subtitle: 'Recover shields faster, sooner.', base: 280, icon: 'ϟ' },
];
export const MAX_UPGRADE = 6;
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const rand = (a, b) => a + Math.random() * (b - a);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const upgradeCost = (s, id) => Math.round(UPGRADES.find(u => u.id === id).base * 1.55 ** s.upgrades[id]);
export const shipStats = u => ({ hull: 120 + u.hull * 45, shield: 85 + u.shield * 38, recharge: 10 + u.recharge * 5, delay: Math.max(.8, 3.2 - u.recharge * .35), damage: 13 + u.weapon * 6,
  mass: 1 + u.hull * .055 + u.weapon * .018 + u.shield * .014 + u.recharge * .008 });

export const PLAYER_SPEED = 365;
// Time constants in seconds: upgrades add a little weight, but retain full top
// speed. Integrating both velocity and distance analytically keeps steering the
// same at 30, 60 and 120 Hz and preserves a short, controlled coast on release.
function accelerate(body, targetX, targetY, response, dt) {
  const decay = Math.exp(-dt / response), travel = response * (1 - decay);
  body.x += targetX * dt + (body.vx - targetX) * travel;
  body.y += targetY * dt + (body.vy - targetY) * travel;
  body.vx = targetX + (body.vx - targetX) * decay;
  body.vy = targetY + (body.vy - targetY) * decay;
}

function constrain(body, left, right, top = -Infinity, bottom = Infinity) {
  if (body.x <= left) { body.x = left; body.vx = Math.max(0, body.vx); }
  if (body.x >= right) { body.x = right; body.vx = Math.min(0, body.vx); }
  if (body.y <= top) { body.y = top; body.vy = Math.max(0, body.vy); }
  if (body.y >= bottom) { body.y = bottom; body.vy = Math.min(0, body.vy); }
}

// Most bolts are nowhere near a hull. Reject against the swept rectangle first;
// only nearby candidates need a projection. Squared distances avoid a square
// root, and strict comparison preserves the original non-hit at exact tangency.
function segmentHits(b, body, radius) {
  if (body.x + radius <= b.left || body.x - radius >= b.right ||
      body.y + radius <= b.top || body.y - radius >= b.bottom) return false;
  const dx = b.x - b.px, dy = b.y - b.py;
  const t = clamp(((body.x - b.px) * dx + (body.y - b.py) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  const gapX = b.px + t * dx - body.x, gapY = b.py + t * dy - body.y;
  return gapX * gapX + gapY * gapY < radius * radius;
}

export function createCampaign(mode = 1, level = 0, checkpoint = null) {
  const state = {
    mode: mode === 2 ? 2 : 1, level: clamp(level, 0, 9), status: 'playing',
    upgrades: { weapon: 0, shield: 0, hull: 0, recharge: 0 }, credits: 0, score: 0,
    width: 1200, height: 900, time: 0, scroll: 0, enemies: [], bullets: [], pickups: [], players: [],
    events: [], kills: 0, destroyed: 0, totalKills: 0, combo: 0, comboTime: 0,
    bossSpawned: false, bossDefeated: false, bossDeathTime: 0, spawnTimer: 1, showcase: 0,
  };
  if (checkpoint) {
    for (const id of Object.keys(state.upgrades)) state.upgrades[id] = clamp(Math.floor(Number(checkpoint.upgrades?.[id]) || 0), 0, MAX_UPGRADE);
    state.credits = clamp(Number(checkpoint.credits) || 0, 0, 9999999);
    state.score = clamp(Number(checkpoint.score) || 0, 0, 999999999);
    state.totalKills = clamp(Number(checkpoint.totalKills) || 0, 0, 9999999);
  }
  beginLevel(state, state.level);
  return state;
}

export function beginLevel(s, level) {
  Object.assign(s, { level: clamp(level, 0, 9), time: 0, scroll: 0, status: 'playing', enemies: [], bullets: [], pickups: [], events: [], kills: 0, destroyed: 0, combo: 0, comboTime: 0, bossSpawned: false, bossDefeated: false, bossDeathTime: 0, spawnTimer: 1.5, showcase: 0 });
  s.duration = 90 + s.level * 3;
  const stats = shipStats(s.upgrades);
  s.players = Array.from({ length: s.mode }, (_, i) => {
    const x = s.width * (s.mode === 1 ? .5 : i ? .62 : .38), y = s.height * .78;
    return { id: i, x, y, px: x, py: y, vx: 0, vy: 0, mass: stats.mass, thrust: .9, radius: 17, hull: stats.hull, shield: stats.shield, maxHull: stats.hull, maxShield: stats.shield, fire: 0, hurt: 0, lastHit: -10, bank: 0, alive: true };
  });
  return s;
}

export function buyUpgrade(s, id) {
  if (s.status !== 'hangar' || !UPGRADES.some(u => u.id === id) || s.upgrades[id] >= MAX_UPGRADE) return false;
  const cost = upgradeCost(s, id);
  if (s.credits < cost) return false;
  s.credits -= cost;
  s.upgrades[id]++;
  return true;
}

export function spawnEnemy(s, type, x, y = -100) {
  type = clamp(type, 0, 9);
  const spec = ENEMY_TYPES[type], boss = type === 9;
  // Capital ships gain reinforced armor so late fights survive a fully upgraded volley.
  const hp = spec.hp * (1 + s.level * .24 + (boss ? s.level * s.level * .15 : 0)) * (s.mode === 2 ? 1.65 : 1);
  const e = { type, x: x ?? rand(100, s.width - 100), y, originX: x ?? s.width / 2, vx: 0, vy: boss ? 0 : spec.speed,
    mass: .55 + (spec.radius / 18) ** 1.4 * .5, bank: 0, thrust: boss ? 1.05 : .85,
    hp, maxHp: hp, radius: spec.radius, speed: spec.speed, age: 0, fire: boss ? 2 : rand(.8, 2.4), phase: 0, hurt: 0, seed: rand(0, 10), dead: false, boss, warning: 0 };
  e.originX = e.x;
  e.px = e.x; e.py = e.y;
  s.enemies.push(e);
  if (boss) { s.bossSpawned = true; s.events.push({ type: 'boss' }); }
  return e;
}

function shoot(s, p) {
  const level = s.upgrades.weapon, damage = shipStats(s.upgrades).damage;
  const count = level >= 5 ? 5 : level >= 2 ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const offset = i - (count - 1) / 2;
    s.bullets.push({ x: p.x + offset * 11, y: p.y - 24, px: p.x + offset * 11, py: p.y - 24, vx: offset * (level >= 2 ? 26 : 4), vy: -850, damage: damage / (count === 2 ? 1.6 : 1.5), radius: level >= 4 ? 5 : 3.5, team: p.id, life: 1.4, color: p.id ? '#ffc47c' : '#97fff1' });
  }
  p.fire = Math.max(.09, .16 - level * .009);
  s.events.push({ type: 'shot', player: p.id });
}

function hostileShot(s, e, angle, speed = 220, radius = 5) {
  s.bullets.push({ x: e.x, y: e.y + e.radius * .65, px: e.x, py: e.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, damage: e.boss ? 17 : 10 + e.type * 1.6, radius, team: -1, life: 7, color: e.boss ? '#ff7b9b' : '#ffaf65' });
}

function enemyFire(s, e) {
  const live = s.players.filter(p => p.alive);
  if (!live.length) return;
  const target = live.reduce((a, b) => distance(a, e) < distance(b, e) ? a : b);
  const aimed = Math.atan2(target.y - e.y, target.x - e.x);
  const speed = 175 + s.level * 7 + e.type * 4;
  if (e.boss) {
    const phase = e.hp / e.maxHp < .3 ? 2 : e.hp / e.maxHp < .65 ? 1 : 0;
    if (phase > e.phase) { e.phase = phase; s.events.push({ type: 'phase', x: e.x, y: e.y }); }
    const n = phase === 2 ? 16 : phase === 1 ? 12 : 9;
    for (let i = 0; i < n; i++) hostileShot(s, e, i * Math.PI * 2 / n + e.age * .21 + s.level * .25, speed * .88, 6);
    for (let i = -1 - phase; i <= 1 + phase; i++) hostileShot(s, e, aimed + i * .14, speed * 1.23, 5);
    e.fire = [1.35, 1.07, .82][phase];
    e.warning = .2;
  } else {
    const pattern = e.type % 4;
    if (pattern === 0) hostileShot(s, e, aimed, speed);
    if (pattern === 1) for (let i = -1; i <= 1; i++) hostileShot(s, e, Math.PI / 2 + i * .23, speed);
    if (pattern === 2) for (let i = -1; i <= 1; i++) hostileShot(s, e, aimed + i * .16, speed * .95);
    if (pattern === 3) for (let i = 0; i < 6; i++) hostileShot(s, e, i * Math.PI / 3 + e.age * .12, speed * .85);
    e.fire = Math.max(.85, Number(ENEMY_TYPES[e.type].fireRate) || 2.2) / (1 + s.level * .035);
  }
}

export function hurtPlayer(s, p, damage) {
  if (!p.alive || p.hurt > 0) return;
  const absorbed = Math.min(p.shield, damage);
  p.shield -= absorbed;
  p.hull = Math.max(0, p.hull - (damage - absorbed));
  p.hurt = .36;
  p.lastHit = s.time;
  s.combo = 0;
  s.events.push({ type: 'hit', x: p.x, y: p.y, shield: absorbed > 0 });
  if (p.hull <= 0) { p.alive = false; s.events.push({ type: 'explosion', x: p.x, y: p.y, size: 50, player: true }); }
}

export function killEnemy(s, e) {
  if (e.dead) return;
  e.dead = true;
  s.kills++; s.totalKills++; s.combo++; s.comboTime = 3;
  const multiplier = Math.min(4, 1 + Math.floor(s.combo / 10));
  const reward = Math.round((ENEMY_TYPES[e.type].score || 100) * (1 + s.level * .15));
  s.score += reward * multiplier;
  s.credits += Math.round(reward * .14);
  s.events.push({ type: 'explosion', x: e.x, y: e.y, size: e.radius * 1.3, boss: e.boss, value: reward * multiplier, shipType: e.type });
  if (e.boss) {
    s.bossDefeated = true; s.bossDeathTime = s.time;
    s.bullets = s.bullets.filter(b => b.team !== -1);
    for (const other of s.enemies) if (!other.boss && !other.dead) { other.dead = true; s.events.push({ type: 'explosion', x: other.x, y: other.y, size: other.radius }); }
  } else if (Math.random() < .22 || e.type >= 6) {
    s.pickups.push({ x: e.x, y: e.y, age: 0, kind: Math.random() < .32 ? 'repair' : 'credit', value: 40 + e.type * 8 });
  }
}

export function update(s, dt, input = [], environmentHit = null) {
  if (s.status !== 'playing') return;
  dt = clamp(dt, 0, .05);
  s.time += dt; s.scroll += dt * (s.bossSpawned ? 42 : 92 + s.level * 3);
  s.comboTime -= dt; if (s.comboTime <= 0) s.combo = 0;
  const stats = shipStats(s.upgrades);
  for (const p of s.players) {
    p.px = p.x; p.py = p.y;
    p.hurt = Math.max(0, p.hurt - dt);
    if (!p.alive) continue;
    const controls = input[p.id] || {}, x = controls.x || 0, y = controls.y || 0;
    const norm = Math.max(1, Math.hypot(x, y));
    p.mass = stats.mass;
    accelerate(p, x / norm * PLAYER_SPEED, y / norm * PLAYER_SPEED, (x || y ? .095 : .13) * p.mass, dt);
    constrain(p, 30, s.width - 30, 105, s.height - 42);
    const attitude = 1 - Math.exp(-dt / (.085 * Math.sqrt(p.mass)));
    p.bank += (p.vx / PLAYER_SPEED * .22 - p.bank) * attitude;
    p.thrust += (.9 + Math.hypot(x, y) / norm * .28 + Math.max(0, -y / norm) * .43 - p.thrust) * attitude;
    if (s.time - p.lastHit > stats.delay) p.shield = Math.min(stats.shield, p.shield + stats.recharge * dt);
    p.fire -= dt;
    if (controls.fire && p.fire <= 0) shoot(s, p);
  }
  if (!s.bossSpawned) {
    s.spawnTimer -= dt;
    if (s.time > 2 + s.showcase * 9 && s.showcase < 9) {
      const type = s.showcase++;
      spawnEnemy(s, type, s.width * (.3 + (type % 3) * .2));
    }
    if (s.spawnTimer <= 0 && s.enemies.length < 18) {
      const maxType = Math.min(8, Math.floor(s.time / 10));
      const type = Math.floor(Math.random() * (maxType + 1));
      const count = type < 3 ? 2 + (s.mode === 2 ? 1 : 0) : 1;
      const mid = rand(s.width * .2, s.width * .8);
      for (let i = 0; i < count; i++) spawnEnemy(s, type, clamp(mid + (i - (count - 1) / 2) * 76, 65, s.width - 65), -80 - i * 35);
      s.spawnTimer = Math.max(1.2, 2.4 - s.level * .065 - s.time * .003);
    }
    if (s.time >= s.duration) spawnEnemy(s, 9, s.width / 2, -160);
  }
  for (const e of s.enemies) {
    if (e.dead) continue;
    e.px = e.x; e.py = e.y;
    e.age += dt; e.hurt = Math.max(0, e.hurt - dt); e.warning = Math.max(0, e.warning - dt);
    const response = .07 + Math.sqrt(e.mass) * .09, midpoint = e.age - dt * .5;
    let targetX, targetY = e.speed;
    if (e.boss) {
      targetX = Math.cos(midpoint * .48) * Math.min(235, s.width * .24) * .48;
      targetY = (155 - e.y) * .7;
    } else {
      const pattern = e.type % 3;
      const frequency = [1.6, .85, 1.2][pattern] / Math.sqrt(e.mass);
      if (pattern === 0) targetX = Math.cos(midpoint * frequency + e.seed) * 68 * frequency;
      if (pattern === 1) targetX = Math.cos(midpoint * frequency) * 115 * frequency;
      if (pattern === 2) targetX = Math.sin(midpoint * frequency + e.seed) * 35;
    }
    accelerate(e, targetX, targetY, response, dt);
    constrain(e, e.radius, s.width - e.radius);
    const attitude = 1 - Math.exp(-dt / response);
    // Enemy hulls face downscreen, so their bank sign is the reverse of pilots.
    e.bank += (clamp(-e.vx / (230 * Math.sqrt(e.mass)), -.24, .24) - e.bank) * attitude;
    e.thrust += (.82 + Math.abs(e.vx) / 180 + Math.max(0, e.vy - e.speed) / 190 - e.thrust) * attitude;
    e.fire -= dt;
    if (e.fire <= 0 && e.y > 30 && e.y < s.height * .73 && !s.bossDefeated) enemyFire(s, e);
    for (const p of s.players) if (p.alive && distance(p, e) < p.radius + e.radius * .75) hurtPlayer(s, p, e.boss ? 55 : 22);
  }
  for (const b of s.bullets) {
    b.px = b.x; b.py = b.y; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    // Calculate each segment's bounds once, then reuse for every candidate.
    b.left = Math.min(b.px, b.x); b.right = Math.max(b.px, b.x);
    b.top = Math.min(b.py, b.y); b.bottom = Math.max(b.py, b.y);
    if (b.team >= 0) {
      for (const e of s.enemies) if (!e.dead && segmentHits(b, e, e.radius + b.radius)) {
        e.hp -= b.damage; e.hurt = .07; b.life = 0;
        s.events.push({ type: 'spark', x: b.x, y: b.y, size: 5 });
        if (e.hp <= 0) killEnemy(s, e);
        break;
      }
      if (b.life > 0 && environmentHit) {
        const props = environmentHit(b.x, b.y, 9, b.damage, s.scroll) || [];
        for (const prop of props) {
          s.destroyed++; s.credits += prop.value || 8; s.score += 25;
          s.events.push({ type: 'explosion', ...prop, size: Math.min(48, prop.size || 22), ground: true });
        }
      }
    } else if (!s.bossDefeated) {
      for (const p of s.players) if (p.alive && segmentHits(b, p, p.radius * .72 + b.radius)) { hurtPlayer(s, p, b.damage); b.life = 0; break; }
    }
  }
  // Compact the current arrays in place to avoid three allocations every tick.
  // killEnemy can replace s.bullets while clearing a boss's hostile fire, so use
  // the current state array here rather than the earlier collision-loop array.
  let retained = 0;
  for (const b of s.bullets) if (b.life > 0 && b.y > -80 && b.y < s.height + 90 && b.x > -80 && b.x < s.width + 80) s.bullets[retained++] = b;
  s.bullets.length = retained;
  retained = 0;
  for (const e of s.enemies) if (!e.dead && e.y < s.height + 140) s.enemies[retained++] = e;
  s.enemies.length = retained;
  for (const p of s.pickups) {
    p.y += 75 * dt; p.age += dt;
    for (const player of s.players) if (player.alive) {
      const d = distance(player, p);
      if (d < 145) { p.x += (player.x - p.x) * dt * 5; p.y += (player.y - p.y) * dt * 5; }
      if (d < 28) {
        p.age = 100;
        if (p.kind === 'repair') { player.hull = Math.min(stats.hull, player.hull + 32); player.shield = Math.min(stats.shield, player.shield + 25); }
        else s.credits += p.value;
        s.events.push({ type: 'pickup', x: p.x, y: p.y, value: p.kind === 'repair' ? 'REPAIR' : `+${p.value} CR` });
        break;
      }
    }
  }
  retained = 0;
  for (const p of s.pickups) if (p.age < 14 && p.y < s.height + 50) s.pickups[retained++] = p;
  s.pickups.length = retained;
  if (!s.players.some(p => p.alive)) { s.status = 'defeat'; s.events.push({ type: 'defeat' }); }
  else if (s.bossDefeated && s.time - s.bossDeathTime > 3.2) {
    const bonus = 650 + s.level * 100;
    s.credits += bonus; s.score += 2500 * (s.level + 1);
    s.status = s.level === 9 ? 'victory' : 'hangar';
    s.events.push({ type: s.status, bonus });
  }
}
