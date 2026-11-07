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

// A Freycinet canal barge scuttled across the canal, resting on the bed with
// its gangways about at quay height: the second way over the water. Origin is
// the gangway deck, bow towards +z. The hold is boarded over; one hatch board
// is broken and the hold is lit by nothing. Hard cover all along: the
// wheelhouse aft, the coaming down the middle, the bulwarks at the sides.
export const SCUTTLED_BARGE = { length: 30, width: 5.05, hull: 4.6 };

export function scuttledBarge() {
  const b = createBuilder('scuttled_barge');
  const { length: L, width: W, hull: D } = SCUTTLED_BARGE;
  const half = L / 2, mid = half - 2.6;
  // the hull: black-tarred sides streaked with rust, a rubbing strake along them
  for (const s of [-1, 1]) {
    b.box('metal_dark', [0.1, D, mid * 2], [s * (W / 2 - 0.05), -D / 2 + 0.22, 0]);
    b.box('rust', [0.16, 0.14, mid * 2 + 0.2], [s * (W / 2 + 0.02), -0.42, 0]);
    b.box('wood_dark', [0.16, 0.16, mid * 2], [s * (W / 2 + 0.02), 0.08, 0]);
    for (let z = -mid + 1.2; z < mid; z += 2.4) b.box('rust', [0.02, D * 0.55, 0.12 + (Math.abs(z * 7) % 3) * 0.05], [s * (W / 2 + 0.005), -D * 0.27 + 0.1, z]);
  }
  // the rounded bow and stern, built up from rings of plates
  for (const end of [-1, 1]) {
    for (let k = 0; k < 7; k++) {
      const a = (k + 0.5) / 7 * Math.PI, x = Math.cos(a) * W / 2, z = end * (mid + Math.sin(a) * 2.6);
      b.box('metal_dark', [W * 0.25, D, 0.1], [x, -D / 2 + 0.22, z], [0, end * (a * 180 / Math.PI - 90), 0]);
    }
    b.box('rust', [W - 0.2, 0.06, 2.4], [0, -0.03, end * (mid + 1.0)]);
  }
  // the gangways each side of the hold, steel plate worn bright in a track
  for (const s of [-1, 1]) b.box('iron', [0.78, 0.06, mid * 2], [s * (W / 2 - 0.5), -0.03, 0]);
  // the hold: its coaming, boarded over with hatch boards on hatch bars
  const hz0 = -mid + 3.8, hz1 = mid - 1.4, hw = W / 2 - 0.9;
  for (const s of [-1, 1]) b.box('rust', [0.08, 0.36, hz1 - hz0], [s * hw, 0.18, (hz0 + hz1) / 2]);
  for (const z of [hz0, hz1]) b.box('rust', [hw * 2, 0.36, 0.08], [0, 0.18, z]);
  for (let z = hz0 + 0.45, i = 0; z < hz1 - 0.2; z += 0.92, i++) {
    if (i === 9) { // a shell went through here: two boards gone and a third split
      b.box('wood_old', [hw * 0.9, 0.06, 0.88], [-hw * 0.48, 0.34, z], [4, 0, -9]);
      b.box('metal_dark', [hw * 0.9, 0.02, 0.88], [hw * 0.5, 0.05, z]);
      continue;
    }
    b.box(i % 5 === 2 ? 'wood_dark' : 'wood_old', [hw * 2 - 0.04, 0.07, 0.88], [0, 0.39 + (i % 3) * 0.006, z], [0, 0, (i % 4 - 1.5) * 0.4]);
  }
  // a tarpaulin dragged half off the boards forward
  b.box('canvas', [hw * 1.4, 0.05, 2.8], [hw * 0.25, 0.45, hz1 - 1.8], [0, 6, 2]);
  // the wheelhouse aft, set to starboard so the port gangway stays open; its glass gone
  const wx = W / 2 - 1.55, wz = -mid - 0.4;
  b.box('paint_green', [2.9, 1.15, 2.6], [wx - 0.3, 0.58, wz]);
  for (const [x, z, w, d] of [[wx - 0.3, wz + 1.25, 2.9, 0.1], [wx - 0.3, wz - 1.25, 2.9, 0.1], [wx - 1.7, wz, 0.1, 2.6], [wx + 1.1, wz, 0.1, 2.6]]) b.box('wood_dark', [w, 0.9, d], [x, 1.6, z]);
  b.box('roof_slate', [3.2, 0.1, 2.9], [wx - 0.3, 2.1, wz], [0, 0, -3]);
  b.box('iron', [0.12, 0.9, 0.12], [wx - 1.2, 2.6, wz - 0.6]);
  // the tiller and rudder post over the stern; a windlass and bitts on the foredeck
  b.rod('iron', [0, 0.05, -half + 0.2], [0, 1.0, -half - 0.4], 0.08);
  b.beam('wood_dark', [0, 1.0, -half - 0.4], [-1.2, 1.15, -half + 1.6], 0.09);
  b.cylinder('iron', 0.28, 1.5, [0, 0.42, mid + 1.1], [0, 0, 90], 12);
  for (const s of [-1, 1]) for (const z of [mid - 0.4, -mid + 0.9]) b.cylinder('iron', 0.13, 0.5, [s * (W / 2 - 0.45), 0.25, z], [0, 0, 0], 10);
  // a coil of rope, an upturned bucket, a boat hook along the bulwark
  b.add('wood_old', new THREE.TorusGeometry(0.32, 0.07, 6, 14).rotateX(Math.PI / 2), [-(W / 2 - 0.55), 0.06, 2.2]);
  b.cylinder('metal_gray', 0.16, 0.28, [-(W / 2 - 0.5), 0.14, -4.5], [0, 0, 0], 10);
  b.beam('wood_old', [W / 2 - 0.2, 0.2, -6], [W / 2 - 0.2, 0.2, -1.2], 0.05);

  // the hull as one walkable block, the gangways' top at y = 0; the hatch boards a step up
  // (a stair height, so the hold walks too); the wheelhouse, a low bulwark either side
  b.collider([0, -D / 2, 0], [W / 2, D / 2, mid + 1.6], 0, null, 'metal');
  b.collider([0, 0.21, (hz0 + hz1) / 2], [hw, 0.21, (hz1 - hz0) / 2], 0, null, 'wood');
  b.collider([wx - 0.3, 1.05, wz], [1.45, 1.05, 1.3], 0, null, 'wood');
  for (const s of [-1, 1]) b.collider([s * (W / 2 + 0.02), 0.08, 0], [0.08, 0.08, mid], 0, null, 'wood');
  b.collider([0, 0.42, mid + 1.1], [0.75, 0.28, 0.28], 0, null, 'metal');
  b.model.extras = { length: L, width: W, deck: 0, front: '+z' };
  return b.done(-D + 0.2);
}

// An anti-glider stake ("Rommel's asparagus"): a rough pine pole driven into
// the marsh, leaning a little, a strand of wire to its neighbours run off its
// top. Only the trunk collides: thin cover, but a mark on a dark field.
export function gliderStake() {
  const b = createBuilder('glider_stake');
  b.add('deadwood', new THREE.CylinderGeometry(0.09, 0.14, 3.6, 7), [0.08, 1.75, 0], [0, 0, -2.5]);
  b.add('deadwood', new THREE.CylinderGeometry(0.04, 0.09, 0.35, 6), [0.16, 3.7, 0], [0, 0, -2.5]);
  b.add('dirt', new THREE.CylinderGeometry(0.34, 0.5, 0.18, 8), [0, 0.04, 0]);
  b.rod('wire', [0.15, 3.3, 0], [0.4, 2.2, 1.6], 0.008, 3);
  b.rod('wire', [0.15, 3.3, 0], [-0.3, 1.9, -1.4], 0.008, 3);
  b.collider([0.08, 1.75, 0], [0.12, 1.75, 0.12], 0, null, 'wood');
  return b.done(0);
}
