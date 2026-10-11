/* Meteora — contacts between bodies with mass and spin.

   One impulse resolves a contact: along the normal it reverses the closing
   speed times the restitution; along the surface, friction resists the
   slide, but never with more than μ times the normal impulse (Coulomb) and
   never enough to reverse it. Both are applied at the contact point, so a
   ship scraping along a rock is spun by the friction it feels, and a body
   already spinning brings that spin into the contact.

   A ship is a rigid body with a mass and three moments of inertia (from
   radii of gyration about its pitch, yaw and roll axes). Rocks are point
   masses, and a rock fixed in the belt has no inverse mass at all — it
   cannot be moved, only bounced off. */

import { cross, dot, len, qRotate, qRotateInv } from './vec.js';

export const STATIC = Object.freeze({ vel: [0, 0, 0], invMass: 0 });

export function shipBody(ship) {
  const S = ship.stats, m = S.mass;
  return {
    vel: ship.vel, invMass: 1 / m, q: ship.q, w: ship.w,
    invInertia: S.gyration.map(k => 1 / (m * k * k)),
  };
}
export const pointBody = (vel, mass) => ({ vel, invMass: 1 / mass });

const rL = [0, 0, 0], dirL = [0, 0, 0], tmp = [0, 0, 0], wWorld = [0, 0, 0];

// Inverse effective mass of `body` for an impulse along `dir` at arm `r`.
function inverseEffectiveMass(body, r, dir) {
  let k = body.invMass;
  if (!body.invInertia) return k;
  qRotateInv(rL, body.q, r);
  qRotateInv(dirL, body.q, dir);
  cross(tmp, rL, dirL);
  for (let i = 0; i < 3; i++) tmp[i] *= body.invInertia[i];
  cross(tmp, tmp, rL);
  return k + dot(dirL, tmp);
}

function applyImpulse(body, r, J, sign) {
  for (let i = 0; i < 3; i++) body.vel[i] += sign * J[i] * body.invMass;
  if (!body.invInertia) return;
  qRotateInv(rL, body.q, r);
  qRotateInv(dirL, body.q, J);
  cross(tmp, rL, dirL);
  for (let i = 0; i < 3; i++) body.w[i] += sign * tmp[i] * body.invInertia[i];
}

/* Resolve a contact between A and B. `n` points from B to A; `rA` is the
   contact point relative to A's centre (world). Returns the closing speed
   along the normal (0 when the bodies are already separating). */
export function resolveContact(A, B, n, rA, restitution, mu) {
  const vc = [A.vel[0], A.vel[1], A.vel[2]];
  if (A.invInertia) {
    qRotate(wWorld, A.q, A.w);
    const spin = cross([0, 0, 0], wWorld, rA);
    for (let i = 0; i < 3; i++) vc[i] += spin[i];
  }
  for (let i = 0; i < 3; i++) vc[i] -= B.vel[i];
  const vn = dot(vc, n);
  if (vn >= 0) return 0;
  const jn = -(1 + restitution) * vn / (inverseEffectiveMass(A, rA, n) + B.invMass);
  const J = [n[0] * jn, n[1] * jn, n[2] * jn];
  const vt = [vc[0] - n[0] * vn, vc[1] - n[1] * vn, vc[2] - n[2] * vn];
  const slide = len(vt);
  if (slide > 1e-9 && mu > 0) {
    const t = [vt[0] / slide, vt[1] / slide, vt[2] / slide];
    const jt = Math.min(mu * jn, slide / (inverseEffectiveMass(A, rA, t) + B.invMass));
    for (let i = 0; i < 3; i++) J[i] -= t[i] * jt;
  }
  applyImpulse(A, rA, J, 1);
  for (let i = 0; i < 3; i++) B.vel[i] -= J[i] * B.invMass;
  return -vn;
}
