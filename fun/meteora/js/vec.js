/* Meteora — vectors and quaternions on plain arrays.

   The simulation never imports three.js, so the Node checks can run it
   with no DOM and no GPU. Every function writes into its first argument
   and returns it; inputs may alias the output, so `add(a, a, b)` is an
   in-place add. Quaternions are [x, y, z, w].

   The one rule that matters for safety: nothing here divides by a length
   without checking it. A ship at rest, an enemy sitting exactly on the
   player or a missile launched with no relative speed all produce zero
   vectors, and a zero vector must stay zero rather than turn into NaN
   and spread through the whole world in one step. */

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export function set(o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; }
export function copy(o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; }
export function add(o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; }
export function sub(o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; }
export function scale(o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; }
export function addScaled(o, a, b, s) { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; }
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function cross(o, a, b) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  o[0] = x; o[1] = y; o[2] = z; return o;
}
export const lenSq = a => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
export const len = a => Math.sqrt(lenSq(a));
export function distSq(a, b) {
  const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
  return x * x + y * y + z * z;
}
export const dist = (a, b) => Math.sqrt(distSq(a, b));
export function normalize(o, a) {
  const l = len(a);
  if (l < 1e-12) return set(o, 0, 0, 0);
  return scale(o, a, 1 / l);
}
export function lerp(o, a, b, t) {
  o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t;
  return o;
}
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

export const qIdentity = () => [0, 0, 0, 1];
export function qMul(o, a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  o[0] = aw * bx + ax * bw + ay * bz - az * by;
  o[1] = aw * by - ax * bz + ay * bw + az * bx;
  o[2] = aw * bz + ax * by - ay * bx + az * bw;
  o[3] = aw * bw - ax * bx - ay * by - az * bz;
  return o;
}
export function qNormalize(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  if (l < 1e-12) { q[0] = 0; q[1] = 0; q[2] = 0; q[3] = 1; return q; }
  q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
  return q;
}
// v' = q v q*, expanded (t = 2 q.xyz × v; v' = v + w t + q.xyz × t).
export function qRotate(o, q, v) {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const vx = v[0], vy = v[1], vz = v[2];
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  o[0] = vx + qw * tx + qy * tz - qz * ty;
  o[1] = vy + qw * ty + qz * tx - qx * tz;
  o[2] = vz + qw * tz + qx * ty - qy * tx;
  return o;
}
const conj = [0, 0, 0, 1];
export function qRotateInv(o, q, v) {
  conj[0] = -q[0]; conj[1] = -q[1]; conj[2] = -q[2]; conj[3] = q[3];
  return qRotate(o, conj, v);
}
export function qFromAxisAngle(o, axis, angle) {
  const s = Math.sin(angle / 2);
  o[0] = axis[0] * s; o[1] = axis[1] * s; o[2] = axis[2] * s; o[3] = Math.cos(angle / 2);
  return o;
}
/* Body-frame angular velocity: dq/dt = ½ q ⊗ (w, 0). Explicit Euler is
   plenty at 120 Hz; the renormalise each step keeps it on the sphere. */
export function qIntegrate(q, w, dt) {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const wx = w[0], wy = w[1], wz = w[2], h = 0.5 * dt;
  q[0] += h * (qw * wx + qy * wz - qz * wy);
  q[1] += h * (qw * wy + qz * wx - qx * wz);
  q[2] += h * (qw * wz + qx * wy - qy * wx);
  q[3] += h * (-qx * wx - qy * wy - qz * wz);
  return qNormalize(q);
}
export function qSlerp(o, a, b, t) {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let ka = 1 - t, kb = t;
  if (cos < 0.9995) {
    const theta = Math.acos(cos), s = Math.sin(theta);
    ka = Math.sin((1 - t) * theta) / s; kb = Math.sin(t * theta) / s;
  }
  o[0] = a[0] * ka + bx * kb; o[1] = a[1] * ka + by * kb;
  o[2] = a[2] * ka + bz * kb; o[3] = a[3] * ka + bw * kb;
  return qNormalize(o);
}
/* The orientation whose local −Z looks along `forward` with local +Y as
   close to `up` as possible. A degenerate up (parallel to forward) falls
   back to +X so the basis never collapses. */
export function qLookRotation(o, forward, up) {
  const z = normalize([0, 0, 0], scale([0, 0, 0], forward, -1));
  if (lenSq(z) === 0) { o[0] = 0; o[1] = 0; o[2] = 0; o[3] = 1; return o; }
  let x = cross([0, 0, 0], up, z);
  if (lenSq(x) < 1e-12) x = cross(x, Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], z);
  normalize(x, x);
  const y = cross([0, 0, 0], z, x);
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    o[3] = 0.25 / s; o[0] = (m21 - m12) * s; o[1] = (m02 - m20) * s; o[2] = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    o[3] = (m21 - m12) / s; o[0] = 0.25 * s; o[1] = (m01 + m10) / s; o[2] = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    o[3] = (m02 - m20) / s; o[0] = (m01 + m10) / s; o[1] = 0.25 * s; o[2] = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    o[3] = (m10 - m01) / s; o[0] = (m02 + m20) / s; o[1] = (m12 + m21) / s; o[2] = 0.25 * s;
  }
  return qNormalize(o);
}
