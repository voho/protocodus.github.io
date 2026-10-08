// Successful edits leave a short mark on display time, including while the
// simulation is paused. This presentation state never enters a world or save.
export const CONSTRUCTION_FEEDBACK_MS = 700;
export const CONSTRUCTION_FEEDBACK_CELLS = 96;
const clock = () => globalThis.performance?.now?.() ?? Date.now();
const key = point => `${point.x},${point.y}`;

export function createConstructionFeedback() {
  let effects = [];
  const prune = now => { effects = effects.filter(effect => now - effect.startedAt < CONSTRUCTION_FEEDBACK_MS); };

  function add(points, { now = clock(), kind = 'build' } = {}) {
    if (!Array.isArray(points) || !Number.isFinite(now)) return false;
    prune(now);
    const latest = new Map();
    // A long drag only needs its latest cells. Neither retained data nor frame
    // work grows with the length of the road the player just built.
    for (let i = points.length - 1; i >= 0 && latest.size < CONSTRUCTION_FEEDBACK_CELLS; i--) {
      const point = points[i];
      if (!Number.isInteger(point?.x) || !Number.isInteger(point?.y) || point.x < 0 || point.y < 0) continue;
      latest.set(key(point), { x: point.x, y: point.y });
    }
    if (!latest.size) return false;
    let remaining = CONSTRUCTION_FEEDBACK_CELLS - latest.size;
    // Replacing a cell also replaces its colour and lifetime, so rapid undo
    // cannot leave a green success mark beneath its neutral restoration mark.
    for (let i = effects.length - 1; i >= 0; i--) {
      const previous = effects[i].points.filter(point => !latest.has(key(point)));
      effects[i].points = remaining ? previous.slice(-remaining) : [];
      remaining -= effects[i].points.length;
    }
    effects = effects.filter(effect => effect.points.length);
    effects.push({ points: [...latest.values()].reverse(), kind: kind === 'remove' || kind === 'undo' ? kind : 'build', startedAt: now });
    return true;
  }

  function active(now = clock()) {
    prune(now);
    return effects.length > 0;
  }

  function sample(now = clock(), { reducedMotion = false } = {}) {
    prune(now);
    return effects.map(effect => {
      const elapsed = Math.max(0, now - effect.startedAt), fade = Math.max(0, elapsed - 120) / (CONSTRUCTION_FEEDBACK_MS - 120);
      return { points: effect.points.map(point => ({ ...point })), kind: effect.kind, alpha: reducedMotion ? 1 : (1 - fade) ** 2, expiresAt: effect.startedAt + CONSTRUCTION_FEEDBACK_MS };
    });
  }

  return { add, active, sample, clear() { effects = []; } };
}
