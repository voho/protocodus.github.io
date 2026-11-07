/* Generic period instrument printing on the existing radio_table.
   The numeric scale deliberately claims no named radio subtype or unit.
   Original geometry, bounds, collision and anchors retain their owners. */
import * as THREE from 'three';
import { mergeGeometries } from '../assets/utils/BufferGeometryUtils.js';

const WIDTH = 512, HEIGHT = 256;
let sharedAtlas = null;

function createAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const c = canvas.getContext('2d');
  c.fillStyle = '#202621'; c.fillRect(0, 0, WIDTH, HEIGHT);
  // Aged paper graduation, never backlit.
  c.fillStyle = '#aaa58e'; c.fillRect(2, 2, 252, 92);
  c.strokeStyle = '#383c33'; c.lineWidth = 2; c.strokeRect(4, 4, 248, 88);
  c.fillStyle = '#272e28'; c.strokeStyle = '#30372e'; c.lineWidth = 1;
  for (let i = 0; i <= 50; i++) {
    const x = 13 + i * 4.58, major = i % 5 === 0;
    c.beginPath(); c.moveTo(x, 9); c.lineTo(x, major ? 35 : 22); c.stroke();
    if (major) { c.font = '14px serif'; c.textAlign = 'center'; c.fillText(String(i * 2), x, 56); }
  }
  c.beginPath(); c.moveTo(12, 69); c.lineTo(244, 69); c.stroke();
  for (let i = 0; i < 90; i++) {
    const x = 6 + (i * 73 % 243), y = 7 + (i * 37 % 79);
    c.fillStyle = i % 3 ? 'rgba(36,40,32,.09)' : 'rgba(230,225,203,.12)'; c.fillRect(x, y, 1, 1);
  }
  const cx = 384, cy = 128, outer = 122;
  c.fillStyle = '#292d27'; c.beginPath(); c.arc(cx, cy, outer, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#b5b09a'; c.fillStyle = '#b5b09a'; c.lineWidth = 2;
  for (let i = 0; i <= 50; i++) {
    const a = (-135 + i * 5.4) * Math.PI / 180, r0 = i % 5 === 0 ? 104 : 112;
    c.beginPath(); c.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
    c.lineTo(cx + Math.sin(a) * 120, cy - Math.cos(a) * 120); c.stroke();
    if (i % 5 === 0) {
      c.font = '12px serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(i / 5), cx + Math.sin(a) * 97, cy - Math.cos(a) * 97);
    }
  }
  // Small cap index mark, with opaque Bakelite-colored backing.
  c.fillStyle = '#3a352b'; c.fillRect(16, 128, 32, 48);
  c.fillStyle = '#c3bda5'; c.fillRect(29, 133, 6, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'radio_numeric_scales'; texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8; texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function patchUV(geometry, [x, y, width, height]) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, (x + u * width) / WIDTH, 1 - (y + (1 - v) * height) / HEIGHT);
  }
}

export function addRadioNumericScales(original, { texture = null } = {}) {
  if (original.name !== 'radio_table') throw new Error('Numeric scales require the authored radio_table');
  if (original.prims.some(p => p.key === 'radio_numeric_scales')) return original;
  const parts = [];
  function add(geometry, at, rect) {
    patchUV(geometry, rect); geometry.translate(...at);
    const colors = new Float32Array(geometry.attributes.position.count * 3); colors.fill(1);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); parts.push(geometry);
  }
  // The source window is opaque; ink sits 0.7 mm above its front face.
  // The existing knobs remain physically in front of their printed scales.
  add(new THREE.PlaneGeometry(.112, .042), [-.01, 1.0268, -.1174], [0, 0, 256, 96]);
  add(new THREE.CircleGeometry(.0385, 32), [.15, 1.0168, -.1174], [256, 0, 256, 256]);
  for (const [x, y, r] of [[.15, 1.0168, .026], [-.01, .9068, .03], [.15, .8868, .018], [.08, .8868, .014], [-.10, .8568, .014], [-.10, .9668, .014]]) {
    add(new THREE.PlaneGeometry(.0028, .009), [x, y + r * .45, -.0934], [16, 128, 32, 48]);
  }
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  geometry.computeBoundingBox();
  // All model instances borrow this one source texture through the shared
  // catalog material. Keep its canvas for ordinary context reupload.
  const map = texture || (sharedAtlas ||= createAtlas());
  const material = new THREE.MeshStandardMaterial({ name: 'radio_numeric_scales', map, roughness: .47, metalness: .04, vertexColors: true });
  material.userData.radioPrint = true;
  const primitive = { key: 'radio_numeric_scales', geometry, material, node: 'radio_numeric_scales' };
  return { ...original, prims: [...original.prims, primitive], box: original.box.clone(),
    colliders: original.colliders, anchors: original.anchors, extras: original.extras };
}
