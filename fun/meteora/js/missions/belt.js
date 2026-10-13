/* Meteora — a mission's piece of the belt.

   Every mission flies through the same seeded belt generator with its own
   seed, density and clearings: spheres kept free of rock around stations
   and capital ships, lanes along convoy routes. Each mission builds its
   config once, at load, so the generated belt is cached per mission.

   Not every mission is in the thick of it. `density: 0` is open space,
   nothing but ships; `sizes` scales each rock size on its own (the big
   ones only, say, where the Harrow have quarried the rest away); `edge`
   keeps the rock to one side of a plane — the belt's edge, and beyond it
   nothing; `fill` is how crowded it feels to the pilots who fly it. */

import { FIELD } from '../config.js';

export function belt({ spawn = [0, 0, 0], density = 1, sizes = null, edge = null, fill = null, clear = [], lanes = [], landmarks = 4, spawnClear = FIELD.spawnClear } = {}) {
  return {
    ...FIELD, spawn, spawnClear, clear, lanes, edge,
    fill: fill ?? (density > 0 ? 1 : 0),
    types: FIELD.types.map((t, i) => ({ ...t, count: Math.round(t.count * density * (sizes?.[i] ?? 1)) })),
    landmarks: { ...FIELD.landmarks, count: landmarks },
  };
}

/* Points along a polyline, for routes and lanes. */
export const lanesOf = (path, r) => path.slice(1).map((b, i) => ({ a: path[i], b, r }));
