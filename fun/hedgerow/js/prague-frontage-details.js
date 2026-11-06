/* Authored prewar Prague façades: older three-storey classical houses,
   four-storey late nineteenth-century tenements and six-storey interwar infill.
   All use the same fourteen-by-ten-metre ground footprint; true floor counts,
   glazing, upper volumes and closed roof ends change with each period. */
import * as THREE from 'three';
import { createBuilder } from './street-model-kit.js';
import { pragueTrimMaterial } from './prague-surfaces.js';

function framedWindow(b, x, y, z, { width = 1.55, height = 2.08, back = false, classical = false, modern = false } = {}) {
  const side = back ? -1 : 1, front = z + side * 0.12;
  // The dark recess sits in front of the solid masonry shell. Narrow
  // frames, reflected glazing and separate sills give real shallow depth.
  b.box('wood_dark', [width + 0.12, height + 0.12, 0.08], [x, y, z + side * 0.04]);
  b.box('glass', [width, height, 0.035], [x, y, front], [0, 0, 0], modern ? 0x9faeae : 0x84918b);
  const frameKey = modern ? 'metal_dark' : 'paint_white', frame = modern ? 0.045 : 0.065;
  const tint = modern ? 0xb5b9b5 : 0xb9b6a6;
  for (const dx of [-width / 2, width / 2]) b.box(frameKey, [frame, height + frame, 0.075], [x + dx, y, front + side * 0.04], [0, 0, 0], tint);
  for (const dy of [-height / 2, height / 2]) b.box(frameKey, [width + frame, frame, 0.075], [x, y + dy, front + side * 0.04], [0, 0, 0], tint);
  for (const dx of modern ? [-width / 6, width / 6] : [0]) b.box(frameKey, [frame, height, 0.075], [x + dx, y, front + side * 0.04], [0, 0, 0], tint);
  if (!modern) b.box(frameKey, [width, frame, 0.075], [x, y + height * 0.08, front + side * 0.04], [0, 0, 0], tint);
  b.box('stone', [width + (modern ? 0.16 : 0.36), modern ? 0.09 : 0.14, modern ? 0.22 : 0.34], [x, y - height / 2 - 0.09, z + side * 0.13], [0, 0, 0], 0xbfbba9);
  if (!modern) b.box('stone', [width + 0.30, 0.12, classical ? 0.28 : 0.19], [x, y + height / 2 + 0.14, z + side * 0.09], [0, 0, 0], 0xc4bdab);
  if (classical && !back) {
    // Modest segmental window hoods belong to the older three-bay house.
    const r = width / 2 + 0.16;
    for (let k = 0; k < 7; k++) {
      const a = Math.PI * k / 7, c = Math.PI * (k + 1) / 7;
      b.beam('stone', [x + Math.cos(a) * r, y + height / 2 + 0.19 + Math.sin(a) * 0.30, z + 0.14],
        [x + Math.cos(c) * r, y + height / 2 + 0.19 + Math.sin(c) * 0.30, z + 0.14], 0.09, 0.20, 0xc4bdab);
    }
  }
}

function periodRoof(b, height, { material = 'roof_slate', rise = 2.2, tint = 0xb9ad95 } = {}) {
  const run = 5.25, angle = Math.atan2(rise, run) * 180 / Math.PI, length = Math.hypot(rise, run);
  for (const side of [-1, 1]) b.box(material, [14.25, 0.15, length], [0, height + rise / 2, side * run / 2], [side * angle, 0, 0]);
  b.box('iron', [14.3, 0.10, 0.15], [0, height + rise + 0.04, 0]);
  // End gables close the actual roof volume. Different-height neighbours
  // expose these side faces, so they cannot remain open black triangles.
  for (const side of [-1, 1]) {
    const p = new Float32Array([side * 7, height, -5.0, side * 7, height + rise - 0.04, 0, side * 7, height, 5.0]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setIndex(side > 0 ? [0, 1, 2] : [2, 1, 0]); g.computeVertexNormals();
    b.add('plaster', g, [0, 0, 0], [0, 0, 0], [1, 1, 1], tint); g.dispose();
  }
  for (const x of [-4.7, 4.3]) {
    b.box('brick', [0.71, 1.58, 0.76], [x, height + 1.87, -1.45]);
    b.box('stone', [0.88, 0.13, 0.93], [x, height + 2.68, -1.45], [0, 0, 0], 0xa7a28e);
  }
}

function flatRoof(b, height) {
  b.box('metal_dark', [13.8, 0.14, 9.8], [0, height + 0.035, 0]);
  for (const z of [-4.90, 4.90]) {
    b.box('plaster', [14, 0.52, 0.20], [0, height + 0.26, z], [0, 0, 0], 0xe3e1d5);
    b.box('stone', [14.12, 0.075, 0.32], [0, height + 0.55, z], [0, 0, 0], 0xb9b9af);
    b.collider([0, height + 0.26, z], [7, 0.26, 0.10], 0, undefined, 'stone');
  }
  for (const x of [-6.90, 6.90]) {
    b.box('plaster', [0.20, 0.52, 9.60], [x, height + 0.26, 0], [0, 0, 0], 0xe3e1d5);
    b.box('stone', [0.32, 0.075, 9.64], [x, height + 0.55, 0], [0, 0, 0], 0xb9b9af);
    b.collider([x, height + 0.26, 0], [0.10, 0.26, 4.80], 0, undefined, 'stone');
  }
  b.box('brick', [0.63, 1.11, 0.66], [-4.3, height + 0.56, -2.0]);
  b.box('stone', [0.79, 0.10, 0.82], [-4.3, height + 1.14, -2.0], [0, 0, 0], 0xb9b9af);
}

function shopBoard(b, text, at, { width = 3.45, background = '#3d3830' } = {}) {
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 112;
  const ctx = canvas.getContext('2d'); let texture;
  if (ctx.fillText) {
    ctx.fillStyle = background; ctx.fillRect(0, 0, 640, 112);
    ctx.fillStyle = '#d6cdb7'; ctx.font = 'bold 48px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 320, 58, 600); texture = new THREE.CanvasTexture(canvas);
  } else { texture = new THREE.DataTexture(new Uint8Array([58, 52, 43, 255]), 1, 1); texture.needsUpdate = true; }
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  const key = `period-shop-${text}`;
  b.material(key, new THREE.MeshStandardMaterial({ name: key, map: texture, roughness: 0.86 }));
  const g = new THREE.PlaneGeometry(width, 0.54); g.userData.keepUV = true; b.add(key, g, at); g.dispose();
}

function periodShop(b, { modern, text, older }) {
  const trim = modern ? 'metal_dark' : 'wood_dark', width = modern ? 3.9 : older ? 2.5 : 3.15;
  b.box('stone', [14.03, modern ? 0.36 : 0.60, 0.12], [0, modern ? 0.18 : 0.30, 5.04], [0, 0, 0], 0x9a998d);
  for (const x of [-4.45, 4.45]) {
    b.box(trim, [width + 0.20, 2.38, 0.14], [x, 1.70, 5.09]);
    b.box('glass', [width, 2.10, 0.035], [x, 1.74, 5.18], [0, 0, 0], modern ? 0x9daaa8 : 0x758079);
    for (const dx of [-width / 2, width / 2, ...(modern ? [-width / 6, width / 6] : [0])]) b.box(trim, [modern ? 0.055 : 0.075, 2.17, 0.09], [x + dx, 1.74, 5.23]);
    b.box(trim, [width + 0.1, 0.12, 0.10], [x, 0.65, 5.23]);
  }
  b.box('stone', [2.38, 3.18, 0.16], [0, 1.59, 5.07], [0, 0, 0], 0xbab39f);
  b.box(trim, [1.81, 2.82, 0.12], [0, 1.43, 5.19]);
  for (const side of [-1, 1]) {
    b.box(older ? 'wood_old' : trim, [0.80, 2.60, 0.09], [side * 0.44, 1.40, 5.29], [0, 0, 0], older ? 0xb0a48e : 0xc3c3b7);
    b.box('glass', [0.59, 1.03, 0.025], [side * 0.44, 2.04, 5.35], [0, 0, 0], 0x8b9995);
    b.rod('iron', [side * 0.16, 1.21, 5.39], [side * 0.16, 1.43, 5.39], 0.016, 5);
  }
  if (modern) b.box('stone', [2.85, 0.13, 1.03], [0, 3.12, 5.47], [0, 0, 0], 0xb9b9af);
  shopBoard(b, text, [4.45, 3.13, 5.26], { width: modern ? 3.80 : 3.45, background: older ? '#503d2d' : modern ? '#314344' : '#3b453c' });
}

function periodFacade(name, { height, floors, storey, firstWindow, bays, tint, older = false, modern = false, shop }) {
  const b = createBuilder(name); b.material('stone', pragueTrimMaterial());
  b.box('plaster', [14, height, 10], [0, height / 2, 0], [0, 0, 0], tint);
  b.collider([0, height / 2, 0], [7, height / 2, 5], 0, undefined, 'stone');
  periodShop(b, { modern, text: shop, older });
  for (let floor = 0; floor < floors - 1; floor++) {
    const y = firstWindow + floor * storey;
    for (const x of bays) {
      framedWindow(b, x, y, 5.035, { width: modern ? 3.34 : older ? 1.70 : 1.48, height: modern ? 1.69 : 2.11, modern, classical: older });
      framedWindow(b, x, y, -5.035, { width: modern ? 3.34 : older ? 1.70 : 1.48, height: modern ? 1.69 : 2.11, modern, back: true });
    }
    if (!modern && floor < floors - 2) b.box('stone', [14.08, 0.105, 0.19], [0, y - 1.48, 5.08], [0, 0, 0], 0xb7b29f);
  }
  if (modern) {
    // Three broad window groups and a plain parapet distinguish a modest
    // interwar infill house from the older vertical window/cornice grid.
    for (const y of [3.58, height - 0.16]) b.box('stone', [14.08, 0.12, 0.25], [0, y, 5.07], [0, 0, 0], 0xb9b9af);
    flatRoof(b, height);
  } else {
    for (const x of older ? [-6.75, 6.75] : [-6.75, 0, 6.75]) {
      b.box('stone', [older ? 0.43 : 0.25, height - 3.65, 0.15], [x, (height + 3.65) / 2, 5.09], [0, 0, 0], older ? 0xc6bba4 : 0xb7b7a7);
    }
    for (const y of [3.54, height - 0.21, height]) {
      for (const side of [-1, 1]) b.box('stone', [14.28, 0.15, 0.40], [0, y, side * 5.07], [0, 0, 0], older ? 0xc6bba4 : 0xb7b7a7);
    }
    periodRoof(b, height, { material: older ? 'roof_tile' : 'roof_slate', rise: older ? 2.65 : 2.15, tint });
    if (!older) {
      // A shallow shared balcony belongs to this four-storey house, rather
      // than appearing on every fifth-floor frontage along the street.
      b.box('stone', [5.32, 0.17, 0.89], [0, 4.02, 5.40], [0, 0, 0], 0xb7b7a7);
      for (let x = -2.5; x <= 2.5; x += 0.28) b.rod('iron', [x, 4.13, 5.81], [x, 5.00, 5.81], 0.019, 5);
      b.rod('iron', [-2.63, 5.01, 5.81], [2.63, 5.01, 5.81], 0.03, 6);
      for (const x of [-2.63, 2.63]) b.rod('iron', [x, 5.01, 5.09], [x, 5.01, 5.81], 0.025, 6);
    }
  }
  for (const x of [-6.65, 6.65]) b.rod('iron', [x, 0.18, 5.25], [x, height - 0.18, 5.25], 0.04, 7);
  b.model.extras = { period: older ? 'Fictional older classical Prague house, retained in 1945' : modern ? 'Fictional modest Prague interwar infill, built before 1939' : 'Fictional late nineteenth-century Prague rental house',
    floors, windowBays: bays.length, wallHeight: height, roofStyle: modern ? 'flat-parapet' : older ? 'red-pitched' : 'slate-pitched' };
  return b.done();
}

export function praguePeriodFrontages() {
  return [
    periodFacade('prague_old_classical', { height: 11.45, floors: 3, storey: 3.40, firstWindow: 5.20,
      bays: [-4.45, 0, 4.45], tint: 0xe2c38d, older: true, shop: 'HOSTINEC' }),
    periodFacade('prague_classical_sage', { height: 13.85, floors: 4, storey: 3.15, firstWindow: 5.20,
      bays: [-5.25, -1.75, 1.75, 5.25], tint: 0xc4ceb7, shop: 'ŘEZNICTVÍ' }),
    periodFacade('prague_interwar', { height: 19.40, floors: 6, storey: 3.0, firstWindow: 5.40,
      bays: [-4.60, 0, 4.60], tint: 0xf0eee1, modern: true, shop: 'DROGERIE' }),
  ];
}
