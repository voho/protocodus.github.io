/* Nebulae: additive puff sprites in three families — a teal drift behind the
   station, an indigo band across the far sky, and one warm pocket out by the
   gate — plus the abyss's own darkness, which is the same trick inverted:
   normal-blend near-black puffs that occlude the stars instead of adding to
   them. That occlusion is what makes the dive in section four feel like
   entering something rather than looking at something. */

import * as THREE from 'three';
import { puffTexture } from './textures.js';
import { WORLD } from './config.js';

export function buildNebula(quality) {
  const group = new THREE.Group();
  const map = puffTexture();
  const spinners = [];

  const put = (families) => {
    for (const f of families) {
      for (let i = 0; i < f.count; i++) {
        const m = new THREE.SpriteMaterial({
          map,
          color: f.colors[i % f.colors.length],
          transparent: true,
          opacity: f.opacity * (0.6 + Math.random() * 0.4),
          blending: f.dark ? THREE.NormalBlending : THREE.AdditiveBlending,
          depthWrite: false,
          rotation: Math.random() * Math.PI * 2,
        });
        const s = new THREE.Sprite(m);
        const a = Math.random() * Math.PI * 2;
        const r = f.radius * (0.35 + Math.random() * 0.65);
        s.position.set(
          f.pos[0] + Math.cos(a) * r,
          f.pos[1] + (Math.random() - 0.5) * f.radius * f.flat,
          f.pos[2] + Math.sin(a) * r,
        );
        s.scale.setScalar(f.size * (0.6 + Math.random() * 0.9));
        group.add(s);
        // Only the near clouds are worth animating; the far band is scenery
        if (f.spin) spinners.push({ s, w: (Math.random() - 0.5) * 0.02 });
      }
    }
  };

  const third = Math.max(6, Math.round(quality.nebula / 3));
  put([
    // The teal drift the station sits in front of
    { pos: [150, 220, -1100], radius: 850, flat: 0.5, size: 680, count: third, opacity: 0.075, colors: [0x0e4d4a, 0x123a5c, 0x0d5c50], spin: true },
    // The indigo band, far and flat, standing in for the galaxy
    { pos: [900, -200, -2400], radius: 1700, flat: 0.22, size: 950, count: third, opacity: 0.065, colors: [0x1a1a4d, 0x2a1a5e, 0x101c4a] },
    // A warm pocket behind the gate — the direction traffic comes from
    { pos: [1500, 250, -1200], radius: 550, flat: 0.6, size: 520, count: Math.max(4, third >> 1), opacity: 0.06, colors: [0x5c3a10, 0x4d2a1a] },
  ]);

  // The abyss: dark matter. Painted last so it sits over the glow families
  // in render order more often than not; depth testing does the rest.
  const ab = WORLD.abyss;
  put([
    { pos: ab.pos, radius: ab.radius * 1.5, flat: 0.9, size: 420, count: third + 6, opacity: 0.88, colors: [0x01030a, 0x02040c, 0x010208], dark: true, spin: true },
  ]);

  return {
    group,
    update(dt) {
      for (const { s, w } of spinners) s.material.rotation += w * dt;
    },
  };
}
