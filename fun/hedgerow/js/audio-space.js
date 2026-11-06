/* A small, event-driven acoustic cache. A shot/step takes one snapshot of
   the path to the listener; playing voices never trace the world each frame.

   probe(lx, ly, lz, sx, sy, sz) returns null for a clear path, or a world hit
   with a `surface` name. It should ignore water and the final 25 cm of the
   segment so an impact on a wall is heard on the listener's side of it.
   At most four probes run in each 100 ms audio-clock window. */

const OPEN = Object.freeze({ gain: 1, cutoff: 20000, blocked: false, surface: null });
const PROFILES = {
  masonry: Object.freeze({ gain: 0.46, cutoff: 950, blocked: true, surface: 'masonry' }),
  earth: Object.freeze({ gain: 0.54, cutoff: 720, blocked: true, surface: 'earth' }),
  wood: Object.freeze({ gain: 0.67, cutoff: 1750, blocked: true, surface: 'wood' }),
  metal: Object.freeze({ gain: 0.52, cutoff: 1350, blocked: true, surface: 'metal' }),
  foliage: Object.freeze({ gain: 0.86, cutoff: 3600, blocked: true, surface: 'foliage' }),
};

export function acousticProfile(hit) {
  if (!hit) return OPEN;
  const surface = hit.surface;
  // The grass on a bank is not a thin screen of leaves: the earth below it
  // blocks the direct path regardless of its rendered surface material.
  if (hit.collider === 'terrain') return PROFILES.earth;
  if (['grass', 'foliage', 'forest', 'leaves', 'fabric'].includes(surface)) return PROFILES.foliage;
  if (['mud', 'dirt', 'earth', 'sand', 'sandbag'].includes(surface)) return PROFILES.earth;
  if (['wood', 'planks'].includes(surface)) return PROFILES.wood;
  if (['metal', 'iron'].includes(surface)) return PROFILES.metal;
  return PROFILES.masonry;
}

export function createAcousticOcclusion({ maxQueries = 4, windowSeconds = 0.1, maxEntries = 128, ttl = 0.32 } = {}) {
  const listener = { x: 0, y: 0, z: 0 };
  const cache = new Map();
  let probe = null, windowStart = -Infinity, inWindow = 0;
  const stats = { probes: 0, cached: 0, budgetSkipped: 0, errors: 0, peakQueries: 0 };

  function sample(x, y, z, time) {
    if (!probe || !Number.isFinite(time) || ![x, y, z].every(Number.isFinite)) return OPEN;
    // The listener's own kit and a bullet passing the head remain immediate.
    if (Math.hypot(x - listener.x, y - listener.y, z - listener.z) < 1) return OPEN;
    // Keep boots, crouched muzzles and standing muzzles in separate height
    // cells: a waist-high wall can block one path while leaving another open.
    const key = `${Math.floor(x / 2)},${Math.floor(y / .5)},${Math.floor(z / 2)}`;
    const entry = cache.get(key);
    if (entry && time >= entry.time && time - entry.time < ttl &&
        Math.hypot(listener.x - entry.x, listener.z - entry.z) < 0.8 && Math.abs(listener.y - entry.y) < .25 &&
        Math.hypot(x - entry.sx, z - entry.sz) < .35 && Math.abs(y - entry.sy) < .15) {
      stats.cached++;
      return entry.profile;
    }
    if (time < windowStart || time - windowStart >= windowSeconds) {
      windowStart = time; inWindow = 0;
    }
    if (inWindow >= maxQueries) {
      // Preserve an audible danger cue under saturation. Never assume a new
      // source is behind the same wall as an unrelated cached source.
      stats.budgetSkipped++;
      return OPEN;
    }
    inWindow++; stats.probes++;
    stats.peakQueries = Math.max(stats.peakQueries, inWindow);
    let profile = OPEN;
    try { profile = acousticProfile(probe(listener.x, listener.y, listener.z, x, y, z)); }
    catch { stats.errors++; }
    cache.delete(key);
    cache.set(key, { profile, time, x: listener.x, y: listener.y, z: listener.z, sx: x, sy: y, sz: z });
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return profile;
  }

  return {
    sample,
    setListener(x, y, z) { listener.x = x; listener.y = y; listener.z = z; },
    setProbe(fn) { probe = typeof fn === 'function' ? fn : null; cache.clear(); windowStart = -Infinity; },
    clear() { cache.clear(); windowStart = -Infinity; },
    get status() { return { ...stats, entries: cache.size, maxQueries, windowSeconds }; },
  };
}
