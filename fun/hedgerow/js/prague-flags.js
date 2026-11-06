/* Two authored May 1945 Czechoslovak flags on timber staffs and
   wrought-iron wall brackets. Local +z points away from masonry. Opaque
   vertex-colour fabric, original cotton weave, two merged draws, no shadows. */
import * as THREE from 'three';
import { createBuilder } from './street-model-kit.js';

const INK = { white: 0xe4dfd1, red: 0xb53730, blue: 0x233e70 };
const MAX_FLAGS = 2, WIND_BOUND = 0.04;
const AXIS = new THREE.Vector3(0, 1.40, 1.405).normalize();
const HOIST_TOP = new THREE.Vector3(0, 1.40, 1.48).addScaledVector(AXIS, -0.075);

function weave() {
  const n = 64, bytes = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const warp = Math.cos(x * Math.PI / 2), weft = Math.cos(y * Math.PI / 2);
    const over = ((x >> 2) + (y >> 2)) % 2 ? warp * 2.8 + weft : weft * 2.8 + warp;
    const grain = ((x * 29 + y * 43 + (x ^ y) * 7) % 19 - 9) * 0.16;
    const c = Math.round(247 + over + grain), i = (y * n + x) * 4;
    bytes[i] = bytes[i + 1] = bytes[i + 2] = c; bytes[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(bytes, n, n, THREE.RGBAFormat);
  texture.name = 'original-procedural-cotton-weave'; texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(80, 54);
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 4; texture.needsUpdate = true;
  return texture;
}

function surface(u, v, out = new THREE.Vector3()) {
  out.copy(HOIST_TOP).addScaledVector(AXIS, -v);
  out.x += u * 1.5;
  // Gravity drops the free edge; soft broad folds grow away from the hoist.
  out.y -= 0.105 * u * u;
  const fold = 0.052 * u * Math.sin(u * Math.PI * 3.2 + v * 1.5) + 0.018 * u * Math.sin(v * Math.PI * 2 + u);
  out.y -= AXIS.z * fold; out.z += AXIS.y * fold;
  return out;
}
function surfaceNormal(u, v) {
  const e = 1e-4;
  const du = surface(u + e, v).sub(surface(u - e, v));
  const dv = surface(u, v + e).sub(surface(u, v - e));
  return dv.cross(du).normalize();
}
function clip(poly, signed) {
  const out = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length], da = signed(a), db = signed(b);
    const insideA = da >= -1e-10, insideB = db >= -1e-10;
    if (insideA) out.push(a);
    if (insideA !== insideB) {
      const t = da / (da - db);
      out.push({ u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
    }
  }
  return out;
}
const REGIONS = {
  blue: [p => p.v - p.u, p => 1 - p.v - p.u],
  white: [p => 0.5 - p.v, p => p.u - p.v],
  red: [p => p.v - 0.5, p => p.u + p.v - 1],
};
function clothFor(matrix, phase, out) {
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const vertex = (p, color) => {
    const at = surface(p.u, p.v).applyMatrix4(matrix), n = surfaceNormal(p.u, p.v).applyMatrix3(normalMatrix).normalize();
    out.position.push(...at); out.normal.push(...n); out.uv.push(p.u, p.v);
    out.color.push(color.r, color.g, color.b); out.aFlagCoord.push(p.u, p.v, phase);
  };
  for (let row = 0; row < 10; row++) for (let col = 0; col < 16; col++) {
    const a = { u: col / 16, v: row / 10 }, b = { u: (col + 1) / 16, v: row / 10 };
    const c = { u: col / 16, v: (row + 1) / 10 }, d = { u: (col + 1) / 16, v: (row + 1) / 10 };
    for (const triangle of [[a, b, c], [b, d, c]]) for (const [key, cuts] of Object.entries(REGIONS)) {
      let poly = triangle;
      for (const cut of cuts) { poly = clip(poly, cut); if (poly.length < 3) break; }
      const color = new THREE.Color(INK[key]);
      for (let i = 1; i < poly.length - 1; i++) {
        const q = [poly[0], poly[i + 1], poly[i]];
        const area = Math.abs((q[1].u - q[0].u) * (q[2].v - q[0].v) - (q[2].u - q[0].u) * (q[1].v - q[0].v));
        if (area > 1e-10) q.forEach(p => vertex(p, color));
      }
    }
  }
}
function staffFor(matrix) {
  const b = createBuilder('prewar-window-flag-hardware');
  b.rod('hardware', [0, 0, 0.075], [0, 1.40, 1.48], 0.024, 8, 0x746047);
  b.box('hardware', [0.13, 0.28, 0.045], [0, 0.14, 0.027], [0, 0, 0], 0x343a34);
  for (const y of [0.055, 0.225]) b.cylinder('hardware', 0.013, 0.018, [0, y, 0.059], [90, 0, 0], 6, 0x30342f);
  b.rod('hardware', [0, 0.055, 0.055], [0, 0.30, 0.39], 0.016, 6, 0x343a34);
  b.rod('hardware', [0, 0.225, 0.055], [0, 0.30, 0.39], 0.016, 6, 0x343a34);
  for (const fraction of [0.21, 0.70]) {
    const centre = new THREE.Vector3(0, 1.40, 1.405).multiplyScalar(fraction).add(new THREE.Vector3(0, 0, 0.075));
    b.rod('hardware', centre.clone().addScaledVector(AXIS, -0.035).toArray(), centre.clone().addScaledVector(AXIS, 0.035).toArray(), 0.030, 8, 0x343a34);
  }
  const model = b.done(-1);
  const g = model.prims[0].geometry; g.applyMatrix4(matrix); return g;
}
function geometryFrom(data, attributes) {
  const g = new THREE.BufferGeometry();
  for (const [key, size] of Object.entries(attributes)) g.setAttribute(key, new THREE.Float32BufferAttribute(data[key], size));
  g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}
function installWind(material, shared, wind) {
  if (!shared?.time) return false;
  const direction = new THREE.Vector2(wind[0] || 0, wind[1] || 0), speed = direction.length();
  if (!speed) return false;
  direction.divideScalar(speed);
  material.onBeforeCompile = shader => {
    shader.uniforms.uFlagTime = shared.time;
    shader.uniforms.uFlagWind = { value: direction };
    shader.uniforms.uFlagStrength = { value: Math.min(1, speed / 1.6) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 aFlagCoord;
uniform float uFlagTime;
uniform vec2 uFlagWind;
uniform float uFlagStrength;`).replace('#include <begin_vertex>', `#include <begin_vertex>
float flagWeight = aFlagCoord.x * aFlagCoord.x;
float flagPhase = aFlagCoord.z;
float flagAlong = .024 * sin(uFlagTime * 1.7 + flagPhase + aFlagCoord.y * .6)
  + .006 * sin(uFlagTime * 3.1 + flagPhase * 1.2 + aFlagCoord.x * 1.5);
float flagAcross = .009 * sin(uFlagTime * 2.3 + flagPhase + aFlagCoord.y * 2.0);
transformed.xz += (uFlagWind * flagAlong + vec2(-uFlagWind.y, uFlagWind.x) * flagAcross) * flagWeight * uFlagStrength;
transformed.y += .004 * sin(uFlagTime * 2.1 + flagPhase + aFlagCoord.x) * flagWeight * uFlagStrength;`);
  };
  material.customProgramCacheKey = () => 'prague-cotton-flag-wind-v1';
  return true;
}

function buildFlags(placements, { shared, wind, height }) {
  if (!placements.length) return null;
  if (placements.length > MAX_FLAGS) throw new RangeError('The authored flag set is bounded to two flags');
  const cloth = { position: [], normal: [], uv: [], color: [], aFlagCoord: [] }, hardware = { position: [], normal: [], uv: [], color: [] };
  placements.forEach((p, i) => {
    const matrix = new THREE.Matrix4().makeRotationY((p.yaw || 0) * Math.PI / 180); matrix.setPosition(...p.wall);
    clothFor(matrix, 0.8 + i * 2.1, cloth);
    const g = staffFor(matrix);
    for (const key of Object.keys(hardware)) hardware[key].push(...g.attributes[key].array);
    g.dispose();
  });
  const clothGeometry = geometryFrom(cloth, { position: 3, normal: 3, uv: 2, color: 3, aFlagCoord: 3 });
  const hardwareGeometry = geometryFrom(hardware, { position: 3, normal: 3, uv: 2, color: 3 });
  let clearance = Infinity;
  if (height) for (const geometry of [clothGeometry, hardwareGeometry]) {
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) clearance = Math.min(clearance, p.getY(i) - height(p.getX(i), p.getZ(i)));
  }
  if (height && clearance < 3 + WIND_BOUND) { clothGeometry.dispose(); hardwareGeometry.dispose(); throw new RangeError('Flag hardware and cloth require at least three metres of route clearance'); }
  const map = weave();
  const clothMaterial = new THREE.MeshStandardMaterial({ name: 'prewar-cotton-flag', map, bumpMap: map, bumpScale: 0.00065,
    vertexColors: true, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
  const hardwareMaterial = new THREE.MeshStandardMaterial({ name: 'timber-staff-wrought-iron-bracket', vertexColors: true, roughness: 0.87, metalness: 0.05 });
  const windEnabled = installWind(clothMaterial, shared, wind);
  if (windEnabled) { clothGeometry.boundingBox.expandByScalar(WIND_BOUND); clothGeometry.boundingSphere.radius += WIND_BOUND; }
  const group = new THREE.Group(); group.name = 'prague-authored-flags';
  for (const [geometry, material] of [[clothGeometry, clothMaterial], [hardwareGeometry, hardwareMaterial]]) {
    const mesh = new THREE.Mesh(geometry, material); mesh.matrixAutoUpdate = false; mesh.castShadow = false; mesh.receiveShadow = true; group.add(mesh);
  }
  return { group, placements: placements.map(p => ({ wall: [...p.wall], yaw: p.yaw || 0 })), windEnabled,
    flags: placements.length, triangles: (cloth.position.length + hardware.position.length) / 9, draws: 2,
    clearance: Number.isFinite(clearance) ? clearance - (windEnabled ? WIND_BOUND : 0) : null,
    dispose() { clothGeometry.dispose(); hardwareGeometry.dispose(); clothMaterial.dispose(); hardwareMaterial.dispose(); map.dispose(); group.clear(); } };
}

export const FLAG_COLORS = Object.freeze({ ...INK });
export const FLAG_STAFF = Object.freeze({ axis: Object.freeze(AXIS.toArray()), hoistTop: Object.freeze(HOIST_TOP.toArray()), width: 1.5, height: 1.0, windBound: WIND_BOUND });

function authoredPlacements(level) {
  return [
    { address: [-19, -32], x: 2.2, y: 4.2, label: 'Older street house near the start' },
    { address: [-64, 84], x: 3.5, y: 4.4, label: 'Sage courtyard house near the relay' },
  ].map(({ address: [x, z], x: localX, y: localY, label }) => {
    const p = level.props.find(p => p.x === x && p.z === z && /^prague_/.test(p.m));
    if (!p || /passage|damaged/.test(p.m)) throw new Error('Flag mount requires its ordinary authored frontage');
    const yaw = (p.yaw || 0) * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw), localZ = 5;
    const y = typeof p.y === 'number' ? p.y : level.baseHeight(p.x, p.z);
    return { label, address: [x, z], wall: [x + localX * c + localZ * s, y + localY, z - localX * s + localZ * c], yaw: p.yaw || 0 };
  });
}

/** Two opaque, statically merged flags. Authored mounts use the actual
 * frontage transforms; clearance uses the caller's sampled terrain.
 * The hoist stays fixed and flutter uses the existing simulation clock. */
export function createPragueFlags(level = {}, height, { shared, wind = level.ambience?.wind || [0, 0] } = {}) {
  if (level.id !== 'prague') return null;
  if (typeof height !== 'function') throw new TypeError('Prague flags require sampled terrain height');
  return buildFlags(authoredPlacements(level), { shared, wind, height });
}
