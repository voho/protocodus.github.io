import { createCampaign, MAX_UPGRADE, shipStats, WEAPONS, FORMATIONS } from './sim.js';

export const SAVE_KEYS = Object.freeze({ auto: 'tyran-save-v2:auto', manual: 'tyran-save-v2:manual' });
export const LEGACY_SAVE_KEY = 'tyran-campaign-v1';
const VERSION = 2, MAX_BYTES = 4_000_000, MAX_SCENERY = 24_000;
const POSITIVE_INFINITY = '@infinity', NEGATIVE_INFINITY = '@-infinity';
const weaponIds = new Set(WEAPONS.map(weapon => weapon.id));
const projectileKinds = new Set([...weaponIds, 'hostile']);
const validSlot = slot => Object.hasOwn(SAVE_KEYS, slot);
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
  if (!object(raw) || ![1, 2].includes(raw.mode) || !Number.isInteger(raw.level) || raw.level < 0 || raw.level > 9 || !['playing', 'hangar', 'victory'].includes(raw.status)) invalid();
  if ((raw.status === 'hangar' && raw.level === 9) || (raw.status === 'victory' && raw.level !== 9)) invalid();
  if (!object(raw.upgrades) || !Array.isArray(raw.players) || !Array.isArray(raw.enemies) || !Array.isArray(raw.bullets) || !Array.isArray(raw.formations)) invalid();
  const state = createCampaign(raw.mode, raw.level);
  for (const id of Object.keys(state.upgrades)) state.upgrades[id] = integer(raw.upgrades[id], 0, 0, MAX_UPGRADE);
  state.status = raw.status;
  state.startLevel = integer(raw.startLevel, 0, 0, state.level);
  state.weapon = weaponIds.has(raw.weapon) ? raw.weapon : 'pulse';
  Object.assign(state, fields(raw, {
    width: 1200, height: 900, time: 0, scroll: 0, duration: 90 + raw.level * 3,
    credits: 0, score: 0, kills: 0, destroyed: 0, totalKills: 0,
    combo: 0, comboTime: 0, comboDamage: 1, comboBlast: 1,
    nextEnemyId: 1, nextFormationId: 1, formationTimer: 10.5,
    bossDeathTime: 0, spawnTimer: 1.5, showcase: 0,
  }, ['spawnTimer', 'formationTimer', 'duration', 'comboTime', 'bossDeathTime']));
  state.width = number(raw.width, 1200, 320, 6000); state.height = number(raw.height, 900, 320, 6000);
  for (const key of ['credits', 'score', 'kills', 'destroyed', 'totalKills', 'combo', 'nextEnemyId', 'nextFormationId', 'showcase']) state[key] = integer(state[key], 0);
  for (const key of ['time', 'scroll', 'duration', 'comboTime']) state[key] = Math.max(0, state[key]);
  state.comboDamage = number(raw.comboDamage, 1, 1, 1.27); state.comboBlast = number(raw.comboBlast, 1, 1, 1.38);
  state.comboLabel = string(raw.comboLabel, '', 24);
  state.bossSpawned = bool(raw.bossSpawned); state.bossDefeated = bool(raw.bossDefeated);
  const stats = shipStats(state.upgrades);
  if (raw.players.length !== state.mode) invalid();
  state.players = raw.players.map((player, index) => {
    const result = { ...coordinates(player), ...fields(player, { mass: stats.mass, thrust: .9, radius: 17, fire: 0, hurt: 0, lastHit: -10, bank: 0 }, ['fire', 'hurt', 'lastHit']) };
    result.id = index;
    result.maxHull = number(player.maxHull, stats.hull, 1, stats.hull);
    result.maxShield = number(player.maxShield, stats.shield, 1, stats.shield);
    result.hull = number(player.hull, result.maxHull, 0, result.maxHull);
    result.shield = number(player.shield, result.maxShield, 0, result.maxShield);
    result.alive = bool(player.alive, result.hull > 0) && result.hull > 0;
    result.mass = number(player.mass, stats.mass, .1, 10);
    result.radius = number(player.radius, 17, 1, 64);
    return result;
  });
  if (state.status === 'playing' && !state.players.some(player => player.alive)) invalid();
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
    const result = { ...coordinates(enemy), ...fields(enemy, { originX: enemy.x, mass: 1, bank: 0, thrust: .85, speed: 70, age: 0, fire: 1, phase: 0, hurt: 0, seed: 0, warning: 0 }, ['fire', 'hurt', 'warning']) };
    result.id = integer(enemy.id, 0, 1);
    if (enemyIds.has(result.id)) invalid();
    enemyIds.add(result.id);
    result.type = integer(enemy.type, 0, 0, 9); result.boss = result.type === 9;
    result.maxHp = number(enemy.maxHp, 100, 1, 10_000_000); result.hp = number(enemy.hp, result.maxHp, -10_000_000, result.maxHp);
    result.radius = number(enemy.radius, 20, 1, 256); result.mass = number(enemy.mass, 1, .1, 100);
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
    return result;
  });
  state.nextEnemyId = Math.max(state.nextEnemyId, 1, ...state.enemies.map(enemy => enemy.id + 1));
  state.nextFormationId = Math.max(state.nextFormationId, 1, ...state.formations.map(formation => formation.id + 1));
  state.bullets = list(raw.bullets, 1024).map(bullet => {
    const result = { ...coordinates(bullet), ...fields(bullet, { age: 0, damage: 0, radius: 4, life: 1 }, ['life']) };
    result.damage = number(bullet.damage, 0, 0, 1_000_000); result.radius = number(bullet.radius, 4, .1, 100);
    result.team = integer(bullet.team, 0, -1, state.mode - 1);
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
    // Collision bounds are derived from the last movement segment.
    result.left = Math.min(result.x, result.px); result.right = Math.max(result.x, result.px);
    result.top = Math.min(result.y, result.py); result.bottom = Math.max(result.y, result.py);
    return result;
  });
  state.pickups = list(raw.pickups, 256).map(pickup => {
    if (!object(pickup) || !['repair', 'credit'].includes(pickup.kind)) invalid();
    return { x: number(pickup.x), y: number(pickup.y), age: number(pickup.age, 0, 0), kind: pickup.kind, value: integer(pickup.value, 40, 0, 100_000) };
  });
  state.hostileCount = state.bullets.filter(bullet => bullet.team < 0 && bullet.life > 0).length;
  // Transient sound, particles, rewards, and transition events must not replay.
  state.events = [];
  return state;
}

function scenery(raw) {
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
  return { damage, destroyed };
}

// The simulation status determines the restored screen; a flying save always
// opens paused so the pilot can orient themselves before combat resumes.
export function serializeRun(state, { seed = 'tyran-v2', damage = new Map(), destroyed = new Set(), unlocked = state?.level || 0 } = {}) {
  if (!state || !['playing', 'hangar', 'victory'].includes(state.status)) invalid();
  const rawState = { ...state, events: [], enemies: state.enemies.map(enemy => {
    const { formation, formationOffset, ...rest } = enemy;
    return { ...rest, formationId: formation?.id ?? null };
  }) };
  // Validate and copy before encoding; never retain or modify live game objects.
  const restored = restoreState(rawState);
  const record = {
    version: VERSION, savedAt: Date.now(), scene: state.status === 'victory' ? 'end' : state.status === 'hangar' ? 'hangar' : 'pause',
    seed: string(seed, 'tyran-v2'), unlocked: integer(unlocked, state.level, 0, 9),
    state: { ...restored, enemies: restored.enemies.map(enemy => {
      const { formation, formationOffset, ...rest } = enemy;
      return { ...rest, formationId: formation?.id ?? null };
    }) },
    damage: [...damage], destroyed: [...destroyed],
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
    const state = restoreState(record.state);
    if (record.scene !== (state.status === 'victory' ? 'end' : state.status === 'hangar' ? 'hangar' : 'pause')) return null;
    return { state, scene: record.scene, seed: string(record.seed, 'tyran-v2'), ...scenery(record), unlocked: integer(record.unlocked, state.level, 0, 9), savedAt: number(record.savedAt, 0, 0, 10_000_000_000_000), migrated: false };
  } catch { return null; }
}

function migrateLegacy(raw) {
  try {
    const record = parse(raw), checkpoint = record.checkpoint;
    if (record.version !== 1 || !object(checkpoint) || !Number.isInteger(checkpoint.level) || checkpoint.level < 1 || checkpoint.level > 9) return null;
    // Version 1 stored the next sector number and skipped its preceding shop.
    const state = createCampaign(checkpoint.mode, checkpoint.level - 1, checkpoint);
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

export function readSave(slot = 'auto', storage) {
  if (!validSlot(slot)) return { ok: false, run: null, error: 'invalid-slot' };
  try {
    const target = storageOrThrow(storage), raw = target.getItem(SAVE_KEYS[slot]);
    if (raw !== null) {
      const run = restoreRun(raw);
      return { ok: !!run, run, error: run ? null : 'corrupt' };
    }
    if (slot === 'auto') {
      const legacy = target.getItem(LEGACY_SAVE_KEY);
      if (legacy !== null) {
        const run = migrateLegacy(legacy);
        // A completed legacy campaign has no resumable checkpoint.
        try { const value = parse(legacy); if (value.version === 1 && value.checkpoint === null) return { ok: true, run: null, error: null }; } catch { /* reported below */ }
        return { ok: !!run, run, error: run ? null : 'corrupt' };
      }
    }
    return { ok: true, run: null, error: null };
  } catch { return { ok: false, run: null, error: 'unavailable' }; }
}

export function writeSave(slot, state, context = {}, storage) {
  if (!validSlot(slot)) return { ok: false, run: null, error: 'invalid-slot' };
  let raw;
  try { raw = serializeRun(state, context); } catch { return { ok: false, run: null, error: 'invalid-run' }; }
  try {
    storageOrThrow(storage).setItem(SAVE_KEYS[slot], raw);
    return { ok: true, run: restoreRun(raw), error: null };
  } catch { return { ok: false, run: null, error: 'unavailable' }; }
}

export function clearSave(slot = 'auto', storage) {
  if (!validSlot(slot)) return { ok: false, error: 'invalid-slot' };
  try { storageOrThrow(storage).removeItem(SAVE_KEYS[slot]); return { ok: true, error: null }; }
  catch { return { ok: false, error: 'unavailable' }; }
}
