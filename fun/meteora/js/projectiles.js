/* Meteora — plasma bolts, missiles and muzzle flashes, drawn as glow.

   A bolt is a short capsule along its velocity: a white core inside a
   coloured halo, cyan-violet for the player and red-orange for enemies, so
   whose fire is whose reads at a glance. The simulation moves bolts eight
   metres a step; each is drawn where it is between steps. */

import { STEP } from './config.js';

const PLAYER_BOLT = [0.45, 0.62, 1.0], ENEMY_BOLT = [1.0, 0.32, 0.1];

export function createProjectiles(glow) {
  const flashes = [];
  return {
    flash(pos, team) {
      flashes.push({ pos, age: 0, team });
    },
    add(weapons, alpha, dt) {
      const back = (1 - alpha) * STEP;
      for (const b of weapons.bolts) {
        const speed = Math.hypot(b.vel[0], b.vel[1], b.vel[2]) || 1;
        const dx = b.vel[0] / speed, dy = b.vel[1] / speed, dz = b.vel[2] / speed;
        const x = b.pos[0] - b.vel[0] * back, y = b.pos[1] - b.vel[1] * back, z = b.pos[2] - b.vel[2] * back;
        const player = b.team === 0;
        const col = player ? PLAYER_BOLT : ENEMY_BOLT;
        const length = player ? 9 : 7;
        glow.add(x, y, z, player ? 0.9 : 0.75, col[0], col[1], col[2], 2.2, dx, dy, dz, length * 1.2);
        glow.add(x, y, z, 0.28, 1, 0.97, 0.92, 5, dx, dy, dz, length);
      }
      for (const m of weapons.missiles) {
        const x = m.pos[0] - m.vel[0] * back, y = m.pos[1] - m.vel[1] * back, z = m.pos[2] - m.vel[2] * back;
        glow.add(x, y, z, 0.5, 0.85, 0.85, 0.9, 0.6);
        if (m.motor) {
          const h = m.heading;
          glow.add(x - h[0] * 1.6, y - h[1] * 1.6, z - h[2] * 1.6, 1.4, 1.0, 0.75, 0.4, 3.5);
          glow.add(x - h[0] * 4, y - h[1] * 4, z - h[2] * 4, 0.8, 1.0, 0.55, 0.2, 2, -h[0], -h[1], -h[2], 6);
        }
      }
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        f.age += dt;
        if (f.age > 0.06) { flashes.splice(i, 1); continue; }
        const k = 1 - f.age / 0.06;
        const col = f.team === 0 ? PLAYER_BOLT : ENEMY_BOLT;
        glow.add(f.pos[0], f.pos[1], f.pos[2], 1.6 + 1.2 * k, col[0], col[1], col[2], 6 * k);
      }
    },
  };
}
