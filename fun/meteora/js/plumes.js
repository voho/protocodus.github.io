/* Meteora — engine glow and fire.

   The flame follows the ship's speed: a faint blue glow in the nozzle at a
   standstill, a long blue-white plume at cruise, and — once the ship is
   really moving — orange tongues of fire licking off the end of it. Thrust
   on top of that makes it flare while the ship is accelerating, and the
   afterburner turns it white-hot, nearly doubles its length and lights a
   row of shock diamonds along the core.

   Every plume is drawn as a chain of glow sprites from the nozzle along the
   exhaust direction, plus one stretched streak through them for a
   continuous core. That reads from every angle: from the side it is a
   tapered flame, from the chase camera behind it, a bright stacked disc. */

import * as THREE from 'three';
import { ANCHORS } from './anchors.js';
import { qRotateInv } from './vec.js';

const STYLE = {
  fighter: {
    nozzle: 0.5,
    core: [0.75, 0.86, 1.0], sheath: [0.32, 0.5, 1.0], fire: [1.0, 0.5, 0.16], boost: [1.0, 0.92, 0.8],
  },
  interceptor: {
    nozzle: 0.72,
    core: [1.0, 0.86, 0.7], sheath: [1.0, 0.32, 0.08], fire: [1.0, 0.45, 0.1], boost: [1.0, 0.95, 0.85],
  },
};
const CHAIN = 14, FIRE = 9;

const fract = x => x - Math.floor(x);
const hash = (a, b) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function createPlumes(glow) {
  const eased = new Map();   // entity id → { power, boost }
  const p = new THREE.Vector3(), d = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
  const local = [0, 0, 0];

  return {
    forget(id) { eased.delete(id); },
    // `object` carries the interpolated pose the ship is drawn at.
    add(entity, object, time, dt) {
      const ship = entity.ship, style = STYLE[entity.kind];
      qRotateInv(local, ship.q, ship.vel);
      const speed = Math.max(0, -local[2]) / ship.stats.fa.forwardSpeed;
      const target = Math.min(1.4, 0.06 + 0.72 * Math.min(speed, 1.3) + 0.3 * Math.min(ship.thrust, 1));
      let e = eased.get(entity.id);
      if (!e) eased.set(entity.id, e = { power: target, boost: 0 });
      e.power += (target - e.power) * (1 - Math.exp(-dt * 8));
      e.boost += ((ship.afterburner ? 1 : 0) - e.boost) * (1 - Math.exp(-dt * 6));
      const power = e.power, boost = e.boost;
      const r0 = style.nozzle;
      const length = r0 * (1.5 + 15 * power) * (1 + 1.1 * boost);
      const fireAmount = Math.max(0, Math.min(1, (power - 0.45) / 0.6)) * (1 - 0.5 * boost);

      for (const nozzle of ANCHORS[entity.kind].nozzles) {
        p.set(nozzle.pos[0], nozzle.pos[1], nozzle.pos[2]).applyQuaternion(object.quaternion).add(object.position);
        d.set(nozzle.dir[0], nozzle.dir[1], nozzle.dir[2]).applyQuaternion(object.quaternion);
        side.set(1, 0, 0).applyQuaternion(object.quaternion);
        up.set(0, 1, 0).applyQuaternion(object.quaternion);
        const seed = nozzle.pos[0] * 13.1 + entity.id;
        const flick = 0.85 + 0.3 * hash(seed, Math.floor(time * 60));

        // The glowing throat, visible even at a standstill.
        const throat = mix3(style.core, style.boost, boost);
        glow.add(p.x, p.y, p.z, r0 * (1.3 + 0.9 * power), throat[0], throat[1], throat[2], (0.5 + 2.4 * power + 2 * boost) * flick);

        // Continuous core streak.
        const mid = length * 0.42;
        glow.add(p.x + d.x * mid, p.y + d.y * mid, p.z + d.z * mid, r0 * (0.55 + 0.25 * boost),
          ...mix3(style.sheath, style.boost, 0.35 + 0.5 * boost), (0.6 + 1.6 * power + 1.5 * boost) * flick,
          d.x, d.y, d.z, length * 0.84);

        // The plume itself, hottest and narrowest at the nozzle.
        for (let i = 0; i < CHAIN; i++) {
          const t = i / (CHAIN - 1);
          const at = length * Math.pow(t, 1.15);
          const jitter = 0.85 + 0.3 * hash(seed + i, Math.floor(time * 45));
          const diamond = 1 + boost * 0.9 * Math.pow(Math.max(0, Math.cos(t * Math.PI * 9)), 6) * (1 - t);
          const tail = mix3(style.sheath, style.fire, fireAmount * t);
          const col = mix3(mix3(style.core, tail, Math.min(1, t * 2.2)), style.boost, boost * (1 - t) * 0.8);
          const size = r0 * (0.75 + 1.1 * t + 0.6 * boost * t) * jitter;
          const intensity = power * Math.pow(1 - t, 1.5) * (1.4 + 2.2 * boost) * diamond * jitter;
          glow.add(p.x + d.x * at, p.y + d.y * at, p.z + d.z * at, size, col[0], col[1], col[2], intensity);
        }

        // Tongues of fire at speed: flickering, wandering off the axis.
        if (fireAmount > 0.01) {
          for (let k = 0; k < FIRE; k++) {
            const life = fract(time * (2.2 + hash(seed, k) * 1.5) + hash(k, seed));
            const at = length * (0.35 + 0.75 * life);
            const swing = r0 * (0.4 + 1.6 * life);
            const a = hash(seed * 3 + k, Math.floor(time * 30)) * Math.PI * 2;
            const ox = Math.cos(a) * swing, oy = Math.sin(a) * swing;
            const col = mix3(style.fire, [1.0, 0.82, 0.4], 1 - life);
            glow.add(
              p.x + d.x * at + side.x * ox + up.x * oy,
              p.y + d.y * at + side.y * ox + up.y * oy,
              p.z + d.z * at + side.z * ox + up.z * oy,
              r0 * (0.8 + 1.4 * life), col[0], col[1], col[2], fireAmount * 1.6 * (1 - life) * flick);
          }
        }
      }
      return { power, boost };
    },
  };
}
