/* Meteora — folds: how ships arrive and leave.

   A fold opens as a ring of light that spins up out of nothing, a bright
   membrane inside it; the ship slides out of it nose first, stretched and
   then settling to its shape, and the ring collapses behind it. Leaving,
   the ship burns hard, the ring opens ahead of it, and it is gone. Harrow
   folds burn red; ours, blue-white. The ship's own offset and stretch are
   applied by the entity renderer from `entity.folding`; this module draws
   the portals. */

import * as THREE from 'three';

const SEGMENTS = 28;
const BLUE = { rim: [0.55, 0.78, 1.0], core: [0.85, 0.93, 1.0] };
const RED = { rim: [1.0, 0.32, 0.12], core: [1.0, 0.72, 0.55] };

export const foldGeometry = (entity, length) => {
  // How far behind its final place a ship starts when folding in.
  return Math.max(40, length * 3.5);
};

export function createFolds(glow) {
  const portals = [];
  const q = new THREE.Quaternion(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), c = new THREE.Vector3();
  return {
    open(e) {
      q.set(e.q[0], e.q[1], e.q[2], e.q[3]);
      fwd.set(0, 0, -1).applyQuaternion(q);
      const radius = Math.max(9, e.radius * (e.big ? 0.75 : 1.6));
      let at;
      if (e.type === 'hold') {
        // A fold held open in place (the Long Mercy's drive ring): exactly
        // where it is asked for, as wide as asked, for as long as asked.
        portals.push({ at: [...e.pos], q: q.clone(), radius: e.radius, t: 0, dur: e.dur, dir: 'hold', colours: e.team === 1 ? RED : BLUE, spin: Math.random() * 6 });
        return;
      }
      if (e.type === 'foldIn') {
        at = [e.pos[0] - fwd.x * e.radius * 0.9, e.pos[1] - fwd.y * e.radius * 0.9, e.pos[2] - fwd.z * e.radius * 0.9];
      } else {
        const v = Math.hypot(e.vel?.[0] ?? 0, e.vel?.[1] ?? 0, e.vel?.[2] ?? 0);
        const travel = v * e.dur + 0.5 * (e.big ? 40 : 300) * e.dur * e.dur + e.radius;
        at = [e.pos[0] + fwd.x * travel, e.pos[1] + fwd.y * travel, e.pos[2] + fwd.z * travel];
      }
      portals.push({ at, q: q.clone(), radius, t: 0, dur: e.dur, dir: e.type === 'foldIn' ? 'in' : 'out', colours: e.team === 1 ? RED : BLUE, spin: Math.random() * 6 });
    },
    update(dt) {
      for (let i = portals.length - 1; i >= 0; i--) {
        const P = portals[i];
        P.t += dt;
        const end = P.dur + 0.6;
        if (P.t > end) { portals.splice(i, 1); continue; }
        const u = P.t / P.dur;
        // Open, hold, collapse.
        const open = P.dir === 'hold'
          ? Math.min(1, P.t / 1.2) * (P.t < P.dur ? 1 : Math.max(0, 1 - (P.t - P.dur) / 0.6))
          : P.dir === 'in'
            ? Math.min(1, u / 0.3) * (u < 0.85 ? 1 : Math.max(0, 1 - (P.t - 0.85 * P.dur) / (0.15 * P.dur + 0.6)))
            : Math.min(1, Math.max(0, (u - 0.25) / 0.35)) * (P.t < P.dur ? 1 : Math.max(0, 1 - (P.t - P.dur) / 0.6));
        if (open <= 0.01) continue;
        fwd.set(0, 0, -1).applyQuaternion(P.q);
        right.set(1, 0, 0).applyQuaternion(P.q);
        up.set(0, 1, 0).applyQuaternion(P.q);
        c.set(P.at[0], P.at[1], P.at[2]);
        const R = P.radius * (0.4 + 0.6 * open);
        const spin = P.spin + P.t * 3;
        const rim = P.colours.rim, core = P.colours.core;
        for (let k = 0; k < SEGMENTS; k++) {
          const a = spin + (k / SEGMENTS) * Math.PI * 2;
          const x = Math.cos(a) * R, y = Math.sin(a) * R;
          const tx = -Math.sin(a), ty = Math.cos(a);
          glow.add(c.x + right.x * x + up.x * y, c.y + right.y * x + up.y * y, c.z + right.z * x + up.z * y,
            R * 0.06 + 0.4, rim[0], rim[1], rim[2], 2.6 * open,
            right.x * tx + up.x * ty, right.y * tx + up.y * ty, right.z * tx + up.z * ty, R * 0.35);
        }
        // The membrane: a soft disc and a hot centre (gentler on a held
        // fold, which ships fly straight through).
        const held = P.dir === 'hold' ? 0.45 + 0.1 * Math.sin(P.t * 5) : 1;
        glow.add(c.x, c.y, c.z, R * 0.9, core[0], core[1], core[2], 0.9 * open * held);
        glow.add(c.x, c.y, c.z, R * 0.35, 1, 1, 1, 2.2 * open * held);
      }
    },
    clear() { portals.length = 0; },
    get count() { return portals.length; },
  };
}
