/* Slowly varying farm landforms: rounded earth crowns and a narrow wet
   thalweg inside broad, grassy drainage shoulders. No random surface noise
   is added to the walking floor. */
import { smoothstep } from '../util.js';
import { corridorFrame } from './natural.js';

// At an interior vertex, a closest-point query may select either adjoining
// segment. Its one-sided tangent can be exactly collinear with the query,
// so use the vertex's angle bisector to keep asymmetric shoulders on the
// same side throughout the endpoint Voronoi wedge.
export function profileSide(line, closest, x, z) {
  const i = closest.seg, a = line[i], b = line[i + 1];
  let dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1;
  dx /= length; dz /= length;
  const vertex = Math.hypot(closest.px - a[0], closest.pz - a[1]) < 1e-8 ? i
    : Math.hypot(closest.px - b[0], closest.pz - b[1]) < 1e-8 ? i + 1 : -1;
  if (vertex > 0 && vertex < line.length - 1) {
    const p = line[vertex - 1], c = line[vertex], n = line[vertex + 1];
    const incoming = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1;
    const outgoing = Math.hypot(n[0] - c[0], n[1] - c[1]) || 1;
    dx = (c[0] - p[0]) / incoming + (n[0] - c[0]) / outgoing;
    dz = (c[1] - p[1]) / incoming + (n[1] - c[1]) / outgoing;
  }
  return (x - closest.px) * dz - (z - closest.pz) * dx >= 0 ? 1 : -1;
}

export function organicBankProfile(s, run, { height = 0.85, half = 2.4 } = {}) {
  const phase = run * 1.873 + 0.65;
  return {
    height: height * (0.9 + 0.12 * Math.sin(s / 27 + phase) + 0.08 * Math.sin(s / 53 + phase * 1.4)),
    half: half * (1 + 0.16 * Math.sin(s / 37 + phase) + 0.10 * Math.cos(s / 21 + phase * 1.3)),
    skew: 0.24 * Math.sin(s / 31 + phase),
  };
}

export function roundedBankRise(signed, along, run, ends, options) {
  const p = organicBankProfile(along, run, options), q = Math.abs(signed - p.skew) / p.half;
  if (q >= 1) return 0;
  return p.height * (1 - q * q) ** 2 * smoothstep(0, 1.8, ends);
}

export function naturalDrain(line, { depth = 0.95, half = 3, fade = 6 } = {}) {
  const frame = corridorFrame(line), tmp = {};
  const xs = line.map((p) => p[0]), zs = line.map((p) => p[1]), reach = half * 1.4 + 1;
  const box = { x0: Math.min(...xs) - reach, x1: Math.max(...xs) + reach, z0: Math.min(...zs) - reach, z1: Math.max(...zs) + reach };
  const inside = (x, z) => x > box.x0 && x < box.x1 && z > box.z0 && z < box.z1;
  const profile = (s, side) => ({
    half: half * (1 + 0.16 * Math.sin(s / 29 + side * 1.2) + 0.09 * Math.cos(s / 17 + side * 2.2)),
    wetHalf: 0.58 + 0.10 * Math.sin(s / 24 + 0.9),
  });
  function sample(x, z, wet = false) {
    if (!inside(x, z)) return 0;
    frame.nearest(x, z, tmp);
    const ends = smoothstep(0, fade, Math.min(tmp.t, 1 - tmp.t) * frame.length);
    if (!ends) return 0;
    const p = profile(tmp.along, profileSide(line, tmp, x, z)), q = tmp.d / (wet ? p.wetHalf : p.half);
    return q >= 1 ? 0 : (1 - q * q) ** 2 * ends;
  }
  return {
    line, box, frame, profile,
    dist: (x, z) => inside(x, z) ? frame.nearest(x, z, tmp).d : Infinity,
    strength: (x, z) => sample(x, z),
    wet: (x, z) => sample(x, z, true),
    cut: (h, x, z) => h - depth * sample(x, z),
  };
}
