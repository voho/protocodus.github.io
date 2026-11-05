/* Hedgerow — helpers the later missions' level files share (Saint-Clair keeps
   its own copies): lines on the ground and what is put along them, the
   hedgebanks of the bocage, ground bumps and shell craters. */

import { polylineDistance, smoothstep } from '../util.js';

/* the bounding box of a line grown by `pad` (distance tests only run near it) */
export function bbox(line, pad) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of line) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad };
}
export const inBox = (b, x, z) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;

const tmp = {};
/* distance to `line` when (x, z) is inside its padded box `box`, else Infinity */
export function near(line, box, x, z) {
  if (!inBox(box, x, z)) return Infinity;
  return polylineDistance(line, x, z, tmp).d;
}

/* walk a polyline placing things every `step` metres at a lateral offset (+ is the left, +x side
   when heading +z): fn(x, z, yawDeg, tx, tz) */
export function along(line, step, offset, fn, from = -Infinity, to = Infinity) {
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L;
    for (let s = 0; s < L; s += 0.25) {
      acc += 0.25;
      if (acc < step) continue;
      acc = 0;
      const x = ax + tx * s, z = az + tz * s;
      if (z < from || z > to) continue;
      fn(x + tz * offset, z - tx * offset, Math.atan2(-tz, tx) * 180 / Math.PI, tx, tz);
    }
  }
}

/* a hedgerow on its earth bank: straight runs [x0, z0, x1, z1] (a gap is where no run is) */
export function hedgeBanks(runs, { height = 0.85, half = 2.4 } = {}) {
  const boxes = runs.map(([x0, z0, x1, z1]) => ({ x0: Math.min(x0, x1) - half - 1, x1: Math.max(x0, x1) + half + 1, z0: Math.min(z0, z1) - half - 1, z1: Math.max(z0, z1) + half + 1 }));
  /* the distance to the nearest run (Infinity beyond reach) */
  const dist = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < runs.length; i++) {
      if (!inBox(boxes[i], x, z)) continue;
      const [ax, az, bx, bz] = runs[i];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - ax) * dx + (z - az) * dz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      // the bank's ends round off over the last metre and a half
      const along = Math.sqrt(L2), cut = Math.min(t * along, (1 - t) * along);
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t) + Math.max(0, 1.5 - cut) * 0.8;
      if (d < best) best = d;
    }
    return best;
  };
  return {
    dist,
    /* the bank's rise at (x, z) */
    rise: (x, z) => { const d = dist(x, z); return d < half ? height * smoothstep(half, half * 0.35, d) : 0; },
    /* hedges along the runs, every `step` metres, at their height: P(model, x, z, yaw, opts) */
    plant(P, y, step = 4) {
      for (const [x0, z0, x1, z1] of runs) {
        const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / step));
        const yaw = Math.atan2(-(z1 - z0), x1 - x0) * 180 / Math.PI;
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          P('hedge', x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, yaw + (k % 2 ? 180 : 0), { veg: true, y });
        }
      }
    },
  };
}

/* mounds, clods and shell craters, looked up on a grid (`allowed(x, z)`: 1 where the ground may be
   rough). Returns {height(x, z), craters}. */
export function roughGround(R, { mounds = 600, craters = 40, area, craterArea = area, allowed }) {
  const CELL = 10, grid = new Map(), list = [];
  const add = (b) => {
    const r = b.r + 2;
    for (let i = Math.floor((b.x - r) / CELL); i <= Math.floor((b.x + r) / CELL); i++)
      for (let j = Math.floor((b.z - r) / CELL); j <= Math.floor((b.z + r) / CELL); j++) {
        const k = i + ',' + j;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(b);
      }
  };
  for (let n = 0; n < mounds; n++) {
    const x = R.range(area.x0, area.x1), z = R.range(area.z0, area.z1), r = R.range(0.8, 2.6);
    if (allowed(x, z) < 1) continue;
    add({ x, z, r, h: R.range(0.12, 0.4) * (r / 2), crater: false });
  }
  for (let n = 0; n < craters; n++) {
    const x = R.range(craterArea.x0, craterArea.x1), z = R.range(craterArea.z0, craterArea.z1);
    if (allowed(x, z) < 1) continue;
    const r = R.range(1.6, 3.4);
    const c = { x, z, r, h: R.range(0.5, 1.0) * r * 0.35, crater: true };
    add(c);
    list.push(c);
  }
  const height = (x, z) => {
    const cell = grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
    if (!cell) return 0;
    let h = 0;
    for (const b of cell) {
      const d = Math.hypot(x - b.x, z - b.z) / b.r;
      if (d > 1.6) continue;
      if (b.crater) h += -b.h * smoothstep(1.0, 0.0, d) * smoothstep(0.0, 0.2, 1 - d * 0.2) + b.h * 0.45 * smoothstep(0.75, 1.05, d) * smoothstep(1.6, 1.05, d);
      else { const t = Math.max(0, 1 - d * d); h += b.h * t * t; }
    }
    return h;
  };
  return { height, craters: list };
}

/* a trench cut along `line`: a flat floor `depth` under its lip (lip(x, z): the undisturbed ground),
   steep sides, a low parapet. Applied to the ground height h at (x, z). */
export function cutTrench(line, box, lip, depth, h, x, z) {
  if (!inBox(box, x, z)) return h;
  polylineDistance(line, x, z, tmp);
  if (tmp.d >= 2.2) return h;
  const top = lip(tmp.px, tmp.pz);
  const floor = top - depth;
  const lerpT = smoothstep(1.15, 0.8, tmp.d);
  const up = Math.max(h, top + 0.15 * smoothstep(2.2, 1.3, tmp.d));
  return up + (floor - up) * lerpT;
}
