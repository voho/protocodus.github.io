/* Hedgerow — loose straw on the silhouette of the baked haystacks.

   The GLB remains the solid mass. Small, bent, tapered stalks grow out of
   its real triangles, concentrated at the skirt and crown where a smooth
   outline is most conspicuous. Deterministic per placed stack, static,
   opaque, and merged by world cell: no alpha cards or frame updates. */

import * as THREE from 'three';
import { rng } from './util.js';

const CELL = 48, MAX_STACKS = 24, MAX_TUFTS = 220;
const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
const edge = new THREE.Vector3(), face = new THREE.Vector3();

function shell(model) {
  const box = model.box, centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5;
  const height = box.max.y - box.min.y;
  const triangles = [];
  let total = 0;
  for (const prim of model.prims) {
    const geo = prim.geometry, pos = geo.attributes.position, idx = geo.index;
    for (let i = 0, n = idx ? idx.count : pos.count; i < n; i += 3) {
      const ids = [0, 1, 2].map(k => idx ? idx.getX(i + k) : i + k);
      vA.fromBufferAttribute(pos, ids[0]); vB.fromBufferAttribute(pos, ids[1]); vC.fromBufferAttribute(pos, ids[2]);
      const x = (vA.x + vB.x + vC.x) / 3 - centre.x, z = (vA.z + vB.z + vC.z) / 3 - centre.z;
      const y = (vA.y + vB.y + vC.y) / 3 - box.min.y;
      face.crossVectors(edge.subVectors(vB, vA), vC.clone().sub(vA));
      const area = face.length() * 0.5;
      if (area < 1e-6) continue;
      face.normalize();
      // Exclude the central retaining stake, underside and small flat base.
      if (Math.hypot(x, z) < radius * 0.27 || y < 0.07 || y > height * 0.93 || face.y < -0.35) continue;
      if (face.x * x + face.z * z < -0.05) continue;
      const edgeWeight = y < height * 0.2 || y > height * 0.66 ? 1.8 : 0.45;
      total += area * edgeWeight;
      triangles.push({ geo, ids, normal: face.clone(), sum: total });
    }
  }
  return { triangles, total, centre, floor: box.min.y };
}

function choose(surface, r) {
  const q = r * surface.total;
  let lo = 0, hi = surface.triangles.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (surface.triangles[mid].sum < q) lo = mid + 1; else hi = mid; }
  return surface.triangles[lo];
}

export function createHayDetail(props, matlib, { enabled = true, tufts = 170, maxStacks = MAX_STACKS } = {}) {
  if (!enabled) return null;
  const stacks = props.filter(p => p.m?.name === 'haystack').slice(0, Math.min(MAX_STACKS, Math.max(0, maxStacks)));
  if (!stacks.length) return null;
  const count = Math.min(MAX_TUFTS, Math.max(0, Math.round(tufts)));
  if (!count) return null;
  const cache = new Map(), buckets = new Map();
  const p = new THREE.Vector3(), n = new THREE.Vector3(), tangent = new THREE.Vector3(), side = new THREE.Vector3();
  const start = new THREE.Vector3(), middle = new THREE.Vector3(), tip = new THREE.Vector3(), normal = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0), radial = new THREE.Vector3(), dir = new THREE.Vector3();
  let totalTufts = 0;
  for (const it of stacks) {
    if (!cache.has(it.m)) cache.set(it.m, shell(it.m));
    const surface = cache.get(it.m);
    if (!surface.triangles.length) continue;
    const seed = ((Math.round(it.x * 100) * 73856093) ^ (Math.round(it.z * 100) * 19349663) ^ 7117) >>> 0;
    const R = rng(seed), yaw = it.yaw || 0, cs = Math.cos(yaw), sn = Math.sin(yaw), scale = it.scale || 1;
    const id = `${Math.floor(it.x / CELL)},${Math.floor(it.z / CELL)}`;
    if (!buckets.has(id)) buckets.set(id, { pos: [], normal: [], uv: [], color: [] });
    const out = buckets.get(id);
    const vertex = (v, nn, shade, u, vtex) => {
      out.pos.push(it.x + (v.x * cs + v.z * sn) * scale, it.y + v.y * scale, it.z + (-v.x * sn + v.z * cs) * scale);
      out.normal.push(nn.x * cs + nn.z * sn, nn.y, -nn.x * sn + nn.z * cs);
      out.color.push(shade, shade, shade);
      out.uv.push(u, vtex);
    };
    for (let i = 0; i < count; i++) {
      const tri = choose(surface, R());
      const a = Math.sqrt(R()), b = R(), w = [1 - a, a * (1 - b), a * b];
      p.set(0, 0, 0);
      tri.ids.forEach((idx, k) => p.addScaledVector(vA.fromBufferAttribute(tri.geo.attributes.position, idx), w[k]));
      n.copy(tri.normal);
      radial.set(p.x - surface.centre.x, 0, p.z - surface.centre.z).normalize();
      tangent.copy(down).addScaledVector(n, -down.dot(n));
      if (tangent.lengthSq() < 0.1) tangent.copy(radial).addScaledVector(n, -radial.dot(n));
      tangent.normalize();
      const length = 0.09 + R() * 0.14;
      for (let blade = 0; blade < 4; blade++) {
        dir.copy(tangent).addScaledVector(n, 0.18 + R() * 0.3);
        side.crossVectors(tangent, n).normalize();
        dir.addScaledVector(side, (blade - 1.5) * 0.15 + (R() - 0.5) * 0.18).normalize();
        const len = length * (0.65 + R() * 0.6), width = 0.0035 + R() * 0.004;
        start.copy(p).addScaledVector(n, 0.007).addScaledVector(side, (R() - 0.5) * 0.035);
        middle.copy(start).addScaledVector(dir, len * 0.48).addScaledVector(n, 0.013);
        tip.copy(start).addScaledVector(dir, len).addScaledVector(n, 0.004);
        // At the skirt the stems settle on the soil rather than through it.
        middle.y = Math.max(surface.floor + 0.012, middle.y); tip.y = Math.max(surface.floor + 0.012, tip.y);
        side.crossVectors(dir, n).normalize();
        normal.crossVectors(side, dir).normalize();
        if (normal.dot(n) < 0) normal.negate();
        const points = [start.clone().addScaledVector(side, -width), start.clone().addScaledVector(side, width),
          middle.clone().addScaledVector(side, -width * 0.58), middle.clone().addScaledVector(side, width * 0.58), tip.clone()];
        const tint = 0.76 + R() * 0.27;
        const shades = [tint * 0.63, tint * 0.63, tint * 0.91, tint * 0.91, tint];
        for (const idx of [0, 1, 2, 1, 3, 2, 2, 3, 4]) vertex(points[idx], normal, shades[idx], idx % 2 ? width * 2 : 0, idx < 2 ? 0 : idx < 4 ? len * 0.48 : len);
      }
      totalTufts++;
    }
  }
  if (!totalTufts) return null;
  const material = matlib.get('hay', { variant: 'straw-fringe', color: '#b1a06b', roughness: 1 });
  material.side = THREE.DoubleSide;
  material.normalScale.set(0.12, 0.12);
  const group = new THREE.Group();
  group.name = 'hay_detail';
  let triangles = 0;
  for (const [id, out] of buckets) {
    const geometry = new THREE.BufferGeometry();
    for (const [key, data, size] of [['position', out.pos, 3], ['normal', out.normal, 3], ['uv', out.uv, 2], ['color', out.color, 3]]) geometry.setAttribute(key, new THREE.Float32BufferAttribute(data, size));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `hay_straw:${id}`;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    // Individual stalk shadows are below a pixel and would multiply six-face
    // lamp shadow work. The solid stack already casts its complete shadow.
    mesh.castShadow = false;
    triangles += geometry.attributes.position.count / 3;
    group.add(mesh);
  }
  return { group, stacks: stacks.length, tufts: totalTufts, triangles,
    dispose() { for (const mesh of group.children) mesh.geometry.dispose(); group.clear(); } };
}
