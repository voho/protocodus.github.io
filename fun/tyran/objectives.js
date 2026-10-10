import { normalizeLevel, combatTier, campaignCycle, cycleScale } from './campaign.js';
import { waveTactics } from './tactics.js';

/* Sector objectives: two optional goals per sector, drawn from the campaign
 * salt like the encounter schedule. Progress goals pay the moment they are
 * met; flight-long goals are judged when the sector is cleared. Together with
 * accuracy and losses they grade the sector from S to D. */
export const OBJECTIVE_KINDS = Object.freeze(['squads', 'dives', 'demolition', 'leaders', 'ace', 'precision', 'untouchable', 'survivor']);
export const OBJECTIVES = Object.freeze({
  squads: { title: 'Squadron hunter', detail: n => `Wipe out ${n} squadrons` },
  dives: { title: 'Interceptor', detail: n => `Shoot down ${n} diving ships` },
  demolition: { title: 'Demolition', detail: n => `Destroy ${n} buildings` },
  leaders: { title: 'Decapitation', detail: n => `Down ${n} formation leader${n === 1 ? '' : 's'}` },
  ace: { title: 'Ace hunter', detail: () => 'Shoot down the ace' },
  precision: { title: 'Marksman', detail: n => `Clear the sector with ${n}% accuracy`, final: true },
  untouchable: { title: 'Untouchable', detail: () => 'Keep every hit on the shield', final: true },
  survivor: { title: 'Survivor', detail: () => 'Clear the sector without losing a ship', final: true },
});
const LEADERS = new Set(['escort', 'diamond', 'spear']);
// The opening sector teaches the idea with goals every new pilot meets.
const OPENING = ['squads', 'demolition', 'dives'];

function mix(value) {
  value = Math.imul(value ^ value >>> 16, 0x21f0aaad);
  value = Math.imul(value ^ value >>> 15, 0x735a2d97);
  return (value ^ value >>> 15) >>> 0;
}
const objectiveSeed = (level, salt, index) => mix((level >>> 0) ^ mix(Math.floor(level / 4294967296)) ^ mix((salt >>> 0) + 0x27d4eb2f) ^ Math.imul(index + 1, 0x165667b1));

function target(kind, tier, cycle) {
  switch (kind) {
    case 'squads': return 3 + Math.floor(tier / 3) + Math.min(1, cycle);
    case 'dives': return 4 + Math.floor(tier / 2);
    case 'demolition': return 5 + tier;
    case 'precision': return 35 + tier;
    default: return 1;
  }
}

/** Deterministic objectives for a sector: two distinct goals, at most one judged at the end. */
export function sectorObjectives(level, plan = [], encounters = [], salt = 0) {
  level = normalizeLevel(level);
  const tier = combatTier(level), cycle = campaignCycle(level);
  let pool = level === 0 ? OPENING : OBJECTIVE_KINDS.filter(kind => {
    if (kind === 'ace') return encounters.some(encounter => encounter.kind === 'ace');
    if (kind === 'leaders') return plan.some((wave, index) => wave === 'formation' && waveTactics(level, index, salt).formationKinds.some(shape => LEADERS.has(shape)));
    // A flawless hull is a late-campaign boast, never a first lesson.
    if (kind === 'untouchable') return tier + cycle * 2 >= 2;
    return true;
  });
  const result = [];
  for (let index = 0; result.length < 2 && pool.length; index++) {
    const kind = pool[objectiveSeed(level, salt, index) % pool.length];
    result.push({ kind, target: target(kind, tier, cycle), done: false });
    pool = pool.filter(entry => entry !== kind && !(OBJECTIVES[kind].final && OBJECTIVES[entry].final));
  }
  return result;
}

/** Live progress toward a goal; flight-long goals report their current standing. */
export function objectiveProgress(s, objective) {
  const stats = s.stats || {};
  switch (objective.kind) {
    case 'squads': return stats.squads || 0;
    case 'dives': return stats.dives || 0;
    case 'demolition': return s.destroyed || 0;
    case 'leaders': return stats.leaders || 0;
    case 'ace': return stats.aces || 0;
    case 'precision': return stats.shots ? Math.floor(stats.hits / stats.shots * 100) : 0;
    case 'untouchable': return stats.hullHits ? 0 : 1;
    case 'survivor': return stats.lost ? 0 : 1;
    default: return 0;
  }
}
export const objectiveMet = (s, objective) => objectiveProgress(s, objective) >= objective.target;
export const objectiveReward = level => ({
  credits: Math.round((150 + combatTier(level) * 35) * cycleScale(level, .3)),
  score: Math.round(2000 * (1 + combatTier(level) * .25) * cycleScale(level, .3)),
});
export const objectiveLabel = objective => OBJECTIVES[objective.kind]?.detail(objective.target) || '';

// Grade: objectives carry half the points; accuracy, losses and hull hits the rest.
export const RANK_BONUS = Object.freeze({ S: .5, A: .3, B: .15, C: .05, D: 0 });
export function sectorRank(s) {
  const stats = s.stats || {}, objectives = s.director?.objectives || [];
  const ratio = stats.shots ? stats.hits / stats.shots : 0;
  let points = Math.round(objectives.filter(objective => objective.done).length * 50 / Math.max(2, objectives.length));
  points += ratio >= .5 ? 20 : ratio >= .35 ? 10 : 0;
  points += !stats.lost ? 20 : stats.lost === 1 ? 10 : 0;
  points += !stats.hullHits ? 10 : stats.hullHits <= 3 ? 5 : 0;
  const grade = points >= 85 ? 'S' : points >= 65 ? 'A' : points >= 45 ? 'B' : points >= 25 ? 'C' : 'D';
  return { grade, points };
}
