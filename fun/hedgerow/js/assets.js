/* Hedgerow — the model library.

   Loads the Blender-built GLBs. Every top-level node of a static set
   (village, military, nature, weapons) becomes a "model": its primitives
   (geometry + palette key), normalised to the same float attributes
   (position, normal, uv, color) so they can be merged, plus the colliders
   and anchors from its extras. The soldier keeps its glTF scene and clips
   for SkeletonUtils cloning. */

import * as THREE from 'three';
import { GLTFLoader } from '../assets/vendor/GLTFLoader.js';
import { mergeGeometries } from '../assets/utils/BufferGeometryUtils.js';
import { splitRooms, reseedRooms } from './rooms.js';
import { breathe } from './pace.js';
import { createAssetProgress } from './loading.js';

export async function loadModels(base, sets, onProgress) {
  const loader = new GLTFLoader();
  const out = { models: new Map(), soldier: null };
  const progress = createAssetProgress(sets, onProgress);
  await Promise.all(sets.map(async (set) => {
    let gltf;
    try {
      gltf = await loader.loadAsync(`${base}/${set}.glb`, (e) => {
        // Leave room for decoding and extracting this set after its bytes arrive.
        if (e.lengthComputable && e.total > 0) progress(set, 0.9 * e.loaded / e.total);
      });
    } catch (err) {
      throw new Error(`Could not load ${set} models. Please retry.`, { cause: err });
    }
    if (set === 'soldier') out.soldier = gltf;
    else {
      // a model at a time, the browser getting its turns between them (pace.js)
      gltf.scene.updateMatrixWorld(true);
      for (const node of [...gltf.scene.children]) { readModel(node, set, out.models); await breathe(); }
    }
    progress(set, 1);
  }));
  return out;
}

function parseExtra(v) {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
}

export function readSet(gltf, set, models) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  for (const node of root.children) readModel(node, set, models);
}

/* one top-level node of a set (its matrices up to date) as a model */
function readModel(node, set, models) {
  const prims = [];
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  node.traverse((o) => {
    if (!o.isMesh) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    // Window extraction walks flat triangles; the other sets can retain
    // their indices so the main view and every shadow pass reuse vertices.
    const geo = normaliseGeometry(o.geometry, m, set !== 'village');
    const key = (o.material && o.material.name) || 'stone';
    prims.push({ geometry: geo, key: key.replace(/\.\d+$/, ''), material: o.material, node: o === node ? null : o.name });
  });
  if (!prims.length) return;
  if (set === 'village') splitRooms(prims);       // lit windows get rooms behind them
  const extras = node.userData || {};
  const model = {
    name: node.name, set, prims,
    colliders: parseExtra(extras.colliders) || [],
    anchors: parseExtra(extras.anchors) || {},
    extras,
    box: new THREE.Box3(),
  };
  for (const p of prims) { p.geometry.computeBoundingBox(); model.box.union(p.geometry.boundingBox); }
  models.set(node.name, model);
}

/* Float32 position/normal/uv/color(rgb) with the given transform baked in. */
function normaliseGeometry(src, matrix, keepIndex = true) {
  // Without authored normals the old path generated a flat normal for
  // each triangle. Keep that fallback instead of smoothing shared edges.
  const g = src.index && (!keepIndex || !src.attributes.normal) ? src.toNonIndexed() : src.clone();
  const n = g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, Cc = g.attributes.color;
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(matrix);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    if (N) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nrm[i * 3] = v.x; nrm[i * 3 + 1] = v.y; nrm[i * 3 + 2] = v.z; }
    if (U) { uv[i * 2] = U.getX(i); uv[i * 2 + 1] = U.getY(i); }
    if (Cc) { col[i * 3] = Cc.getX(i); col[i * 3 + 1] = Cc.getY(i); col[i * 3 + 2] = Cc.getZ(i); }
    else { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 1; }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.index) out.setIndex(g.index);
  if (!N) out.computeVertexNormals();
  g.dispose();
  return out;
}

/* A plain Object3D of a model (shared geometry, library materials). */
export function instantiate(model, matlib) {
  const g = new THREE.Group();
  g.name = model.name;
  for (const p of model.prims) {
    const m = new THREE.Mesh(p.geometry, matlib.resolve(p.material));
    m.name = p.node || model.name + ':' + p.key;      // child nodes keep their name (a gun's seated magazine)
    g.add(m);
  }
  return g;
}

/* Collects static placements and merges them per material per chunk. */
export function createStaticBatcher(matlib, chunk = 48) {
  const buckets = new Map();   // chunkKey|material uuid -> {material, geos}
  const tmp = new THREE.Matrix4();
  // one bucket merged into one mesh
  const merge = (id, material, list) => {
    // A palette material can occur in both indexed models and unindexed
    // window/flat-normal geometry. Promote only such mixed buckets; do
    // not add an unnecessary index buffer to wholly unindexed buildings.
    if (list.some(g => g.index) && list.some(g => !g.index)) for (const g of list) {
      if (g.index) continue;
      const n = g.attributes.position.count;
      const indices = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
      for (let i = 0; i < n; i++) indices[i] = i;
      g.setIndex(new THREE.BufferAttribute(indices, 1));
    }
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!merged) return null;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = 'static:' + id;
    mesh.matrixAutoUpdate = false;
    return mesh;
  };
  return {
    add(model, matrix, opts = {}) {
      const px = matrix.elements[12], pz = matrix.elements[14];
      const ck = Math.floor(px / chunk) + ',' + Math.floor(pz / chunk);
      for (const p of model.prims) {
        const material = matlib.resolve(p.material);
        const id = ck + '|' + material.uuid;
        let bucket = buckets.get(id);
        if (!bucket) buckets.set(id, bucket = { material, geos: [] });
        const list = bucket.geos;
        const geo = p.geometry.clone();
        geo.applyMatrix4(tmp.copy(matrix));
        reseedRooms(geo, px, pz);
        if (opts.tint) {
          const c = geo.attributes.color;
          for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * opts.tint, c.getY(i) * opts.tint, c.getZ(i) * opts.tint);
        }
        list.push(geo);
      }
    },
    build() {
      const group = new THREE.Group();
      group.name = 'static';
      for (const [id, { material, geos }] of buckets) { const mesh = merge(id, material, geos); if (mesh) group.add(mesh); }
      buckets.clear();
      return group;
    },
    /* the same, a bucket at a time, the browser getting its turns between (loading, pace.js) */
    async buildPaced() {
      const group = new THREE.Group();
      group.name = 'static';
      for (const [id, { material, geos }] of buckets) { const mesh = merge(id, material, geos); if (mesh) group.add(mesh); await breathe(); }
      buckets.clear();
      return group;
    },
  };
}

/* Colliders of a model placed with position/yaw/scale, in world space. */
export function worldColliders(model, x, y, z, yaw, scale = 1, surface = null) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const out = [];
  for (const col of model.colliders) {
    const [lx, ly, lz] = col.c;
    const wx = x + (lx * c + lz * s) * scale;
    const wz = z + (-lx * s + lz * c) * scale;
    const wy = y + ly * scale;
    if (col.type === 'box') {
      out.push({
        type: 'box', x: wx, y: wy, z: wz,
        hx: col.h[0] * scale, hy: col.h[1] * scale, hz: col.h[2] * scale,
        yaw: (col.ry || 0) + yaw, kind: col.kind, surface: col.surface || surface,
      });
    } else if (col.type === 'cyl') {
      out.push({ type: 'cyl', x: wx, y: wy, z: wz, r: col.r * scale, h: col.hgt * scale, kind: col.kind, surface: col.surface || surface });
    }
  }
  return out;
}

/* An anchor of a placed model in world space: [x, y, z, yaw]. */
export function worldAnchor(model, name, x, y, z, yaw, scale = 1) {
  const a = model.anchors[name];
  if (!a) return null;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [x + (a[0] * c + a[2] * s) * scale, y + a[1] * scale, z + (-a[0] * s + a[2] * c) * scale, (a[3] || 0) + yaw];
}
