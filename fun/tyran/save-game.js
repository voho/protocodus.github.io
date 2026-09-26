import { createCampaign, MAX_UPGRADE, shipStats, normalizeWeapon, FORMATIONS, SECONDARY_ENERGY_COST, PRIMARIES, normalizePrimary,
  MAX_POWER, MAX_DRONES, MAX_BOMBS, MAX_LIVES, START_LIVES, START_BOMBS, FIRST_EXTRA_LIFE, nextLifeAfterScore, RESPAWN_DELAY, RESPAWN_GUARD, PICKUP_KINDS, sectorDuration } from './sim.js';
import { createDirector, WAVE_KINDS, AI_MODES, PATHS } from './waves.js';
import { normalizeDifficulty } from './difficulty.js';

export const SAVE_KEY = 'tyran-campaign';
export const LEGACY_SAVE_KEY = 'tyran-campaign-v1';
const LEGACY_SLOT_KEYS = ['tyran-save-v2:auto', 'tyran-save-v2:manual'];
const VERSION = 2, SCENERY_VERSION = 3, MAX_BYTES = 4_000_000, MAX_SCENERY = 24_000;
const POSITIVE_INFINITY = '@infinity', NEGATIVE_INFINITY = '@-infinity';
// Retired projectiles already in flight keep their original appearance and
// mechanics when resuming an older campaign; only future selections migrate.
const projectileKinds = new Set(['pulse', 'plasma', 'scatter', 'lance', 'seeker', 'arc', 'hostile']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const invalid = () => { throw new Error('Invalid campaign save'); };

function number(value, fallback = 0, min = -100_000_000, max = 100_000_000, timer = false) {
  if (value === undefined) return fallback;
  if (timer && (value === POSITIVE_INFINITY || value === Infinity)) return Infinity;
  if (timer && (value === NEGATIVE_INFINITY || value === -Infinity)) return -Infinity;
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
  return Math.max(min, Math.min(max, value));
}
const integer = (value, fallback = 0, min = 0, max = 100_000_000) => Math.trunc(number(value, fallback, min, max));
function arenaDimension(value, fallback) {
  if (value === undefined) return fallback;
  // Saved dimensions only normalize actor positions on resume; the live
  // viewport determines all rendering allocations. Preserve fractional aspect
  // ratios exactly, and reject pathological denominators instead of skewing them.
  if (typeof value !== 'number' || !Number.isFinite(value) || value < .000001 || value > 100_000_000) invalid();
  return value;
}
// Campaign progression is an absolute sector number, independent of the ten
// reusable environments. Never truncate or wrap it while loading a save.
function campaignLevel(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) invalid();
  return Math.min(value, max);
}
function bool(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') invalid();
  return value;
}
function string(value, fallback = '', max = 96) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) invalid();
  return value;
}
function list(value, max, fallback = []) {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
}
function fields(source, defaults, timers = []) {
  if (!object(source)) invalid();
  const result = {};
  for (const [key, fallback] of Object.entries(defaults)) result[key] = number(source[key], fallback, -100_000_000, 100_000_000, timers.includes(key));
  return result;
}
function color(value, fallback) {
  const result = string(value, fallback, 9);
  // Projectile textures append their own alpha channel to this RGB color.
  if (!/^#[\da-f]{6}$/i.test(result)) invalid();
  return result;
}
function optional(target, source, spec) {
  // Newer flight fields are copied only when present, so older records keep
  // their exact shape and fresh fields never appear on legacy actors.
  for (const [key, [kind, min, max, allowed]] of Object.entries(spec)) {
    const value = source[key];
    if (value === undefined) continue;
    if (kind === 'bool') target[key] = bool(value);
    else if (kind === 'int') target[key] = integer(value, 0, min, max);
    else if (kind === 'enum') { if (!allowed.includes(value)) invalid(); target[key] = value; }
    else target[key] = number(value, 0, min ?? -100_000_000, max ?? 100_000_000);
  }
  return target;
}
const ENEMY_FIELDS = {
  ai: ['enum', 0, 0, AI_MODES], path: ['enum', 0, 0, Object.keys(PATHS)], role: ['enum', 0, 0, ['midboss', 'captor']],
  pathD: ['num'], pathSpeed: ['num', 0, 4000], mirror: ['int', -1, 1], pathOx: ['num'], pathOy: ['num', -4000, 4000],
  wave: ['int', -1, 64], squad: ['int', 0, 100_000], slotRow: ['int', 0, 8], slotCol: ['int', 0, 16], slotCount: ['int', 0, 16],
  diveT: ['num', 0, 1000], diveX0: ['num'], diveY0: ['num'], diveSide: ['int', -1, 1], diveTx: ['num'], diveSpeed: ['num', 0, 4000],
  diveWeave: ['num', 0, 400], diveHome: ['int', 0, 1], diveFired: ['int', 0, 8], returnToHive: ['bool'], leaveDx: ['num', -1, 1], leaveDy: ['num', -1, 1],
  stationX: ['num'], stationY: ['num'], hold: ['num', -1000, 1000], sway: ['num', 0, 2000],
  capState: ['int', 0, 3], capTimer: ['num', -1000, 1000], capBeams: ['int', 0, 16], capX: ['num'], capGrip: ['num', 0, 10], captive: ['int', 0, 1], captiveFire: ['num', -1000, 1000],
  harmless: ['bool'], noFire: ['bool'], challenge: ['bool'], potshot: ['int', 0, 1], volley: ['int', 0, 8], gone: ['bool'], launch: ['num', -1000, 1000],
};
function restoreDirector(raw, level) {
  if (raw === undefined) return createDirector(level);
  if (!object(raw)) invalid();
  const plan = list(raw.plan, 16).map(kind => { if (!WAVE_KINDS.includes(kind)) invalid(); return kind; });
  if (!plan.length) invalid();
  const director = { plan, ...fields(raw, { clock: 0, rest: 2.6, timeout: 0, dive: 3, potshot: 4, pendingAt: 0 }) };
  director.wave = integer(raw.wave, -1, -1, plan.length);
  director.kind = raw.kind === undefined || raw.kind === '' ? '' : WAVE_KINDS.includes(raw.kind) ? raw.kind : invalid();
  director.state = raw.state === 'wave' ? 'wave' : raw.state === 'rest' || raw.state === undefined ? 'rest' : invalid();
  director.pending = integer(raw.pending, 0, 0, 4);
  director.hold = bool(raw.hold); director.done = bool(raw.done); director.abandon = bool(raw.abandon);
  return director;
}

function coordinates(source) {
  if (!object(source) || !Number.isFinite(source.x) || !Number.isFinite(source.y)) invalid();
  return fields(source, { x: 0, y: 0, px: source.x, py: source.y, vx: 0, vy: 0 });
}
function parse(raw) {
  if (typeof raw === 'string') {
    if (raw.length > MAX_BYTES) invalid();
    return JSON.parse(raw);
  }
  if (!object(raw)) invalid();
  return raw;
}

function restoreState(raw) {
  if (!object(raw) || ![1, 2].includes(raw.mode) || !Number.isSafeInteger(raw.level) || raw.level < 0 || !['playing', 'hangar', 'victory'].includes(raw.status)) invalid();
  // Only the former final sector can carry a legacy victory marker.
  if (raw.status === 'victory' && raw.level !== 9) invalid();
  if (!object(raw.upgrades) || !Array.isArray(raw.players) || !Array.isArray(raw.enemies) || !Array.isArray(raw.bullets) || !Array.isArray(raw.formations)) invalid();
  // Existing campaigns predate the selector and retain the original Easy balance.
  const state = createCampaign(raw.level, null, normalizeDifficulty(raw.difficulty));
  for (const id of Object.keys(state.upgrades)) state.upgrades[id] = integer(raw.upgrades[id], 0, 0, MAX_UPGRADE);
  state.status = raw.status === 'victory' ? 'hangar' : raw.status;
  state.startLevel = campaignLevel(raw.startLevel, 0, state.level);
  state.weapon = normalizeWeapon(raw.weapon);
  Object.assign(state, fields(raw, {
    width: 1200, height: 900, time: 0, scroll: 0, duration: sectorDuration(raw.level),
    credits: 0, score: 0, kills: 0, destroyed: 0, totalKills: 0,
    combo: 0, comboTime: 0, comboDamage: 1, comboBlast: 1,
    nextEnemyId: 1, nextFormationId: 1, formationTimer: 10.5,
    bossDeathTime: 0, spawnTimer: 1.5, showcase: 0,
  }, ['spawnTimer', 'formationTimer', 'duration', 'comboTime', 'bossDeathTime']));
  state.width = arenaDimension(raw.width, 1200); state.height = arenaDimension(raw.height, 900);
  for (const key of ['kills', 'destroyed', 'combo', 'nextEnemyId', 'nextFormationId', 'showcase']) state[key] = integer(state[key], 0);
  for (const key of ['credits', 'score', 'totalKills']) state[key] = integer(raw[key], 0, 0, Number.MAX_SAFE_INTEGER);
  for (const key of ['time', 'scroll', 'duration', 'comboTime']) state[key] = Math.max(0, state[key]);
  state.comboDamage = number(raw.comboDamage, 1, 1, 1.27); state.comboBlast = number(raw.comboBlast, 1, 1, 1.38);
  state.comboLabel = string(raw.comboLabel, '', 24);
  state.bossSpawned = bool(raw.bossSpawned); state.bossDefeated = bool(raw.bossDefeated);
  state.owned = PRIMARIES.map(weapon => weapon.id).filter(id => id === 'pulse' || list(raw.owned, 8).includes(id));
  state.primary = state.owned.includes(normalizePrimary(raw.primary)) ? normalizePrimary(raw.primary) : 'pulse';
  state.lives = integer(raw.lives, START_LIVES, 0, MAX_LIVES);
  state.livesBought = integer(raw.livesBought, 0, 0, 20);
  state.nextLife = integer(raw.nextLife, FIRST_EXTRA_LIFE, FIRST_EXTRA_LIFE, Number.MAX_SAFE_INTEGER);
  // Older saves never tracked milestones: start from the next one ahead of the score.
  if (raw.nextLife === undefined) state.nextLife = nextLifeAfterScore(state.score);
  state.respawn = number(raw.respawn, 0, -1, RESPAWN_DELAY);
  const rawStats = raw.stats === undefined ? {} : object(raw.stats) ? raw.stats : invalid();
  state.stats = Object.fromEntries(['shots', 'hits', 'squads', 'dives', 'rescues'].map(key => [key, integer(rawStats[key], 0)]));
  state.director = restoreDirector(raw.director, state.level);
  state.hive = { age: raw.hive === undefined ? 0 : object(raw.hive) ? number(raw.hive.age, 0, 0, 100_000) : invalid() };
  state.nextSquadId = integer(raw.nextSquadId, 1, 1);
  const squadIds = new Set();
  state.squadrons = list(raw.squadrons, 96).map(squad => {
    if (!object(squad)) invalid();
    const result = { id: integer(squad.id, 0, 1), size: integer(squad.size, 1, 1, 16), killed: integer(squad.killed, 0, 0, 16), broken: bool(squad.broken), wave: integer(squad.wave, 0, -1, 64) };
    if (squad.challenge !== undefined) result.challenge = bool(squad.challenge);
    if (squadIds.has(result.id)) invalid();
    squadIds.add(result.id);
    return result;
  });
  state.nextSquadId = Math.max(state.nextSquadId, ...state.squadrons.map(squad => squad.id + 1));
  if (raw.challenge === undefined || raw.challenge === null) state.challenge = null;
  else {
    if (!object(raw.challenge)) invalid();
    state.challenge = { clock: number(raw.challenge.clock, 0, 0, 1000), total: integer(raw.challenge.total, 40, 1, 64), hits: integer(raw.challenge.hits, 0, 0, 64),
      done: bool(raw.challenge.done), result: number(raw.challenge.result, 0, 0, 100_000) };
    if (raw.challenge.credits !== undefined) state.challenge.credits = integer(raw.challenge.credits, 0, 0, 100_000);
  }
  state.beams = list(raw.beams, 16).map(beam => {
    if (!object(beam)) invalid();
    const result = { owner: integer(beam.owner, 0, 1), angle: number(beam.angle, 0, -10, 10), t: number(beam.t, 0, 0, 10), warn: number(beam.warn, 1, 0, 5), dx: number(beam.dx, 0, -500, 500), dy: number(beam.dy, 0, -500, 500) };
    if (beam.x !== undefined) { result.x = number(beam.x); result.y = number(beam.y); }
    if (beam.fired !== undefined) result.fired = bool(beam.fired);
    return result;
  });
  const stats = shipStats(state.upgrades);
  if (raw.players.length !== raw.mode) invalid();
  state.players = raw.players.map((player, index) => {
    const result = { ...coordinates(player), ...fields(player, { mass: stats.mass, thrust: .9, radius: 17, fire: 0, hurt: 0, lastHit: -10 }, ['fire', 'hurt', 'lastHit']) };
    result.id = index;
    result.weapon = normalizeWeapon(player.weapon ?? raw.weapon);
    result.maxHull = number(player.maxHull, stats.hull, 1, stats.hull);
    result.maxShield = number(player.maxShield, stats.shield, 1, stats.shield);
    result.hull = number(player.hull, result.maxHull, 0, result.maxHull);
    result.shield = number(player.shield, result.maxShield, 0, result.maxShield);
    result.alive = bool(player.alive, result.hull > 0) && result.hull > 0;
    result.rapidFireTime = number(player.rapidFireTime, 0, 0, 10);
    result.invulnerableTime = number(player.invulnerableTime, 0, 0, 10);
    result.fireEnergy = number(player.fireEnergy, stats.energy, 0, stats.energy);
    result.fireEnergyDelay = number(player.fireEnergyDelay, 0, 0, 1);
    result.fireEnergyLocked = bool(player.fireEnergyLocked, result.fireEnergy < SECONDARY_ENERGY_COST);
    if (!result.alive) result.rapidFireTime = result.invulnerableTime = 0;
    result.mass = number(player.mass, stats.mass, .1, 10);
    result.radius = number(player.radius, 17, 1, 64);
    result.blastVx = number(player.blastVx, 0, -110, 110); result.blastVy = number(player.blastVy, 0, -110, 110);
    result.power = integer(player.power, 0, 0, MAX_POWER);
    result.drones = integer(player.drones, 0, 0, MAX_DRONES);
    result.bombs = integer(player.bombs, START_BOMBS, 0, MAX_BOMBS);
    result.guard = number(player.guard, 0, 0, RESPAWN_GUARD);
    result.bombHeld = bool(player.bombHeld);
    result.wing = list(player.wing, MAX_DRONES).map(drone => coordinates(drone)).map(({ x, y, px, py }) => ({ x, y, px, py }));
    if (result.wing.length > result.drones) invalid();
    return result;
  });
  if (state.status === 'playing' && !state.players.some(player => player.alive) && !(state.lives > 0 && state.mode === 1)) invalid();
  // Ground defenses were retired; old charging guns must never resume firing.
  state.turrets = [];
  const formationsById = new Map();
  state.formations = list(raw.formations, 64).map(formation => {
    if (!object(formation) || !FORMATIONS.includes(formation.kind)) invalid();
    const result = fields(formation, { age: 0, baseX: 600, x: 600, y: -150 });
    result.id = integer(formation.id, 0, 1);
    if (formationsById.has(result.id)) invalid();
    result.kind = formation.kind; result.label = string(formation.label, formation.kind, 24);
    result.offsets = list(formation.offsets, 16).map(offset => {
      if (!object(offset)) invalid();
      return { x: number(offset.x), y: number(offset.y) };
    });
    if (!result.offsets.length) invalid();
    result.members = integer(formation.members, result.offsets.length, 0, 16);
    formationsById.set(result.id, result);
    return result;
  });
  const enemyIds = new Set();
  state.enemies = list(raw.enemies, 128).map(enemy => {
    const result = { ...coordinates(enemy), ...fields(enemy, { originX: enemy.x, mass: 1, thrust: .85, speed: 70, age: 0, fire: 1, phase: 0, hurt: 0, seed: 0, warning: 0 }, ['fire', 'hurt', 'warning']) };
    result.id = integer(enemy.id, 0, 1);
    if (enemyIds.has(result.id)) invalid();
    enemyIds.add(result.id);
    result.type = integer(enemy.type, 0, 0, 9); result.boss = result.type === 9;
    result.maxHp = number(enemy.maxHp, 100, 1, 10_000_000); result.hp = number(enemy.hp, result.maxHp, -10_000_000, result.maxHp);
    result.radius = number(enemy.radius, 20, 1, 256); result.mass = number(enemy.mass, 1, .1, 100);
    result.blastVx = number(enemy.blastVx, 0, -110, 110); result.blastVy = number(enemy.blastVy, 0, -110, 110);
    result.dead = bool(enemy.dead, result.hp <= 0);
    const formationId = enemy.formationId;
    result.formation = formationId == null ? null : formationsById.get(formationId);
    if (formationId != null && !result.formation) invalid();
    result.formationOffset = null;
    if (result.formation) {
      result.formationIndex = integer(enemy.formationIndex, 0, 0, result.formation.offsets.length - 1);
      result.formationOffset = result.formation.offsets[result.formationIndex];
    }
    if (result.boss) {
      result.vulnerable = bool(enemy.vulnerable); result.windowClock = number(enemy.windowClock, 1.2, -1000, 1000, true);
      result.windowCount = integer(enemy.windowCount);
      result.weakPoints = list(enemy.weakPoints, 4).map((point, index) => {
        if (!object(point)) invalid();
        const maxHp = number(point.maxHp, result.maxHp * .13, 1, result.maxHp);
        return { index, angle: number(point.angle), orbit: number(point.orbit, .62, 0, 2), radius: number(point.radius, 12, 1, 100), hp: number(point.hp, maxHp, -10_000_000, maxHp), maxHp, alive: bool(point.alive, true) };
      });
      if (result.weakPoints.length !== 4) invalid();
    }
    optional(result, enemy, ENEMY_FIELDS);
    return result;
  });
  for (const beam of state.beams) if (!enemyIds.has(beam.owner)) invalid();
  state.nextEnemyId = Math.max(state.nextEnemyId, 1, ...state.enemies.map(enemy => enemy.id + 1));
  state.nextFormationId = Math.max(state.nextFormationId, 1, ...state.formations.map(formation => formation.id + 1));
  // This color/variant pair belonged only to removed ground turrets.
  state.bullets = list(raw.bullets, 1024).filter(bullet => !(bullet?.team === -1 && bullet.color === '#ffc76c' && bullet.variant === 3)).map(bullet => {
    const result = { ...coordinates(bullet), ...fields(bullet, { age: 0, damage: 0, radius: 4, life: 1 }, ['life']) };
    result.damage = number(bullet.damage, 0, 0, 1_000_000); result.radius = number(bullet.radius, 4, .1, 100);
    result.team = integer(bullet.team, 0, -1, raw.mode - 1);
    result.color = color(bullet.color, result.team < 0 ? '#ff718f' : '#9cfff0');
    if (bullet.kind !== undefined) {
      if (!projectileKinds.has(bullet.kind)) invalid();
      result.kind = bullet.kind;
    }
    if (bullet.weaponColor !== undefined) result.weaponColor = color(bullet.weaponColor, '#9cfff0');
    // A loaded blast must stay within a bounded area of the scenery grid.
    for (const [key, max] of Object.entries({ baseDamage: 1_000_000, pierce: 8, homing: 20, splash: 160, splashFactor: 2, chain: 8, chainRange: 400, chainFactor: 2, comboBlast: 1.38, variant: 5, sourceRadius: 256 })) {
      if (bullet[key] !== undefined) result[key] = number(bullet[key], 0, 0, max);
    }
    if (bullet.hitIds !== undefined) result.hitIds = list(bullet.hitIds, 128).map(id => integer(id, 0, 1));
    if (bullet.drone !== undefined) result.drone = bool(bullet.drone);
    if (bullet.ground !== undefined) result.ground = bool(bullet.ground);
    // Collision bounds are derived from the last movement segment.
    result.left = Math.min(result.x, result.px); result.right = Math.max(result.x, result.px);
    result.top = Math.min(result.y, result.py); result.bottom = Math.max(result.y, result.py);
    return result;
  });
  state.pickups = list(raw.pickups, 256).map(pickup => {
    if (!object(pickup) || !PICKUP_KINDS.includes(pickup.kind)) invalid();
    const result = { x: number(pickup.x), y: number(pickup.y), age: number(pickup.age, 0, 0), kind: pickup.kind, value: integer(pickup.value, 40, 0, 100_000) };
    return optional(result, pickup, { vx: ['num', -2000, 2000], vy: ['num', -2000, 2000], lock: ['num', 0, 5] });
  });
  if (raw.mode === 2) {
    // Continue the first surviving ship, preserving its exact resources and
    // position. Old co-op opponents retain their damage fraction at solo HP.
    const pilot = state.players.find(player => player.alive) || state.players[0];
    pilot.id = 0; state.players = [pilot];
    for (const enemy of state.enemies) {
      enemy.hp /= 1.65; enemy.maxHp /= 1.65;
      for (const point of enemy.weakPoints || []) { point.hp /= 1.65; point.maxHp /= 1.65; }
    }
    for (const bullet of state.bullets) if (bullet.team >= 0) bullet.team = 0;
  }
  state.weapon = state.players[0].weapon;
  state.hostileCount = state.bullets.filter(bullet => bullet.team < 0 && bullet.life > 0).length;
  // Transient sound, particles, rewards, and transition events must not replay.
  state.events = [];
  return state;
}

function scenery(raw) {
  // The renderer uses this marker to preserve remaining-health percentages
  // across the linear, area-based, and reinforced-building health models.
  const sceneryVersion = raw.sceneryVersion ?? 1;
  if (![1, 2, SCENERY_VERSION].includes(sceneryVersion)) invalid();
  const damage = new Map(), destroyed = new Set();
  for (const entry of list(raw.damage, MAX_SCENERY)) {
    if (!Array.isArray(entry) || entry.length !== 2) invalid();
    const id = string(entry[0], '', 96);
    if (!id) invalid();
    damage.set(id, number(entry[1], 0, -10_000_000, 10_000_000));
  }
  for (const value of list(raw.destroyed, MAX_SCENERY)) {
    const id = string(value, '', 96);
    if (!id) invalid();
    destroyed.add(id);
  }
  return { damage, destroyed, sceneryVersion };
}

// The simulation status determines the restored screen; a flying save always
// opens paused so the pilot can orient themselves before combat resumes.
export function serializeRun(state, { seed = 'tyran-v2', damage = new Map(), destroyed = new Set(), sceneryVersion = SCENERY_VERSION, unlocked = state?.level || 0 } = {}) {
  if (!state || !['playing', 'hangar', 'victory'].includes(state.status)) invalid();
  const rawState = { ...state, events: [], enemies: state.enemies.map(enemy => {
    const { formation, formationOffset, ...rest } = enemy;
    return { ...rest, formationId: formation?.id ?? null };
  }) };
  // Validate and copy before encoding; never retain or modify live game objects.
  const restored = restoreState(rawState);
  const record = {
    version: VERSION, savedAt: Date.now(), scene: restored.status === 'hangar' ? 'hangar' : 'pause',
    seed: string(seed, 'tyran-v2'), unlocked: Math.max(campaignLevel(unlocked, state.level), state.status === 'victory' ? state.level + 1 : 0),
    state: { ...restored, enemies: restored.enemies.map(enemy => {
      const { formation, formationOffset, ...rest } = enemy;
      return { ...rest, formationId: formation?.id ?? null };
    }) },
    damage: [...damage], destroyed: [...destroyed], sceneryVersion,
  };
  scenery(record);
  const encoded = JSON.stringify(record, (_, value) => value === Infinity ? POSITIVE_INFINITY : value === -Infinity ? NEGATIVE_INFINITY : value);
  if (encoded.length > MAX_BYTES) invalid();
  return encoded;
}

export function restoreRun(raw) {
  try {
    const record = parse(raw);
    if (record.version !== VERSION || !['pause', 'hangar', 'end'].includes(record.scene)) return null;
    const state = restoreState(record.state), legacyVictory = record.state.status === 'victory';
    if (record.scene !== (legacyVictory ? 'end' : state.status === 'hangar' ? 'hangar' : 'pause')) return null;
    const unlocked = campaignLevel(record.unlocked, state.level);
    return { state, scene: state.status === 'hangar' ? 'hangar' : 'pause', seed: string(record.seed, 'tyran-v2'), ...scenery(record),
      unlocked: legacyVictory ? Math.max(unlocked, state.level + 1) : unlocked,
      savedAt: number(record.savedAt, 0, 0, 10_000_000_000_000), migrated: record.state.mode === 2 || legacyVictory };
  } catch { return null; }
}

function migrateLegacy(raw) {
  try {
    const record = parse(raw), checkpoint = record.checkpoint;
    if (record.version !== 1 || !object(checkpoint) || !Number.isInteger(checkpoint.level) || checkpoint.level < 1 || checkpoint.level > 9) return null;
    // Version 1 stored the next sector number and skipped its preceding shop.
    const state = createCampaign(checkpoint.level - 1, checkpoint);
    state.status = 'hangar'; state.bossSpawned = true; state.bossDefeated = true;
    const run = restoreRun(serializeRun(state, { unlocked: integer(record.unlocked, checkpoint.level, 0, 9) }));
    if (run) { run.savedAt = 0; run.migrated = true; }
    return run;
  } catch { return null; }
}

function storageOrThrow(storage) {
  const result = storage === undefined ? globalThis.localStorage : storage;
  if (!result || typeof result.getItem !== 'function' || typeof result.setItem !== 'function') throw new Error('Storage unavailable');
  return result;
}

export function readCampaign(storage) {
  try {
    const target = storageOrThrow(storage), raw = target.getItem(SAVE_KEY);
    if (raw !== null) {
      // Once promoted, historical saves must never replace this campaign.
      const run = restoreRun(raw);
      return { ok: !!run, run, error: run ? null : 'corrupt' };
    }
    let newest = null, hadLegacySave = false;
    for (const key of LEGACY_SLOT_KEYS) {
      const legacy = target.getItem(key);
      if (legacy === null) continue;
      hadLegacySave = true;
      const run = restoreRun(legacy);
      // Automatic saves win ties because they reflect campaign transitions.
      if (run && (!newest || run.savedAt > newest.savedAt)) newest = run;
    }
    if (newest) {
      newest.migrated = true;
      return { ok: true, run: newest, error: null };
    }
    const legacy = target.getItem(LEGACY_SAVE_KEY);
    if (legacy !== null) {
      const run = migrateLegacy(legacy);
      // A completed legacy campaign has no resumable checkpoint.
      try { const value = parse(legacy); if (value.version === 1 && value.checkpoint === null) return { ok: true, run: null, error: null }; } catch { /* reported below */ }
      return { ok: !!run, run, error: run ? null : 'corrupt' };
    }
    return { ok: !hadLegacySave, run: null, error: hadLegacySave ? 'corrupt' : null };
  } catch { return { ok: false, run: null, error: 'unavailable' }; }
}

export function writeCampaign(state, context = {}, storage) {
  let raw;
  try { raw = serializeRun(state, context); } catch { return { ok: false, run: null, error: 'invalid-run' }; }
  try {
    storageOrThrow(storage).setItem(SAVE_KEY, raw);
    return { ok: true, run: restoreRun(raw), error: null };
  } catch { return { ok: false, run: null, error: 'unavailable' }; }
}

export function clearCampaign(storage) {
  try {
    const target = storageOrThrow(storage);
    // Remove migration sources first so clearing cannot revive older progress.
    for (const key of [...LEGACY_SLOT_KEYS, LEGACY_SAVE_KEY, SAVE_KEY]) target.removeItem(key);
    return { ok: true, error: null };
  }
  catch { return { ok: false, error: 'unavailable' }; }
}
