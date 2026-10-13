/* Meteora — bolts, flak, missiles, torpedoes, beams and muzzle flashes,
   drawn as glow.

   A bolt is a short capsule along its velocity: a white core inside a
   coloured halo in its gun's colour — Pulse violet-blue, Needle white,
   Ion green, Breaker orange, the Harrow red — so whose fire is whose reads
   at a glance. A flak shell is a hot ember; a torpedo a bright motor and a
   long trail. The Mother's beam charges as a swelling star at its emitter
   and fires as a column of light that burns where it lands. The simulation
   moves bolts eight metres a step; each is drawn where it is between steps. */

import { STEP } from './config.js';

const PLAYER_BOLT = [0.45, 0.62, 1.0], ENEMY_BOLT = [1.0, 0.32, 0.1];

export function createProjectiles(glow) {
  const flashes = [];
  return {
    flash(pos, team, colour = null, size = 1) {
      flashes.push({ pos, age: 0, team, colour, size });
    },
    add(weapons, alpha, dt, world = null, fx = null) {
      const back = (1 - alpha) * STEP;
      for (const b of weapons.bolts) {
        const speed = Math.hypot(b.vel[0], b.vel[1], b.vel[2]) || 1;
        const dx = b.vel[0] / speed, dy = b.vel[1] / speed, dz = b.vel[2] / speed;
        const x = b.pos[0] - b.vel[0] * back, y = b.pos[1] - b.vel[1] * back, z = b.pos[2] - b.vel[2] * back;
        const w = b.w;
        const col = w?.color ?? (b.team === 0 ? PLAYER_BOLT : ENEMY_BOLT);
        if (w?.flak) {
          glow.add(x, y, z, 1.1, col[0], col[1], col[2], 3);
          glow.add(x, y, z, 0.35, 1, 0.95, 0.85, 4);
          continue;
        }
        const length = w?.length ?? 8, width = w?.width ?? 0.8;
        glow.add(x, y, z, width, col[0], col[1], col[2], 2.2, dx, dy, dz, length * 1.2);
        glow.add(x, y, z, width * 0.32, 1, 0.97, 0.92, 5, dx, dy, dz, length);
      }
      for (const m of weapons.missiles) {
        const x = m.pos[0] - m.vel[0] * back, y = m.pos[1] - m.vel[1] * back, z = m.pos[2] - m.vel[2] * back;
        const torpedo = !!m.p.torpedo, harrow = m.team === 1;
        const s = torpedo ? 2 : 1;
        glow.add(x, y, z, 0.5 * s, 0.85, 0.85, 0.9, 0.6);
        if (m.motor) {
          const h = m.heading;
          const motor = harrow ? [1, 0.35, 0.12] : torpedo ? [0.7, 0.85, 1] : [1, 0.75, 0.4];
          glow.add(x - h[0] * 1.6 * s, y - h[1] * 1.6 * s, z - h[2] * 1.6 * s, 1.4 * s, ...motor, 3.5);
          glow.add(x - h[0] * 4 * s, y - h[1] * 4 * s, z - h[2] * 4 * s, 0.8 * s, motor[0], motor[1] * 0.7, motor[2] * 0.5, 2, -h[0], -h[1], -h[2], 6 * s * (torpedo ? 3 : 1));
        }
        // Torpedoes blink so they can be found and shot.
        if (torpedo && harrow) {
          const on = (m.age % 0.5) < 0.18;
          if (on) glow.add(x, y, z, 2.6, 1, 0.45, 0.1, 2.5);
        }
      }
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        f.age += dt;
        if (f.age > 0.06) { flashes.splice(i, 1); continue; }
        const k = 1 - f.age / 0.06;
        const col = f.colour ?? (f.team === 0 ? PLAYER_BOLT : ENEMY_BOLT);
        glow.add(f.pos[0], f.pos[1], f.pos[2], (1.6 + 1.2 * k) * f.size, col[0], col[1], col[2], 6 * k);
      }
      // Beams.
      if (world) {
        for (const e of world.entities) {
          const b = e.beam;
          if (!b || !e.alive) continue;
          const c = b.w.color;
          if (b.state === 'charge') {
            const k = Math.min(1, b.t / b.w.charge);
            glow.add(b.from[0], b.from[1], b.from[2], 6 + 30 * k, c[0], c[1], c[2], 1 + 5 * k);
            glow.add(b.from[0], b.from[1], b.from[2], 3 + 8 * k, 1, 0.85, 0.7, 2 + 6 * k);
          } else if (b.state === 'fire') {
            const L = Math.hypot(b.to[0] - b.from[0], b.to[1] - b.from[1], b.to[2] - b.from[2]);
            if (L < 1) continue;
            const mx = (b.from[0] + b.to[0]) / 2, my = (b.from[1] + b.to[1]) / 2, mz = (b.from[2] + b.to[2]) / 2;
            const dx = (b.to[0] - b.from[0]) / L, dy = (b.to[1] - b.from[1]) / L, dz = (b.to[2] - b.from[2]) / L;
            const flick = 0.9 + 0.2 * Math.random();
            glow.add(mx, my, mz, b.w.radius * 1.6, c[0], c[1], c[2], 2.5 * flick, dx, dy, dz, L);
            glow.add(mx, my, mz, b.w.radius * 0.45, 1, 0.92, 0.85, 6 * flick, dx, dy, dz, L);
            glow.add(b.from[0], b.from[1], b.from[2], 28, c[0], c[1], c[2], 5 * flick);
            glow.add(b.to[0], b.to[1], b.to[2], 22, 1, 0.6, 0.3, 5 * flick);
            if (fx && Math.random() < dt * 30) fx.beamHit(b.to, [-dx, -dy, -dz], [0, 0, 0]);
          }
        }
      }
    },
  };
}
