/* Small, authored cereal plots in the Normandy farmland. June wheat is
   green and in ear, below standing eye height: these are cultivated plants
   with narrow leaves and alternate spikelets, not yellow harvest fields.
   Roots follow the actual terrain. Row ends leave a working headland.
   Opaque instancing gives one draw per world cell, with no frame updates,
   alpha cards, collider/cover claims, or crop geometry in urban missions. */

import * as THREE from 'three';
import { rng } from './util.js';

const CELL = 24, MAX_PLANTS = 4096, MAX_PLOTS = 8, MAX_CANDIDATES = 49152;
const DEFAULT_PLOTS = {
  'saint-clair': [{ x0: -39, x1: -25, z0: 43, z1: 60, headland: 1.2, rowYaw: -7, seed: 19440601, height: 0.91 }],
  'la-varenne': [{ x0: -24, x1: -12, z0: 18, z1: 36, headland: 1.2, rowYaw: 5, seed: 19440606, height: 0.86 }],
};

export const CROP_WIND_ENVELOPE = 0.05;

function cropWind(material, shared, direction) {
  if (material.userData.cropWind) return;
  const d = Array.isArray(direction) ? direction : [1.3, 0.6];
  const wind = new THREE.Vector2(Number.isFinite(d[0]) ? d[0] : 1.3, Number.isFinite(d[1]) ? d[1] : 0.6);
  if (wind.lengthSq() < 1e-6) wind.set(0, 0); else wind.normalize();
  const uniforms = { uCropTime: shared?.time || { value: 0 }, uCropWind: { value: wind } };
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader) {
    compile.call(this, shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uCropTime;
        uniform vec2 uCropWind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 cropRoot = vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING
            cropRoot = instanceMatrix * cropRoot;
          #endif
          cropRoot = modelMatrix * cropRoot;
          float cropPhase = uCropTime * 1.55 + cropRoot.x * 0.31 + cropRoot.z * 0.23;
          float cropWave = sin(cropPhase) * 0.62 + sin(cropPhase * 0.63 + cropRoot.x * 0.08) * 0.24
            + sin(cropPhase * 2.6 + position.y * 4.0) * 0.14;
          float cropCross = sin(cropPhase * 0.81 + cropRoot.z * 0.12) * 0.55 + sin(cropPhase * 1.9) * 0.45;
          float cropWeight = clamp(position.y, 0.0, 1.0);
          cropWeight *= cropWeight;
          transformed.xz += (uCropWind * cropWave * 0.033 + vec2(-uCropWind.y, uCropWind.x) * cropCross * 0.012) * cropWeight;
        }`);
  };
  material.customProgramCacheKey = function () { return key.call(this) + ':crop-wind-v1'; };
  material.userData.cropWind = uniforms;
}

function wheatGeometry() {
  const pos = [], color = [], uv = [];
  const triangle = (a, b, c, tint = [1, 1, 1]) => {
    for (const v of [a, b, c]) { pos.push(...v); uv.push(v[0], v[1]); color.push(...tint); }
  };
  const quad = (a, b, c, d, tint) => { triangle(a, b, c, tint); triangle(c, b, d, tint); };
  // Two crossed, slightly leaning stem ribbons. Their root is exactly y0;
  // the ribbons are real millimetre-scale stems, not camera-facing cards.
  for (const axis of [0, 2]) {
    const a = [0, 0, 0], b = [0, 0, 0], c = [0.023, 0.43, 0.005], d = [...c];
    a[axis] -= 0.0025; b[axis] += 0.0025; c[axis] -= 0.0018; d[axis] += 0.0018;
    quad(a, b, c, d, [0.62, 0.69, 0.48]);
    const e = [0.052, 0.85, 0.012], f = [...e]; e[axis] -= 0.0013; f[axis] += 0.0013;
    quad(c, d, e, f, [0.83, 0.88, 0.62]);
  }
  // Two narrow flag leaves fold along their midrib and droop at the tip.
  for (const [y, side, length] of [[0.35, -1, 0.20], [0.63, 1, 0.16]]) {
    const root = [y * 0.06, y, y * 0.014], mid = [root[0] + side * length * 0.58, y + 0.075, 0.015];
    const left = [mid[0], mid[1] - 0.009, mid[2] - 0.012], right = [mid[0], mid[1] - 0.009, mid[2] + 0.012];
    const tip = [root[0] + side * length, y + 0.015, 0.025];
    triangle(root, left, mid, [0.70, 0.83, 0.49]); triangle(root, mid, right, [0.81, 0.91, 0.59]);
    triangle(left, tip, mid, [0.74, 0.87, 0.52]); triangle(mid, tip, right, [0.84, 0.93, 0.62]);
  }
  // Paired alternate spikelets make a recognisable ear at close range.
  // Its green tips are deliberately only a little paler than the leaves.
  for (let level = 0; level < 5; level++) for (const side of [-1, 1]) {
    const y = 0.835 + level * 0.024 + (side > 0 ? 0.009 : 0), x = 0.052 + level * 0.002;
    const reach = 0.016 * (1 - level * 0.075);
    const root = [x, y, 0.012], tip = [x + side * reach, y + 0.035, 0.012];
    const a = [x + side * reach * 0.8, y + 0.013, 0.006], b = [x + side * reach * 0.8, y + 0.013, 0.018];
    triangle(root, a, tip, [0.95, 0.95, 0.67]); triangle(root, tip, b, [0.84, 0.89, 0.57]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

export function cropPlotsFor(level) {
  return level.crops ?? DEFAULT_PLOTS[level.id] ?? [];
}

export function createFieldCrops(level, height, matlib, { enabled = true, maxPlants = MAX_PLANTS, shared = null, wind = level.ambience?.wind } = {}) {
  if (!enabled) return null;
  const plots = cropPlotsFor(level).slice(0, MAX_PLOTS);
  const cap = Math.min(MAX_PLANTS, Math.max(0, Math.floor(maxPlants)));
  if (!plots.length || !cap) return null;
  const buckets = new Map(), roots = [], matrix = new THREE.Matrix4(), q = new THREE.Quaternion();
  let candidates = 0;
  const axis = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3(), scale = new THREE.Vector3();
  for (let index = 0; index < plots.length && roots.length < cap; index++) {
    const plot = plots[index], R = rng(plot.seed ?? (19440600 + index));
    const headland = Math.max(0, plot.headland ?? 1.2), row = Math.max(0.24, plot.rowSpacing ?? 0.30), along = Math.max(0.32, plot.plantSpacing ?? 0.40);
    const x0 = plot.x0 + headland, x1 = plot.x1 - headland, z0 = plot.z0 + headland, z1 = plot.z1 - headland;
    if (![x0, x1, z0, z1].every(Number.isFinite) || x1 <= x0 || z1 <= z0 || x1 - x0 > 96 || z1 - z0 > 96) continue;
    const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5, yaw = (plot.rowYaw || 0) * Math.PI / 180;
    const cs = Math.cos(yaw), sn = Math.sin(yaw), radius = Math.hypot(x1 - x0, z1 - z0) * 0.5;
    for (let u = -radius; u <= radius && roots.length < cap && candidates < MAX_CANDIDATES; u += row) {
      for (let v = -radius; v <= radius && roots.length < cap && candidates < MAX_CANDIDATES; v += along) {
        candidates++;
        const a = u + (R() - 0.5) * row * 0.18, b = v + (R() - 0.5) * along * 0.40;
        const x = cx + a * cs + b * sn, z = cz - a * sn + b * cs;
        if (x < x0 || x > x1 || z < z0 || z > z1 || R() < 0.035) continue;
        if (plot.exclusions?.some(e => x >= e.x0 && x <= e.x1 && z >= e.z0 && z <= e.z1)) continue;
        if (plot.allow && !plot.allow(x, z)) continue;
        const y = height(x, z);
        if (!Number.isFinite(y)) continue;
        const slope = Math.hypot(height(x + 0.25, z) - height(x - 0.25, z), height(x, z + 0.25) - height(x, z - 0.25));
        if (slope > 0.38) continue;
        const h = Math.min(1.05, Math.max(0.55, plot.height ?? 0.9)) * (0.81 + R() * 0.19);
        matrix.compose(at.set(x, y - 0.006, z), q.setFromAxisAngle(axis, R() * Math.PI * 2), scale.set(0.84 + R() * 0.32, h, 0.84 + R() * 0.32));
        const id = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
        if (!buckets.has(id)) buckets.set(id, []);
        buckets.get(id).push({ matrix: matrix.clone(), shade: 0.86 + R() * 0.14 });
        roots.push({ x, y, z, height: h, plot: index });
      }
    }
  }
  if (!roots.length) return null;
  const geometry = wheatGeometry(), material = matlib.get('grass', { variant: 'june-wheat', color: '#7b8052', roughness: 0.91 });
  material.side = THREE.DoubleSide; material.normalScale.set(0.12, 0.12);
  cropWind(material, shared, wind);
  const group = new THREE.Group(); group.name = 'cultivated_fields';
  const color = new THREE.Color();
  for (const [id, plants] of buckets) {
    const mesh = new THREE.InstancedMesh(geometry, material, plants.length);
    mesh.name = `wheat:${id}`; mesh.matrixAutoUpdate = false;
    plants.forEach((plant, i) => { mesh.setMatrixAt(i, plant.matrix); mesh.setColorAt(i, color.setRGB(plant.shade, plant.shade, plant.shade)); });
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage); mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    mesh.boundingSphere.radius += CROP_WIND_ENVELOPE;
    mesh.castShadow = false; mesh.receiveShadow = true;
    group.add(mesh);
  }
  const trianglesPerPlant = geometry.attributes.position.count / 3;
  return { group, roots, plants: roots.length, triangles: roots.length * trianglesPerPlant, trianglesPerPlant,
    dispose() { group.clear(); geometry.dispose(); } };
}
