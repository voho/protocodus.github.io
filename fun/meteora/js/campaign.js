/* Meteora — the campaign: ten missions, what they unlock, ranks, medals,
   commendations and the save.

   Progress lives in localStorage under `meteora.campaign.v1`. Every read
   and write is wrapped: private browsing, a full quota or a corrupt record
   just means a fresh campaign, never a crash. */

import m01 from './missions/m01.js';
import m02 from './missions/m02.js';
import m03 from './missions/m03.js';
import m04 from './missions/m04.js';
import m05 from './missions/m05.js';
import m06 from './missions/m06.js';
import m07 from './missions/m07.js';
import m08 from './missions/m08.js';
import m09 from './missions/m09.js';
import m10 from './missions/m10.js';
import { DEFAULT_DIFFICULTY, DIFFICULTIES } from './difficulty.js';
import { HULLS } from './catalog.js';
import { PRIMARIES, PLAYER_SECONDARIES, REACTORS, defaultLoadout, normalizeLoadout } from './loadout.js';

export const MISSIONS = [m01, m02, m03, m04, m05, m06, m07, m08, m09, m10];
export const missionById = id => MISSIONS.find(m => m.id === id) ?? null;

/* What is in service once `done` missions have been won. */
const SCHEDULE = [
  { hulls: ['kestrel'], primaries: ['pulse'], secondaries: ['hornet'], reactors: ['hearth'] },
  { hulls: ['swift'], primaries: ['needle'] },
  { reactors: ['hush'] },
  { hulls: ['anvil'], primaries: ['breaker'], secondaries: ['lance'] },
  { secondaries: ['swarm'], reactors: ['forge'] },
  { primaries: ['ion'], reactors: ['aegis'] },
];
export function unlockedAfter(done) {
  const u = { hulls: [], primaries: [], secondaries: [], reactors: [] };
  SCHEDULE.slice(0, Math.min(SCHEDULE.length, done + 1)).forEach(step => {
    for (const k of Object.keys(u)) for (const x of step[k] ?? []) if (!u[k].includes(x)) u[k].push(x);
  });
  return u;
}
/* A mission is always flyable with what it recommends. */
export function unlockedFor(progress, mission) {
  const u = unlockedAfter(progress.won.length);
  const rec = mission?.recommend;
  if (rec) {
    const add = (k, x) => { if (x && !u[k].includes(x)) u[k].push(x); };
    add('hulls', rec.hull); add('primaries', rec.primary); add('reactors', rec.reactor);
    for (const s of rec.secondaries ?? []) add('secondaries', s);
  }
  return u;
}
export const ALL_UNLOCKED = { hulls: [...HULLS], primaries: Object.keys(PRIMARIES), secondaries: [...PLAYER_SECONDARIES], reactors: Object.keys(REACTORS) };

/* What each mission brings into service, for the debrief's fanfare. */
export function unlocksOf(index) {
  const step = SCHEDULE[index + 1];
  if (!step) return [];
  const names = [];
  for (const h of step.hulls ?? []) names.push({ kind: 'Hull', key: h });
  for (const p of step.primaries ?? []) names.push({ kind: 'Gun', key: p });
  for (const s of step.secondaries ?? []) names.push({ kind: 'Ordnance', key: s });
  for (const r of step.reactors ?? []) names.push({ kind: 'Reactor', key: r });
  return names;
}

/* ---------- ranks ---------- */

export const RANKS = [
  { name: 'Cadet', score: 0 }, { name: 'Ensign', score: 6000 }, { name: 'Lieutenant', score: 18000 },
  { name: 'Lieutenant Commander', score: 38000 }, { name: 'Commander', score: 65000 }, { name: 'Captain', score: 100000 },
  { name: 'Wing Commander', score: 150000 },
];
export function rankOf(total) {
  let i = 0;
  while (i + 1 < RANKS.length && total >= RANKS[i + 1].score) i++;
  const next = RANKS[i + 1] ?? null;
  return {
    index: i, name: RANKS[i].name, next: next?.name ?? null,
    progress: next ? (total - RANKS[i].score) / (next.score - RANKS[i].score) : 1,
  };
}

/* ---------- commendations ---------- */

export const COMMENDATIONS = [
  { id: 'first', name: 'First Light', text: 'Win your first mission.', test: r => r.won },
  { id: 'untouchable', name: 'Untouchable', text: 'Win a mission without taking hull damage.', test: r => r.won && r.stats.hullTaken < 0.5 },
  { id: 'ace', name: 'Ace', text: 'Five kills in one mission.', test: r => r.stats.killCount >= 5 },
  { id: 'ace10', name: 'Ace of Aces', text: 'Fifteen kills in one mission.', test: r => r.stats.killCount >= 15 },
  { id: 'streak', name: 'Rampage', text: 'A five-kill streak.', test: r => r.stats.bestStreak >= 5 },
  { id: 'bombs', name: 'Bomb Disposal', text: 'Shoot down five torpedoes in one mission.', test: r => r.stats.torpedoesDowned >= 5 },
  { id: 'mites', name: 'Swarm Breaker', text: 'Twenty Mites in one mission.', test: r => (r.stats.kills.mite ?? 0) >= 20 },
  { id: 'ghost', name: 'Ghost', text: 'Win Deep Signal without being detected.', test: r => r.won && r.id === 'm03' && r.objectives.some(o => o.id === 'quiet' && o.state === 'done') },
  { id: 'surgeon', name: 'Surgeon', text: 'Destroy five subsystems in one mission.', test: r => r.stats.subsystems >= 5 },
  { id: 'giant', name: 'Giant Killer', text: 'Destroy the Mother\'s reactor.', test: r => r.won && r.id === 'm08' },
  { id: 'ninth', name: 'Nine Lives', text: 'Destroy the Ninth Hand.', test: r => r.objectives.some(o => o.id === 'ninth' && o.state === 'done') },
  { id: 'marksman', name: 'Marksman', text: 'Win a mission with 40 % accuracy or better (100 shots at least).', test: r => r.won && r.stats.shots >= 100 && r.stats.accuracy >= 0.4 },
  { id: 'gold', name: 'Gold Wing', text: 'Earn a gold medal.', test: r => r.medal === 'gold' },
  { id: 'ace-diff', name: 'Iron Nerve', text: 'Win any mission on Ace.', test: r => r.won && r.difficulty === 'ace' },
  { id: 'mercy', name: 'Long Mercy', text: 'Finish the campaign.', test: r => r.won && r.id === 'm10' },
  { id: 'allgold', name: 'Perpetua\'s Own', text: 'Gold on every mission.', test: (r, p) => MISSIONS.every(m => p.best[m.id]?.medal === 'gold') },
];

/* ---------- the save ---------- */

const KEY = 'meteora.campaign.v1';
export function freshProgress() {
  return {
    version: 1, difficulty: DEFAULT_DIFFICULTY, won: [], best: {}, loadouts: {}, commendations: {},
    total: 0, seenPrologue: false, survival: {}, lastPlayed: null,
  };
}
const medalRank = { gold: 3, silver: 2, bronze: 1 };

export function loadProgress(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object' || raw.version !== 1) return freshProgress();
    const p = { ...freshProgress(), ...raw };
    p.won = Array.isArray(p.won) ? p.won.filter(id => missionById(id)) : [];
    if (!DIFFICULTIES[p.difficulty]) p.difficulty = DEFAULT_DIFFICULTY;
    if (typeof p.total !== 'number' || !Number.isFinite(p.total)) p.total = 0;
    for (const k of ['best', 'loadouts', 'commendations', 'survival']) if (!p[k] || typeof p[k] !== 'object') p[k] = {};
    return p;
  } catch { return freshProgress(); }
}
export function saveProgress(storage, progress) {
  try { storage?.setItem(KEY, JSON.stringify(progress)); return true; } catch { return false; }
}

/* The next mission to fly: the first not yet won. */
export function nextMission(progress) {
  return MISSIONS.find(m => !progress.won.includes(m.id)) ?? MISSIONS[MISSIONS.length - 1];
}
export function isAvailable(progress, mission) {
  const i = MISSIONS.indexOf(mission);
  return i === 0 || progress.won.includes(MISSIONS[i - 1].id) || progress.won.includes(mission.id);
}

export function loadoutFor(progress, mission) {
  const saved = progress.loadouts[mission?.id] ?? progress.loadouts.last;
  const base = saved ?? mission?.recommend ?? defaultLoadout('kestrel');
  return normalizeLoadout(base, unlockedFor(progress, mission));
}

/* Fold a finished mission's results into the progress. Returns what changed,
   for the debrief: rank-up, new unlocks, new commendations, a new best. */
export function recordResult(progress, results) {
  const before = rankOf(progress.total);
  const wonBefore = progress.won.length;
  const out = { newBest: false, rankUp: null, unlocks: [], commendations: [] };
  if (results.won && !progress.won.includes(results.id)) {
    progress.won.push(results.id);
    out.unlocks = unlocksOf(MISSIONS.findIndex(m => m.id === results.id));
  }
  const prev = progress.best[results.id];
  if (results.won) {
    const better = !prev || results.score > prev.score;
    const medal = !prev || (medalRank[results.medal] ?? 0) > (medalRank[prev.medal] ?? 0) ? results.medal : prev.medal;
    progress.best[results.id] = {
      score: better ? results.score : prev.score, medal, time: better ? results.time : prev.time,
      difficulty: better ? results.difficulty : prev.difficulty,
    };
    out.newBest = better;
    // Total score counts each mission's best once.
    progress.total = Object.values(progress.best).reduce((s, b) => s + (b.score ?? 0), 0);
  }
  for (const c of COMMENDATIONS) {
    if (progress.commendations[c.id]) continue;
    let earned = false;
    try { earned = !!c.test(results, progress); } catch { earned = false; }
    if (earned) { progress.commendations[c.id] = Date.now(); out.commendations.push(c); }
  }
  const after = rankOf(progress.total);
  if (after.index > before.index) out.rankUp = after.name;
  progress.lastPlayed = results.id;
  if (progress.won.length !== wonBefore) out.firstWin = true;
  return out;
}
