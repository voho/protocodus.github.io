/* Hedgerow — the land beyond the level.

   A coarse ring of terrain round the playable area (out to ~1 km): rolling
   Norman bocage — a patchwork of fields and woods, hedgerow lines along the
   field edges — covered with the trees' far LODs (crossed impostor cards, a
   few triangles each) and the level's own distant scenery (a neighbouring
   village on a hill). It sits a little below the real terrain where they
   overlap, so the seam never shows. Static: built once, never updated. */

import * as THREE from 'three';
import { fbm2, lerp, rng, smoothstep, clamp } from './util.js';
import { createStaticBatcher } from './assets.js';

export function buildDistance(G, L, { models, matlib, material }) {
  const group = new THREE.Group();
  group.name = 'distance';
  const B = L.bounds;
  const F = L.far || {};
  const cx0 = B.minX, cx1 = B.maxX, cz0 = B.minZ, cz1 = B.maxZ;
  const outside = (x, z) => Math.hypot(Math.max(0, cx0 - x, x - cx1), Math.max(0, cz0 - z, z - cz1));

  /* the far ground */
  const hills = F.height || ((x, z) => 18 + 22 * fbm2(x / 420 + 1.3, z / 420 - 2.1, 4) + 8 * fbm2(x / 150, z / 150, 3));
  const woods = F.woods || ((x, z) => smoothstep(0.08, 0.22, fbm2(x / 230 + 7.7, z / 230 - 4.4, 3)));
  const height = (x, z) => {
    const d = outside(x, z);
    const edge = L.baseHeight(clamp(x, cx0, cx1), clamp(z, cz0, cz1));
    if (d <= 0) return L.baseHeight(x, z) - 2.5;          // under the real terrain
    return lerp(edge, hills(x, z), smoothstep(0, 140, d)) - 0.35;
  };
  // fields: rotated cells, each grass or ploughed; hedgerows along their edges
  const fieldCell = (x, z) => {
    const a = 0.35, c = Math.cos(a), s = Math.sin(a);
    const u = (x * c - z * s) / 70, v = (x * s + z * c) / 46;
    const iu = Math.floor(u), iv = Math.floor(v);
    const fu = u - iu, fv = v - iv;
    return { id: iu * 7919 + iv * 104729, edge: Math.min(fu, 1 - fu, fv, 1 - fv) };
  };
  const hash = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

  const R0 = F.radius || 1000, STEP = 25;
  const x0 = cx0 - R0, x1 = cx1 + R0, z0 = cz0 - R0, z1 = cz1 + R0;
  const nx = Math.ceil((x1 - x0) / STEP) + 1, nz = Math.ceil((z1 - z0) / STEP) + 1;
  const pos = new Float32Array(nx * nz * 3), nrm = new Float32Array(nx * nz * 3), spl = new Float32Array(nx * nz * 4);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * STEP, z = z0 + j * STEP, k = j * nx + i;
    pos[k * 3] = x; pos[k * 3 + 1] = height(x, z); pos[k * 3 + 2] = z;
    const w = woods(x, z), fc = fieldCell(x, z), plough = hash(fc.id) < 0.3 ? 1 : 0;
    spl[k * 4] = (1 - w) * plough * 0.8 + 0.05;
    spl[k * 4 + 1] = (1 - w) * (1 - plough * 0.8);
    spl[k * 4 + 2] = w;
    spl[k * 4 + 3] = 0;
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    // skip quads well inside the real terrain
    const qx = x0 + (i + 0.5) * STEP, qz = z0 + (j + 0.5) * STEP;
    if (qx > cx0 + STEP && qx < cx1 - STEP && qz > cz0 + STEP && qz < cz1 - STEP) continue;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, material);
  ground.name = 'far_ground';
  ground.matrixAutoUpdate = false;
  group.add(ground);

  /* far trees: woods and hedgerow lines, LOD impostors only */
  const lods = ['pine_a_lod', 'pine_b_lod', 'pine_c_lod', 'oak_a_lod', 'oak_b_lod', 'birch_a_lod', 'pine_big_lod', 'oak_big_lod', 'beech_big_lod', 'fir_big_lod']
    .filter((n) => models.has(n));
  const lines = ['treeline_far', 'treeline_far_b'].filter((n) => models.has(n));
  const R = rng(4242);
  // beyond COPSE m the broadleaf woods are copses (one card pair per 24 m), not single trees
  const COPSE = 330, copse = models.has('hill_trees_lod');
  const place = new Map([...lods, ...(copse ? ['hill_trees_lod'] : [])].map((n) => [n, []]));
  const maxD = F.treeRange || 620;
  const coniferAt = (x, z) => fbm2(x / 300, z / 300, 2) > 0;
  if (lods.length) {
    for (let z = z0; z < z1; z += 6) for (let x = x0; x < x1; x += 6) {
      const d = outside(x, z);
      if (d < 8 || d > maxD) continue;
      const jx = x + (R() - 0.5) * 5, jz = z + (R() - 0.5) * 5;
      const w = woods(jx, jz), fc = fieldCell(jx, jz);
      const p = w > 0.5 ? 0.55 : fc.edge < 0.035 ? 0.5 : 0.006;
      if (R() > p) continue;
      const conifer = w > 0.5 && coniferAt(jx, jz);
      if (copse && d > COPSE && w > 0.5 && !conifer) continue;
      const pool = lods.filter((n) => conifer ? /pine|fir/.test(n) : /oak|beech|birch/.test(n));
      const name = R.pick(pool.length ? pool : lods);
      place.get(name).push([jx, height(jx, jz) - 0.3, jz, R() * Math.PI * 2, 0.9 + R() * 0.8]);
    }
  }
  if (copse) {
    for (let z = z0; z < z1; z += 24) for (let x = x0; x < x1; x += 24) {
      const jx = x + (R() - 0.5) * 14, jz = z + (R() - 0.5) * 14, d = outside(jx, jz);
      if (d <= COPSE || d > maxD || woods(jx, jz) <= 0.5 || coniferAt(jx, jz) || R() > 0.8) continue;
      place.get('hill_trees_lod').push([jx, height(jx, jz) - 0.6, jz, R() * Math.PI * 2, 0.85 + R() * 0.4]);
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), s = new THREE.Vector3();
  let farCount = 0;
  for (const [name, list] of place) {
    if (!list.length) continue;
    const model = models.get(name);
    for (const p of model.prims) {
      const mesh = new THREE.InstancedMesh(p.geometry, matlib.resolve(p.material), list.length);
      list.forEach(([x, y, z, yaw, sc], i) => {
        q.setFromAxisAngle(up, yaw);
        mesh.setMatrixAt(i, m4.compose(v.set(x, y, z), q, s.setScalar(sc)));
      });
      mesh.frustumCulled = false;
      mesh.name = 'far:' + name;
      group.add(mesh);
    }
    farCount += list.length;
  }
  // the horizon: rings of treeline tiles round the level (each tile is three
  // layered cards, 62 m wide, facing +z), laid edge to edge along the bounds
  // grown by 150-350 m and turned to face the level; every other tile is
  // mirrored. Gaps are left between the level and the far buildings.
  const sightlines = (F.buildings || []).map((b) => [clamp(b.x, cx0, cx1), clamp(b.z, cz0, cz1), b.x, b.z]);
  const segDist = (px, pz, [ax, az, bx, bz]) => {
    const dx = bx - ax, dz = bz - az, t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    return Math.hypot(px - ax - dx * t, pz - az - dz * t);
  };
  // the bounds' edges, each followed by its corner: start, direction, length, outward angle
  const EDGES = [[cx0, cz0, 1, 0, cx1 - cx0, -Math.PI / 2], [cx1, cz0, 0, 1, cz1 - cz0, 0],
    [cx1, cz1, -1, 0, cx1 - cx0, Math.PI / 2], [cx0, cz1, 0, -1, cz1 - cz0, Math.PI]];
  const ringAt = (u, d0, d) => {
    for (const [sx, sz, dx, dz, len, th] of EDGES) {
      if (u < len) return [sx + dx * u + d * Math.cos(th), sz + dz * u + d * Math.sin(th), th];
      u -= len;
      if (u < (Math.PI / 2) * d0) { const a = th + u / d0; return [sx + dx * len + d * Math.cos(a), sz + dz * len + d * Math.sin(a), a]; }
      u -= (Math.PI / 2) * d0;
    }
    return ringAt(0, d0, d);
  };
  const tl = new Map(lines.map((n) => [n, []]));
  let tiles = 0;
  if (lines.length) {
    for (const [ring, d0] of [150, 205, 270, 350].entries()) {
      const per = 2 * (cx1 - cx0 + cz1 - cz0) + Math.PI * 2 * d0;
      const n = Math.round(per / 56), u0 = R() * per;
      for (let k = 0; k < n; k++) {
        const [x, z, a] = ringAt((u0 + (k * per) / n) % per, d0, d0 + (R() - 0.5) * 18);
        if (sightlines.some((l) => segDist(x, z, l) < 75)) continue;
        // the inner rings open up over the fields, so the edge is not a wall
        if (ring < 2 && woods(x, z) < 0.2 && R() < 0.3) continue;
        const sc = 0.9 + R() * 0.25, yaw = Math.atan2(-Math.cos(a), -Math.sin(a)) + (R() - 0.5) * 0.12;
        // sink the base below the lowest ground under the tile's front and back cards
        const c = Math.cos(yaw), sn = Math.sin(yaw);
        let y = Infinity;
        for (const lx of [-28, 0, 28]) for (const lz of [-1, -17]) y = Math.min(y, height(x + (lx * c + lz * sn) * sc, z + (-lx * sn + lz * c) * sc));
        tl.get(lines[k % lines.length]).push([x, y - 0.8, z, yaw, sc, k % 4 >= 2 ? -1 : 1]);
        tiles++;
      }
    }
    for (const [name, list] of tl) {
      if (!list.length) continue;
      for (const p of models.get(name).prims) {
        const mesh = new THREE.InstancedMesh(p.geometry, matlib.resolve(p.material), list.length);
        list.forEach(([x, y, z, yaw, sc, flip], i) => {
          q.setFromAxisAngle(up, yaw);
          mesh.setMatrixAt(i, m4.compose(v.set(x, y, z), q, s.set(sc * flip, sc, sc)));
        });
        mesh.frustumCulled = false;
        mesh.name = 'far:' + name;
        group.add(mesh);
      }
    }
  }

  /* distant buildings: the next village up the valley, farms */
  const batch = createStaticBatcher(matlib, 400);
  for (const b of F.buildings || []) {
    const model = models.get(b.m);
    if (!model) continue;
    const y = height(b.x, b.z) - 0.2;
    q.setFromAxisAngle(up, (b.yaw || 0) * Math.PI / 180);
    batch.add(model, m4.compose(v.set(b.x, y, b.z), q, s.setScalar(b.scale || 1)));
  }
  group.add(batch.build());

  return { group, height, farTrees: farCount, treelines: tiles };
}
