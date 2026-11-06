/* A few authored variations for the fictional Prague tenement street.
   The original frontage geometry and all gameplay collision are shared.
   New pieces are attached above head height: a restrained stucco gable,
   two small slate dormers, or a grocer's retractable canvas shop canopy.
   These are local +z façades in metres, not a general clutter scatter. */
import * as THREE from 'three';
import { createBuilder } from './street-model-kit.js';
import { pragueTrimMaterial } from './prague-surfaces.js';

const SIGNS = new Map();
function grocerySign() {
  if (SIGNS.has('grocery')) return SIGNS.get('grocery');
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 224;
  const ctx = canvas.getContext('2d'); let texture;
  if (ctx.fillText) {
    ctx.fillStyle = '#304239'; ctx.fillRect(0, 0, 512, 224);
    ctx.strokeStyle = '#b5ac91'; ctx.lineWidth = 5; ctx.strokeRect(12, 12, 488, 200);
    ctx.fillStyle = '#d7cfb6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 52px Georgia, serif'; ctx.fillText('POTRAVINY', 256, 114, 450);
    texture = new THREE.CanvasTexture(canvas);
  } else {
    texture = new THREE.DataTexture(new Uint8Array([48, 66, 57, 255]), 1, 1); texture.needsUpdate = true;
  }
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ name: 'prague-grocer-enamel', map: texture, roughness: 0.65, metalness: 0.08 });
  SIGNS.set('grocery', material); return material;
}

function polygon(b, key, points, at, depth = 0.12, tint = 0xffffff) {
  const shape = new THREE.Shape(); shape.moveTo(...points[0]);
  for (const p of points.slice(1)) shape.lineTo(...p);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
  b.add(key, geometry, at, [0, 0, 0], [1, 1, 1], tint); geometry.dispose();
}

function pediment(b) {
  const y = 17.2;
  // A narrow, late nineteenth-century centre gable grows from the actual
  // cornice. The roof behind remains intact; the street-facing oculus is
  // a dark glazed recess, never an implied gameplay opening.
  polygon(b, 'plaster', [[-2.80, 0.08], [2.80, 0.08], [0, 2.65]], [0, y, 5.035], 0.24, 0xf0dcba);
  for (const x of [-1, 1]) b.beam('stone', [x * 2.87, y + 0.10, 5.34], [0, y + 2.75, 5.34], 0.14, 0.30, 0xc8c1ae);
  b.box('stone', [5.94, 0.16, 0.42], [0, y + 0.12, 5.22], [0, 0, 0], 0xc8c1ae);
  const recess = new THREE.CircleGeometry(0.28, 20);
  b.add('wood_dark', recess, [0, y + 1.13, 5.282]); recess.dispose();
  const ring = new THREE.TorusGeometry(0.32, 0.065, 6, 20);
  b.add('stone', ring, [0, y + 1.13, 5.32], [0, 0, 0], [1, 1, 1], 0xc8c1ae); ring.dispose();
  b.beam('paint_white', [-0.23, y + 1.13, 5.293], [0.23, y + 1.13, 5.293], 0.035, 0.025, 0xb7b6a9);
  b.beam('paint_white', [0, y + 0.90, 5.293], [0, y + 1.36, 5.293], 0.035, 0.025, 0xb7b6a9);
}

function dormers(b) {
  const y = 16.6;
  for (const x of [-3.9, 3.9]) {
    // Bottoms embed in the sloping roof at z≈4m. Small timber cheeks and
    // properly pitched slate caps give actual silhouette/parallax.
    b.box('plaster', [1.58, 1.15, 0.72], [x, y + 1.10, 4.0], [0, 0, 0], 0xbac0b4);
    polygon(b, 'plaster', [[-0.79, 0], [0.79, 0], [0, 0.64]], [x, y + 1.675, 3.64], 0.72, 0xbac0b4);
    b.box('wood_dark', [1.16, 0.94, 0.07], [x, y + 1.10, 4.395]);
    b.box('glass', [1.01, 0.78, 0.025], [x, y + 1.10, 4.445], [0, 0, 0], 0x8f9b97);
    for (const dx of [-0.56, 0, 0.56]) b.box('paint_white', [0.045, 0.94, 0.055], [x + dx, y + 1.10, 4.472], [0, 0, 0], 0xb6b5aa);
    for (const dy of [-0.45, 0.02, 0.45]) b.box('paint_white', [1.16, 0.045, 0.055], [x, y + 1.10 + dy, 4.472], [0, 0, 0], 0xb6b5aa);
    b.box('stone', [1.37, 0.10, 0.24], [x, y + 0.59, 4.40], [0, 0, 0], 0xb5b7ac);
    const slope = Math.atan2(0.64, 0.79) * 180 / Math.PI;
    for (const side of [-1, 1]) b.box('roof_slate', [1.09, 0.075, 0.99], [x + side * 0.395, y + 2.02, 4.03], [0, 0, -side * slope]);
    b.beam('iron', [x, y + 2.34, 3.52], [x, y + 2.34, 4.56], 0.055, 0.055);
  }
}

function grocery(b) {
  // The left display gets a shallow, partly wound-in shop canopy. It
  // never obscures the base model's right-hand shop lettering or doors.
  const x = -4.45, wall = 5.35, out = 6.10;
  const drop = 0.28, angle = Math.atan2(drop, out - wall) * 180 / Math.PI;
  const length = Math.hypot(drop, out - wall);
  for (let i = 0; i < 8; i++) {
    b.box('canvas', [0.388, 0.028, length], [x - 1.35 + i * 0.386, 2.96, (wall + out) / 2], [angle, 0, 0], i % 2 ? 0xb6bbaa : 0x7e8b73);
    b.box('canvas', [0.388, 0.15 + (i % 3) * 0.012, 0.035], [x - 1.35 + i * 0.386, 2.74, out], [0, 0, 0], i % 2 ? 0xb6bbaa : 0x7e8b73);
  }
  b.cylinder('canvas_gray', 0.085, 3.20, [x, 3.125, wall], [0, 0, 90], 10, 0xa3a58f);
  for (const dx of [-1.47, 1.47]) {
    b.rod('iron', [x + dx, 3.09, wall], [x + dx, 2.82, out], 0.018, 5);
    b.rod('iron', [x + dx, 2.37, wall], [x + dx, 2.82, out], 0.016, 5);
  }
  // A two-sided enamel blade sign, suspended high enough to leave the
  // pavement clear. Its grocer's wording agrees with the original shop.
  b.rod('iron', [-2.12, 4.40, 5.12], [-2.12, 4.40, 6.37], 0.023, 6);
  for (const z of [5.49, 6.24]) b.rod('iron', [-2.12, 4.40, z], [-2.12, 4.18, z], 0.014, 5);
  b.box('paint_green', [0.045, 0.49, 1.08], [-2.12, 3.94, 5.865]);
  b.material('grocer-enamel', grocerySign());
  const face = new THREE.PlaneGeometry(1.02, 0.43); face.userData.keepUV = true;
  for (const side of [-1, 1]) b.add('grocer-enamel', face, [-2.12 + side * 0.025, 3.94, 5.865], [0, side * 90, 0]);
  face.dispose();
}

const STYLES = [
  ['prague_ochre_gable', 'prague_ochre', 'stucco-centre-gable', pediment],
  ['prague_gray_dormer', 'prague_gray', 'paired-slate-dormers', dormers],
  ['prague_rose_canopy', 'prague_rose', 'grocer-canvas-canopy', grocery],
];

export function pragueFrontageVariants(baseModels) {
  const variants = new Map();
  for (const [name, baseName, style, build] of STYLES) {
    const base = baseModels.get(baseName);
    if (!base) throw new Error(`Missing ${baseName} for ${name}`);
    const b = createBuilder(name); b.material('stone', pragueTrimMaterial()); build(b);
    const detail = b.done();
    variants.set(name, { ...base, name, prims: [...base.prims, ...detail.prims],
      box: base.box.clone().union(detail.box),
      colliders: base.colliders.map(c => ({ ...c, c: [...c.c], h: [...c.h] })),
      anchors: { ...base.anchors },
      extras: { ...base.extras, frontageBase: baseName, frontageStyle: style,
        detailTriangles: detail.prims.reduce((n, p) => n + p.geometry.attributes.position.count / 3, 0) },
    });
  }
  return variants;
}

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
