// Woodland lives on the simulation calendar. Initial forests have deterministic,
// mixed ages without rewriting published world recipes or adding every tree to
// a save. Only new growth and cleared land need explicit dates on their tiles.
export const TREE_LIFETIME_DAYS = 3650;
export const TREE_GROWTH_DAYS = 730;
export const TREE_OLD_AGE_DAYS = 2920;
export const TREE_FALLEN_DAYS = 180;
export const TREE_REGROWTH_DELAY = 180;
const FALL_AGE = TREE_LIFETIME_DAYS - TREE_FALLEN_DAYS;
const seedCache = new WeakMap();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function seedFor(game) {
  let saved = seedCache.get(game);
  if (!saved || saved.seed !== game.seed) {
    let value = 2166136261;
    for (const char of String(game.seed ?? 0)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    saved = { seed: game.seed, value }; seedCache.set(game, saved);
  }
  return saved.value;
}
function initialAge(game, x, y, tile) {
  let value = seedFor(game) ^ Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca6b) ^ Math.imul((tile.variant || 0) + 1, 0xc2b2ae35);
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  const fraction = ((value ^ value >>> 16) >>> 0) / 4294967296;
  // Existing deadwood also finishes decomposing; it never springs back into a
  // mature tree. Healthy original trees range from saplings to old woodland.
  return tile.detail === 'deadwood' ? FALL_AGE + Math.floor(fraction * TREE_FALLEN_DAYS) : Math.floor(fraction * FALL_AGE);
}

export function treeLifecycle(game, x, y, tile = game.tiles?.[y * game.width + x], day = game.day || 0) {
  day = Math.max(0, Math.floor(day));
  const clearedDay = Number.isInteger(tile?.treeClearedDay) ? tile.treeClearedDay : null;
  if (!tile || tile.terrain !== 'forest') return { stage: 'empty', scale: 0, ageDays: 0, bornDay: null, fallDay: null, clearDay: clearedDay, regrowDay: clearedDay === null ? 0 : clearedDay + TREE_REGROWTH_DELAY };
  const epoch = Number.isInteger(game.treeLifecycleEpoch) ? game.treeLifecycleEpoch : 0;
  const bornDay = Number.isInteger(tile.treeBornDay) ? tile.treeBornDay : epoch - initialAge(game, x, y, tile);
  const ageDays = Math.max(0, day - bornDay), fallDay = bornDay + FALL_AGE, clearDay = bornDay + TREE_LIFETIME_DAYS;
  const stage = ageDays >= TREE_LIFETIME_DAYS ? 'empty' : ageDays >= FALL_AGE ? 'fallen' : ageDays >= TREE_OLD_AGE_DAYS ? 'old' : ageDays < TREE_GROWTH_DAYS ? 'young' : 'mature';
  // Eight prepared sizes bound sprite caches while roots stay in place.
  const scale = stage === 'empty' ? 0 : stage === 'young' ? .38 + .62 * Math.floor(clamp(ageDays / TREE_GROWTH_DAYS, 0, 1) * 8) / 8 : 1;
  return { stage, scale, ageDays, bornDay, fallDay, clearDay, regrowDay: clearDay + TREE_REGROWTH_DELAY };
}

export function canRegrowTree(tile, day) {
  return !Number.isInteger(tile?.treeClearedDay) || day >= tile.treeClearedDay + TREE_REGROWTH_DELAY;
}

export function validTreeLifecycleTile(tile, day) {
  if (!tile || !Number.isFinite(day)) return false;
  if (tile.treeBornDay !== undefined && (!Number.isInteger(tile.treeBornDay) || tile.treeBornDay < -TREE_LIFETIME_DAYS || tile.treeBornDay > day)) return false;
  if (tile.treeClearedDay !== undefined && (!Number.isInteger(tile.treeClearedDay) || tile.treeClearedDay < 0 || tile.treeClearedDay > day)) return false;
  return true;
}
