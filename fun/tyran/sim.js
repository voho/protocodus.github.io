import { ENEMY_TYPES } from './ships.js';

export const UPGRADES = [
  { id: 'weapon', name: 'Ion armament', subtitle: 'Six fire profiles. More output at every mark.', base: 420, icon: '⌁' },
  { id: 'shield', name: 'Flux shield', subtitle: 'A larger energy barrier.', base: 340, icon: '◇' },
  { id: 'hull', name: 'Titanium hull', subtitle: 'Stronger armor. More inertia.', base: 300, icon: '⬡' },
  { id: 'recharge', name: 'Fusion capacitor', subtitle: 'Recover shields faster, sooner.', base: 280, icon: 'ϟ' },
];
export const MAX_UPGRADE = 6;
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const rand = (a, b) => a + Math.random() * (b - a);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const TAU = Math.PI * 2;
// Hostile fire uses a spectrum keyed to hull class. Smaller craft throw
// compact, low-damage rounds; capital ships earn the larger, brighter shapes.
export const BULLET_SPECTRUM = Object.freeze([
  '#75f5ff', '#71ffae', '#d7ff62', '#ffe16a', '#ffad62',
  '#ff718f', '#ff66dc', '#b07dff', '#6d9dff', '#ff5d78',
]);
const MAX_HOSTILE_BULLETS = 78;

// Every profile occupies a different niche. Direct DPS is intentionally
// close across the roster; range, spread, piercing, splash and homing decide
// when a profile is strongest instead of one option dominating every sector.
export const WEAPONS = [
  { id: 'pulse', name: 'Pulse Array', tag: 'Balanced', description: 'Twin bolts with clean reach and reliable tracking.', hotkey: '1', kind: 'pulse', color: '#9cfff0', interval: .17, damage: 9.8, count: 2, spread: .018, speed: 900, life: 1.35, radius: 3.8 },
  { id: 'scatter', name: 'Scatter Bloom', tag: 'Close range', description: 'Six heavy pellets. Devastating when you fly into the lane.', hotkey: '2', kind: 'scatter', color: '#ffd18e', interval: .43, damage: 5.45, count: 6, spread: .24, speed: 790, life: 1.05, radius: 3.5 },
  { id: 'lance', name: 'Solar Lance', tag: 'Piercing', description: 'A slow, surgical beam that passes through armored targets.', hotkey: '3', kind: 'lance', color: '#c5b4ff', interval: .64, damage: 40, count: 1, spread: 0, speed: 1_280, life: 1.05, radius: 5.2, pierce: 2 },
  { id: 'seeker', name: 'Seeker Swarm', tag: 'Homing', description: 'Patient micro-missiles curve toward evasive ships.', hotkey: '4', kind: 'seeker', color: '#9ee8ff', interval: .36, damage: 12.3, count: 2, spread: .10, speed: 445, life: 3.6, radius: 5.8, homing: 4.7 },
  { id: 'plasma', name: 'Plasma Mortar', tag: 'Blast', description: 'One volatile orb. Impact blooms into a controlled shockwave.', hotkey: '5', kind: 'plasma', color: '#ff9e7d', interval: .41, damage: 24, count: 1, spread: .012, speed: 640, life: 2.45, radius: 8, splash: 50, splashFactor: .46 },
  { id: 'arc', name: 'Arc Driver', tag: 'Chain', description: 'A crackling dart jumps to nearby ships after each hit.', hotkey: '6', kind: 'arc', color: '#ffe88d', interval: .24, damage: 11.3, count: 1, spread: .015, speed: 930, life: 1.25, radius: 4.4, chain: 2, chainRange: 155, chainFactor: .63 },
];
const weaponById = new Map(WEAPONS.map(weapon => [weapon.id, weapon]));
export const weaponInfo = id => weaponById.get(id) || WEAPONS[0];
export const comboLabel = combo => combo >= 5 ? 'Rampage' : combo >= 3 ? 'Multi kill' : combo >= 2 ? 'Double kill' : '';
const comboTier = combo => combo >= 5 ? 3 : combo >= 3 ? 2 : combo >= 2 ? 1 : 0;
const comboDamageFor = combo => [1, 1.1, 1.18, 1.27][comboTier(combo)];
const comboBlastFor = combo => [1, 1.12, 1.24, 1.38][comboTier(combo)];
export const upgradeCost = (s, id) => Math.round(UPGRADES.find(u => u.id === id).base * 1.55 ** s.upgrades[id]);
export const shipStats = u => ({ hull: 120 + u.hull * 45, shield: 85 + u.shield * 38, recharge: 10 + u.recharge * 5, delay: Math.max(.8, 3.2 - u.recharge * .35), damage: 13 + u.weapon * 6,
  mass: 1 + u.hull * .055 + u.weapon * .018 + u.shield * .014 + u.recharge * .008 });

export function weaponStats(s, id = s.weapon) {
  const profile = weaponInfo(id), level = clamp(Number(s.upgrades?.weapon) || 0, 0, MAX_UPGRADE);
  const count = profile.count + (profile.id === 'scatter' && level >= 5 ? 1 : profile.id === 'seeker' && level >= 6 ? 1 : 0);
  return {
    ...profile,
    level,
    count,
    damage: profile.damage * (1 + level * .105),
    interval: profile.interval / (1 + level * .022),
    spread: profile.spread * (1 - level * .018),
    pierce: (profile.pierce || 0) + (profile.id === 'lance' ? Math.floor(level / 3) : 0),
    splash: (profile.splash || 0) + (profile.id === 'plasma' ? level * 4 : 0),
    chain: (profile.chain || 0) + (profile.id === 'arc' ? Math.floor(level / 3) : 0),
  };
}

export function selectWeapon(s, id) {
  if (!s || !weaponById.has(id) || !['playing', 'hangar'].includes(s.status)) return false;
  if (s.weapon === id) return true;
  s.weapon = id;
  s.events.push({ type: 'weapon', weapon: id });
  return true;
}

export const FORMATIONS = ['vee', 'wall', 'orbit', 'escort', 'pincer'];
const FORMATION_LAYOUTS = {
  vee: [[0, -58], [-58, -22], [58, -22], [-116, 22], [116, 22]],
  wall: [[-150, 0], [-90, 8], [-30, 14], [30, 14], [90, 8], [150, 0]],
  orbit: [[0, -92], [80, -45], [80, 45], [0, 92], [-80, 45], [-80, -45]],
  escort: [[0, -18], [-74, 22], [74, 22], [-118, 70], [118, 70]],
  pincer: [[-150, -20], [-188, 35], [-218, 90], [150, -20], [188, 35], [218, 90]],
};
const formationName = kind => kind[0].toUpperCase() + kind.slice(1);

export function bossWeakPointPosition(enemy, point, index = 0) {
  const slot = typeof point === 'number' ? enemy.weakPoints?.[point] : point;
  const angle = (slot?.angle ?? [-2.45, -Math.PI / 2, -.7, Math.PI / 2][index % 4]) + enemy.age * (.34 + enemy.phase * .06);
  const orbit = enemy.radius * (slot?.orbit ?? .62);
  return { x: enemy.x + Math.cos(angle) * orbit, y: enemy.y + Math.sin(angle) * orbit * .72 };
}

function makeWeakPoints(hp, radius) {
  return [-2.45, -Math.PI / 2, -.7, Math.PI / 2].map((angle, index) => {
    const maxHp = hp * .13;
    return { index, angle, orbit: .62, radius: Math.max(12, radius * .17), hp: maxHp, maxHp, alive: true };
  });
}

export const PLAYER_SPEED = 365;
const BLAST_DECAY = .28, MAX_BLAST_SPEED = 110;
// Time constants in seconds: upgrades add a little weight, but retain full top
// speed. Integrating both velocity and distance analytically keeps steering the
// same at 30, 60 and 120 Hz and preserves a short, controlled coast on release.
function accelerate(body, targetX, targetY, response, dt) {
  const decay = Math.exp(-dt / response), travel = response * (1 - decay);
  body.x += targetX * dt + (body.vx - targetX) * travel;
  body.y += targetY * dt + (body.vy - targetY) * travel;
  body.vx = targetX + (body.vx - targetX) * decay;
  body.vy = targetY + (body.vy - targetY) * decay;
  // A blast is an external impulse. Steering must not erase it in the next tick.
  const blastX = body.blastVx || 0, blastY = body.blastVy || 0;
  if (blastX || blastY) {
    const blastDecay = Math.exp(-dt / BLAST_DECAY), blastTravel = BLAST_DECAY * (1 - blastDecay);
    body.x += blastX * blastTravel; body.y += blastY * blastTravel;
    body.blastVx = Math.abs(blastX * blastDecay) < .01 ? 0 : blastX * blastDecay;
    body.blastVy = Math.abs(blastY * blastDecay) < .01 ? 0 : blastY * blastDecay;
  }
}

function constrain(body, left, right, top = -Infinity, bottom = Infinity) {
  if (body.x <= left) { body.x = left; body.vx = Math.max(0, body.vx); body.blastVx = Math.max(0, body.blastVx || 0); }
  if (body.x >= right) { body.x = right; body.vx = Math.min(0, body.vx); body.blastVx = Math.min(0, body.blastVx || 0); }
  if (body.y <= top) { body.y = top; body.vy = Math.max(0, body.vy); body.blastVy = Math.max(0, body.blastVy || 0); }
  if (body.y >= bottom) { body.y = bottom; body.vy = Math.min(0, body.vy); body.blastVy = Math.min(0, body.blastVy || 0); }
}

/** Large ground explosions gently displace nearby light craft without damage. */
export function applyStructureBlast(s, prop) {
  if (!prop.structural || (prop.footprint ?? prop.size ?? 0) < 55) return;
  const radius = prop.blastRadius || clamp((prop.size || 0) * 2.8, 120, 250);
  for (const fleet of [s.players, s.enemies]) for (const ship of fleet) {
    if (ship.alive === false || ship.dead || ship.boss || ship.radius > 36) continue;
    const dx = ship.x - prop.x, dy = ship.y - prop.y, distance = Math.hypot(dx, dy);
    if (distance >= radius) continue;
    // Coincident centers get a stable direction without consuming the game RNG.
    const angle = (ship.id || 0) * 2.399963229728653 + (fleet === s.players ? Math.PI : 0);
    const nx = distance > 1e-6 ? dx / distance : Math.cos(angle), ny = distance > 1e-6 ? dy / distance : Math.sin(angle);
    const impulse = MAX_BLAST_SPEED * (1 - distance / radius) ** 2 / Math.max(.6, ship.mass || 1);
    const vx = (ship.blastVx || 0) + nx * impulse, vy = (ship.blastVy || 0) + ny * impulse;
    const limit = Math.max(1, Math.hypot(vx, vy) / MAX_BLAST_SPEED);
    ship.blastVx = vx / limit; ship.blastVy = vy / limit;
  }
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
    events: [], kills: 0, destroyed: 0, totalKills: 0, combo: 0, comboTime: 0, comboDamage: 1, comboBlast: 1, comboLabel: '',
    weapon: 'pulse', formations: [], nextEnemyId: 1, nextFormationId: 1, formationTimer: 11,
    bossSpawned: false, bossDefeated: false, bossDeathTime: 0, spawnTimer: 1, showcase: 0,
  };
  if (checkpoint) {
    for (const id of Object.keys(state.upgrades)) state.upgrades[id] = clamp(Math.floor(Number(checkpoint.upgrades?.[id]) || 0), 0, MAX_UPGRADE);
    state.credits = clamp(Number(checkpoint.credits) || 0, 0, 9999999);
    state.score = clamp(Number(checkpoint.score) || 0, 0, 999999999);
    state.totalKills = clamp(Number(checkpoint.totalKills) || 0, 0, 9999999);
    if (weaponById.has(checkpoint.weapon)) state.weapon = checkpoint.weapon;
  }
  beginLevel(state, state.level);
  return state;
}

export function beginLevel(s, level) {
  Object.assign(s, { level: clamp(level, 0, 9), time: 0, scroll: 0, status: 'playing', enemies: [], bullets: [], pickups: [], events: [], formations: [], kills: 0, destroyed: 0, combo: 0, comboTime: 0, comboDamage: 1, comboBlast: 1, comboLabel: '', bossSpawned: false, bossDefeated: false, bossDeathTime: 0, spawnTimer: 1.5, showcase: 0, formationTimer: 10.5 });
  s.duration = 90 + s.level * 3;
  const stats = shipStats(s.upgrades);
  s.players = Array.from({ length: s.mode }, (_, i) => {
    const x = s.width * (s.mode === 1 ? .5 : i ? .62 : .38), y = s.height * .68;
    return { id: i, x, y, px: x, py: y, vx: 0, vy: 0, blastVx: 0, blastVy: 0, mass: stats.mass, thrust: .9, radius: 17, hull: stats.hull, shield: stats.shield, maxHull: stats.hull, maxShield: stats.shield, fire: 0, hurt: 0, lastHit: -10, alive: true };
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
  // Guardians grow each sector without turning the late campaign into a
  // damage sponge; the open-core rhythm supplies the challenge instead.
  const hp = spec.hp * (1 + s.level * (boss ? .08 : .24)) * (s.mode === 2 ? 1.65 : 1);
  const e = { id: s.nextEnemyId++, type, x: x ?? rand(100, s.width - 100), y, originX: x ?? s.width / 2, vx: 0, vy: boss ? 0 : spec.speed,
    blastVx: 0, blastVy: 0, mass: .55 + (spec.radius / 18) ** 1.4 * .5, thrust: boss ? 1.05 : .85,
    hp, maxHp: hp, radius: spec.radius, speed: spec.speed, age: 0, fire: boss ? 2 : rand(.8, 2.4), phase: 0, hurt: 0, seed: rand(0, 10), dead: false, boss, warning: 0,
    formation: null, formationOffset: null };
  e.originX = e.x;
  e.px = e.x; e.py = e.y;
  if (boss) {
    e.vulnerable = false; e.windowClock = 1.2; e.windowCount = 0;
    e.weakPoints = makeWeakPoints(hp, e.radius);
  }
  s.enemies.push(e);
  if (boss) { s.bossSpawned = true; s.events.push({ type: 'boss' }); }
  return e;
}

export function spawnFormation(s, kind = FORMATIONS[Math.floor((s.nextFormationId - 1) % FORMATIONS.length)]) {
  if (s.bossSpawned || !FORMATION_LAYOUTS[kind] || s.enemies.length > 15) return null;
  const offsets = FORMATION_LAYOUTS[kind].map(([x, y]) => ({ x, y }));
  const anchor = { id: s.nextFormationId++, kind, label: formationName(kind), age: 0, baseX: rand(s.width * .25, s.width * .75), x: 0, y: -150, offsets, members: offsets.length };
  anchor.x = anchor.baseX;
  s.formations.push(anchor);
  const tier = clamp(Math.floor(s.time / 14) + Math.floor(s.level / 3), 0, 6);
  offsets.forEach((offset, index) => {
    const escort = kind === 'escort' && index === 0;
    const type = clamp(tier + (escort ? 2 : index % 3 === 0 ? 1 : 0), 0, 8);
    const enemy = spawnEnemy(s, type, anchor.x + offset.x, anchor.y + offset.y);
    enemy.formation = anchor; enemy.formationOffset = offset; enemy.formationIndex = index;
  });
  s.events.push({ type: 'formation', formation: kind, label: anchor.label, count: offsets.length, x: anchor.x, y: anchor.y });
  return anchor;
}

function shoot(s, p) {
  const profile = weaponStats(s), count = profile.count, comboDamage = s.comboDamage || 1;
  // A solo pilot gets a small fire-control assist so every profile remains
  // campaign-viable without making co-op’s shared target balance trivial.
  const modeAssist = s.mode === 1 ? 1.35 : 1;
  const playerColor = p.id ? '#ffc18b' : '#9cfff0';
  for (let i = 0; i < count; i++) {
    const offset = i - (count - 1) / 2, angle = -Math.PI / 2 + offset * profile.spread;
    const x = p.x + Math.cos(angle) * offset * 5, y = p.y - 24;
    s.bullets.push({ x, y, px: x, py: y, vx: Math.cos(angle) * profile.speed, vy: Math.sin(angle) * profile.speed,
      damage: profile.damage * comboDamage * modeAssist, baseDamage: profile.damage, radius: profile.radius, team: p.id, life: profile.life,
      color: playerColor, weaponColor: profile.color, kind: profile.kind, pierce: profile.pierce || 0, homing: profile.homing || 0,
      splash: profile.splash || 0, splashFactor: profile.splashFactor || 0, chain: profile.chain || 0, chainRange: profile.chainRange || 0,
      chainFactor: profile.chainFactor || .6, hitIds: [], age: 0, comboBlast: s.comboBlast || 1 });
  }
  p.fire = profile.interval;
  s.events.push({ type: 'shot', player: p.id, weapon: profile.id });
}

function hostileShot(s, e, angle, speed = 220, radius = 5) {
  if (s.hostileCount >= MAX_HOSTILE_BULLETS) return;
  const sizeRatio = clamp(e.radius / 110, .08, 1);
  const bulletRadius = clamp((Number(radius) || 5) * (.42 + sizeRatio * .72), 2.2, e.boss ? 8.4 : 6.4);
  const damage = e.boss
    ? clamp(13 + e.radius * .12 + e.type * .4, 13, 28)
    : clamp(3.8 + e.radius * .16 + e.type * .42, 4.5, 17.5);
  const variant = e.boss ? 5 : e.type % 5;
  s.bullets.push({ x: e.x, y: e.y + e.radius * .65, px: e.x, py: e.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    damage, radius: bulletRadius, team: -1, life: 7, color: e.boss ? '#ff5d78' : BULLET_SPECTRUM[e.type % BULLET_SPECTRUM.length], kind: 'hostile', variant, sourceRadius: e.radius, age: 0 });
  s.hostileCount++;
}

function resetCombo(s, emit = false) {
  if (emit && s.combo >= 2) s.events.push({ type: 'combo-end', combo: s.combo });
  s.combo = 0; s.comboTime = 0; s.comboDamage = 1; s.comboBlast = 1; s.comboLabel = '';
}

function nearestEnemy(s, x, y, maxDistance = Infinity, exclude = null) {
  let found = null, nearest = maxDistance * maxDistance;
  for (const enemy of s.enemies) {
    if (enemy.dead || enemy === exclude) continue;
    const dx = enemy.x - x, dy = enemy.y - y, squared = dx * dx + dy * dy;
    if (squared < nearest) { nearest = squared; found = enemy; }
  }
  return found;
}

function guideProjectile(s, bullet, dt) {
  if (!bullet.homing || bullet.team < 0) return;
  const target = nearestEnemy(s, bullet.x, bullet.y, 650);
  if (!target) return;
  const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
  let angle = Math.atan2(bullet.vy, bullet.vx), wanted = Math.atan2(target.y - bullet.y, target.x - bullet.x);
  let delta = (wanted - angle + Math.PI) % TAU - Math.PI;
  delta = clamp(delta, -bullet.homing * dt, bullet.homing * dt);
  angle += delta;
  bullet.vx = Math.cos(angle) * speed; bullet.vy = Math.sin(angle) * speed;
}

function pointHits(bullet, point) {
  const x = point.x, y = point.y, radius = point.radius + bullet.radius;
  if (x + radius <= bullet.left || x - radius >= bullet.right || y + radius <= bullet.top || y - radius >= bullet.bottom) return false;
  const dx = bullet.x - bullet.px, dy = bullet.y - bullet.py;
  const t = clamp(((x - bullet.px) * dx + (y - bullet.py) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  const gapX = bullet.px + t * dx - x, gapY = bullet.py + t * dy - y;
  return gapX * gapX + gapY * gapY < radius * radius;
}

function bossHit(s, bullet, enemy) {
  const hitRadius = enemy.radius * (enemy.boss ? 1.45 : 1) + bullet.radius;
  if (!segmentHits(bullet, enemy, hitRadius)) return null;
  if (!enemy.boss) return { damage: bullet.damage, blocked: false };
  // Hand-authored QA/debug bolts have no weapon kind; keep them useful for
  // deterministic harnesses while real player projectiles respect armor
  // windows in flight.
  if (!enemy.vulnerable && bullet.kind) return { damage: 0, blocked: true };
  let weak = null;
  for (const point of enemy.weakPoints || []) {
    if (!point.alive) continue;
    const position = bossWeakPointPosition(enemy, point);
    if (pointHits(bullet, { ...position, radius: point.radius })) { weak = point; break; }
  }
  return { damage: bullet.damage * (weak ? 1.85 : 1.65), blocked: false, weak };
}

function damageSplash(s, bullet, origin) {
  const radius = bullet.splash * (bullet.comboBlast || 1);
  if (!radius) return;
  const radiusSquared = radius * radius;
  for (const enemy of s.enemies) {
    if (enemy.dead || enemy === origin || (enemy.boss && !enemy.vulnerable)) continue;
    const dx = enemy.x - origin.x, dy = enemy.y - origin.y, squared = dx * dx + dy * dy;
    if (squared >= radiusSquared) continue;
    const falloff = 1 - Math.sqrt(squared) / radius;
    const damage = bullet.damage * bullet.splashFactor * Math.max(.2, falloff);
    enemy.hp -= damage; enemy.hurt = .09;
    s.events.push({ type: 'spark', x: enemy.x, y: enemy.y, size: 6, splash: true });
    if (enemy.hp <= 0) killEnemy(s, enemy);
  }
  s.events.push({ type: 'blast', x: origin.x, y: origin.y, size: radius * .62, color: bullet.weaponColor || bullet.color });
}

function chainDamage(s, bullet, origin) {
  if (!bullet.chain) return;
  const target = nearestEnemy(s, origin.x, origin.y, bullet.chainRange || 155, origin);
  if (!target || (target.boss && !target.vulnerable)) return;
  const damage = bullet.damage * (bullet.chainFactor || .6);
  target.hp -= damage; target.hurt = .1;
  bullet.chain--;
  s.events.push({ type: 'arc', x: origin.x, y: origin.y, toX: target.x, toY: target.y, size: 8, color: bullet.weaponColor || bullet.color });
  if (target.hp <= 0) killEnemy(s, target);
}

function updateFormationAnchors(s, dt) {
  for (const formation of s.formations) {
    formation.age += dt;
    const sway = Math.sin(formation.age * (formation.kind === 'orbit' ? .7 : .48) + formation.id) * (formation.kind === 'pincer' ? 26 : 42);
    formation.x = clamp(formation.baseX + sway, 180, s.width - 180);
    // Enter together, sweep the combat lane, then fly through. A stationary
    // anchor leaves surviving ships behind and eventually blocks new waves.
    const entry = 480 / 84, departure = 11;
    formation.y = formation.age < entry ? -150 + formation.age * 84
      : formation.age < departure ? 330 + Math.sin((formation.age - entry) * Math.PI / (departure - entry)) * 32
      : 330 + (formation.age - departure) * 105;
  }
}

function formationVelocity(enemy) {
  const formation = enemy.formation;
  if (!formation) return null;
  const offset = enemy.formationOffset || { x: 0, y: 0 };
  let x = offset.x, y = offset.y;
  if (formation.kind === 'orbit') {
    const angle = formation.age * .75 + enemy.formationIndex * TAU / formation.offsets.length;
    const radius = Math.hypot(offset.x, offset.y);
    x = Math.cos(angle) * radius; y = Math.sin(angle) * radius;
  } else if (formation.kind === 'pincer') {
    x += Math.sin(formation.age * 1.3 + enemy.formationIndex) * 15;
    y += Math.cos(formation.age * .7 + enemy.formationIndex) * 10;
  }
  const desiredX = formation.x + x, desiredY = formation.y + y;
  const response = .14;
  return { x: clamp((desiredX - enemy.x) / response, -enemy.speed * 1.65, enemy.speed * 1.65), y: clamp((desiredY - enemy.y) / response, -enemy.speed * 1.3, enemy.speed * 1.3) };
}

function enemyFire(s, e) {
  const live = s.players.filter(p => p.alive);
  if (!live.length) return;
  const target = live.reduce((a, b) => distance(a, e) < distance(b, e) ? a : b);
  // Passing craft cease fire once they reach the pilot's row. This leaves a
  // readable escape route instead of spawning unavoidable shots from behind.
  if (!e.boss && e.y > target.y - e.radius - 55) { e.fire = .25; return; }
  const aimed = Math.atan2(target.y - e.y, target.x - e.x);
  const speed = 175 + s.level * 7 + e.type * 4;
  if (e.boss) {
    const phase = e.hp / e.maxHp < .3 ? 2 : e.hp / e.maxHp < .65 ? 1 : 0;
    if (phase > e.phase) { e.phase = phase; s.events.push({ type: 'phase', x: e.x, y: e.y }); }
    const n = phase === 2 ? 10 : phase === 1 ? 8 : 6;
    for (let i = 0; i < n; i++) hostileShot(s, e, i * Math.PI * 2 / n + e.age * .21 + s.level * .25, speed * .88, 6);
    for (let i = -1 - phase; i <= 1 + phase; i++) hostileShot(s, e, aimed + i * .14, speed * 1.23, 5);
    e.fire = [1.35, 1.07, .82][phase];
    e.warning = .2;
  } else {
    const pattern = e.type % 4;
    if (pattern === 0) hostileShot(s, e, aimed, speed);
    if (pattern === 1) for (const i of [-1, 1]) hostileShot(s, e, Math.PI / 2 + i * .23, speed);
    if (pattern === 2) for (let i = -1; i <= 1; i++) hostileShot(s, e, aimed + i * .16, speed * .95);
    if (pattern === 3) for (let i = 0; i < 4; i++) hostileShot(s, e, i * Math.PI / 2 + e.age * .12, speed * .85);
    const formationSpacing = e.formation ? 1.32 : 1;
    e.fire = Math.max(.85, Number(ENEMY_TYPES[e.type].fireRate) || 2.2) * formationSpacing / (1 + s.level * .035);
  }
}

export function hurtPlayer(s, p, damage) {
  if (!p.alive || p.hurt > 0) return;
  const absorbed = Math.min(p.shield, damage);
  p.shield -= absorbed;
  p.hull = Math.max(0, p.hull - (damage - absorbed));
  p.hurt = .36;
  p.lastHit = s.time;
  resetCombo(s, true);
  s.events.push({ type: 'hit', x: p.x, y: p.y, shield: absorbed > 0 });
  if (p.hull <= 0) { p.alive = false; s.events.push({ type: 'explosion', x: p.x, y: p.y, size: 50, player: true }); }
}

export function killEnemy(s, e) {
  if (e.dead) return;
  e.dead = true;
  const chain = s.comboTime > 0 ? s.combo + 1 : 1;
  s.kills++; s.totalKills++; s.combo = chain; s.comboTime = Math.min(5.2, 3 + comboTier(chain) * .55);
  s.comboDamage = comboDamageFor(chain); s.comboBlast = comboBlastFor(chain); s.comboLabel = comboLabel(chain);
  const multiplier = Math.min(4, 1 + Math.floor(chain / 10));
  const reward = Math.round((ENEMY_TYPES[e.type].score || 100) * (1 + s.level * .15));
  s.score += reward * multiplier;
  s.credits += Math.round(reward * .14);
  s.events.push({ type: 'explosion', x: e.x, y: e.y, size: e.radius * 1.3 * s.comboBlast, boss: e.boss, value: reward * multiplier, shipType: e.type, blast: s.comboBlast });
  if (chain >= 2) s.events.push({ type: 'combo', x: e.x, y: e.y, combo: chain, label: s.comboLabel, damageBoost: s.comboDamage, blastBoost: s.comboBlast, time: s.comboTime });
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
  if (s.comboTime > 0) {
    s.comboTime -= dt;
    if (s.comboTime <= 0) resetCombo(s, true);
  }
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
    const thrustResponse = 1 - Math.exp(-dt / (.085 * Math.sqrt(p.mass)));
    p.thrust += (.9 + Math.hypot(x, y) / norm * .28 + Math.max(0, -y / norm) * .43 - p.thrust) * thrustResponse;
    if (s.time - p.lastHit > stats.delay) p.shield = Math.min(stats.shield, p.shield + stats.recharge * dt);
    p.fire -= dt;
    if (controls.fire && p.fire <= 0) shoot(s, p);
  }
  if (!s.bossSpawned) {
    s.spawnTimer -= dt;
    s.formationTimer -= dt;
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
    if (s.formationTimer <= 0 && s.time > 8 && s.enemies.length < 14 && s.formations.length < 6) {
      const kind = FORMATIONS[(s.nextFormationId - 1) % FORMATIONS.length];
      spawnFormation(s, kind);
      s.formationTimer = Math.max(8.5, 13.5 - s.level * .22 - s.time * .012);
    }
    if (s.time >= s.duration) spawnEnemy(s, 9, s.width / 2, -160);
  }
  updateFormationAnchors(s, dt);
  // Count once per step, then reserve each shot as it is emitted. Dense boss
  // volleys no longer rescan the entire projectile array for every round.
  s.hostileCount = 0;
  for (const bullet of s.bullets) if (bullet.team < 0 && bullet.life > 0) s.hostileCount++;
  for (const e of s.enemies) {
    if (e.dead) continue;
    e.px = e.x; e.py = e.y;
    e.age += dt; e.hurt = Math.max(0, e.hurt - dt); e.warning = Math.max(0, e.warning - dt);
    if (e.boss) {
      e.windowClock -= dt;
      if (e.windowClock <= 0) {
        e.vulnerable = !e.vulnerable; e.windowCount++;
        e.windowClock = e.vulnerable ? 4.4 : 1.3;
        s.events.push({ type: e.vulnerable ? 'boss-open' : 'boss-close', x: e.x, y: e.y, time: e.windowClock, openCount: e.windowCount });
      }
    }
    const response = .07 + Math.sqrt(e.mass) * .09, midpoint = e.age - dt * .5;
    let targetX, targetY = e.speed;
    if (e.boss) {
      targetX = Math.cos(midpoint * .48) * Math.min(235, s.width * .24) * .48;
      targetY = (155 - e.y) * .7;
    } else {
      const formationTarget = formationVelocity(e);
      if (formationTarget) { targetX = formationTarget.x; targetY = formationTarget.y; }
      else {
        const pattern = e.type % 3;
        const frequency = [1.6, .85, 1.2][pattern] / Math.sqrt(e.mass);
        if (pattern === 0) targetX = Math.cos(midpoint * frequency + e.seed) * 68 * frequency;
        if (pattern === 1) targetX = Math.cos(midpoint * frequency) * 115 * frequency;
        if (pattern === 2) targetX = Math.sin(midpoint * frequency + e.seed) * 35;
      }
    }
    accelerate(e, targetX, targetY, response, dt);
    constrain(e, e.radius, s.width - e.radius, -Infinity, e.boss ? s.height * .56 : Infinity);
    const thrustResponse = 1 - Math.exp(-dt / response);
    e.thrust += (.82 + Math.abs(e.vx) / 180 + Math.max(0, e.vy - e.speed) / 190 - e.thrust) * thrustResponse;
    e.fire -= dt;
    if (e.fire <= 0 && e.y > 30 && e.y < s.height * .73 && !s.bossDefeated) enemyFire(s, e);
    for (const p of s.players) if (p.alive && distance(p, e) < p.radius + e.radius * .75) hurtPlayer(s, p, e.boss ? 55 : 22);
  }
  // Iterate the original array: a boss death can replace s.bullets while this
  // frame is resolving, and the replacement intentionally contains no hostile
  // rounds. The old iterator remains safe and is compacted below.
  const bullets = s.bullets;
  for (const b of bullets) {
    if (!b || b.life <= 0) continue;
    b.age = (b.age || 0) + dt; guideProjectile(s, b, dt);
    b.px = b.x; b.py = b.y; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    // Calculate each segment's bounds once, then reuse for every candidate.
    b.left = Math.min(b.px, b.x); b.right = Math.max(b.px, b.x);
    b.top = Math.min(b.py, b.y); b.bottom = Math.max(b.py, b.y);
    if (b.team >= 0) {
      const hitIds = b.hitIds || (b.hitIds = []);
      let target = null, result = null;
      for (const e of s.enemies) {
        if (e.dead || hitIds.includes(e.id)) continue;
        const candidate = bossHit(s, b, e);
        if (candidate) { target = e; result = candidate; break; }
      }
      if (target && result) {
        hitIds.push(target.id);
        if (result.blocked) {
          b.life = 0;
          s.events.push({ type: 'blocked', x: b.x, y: b.y, size: 8 });
        } else {
          target.hp -= result.damage; target.hurt = .07;
          s.events.push({ type: result.weak ? 'weak-hit' : 'spark', x: b.x, y: b.y, size: result.weak ? 10 : 5, boss: target.boss });
          if (result.weak) {
            result.weak.hp -= result.damage;
            if (result.weak.hp <= 0 && result.weak.alive) {
              result.weak.alive = false;
              s.events.push({ type: 'weak-break', x: b.x, y: b.y, size: result.weak.radius * 2 });
            }
          }
          if (b.splash) damageSplash(s, b, target);
          if (b.chain) chainDamage(s, b, target);
          if (target.hp <= 0) killEnemy(s, target);
          if (b.pierce > 0) b.pierce--; else b.life = 0;
        }
      }
      if (b.life > 0 && environmentHit) {
        const radius = Math.max(9, b.splash || 0) * (b.comboBlast || 1);
        const props = environmentHit(b.x, b.y, radius, b.damage * (b.splash ? 1.15 : 1), s.scroll) || [];
        for (const prop of props) {
          s.destroyed++; s.credits += prop.value || 8; s.score += 25;
          applyStructureBlast(s, prop);
          s.events.push({ type: 'explosion', ...prop, size: Math.min(48, prop.size || 22), ground: true, blast: b.comboBlast || 1 });
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
  retained = 0;
  for (const formation of s.formations) {
    if (!s.enemies.some(enemy => enemy.formation === formation && !enemy.dead)) continue;
    s.formations[retained++] = formation;
  }
  s.formations.length = retained;
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
