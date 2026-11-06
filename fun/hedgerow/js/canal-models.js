import * as THREE from 'three';
import { createBuilder } from './street-model-kit.js';

// Four metres of stone quay. Origin is the existing 2 m bank datum, front
// faces the water (+z). The submerged backing seals it down to the bed;
// only the upper courses need modeled joints. No external assets.
export function canalQuay() {
  const b = createBuilder('canal_quay');
  b.box('stone_cut_dark', [4, 4.6, 0.47], [0, -2.3, 0]);
  const colors = [0xe7e2d5, 0xd9d5c9, 0xf0eadf, 0xe1decf];
  const waterStain = new THREE.Color(0xa2ad94), white = new THREE.Color(0xffffff);
  function stone(size, at, tint) {
    const g = new THREE.BoxGeometry(...size), p = g.attributes.position, colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + at[0], y = p.getY(i) + at[1];
      const t = Math.max(0, Math.min(1, (y + 2.12) / 0.57));
      const wet = (1 - t * t * (3 - 2 * t)) * (0.9 + 0.1 * Math.sin(x * 2.3 + y * 1.7));
      const c = white.clone().lerp(waterStain, wet * 0.48);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    b.add('stone_cut', g, at, [0, 0, 0], [1, 1, 1], tint); g.dispose();
  }
  for (let row = 0; row < 7; row++) {
    const start = row % 2 ? -2.4 : -2;
    for (let col = 0; col < 6; col++) {
      const lo = Math.max(-2, start + col * 0.8), hi = Math.min(2, start + (col + 1) * 0.8);
      if (hi <= lo) continue;
      stone([hi - lo - 0.014, 0.31, 0.105], [(lo + hi) / 2, -0.1625 - row * 0.325, 0.19], colors[(row * 3 + col) % colors.length]);
    }
  }
  for (const x of [-1, 1]) b.box('stone_cut', [1.988, 0.11, 0.58], [x, 0.025, 0.02], [0, 0, 0], 0xdad7c9);
  b.collider([0, -2.3, 0], [2, 2.3, 0.235], 0, null, 'stone');
  b.collider([0, -1.1375, 0.19], [2, 1.1375, 0.0525], 0, null, 'stone');
  b.collider([0, 0.025, 0.02], [2, 0.055, 0.29], 0, null, 'stone');
  b.model.anchors = { coping: [0, 0.08, 0.02], waterline: [0, -2, 0.245] };
  b.model.extras = { width: 4, bankDatum: 2, waterline: 0, front: '+z' };
  return b.done(-4.6);
}
