// Match analysis for the debrief: rating, grade, campaign medals, skirmish commander's goals and career
// totals. Pure functions over saved game state; nothing here touches the DOM, storage or the clock.
// Rival figures are reported only once the operation has ended, so the debrief never leaks fog.
import { TEAM_STATS, RACES, unitRole } from './sim.js';
import { MISSIONS } from './campaign.js';
import { objectiveVoid } from './mission.js';

const clamp01 = value => Math.max(0, Math.min(1, value));
export const GRADES = [['S', 90], ['A', 78], ['B', 64], ['C', 50], ['D', 0]];
export const MEDALS = ['bronze', 'silver', 'gold'];
const SURVIVAL_GRADES = [['S', 1200], ['A', 900], ['B', 600], ['C', 300], ['D', 0]];
// A skirmish victory inside this window earns the full tempo share.
const SKIRMISH_TEMPO = 900;

// Optional skirmish goals, in the order they are offered. Each reads only the player's own match
// statistics, which only ever grow, so a ticked goal never un-ticks. Kill goals count confirmed kills.
export const COMMANDER_GOALS = [
  { id: 'payroll', label: 'Deliver 2,000 credits of shards', stat: 'mined', target: 2000 },
  { id: 'company', label: 'Field 15 armed units at once', stat: 'peakArmy', target: 15 },
  { id: 'study', label: 'Complete two research projects', stat: 'researched', target: 2 },
  { id: 'blooded', label: 'Destroy 25 hostile units', stat: 'unitKills', target: 25 },
  { id: 'demolition', label: 'Destroy 8 hostile structures', stat: 'structureKills', target: 8 },
  { id: 'industry', label: 'Deliver 12,000 credits of shards', stat: 'mined', target: 12000 },
  { id: 'battalion', label: 'Field 60 armed units at once', stat: 'peakArmy', target: 60 },
  { id: 'doctrine', label: 'Complete six research projects', stat: 'researched', target: 6 },
];

const stats = (s, team) => {
  const raw = s.teams[team]?.stats;
  return raw ? Object.fromEntries(TEAM_STATS.map(key => [key, Number(raw[key]) || 0])) : null;
};

// Goals with progress; null for saves recorded before match statistics existed.
export function commanderGoals(s) {
  const own = stats(s, 0);
  if (!own) return null;
  // A kill made out of sight is confirmed only when the operation ends (as in confirmedKills).
  if (s.status === 'playing') { own.unitKills -= own.unseenUnitKills; own.structureKills -= own.unseenStructureKills; }
  return COMMANDER_GOALS.map(goal => ({ ...goal, progress: Math.min(goal.target, own[goal.stat]), done: own[goal.stat] >= goal.target }));
}

export const missionTime = s => Math.max(0, s.time - (s.mission?.startedAt ?? 0));
const secondaryTally = s => {
  const def = s.mission && MISSIONS[s.mission.id];
  if (!def) return null;
  // An objective that cannot apply (veterans nobody brought) neither helps nor blocks a medal.
  const list = def.objectives.map((o, i) => ({ o, state: s.mission.objectives[i] })).filter(({ o }) => o.secondary && !objectiveVoid(s.mission, o.id));
  return { done: list.filter(({ state }) => state.state === 'done').length, total: list.length };
};

// Campaign medal for a finished operation: bronze for victory, silver when every secondary objective is
// also complete (hidden ones included), gold when that happens within the par time.
export function medalFor(s) {
  const def = s.mission && MISSIONS[s.mission.id];
  if (!def || s.status !== 'victory' || !Number.isFinite(def.par)) return null;
  const secondary = secondaryTally(s);
  if (secondary.done < secondary.total) return 'bronze';
  return missionTime(s) <= def.par ? 'gold' : 'silver';
}

export function gradeFor(rating, scale = GRADES) {
  return scale.find(([, min]) => rating >= min)[0];
}

// The debrief record of a finished (or abandoned) operation.
export function matchReport(s) {
  const def = s.mission ? MISSIONS[s.mission.id] : null, time = missionTime(s), you = stats(s, 0);
  const finished = s.status !== 'playing', victory = s.status === 'victory';
  const report = { status: s.status, time, mission: def?.id ?? null, you, rival: finished ? stats(s, 1) : null, kills: s.teams[0].kills || 0 };
  if (def?.score === 'survival') {
    report.survival = s.mission.score || 0;
    report.score = report.survival;
    report.grade = gradeFor(time, SURVIVAL_GRADES);
    report.rating = Math.round(clamp01(time / 1200) * 100);
    return report;
  }
  const secondary = def ? secondaryTally(s) : null, goals = !def && commanderGoals(s);
  // Rating out of 100: outcome 50, exchange 20, economy 10, objectives or goals 10, tempo 10.
  let rating = victory ? 50 : 15;
  if (you) {
    const dealt = you.unitKills + 2 * you.structureKills, taken = you.lost + 2 * you.structuresLost, exchange = dealt / Math.max(1, taken);
    rating += 20 * exchange / (exchange + 1);
    // An operation without an economy (a commando strike) scores the economy share as neutral.
    rating += you.mined + you.spent === 0 ? 5 : 10 * clamp01(you.spent / Math.max(1, you.mined));
  }
  if (secondary) rating += secondary.total ? 10 * secondary.done / secondary.total : 10;
  else if (goals) rating += 10 * goals.filter(goal => goal.done).length / goals.length;
  const par = def?.par ?? SKIRMISH_TEMPO;
  rating += victory ? 10 * clamp01(par / Math.max(1, time)) : 10 * clamp01(time / par) * .5;
  report.rating = Math.round(Math.min(100, rating));
  report.score = report.rating * 100;
  report.grade = gradeFor(report.rating);
  report.medal = medalFor(s);
  report.secondary = secondary;
  report.goals = goals ? { done: goals.filter(goal => goal.done).length, total: goals.length } : null;
  return report;
}

// Crimson always marks the rival claimant: a mirror match faces the Red Ledger or severed mainframes.
export function rivalLabel([player = 'organics', rival = 'organics']) {
  return rival === player ? rival === 'aiUnity' ? 'Severed Unity' : 'Red Ledger' : RACES[rival]?.name ?? 'Rival';
}
export const rivalName = s => rivalLabel(s.teams.map(team => team.race));

// Surviving ranked units of an operation, strongest first, as plain {role, kills} records.
export function survivingVeterans(s, limit = 12) {
  return s.entities.filter(e => e.team === 0 && e.kind === 'unit' && e.hp > 0 && (e.kills || 0) >= 5)
    .sort((a, b) => b.kills - a.kills || a.id - b.id).slice(0, limit)
    .map(e => ({ role: unitRole(e), kills: Math.min(1000, Math.floor(e.kills)) }));
}

const CAREER_KEYS = ['operations', 'victories', 'defeats', 'seconds', 'kills', 'trained', 'lost', 'built', 'mined', 'bestScore'];
export function emptyCareer() { return { version: 1, ...Object.fromEntries(CAREER_KEYS.map(key => [key, 0])), bestGrade: null, fastestVictory: null, last: null }; }
// Folds a finished operation into career totals. The key identifies the match so a re-shown debrief
// never counts twice.
export function addToCareer(career, report, key) {
  const next = { ...emptyCareer(), ...career };
  if (next.last === key) return next;
  next.last = key;
  next.operations++;
  if (report.status === 'victory') next.victories++; else if (report.status === 'defeat') next.defeats++;
  next.seconds += Math.round(report.time);
  next.kills += report.kills;
  if (report.you) { next.trained += report.you.trained; next.lost += report.you.lost; next.built += report.you.built; next.mined += Math.round(report.you.mined); }
  next.bestScore = Math.max(next.bestScore, report.score || 0);
  if (!next.bestGrade || GRADES.findIndex(([grade]) => grade === report.grade) < GRADES.findIndex(([grade]) => grade === next.bestGrade)) next.bestGrade = report.grade;
  if (report.status === 'victory' && (next.fastestVictory === null || report.time < next.fastestVictory)) next.fastestVictory = Math.round(report.time);
  return next;
}
// Validates stored career totals, returning a clean record (or a fresh one) from anything stored.
export function readCareer(value) {
  const career = emptyCareer();
  if (!value || typeof value !== 'object') return career;
  for (const key of CAREER_KEYS) if (Number.isFinite(value[key]) && value[key] >= 0) career[key] = Math.min(value[key], 1e12);
  if (GRADES.some(([grade]) => grade === value.bestGrade)) career.bestGrade = value.bestGrade;
  if (Number.isFinite(value.fastestVictory) && value.fastestVictory >= 0) career.fastestVictory = value.fastestVictory;
  if (typeof value.last === 'string' && value.last.length <= 200) career.last = value.last;
  return career;
}

