/* Hedgerow — La Varenne's battery works, built in three.js.

   * `gun_revetment`: the horseshoe of a field gun's emplacement: split
     posts and planks holding back a turfed earth berm, open at the front
     for the barrel and at the back for the crew and the ammunition. It is
     placed on the pit floor; its top stands about half a metre above the
     undisturbed ground, so a crouched man is hidden behind it from either
     side. One box collider per panel keeps the openings walkable. */

import * as THREE from 'three';

const DEG = Math.PI / 180;

export function gunRevetment(builder) {
  const b = builder('gun_revetment');
  const R = 4.4, H = 0.9, BERM = 2.1, PANEL = 15;
  // the barrel's opening is wider than the crew's: the gun traverses
  const open = (a) => Math.abs(a) < 36 || Math.abs(a) > 151;
  for (let a = -180; a < 180; a += PANEL) {
    const mid = a + PANEL / 2;
    if (open(mid)) continue;
    // the panels beside an opening are lower, the earth slumped round their ends
    const end = open(mid - PANEL) || open(mid + PANEL), h = end ? 0.55 : open(mid - 2 * PANEL) || open(mid + 2 * PANEL) ? 0.82 : 1;
    const t = mid * DEG, sx = Math.sin(t), cz = Math.cos(t), w = 2 * R * Math.sin((PANEL / 2) * DEG) + 0.06;
    // planks laid on edge, the rain having opened the joints between them
    for (let k = 0; k < (end ? 3 : 4); k++) {
      const lean = (k * 37 + a) % 5 - 2;
      b.add(k % 2 ? 'wood_old' : 'wood_dark', new THREE.BoxGeometry(w, 0.2, 0.06), [sx * R, 0.11 + k * 0.215, cz * R], [lean * 0.4, mid, lean * 0.3]);
    }
    // the posts that hold them, driven in at the panel joints
    const p = a * DEG;
    b.add('wood_dark', new THREE.CylinderGeometry(0.07, 0.09, H + 0.25, 6), [Math.sin(p) * (R - 0.08), (H + 0.25) / 2 - 0.12, Math.cos(p) * (R - 0.08)], [((a * 13) % 7) - 3, 0, ((a * 7) % 5) - 2]);
    // the earth thrown up behind them, turfed over: a rounded crest falling away outward
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.25); shape.lineTo(0, H + 0.02); shape.lineTo(0.3, H + 0.1); shape.lineTo(0.75, H);
    shape.lineTo(1.35, H * 0.55); shape.lineTo(BERM, -0.25); shape.closePath();
    const berm = new THREE.ExtrudeGeometry(shape, { depth: w + 0.12, bevelEnabled: false, curveSegments: 1 });
    berm.translate(0, 0, -(w + 0.12) / 2).rotateY(-Math.PI / 2);
    b.add('dirt', berm, [sx * (R + 0.04), 0, cz * (R + 0.04)], [0, mid, 0], [1, h, end ? 0.8 : 1]);
    b.add('moss', new THREE.BoxGeometry(w + 0.1, 0.05, 0.7), [sx * (R + 0.42), H * h + 0.06, cz * (R + 0.42)], [-4, mid, 0]);
    b.box([sx * (R + 0.45), H * h / 2, cz * (R + 0.45)], [w / 2, H * h / 2 + 0.05, 0.5], mid, null, 'dirt');
  }
  return b.done(0);
}
