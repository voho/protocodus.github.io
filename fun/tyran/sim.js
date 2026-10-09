import { normalizeLevel, combatTier, cycleScale } from './campaign.js';
import { ENEMY_TYPES } from './ships.js';
import { normalizeDifficulty, difficultyProfile } from './difficulty.js';
import { waveTactics, applyTactics, FORMATION_KINDS } from './tactics.js';
import { createDirector, updateDirector, enemyGoal, isDormant, startChallenge, updateChallenge, tractorReach, startDive, DIVE_LOOP, ENCOUNTER_WAVE } from './waves.js';
import { applyRole, roleScoreScale, roleCreditScale, roleCollisionDamage, healable, HAZARD_ROLES, MINE_LIFETIME, PHANTOM_CYCLE, PHANTOM_VISIBLE } from './roles.js';
export { applyRole } from './roles.js';

export const UPGRADES = [
  { id: 'weapon', name: 'Ion armament', subtitle: 'More firepower for every weapon and drone.', base: 420, icon: '⌁' },
  { id: 'fireRate', name: 'Fire rate', subtitle: '+2% base fire rate per rank for guns and drones.', base: 540, icon: '»' },
  { id: 'firePower', name: 'Fire power', subtitle: '+2% base shot damage per rank for guns and drones.', base: 600, icon: '✦' },
  { id: 'shield', name: 'Flux shield', subtitle: 'A larger energy barrier.', base: 340, icon: '◇' },
  { id: 'hull', name: 'Titanium hull', subtitle: 'Stronger armor. More inertia.', base: 300, icon: '⬡' },
  { id: 'recharge', name: 'Fusion capacitor', subtitle: 'Recover shields and fire energy faster, sooner.', base: 280, icon: 'ϟ' },
];
export const MAX_UPGRADE = 6;
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const upgradeRank = value => {
  const rank = Number(value);
  return Number.isFinite(rank) ? clamp(Math.floor(rank), 0, MAX_UPGRADE) : 0;
};
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
export const BONUS_DURATION = 10;
export const RAPID_FIRE_MULTIPLIER = 1.65;
export const SECONDARY_ENERGY_COST = 20;
export const SECONDARY_RESTART_ENERGY = 40;
// Weapons divert reactor output from shields. A short settling window makes
// releasing fire a deliberate recovery choice rather than a between-shot trick.
export const SHIELD_FIRE_DELAY = .75;
export const SHIELD_FIRING_RECHARGE = .1;
export const SHIELD_REST_RECHARGE = 1.25;
// In-flight progression: power cores widen the primary weapon, wing drones fly
// in formation, nova charges clear the sky and reserve ships continue a sector.
export const MAX_POWER = 4;
export const MAX_DRONES = 2;
export const MAX_BOMBS = 5;
export const MAX_LIVES = 5;
export const START_LIVES = 2;
export const START_BOMBS = 3;
export const FIRST_EXTRA_LIFE = 30000, EXTRA_LIFE_STEP = 120000;
const campaignTotal = value => clamp(Math.floor(Number(value) || 0), 0, Number.MAX_SAFE_INTEGER);
// The numeric ceiling is an exhausted milestone, never a repeating reward.
export function nextLifeAfterScore(score, threshold = FIRST_EXTRA_LIFE) {
  const next = Math.max(FIRST_EXTRA_LIFE, campaignTotal(threshold));
  if (next > score) return next;
  const passed = Math.floor((campaignTotal(score) - next) / EXTRA_LIFE_STEP) + 1;
  return Math.min(Number.MAX_SAFE_INTEGER, next + passed * EXTRA_LIFE_STEP);
}
export const RESPAWN_DELAY = 1.8, RESPAWN_GUARD = 3;
export const PICKUP_KINDS = Object.freeze(['repair', 'credit', 'rapid', 'invulnerable', 'power', 'drone', 'bomb']);
const DRONE_SLOTS = [[-50, 16], [50, 16]];
// Drones hang on an underdamped spring: they swing a few units past their
// slot when the ship stops, then settle. At full speed they trail about 22
// units, slightly less than the earlier rigid follow.
const DRONE_STIFFNESS = 150, DRONE_DAMPING = 9;
const DRONE_COLOR = '#ffc46b';

// Pulse provides unlimited sustained fire. Plasma spends a regenerating reserve
// for stronger bursts and area damage against clustered ships and ground sites.
export const WEAPONS = [
  { id: 'pulse', name: 'Pulse Array', tag: 'Rapid precision', description: 'Fast, precise twin bolts with reliable reach.', kind: 'pulse', color: '#9cfff0', interval: .17, damage: 9.8, count: 2, spread: .018, speed: 900, life: 1.35, radius: 3.8 },
  { id: 'plasma', name: 'Plasma Mortar', tag: 'Guided blast', description: 'Gently guided explosive orbs favor large nearby enemies and consume fire energy. Overloads barriers.', kind: 'plasma', color: '#ff9e7d', interval: .41, damage: 58, count: 1, spread: .012, speed: 640, life: 2.45, radius: 8, splash: 50, splashFactor: .46, homing: .65 },
];
// Three primary guns for the Space channel, bought once in the shop. Each has
// five power levels collected in flight; the pattern grows, never the hitbox.
export const PRIMARIES = [
  { ...WEAPONS[0], tag: 'Focused stream', description: 'Fast bolts that stack into a dense forward stream. Energy: strips barriers.', cost: 0 },
  { id: 'scatter', name: 'Scatter Cannon', tag: 'Wide fan', description: 'A fan of short-range pellets that covers the whole swarm. Kinetic: glances off barriers.', kind: 'scatter', color: '#ffd37a', interval: .22, damage: 7.4, count: 3, spread: .14, speed: 820, life: .95, radius: 3.7, cost: 1100 },
  { id: 'lance', name: 'Lance Driver', tag: 'Piercing', description: 'Heavy needles that punch through entire columns and push part of each hit through barriers.', kind: 'lance', color: '#c9b2ff', interval: .3, damage: 25, count: 1, spread: 0, speed: 1350, life: 1, radius: 4.2, pierce: 2, cost: 1600 },
];
const primaryById = new Map(PRIMARIES.map(weapon => [weapon.id, weapon]));
export const normalizePrimary = id => primaryById.has(id) ? id : 'pulse';
// [x offset, angle, damage scale, extra pierce] for every power level.
const VOLLEYS = {
  pulse: [
    [[-5, 0], [5, 0]],
    [[-9, 0, .9], [0, 0, .9], [9, 0, .9]],
    [[-12, -.035, .85], [-4, 0, .85], [4, 0, .85], [12, .035, .85]],
    [[-16, -.07, .8], [-8, -.02, .8], [0, 0, .8], [8, .02, .8], [16, .07, .8]],
    [[-24, -.26, .6], [-16, -.07, .78], [-8, -.02, .78], [0, 0, .78], [8, .02, .78], [16, .07, .78], [24, .26, .6]],
  ],
  scatter: [
    [-.14, 0, .14], [-.24, -.12, 0, .12, .24], [-.26, -.13, 0, .13, .26],
    [-.3, -.2, -.1, 0, .1, .2, .3], [-.36, -.27, -.18, -.09, 0, .09, .18, .27, .36],
  ].map((angles, power) => angles.map(angle => [angle * 18, angle, [1, .9, .9, .82, .76][power]])),
  lance: [
    [[0, 0, 1, 0]], [[0, 0, 1.25, 1]], [[-8, 0, 1, 1], [8, 0, 1, 1]],
    [[-13, -.03, 1, 2], [0, 0, 1, 2], [13, .03, 1, 2]], [[-13, -.03, 1.1, 4], [0, 0, 1.1, 4], [13, .03, 1.1, 4]],
  ],
};
const RATE = { pulse: [1, 1, 1, 1, 1], scatter: [1, 1, 1.14, 1.14, 1.2], lance: [1, 1, 1, 1.06, 1.18] };
const weaponById = new Map(WEAPONS.map(weapon => [weapon.id, weapon]));
const legacyHeavyWeapons = new Set(['scatter', 'seeker', 'arc']);
export const normalizeWeapon = id => id === 'plasma' || legacyHeavyWeapons.has(id) ? 'plasma' : 'pulse';
export const weaponInfo = id => weaponById.get(normalizeWeapon(id));
export const comboLabel = combo => combo >= 5 ? 'Rampage' : combo >= 3 ? 'Multi kill' : combo >= 2 ? 'Double kill' : '';
const comboTier = combo => combo >= 5 ? 3 : combo >= 3 ? 2 : combo >= 2 ? 1 : 0;
const comboDamageFor = combo => [1, 1.1, 1.18, 1.27][comboTier(combo)];
const comboBlastFor = combo => [1, 1.12, 1.24, 1.38][comboTier(combo)];
export const upgradeCost = (s, id) => Math.round(UPGRADES.find(u => u.id === id).base * 1.55 ** upgradeRank(s.upgrades[id]));
export const shipStats = u => ({ hull: 120 + u.hull * 45, shield: 85 + u.shield * 38, recharge: 10 + u.recharge * 5, delay: Math.max(.8, 3.2 - u.recharge * .35), damage: 13 + u.weapon * 6,
  energy: 100, energyRecharge: 18 + u.recharge * 3, energyDelay: Math.max(.4, 1 - u.recharge * .1),
  mass: 1 + u.hull * .055 + u.weapon * .018 + u.shield * .014 + u.recharge * .008 });

// Support equipment sold in the shop between sectors.
export const SUPPLIES = [
  { id: 'drone', name: 'Wing drone', subtitle: 'An escort that mirrors your primary fire and blocks stray rounds.', icon: '⟁', cost: 750 },
  { id: 'bomb', name: 'Nova charge', subtitle: 'Clears hostile fire and strikes every ship on screen.', icon: '✺', cost: 260 },
  { id: 'life', name: 'Reserve ship', subtitle: 'Continue the sector after your ship is destroyed.', icon: '▲', cost: 1500 },
];
export const supplyCost = (s, id) => {
  const base = SUPPLIES.find(item => item.id === id)?.cost ?? Infinity;
  return id === 'life' ? Math.round(base * 1.35 ** (s.livesBought || 0)) : base;
};
export function supplyStock(s, id) {
  const pilot = s.players[0];
  return id === 'drone' ? [pilot?.drones || 0, MAX_DRONES] : id === 'bomb' ? [pilot?.bombs || 0, MAX_BOMBS] : [s.lives || 0, MAX_LIVES];
}

export function weaponStats(s, id = s.players?.[0]?.weapon ?? s.weapon) {
  const profile = primaryById.get(id) && id !== 'pulse' ? primaryById.get(id) : weaponInfo(id), level = upgradeRank(s.upgrades?.weapon);
  const fireRate = upgradeRank(s.upgrades?.fireRate), firePower = upgradeRank(s.upgrades?.firePower);
  return {
    ...profile,
    level, fireRate,
    damage: profile.damage * (1 + level * .105 + firePower * .02),
    baseInterval: profile.interval / (1 + level * .022),
    interval: profile.interval / (1 + level * .022 + fireRate * .02),
    spread: profile.spread * (1 - level * .018),
    splash: (profile.splash || 0) + (profile.id === 'plasma' ? level * 4 : 0),
  };
}

/** Equipped primary at the pilot's current power level. */
export function primaryStats(s, pilot = s.players?.[0]) {
  const id = normalizePrimary(s.primary), base = weaponStats(s, id), power = clamp(Math.floor(pilot?.power || 0), 0, MAX_POWER);
  const volley = VOLLEYS[id][power];
  return { ...base, power, volley, count: volley.length, baseInterval: base.baseInterval / RATE[id][power], interval: base.interval / RATE[id][power] };
}

/** Actual sustained spacing at the game's fixed 60 Hz simulation rate. */
export function firingInterval(profile, rapid = false) {
  const baseline = profile.baseInterval ?? profile.interval;
  let remaining = baseline / (rapid ? RAPID_FIRE_MULTIPLIER : 1), ticks = 0;
  // Preserve the old cooldown's exact rounding, including floating-point
  // boundaries (for example, the Lance Driver's .3s takes 19 ticks).
  do { remaining -= 1 / 60; ticks++; } while (remaining > 0);
  return ticks / 60 * profile.interval / baseline;
}

export function selectWeapon(s, id, playerId = 0) {
  if (!s || !weaponById.has(id) || !['playing', 'hangar'].includes(s.status)) return false;
  if (!Number.isInteger(playerId) || !s.players[playerId]) return false;
  const player = s.players[playerId];
  if (playerId === 0) s.weapon = id;
  if (player.weapon === id) return true;
  player.weapon = id;
  // Legacy selection metadata cannot change either dedicated firing channel
  // or bypass the shared shot cooldown.
  s.events.push({ type: 'weapon', weapon: id, player: playerId });
  return true;
}

export const FORMATIONS = [...FORMATION_KINDS];
const FORMATION_LAYOUTS = {
  vee: [[0, -58], [-58, -22], [58, -22], [-116, 22], [116, 22]],
  wall: [[-150, 0], [-90, 8], [-30, 14], [30, 14], [90, 8], [150, 0]],
  orbit: [[0, -92], [80, -45], [80, 45], [0, 92], [-80, 45], [-80, -45]],
  escort: [[0, -18], [-74, 22], [74, 22], [-118, 70], [118, 70]],
  pincer: [[-150, -20], [-188, 35], [-218, 90], [150, -20], [188, 35], [218, 90]],
  // Newer shapes. Their motion families are listed below; offsets stay authored
  // (and saved) while the anchor's age drives every rotation, wave and pulse.
  diamond: [[0, -96], [84, 0], [0, 96], [-84, 0], [0, 0]],
  column: [[0, -150], [0, -90], [0, -30], [0, 30], [0, 90], [0, 150]],
  crescent: [[-170, -40], [-105, -84], [-36, -104], [36, -104], [105, -84], [170, -40]],
  ring: [[0, -110], [78, -78], [110, 0], [78, 78], [0, 110], [-78, 78], [-110, 0], [-78, -78]],
  spear: [[0, -120], [-42, -64], [42, -64], [-84, -8], [84, -8], [-126, 48], [126, 48]],
  helix: [[0, -46], [0, 46], [-104, -40], [104, -40], [-104, 40], [104, 40]],
};
// orbit: members circle the anchor; spin: the whole shape turns rigidly;
// breathe: the shape expands and contracts; snake: members weave laterally by
// index; helix: an inner pair and an outer ring turn against each other; hold
// and depart: how long the anchor keeps its lane before a fast charge through it.
const FORMATION_MOTION = {
  vee: {}, wall: {}, escort: {}, orbit: { orbit: .75 }, pincer: { wiggle: 15 },
  diamond: { spin: .55 }, ring: { spin: -.8, breathe: .12, rate: 1.1 },
  column: { snake: 55, rate: 1.6, phase: .7 }, crescent: { breathe: .18, rate: .9 },
  spear: { hold: 1.6, depart: 260 }, helix: { helix: true },
};
const RADIAL_FORMATIONS = new Set(['orbit', 'diamond', 'ring', 'helix']);
// Escorts, diamonds and spears fly behind a heavier leader. Shooting it down
// breaks the group: half the survivors panic-dive, the rest scatter.
const formationLeader = (kind, index) => (kind === 'escort' && index === 0) || (kind === 'diamond' && index === 4) || (kind === 'spear' && index === 0);
// Members of a tactical formation fire one rippled salvo along the line.
const SALVO_STEP = .12;
// Live members per formation, derived every step: survivors close ranks
// without saving any extra choreography.
const formationCohesion = new WeakMap(), formationRank = new WeakMap();
function updateCohesion(s) {
  for (const formation of s.formations) {
    let rx = 0, ry = 0;
    for (const offset of formation.offsets) { rx = Math.max(rx, Math.abs(offset.x)); ry = Math.max(ry, Math.abs(offset.y)); }
    formationCohesion.set(formation, { alive: 0, cx: 0, rx, ry });
  }
  for (const enemy of s.enemies) {
    const cohesion = enemy.formation && !enemy.dead && formationCohesion.get(enemy.formation);
    if (!cohesion) continue;
    formationRank.set(enemy, cohesion.alive++);
    cohesion.cx += enemy.formationOffset?.x || 0;
  }
  for (const formation of s.formations) { const cohesion = formationCohesion.get(formation); if (cohesion.alive) cohesion.cx /= cohesion.alive; }
}
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

const confinePilot = (s, p) => constrain(p, 30, s.width - 30, 105, s.height - 42);
// Heavy hulls shove the pilot clear instead of letting it sit inside them
// and take a ram every time its hit immunity expires.
function repel(s, p, e) {
  const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
  const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : 1, overlap = Math.max(0, p.radius + e.radius * .75 - d);
  p.x += nx * overlap * .5; p.y += ny * overlap * .5;
  p.blastVx = clamp((p.blastVx || 0) + nx * 90, -MAX_BLAST_SPEED, MAX_BLAST_SPEED);
  p.blastVy = clamp((p.blastVy || 0) + ny * 90, -MAX_BLAST_SPEED, MAX_BLAST_SPEED);
  confinePilot(s, p);
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

// Only call for newly destroyed scenery returned by WorldRenderer.hit. Its
// persistent crater set is also the authority that prevents duplicate rewards.
export function applyGroundReward(s, prop, blast = 1) {
  // Natural scenery is decorative: it never awards salvage or triggers fire.
  if (!prop.structural) return;
  s.destroyed++; s.credits += prop.value || 8; s.score += 25;
  applyStructureBlast(s, prop);
  if (['repair', 'credit', 'rapid', 'invulnerable'].includes(prop.bonus)) {
    s.pickups.push({ x: prop.x, y: prop.y, age: 0, kind: prop.bonus, value: prop.bonus === 'credit' ? 90 : 0 });
  }
  s.events.push({ type: 'explosion', ...prop, size: Math.min(48, prop.size || 22), ground: true, blast });
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

const newStats = () => ({ shots: 0, hits: 0, squads: 0, dives: 0, rescues: 0, encounters: 0, aces: 0, convoys: 0, hazards: 0 });
/** A fresh campaign salt; zero keeps the authored reference choreography. */
export const freshSalt = () => Math.floor(Math.random() * 4294967296) >>> 0;

export function createCampaign(level = 0, checkpoint = null, difficulty = 'easy', salt = 0) {
  const state = {
    mode: 1, level: normalizeLevel(level), status: 'playing', difficulty: normalizeDifficulty(checkpoint?.difficulty === undefined ? difficulty : checkpoint.difficulty),
    // The salt varies wave order, tactics and encounters between campaigns;
    // retries and saves keep it so a sector replays the same choices.
    salt: checkpoint && Number.isFinite(checkpoint.salt) ? checkpoint.salt >>> 0 : Number.isFinite(salt) ? salt >>> 0 : 0,
    upgrades: { weapon: 0, fireRate: 0, firePower: 0, shield: 0, hull: 0, recharge: 0 }, credits: 0, score: 0,
    width: 1200, height: 900, time: 0, scroll: 0, scrollSpeed: 0, enemies: [], bullets: [], pickups: [], players: [], turrets: [],
    events: [], kills: 0, destroyed: 0, totalKills: 0, combo: 0, comboTime: 0, comboDamage: 1, comboBlast: 1, comboLabel: '',
    weapon: 'pulse', formations: [], nextEnemyId: 1, nextFormationId: 1, formationTimer: 11,
    bossSpawned: false, bossDefeated: false, bossDeathTime: 0, spawnTimer: 1, showcase: 0,
    primary: 'pulse', owned: ['pulse'], lives: START_LIVES, livesBought: 0, nextLife: FIRST_EXTRA_LIFE,
  };
  let carry = { power: 0, drones: 0, bombs: START_BOMBS };
  if (checkpoint) {
    for (const id of Object.keys(state.upgrades)) state.upgrades[id] = upgradeRank(checkpoint.upgrades?.[id]);
    state.credits = campaignTotal(checkpoint.credits);
    state.score = campaignTotal(checkpoint.score);
    state.totalKills = campaignTotal(checkpoint.totalKills);
    state.weapon = normalizeWeapon(checkpoint.weapon);
    state.owned = PRIMARIES.map(weapon => weapon.id).filter(id => id === 'pulse' || checkpoint.owned?.includes?.(id));
    state.primary = state.owned.includes(checkpoint.primary) ? checkpoint.primary : 'pulse';
    state.livesBought = clamp(Math.floor(Number(checkpoint.livesBought) || 0), 0, 20);
    state.nextLife = nextLifeAfterScore(state.score, checkpoint.nextLife);
    // A retry continues with at least the starting reserve and nova stock.
    state.lives = clamp(Math.max(START_LIVES, Math.floor(Number(checkpoint.lives) || 0)), 0, MAX_LIVES);
    const pilot = checkpoint.players?.[0];
    carry = { power: clamp(Math.floor(Number(pilot?.power) || 0), 0, MAX_POWER), drones: clamp(Math.floor(Number(pilot?.drones) || 0), 0, MAX_DRONES),
      bombs: clamp(Math.max(START_BOMBS, Math.floor(Number(pilot?.bombs) || 0)), 0, MAX_BOMBS) };
  }
  state.players = [{ id: 0, ...carry }];
  beginLevel(state, state.level);
  if (checkpoint) {
    for (const player of state.players) player.weapon = normalizeWeapon(checkpoint.players?.[player.id]?.weapon ?? checkpoint.weapon);
    state.weapon = state.players[0].weapon;
  }
  return state;
}

export function beginLevel(s, level) {
  s.difficulty = normalizeDifficulty(s.difficulty);
  const previous = s.players[0] || {};
  const weapon = normalizeWeapon(previous.weapon ?? s.weapon);
  Object.assign(s, { mode: 1, level: normalizeLevel(level), time: 0, scroll: 0, status: 'playing', enemies: [], bullets: [], pickups: [], turrets: [], events: [], formations: [], kills: 0, destroyed: 0, combo: 0, comboTime: 0, comboDamage: 1, comboBlast: 1, comboLabel: '', bossSpawned: false, bossDefeated: false, bossDeathTime: 0, spawnTimer: 1.5, showcase: 0, formationTimer: 10.5 });
  s.duration = sectorDuration(s.level);
  s.salt = Number.isFinite(s.salt) ? s.salt >>> 0 : 0;
  s.director = createDirector(s.level, s.salt); s.hive = { age: 0 }; s.squadrons = []; s.nextSquadId = 1;
  s.challenge = null; s.beams = []; s.respawn = 0; s.stats = newStats();
  s.primary = normalizePrimary(s.primary); s.owned = s.owned?.length ? s.owned : ['pulse'];
  s.lives = clamp(Number.isFinite(s.lives) ? s.lives : START_LIVES, 0, MAX_LIVES);
  s.nextLife = s.nextLife || FIRST_EXTRA_LIFE; s.livesBought = s.livesBought || 0;
  const stats = shipStats(s.upgrades);
  const x = s.width * .5, y = s.height * .68;
  const drones = clamp(Math.floor(previous.drones || 0), 0, MAX_DRONES);
  s.players = [{ id: 0, weapon, x, y, px: x, py: y, vx: 0, vy: 0, blastVx: 0, blastVy: 0, mass: stats.mass, thrust: .9, radius: 17, hull: stats.hull, shield: stats.shield, maxHull: stats.hull, maxShield: stats.shield, fire: 0, fireEnergy: stats.energy, fireEnergyDelay: 0, fireEnergyLocked: false, shieldFireDelay: 0, hurt: 0, lastHit: -10, alive: true, rapidFireTime: 0, invulnerableTime: 0,
    power: clamp(Math.floor(previous.power || 0), 0, MAX_POWER), drones, bombs: clamp(Math.max(2, Math.floor(previous.bombs ?? START_BOMBS)), 0, MAX_BOMBS), guard: 0, bombHeld: false,
    wing: DRONE_SLOTS.slice(0, drones).map(([dx, dy]) => ({ x: x + dx, y: y + dy, px: x + dx, py: y + dy })) }];
  s.weapon = s.players[0].weapon;
  s.scrollSpeed = missionScrollSpeed(s, 0);
  return s;
}

export function buyUpgrade(s, id) {
  if (s.status !== 'hangar' || !UPGRADES.some(u => u.id === id)) return false;
  const rank = upgradeRank(s.upgrades[id]);
  if (rank >= MAX_UPGRADE) return false;
  const cost = upgradeCost(s, id);
  if (s.credits < cost) return false;
  s.credits -= cost;
  s.upgrades[id] = rank + 1;
  return true;
}

/** Buy a primary gun once, or equip one already owned. */
export function buyPrimary(s, id) {
  const weapon = primaryById.get(id);
  if (s.status !== 'hangar' || !weapon) return false;
  if (!s.owned.includes(id)) {
    if (s.credits < weapon.cost) return false;
    s.credits -= weapon.cost; s.owned = [...s.owned, id];
  }
  s.primary = id;
  return true;
}

export function buySupply(s, id) {
  if (s.status !== 'hangar' || !SUPPLIES.some(item => item.id === id)) return false;
  const [stock, max] = supplyStock(s, id), cost = supplyCost(s, id), pilot = s.players[0];
  if (stock >= max || s.credits < cost) return false;
  s.credits -= cost;
  if (id === 'drone') pilot.drones++;
  else if (id === 'bomb') pilot.bombs++;
  else { s.lives++; s.livesBought++; }
  return true;
}

export function spawnEnemy(s, type, x, y = -100) {
  type = clamp(type, 0, 9);
  const spec = ENEMY_TYPES[type], boss = type === 9;
  // Capital ships gain reinforced armor so late fights survive a fully upgraded volley.
  // Guardians grow each sector without turning the late campaign into a
  // damage sponge; the open-core rhythm supplies the challenge instead.
  // Guardians carry extra armor because power cores and drones multiply player fire.
  const hp = spec.hp * (1 + combatTier(s.level) * (boss ? .08 : .24)) * (boss ? 1.8 : 1) * cycleScale(s.level, .22) * difficultyProfile(s.difficulty).health;
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

// Resolved offsets are saved; this derived fit/velocity cache is rebuilt once
// on restoration or resize without adding mutable choreography to the save.
const formationGeometry = new WeakMap();
const formationMotion = { x: 0, y: 0 };
function fitFormation(s, formation, radii) {
  const offsets = formation.offsets, orbit = RADIAL_FORMATIONS.has(formation.kind), wiggle = formation.kind === 'pincer' ? 15 : 0;
  const maxRadius = formation.hullRadius || Math.max(...radii, 12), available = Math.max(1, s.width * .5 - maxRadius - wiggle - 20);
  let extent = 0;
  for (const offset of offsets) extent = Math.max(extent, orbit ? Math.hypot(offset.x, offset.y) : Math.abs(offset.x));
  const fit = Math.min(1, available / Math.max(1, extent));
  if (fit < 1) for (const offset of offsets) { offset.x *= fit; if (orbit) offset.y *= fit; }
  if (orbit) {
    // Turning shapes keep their member order; heavy hulls simply need a wider
    // circle. A narrow arena grows the shape upward into a tall ellipse instead.
    let closest = Infinity;
    for (let i = 0; i < offsets.length; i++) for (let j = i + 1; j < offsets.length; j++) closest = Math.min(closest, Math.hypot(offsets[i].x - offsets[j].x, offsets[i].y - offsets[j].y));
    const growth = (maxRadius * 2 + 12) / Math.max(1, closest);
    if (growth > 1 + 1e-6) {
      const across = Math.max(1, Math.min(growth, available / Math.max(1, extent * fit)));
      for (const offset of offsets) { offset.x *= across; offset.y *= growth; }
    }
  }
  if (!orbit && (formation.entry || fit < 1)) {
    // Compressing a wide rank is not enough: six large hulls still need their
    // physical space. Reflow crowded groups into depth without changing their
    // member order, leaving their lower edge above the pilot's normal row.
    const separation = maxRadius * 2 + wiggle * 2 + 12;
    let closest = Infinity, horizontal = 0;
    for (const offset of offsets) horizontal = Math.max(horizontal, Math.abs(offset.x));
    for (let i = 0; i < offsets.length; i++) for (let j = i + 1; j < offsets.length; j++) {
      closest = Math.min(closest, Math.hypot(offsets[i].x - offsets[j].x, offsets[i].y - offsets[j].y));
    }
    const growth = separation / Math.max(1, closest);
    if (growth > 1 + 1e-6 && horizontal * growth <= available) {
      // On a wide arena, expand the authored V/escort/pincer before considering
      // extra rows, so its tactical silhouette stays recognizable.
      for (const offset of offsets) { offset.x *= growth; offset.y *= growth; }
    } else if (growth > 1 + 1e-6) {
      const columns = Math.max(1, Math.min(offsets.length, 1 + Math.floor(available * 2 / separation)));
      const rows = Math.ceil(offsets.length / columns), arms = formation.kind === 'pincer' && columns >= 2;
      for (let i = 0; i < offsets.length; i++) {
        const row = arms ? i % Math.ceil(offsets.length / 2) : Math.floor(i / columns);
        const col = arms ? Math.floor(i / Math.ceil(offsets.length / 2)) : i % columns;
        const rowColumns = arms ? 2 : Math.min(columns, offsets.length - row * columns);
        offsets[i].x = (col - (rowColumns - 1) * .5) * separation;
        offsets[i].y = (row - ((arms ? Math.ceil(offsets.length / 2) : rows) - 1) * .5) * separation;
      }
    }
  }
  let left = 0, right = 0, top = 0, bottom = 0;
  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i], radius = formation.hullRadius || radii[i] || maxRadius, span = orbit ? Math.hypot(offset.x, offset.y) : 0;
    left = Math.min(left, (orbit ? -span : offset.x) - radius - wiggle);
    right = Math.max(right, (orbit ? span : offset.x) + radius + wiggle);
    top = Math.min(top, (orbit ? -span : offset.y) - radius - wiggle);
    bottom = Math.max(bottom, (orbit ? span : offset.y) + radius + wiggle);
  }
  const minX = Math.min(s.width * .5, 20 - left), maxX = Math.max(s.width * .5, s.width - 20 - right);
  const side = formation.entry === 'left' ? -1 : formation.entry === 'right' ? 1 : 0;
  const startX = side < 0 ? -right - 40 : side > 0 ? s.width - left + 40 : formation.baseX;
  const entryTime = side ? Math.max(4.8, Math.abs(clamp(formation.baseX, minX, maxX) - startX) / 220) : 480 / 84;
  const geometry = { width: s.width, radii, minX, maxX, startX, startY: -bottom - 40, entryTime, vx: 0, vy: 0 };
  formationGeometry.set(formation, geometry);
  return geometry;
}

export function spawnFormation(s, kind = null, wave = null, order = 0) {
  const tactic = wave == null ? null : waveTactics(s.level, wave, s.salt || 0), slot = Math.abs(Math.floor(order)) % 2;
  kind = kind || (tactic ? tactic.formationKinds[slot] : FORMATIONS[Math.floor((s.nextFormationId - 1) % FORMATIONS.length)]);
  if (s.bossSpawned || !FORMATION_LAYOUTS[kind] || (wave == null && s.enemies.length > 15)) return null;
  const offsets = FORMATION_LAYOUTS[kind].map(([x, y]) => ({ x, y }));
  const anchor = { id: s.nextFormationId++, kind, label: formationName(kind), age: 0, baseX: tactic ? s.width * (.5 + .15 * tactic.formationDrift) : rand(s.width * .25, s.width * .75), x: 0, y: -150, offsets, members: offsets.length };
  if (tactic) Object.assign(anchor, { entry: tactic.formationEntries[slot], motionSpeed: tactic.formationSpeed, drift: tactic.formationDrift });
  anchor.x = anchor.baseX;
  s.formations.push(anchor);
  // Scripted formation waves scale with the sector; free formations with elapsed time.
  const tier = wave == null ? clamp(Math.floor(s.time / 14) + Math.floor(combatTier(s.level) / 3), 0, 6) : clamp(1 + Math.floor(combatTier(s.level) / 2) + tactic.formationTier, 0, 5);
  const members = [], radii = [];
  offsets.forEach((offset, index) => {
    // Escorts and diamonds fly a heavier leader; spears carry a heavy tip.
    const escort = formationLeader(kind, index);
    const type = clamp(tier + (escort ? 2 : index % 3 === 0 ? 1 : 0), 0, 8);
    const enemy = spawnEnemy(s, type, anchor.x + offset.x, anchor.y + offset.y);
    enemy.formation = anchor; enemy.formationOffset = offset; enemy.formationIndex = index;
    if (tactic) { enemy.wave = wave; applyTactics(enemy, tactic); }
    members.push(enemy); radii.push(enemy.radius);
  });
  anchor.hullRadius = Math.max(...radii, 12);
  if (tactic) {
    // The shared interval is the harmonic mean, so the group keeps its total
    // fire rate while its members ripple in order.
    let rate = 0;
    for (const enemy of members) rate += 1 / volleyInterval(s, enemy);
    anchor.salvo = members.length / rate;
    members.forEach((enemy, index) => { enemy.fire = 1.2 + index * SALVO_STEP; });
  }
  const geometry = fitFormation(s, anchor, radii);
  if (tactic) {
    anchor.baseX = clamp(anchor.baseX, geometry.minX, geometry.maxX);
    anchor.x = anchor.entry === 'top' ? anchor.baseX : geometry.startX;
    anchor.y = anchor.entry === 'top' ? geometry.startY : 180;
  }
  for (const enemy of members) {
    enemy.x = enemy.px = anchor.x + enemy.formationOffset.x;
    enemy.y = enemy.py = anchor.y + enemy.formationOffset.y;
  }
  s.events.push({ type: 'formation', formation: kind, label: anchor.label, count: offsets.length, x: anchor.x, y: anchor.y });
  return anchor;
}

function bolt(s, p, x, y, angle, profile, damage, extra = {}) {
  s.bullets.push({ x, y, px: x, py: y, vx: Math.cos(angle) * profile.speed, vy: Math.sin(angle) * profile.speed,
    damage, baseDamage: profile.damage, radius: profile.radius, team: p.id, life: profile.life,
    color: '#9cfff0', weaponColor: profile.color, kind: profile.kind, pierce: profile.pierce || 0, homing: profile.homing || 0,
    splash: profile.splash || 0, splashFactor: profile.splashFactor || 0, chain: profile.chain || 0, chainRange: profile.chainRange || 0,
    chainFactor: profile.chainFactor || .6, hitIds: [], age: 0, comboBlast: s.comboBlast || 1, ...extra });
}

function shoot(s, p, id, remainder = 0) {
  p.shieldFireDelay = SHIELD_FIRE_DELAY;
  const comboDamage = s.comboDamage || 1;
  // Keep the existing single-player damage balance.
  const damageAssist = 1.35;
  let profile;
  if (id === 'plasma') {
    profile = weaponStats(s, 'plasma');
    for (let i = 0; i < profile.count; i++) {
      const offset = i - (profile.count - 1) / 2, angle = -Math.PI / 2 + offset * profile.spread;
      bolt(s, p, p.x + Math.cos(angle) * offset * 5, p.y - 24, angle, profile, profile.damage * comboDamage * damageAssist);
    }
    s.stats.shots += profile.count;
  } else {
    profile = primaryStats(s, p);
    for (const [dx, spread, scale = 1, pierce = 0] of profile.volley) {
      const angle = -Math.PI / 2 + spread;
      // Only the central bolts strike ground scenery, so a wide volley widens
      // air coverage without multiplying salvage from the terrain.
      const extra = { pierce: (profile.pierce || 0) + pierce };
      if (Math.abs(dx) >= 10 || Math.abs(spread) >= .15) extra.ground = false;
      bolt(s, p, p.x + dx, p.y - 24 + Math.abs(dx) * .35, angle, profile, profile.damage * scale * comboDamage * damageAssist, extra);
    }
    s.stats.shots += profile.volley.length;
    // Wing drones echo each primary volley with a light, straight bolt.
    const pulse = weaponStats(s, 'pulse');
    for (const drone of p.wing || []) {
      bolt(s, p, drone.x, drone.y - 14, -Math.PI / 2, { ...pulse, color: DRONE_COLOR, radius: 3.1 }, pulse.damage * .55 * comboDamage * damageAssist, { drone: true, ground: false });
    }
  }
  // New rate ranks retain fractional progress between held shots. Zero ranks
  // keep the original timing, and fresh presses never inherit idle-time debt.
  p.fire = profile.fireRate > 0 ? firingInterval(profile, p.rapidFireTime > 0) + remainder
    : profile.interval / (p.rapidFireTime > 0 ? RAPID_FIRE_MULTIPLIER : 1);
  p.weapon = id === 'plasma' ? 'plasma' : 'pulse';
  if (p.id === 0) s.weapon = p.weapon;
  s.events.push({ type: 'shot', player: p.id, weapon: id === 'plasma' ? 'plasma' : profile.id, x: p.x, y: p.y });
}

function hostileShot(s, e, angle, speed = 220, radius = 5, origin = null) {
  if (s.hostileCount >= MAX_HOSTILE_BULLETS) return;
  const difficulty = difficultyProfile(s.difficulty);
  speed *= difficulty.shotSpeed;
  const sizeRatio = clamp(e.radius / 110, .08, 1);
  const bulletRadius = clamp((Number(radius) || 5) * (.42 + sizeRatio * .72), 2.2, e.boss ? 8.4 : 6.4);
  // Later sectors hit harder so upgraded hulls still respect incoming fire.
  const damage = (e.boss
    ? clamp(13 + e.radius * .12 + e.type * .4, 13, 28)
    : clamp(3.8 + e.radius * .16 + e.type * .42, 4.5, 17.5)) * (1 + combatTier(s.level) * .09) * cycleScale(s.level, .12) * difficulty.damage;
  const variant = e.boss ? 5 : e.type % 5;
  const x = origin?.x ?? e.x, y = origin?.y ?? e.y + e.radius * .65;
  s.bullets.push({ x, y, px: origin?.x ?? e.x, py: origin?.y ?? e.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    damage, radius: bulletRadius, team: -1, life: 7, color: e.boss ? '#ff5d78' : BULLET_SPECTRUM[e.type % BULLET_SPECTRUM.length], kind: 'hostile', variant, sourceRadius: e.radius, age: 0 });
  s.hostileCount++;
}

// A bomb is a slow, blinking hostile round; its fuse turns it into a ring of
// six ordinary rounds, all within the hostile projectile budget.
const BOMB_PROFILE = Object.freeze({ radius: 22, type: 3, boss: false });
function dropBomb(s, e, target) {
  if (s.hostileCount >= MAX_HOSTILE_BULLETS) return;
  const drift = target ? clamp((target.x - e.x) * .12, -50, 50) : 0;
  s.bullets.push({ x: e.x, y: e.y + e.radius * .7, px: e.x, py: e.y, vx: drift, vy: 150 * difficultyProfile(s.difficulty).shotSpeed, damage: 8 * difficultyProfile(s.difficulty).damage,
    radius: 9, team: -1, life: 7, color: '#ffb36b', kind: 'hostile', variant: 5, sourceRadius: e.radius, age: 0, fuse: 1.5 });
  s.hostileCount++;
}
function burstBomb(s, bomb) {
  const origin = { x: bomb.x, y: bomb.y };
  for (let i = 0; i < 6; i++) hostileShot(s, BOMB_PROFILE, i * TAU / 6 + .3, 175, 4.5, origin);
  s.events.push({ type: 'blast', x: bomb.x, y: bomb.y, size: 24, color: '#ff9a4b' });
}

// Splitters release three diving needles when destroyed; the bounded enemy
// list and the dive's own departure keep a hive wipe from snowballing.
function splitEnemy(s, e) {
  if (s.enemies.length > 60) return;
  const pilot = s.players.find(p => p.alive) || null;
  for (const side of [-1, 0, 1]) {
    const child = spawnEnemy(s, 0, clamp(e.x + side * 24, 30, s.width - 30), e.y + 8);
    child.wave = e.wave; child.hp = child.maxHp = child.maxHp * .8; child.age = 0;
    if (pilot) { startDive(s, child, pilot); child.returnToHive = false; child.diveSide = side || 1; }
    else child.ai = 'leave';
  }
  s.events.push({ type: 'split', x: e.x, y: e.y, size: e.radius });
}

// Per-tick role behaviour: barriers recharge, phantoms cycle their cloak,
// medics repair neighbours, minelayers drop mines and mines expire.
function updateRole(s, e, dt) {
  if (e.shieldMax && e.shieldHp < e.shieldMax && s.time - (e.shieldHit ?? -10) > 3) e.shieldHp = Math.min(e.shieldMax, e.shieldHp + e.shieldMax * .08 * dt);
  const role = e.role;
  if (role === 'phantom') {
    e.cloak = (e.cloak || 0) + dt;
    const phase = e.cloak % PHANTOM_CYCLE;
    e.cloaked = phase >= PHANTOM_VISIBLE;
  } else if (role === 'medic') {
    e.healClock = (e.healClock ?? .4) - dt;
    if (e.healClock <= 0) {
      e.healClock = .4;
      let patient = null, best = 190 * 190;
      for (const other of s.enemies) {
        if (other === e || !healable(other) || isDormant(other)) continue;
        const dx = other.x - e.x, dy = other.y - e.y, squared = dx * dx + dy * dy;
        if (squared < best) { best = squared; patient = other; }
      }
      if (patient) {
        patient.hp = Math.min(patient.maxHp, patient.hp + Math.max(4, patient.maxHp * .04));
        s.events.push({ type: 'arc', x: e.x, y: e.y, toX: patient.x, toY: patient.y, size: 8, color: '#8affd7' });
      }
    }
  } else if (role === 'miner') {
    e.dropTimer = (e.dropTimer ?? 1) - dt;
    if (e.dropTimer <= 0 && (e.mineBudget ?? 0) > 0 && e.y > 40 && e.y < s.height * .6 && e.x > 20 && e.x < s.width - 20) {
      e.dropTimer = 1.05; e.mineBudget--;
      const mine = spawnEnemy(s, 0, e.x, e.y + e.radius + 6);
      applyRole(mine, 'mine', { driftX: rand(-24, 24) });
      mine.wave = ENCOUNTER_WAVE; mine.ai = 'drift';
    }
  } else if (role === 'mine' && e.age > MINE_LIFETIME) {
    e.gone = true;
    s.events.push({ type: 'blast', x: e.x, y: e.y, size: 12, color: '#ff8b78' });
  }
}

function resetCombo(s, emit = false) {
  if (emit && s.combo >= 2) s.events.push({ type: 'combo-end', combo: s.combo });
  s.combo = 0; s.comboTime = 0; s.comboDamage = 1; s.comboBlast = 1; s.comboLabel = '';
}

function nearestEnemy(s, x, y, maxDistance = Infinity, exclude = null) {
  let found = null, nearest = maxDistance * maxDistance;
  for (const enemy of s.enemies) {
    if (enemy.dead || enemy === exclude || enemy.cloaked || isDormant(enemy)) continue;
    const dx = enemy.x - x, dy = enemy.y - y, squared = dx * dx + dy * dy;
    if (squared < nearest) { nearest = squared; found = enemy; }
  }
  return found;
}

function plasmaTarget(s, bullet) {
  let found = null, priority = Infinity;
  for (const enemy of s.enemies) {
    if (enemy.dead || enemy.hp <= 0 || enemy.cloaked || isDormant(enemy)
      || enemy.x < 0 || enemy.x > s.width || enemy.y < 0 || enemy.y > s.height) continue;
    const dx = enemy.x - bullet.x, dy = enemy.y - bullet.y, squared = dx * dx + dy * dy;
    if (squared > 650 * 650 || dx * bullet.vx + dy * bullet.vy < 0) continue;
    // Favor larger hulls at similar range, but let much closer ships win.
    // One scan stays cheap even in a swarm; the turn limit smooths retargeting.
    const score = squared / Math.max(12, enemy.radius);
    if (score < priority) { priority = score; found = enemy; }
  }
  return found;
}

function guideProjectile(s, bullet, dt) {
  if (!bullet.homing || bullet.team < 0) return;
  const target = bullet.kind === 'plasma' ? plasmaTarget(s, bullet) : nearestEnemy(s, bullet.x, bullet.y, 650);
  if (!target) return;
  const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
  let angle = Math.atan2(bullet.vy, bullet.vx), wanted = Math.atan2(target.y - bullet.y, target.x - bullet.x);
  let delta = wanted - angle;
  if (delta > Math.PI) delta -= TAU;
  else if (delta < -Math.PI) delta += TAU;
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

// How each weapon class meets an energy barrier. Energy bolts strip it, plasma
// overloads it, kinetic pellets glance off and armor-piercing needles push part
// of their force straight through. Hull damage is unchanged once it is down.
export const BARRIER_RESPONSE = Object.freeze({
  pulse: Object.freeze({ barrier: 1.5, bleed: 0 }),
  plasma: Object.freeze({ barrier: 1.25, bleed: 0 }),
  scatter: Object.freeze({ barrier: .65, bleed: 0 }),
  lance: Object.freeze({ barrier: .6, bleed: .4 }),
});
const NEUTRAL_RESPONSE = Object.freeze({ barrier: 1, bleed: 0 });

/** Apply hull damage after any energy barrier; returns the hull damage dealt. */
export function damageEnemy(s, enemy, amount, kind = null) {
  if (!(amount > 0)) return 0;
  if (enemy.shieldMax && enemy.shieldHp > 0) {
    const response = BARRIER_RESPONSE[kind] || NEUTRAL_RESPONSE, bleed = amount * response.bleed;
    enemy.shieldHit = s.time;
    // The multiplier applies to the barrier only: overflow returns to raw damage.
    const absorbed = Math.min(enemy.shieldHp, (amount - bleed) * response.barrier);
    enemy.shieldHp -= absorbed; amount -= absorbed / response.barrier;
    const broke = enemy.shieldHp <= 1e-9;
    if (broke) enemy.shieldHp = 0;
    s.events.push({ type: broke ? 'barrier-break' : 'blocked', x: enemy.x, y: enemy.y - enemy.radius * .4, size: broke ? enemy.radius : 10, shield: true,
      strong: response.barrier > 1, resist: response.barrier < 1, pierce: bleed > 0 });
    if (amount <= 1e-9) return 0;
  }
  enemy.hp -= amount;
  return amount;
}

function damageSplash(s, bullet, origin) {
  const radius = bullet.splash * (bullet.comboBlast || 1);
  if (!radius) return;
  const radiusSquared = radius * radius;
  for (const enemy of s.enemies) {
    if (enemy.dead || enemy === origin || (enemy.boss && !enemy.vulnerable) || isDormant(enemy)) continue;
    const dx = enemy.x - origin.x, dy = enemy.y - origin.y, squared = dx * dx + dy * dy;
    if (squared >= radiusSquared) continue;
    const falloff = 1 - Math.sqrt(squared) / radius;
    const damage = bullet.damage * bullet.splashFactor * Math.max(.2, falloff);
    damageEnemy(s, enemy, damage, bullet.kind); enemy.hurt = .09;
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
  damageEnemy(s, target, damage); target.hurt = .1;
  bullet.chain--;
  s.events.push({ type: 'arc', x: origin.x, y: origin.y, toX: target.x, toY: target.y, size: 8, color: bullet.weaponColor || bullet.color });
  if (target.hp <= 0) killEnemy(s, target);
}

function updateFormationAnchors(s, dt) {
  updateCohesion(s);
  let needsFit = false;
  for (const formation of s.formations) {
    const geometry = formationGeometry.get(formation);
    if (!geometry || geometry.width !== s.width) needsFit = true;
  }
  if (needsFit) {
    // Restore membership in one pass rather than searching enemies per group.
    const pending = new Map();
    for (const formation of s.formations) {
      const geometry = formationGeometry.get(formation);
      if (!geometry || geometry.width !== s.width) pending.set(formation, new Array(formation.offsets.length).fill(0));
    }
    for (const enemy of s.enemies) {
      const radii = pending.get(enemy.formation);
      if (radii) radii[enemy.formationIndex] = enemy.radius;
    }
    for (const [formation, radii] of pending) fitFormation(s, formation, radii);
  }
  for (const formation of s.formations) {
    formation.age += dt;
    const geometry = formationGeometry.get(formation);
    const motion = FORMATION_MOTION[formation.kind] || {};
    if (formation.entry) {
      const beforeX = formation.x, beforeY = formation.y, time = formation.age * (formation.motionSpeed || 1);
      const entry = geometry.entryTime, departure = entry + (motion.hold ?? 4.5), drift = formation.drift || 0;
      const lane = clamp(formation.baseX, geometry.minX, geometry.maxX);
      const excursion = Math.min(80, Math.max(0, (geometry.maxX - geometry.minX) * .25));
      if (time < entry) {
        const fraction = time / entry, ease = fraction * fraction * (3 - 2 * fraction);
        const startX = formation.entry === 'top' ? lane : geometry.startX;
        formation.x = startX + (lane - startX) * ease;
        formation.y = formation.entry === 'top' ? geometry.startY + (300 - geometry.startY) * ease : 180 + 120 * ease;
      } else {
        const travel = time - entry;
        formation.x = clamp(lane + Math.sin(travel * .6) * excursion * drift, geometry.minX, geometry.maxX);
        formation.y = time < departure ? 300 + Math.sin(travel * Math.PI / 4.5) * 28 : 300 + (time - departure) * (motion.depart ?? 135);
      }
      geometry.vx = dt > 0 ? (formation.x - beforeX) / dt : 0;
      geometry.vy = dt > 0 ? (formation.y - beforeY) / dt : 0;
      continue;
    }
    const sway = Math.sin(formation.age * (formation.kind === 'orbit' ? .7 : .48) + formation.id) * (formation.kind === 'pincer' ? 26 : 42);
    // Preserve the legacy flight on roomy arenas and avoid inverted clamp
    // bounds on phones, where its fixed 180px margins cannot both fit.
    const margin = Math.min(180, s.width * .5);
    formation.x = clamp(formation.baseX + sway, Math.max(margin, geometry.minX), Math.min(s.width - margin, geometry.maxX));
    // Enter together, sweep the combat lane, then fly through. A stationary
    // anchor leaves surviving ships behind and eventually blocks new waves.
    const entry = 480 / 84, departure = motion.hold != null ? entry + motion.hold : 11;
    formation.y = formation.age < entry ? -150 + formation.age * 84
      : formation.age < departure ? 330 + Math.sin((formation.age - entry) * Math.PI / (departure - entry)) * 32
      : 330 + (formation.age - departure) * (motion.depart ?? 105);
  }
}

function formationVelocity(enemy) {
  const formation = enemy.formation;
  if (!formation) return null;
  const offset = enemy.formationOffset || { x: 0, y: 0 }, motion = FORMATION_MOTION[formation.kind] || {}, age = formation.age, index = enemy.formationIndex;
  const cohesion = formationCohesion.get(formation), rank = formationRank.get(enemy);
  // Rings and orbits spread their survivors evenly; lines re-centre on the anchor.
  const count = cohesion?.alive || formation.offsets.length, slot = cohesion?.alive ? rank ?? index : index;
  let x = offset.x, y = offset.y;
  if (motion.orbit) {
    const angle = age * motion.orbit + slot * TAU / count;
    const radius = Math.hypot(offset.x, offset.y);
    x = Math.cos(angle) * radius; y = Math.sin(angle) * radius;
  } else if (formation.kind === 'ring' && cohesion) {
    // Fitted rings may be tall ellipses in narrow arenas; keep their axes.
    const angle = -Math.PI / 2 + slot * TAU / count + age * motion.spin;
    x = Math.cos(angle) * cohesion.rx; y = Math.sin(angle) * cohesion.ry;
  } else if (motion.spin || motion.helix) {
    const angle = age * (motion.helix ? (index < 2 ? 1.2 : -.5) : motion.spin), cos = Math.cos(angle), sin = Math.sin(angle);
    x = offset.x * cos - offset.y * sin; y = offset.x * sin + offset.y * cos;
  }
  if (motion.breathe) { const scale = 1 + motion.breathe * Math.sin(age * motion.rate); x *= scale; y *= scale; }
  if (!RADIAL_FORMATIONS.has(formation.kind) && cohesion?.alive) x -= cohesion.cx;
  if (motion.snake) x += Math.sin(age * motion.rate + index * motion.phase) * motion.snake;
  if (motion.wiggle) {
    x += Math.sin(age * 1.3 + index) * motion.wiggle;
    y += Math.cos(age * .7 + index) * 10;
  }
  const desiredX = formation.x + x, desiredY = formation.y + y;
  const response = .14;
  if (formation.entry) {
    const geometry = formationGeometry.get(formation), speed = Math.max(300, enemy.speed * 3) * (formation.motionSpeed || 1);
    formationMotion.x = clamp((geometry?.vx || 0) + (desiredX - enemy.x) / response, -speed, speed);
    formationMotion.y = clamp((geometry?.vy || 0) + (desiredY - enemy.y) / response, -speed, speed);
  } else {
    formationMotion.x = clamp((desiredX - enemy.x) / response, -enemy.speed * 1.65, enemy.speed * 1.65);
    formationMotion.y = clamp((desiredY - enemy.y) / response, -enemy.speed * 1.3, enemy.speed * 1.3);
  }
  return formationMotion;
}

function volleyInterval(s, e) {
  const spacing = e.formation ? 1.32 : e.ai === 'entry' ? 1.2 : 1;
  return Math.max(.85, Number(ENEMY_TYPES[e.type].fireRate) || 2.2) * spacing / (1 + combatTier(s.level) * .035);
}

function nearestPilot(s, e) {
  let target = null;
  for (const p of s.players) if (p.alive && (!target || distance(p, e) < distance(target, e))) target = p;
  return target;
}

// Lancers lock a firing line, telegraph it, then fire a short heavy beam.
const BEAM_FIRE = .42;
function startBeam(s, e, target) {
  const x = e.x, y = e.y + e.radius * .7;
  s.beams.push({ owner: e.id, angle: Math.atan2(target.y - y, target.x - x), t: 0, warn: Math.max(.72, 1 - combatTier(s.level) * .025), dx: 0, dy: e.radius * .7 });
  s.events.push({ type: 'beam-charge', x, y });
}

function updateBeams(s, dt) {
  let retained = 0;
  for (const beam of s.beams) {
    const owner = s.enemies.find(enemy => enemy.id === beam.owner && !enemy.dead);
    beam.t += dt;
    if (!owner || beam.t > beam.warn + BEAM_FIRE || s.bossDefeated) continue;
    beam.x = owner.x + beam.dx; beam.y = owner.y + beam.dy;
    if (beam.t >= beam.warn) {
      if (!beam.fired) { beam.fired = true; s.events.push({ type: 'beam', x: beam.x, y: beam.y, angle: beam.angle }); }
      const cos = Math.cos(beam.angle), sin = Math.sin(beam.angle);
      for (const p of s.players) {
        if (!p.alive) continue;
        const along = (p.x - beam.x) * cos + (p.y - beam.y) * sin, across = Math.abs(-(p.x - beam.x) * sin + (p.y - beam.y) * cos);
        if (along > 0 && across < 14 + p.radius * .55) hurtPlayer(s, p, (15 + combatTier(s.level) * .9) * cycleScale(s.level, .12) * difficultyProfile(s.difficulty).damage);
      }
    }
    s.beams[retained++] = beam;
  }
  s.beams.length = retained;
}

function enemyFire(s, e) {
  const target = nearestPilot(s, e);
  if (!target) return;
  // Passing craft cease fire once they reach the pilot's row. This leaves a
  // readable escape route instead of spawning unavoidable shots from behind.
  if (!e.boss && e.y > target.y - e.radius - 55) { e.fire = .25; return; }
  const aimed = Math.atan2(target.y - e.y, target.x - e.x);
  const speed = 175 + combatTier(s.level) * 7 + e.type * 4;
  if (e.role === 'bomber') {
    dropBomb(s, e, target); e.fire = 2.1; return;
  } else if (e.role === 'ace') {
    // Tight aimed triple with two wide sentinels; quicker than any regular hull.
    for (let i = -1; i <= 1; i++) hostileShot(s, e, aimed + i * .11, speed * 1.15, 5);
    for (const side of [-1, 1]) hostileShot(s, e, aimed + side * .55, speed * .9, 4.5);
    e.fire = .95; return;
  } else if (e.role === 'elite') {
    for (let i = -1; i <= 1; i++) hostileShot(s, e, aimed + i * .1, speed * 1.1, 5);
    e.fire = Math.max(.75, (Number(ENEMY_TYPES[e.type].fireRate) || 2.2) * .7 / (1 + combatTier(s.level) * .035)); return;
  }
  if (e.boss) {
    const phase = e.hp / e.maxHp < .3 ? 2 : e.hp / e.maxHp < .65 ? 1 : 0;
    if (phase > e.phase) { e.phase = phase; s.events.push({ type: 'phase', x: e.x, y: e.y }); }
    const n = phase === 2 ? 10 : phase === 1 ? 8 : 6;
    for (let i = 0; i < n; i++) hostileShot(s, e, i * Math.PI * 2 / n + e.age * .21 + combatTier(s.level) * .25, speed * .88, 6);
    for (let i = -1 - phase; i <= 1 + phase; i++) hostileShot(s, e, aimed + i * .14, speed * 1.23, 5);
    e.fire = [1.35, 1.07, .82][phase];
    e.warning = .2;
  } else if (e.role === 'midboss') {
    // Heavy cruisers alternate a slow ring with a fast aimed fan.
    e.volley = ((e.volley || 0) + 1) % 2;
    if (e.volley) for (let i = 0; i < 12; i++) hostileShot(s, e, i * TAU / 12 + e.age * .3, speed * .72, 6);
    else for (let i = -2; i <= 2; i++) hostileShot(s, e, aimed + i * .13, speed * 1.08, 5);
    e.fire = Math.max(1.05, 1.7 - combatTier(s.level) * .05);
  } else if (e.type === 5 && e.ai === 'station') {
    startBeam(s, e, target);
    e.fire = Math.max(2.3, 3.3 - combatTier(s.level) * .08);
  } else {
    const pattern = e.type % 4;
    if (pattern === 0) hostileShot(s, e, aimed, speed);
    if (pattern === 1) for (const i of [-1, 1]) hostileShot(s, e, Math.PI / 2 + i * .23, speed);
    if (pattern === 2) for (let i = -1; i <= 1; i++) hostileShot(s, e, aimed + i * .16, speed * .95);
    if (pattern === 3) for (let i = 0; i < 4; i++) hostileShot(s, e, i * Math.PI / 2 + e.age * .12, speed * .85);
    e.fire = e.formation?.salvo || volleyInterval(s, e);
  }
}

// Energy rounds and beams spend themselves on the shield. Kinetic impacts
// (rams, meteors, mines and bombs) push part of their force through it.
export const KINETIC_BLEED = .3;
// A collapsing shield vents one pulse that clears nearby rounds, then needs a
// longer reboot than an ordinary hit before it recharges.
export const SHIELD_BREAK_DELAY = .5, SHIELD_COLLAPSE_RADIUS = 140;

function collapseShield(s, p) {
  const cancels = [], reach = SHIELD_COLLAPSE_RADIUS * SHIELD_COLLAPSE_RADIUS;
  // Mark rounds spent rather than filtering: the bullet loop may be iterating.
  for (const b of s.bullets) {
    if (b.team >= 0 || b.life <= 0) continue;
    const dx = b.x - p.x, dy = b.y - p.y;
    if (dx * dx + dy * dy > reach) continue;
    b.life = 0; s.hostileCount = Math.max(0, (s.hostileCount || 0) - 1);
    if (cancels.length < 24) cancels.push([Math.round(b.x), Math.round(b.y)]);
  }
  p.lastHit = s.time + SHIELD_BREAK_DELAY;
  s.events.push({ type: 'shield-break', x: p.x, y: p.y, size: SHIELD_COLLAPSE_RADIUS, cancels });
}

export function hurtPlayer(s, p, damage, kind = 'energy') {
  if (!p.alive || p.hurt > 0 || p.invulnerableTime > 0 || p.guard > 0) return;
  const bleed = kind === 'kinetic' ? damage * KINETIC_BLEED : 0, shielded = p.shield > 0;
  const absorbed = Math.min(p.shield, damage - bleed), hull = damage - absorbed;
  p.shield -= absorbed;
  p.hull = Math.max(0, p.hull - hull);
  p.hurt = .36;
  // A rebooting shield keeps its later restart time.
  p.lastHit = Math.max(s.time, p.lastHit ?? -10);
  resetCombo(s, true);
  s.events.push({ type: 'hit', x: p.x, y: p.y, shield: absorbed > 0, hull: hull > 0, kinetic: bleed > 0 });
  if (shielded && p.shield <= 0 && p.hull > 0) collapseShield(s, p);
  if (p.hull <= 0) {
    p.alive = false; p.rapidFireTime = 0; p.invulnerableTime = 0;
    // Losing a ship costs two power levels and one wing drone.
    p.power = Math.max(0, (p.power || 0) - 2); p.drones = Math.max(0, (p.drones || 0) - 1);
    if (p.wing) p.wing.length = Math.min(p.wing.length, p.drones);
    s.respawn = RESPAWN_DELAY;
    s.events.push({ type: 'explosion', x: p.x, y: p.y, size: 50, player: true, vx: p.vx, vy: p.vy });
  } else if (hull > 0 && p.power > 0) {
    // A hull breach knocks a power core loose; catch it again before it drifts away.
    p.power--;
    s.pickups.push({ x: p.x, y: p.y - 26, age: 0, kind: 'power', value: 0, vx: rand(-110, 110), vy: -170, lock: 1.1 });
    s.events.push({ type: 'power-lost', x: p.x, y: p.y });
  }
}

function respawn(s, p) {
  const stats = shipStats(s.upgrades), x = s.width * .5, y = s.height * .8;
  s.lives--;
  Object.assign(p, { alive: true, hull: stats.hull, shield: stats.shield, maxHull: stats.hull, maxShield: stats.shield, x, y, px: x, py: y, vx: 0, vy: 0, blastVx: 0, blastVy: 0,
    hurt: 0, guard: RESPAWN_GUARD, fire: .2, fireEnergy: stats.energy, fireEnergyDelay: 0, fireEnergyLocked: false, shieldFireDelay: 0, bombs: Math.max(p.bombs || 0, 2), lastHit: s.time });
  p.wing = DRONE_SLOTS.slice(0, p.drones || 0).map(([dx, dy]) => ({ x: x + dx, y: y + dy, px: x + dx, py: y + dy }));
  // Clear the launch lane so a new ship never appears inside a volley.
  s.bullets = s.bullets.filter(b => b.team >= 0 || Math.hypot(b.x - x, b.y - y) > 280);
  s.events.push({ type: 'respawn', x, y, lives: s.lives });
}

function detonateNova(s, p) {
  p.shieldFireDelay = SHIELD_FIRE_DELAY;
  p.bombs--; p.guard = Math.max(p.guard || 0, 1.4);
  const cancels = [];
  let retained = 0;
  for (const b of s.bullets) {
    if (b.team < 0) { if (b.life > 0) { s.score += 10; if (cancels.length < 90) cancels.push([Math.round(b.x), Math.round(b.y)]); } continue; }
    s.bullets[retained++] = b;
  }
  s.bullets.length = retained; s.hostileCount = 0; s.beams.length = 0;
  const damage = (120 + combatTier(s.level) * 26 + s.upgrades.weapon * 16) * cycleScale(s.level, .22);
  for (const e of s.enemies) {
    if (e.dead || isDormant(e) || e.y < -e.radius || e.y > s.height + e.radius || e.x < -e.radius || e.x > s.width + e.radius) continue;
    if (e.boss) { if (!e.vulnerable) continue; e.hp -= Math.min(damage * 3, e.maxHp * .05); }
    else damageEnemy(s, e, e.role === 'midboss' ? damage * .6 : damage);
    e.hurt = .12; e.cloaked = false; e.cloak = 0;
    if (e.ai === 'captor' && e.capState > 0 && e.capState < 3) { e.capState = 0; e.capTimer = 2.6; }
    if (e.hp <= 0) killEnemy(s, e);
  }
  s.events.push({ type: 'nova', x: p.x, y: p.y, cancels });
}

function squadronCleared(s, e, squad) {
  const pilot = s.players[0];
  if (squad.challenge) {
    const bonus = Math.round(squad.size * 125 * (1 + combatTier(s.level) * .1) * cycleScale(s.level, .3));
    s.score += bonus;
    s.events.push({ type: 'squadron', x: e.x, y: e.y, bonus, size: squad.size, challenge: true });
    return;
  }
  s.stats.squads++;
  const bonus = Math.round(squad.size * 90 * (squad.bonusFlight ? 2 : 1) * (1 + combatTier(s.level) * .15) * cycleScale(s.level, .3));
  s.score += bonus; s.credits += Math.round(bonus * .06);
  s.events.push({ type: 'squadron', x: e.x, y: e.y, bonus, size: squad.size });
  // Every third wiped squadron (starting with the first) releases a power core.
  if (s.stats.squads % 3 === 1 && (pilot?.power ?? MAX_POWER) < MAX_POWER) s.pickups.push({ x: e.x, y: e.y, age: 0, kind: 'power', value: 0 });
  else s.pickups.push({ x: e.x, y: e.y, age: 0, kind: 'credit', value: Math.round((60 + combatTier(s.level) * 12) * cycleScale(s.level, .3)) });
}

function breakFormation(s, formation, leader) {
  const pilot = s.players.find(p => p.alive) || null;
  const bonus = Math.round((250 + combatTier(s.level) * 50) * cycleScale(s.level, .3));
  let rank = 0;
  for (const enemy of s.enemies) {
    if (enemy.formation !== formation || enemy === leader || enemy.dead) continue;
    if (pilot && rank++ % 2 === 0) { startDive(s, enemy, pilot); enemy.returnToHive = false; }
    else enemy.ai = 'retreat';
    enemy.formation = null; enemy.formationOffset = null; delete enemy.formationIndex;
  }
  s.score += bonus; s.credits += Math.round(bonus * .06);
  s.events.push({ type: 'formation-broken', x: leader.x, y: leader.y, bonus, label: formation.label });
}

export function killEnemy(s, e, cause = 'shot') {
  if (e.dead) return;
  e.dead = true;
  const chain = s.comboTime > 0 ? s.combo + 1 : 1;
  s.kills++; s.totalKills++; s.combo = chain; s.comboTime = Math.min(5.2, 3 + comboTier(chain) * .55);
  s.comboDamage = comboDamageFor(chain); s.comboBlast = comboBlastFor(chain); s.comboLabel = comboLabel(chain);
  const multiplier = Math.min(4, 1 + Math.floor(chain / 10));
  // Galaga rule: a ship shot down mid-dive is worth double. Specialist roles
  // scale their prizes: elites and aces double, hazards pay a token.
  const diving = e.ai === 'dive';
  const reward = Math.round((ENEMY_TYPES[e.type].score || 100) * roleScoreScale(e) * (1 + combatTier(s.level) * .15) * cycleScale(s.level, .3)) * (diving ? 2 : 1);
  s.score += reward * multiplier;
  // Salvage grows more gently than score so late sectors do not flood the shop.
  s.credits += Math.round((ENEMY_TYPES[e.type].score || 100) * roleCreditScale(e) * (diving ? 2 : 1) * .09 * (1 + combatTier(s.level) * .06) * cycleScale(s.level, .3));
  if (diving && s.stats) s.stats.dives++;
  if (s.stats) {
    if (e.role === 'ace') s.stats.aces = (s.stats.aces || 0) + 1;
    if (e.role === 'convoy') s.stats.convoys = (s.stats.convoys || 0) + 1;
    if (HAZARD_ROLES.has(e.role) && cause !== 'ram') s.stats.hazards = (s.stats.hazards || 0) + 1;
  }
  s.events.push({ type: 'explosion', x: e.x, y: e.y, size: e.radius * 1.3 * s.comboBlast, boss: e.boss, value: reward * multiplier, shipType: e.type, blast: s.comboBlast, dive: diving, midboss: e.role === 'midboss', cause,
    vx: (e.vx || 0) + (e.blastVx || 0), vy: (e.vy || 0) + (e.blastVy || 0) });
  if (chain >= 2) s.events.push({ type: 'combo', x: e.x, y: e.y, combo: chain, label: s.comboLabel, damageBoost: s.comboDamage, blastBoost: s.comboBlast, time: s.comboTime });
  if (e.challenge && s.challenge) s.challenge.hits++;
  if (e.squad) {
    const squad = s.squadrons?.find(item => item.id === e.squad);
    if (squad) { squad.killed++; if (squad.killed >= squad.size && !squad.broken) squadronCleared(s, e, squad); }
  }
  if (e.role === 'splitter' && cause !== 'clear') splitEnemy(s, e);
  if (e.formation && formationLeader(e.formation.kind, e.formationIndex) && !s.bossDefeated) breakFormation(s, e.formation, e);
  if (e.role === 'convoy') s.pickups.push({ x: e.x, y: e.y, age: 0, kind: 'credit', value: Math.round(110 * cycleScale(s.level, .3)) });
  if (e.role === 'ace') {
    const pilot = s.players[0];
    s.pickups.push({ x: e.x - 34, y: e.y, age: 0, kind: 'power', value: 0 }, { x: e.x + 34, y: e.y, age: 0, kind: (pilot?.bombs || 0) < MAX_BOMBS ? 'bomb' : 'repair', value: 0 },
      { x: e.x, y: e.y + 30, age: 0, kind: 'credit', value: Math.round(260 * cycleScale(s.level, .3)) });
    s.events.push({ type: 'ace-down', x: e.x, y: e.y, aceName: e.aceName });
  }
  if (e.captive) {
    // Rescue: the captured drone flies home and rejoins the wing.
    const pilot = s.players[0];
    e.captive = 0;
    if (pilot) {
      pilot.drones = Math.min(MAX_DRONES, (pilot.drones || 0) + 1);
      pilot.wing = pilot.wing || [];
      if (pilot.wing.length < pilot.drones) pilot.wing.push({ x: e.x, y: e.y + e.radius, px: e.x, py: e.y + e.radius });
    }
    s.score += 1500; if (s.stats) s.stats.rescues++;
    s.events.push({ type: 'rescue', x: e.x, y: e.y + e.radius, toX: pilot?.x, toY: pilot?.y });
  }
  if (e.boss) {
    s.bossDefeated = true; s.bossDeathTime = s.time;
    s.bullets = s.bullets.filter(b => b.team !== -1);
    if (s.beams) s.beams.length = 0;
    for (const other of s.enemies) if (!other.boss && !other.dead) { other.dead = true; s.events.push({ type: 'explosion', x: other.x, y: other.y, size: other.radius }); }
    for (const other of s.enemies) if (other.role === 'splitter') other.role = null;
  } else if (e.role === 'midboss') {
    const pilot = s.players[0];
    s.pickups.push({ x: e.x - 30, y: e.y, age: 0, kind: 'power', value: 0 });
    s.pickups.push({ x: e.x + 30, y: e.y, age: 0, kind: (pilot?.drones || 0) < MAX_DRONES ? 'drone' : 'repair', value: 0 });
  } else if (e.challenge || e.squad) {
    // Squadron ships pay out through the squadron bonus instead of loose drops.
  } else if (e.ai === 'station' && (e.type === 4 || e.type === 5) && Math.random() < .35) {
    s.pickups.push({ x: e.x, y: e.y, age: 0, kind: 'bomb', value: 0 });
  } else if (Math.random() < .22 || e.type >= 6) {
    s.pickups.push({ x: e.x, y: e.y, age: 0, kind: Math.random() < .32 ? 'repair' : 'credit', value: Math.round((40 + e.type * 8) * cycleScale(s.level, .3)) });
  }
}

// Clearing the screen opens up the flight pace. Queued arrivals and departed
// ships do not slow terrain the player can see; the boss has its own base pace.
export const MAX_SCROLL_SPEED = 300; // Bonus rounds outrun the normal final-approach ceiling.
export function missionScrollSpeed(s, time = s.time) {
  let count = 0;
  for (const enemy of s.enemies) {
    if (enemy.dead || enemy.gone || enemy.hp <= 0 || isDormant(enemy) || (s.bossSpawned && enemy.boss) || HAZARD_ROLES.has(enemy.role)) continue;
    const r = enemy.radius || 0;
    if (enemy.x + r <= 0 || enemy.x - r >= s.width || enemy.y + r <= 0 || enemy.y - r >= s.height) continue;
    count++;
  }
  const crowd = .4 + .6 / (1 + count / 4);
  if (s.challenge && !s.challenge.done) return 300 * crowd;
  if (s.bossSpawned) return 42 * crowd;
  const progress = clamp(time / Math.max(1, s.duration), 0, 1);
  const ramp = progress * progress * (3 - 2 * progress);
  return (92 + combatTier(s.level) * 3) * (1 + .75 * ramp) * crowd;
}

function advanceMissionScroll(s, dt) {
  const target = missionScrollSpeed(s, s.time + dt * .5);
  const speed = Number.isFinite(s.scrollSpeed) ? clamp(s.scrollSpeed, 0, MAX_SCROLL_SPEED) : missionScrollSpeed(s);
  // Brake into a crowded wave, then build speed more gradually as it clears.
  // Integrate the exponential response as distance as well as velocity, so
  // 30/60/120 Hz steps do not change the momentum or ground collision plane.
  const responseTime = target < speed ? .65 : 1.8;
  const response = -Math.expm1(-dt / responseTime);
  s.scroll += target * dt + (speed - target) * responseTime * response;
  s.scrollSpeed = speed + (target - speed) * response;
}

export const challengeSector = s => normalizeLevel(s.level) % 2 === 0;
// Nominal flight time before the guardian; encounter timing stays independent of terrain speed.
export const sectorDuration = level => 140 + combatTier(level) * 6;

function finishSector(s) {
  const rewardScale = cycleScale(s.level, .3);
  const bonus = Math.round((650 + combatTier(s.level) * 100) * rewardScale);
  s.credits += bonus; s.score += Math.round(2500 * (combatTier(s.level) + 1) * rewardScale);
  s.status = 'hangar';
  s.events.push({ type: s.status, bonus });
}

function updateWing(p, dt) {
  const wing = p.wing || (p.wing = []);
  while (wing.length < (p.drones || 0)) {
    const [dx, dy] = DRONE_SLOTS[wing.length];
    wing.push({ x: p.x + dx * .3, y: p.y + dy + 30, px: p.x, py: p.y + 30 });
  }
  wing.length = Math.min(wing.length, p.drones || 0);
  wing.forEach((drone, index) => {
    drone.px = drone.x; drone.py = drone.y;
    // Semi-implicit Euler stays stable up to the 50 ms step limit.
    drone.vx = (drone.vx || 0) + ((p.x + DRONE_SLOTS[index][0] - drone.x) * DRONE_STIFFNESS - (drone.vx || 0) * DRONE_DAMPING) * dt;
    drone.vy = (drone.vy || 0) + ((p.y + DRONE_SLOTS[index][1] - drone.y) * DRONE_STIFFNESS - (drone.vy || 0) * DRONE_DAMPING) * dt;
    drone.x += drone.vx * dt; drone.y += drone.vy * dt;
  });
}

function steerScripted(s, e, dt, pilot) {
  const goal = enemyGoal(s, e, dt, pilot);
  if (!goal) return;
  let vx, vy;
  if (goal.velocity) { vx = goal.vx; vy = goal.vy; }
  else { vx = goal.vx + (goal.x - e.x) / goal.tau; vy = goal.vy + (goal.y - e.y) / goal.tau; }
  const limit = goal.max || 900, speed = Math.hypot(vx, vy);
  if (speed > limit) { vx *= limit / speed; vy *= limit / speed; }
  accelerate(e, vx, vy, goal.response || .08, dt);
  if (['station', 'captor', 'hive'].includes(e.ai)) constrain(e, e.radius, s.width - e.radius);
}

function updateCaptor(s, e, dt, pilot) {
  if (e.capState === 3 && e.captive) {
    // The stolen drone turns its guns on its former pilot.
    e.captiveFire = (e.captiveFire ?? 1.2) - dt * difficultyProfile(s.difficulty).fireRate;
    if (e.captiveFire <= 0 && pilot && e.y < pilot.y - 120) {
      const origin = { x: e.x, y: e.y + e.radius + 18 };
      hostileShot(s, { ...e, type: 1, radius: 14 }, Math.atan2(pilot.y - origin.y, pilot.x - origin.x), 230 + combatTier(s.level) * 7, 5, origin);
      e.captiveFire = 1.5;
    }
    return;
  }
  if (e.capState !== 2 || !pilot) return;
  if (!tractorReach(e, pilot.x, pilot.y) || pilot.guard > 0 || pilot.invulnerableTime > 0) { e.capGrip = Math.max(0, (e.capGrip || 0) - dt); return; }
  if ((pilot.drones || 0) > 0) {
    e.capGrip = (e.capGrip || 0) + dt;
    if (e.capGrip >= .35) {
      pilot.drones--; const lost = pilot.wing.pop();
      Object.assign(e, { captive: 1, capState: 3, capTimer: 15, capGrip: 0, captiveFire: 1.4 });
      s.events.push({ type: 'captured', x: lost?.x ?? pilot.x, y: lost?.y ?? pilot.y, toX: e.x, toY: e.y + e.radius });
    }
    return;
  }
  // With no drone to steal, the beam drains shields and fire energy and hauls the ship upward.
  const drain = difficultyProfile(s.difficulty).damage;
  pilot.shield = Math.max(0, pilot.shield - 26 * dt * drain); pilot.fireEnergy = Math.max(0, pilot.fireEnergy - 34 * dt * drain);
  pilot.fireEnergyDelay = Math.max(pilot.fireEnergyDelay, .5);
  if (pilot.fireEnergy < SECONDARY_ENERGY_COST) pilot.fireEnergyLocked = true;
  pilot.lastHit = Math.max(s.time, pilot.lastHit ?? -10);
  pilot.blastVy = Math.max(-MAX_BLAST_SPEED, (pilot.blastVy || 0) - 520 * dt);
  pilot.blastVx = clamp((pilot.blastVx || 0) + Math.sign(e.x - pilot.x) * 240 * dt, -MAX_BLAST_SPEED, MAX_BLAST_SPEED);
}

export function update(s, dt, input = [], environmentHit = null) {
  if (s.status !== 'playing') return;
  dt = clamp(dt, 0, .05);
  advanceMissionScroll(s, dt);
  s.time += dt;
  s.beams = s.beams || []; s.stats = s.stats || newStats(); s.squadrons = s.squadrons || [];
  if (s.comboTime > 0) {
    s.comboTime -= dt;
    if (s.comboTime <= 0) resetCombo(s, true);
  }
  const stats = shipStats(s.upgrades);
  for (const p of s.players) {
    p.px = p.x; p.py = p.y;
    p.hurt = Math.max(0, p.hurt - dt);
    p.rapidFireTime = Math.max(0, (p.rapidFireTime || 0) - dt);
    p.invulnerableTime = Math.max(0, (p.invulnerableTime || 0) - dt);
    if (p.guard) p.guard = Math.max(0, p.guard - dt);
    if (!p.alive) continue;
    const controls = input[p.id] || {}, x = controls.x || 0, y = controls.y || 0;
    const norm = Math.max(1, Math.hypot(x, y));
    p.mass = stats.mass;
    accelerate(p, x / norm * PLAYER_SPEED, y / norm * PLAYER_SPEED, (x || y ? .095 : .13) * p.mass, dt);
    confinePilot(s, p);
    const thrustResponse = 1 - Math.exp(-dt / (.085 * Math.sqrt(p.mass)));
    p.thrust += (.9 + Math.hypot(x, y) / norm * .28 + Math.max(0, -y / norm) * .43 - p.thrust) * thrustResponse;
    if (p.wing || p.drones) updateWing(p, dt);
    const shieldLoad = p.shieldFireDelay || 0;
    p.shieldFireDelay = Math.max(0, shieldLoad - dt);
    // Integrate only the part of this tick after the recharge delay expires.
    // Primary fire does not interrupt recovery of the secondary reserve.
    const rechargeTime = Math.max(0, dt - p.fireEnergyDelay);
    p.fireEnergyDelay = Math.max(0, p.fireEnergyDelay - dt);
    p.fireEnergy = Math.min(stats.energy, p.fireEnergy + stats.energyRecharge * rechargeTime);
    if (p.fireEnergyLocked && p.fireEnergy >= SECONDARY_RESTART_ENERGY) p.fireEnergyLocked = false;
    // Nova charges trigger on a fresh press only.
    if (controls.bomb && !p.bombHeld && p.bombs > 0) detonateNova(s, p);
    if (p.bombHeld !== undefined || controls.bomb) p.bombHeld = !!controls.bomb;
    const fireWasCooling = p.fire > 0;
    p.fire -= dt;
    const remainder = fireWasCooling ? Math.min(0, p.fire) : 0;
    if (p.fire <= 0) {
      if (controls.secondary && !p.fireEnergyLocked && p.fireEnergy >= SECONDARY_ENERGY_COST) {
        p.fireEnergy -= SECONDARY_ENERGY_COST;
        p.fireEnergyDelay = stats.energyDelay;
        // Recharge enough for a useful burst instead of stuttering one shot
        // every time the meter reaches its minimum cost.
        if (p.fireEnergy < SECONDARY_ENERGY_COST) p.fireEnergyLocked = true;
        shoot(s, p, 'plasma', remainder);
      } else if (controls.fire) shoot(s, p, 'pulse', remainder);
    }
    // Integrate only the eligible portion of the tick, splitting at the hit
    // cooldown and weapon-load boundaries. A shot this tick immediately diverts
    // power; an empty trigger does not delay recovery. Neither rate heals hull.
    const shieldTime = clamp(s.time - p.lastHit - stats.delay, 0, dt);
    const loadedUntil = p.shieldFireDelay > 0 ? dt : Math.min(dt, shieldLoad);
    const loadedTime = Math.max(0, loadedUntil - (dt - shieldTime));
    if (shieldTime > 0) {
      const empty = p.shield <= 0;
      p.shield = Math.min(stats.shield, p.shield + stats.recharge *
        (loadedTime * SHIELD_FIRING_RECHARGE + (shieldTime - loadedTime) * SHIELD_REST_RECHARGE));
      if (empty && p.shield > 0) s.events.push({ type: 'shield-online', x: p.x, y: p.y });
    }
  }
  const pilot = s.players.find(p => p.alive) || null;
  if (!s.bossSpawned && s.director) {
    if (updateDirector(s, dt, spawnEnemy, spawnFormation, pilot)) spawnEnemy(s, 9, s.width / 2, -160);
  }
  if (s.challenge && !s.challenge.done) updateChallenge(s, dt);
  updateFormationAnchors(s, dt);
  // Count once per step, then reserve each shot as it is emitted. Dense boss
  // volleys no longer rescan the entire projectile array for every round.
  s.hostileCount = 0;
  for (const bullet of s.bullets) if (bullet.team < 0 && bullet.life > 0) s.hostileCount++;
  for (const e of s.enemies) {
    if (e.dead) continue;
    e.px = e.x; e.py = e.y;
    if (e.ai === 'entry' && e.pathD < 0) {
      // Queued conga-line ships wait offscreen until their turn.
      e.pathD += e.pathSpeed * dt;
      if (e.pathD < 0) continue;
      e.pathD -= e.pathSpeed * dt;
    }
    e.age += dt; e.hurt = Math.max(0, e.hurt - dt); e.warning = Math.max(0, e.warning - dt);
    if (e.boss && e.phase >= 1 && !s.bossDefeated && pilot) {
      // An enraged guardian launches pairs of interceptors that dive at the pilot.
      e.launch = (e.launch ?? 2.5) - dt;
      if (e.launch <= 0) {
        for (const side of [-1, 1]) {
          const interceptor = spawnEnemy(s, 0, e.x + side * e.radius * .7, e.y + e.radius * .3);
          startDive(s, interceptor, pilot);
          interceptor.diveSide = side; interceptor.returnToHive = false;
        }
        e.launch = Math.max(3.5, 7.5 - e.phase * 1.5 - combatTier(s.level) * .2);
      }
    }
    if (e.boss) {
      e.windowClock -= dt;
      if (e.windowClock <= 0) {
        e.vulnerable = !e.vulnerable; e.windowCount++;
        e.windowClock = e.vulnerable ? 4.4 : 1.3;
        s.events.push({ type: e.vulnerable ? 'boss-open' : 'boss-close', x: e.x, y: e.y, time: e.windowClock, openCount: e.windowCount });
      }
    }
    const response = .07 + Math.sqrt(e.mass) * .09, midpoint = e.age - dt * .5;
    if (e.role) { updateRole(s, e, dt); if (e.gone) continue; }
    if (e.ai && e.ai !== 'drift') {
      steerScripted(s, e, dt, pilot);
      if (e.gone) continue;
    } else {
      let targetX, targetY = e.speed;
      if (e.boss) {
        targetX = Math.cos(midpoint * .48) * Math.min(235, s.width * .24) * .48;
        targetY = (155 - e.y) * .7;
      } else if (HAZARD_ROLES.has(e.role)) {
        // Hazards tumble straight down with a fixed sideways drift.
        targetX = e.driftX || 0;
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
      if (!e.formation?.entry) constrain(e, e.radius, s.width - e.radius, -Infinity, e.boss ? s.height * .56 : Infinity);
    }
    const thrustResponse = 1 - Math.exp(-dt / response);
    e.thrust += (.82 + Math.abs(e.vx) / 180 + Math.max(0, e.vy - e.speed) / 190 - e.thrust) * thrustResponse;
    if (e.ai === 'captor') updateCaptor(s, e, dt, pilot);
    const target = e.noFire || s.bossDefeated ? null : pilot;
    if (target && e.ai === 'dive' && e.type !== 0 && e.diveT > DIVE_LOOP * .55 && (e.diveFired || 0) < 3 && e.y < target.y - 140) {
      // Divers open fire from the top of their loop, then twice more on the way down.
      if (e.diveT > DIVE_LOOP * .55 + (e.diveFired || 0) * .42) {
        const aimed = Math.atan2(target.y - e.y, target.x - e.x), speed = 205 + combatTier(s.level) * 8;
        if (e.type === 2 || e.type === 3) for (const spread of [-.12, .12]) hostileShot(s, e, aimed + spread, speed);
        else hostileShot(s, e, aimed, speed);
        e.diveFired = (e.diveFired || 0) + 1;
      }
    }
    if (target && e.potshot) {
      e.potshot = 0;
      if (e.y < target.y - 160) hostileShot(s, e, Math.atan2(target.y - e.y, target.x - e.x), 190 + combatTier(s.level) * 7);
    }
    const volleys = !e.noFire && !e.cloaked && (!e.ai || e.ai === 'drift' || e.ai === 'station' || (e.ai === 'captor' && e.capState === 0) || (e.ai === 'entry' && !e.slotCount));
    if (volleys) {
      const formation = e.formation, geometry = formation?.entry && formationGeometry.get(formation);
      const ready = !geometry || (formation.age * (formation.motionSpeed || 1) >= geometry.entryTime && e.x >= e.radius && e.x <= s.width - e.radius);
      if (ready) e.fire -= dt * difficultyProfile(s.difficulty).fireRate * (e.tacticFire || 1);
      if (ready && e.fire <= 0 && e.y > 30 && e.y < s.height * .73 && !s.bossDefeated) {
        const before = s.hostileCount;
        enemyFire(s, e);
        // One cue per volley that actually left the hull, never per round.
        if (s.hostileCount > before) s.events.push({ type: 'volley', x: e.x, y: e.y, size: e.radius, boss: e.boss });
      }
    }
    if (e.harmless) continue;
    for (const p of s.players) if (p.alive && distance(p, e) < p.radius + e.radius * .75) {
      hurtPlayer(s, p, (e.boss ? 55 : roleCollisionDamage(e)) * difficultyProfile(s.difficulty).damage, 'kinetic');
      // Light craft are destroyed by the collision; heavy hulls shrug it off.
      if (!e.boss && e.radius < 36 && e.role !== 'midboss') killEnemy(s, e, 'ram');
      else repel(s, p, e);
    }
  }
  updateBeams(s, dt);
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
    if (b.fuse !== undefined && b.team < 0) {
      b.fuse -= dt;
      if (b.fuse <= 0) { b.life = 0; burstBomb(s, b); continue; }
    }
    if (b.team >= 0) {
      const hitIds = b.hitIds || (b.hitIds = []);
      let target = null, result = null;
      for (const e of s.enemies) {
        if (e.dead || e.cloaked || hitIds.includes(e.id) || (e.ai === 'entry' && e.pathD < 0)) continue;
        const candidate = bossHit(s, b, e);
        if (candidate) { target = e; result = candidate; break; }
      }
      if (target && result) {
        if (!hitIds.length && !b.drone) s.stats.hits++;
        hitIds.push(target.id);
        if (result.blocked) {
          b.life = 0;
          s.events.push({ type: 'blocked', x: b.x, y: b.y, size: 8 });
        } else {
          const dealt = damageEnemy(s, target, result.damage, b.drone ? 'pulse' : b.kind); target.hurt = .07;
          if (dealt > 0) s.events.push({ type: result.weak ? 'weak-hit' : 'spark', x: b.x, y: b.y, size: result.weak ? 10 : 5, boss: target.boss });
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
      if (b.life > 0 && environmentHit && b.ground !== false) {
        const radius = Math.max(9, b.splash || 0) * (b.comboBlast || 1);
        const props = environmentHit(b.x, b.y, radius, b.damage * (b.splash ? 1.15 : 1), s.scroll) || [];
        for (const prop of props) applyGroundReward(s, prop, b.comboBlast || 1);
      }
    } else if (!s.bossDefeated) {
      for (const p of s.players) {
        if (!p.alive) continue;
        if (segmentHits(b, p, p.radius * .72 + b.radius)) { hurtPlayer(s, p, b.damage, b.fuse !== undefined ? 'kinetic' : 'energy'); b.life = 0; break; }
        // Wing drones are armored escorts: they soak up stray rounds.
        const drone = p.wing?.find(item => segmentHits(b, item, 10 + b.radius));
        if (drone) { b.life = 0; s.events.push({ type: 'blocked', x: drone.x, y: drone.y - 6, size: 6, drone: true }); break; }
      }
    }
  }
  // Compact the current arrays in place to avoid three allocations every tick.
  // killEnemy can replace s.bullets while clearing a boss's hostile fire, so use
  // the current state array here rather than the earlier collision-loop array.
  let retained = 0;
  for (const b of s.bullets) if (b.life > 0 && b.y > -80 && b.y < s.height + 90 && b.x > -80 && b.x < s.width + 80) s.bullets[retained++] = b;
  s.bullets.length = retained;
  retained = 0;
  for (const e of s.enemies) {
    const leaving = e.ai === 'leave' || e.ai === 'retreat';
    const outside = leaving && (e.x < -e.radius - 180 || e.x > s.width + e.radius + 180 || e.y > s.height + e.radius + 120 || e.y < -e.radius - 150);
    if (!e.dead && !e.gone && !outside && e.y < s.height + 140) { s.enemies[retained++] = e; continue; }
    if (e.dead) continue;
    // Escapees break their squadron's bonus; a departing captor keeps its prize.
    if (e.squad) { const squad = s.squadrons.find(item => item.id === e.squad); if (squad) squad.broken = true; }
    if (e.captive) s.events.push({ type: 'captive-lost', x: e.x, y: e.y });
  }
  s.enemies.length = retained;
  // A lancer destroyed this step takes its beam with it, keeping saves consistent.
  if (s.beams.length) s.beams = s.beams.filter(beam => s.enemies.some(enemy => enemy.id === beam.owner));
  if (s.squadrons.length) {
    const active = new Set();
    for (const e of s.enemies) if (e.squad) active.add(e.squad);
    s.squadrons = s.squadrons.filter(squad => active.has(squad.id));
  }
  retained = 0;
  for (const formation of s.formations) {
    if (!s.enemies.some(enemy => enemy.formation === formation && !enemy.dead)) continue;
    s.formations[retained++] = formation;
  }
  s.formations.length = retained;
  for (const p of s.pickups) {
    // Loose pickups settle into the scroll drift; a dropped core stays out of reach briefly.
    const vx = p.vx ?? 0, vy = p.vy ?? 75;
    p.x += vx * dt; p.y += vy * dt; p.age += dt;
    if (p.vx !== undefined) { p.vx *= Math.exp(-dt * 2.2); p.vy += (75 - p.vy) * Math.min(1, dt * 2.4); }
    // A ship destroyed just past the edge still drops its prize inside the flight lane.
    p.x = clamp(p.x, 30, s.width - 30);
    if (p.lock > 0) { p.lock = Math.max(0, p.lock - dt); continue; }
    for (const player of s.players) if (player.alive) {
      const d = distance(player, p);
      if (d < 145) { p.x += (player.x - p.x) * dt * 5; p.y += (player.y - p.y) * dt * 5; }
      if (d < 28) {
        p.age = 100;
        let value;
        if (p.kind === 'repair') { player.hull = Math.min(stats.hull, player.hull + 32); player.shield = Math.min(stats.shield, player.shield + 25); value = 'Repair'; }
        else if (p.kind === 'rapid') {
          if (!player.rapidFireTime) player.fire /= RAPID_FIRE_MULTIPLIER;
          player.rapidFireTime = BONUS_DURATION; value = 'Rapid fire · 10s';
        }
        else if (p.kind === 'invulnerable') { player.invulnerableTime = BONUS_DURATION; value = 'Invulnerable · 10s'; }
        else if (p.kind === 'power') {
          if ((player.power || 0) < MAX_POWER) { player.power = (player.power || 0) + 1; value = player.power === MAX_POWER ? 'Power max' : `Power ${player.power + 1}`; }
          else { s.score += 1000; value = '+1,000'; }
        }
        else if (p.kind === 'drone') {
          if ((player.drones || 0) < MAX_DRONES) { player.drones = (player.drones || 0) + 1; value = 'Wing drone'; }
          else { s.score += 800; s.credits += 100; value = '+100 CR'; }
        }
        else if (p.kind === 'bomb') {
          if ((player.bombs || 0) < MAX_BOMBS) { player.bombs = (player.bombs || 0) + 1; value = 'Nova charge'; }
          else { s.score += 500; value = '+500'; }
        }
        else { s.credits += p.value; value = `+${p.value} CR`; }
        s.events.push({ type: 'pickup', x: p.x, y: p.y, value, bonus: p.kind, player: player.id });
        break;
      }
    }
  }
  retained = 0;
  for (const p of s.pickups) if (p.age < 14 && p.y < s.height + 50) s.pickups[retained++] = p;
  s.pickups.length = retained;
  // Galaga-style extra ships at score milestones.
  if (s.nextLife && s.nextLife < Number.MAX_SAFE_INTEGER && s.score >= s.nextLife) {
    const awards = Math.floor((Math.min(s.score, Number.MAX_SAFE_INTEGER) - s.nextLife) / EXTRA_LIFE_STEP) + 1;
    s.nextLife = nextLifeAfterScore(s.score, s.nextLife);
    const ships = Math.min(MAX_LIVES - s.lives, awards);
    for (let i = 0; i < ships; i++) { s.lives++; s.events.push({ type: 'extra-life', lives: s.lives }); }
    if (awards > ships) {
      const credits = (awards - ships) * 300;
      s.credits = Math.min(Number.MAX_SAFE_INTEGER, s.credits + credits);
      s.events.push({ type: 'extra-life', lives: s.lives, credits });
    }
  }
  if (!s.players.some(p => p.alive)) {
    if (s.lives > 0) {
      s.respawn = (s.respawn ?? RESPAWN_DELAY) - dt;
      if (s.respawn <= 0) respawn(s, s.players[0]);
    } else { s.status = 'defeat'; s.events.push({ type: 'defeat' }); }
  }
  else if (s.bossDefeated && s.time - s.bossDeathTime > 3.2) {
    if (challengeSector(s) && !s.challenge) startChallenge(s, spawnEnemy);
    else if (!s.challenge || (s.challenge.done && s.time - s.challenge.result > 2.6)) finishSector(s);
  }
}
