/* Meteora — a rock's shape as a radius in every direction.

   The rocks are lumpy: from the centre their skin lies anywhere between a
   fifth and all of their outer radius. Each of the five rock models is
   measured once (tools/rock-shapes.mjs) into a cube map of radii — six
   faces of SHAPE_N × SHAPE_N cells, sampled at the cell corners, so the
   faces share their edges — and the simulation reads the surface back from
   it, smoothly interpolated, in the rock's own frame.

   The map is stored as one byte per sample between the shape's smallest
   and largest radius, rounded up, so the shape read back is never smaller
   than the rock. */

export const SHAPE_N = 24;
const W = SHAPE_N + 1;

/* The direction of sample (i, j) on face f: faces are +x −x +y −y +z −z;
   on each, u and v run over the other two axes in order. */
export function faceDir(f, i, j) {
  const u = -1 + 2 * i / SHAPE_N, v = -1 + 2 * j / SHAPE_N, s = f % 2 ? -1 : 1, axis = f >> 1;
  const d = axis === 0 ? [s, u, v] : axis === 1 ? [u, s, v] : [u, v, s];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}

/* The surface's distance from the centre along the direction (x, y, z) in
   the rock's frame (need not be unit length), in units of the rock's
   nominal radius. */
export function shapeRadius(map, x, y, z) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let f, u, v, m;
  if (ax >= ay && ax >= az) { m = ax; f = x > 0 ? 0 : 1; u = y; v = z; }
  else if (ay >= az) { m = ay; f = y > 0 ? 2 : 3; u = x; v = z; }
  else { m = az; f = z > 0 ? 4 : 5; u = x; v = y; }
  if (m === 0) return map.max;
  const fu = (u / m + 1) * 0.5 * SHAPE_N, fv = (v / m + 1) * 0.5 * SHAPE_N;
  const i = Math.min(SHAPE_N - 1, Math.max(0, Math.floor(fu))), j = Math.min(SHAPE_N - 1, Math.max(0, Math.floor(fv)));
  const s = fu - i, t = fv - j, r = map.radii, b = (f * W + j) * W + i;
  return (r[b] * (1 - s) + r[b + 1] * s) * (1 - t) + (r[b + W] * (1 - s) + r[b + W + 1] * s) * t;
}

export function encodeShape(radii) {
  let min = Infinity, max = 0;
  for (const r of radii) { min = Math.min(min, r); max = Math.max(max, r); }
  const bytes = new Uint8Array(radii.length);
  for (let k = 0; k < radii.length; k++) bytes[k] = Math.min(255, Math.ceil((radii[k] - min) / (max - min) * 255 - 1e-9));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `${min.toFixed(5)}:${max.toFixed(5)}:${btoa(bin)}`;
}

export function decodeShape(text) {
  const [lo, hi, data] = text.split(':');
  const min = Number(lo), max = Number(hi), bin = atob(data);
  const radii = new Float32Array(bin.length);
  let sum = 0;
  for (let k = 0; k < bin.length; k++) sum += radii[k] = min + bin.charCodeAt(k) / 255 * (max - min);
  // `mean`: the radius of a ball of about the rock's bulk, for the cases
  // where a ball is near enough (fragments knocking into each other).
  return { radii, min, max, mean: sum / bin.length };
}
