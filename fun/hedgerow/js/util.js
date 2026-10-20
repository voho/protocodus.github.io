/* Hedgerow — small shared helpers: seeded randomness, noise, geometry. */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
export const dampAngle = (a, b, rate, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));
export const DEG = Math.PI / 180;

/* mulberry32 */
export function rng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + (b - a) * next();
  next.int = (a, b) => Math.floor(a + (b - a + 1) * next());
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.sign = () => (next() < 0.5 ? -1 : 1);
  return next;
}

/* 2D value noise + fbm (deterministic, hash based). */
function hash2(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}
export function fbm2(x, y, octaves = 4, lac = 2.03, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x, y) * amp;
    norm += amp;
    amp *= gain;
    x *= lac; y *= lac;
    x += 17.3; y -= 9.1;
  }
  return sum / norm;
}

/* Distance from point to a polyline [[x, z], ...]; returns {d, t (0..1 along
   the whole line), seg, px, pz (closest point)}. */
export function polylineDistance(points, x, z, out = {}) {
  let best = Infinity, bestT = 0, bestSeg = 0, bx = 0, bz = 0;
  let acc = 0;
  const lens = points._lens || (points._lens = segmentLengths(points));
  const total = lens.total;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i];
    const [cx, cz] = points[i + 1];
    const dx = cx - ax, dz = cz - az;
    const L2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - ax) * dx + (z - az) * dz) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d; bestSeg = i; bx = px; bz = pz;
      bestT = (acc + lens[i] * t) / total;
    }
    acc += lens[i];
  }
  out.d = best; out.t = bestT; out.seg = bestSeg; out.px = bx; out.pz = bz;
  return out;
}

function segmentLengths(points) {
  const lens = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const l = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    lens.push(l);
    total += l;
  }
  lens.total = total || 1;
  return lens;
}

/* Catmull-Rom resample of a polyline into roughly `step`-metre pieces. */
export function smoothPolyline(points, step = 2) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(n - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) {
      const t = j / k, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[n - 1].slice());
  return out;
}

export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/* Signed distance to an oriented rectangle (centre cx,cz, half sizes hx,hz,
   yaw). Negative inside. */
export function rectDistance(x, z, cx, cz, hx, hz, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const dx = x - cx, dz = z - cz;
  // three.js yaw: local = R(-yaw) * world, R(y) maps (0,0,1) to (sin y, 0, cos y)
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const qx = Math.abs(lx) - hx, qz = Math.abs(lz) - hz;
  const ox = Math.max(qx, 0), oz = Math.max(qz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0);
}

export function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
