/* Meteora — a mission's piece of the belt.

   Every mission flies through the same seeded belt generator with its own
   seed, density and clearings: spheres kept free of rock around stations
   and capital ships, lanes along convoy routes. Each mission builds its
   config once, at load, so the generated belt is cached per mission. */

import { FIELD } from '../config.js';

export function belt({ spawn = [0, 0, 0], density = 1, clear = [], lanes = [], landmarks = 4, spawnClear = FIELD.spawnClear } = {}) {
  return {
    ...FIELD, spawn, spawnClear, clear, lanes,
    types: FIELD.types.map(t => ({ ...t, count: Math.round(t.count * density) })),
    landmarks: { ...FIELD.landmarks, count: landmarks },
  };
}

/* Points along a polyline, for routes and lanes. */
export const lanesOf = (path, r) => path.slice(1).map((b, i) => ({ a: path[i], b, r }));
