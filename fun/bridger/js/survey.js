import { createMission, randomSolution, restoreMission } from './mission.js';

export function openSurvey(difficulty, seed) {
  let worker, pending, localMission, closed = false;
  try {
    worker = new Worker(new URL('./survey-worker.js', import.meta.url), { type: 'module' });
    worker.onerror = (event) => { event.preventDefault(); stopWorker(); };
    worker.onmessageerror = stopWorker;
    worker.onmessage = ({ data }) => pending?.(data);
  } catch { /* The local solver also runs when module workers are unavailable. */ }

  function stopWorker() {
    worker?.terminate();
    worker = null;
    pending?.(null);
  }

  // The editor allows one survey or hint at a time. Leaving a river cancels
  // the outstanding work, including any hint queued on that river.
  async function request(recent) {
    let reply;
    if (worker) {
      reply = await new Promise((resolve) => {
        pending = resolve;
        worker.postMessage({ difficulty, seed, recent });
      });
      pending = null;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (closed) return null;
    if (reply?.error) throw new Error(reply.error);
    if (reply) return recent ? reply : restoreMission(reply);
    localMission ??= createMission(difficulty, seed);
    return recent ? randomSolution(localMission, Math.random, 600, recent) : localMission;
  }

  return {
    difficulty, seed,
    mission: () => request(null),
    solution: (recent) => request(recent),
    close() { closed = true; stopWorker(); },
  };
}
