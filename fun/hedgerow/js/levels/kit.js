/* Hedgerow — helpers the later missions' level files share (Saint-Clair keeps
   its own copies): lines on the ground and what is put along them, the
   hedgebanks of the bocage, ground bumps and shell craters. */

import { polylineDistance, smoothstep } from '../util.js';
import { roundedBankRise, profileSide } from './landform-banks.js';

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

/* hedgerows on their earth banks. Each run is a line of points [[x, z], ...] (it may bend; a gap is
   where no run is) or a straight [x0, z0, x1, z1]. */
export function hedgeBanks(runs, { height = 0.85, half = 2.4, natural = false } = {}) {
  const lines = runs.map((r) => (typeof r[0] === 'number' ? [[r[0], r[1]], [r[2], r[3]]] : r));
  const boxes = lines.map((l) => bbox(l, half + 1));
  // Preserve dist() reach so the new crown shape cannot reshuffle seeded
  // rough terrain elsewhere in the battlefield.
  const bankBoxes = natural ? lines.map((l) => bbox(l, half * 1.4 + 1)) : boxes;
  const lens = lines.map((l) => l.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0));
  /* the distance to the nearest run (Infinity beyond reach) */
  const dist = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < lines.length; i++) {
      if (!inBox(boxes[i], x, z)) continue;
      polylineDistance(lines[i], x, z, tmp);
      // the bank's ends round off over the last metre and a half
      const cut = Math.min(tmp.t, 1 - tmp.t) * lens[i];
      const d = tmp.d + Math.max(0, 1.5 - cut) * 0.8;
      if (d < best) best = d;
    }
    return best;
  };
  return {
    dist,
    /* the bank's rise at (x, z) */
    rise: (x, z) => {
      if (!natural) { const d = dist(x, z); return d < half ? height * smoothstep(half, half * 0.35, d) : 0; }
      let h = 0;
      for (let i = 0; i < lines.length; i++) {
        if (!inBox(bankBoxes[i], x, z)) continue;
        const line = lines[i]; polylineDistance(line, x, z, tmp);
        h = Math.max(h, roundedBankRise(tmp.d * profileSide(line, tmp, x, z), tmp.t * lens[i], i, Math.min(tmp.t, 1 - tmp.t) * lens[i], { height, half }));
      }
      return h;
    },
    /* hedges along the runs, evenly about every `step` metres, at their height: P(model, x, z, yaw, opts) */
    plant(P, y, step = 4) {
      lines.forEach((l, i) => {
        const n = Math.max(1, Math.round(lens[i] / step));
        let seg = 0, at = 0;
        for (let k = 0; k < n; k++) {
          const s = ((k + 0.5) / n) * lens[i];
          for (;;) {
            const L = Math.hypot(l[seg + 1][0] - l[seg][0], l[seg + 1][1] - l[seg][1]);
            if (s <= at + L || seg === l.length - 2) {
              const f = L > 0 ? (s - at) / L : 0, dx = l[seg + 1][0] - l[seg][0], dz = l[seg + 1][1] - l[seg][1];
              P('hedge', l[seg][0] + dx * f, l[seg][1] + dz * f, Math.atan2(-dz, dx) * 180 / Math.PI + (k % 2 ? 180 : 0), { veg: true, y });
              break;
            }
            at += L; seg++;
          }
        }
      });
    },
  };
}

/* a line split where `keep(x, z)` fails, into the runs either side (hedges cut for gates and roads) */
export function gaps(line, keep) {
  const out = [];
  let run = [];
  for (const p of line) {
    if (keep(p[0], p[1])) run.push(p);
    else { if (run.length > 1) out.push(run); run = []; }
  }
  if (run.length > 1) out.push(run);
  return out;
}

/* a line drawn by z = f(x) from x0 to x1 (either way), a point every `step` metres of x */
export function curve(f, x0, x1, step = 2) {
  const n = Math.max(1, Math.round(Math.abs(x1 - x0) / step)), out = [];
  for (let k = 0; k <= n; k++) { const x = x0 + ((x1 - x0) * k) / n; out.push([x, f(x)]); }
  return out;
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

/* A field drain has a rounded, walkable profile, unlike the steep revetted
   sides of a fighting trench. Cache its bounds and length: ground sampling
   calls this hundreds of thousands of times. The last few metres fade into
   the meadow so both ends can be entered without a step or a hard seam. */
export function fieldDrain(line, { depth = 0.85, half = 2.8, fade = 5 } = {}) {
  const box = bbox(line, half + 1.5);
  const length = line.reduce((n, p, i) => n + (i ? Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) : 0), 0);
  const sample = (x, z) => {
    if (!inBox(box, x, z)) return 0;
    polylineDistance(line, x, z, tmp);
    const ends = smoothstep(0, fade, Math.min(tmp.t, 1 - tmp.t) * length);
    return smoothstep(half, 0.65, tmp.d) * ends;
  };
  return {
    line, box,
    dist: (x, z) => near(line, box, x, z),
    strength: sample,
    cut: (h, x, z) => h - depth * sample(x, z),
  };
}

/* `line` moved `d` metres to its side (+ the left, +x when heading +z), point by point */
export function offset(line, d) {
  return line.map(([x, z], i) => {
    const [ax, az] = line[Math.max(0, i - 1)], [bx, bz] = line[Math.min(line.length - 1, i + 1)];
    const L = Math.hypot(bx - ax, bz - az) || 1;
    return [x + ((bz - az) / L) * d, z - ((bx - ax) / L) * d];
  });
}

/* where a line running along z crosses `z` (x, and its heading [tx, tz]); its ends beyond them */
export function atZ(line, z) {
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    if ((z - az) * (z - bz) > 0 && i < line.length - 2) continue;
    const f = bz !== az ? Math.min(1, Math.max(0, (z - az) / (bz - az))) : 0, L = Math.hypot(bx - ax, bz - az) || 1;
    return { x: ax + (bx - ax) * f, tx: (bx - ax) / L, tz: (bz - az) / L };
  }
  return { x: line[0][0], tx: 0, tz: 1 };
}
