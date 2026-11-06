/* Prague, May 1945. Fictional Vinohrady tenements built with Three.js:
   tall rendered façades, stone shopfronts, moulded windows and cornices,
   slate roofs, and genuinely open vaulted courtyard passages. No Norman
   farmhouses are reused as Prague architecture. Model front is +z. */
import * as THREE from 'three';
import { createBuilder } from './street-model-kit.js';
import { pragueTrimMaterial, pragueMosaicMaterial } from './prague-surfaces.js';
import { addPragueFacadeDamage } from './prague-facade-damage.js';
import { praguePeriodFrontages } from './prague-frontage-details.js';

const SIGN_CACHE = new Map();
function signMaterial(text, background = '#263b37') {
  const cacheKey = text + background;
  if (SIGN_CACHE.has(cacheKey)) return SIGN_CACHE.get(cacheKey);
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 128;
  const ctx = canvas.getContext('2d'); let texture;
  if (ctx.fillText) {
    ctx.fillStyle = background; ctx.fillRect(0, 0, 768, 128);
    ctx.strokeStyle = '#d6cbb5'; ctx.lineWidth = 3; ctx.strokeRect(10, 10, 748, 108);
    ctx.fillStyle = '#e4d8bc'; ctx.font = 'bold 58px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 384, 68, 700);
    texture = new THREE.CanvasTexture(canvas);
  } else {
    // Node geometry/collision checks do not need a canvas text rasterizer.
    texture = new THREE.DataTexture(new Uint8Array([36, 54, 48, 255]), 1, 1); texture.needsUpdate = true;
  }
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ name: `prague-sign-${text}`, map: texture, roughness: 0.86 });
  SIGN_CACHE.set(cacheKey, material); return material;
}
function sign(b, text, at, width = 4.2, height = 0.7, yaw = 0, background) {
  const key = `sign-${text}`;
  const g = new THREE.PlaneGeometry(width, height); g.userData.keepUV = true;
  b.material(key, signMaterial(text, background)); b.add(key, g, at, [0, yaw, 0]); g.dispose();
}

function window(b, x, y, z, { back = false, ornate = false, boarded = false, tint = 0xffffff } = {}) {
  const side = back ? -1 : 1;
  b.box('stone', [1.73, 2.37, 0.12], [x, y, z], [0, 0, 0], tint);
  b.box('wood_dark', [1.43, 2.08, 0.10], [x, y, z + side * 0.075]);
  if (boarded) {
    for (let i = 0; i < 5; i++) b.box('wood_old', [1.37, 0.30, 0.07], [x, y - 0.75 + i * 0.37, z + side * 0.14], [0, 0, (i % 3 - 1) * 3]);
  } else {
    for (const dx of [-0.35, 0.35]) for (const dy of [-0.48, 0.48]) {
      b.box('glass', [0.62, 0.89, 0.035], [x + dx, y + dy, z + side * 0.14], [0, 0, 0], (x * 3 + y) % 4 > 1 ? 0xb5c5c6 : 0x71807c);
    }
    // A few cotton curtains soften the otherwise uniformly dark glazing.
    // Their irregular opening and partial drop distinguish inhabited rooms.
    if ((Math.round(x * 10) + Math.round(y * 10)) % 4 !== 0) {
      const width = (Math.abs(Math.round(x + y)) % 3 === 0) ? 0.43 : 0.23;
      for (const dx of [-0.57, 0.57]) {
        const h = ((Math.round(y) + Math.round(x)) % 3 === 0) ? 1.18 : 1.88;
        b.box('marking_white', [width, h, 0.018], [x + dx * (1 - width * 0.18), y + (1.88 - h) / 2, z + side * 0.168], [0, 0, 0], 0xbab8a9);
      }
    }
    b.box('paint_white', [0.055, 2.02, 0.085], [x, y, z + side * 0.17], [0, 0, 0], 0xc2bdb0);
    b.box('paint_white', [1.42, 0.055, 0.085], [x, y + 0.08, z + side * 0.17], [0, 0, 0], 0xc2bdb0);
    b.box('wood_dark', [1.44, 0.06, 0.10], [x, y - 0.99, z + side * 0.17]);
  }
  b.box('stone', [1.91, 0.16, 0.38], [x, y - 1.16, z + side * 0.14], [0, 0, 0], tint);
  b.box('stone', [1.87, 0.12, ornate ? 0.28 : 0.18], [x, y + 1.21, z + side * 0.09], [0, 0, 0], tint);
  if (ornate) {
    for (const dx of [-0.77, 0.77]) b.box('stone', [0.12, 0.28, 0.20], [x + dx, y + 1.33, z + side * 0.11], [0, 0, 0], tint);
    b.box('plaster', [1.30, 0.20, 0.08], [x, y - 1.48, z], [0, 0, 0], 0xbcb5a3);
  }
}

function roof(b, height, tint) {
  const angle = Math.atan2(2.0, 5.25) * 180 / Math.PI;
  for (const side of [-1, 1]) b.box('roof_slate', [14.25, 0.16, 5.62], [0, height + 0.96, side * 2.63], [side * angle, 0, 0]);
  b.box('iron', [14.35, 0.10, 0.16], [0, height + 2.04, 0]);
  // Lower neighbours expose the ends of this pitched roof. Close the
  // actual attic with rendered gables instead of leaving a sky-lit void
  // between two thin roof slopes. Winding faces out on both party walls.
  for (const side of [-1, 1]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      side * 7, height, -5.05, side * 7, height + 1.96, 0, side * 7, height, 5.05,
    ], 3));
    g.setIndex(side > 0 ? [0, 1, 2] : [2, 1, 0]); g.computeVertexNormals();
    b.add('plaster', g, [0, 0, 0], [0, 0, 0], [1, 1, 1], tint); g.dispose();
  }
  for (const x of [-4.5, 4.8]) {
    b.box('brick', [0.83, 2.1, 0.85], [x, height + 1.95, -1.55]);
    b.box('stone', [1.02, 0.14, 1.02], [x, height + 3.0, -1.55]);
  }
}

function facade(name, { height = 17.2, tint = 0xf3dbab, passage = false, shop = 'POTRAVINY', ornate = true } = {}) {
  const b = createBuilder(name); const width = 14, depth = 10;
  b.material('stone', pragueTrimMaterial());
  if (passage) {
    for (const side of [-1, 1]) {
      b.box('plaster', [5.0, height, depth], [side * 4.5, height / 2, 0], [0, 0, 0], tint);
      b.collider([side * 4.5, height / 2, 0], [2.5, height / 2, depth / 2], 0, undefined, 'stone');
    }
    b.box('plaster', [4.0, height - 4.15, depth], [0, (height + 4.15) / 2, 0], [0, 0, 0], tint);
    b.collider([0, (height + 4.15) / 2, 0], [2.0, (height - 4.15) / 2, 5], 0, undefined, 'stone');
    // Barrel-vault springing and arch voussoirs on both ends. The clear
    // central passage remains 3.8 m wide and at least 3.2 m high.
    for (const side of [-1, 1]) {
      b.box('stone', [0.25, 3.2, 10.08], [side * 1.91, 1.6, 0]);
      b.collider([side * 1.91, 1.6, 0], [0.125, 1.6, 5.04], 0, undefined, 'stone');
    }
    for (let i = 0; i < 11; i++) {
      const a = Math.PI * (i + 0.5) / 11, x = Math.cos(a) * 1.98, y = 3.02 + Math.sin(a) * 1.04;
      for (const z of [-5.09, 5.09]) b.box('stone', [0.57, 0.29, 0.27], [x, y, z], [0, 0, a * 180 / Math.PI - 90]);
    }
    // Segmented internal soffit follows the arch, so the entrance reads as
    // a masonry barrel vault rather than a rectangular hole with trim.
    for (let i = 0; i < 14; i++) {
      const x = -1.8 + (i + 0.5) * (3.6 / 14), outer = Math.min(1.8, Math.abs(x) + 1.8 / 14);
      const bottom = 3.0 + 1.1 * Math.sqrt(Math.max(0, 1 - (outer / 1.8) ** 2));
      const h = Math.max(0.05, 4.18 - bottom);
      b.box('stone', [3.6 / 14 + 0.005, h, 10], [x, bottom + h / 2, 0], [0, 0, 0], 0xbab7aa);
      b.collider([x, bottom + h / 2, 0], [1.8 / 14, h / 2, 5], 0, undefined, 'stone');
    }
    for (const side of [-1, 1]) b.box('wood_dark', [0.09, 3.05, 1.6], [side * 1.75, 1.55, -3.85], [0, side * 7, 0]);
    b.model.anchors.passageSouth = [0, 0, -5.6, Math.PI]; b.model.anchors.passageNorth = [0, 0, 5.6, 0];
  } else {
    b.box('plaster', [width, height, depth], [0, height / 2, 0], [0, 0, 0], tint);
    b.collider([0, height / 2, 0], [7, height / 2, 5], 0, undefined, 'stone');
    // High stone shop plinth, recessed painted doors, and display glazing.
    b.box('stone', [width + 0.06, 0.60, 0.16], [0, 0.3, 5.05], [0, 0, 0], 0xb6afa0);
    for (const x of [-4.45, 4.45]) {
      b.box('wood_dark', [3.15, 2.35, 0.12], [x, 1.72, 5.12]);
      b.box('glass', [2.85, 1.94, 0.05], [x, 1.75, 5.20], [0, 0, 0], 0x7d8b83);
      for (const dx of [-1.50, 0, 1.50]) b.box('paint_green', [0.07, 2.37, 0.09], [x + dx, 1.72, 5.23]);
      b.box('paint_green', [3.19, 0.18, 0.12], [x, 0.54, 5.2]);
    }
    b.box('stone', [2.50, 3.38, 0.20], [0, 1.69, 5.12]);
    b.box('wood_dark', [1.84, 2.86, 0.12], [0, 1.45, 5.25]);
    for (const dx of [-0.46, 0.46]) {
      b.box('paint_green', [0.78, 2.64, 0.07], [dx, 1.42, 5.32]);
      b.box('glass', [0.56, 0.78, 0.035], [dx, 2.15, 5.36]);
      b.box('wood_dark', [0.035, 0.2, 0.05], [dx * 0.18, 1.30, 5.39]);
    }
  }
  // Continuous bands align the storeys; differentiated window lintels and
  // pilasters keep repeated placements from reading as plain textured boxes.
  const floors = Math.floor((height - 3.9) / 3.15);
  for (let floor = 0; floor < floors; floor++) {
    const y = 5.45 + floor * 3.15;
    for (const x of [-5.2, -2.6, 0, 2.6, 5.2]) {
      window(b, x, y, 5.06, { ornate: ornate && floor < 2, boarded: name === 'prague_rose' && floor === 0 && x === -2.6 });
      window(b, x, y, -5.06, { back: true, ornate: false, tint: 0xc2b9a5 });
    }
    if (floor < 2) b.box('stone', [14.17, 0.12, 0.22], [0, y - 1.64, 5.09], [0, 0, 0], 0xc4baa5);
  }
  for (const x of [-6.8, 6.8]) {
    b.box('stone', [0.34, height - 3.6, 0.16], [x, (height + 3.6) / 2, 5.10], [0, 0, 0], 0xc7beaa);
    // Rainwater pipes run at party-wall edges, with swan-neck foot offsets.
    b.rod('iron', [x + (x < 0 ? 0.10 : -0.10), 0.18, 5.38], [x + (x < 0 ? 0.10 : -0.10), height - 0.15, 5.38], 0.045, 7);
  }
  for (const [y, w, d] of [[3.55, 14.25, 0.38], [height - 0.35, 14.3, 0.45], [height, 14.55, 0.68]]) {
    b.box('stone', [w, 0.18, d], [0, y, 5.06], [0, 0, 0], 0xd3cab4);
    b.box('stone', [w, 0.18, d], [0, y, -5.06], [0, 0, 0], 0xb8b3a7);
  }
  for (let x = -6.5; x <= 6.5; x += 0.5) b.box('stone', [0.20, 0.20, 0.26], [x, height - 0.16, 5.19], [0, 0, 0], 0xcac0aa);
  roof(b, height, tint);
  // A modest centre balcony on the decorated rose façade.
  if (name === 'prague_rose') {
    b.box('stone', [3.30, 0.21, 1.24], [0, 7.40, 5.55]);
    for (let x = -1.5; x <= 1.5; x += 0.25) b.rod('iron', [x, 7.55, 6.11], [x, 8.45, 6.11], 0.021, 5);
    b.rod('iron', [-1.58, 8.46, 6.11], [1.58, 8.46, 6.11], 0.036, 6);
    for (const x of [-1.58, 1.58]) b.rod('iron', [x, 8.46, 5.08], [x, 8.46, 6.11], 0.032, 6);
  }
  if (!passage) sign(b, shop, [4.45, 3.12, 5.29], 3.4, 0.54, 0, name === 'prague_rose' ? '#55362f' : '#263b37');
  else sign(b, 'PRŮCHOD', [0, 4.44, 5.49], 2.9, 0.46, 0, '#283839');
  // Red enamel house-number plaque, without borrowing modern street names.
  sign(b, name === 'prague_rose' ? '27' : passage ? '19' : '31', [-1.62, 2.7, 5.3], 0.34, 0.26, 0, '#722d29');
  b.model.extras.period = 'Fictional late nineteenth-century Prague street frontage';
  b.model.extras.floors = floors + 1;
  b.model.extras.windowBays = 5;
  b.model.extras.wallHeight = height;
  b.model.extras.roofStyle = 'slate-pitched';
  return b.done();
}

function tramRails() {
  const b = createBuilder('prague_tram_rails');
  for (const x of [-0.7175, 0.7175]) {
    b.box('iron', [0.075, 0.027, 14], [x, 0.0135, 0], [-Math.atan(0.019) * 180 / Math.PI, 0, 0]);
    b.box('metal_dark', [0.028, 0.016, 14], [x + 0.055, 0.01, 0], [-Math.atan(0.019) * 180 / Math.PI, 0, 0]);
  }
  return b.done();
}

function mosaicPavement(side = 1) {
  const b = createBuilder(side < 0 ? 'prague_pavement_e' : 'prague_pavement');
  b.material('mosaic', pragueMosaicMaterial());
  const g = new THREE.PlaneGeometry(4.6, 14).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getZ(i) * 0.019);
  g.computeVertexNormals(); b.add('mosaic', g); g.dispose();
  // Shallow dressed kerb down the road edge; no collider beyond the ground.
  b.material('stone', pragueTrimMaterial());
  b.box('stone', [0.12, 0.12, 14], [-2.3 * side, -0.045, 0], [-Math.atan(0.019) * 180 / Math.PI, 0, 0], 0xb9b6a8);
  return b.done();
}

function radioRelaySign() {
  const b = createBuilder('prague_relay_sign');
  b.box('wood_old', [2.4, 0.74, 0.08], [0, 0.52, 0]);
  for (const x of [-0.88, 0.88]) b.box('wood_dark', [0.08, 1.25, 0.08], [x, 0.625, -0.08]);
  sign(b, 'ROZHLAS', [0, 0.53, 0.047], 2.2, 0.56, 0, '#4d3d2c');
  return b.done();
}

function damagedFacade(base) {
  const b = createBuilder('prague_damaged');
  b.material('stone', pragueTrimMaterial()); addPragueFacadeDamage(b);
  const damage = b.done();
  // The variant shares the complete undamaged frontage geometry. Only the
  // 398-triangle damaged surface is new; the collision footprint is exact.
  return {
    ...base, name: 'prague_damaged',
    prims: [...base.prims, ...damage.prims],
    box: base.box.clone().union(damage.box),
    colliders: base.colliders.map((c) => ({ ...c, c: [...c.c], h: [...c.h] })),
    anchors: { ...base.anchors }, extras: { ...base.extras, damage: 'Authored render loss and impact scars, solid masonry behind' },
  };
}

export function pragueModels() {
  const list = [
    facade('prague_ochre', { height: 17.2, tint: 0xf7dfad, shop: 'PEKÁRNA' }),
    facade('prague_rose', { height: 18.3, tint: 0xe5b9ad, shop: 'POTRAVINY' }),
    facade('prague_gray', { height: 16.6, tint: 0xc7ceca, shop: 'LÉKÁRNA', ornate: false }),
    facade('prague_passage', { height: 17.2, tint: 0xe3d3b0, passage: true }),
    tramRails(), mosaicPavement(), mosaicPavement(-1), radioRelaySign(),
  ];
  list.push(damagedFacade(list[0]));
  list.push(...praguePeriodFrontages());
  return new Map(list.map((m) => [m.name, m]));
}
