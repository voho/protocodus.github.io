import { randomSeed } from '../../shared/rng.js';
import { choosePreparedSolution, createMission, missionFromRiver, prepareRiver, preloadRiverCatalog, restoreRiver, riverSlot } from './mission.js';

preloadRiverCatalog();

const previous = new Map();
const recentSlots = [];
export function newRiverSeed() {
  let seed;
  do { seed = `v3-${randomSeed()}`; } while (recentSlots.includes(riverSlot(seed)));
  recentSlots.push(riverSlot(seed));
  if (recentSlots.length > 16) recentSlots.shift();
  return seed;
}

export const hasSurvey = seed => seed.startsWith('v3-') || previous.has(seed);

// Only an original procedural link needs work at startup. Its worker exits
// before play starts. Keep the complete proof pool for every budget.
function prepareLegacy(seed) {
  let worker, finish, cancelled = false;
  const result = new Promise((resolve, reject) => {
    finish = resolve;
    const local = () => {
      worker?.terminate();
      if (cancelled) return;
      try { resolve(restoreRiver(prepareRiver(seed))); } catch (error) { reject(error); }
    };
    try {
      worker = new Worker(new URL('./survey-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        worker.terminate();
        if (data.error) reject(new Error(data.error));
        else resolve(restoreRiver(data));
      };
      worker.onerror = event => { event.preventDefault(); local(); };
      worker.onmessageerror = local;
      worker.postMessage(seed);
    } catch { local(); }
  });
  return { result, cancel() { cancelled = true; worker?.terminate(); finish(null); } };
}

export function openSurvey(difficulty, seed) {
  let current, pending, closed = false;
  return {
    difficulty, seed,
    async mission() {
      if (closed) return null;
      if (seed.startsWith('v3-')) current = createMission(difficulty, seed);
      else {
        if (!previous.has(seed)) {
          pending ??= prepareLegacy(seed);
          const prepared = await pending.result;
          if (closed || !prepared) return null;
          previous.set(seed, prepared);
        }
        current = missionFromRiver(previous.get(seed), difficulty, seed);
      }
      return current;
    },
    solution(recent) { return closed || !current ? null : choosePreparedSolution(current, recent); },
    close() { closed = true; pending?.cancel(); },
  };
}
