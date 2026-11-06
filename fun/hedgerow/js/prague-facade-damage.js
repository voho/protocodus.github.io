/* Restrained authored damage for two Prague shopfronts. The masonry wall
   remains solid: these shallow reveals/scars never imply a usable breach. */
import * as THREE from 'three';
import { rng } from './util.js';

export function addPragueFacadeDamage(b) {
  // A patch of blown render exposes the brick pier between the doorway
  // and shop glazing, where the wall really is solid in the base module.
  const outline = [[1.36, 0.78], [1.48, 1.47], [1.42, 2.16], [1.62, 2.73], [1.94, 2.92], [2.38, 2.76], [2.69, 2.21], [2.58, 1.63], [2.75, 0.88], [2.22, 0.67]];
  const shape = new THREE.Shape(); shape.moveTo(...outline[0]); outline.slice(1).forEach((p) => shape.lineTo(...p)); shape.closePath();
  const brick = new THREE.ShapeGeometry(shape); b.add('brick', brick, [0, 0, 5.019]); brick.dispose();
  // Fresh, irregular broken render lips give the reveal a little actual
  // depth without covering the nearby glazing or door stonework.
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], c = outline[(i + 1) % outline.length];
    const dx = c[0] - a[0], dy = c[1] - a[1], len = Math.hypot(dx, dy);
    const mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2;
    const edge = new THREE.Shape(); edge.moveTo(...a); edge.lineTo(...c); edge.lineTo(mx - dy / len * 0.045, my + dx / len * 0.045); edge.closePath();
    const g = new THREE.ExtrudeGeometry(edge, { depth: 0.021, bevelEnabled: false, steps: 1 });
    b.add('marking_white', g, [0, 0, 5.017], [0, 0, 0], [1, 1, 1], 0xb9b09d); g.dispose();
  }
  // Sparse impact scars in the other masonry pier. Keep them away from
  // window panes: a black spot over glass would read as an opaque sticker.
  const R = rng(194505073);
  for (let i = 0; i < 11; i++) {
    const x = R.range(-2.60, -1.58), y = R.range(0.95, 3.13), r = R.range(0.018, 0.032);
    const rim = new THREE.CircleGeometry(r * 1.6, 7), hole = new THREE.CircleGeometry(r * 0.65, 7);
    b.add('marking_white', rim, [x, y, 5.011], [0, 0, R() * 360], [1, 1, 1], 0xaaa08c);
    b.add('burnt', hole, [x, y, 5.014]); rim.dispose(); hole.dispose();
  }
  b.beam('dirt', [1.94, 2.92, 5.014], [1.76, 3.25, 5.014], 0.010, 0.006);
  b.beam('dirt', [1.76, 3.25, 5.014], [1.86, 3.41, 5.014], 0.007, 0.006);
  // Two emergency boards across the damaged display window, above its
  // intact lower shop rail; no invisible new collision is introduced.
  b.box('wood_old', [3.02, 0.17, 0.10], [4.45, 1.24, 5.28], [0, 0, 9], 0xb5b0a2);
  b.box('wood_old', [2.93, 0.15, 0.10], [4.45, 2.22, 5.28], [0, 0, -13], 0xaba99c);
  // Small fallen flakes stay inside the module's existing front footprint.
  for (let i = 0; i < 9; i++) {
    b.box('stone', [R.range(0.07, 0.19), R.range(0.025, 0.055), R.range(0.05, 0.14)], [R.range(1.4, 2.75), 0.025, R.range(5.15, 5.32)], [0, R() * 180, R.range(-7, 7)], 0xc3b7a0);
  }
}
