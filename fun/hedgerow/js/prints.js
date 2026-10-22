/* Hedgerow — boot prints in the mud.

   The men who went this way before left their boots in the mud of the
   sunken lane and the forest track: files of prints along each, a pace
   apart, left and right a hand's breadth either side of the line each man
   walked, some going up towards the village and some coming back, every so
   often one missing (trodden over, washed out), one scuffed where a heel
   slid, one with the rain standing in it; only where the ground is mud,
   not on the cobbles, the grass or the leaf litter. Pinned decals
   (atmosphere.js 'boot'), turned along the way each man went, laid on the
   slope of the ground. */

import { rng } from './util.js';

const STRIDE = 0.72;        // m from one foot's print to the other's
const SIZE = 0.34;          // the decal, across (a boot ~29 cm long in it)

/* G: its terrain and decals; lines: the level's (LANE, TRACK). How many were put down. */
export function printBoots(G, lines, { seed = 1944 } = {}) {
  const R = rng(seed), decals = G.decals, terrain = G.terrain;
  // the files: [line, how far across it each man walked (m), which way: 1 up it, -1 back]
  const files = [[lines.LANE, -0.9, 1], [lines.LANE, 0.75, 1], [lines.LANE, 0.1, -1],
    [lines.TRACK, -0.7, 1], [lines.TRACK, 0.85, -1]];
  let n = 0;
  for (const [line, off, way] of files) {
    if (!line) continue;
    let s = R() * STRIDE, foot = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const [x0, z0] = line[i], [x1, z1] = line[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1e-6) continue;
      const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      for (; s < len; s += STRIDE * (0.92 + R() * 0.16)) {
        foot ^= 1;
        if (R() < 0.22) continue;
        // the right foot to the right of the way he went ((-dz, dx) is right of (dx, dz))
        const across = (foot ? 1 : -1) * way * 0.11 + off + (R() - 0.5) * 0.14;
        const x = x0 + dx * s - dz * across, z = z0 + dz * s + dx * across;
        if (terrain.surfaceAt(x, z) !== 'mud') continue;
        const nn = terrain.normal(x, z);
        // the decal's up (its toe) turned onto the way he went: a turn a carries +x to (cos a, -sin a)
        const angle = Math.atan2(-dz * way, dx * way) + (R() - 0.5) * 0.25;
        const r = R(), variant = r < 0.1 ? 2 : r < 0.22 ? 3 : foot;
        if (!decals.pin('boot', x, terrain.height(x, z), z, nn[0], nn[1], nn[2], SIZE, false, R, true, variant, angle)) return n;
        n++;
      }
      s -= len;
    }
  }
  return n;
}
