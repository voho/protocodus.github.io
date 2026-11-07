/* Selected closed timber attic dormers for older Prague houses.
   The variant retains the complete prepared facade/ambient glazing and
   the original gameplay shell. Additions reuse source materials and fit
   inside the existing total roof bounds; no runtime work or new maps. */
import * as THREE from 'three';
import { createBuilder } from './street-model-kit.js';

function quad(b, key, points, reverse = false, tint = 0xffffff) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  geometry.setIndex(reverse ? [2, 1, 0, 3, 2, 0] : [0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals();
  b.add(key, geometry, [0, 0, 0], [0, 0, 0], [1, 1, 1], tint); geometry.dispose();
}
function gable(b, x, half, eave, crest, z, reverse, tint) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([x - half, eave, z, x + half, eave, z, x, crest, z], 3));
  geometry.setIndex(reverse ? [2, 1, 0] : [0, 1, 2]); geometry.computeVertexNormals();
  b.add('plaster', geometry, [0, 0, 0], [0, 0, 0], [1, 1, 1], tint); geometry.dispose();
}
function shutter(b, x, y, z, width = .68, height = .78) {
  b.box('wood_dark', [width, height, .055], [x, y, z]);
  for (const dx of [-width / 2, width / 2]) b.box('paint_white', [.045, height + .08, .07], [x + dx, y, z + .03], [0, 0, 0], 0x8d8f81);
  for (const dy of [-height / 2, height / 2]) b.box('paint_white', [width + .08, .045, .07], [x, y + dy, z + .03], [0, 0, 0], 0x8d8f81);
  for (let i = 0; i < 5; i++) b.box('wood_dark', [width - .04, .075, .04], [x, y - height * .35 + i * height * .175, z + .038], [12, 0, 0], 0x757a70);
}
function pitchedDormer(b, x, h) {
  const front = 4.0, back = 2.1, half = .65, base = h + .64, eave = h + 1.64, crest = h + 2.12;
  const rearBase = h + 2.65 * (1 - back / 5.25) - .04, tint = 0xc2b494;
  b.box('plaster', [half * 2, eave - base, .10], [x, (base + eave) / 2, front], [0, 0, 0], tint);
  b.box('plaster', [half * 2, Math.max(.04, eave - rearBase), .08], [x, (rearBase + eave) / 2, back], [0, 0, 0], tint);
  for (const side of [-1, 1]) quad(b, 'plaster', [[x + side * half, base, front], [x + side * half, rearBase, back], [x + side * half, eave, back], [x + side * half, eave, front]], side < 0, tint);
  gable(b, x, half, eave, crest, front + .051, false, tint); gable(b, x, half, eave, crest, back - .041, true, tint);
  const run = .75, rise = crest - eave, angle = Math.atan2(rise, run) * 180 / Math.PI;
  for (const side of [-1, 1]) b.box('roof_tile', [Math.hypot(run, rise), .06, 2.12], [x + side * run / 2, eave + rise / 2, (front + back) / 2], [0, 0, -side * angle]);
  b.box('iron', [.07, .05, 2.17], [x, crest + .02, (front + back) / 2]);
  shutter(b, x, base + .52, front + .08);
}
export function addPragueRoofDetails(models) {
  const name = 'prague_old_classical_attic';
  if (models.has(name)) return models;
  const original = models.get('prague_old_classical');
  if (!original) return models;
  const b = createBuilder(name), height = original.extras.wallHeight;
  for (const p of original.prims) b.material(p.key, p.material);
  for (const x of [-3.35, 3.35]) pitchedDormer(b, x, height);
  const detail = b.done(height);
  if (!original.box.containsBox(detail.box)) throw new Error('Attic detail escaped the existing roof bounds');
  models.set(name, { ...original, name, prims: [...original.prims, ...detail.prims], box: original.box.clone() });
  return models;
}
