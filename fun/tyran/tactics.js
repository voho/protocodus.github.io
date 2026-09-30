import { normalizeLevel, environmentIndex, campaignCycle, combatTier } from './campaign.js';

// Every tactical formation the simulation can fly. The five original shapes
// keep their layouts; the six newer ones add spinning, snaking, breathing,
// charging and counter-rotating groups.
export const FORMATION_KINDS = Object.freeze(['vee', 'wall', 'orbit', 'escort', 'pincer', 'diamond', 'column', 'crescent', 'ring', 'spear', 'helix']);

// Authored identities, with resolved choices made once when a wave launches.
// Endless circuits remix tactics, not actor counts or ever-faster projectiles.
export const SECTOR_TACTICS = Object.freeze([
  { id: 'jungle', shape: 'chevron', armor: .96, speed: 1, fire: .96,
    plan: ['hive', 'sweep', 'gunship', 'formation', 'midboss', 'sweep', 'captor', 'hive'],
    hive: ['dropLoop', 'sideHook', 'topSpiral'], sweep: ['arc', 'cross', 'uTurn'], types: [0, 1, 7, 2],
    formations: ['vee', 'escort'], entries: ['top', 'left'], heavies: [4, 5, 4] },
  { id: 'snow', shape: 'stagger', armor: 1.12, speed: .93, fire: .94,
    plan: ['formation', 'hive', 'gunship', 'sweep', 'captor', 'hive', 'midboss', 'formation'],
    hive: ['sideSweep', 'dropLoop', 'sideHook'], sweep: ['arc', 'uTurn', 'cross'], types: [2, 3, 7, 1],
    formations: ['wall', 'column'], entries: ['top', 'right'], heavies: [4, 4, 5] },
  { id: 'desert', shape: 'chevron', armor: 1.04, speed: .98, fire: 1.04,
    plan: ['sweep', 'gunship', 'formation', 'hive', 'midboss', 'gunship', 'captor', 'sweep'],
    hive: ['dropLoop', 'topSpiral', 'sideSweep'], sweep: ['plunge', 'zigzag', 'arc'], types: [1, 7, 3, 2],
    formations: ['vee', 'diamond'], entries: ['right', 'top'], heavies: [5, 4, 5] },
  { id: 'paradise', shape: 'split', armor: .89, speed: 1.09, fire: .97,
    plan: ['formation', 'sweep', 'hive', 'captor', 'formation', 'midboss', 'gunship', 'hive', 'sweep'],
    hive: ['sideHook', 'sideSweep', 'topSpiral'], sweep: ['cross', 'arc', 'snake'], types: [0, 1, 2, 7],
    formations: ['pincer', 'crescent'], entries: ['left', 'right'], heavies: [4, 5, 4] },
  { id: 'asteroid', shape: 'diamond', armor: 1.16, speed: .90, fire: .95,
    plan: ['gunship', 'formation', 'hive', 'midboss', 'sweep', 'captor', 'gunship', 'hive', 'formation'],
    hive: ['sideSweep', 'topSpiral', 'dropLoop'], sweep: ['cross', 'uTurn', 'arc'], types: [3, 2, 7, 3],
    formations: ['escort', 'ring'], entries: ['left', 'top'], heavies: [4, 4, 5] },
  { id: 'mars', shape: 'ranks', armor: 1.02, speed: 1.03, fire: 1.02,
    plan: ['hive', 'gunship', 'sweep', 'formation', 'captor', 'midboss', 'hive', 'formation', 'sweep'],
    hive: ['dropLoop', 'sideSweep', 'sideHook'], sweep: ['zigzag', 'plunge', 'snake'], types: [2, 1, 3, 7],
    formations: ['wall', 'spear'], entries: ['top', 'right'], heavies: [4, 5, 4] },
  { id: 'volcanic', shape: 'chevron', armor: .91, speed: 1.12, fire: 1.06,
    plan: ['sweep', 'hive', 'formation', 'gunship', 'sweep', 'midboss', 'captor', 'formation', 'gunship', 'hive'],
    hive: ['topSpiral', 'dropLoop', 'sideHook'], sweep: ['plunge', 'snake', 'zigzag'], types: [7, 1, 7, 3],
    formations: ['spear', 'pincer'], entries: ['top', 'left'], heavies: [5, 4, 5] },
  { id: 'neon', shape: 'stagger', armor: .94, speed: 1.08, fire: 1.03,
    plan: ['formation', 'gunship', 'sweep', 'hive', 'formation', 'captor', 'midboss', 'sweep', 'gunship', 'hive'],
    hive: ['sideSweep', 'sideHook', 'dropLoop'], sweep: ['cross', 'zigzag', 'arc'], types: [1, 3, 2, 7],
    formations: ['helix', 'wall'], entries: ['right', 'left'], heavies: [5, 4, 4] },
  { id: 'alien', shape: 'orbit', armor: 1.08, speed: .96, fire: 1.02,
    plan: ['hive', 'captor', 'formation', 'sweep', 'midboss', 'hive', 'gunship', 'formation', 'sweep', 'hive'],
    hive: ['topSpiral', 'sideHook', 'sideSweep'], sweep: ['orbit', 'snake', 'figure'], types: [2, 7, 1, 3],
    formations: ['orbit', 'diamond'], entries: ['left', 'right'], heavies: [4, 5, 5] },
  { id: 'void', shape: 'diamond', armor: 1.10, speed: .97, fire: 1.04,
    plan: ['gunship', 'hive', 'formation', 'sweep', 'captor', 'gunship', 'midboss', 'formation', 'hive', 'sweep'],
    hive: ['dropLoop', 'topSpiral', 'sideSweep'], sweep: ['uTurn', 'cross', 'plunge'], types: [3, 7, 2, 3],
    formations: ['column', 'escort'], entries: ['top', 'right'], heavies: [5, 4, 5] },
].map(profile => {
  for (const value of Object.values(profile)) if (Array.isArray(value)) Object.freeze(value);
  return Object.freeze(profile);
}));

function mix(value) {
  value = Math.imul(value ^ value >>> 16, 0x21f0aaad);
  value = Math.imul(value ^ value >>> 15, 0x735a2d97);
  return (value ^ value >>> 15) >>> 0;
}
function waveSeed(level, wave, salt = 0) {
  // Include both halves of safe-integer sector numbers, including far circuits.
  // A campaign's salt (zero for the authored reference) varies later playthroughs.
  return mix((level >>> 0) ^ mix(Math.floor(level / 4294967296)) ^ Math.imul(wave + 1, 0x9e3779b1) ^ mix(salt >>> 0));
}
const rotate = (values, by) => values.map((_, i) => values[(i + by) % values.length]);
const bound = (value, min, max) => Math.max(min, Math.min(max, value));

export function tacticalPlan(level, salt = 0) {
  level = normalizeLevel(level);
  const plan = [...SECTOR_TACTICS[environmentIndex(level)].plan];
  const cycle = campaignCycle(level);
  // The opening sector of every campaign keeps its authored teaching order.
  // Returning circuits, and later sectors of a salted campaign, change the
  // order while keeping all authored roles and wave limits.
  if (cycle || (salt && level > 0)) {
    const seed = waveSeed(level, 0, salt);
    const shift = cycle ? 1 + (cycle - 1 + (salt ? (seed >>> 3) % (plan.length - 1) : 0)) % (plan.length - 1) : 1 + (seed >>> 3) % (plan.length - 1);
    const rotated = rotate(plan, shift);
    if (seed & 1) rotated.reverse();
    return rotated;
  }
  return plan;
}

export function waveTactics(level, wave = 0, salt = 0) {
  level = normalizeLevel(level);
  const profile = SECTOR_TACTICS[environmentIndex(level)], cycle = campaignCycle(level), tier = combatTier(level);
  const seed = waveSeed(level, wave, salt), variant = (seed >>> 4) % 3;
  // Scouts trade armor for speed; armored flights trade speed for durability.
  const armor = [.94, 1, 1.06][variant], speed = [1.04, 1, .96][variant];
  const mirror = (seed & 1) ? -1 : 1, turn = cycle || salt ? (seed >>> 8) % 3 : 0;
  const formations = rotate(profile.formations, (wave + cycle) % 2);
  if ((cycle || salt) && (seed & 4)) {
    const alternatives = FORMATION_KINDS.filter(kind => kind !== formations[0]);
    formations[1] = alternatives[(seed >>> 12) % alternatives.length];
  }
  // Specialist roles ride existing waves once the campaign has taught the basics.
  const roleBits = seed >>> 28;
  return {
    id: profile.id, variant, mirror,
    eliteLeader: tier + cycle * 2 >= 3 && (roleBits & 1) === 1,
    shieldedHeavies: tier + cycle * 2 >= 4 && (roleBits & 2) === 2,
    splitterRow: tier + cycle * 2 >= 3 && (roleBits & 4) === 4,
    armor: bound(profile.armor * armor, .85, 1.2),
    speed: bound(profile.speed * speed * (1 + .04 * cycle / (cycle + 3)), .84, 1.2),
    fire: profile.fire * (variant === 0 ? .96 : variant === 2 ? 1.02 : 1),
    hiveShape: profile.shape,
    hivePaths: rotate(profile.hive, (wave + turn) % profile.hive.length),
    sweepPaths: rotate(profile.sweep, (wave + turn) % profile.sweep.length),
    sweepTypes: rotate(profile.types, (wave + cycle) % profile.types.length),
    heavies: rotate(profile.heavies, (wave + cycle) % profile.heavies.length),
    rowGap: 2.3 + ((seed >>> 16) % 4) * .15,
    squadGap: 2.5 + ((seed >>> 18) % 4) * .25,
    spacing: .17 + ((seed >>> 20) % 4) * .025,
    flankDelay: profile.shape === 'split' ? 1.1 : .25 * ((seed >>> 22) % 3),
    stationLane: ((seed >>> 24) % 3 - 1) * .13,
    formationKinds: formations,
    formationEntries: profile.entries.map(entry => mirror < 0 ? entry === 'left' ? 'right' : entry === 'right' ? 'left' : entry : entry),
    formationDrift: ((seed >>> 26) % 3 - 1) * mirror,
    formationSpeed: bound(profile.speed * speed, .85, 1.2),
    formationTier: profile.armor >= 1.1 ? 1 : profile.speed >= 1.08 ? -1 : 0,
  };
}

// Resolve once, never on restore or in the frame loop. Concrete HP/speed and
// the two future attack multipliers are all included in flight saves.
export function applyTactics(enemy, tactics) {
  enemy.hp *= tactics.armor; enemy.maxHp = enemy.hp;
  enemy.speed *= tactics.speed;
  enemy.tacticSpeed = tactics.speed;
  enemy.tacticFire = tactics.fire;
  return enemy;
}
