import { normalizeLevel, environmentIndex, campaignCycle, combatTier } from './campaign.js';

/* Surprise encounters: short scripted events layered over a sector's authored
 * waves. Each campaign draws a different schedule from its salt, a retry or a
 * saved flight keeps the same one, and every encounter waits for room inside
 * the existing live-actor and hostile-projectile budgets. */
export const ENCOUNTER_KINDS = Object.freeze(['convoy', 'bonusFlight', 'ambush', 'meteors', 'minefield', 'ace', 'phantoms', 'bombers', 'medics']);
// Live hulls the arena may hold when an encounter launches: the same ceiling
// as the largest authored wave, so difficulty never changes actor counts.
export const ENCOUNTER_BUDGET = 28;

// Kicker, title and description for the instrument strip, plus the flight-report label.
export const ENCOUNTER_BRIEFS = Object.freeze({
  convoy: { kicker: 'Opportunity · convoy', title: 'Cargo haulers crossing', detail: 'Unarmed haulers drop salvage. Their escorts are armed.', label: 'Convoy' },
  bonusFlight: { kicker: 'Bonus flight', title: 'Unarmed scouts', detail: 'No return fire. Wipe the whole squadron for a double bonus.', label: 'Bonus flight' },
  ambush: { kicker: 'Ambush', title: 'Contacts rising from below', detail: 'They cannot fire until they pass you. Turn and strike.', label: 'Ambush' },
  meteors: { kicker: 'Hazard · meteors', title: 'Meteor shower', detail: 'Rocks tumble through the lane. Shoot them or dodge them.', label: 'Meteor shower' },
  minefield: { kicker: 'Hazard · mines', title: 'Minelayer crossing', detail: 'Mines drift downward and detonate on contact.', label: 'Minefield' },
  ace: { kicker: 'Warning · ace pilot', title: 'Ace inbound', detail: 'Reinforced armor and tight volleys. Its wreck carries prizes.', label: 'Ace' },
  phantoms: { kicker: 'Warning · phantoms', title: 'Cloaked fighters', detail: 'Shots pass through cloaked hulls. Strike when they shimmer.', label: 'Phantoms' },
  bombers: { kicker: 'Warning · bombers', title: 'Bomb run', detail: 'Slow bombs burst into rings. Do not linger below them.', label: 'Bombers' },
  medics: { kicker: 'Warning · repair ships', title: 'Field medics', detail: 'They repair nearby hulls. Priority targets.', label: 'Medics' },
});

// Named aces: the flight report and the warning use the same roster.
export const ACE_NAMES = Object.freeze(['Kestrel Nine', 'Red Meridian', 'Vantablack', 'Sable Wren', 'Ironquill', 'Solstice', 'Harrow Six', 'Whitecap', 'Nightjar', 'Cinder Vale', 'Lodestar', 'Quiet Fury']);

// Which environments an encounter suits, and how early in the campaign it appears.
const AFFINITY = Object.freeze({
  convoy: { tier: 0 }, bonusFlight: { tier: 0 }, ambush: { tier: 1 },
  meteors: { tier: 1, worlds: [4, 5, 6, 9] }, minefield: { tier: 2, worlds: [2, 4, 5, 9] },
  ace: { tier: 2 }, phantoms: { tier: 3, worlds: [7, 8, 9] }, bombers: { tier: 3 }, medics: { tier: 4 },
});
// Waves that already carry a heavy scripted actor never host an encounter.
export const BUSY_WAVES = new Set(['captor', 'midboss']);

function mix(value) {
  value = Math.imul(value ^ value >>> 16, 0x21f0aaad);
  value = Math.imul(value ^ value >>> 15, 0x735a2d97);
  return (value ^ value >>> 15) >>> 0;
}
export function encounterSeed(level, salt = 0, index = 0) {
  level = normalizeLevel(level);
  return mix((level >>> 0) ^ mix(Math.floor(level / 4294967296)) ^ mix((salt >>> 0) + 0x5bd1e995) ^ Math.imul(index + 1, 0x85ebca77));
}

/** Hulls an encounter launches at once. Mines laid later are hazards, not launches. */
export function encounterShips(kind, size = 0) {
  switch (kind) {
    case 'convoy': return 5 + size;
    case 'bonusFlight': return 8;
    case 'ambush': return 4 + size;
    case 'meteors': return 8 + size * 2;
    case 'minefield': return 1;
    case 'ace': return 1;
    case 'phantoms': return 4 + size;
    case 'bombers': return 2 + size;
    case 'medics': return 2;
    default: return 0;
  }
}

/**
 * Deterministic schedule for one sector: up to three encounters on distinct,
 * non-adjacent waves. The very first sector of a campaign offers only a calm
 * opportunity so new pilots meet surprises after the basics. Sizes grow with
 * the sector and the circuit, never with the difficulty setting.
 */
export function sectorEncounters(level, plan, salt = 0) {
  level = normalizeLevel(level);
  if (!Array.isArray(plan) || plan.length < 3) return [];
  const world = environmentIndex(level), tier = combatTier(level), cycle = campaignCycle(level);
  const size = Math.min(2, (tier >= 4 ? 1 : 0) + (cycle > 0 ? 1 : 0));
  const eligible = ENCOUNTER_KINDS.filter(kind => {
    const rule = AFFINITY[kind];
    if (level === 0) return kind === 'convoy' || kind === 'bonusFlight';
    if (tier + cycle * 2 < rule.tier) return false;
    return !rule.worlds || rule.worlds.includes(world);
  });
  if (!eligible.length) return [];
  const count = Math.min(3, level === 0 ? 1 : 1 + (tier >= 2 ? 1 : 0) + (cycle > 0 || tier >= 6 ? 1 : 0));
  const waves = [];
  for (let wave = level === 0 ? 2 : 1; wave < plan.length; wave++) if (!BUSY_WAVES.has(plan[wave])) waves.push(wave);
  const result = [];
  for (let index = 0; index < count && waves.length; index++) {
    const seed = encounterSeed(level, salt, index);
    let kind = eligible[seed % eligible.length];
    // Avoid repeating the previous encounter kind within one sector when possible.
    if (result.some(entry => entry.kind === kind) && eligible.length > 1) kind = eligible[(seed % eligible.length + 1 + (seed >>> 8) % (eligible.length - 1)) % eligible.length];
    const slot = waves.splice((seed >>> 16) % waves.length, 1)[0];
    // Keep neighbouring waves free so encounters never stack on each other.
    for (let i = waves.length - 1; i >= 0; i--) if (Math.abs(waves[i] - slot) < 2) waves.splice(i, 1);
    const calm = kind === 'convoy' || kind === 'bonusFlight';
    result.push({ kind, wave: slot, time: calm ? 1.2 : 5 + ((seed >>> 24) % 5) * 1.4, size, done: false });
  }
  return result.sort((a, b) => a.wave - b.wave);
}

/** Flight-report summary line for the encounters a sector delivered. */
export function encounterSummary(stats = {}) {
  const parts = [];
  if (stats.aces) parts.push(`${stats.aces} ace${stats.aces === 1 ? '' : 's'} downed`);
  if (stats.convoys) parts.push(`${stats.convoys} cargo hauler${stats.convoys === 1 ? '' : 's'} plundered`);
  if (stats.hazards) parts.push(`${stats.hazards} hazard${stats.hazards === 1 ? '' : 's'} cleared`);
  return parts.join(' · ');
}
