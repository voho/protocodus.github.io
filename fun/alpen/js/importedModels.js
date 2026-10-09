/* Imported open-source models, folded into the instanced prop pipeline.

   Two families live under assets/models/nature: Poly Haven's CC0
   photoscans (the rocks, crags, stumps, logs and deadfall — see MODELS.md,
   and `upgradeTextured`/`upgradeTexturedSet` below), and Quaternius' CC0
   low-poly nature set (quaternius.com, via the flo-bit/tiny-planets
   mirror), which only the `upgrade` path still knows how to read. The
   low-poly models arrive as ordinary glTF scenes; what the game's pools
   need is one merged BufferGeometry per variant carrying the exact
   attribute contract the procedural growers emit — position, normal,
   per-vertex COLOUR-AS-VALUE, and the `surfaceOwn` mask — so that path's
   whole job is translation:

   - Owned surfaces (needles, bark) are stored as grey *values*, because the
     per-instance cast is the colour: that is how a stand of imported pines
     picks up the same lit/deep greens, the same rust and ghost odds, and
     the same time-of-day response as everything else on the hill.
   - Snow keeps its own near-white colour and `surfaceOwn = 0`, which is
     what routes it into the scene's snow tint and sparkle instead.
   - Rocks bake straight into the terrain's slate or iron palette by
     luminance, since boulders are not instance-tinted at all.

   Everything loads asynchronously after the pools already exist, and the
   upgrade is a geometry hot-swap on the InstancedMesh: transforms, casts,
   shadows and sway all carry over, and if a file never arrives the grown
   procedural variant simply remains. */

import { GLTFLoader } from '../assets/vendor/GLTFLoader.js';

const V_LO = 0.55;   // the darkest value an owned surface is allowed
const V_SPAN = 0.50; // ...and how far towards white the lightest climbs

function valueOf(lum) {
  const t = Math.min(1, Math.max(0, (lum - 0.08) / 0.32));
  return V_LO + V_SPAN * t;
}

/* One merged, non-indexed geometry from a glTF scene. `mode` decides the
   colour translation: 'tree' emits values + ownership, 'rock' emits palette
   colours from `palette` = [loHex, hiHex]. */
export function bakePoolGeometry(THREE, root, mode, palette) {
  const positions = [];
  const normals = [];
  const colors = [];
  const own = [];

  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const lo = palette ? new THREE.Color(palette[0]) : null;
  const hi = palette ? new THREE.Color(palette[1]) : null;

  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const geo = node.geometry;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const index = geo.index;
    const count = index ? index.count : pos.count;
    nm.getNormalMatrix(node.matrixWorld);

    const c = node.material?.color ?? { r: 0.5, g: 0.5, b: 0.5 };
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const isSnow = Math.min(c.r, c.g, c.b) > 0.55;
    const isFoliage = !isSnow && c.g > c.r * 1.1 && c.g > c.b * 1.1;

    let cr;
    let cg;
    let cb;
    let ownership;
    if (isSnow) {
      // Snow answers to the scene, not to the file it came from.
      cr = 0.93; cg = 0.955; cb = 1.0;
      ownership = 0;
    } else if (mode === 'rock') {
      const t = Math.min(1, Math.max(0, (lum - 0.06) / 0.42));
      cr = lo.r + (hi.r - lo.r) * t;
      cg = lo.g + (hi.g - lo.g) * t;
      cb = lo.b + (hi.b - lo.b) * t;
      ownership = 1;
    } else {
      const value = valueOf(lum);
      cr = value; cg = value; cb = value;
      // A needled trunk takes a share of the cast; needles take all of it.
      ownership = isFoliage ? 1 : 0.6;
    }

    for (let i = 0; i < count; i++) {
      const idx = index ? index.getX(i) : i;
      v.fromBufferAttribute(pos, idx).applyMatrix4(node.matrixWorld);
      positions.push(v.x, v.y, v.z);
      n.fromBufferAttribute(nor, idx).applyMatrix3(nm).normalize();
      normals.push(n.x, n.y, n.z);
      colors.push(cr, cg, cb);
      own.push(ownership);
    }
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  g.setAttribute('surfaceOwn', new THREE.BufferAttribute(new Float32Array(own), 1));
  return g;
}

/* Ground the geometry (base at y = 0, centred in x/z) and scale it
   uniformly to the height the pool's material was compiled for. A null
   height keeps the scan's own size — the right answer for anything whose
   placement already speaks in metres, like a log or a fallen branch. */
function normalise(THREE, g, targetHeight, sink = 0) {
  g.computeBoundingBox();
  const box = g.boundingBox;
  const height = Math.max(0.001, box.max.y - box.min.y);
  const s = targetHeight ? targetHeight / height : 1;
  targetHeight = height * s;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  g.translate(-cx, -box.min.y, -cz);
  g.scale(s, s, s);
  // A little of the base below grade: a prop planted on a slope must bury
  // its lowest edge, or the downhill side stands on air.
  if (sink > 0) g.translate(0, -targetHeight * sink, 0);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/* Low-poly scan proxies arrive unwelded with one normal per face: they are
   made to wear a normal map, and there is none here, so every triangle
   shaded as its own flat plate — and the snow dusting, which reads the
   normal, settled on alternate facets of the same rock. So a mesh whose
   corner normals are exactly its faces' gets smooth ones instead: each
   corner averages the faces sharing its position, by area, among those
   within sixty degrees of its own, so a real edge of the rock stays an edge.
   A mesh with authored smooth normals is left as it came. */
const CREASE_COS = 0.5;
function smoothFacetedNormals(positions, normals, indices, first) {
  const tris = (indices.length - first) / 3;
  const face = new Float64Array(tris * 4);   // unit normal, then area
  let deviation = 0;
  let corners = 0;
  for (let t = 0; t < tris; t++) {
    const a = indices[first + t * 3] * 3;
    const b = indices[first + t * 3 + 1] * 3;
    const c = indices[first + t * 3 + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) continue;
    const f = t * 4;
    face[f] = nx / len; face[f + 1] = ny / len; face[f + 2] = nz / len; face[f + 3] = len / 2;
    for (const k of [a, b, c]) {
      deviation += 1 - (face[f] * normals[k] + face[f + 1] * normals[k + 1] + face[f + 2] * normals[k + 2]);
      corners++;
    }
  }
  if (!corners || deviation / corners > 1e-3) return;
  const key = (k) => `${positions[k].toFixed(4)},${positions[k + 1].toFixed(4)},${positions[k + 2].toFixed(4)}`;
  const facesAt = new Map();
  for (let t = 0; t < tris; t++) {
    for (let j = 0; j < 3; j++) {
      const id = key(indices[first + t * 3 + j] * 3);
      const list = facesAt.get(id);
      if (list) list.push(t);
      else facesAt.set(id, [t]);
    }
  }
  for (let t = 0; t < tris; t++) {
    const own = t * 4;
    for (let j = 0; j < 3; j++) {
      const k = indices[first + t * 3 + j] * 3;
      let sx = 0, sy = 0, sz = 0;
      for (const u of facesAt.get(key(k))) {
        const f = u * 4;
        if (face[f] * face[own] + face[f + 1] * face[own + 1]
          + face[f + 2] * face[own + 2] < CREASE_COS) continue;
        sx += face[f] * face[f + 3];
        sy += face[f + 1] * face[f + 3];
        sz += face[f + 2] * face[f + 3];
      }
      const len = Math.hypot(sx, sy, sz);
      if (len > 0) { normals[k] = sx / len; normals[k + 1] = sy / len; normals[k + 2] = sz / len; }
    }
  }
}

/* One merged, indexed geometry that keeps its texture coordinates.

   The value/palette bake above exists because the low-poly set carries its
   colour in materials. A photoscan is the opposite: everything it knows is
   in its texture, so here the job is only to world-bake the primitives into
   one buffer and keep `uv` alive. The caller pairs the result with a
   material built around the scan's own baseColor map. `surfaceOwn` and
   `color` still ride along so the shared prop shaders can carve snow and
   sheen the same way they do everywhere else. */
export function bakeTexturedGeometry(THREE, root, only = null) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3();

  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    // A set file keeps several objects as named nodes; the loader may name a
    // mesh or its parent after the node, depending on how it was written.
    if (only && node.name !== only && node.parent?.name !== only) return;
    const geo = node.geometry;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const tex = geo.attributes.uv;
    if (!pos || !nor || !tex) return;
    const index = geo.index;
    const count = index ? index.count : pos.count;
    const offset = positions.length / 3;
    const first = indices.length;
    nm.getNormalMatrix(node.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld);
      positions.push(v.x, v.y, v.z);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      normals.push(n.x, n.y, n.z);
      uvs.push(tex.getX(i), tex.getY(i));
    }
    for (let i = 0; i < count; i++) indices.push(offset + (index ? index.getX(i) : i));
    smoothFacetedNormals(positions, normals, indices, first);
  });

  const total = positions.length / 3;
  const colors = new Float32Array(total * 3).fill(1);
  const own = new Float32Array(total).fill(1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('surfaceOwn', new THREE.BufferAttribute(own, 1));
  g.setIndex(indices);
  return g;
}

export function createModelUpgrader(THREE) {
  const loader = new GLTFLoader();
  const url = (name) => new URL(
    `../assets/models/nature/${name.includes('.') ? name : `${name}.gltf`}`,
    import.meta.url,
  ).href;

  /* Swap the instanced mesh's geometry in place. Existing instance
     matrices, colours and shadow bookkeeping all refer to the mesh, not
     the geometry, so nothing else has to know this ever happened. */
  function swap(pool, geometry) {
    const old = pool.mesh.geometry;
    pool.mesh.geometry = geometry;
    old.dispose();
  }

  function upgrade(pool, name, mode, targetHeight, palette, sink = 0) {
    loader.load(url(name), (gltf) => {
      const g = bakePoolGeometry(THREE, gltf.scene, mode, palette);
      swap(pool, normalise(THREE, g, targetHeight, sink));
    }, undefined, () => { /* the grown variant simply remains */ });
  }

  /* The photoscan path: keep the UVs, find the scan's own baseColor map,
     and let the caller wrap it in whichever patched material the pool
     should wear. Same hot-swap contract as `upgrade` otherwise — until the
     file lands the grown variant stands in, and a 404 changes nothing. */
  function upgradeTextured(pool, name, targetHeight, makeMaterial, sink = 0) {
    loader.load(url(name), (gltf) => {
      let map = null;
      gltf.scene.traverse((node) => {
        if (!map && node.isMesh && node.material?.map) map = node.material.map;
      });
      const g = bakeTexturedGeometry(THREE, gltf.scene);
      if (!g.attributes.position || g.attributes.position.count === 0) return;
      swap(pool, normalise(THREE, g, targetHeight, sink));
      if (map && makeMaterial) {
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = 4;
        pool.mesh.material = makeMaterial(map);
      }
    }, undefined, () => { /* the grown variant simply remains */ });
  }

  /* Several pools out of one file: a set of photoscans that share a texture
     (the granite stones, the fallen branches) is one request, one decode and
     one GPU texture, shared by every pool it feeds through one material.
     Each entry names its node and says what height to normalise it to (null
     keeps the scan's own metres) and how far to sink it. */
  function upgradeTexturedSet(name, entries, makeMaterial) {
    loader.load(url(name), (gltf) => {
      let map = null;
      gltf.scene.traverse((node) => {
        if (!map && node.isMesh && node.material?.map) map = node.material.map;
      });
      if (map) {
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = 4;
      }
      const material = map && makeMaterial ? makeMaterial(map) : null;
      for (const entry of entries) {
        const g = bakeTexturedGeometry(THREE, gltf.scene, entry.node);
        if (!g.attributes.position || g.attributes.position.count === 0) continue;
        swap(entry.pool, normalise(THREE, g, entry.height ?? null, entry.sink || 0));
        if (material) entry.pool.mesh.material = material;
        entry.onReady?.(entry.pool.mesh.geometry);
      }
    }, undefined, () => { /* the stand-ins simply remain */ });
  }

  return { upgrade, upgradeTextured, upgradeTexturedSet };
}
