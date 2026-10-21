/* Hedgerow — the ground map: what grows and lies where.

   Two textures over the terrain's grid, made once at load, read by the
   GPU-placed ground cover. The cover (half-float RGBA, filtered): R how
   grassy the ground is (grass.js), G how stony (the mud of lanes, yards and
   the street's edges), B how much fallen wood (the forest floor; both
   clutter.js), A the ground's height (near enough for grass, in one fetch
   with its cover). The exact height (float, read texel by texel with
   GROUND_GLSL, for stones and twigs): the ground as the terrain mesh draws
   it. The mesh has a vertex at every
   grid point in its fine chunks but only every second one elsewhere, so
   the points between are rebuilt from its triangles (a stone placed on the
   grid's own heights there could sink centimetres under it). The splat
   weights come from the mesh's vertices too; the points between are filled
   from their neighbours. Slope and water are judged at every point, from
   the heights: nothing on steep banks or under the water. Nothing inside
   anything solid either (houses, walls, sandbags; a thin post or plank
   clears at least the nearest points to it). */

import * as THREE from 'three';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* GLSL for the height: groundY(xz), with the mesh's triangulation
   (split along the diagonal from (i, j+1) to (i+1, j), as terrain.js) */
export const GROUND_GLSL = /* glsl */ `
  uniform highp sampler2D tHeight;
  uniform vec2 uMapMin;
  uniform float uMapRes;
  uniform ivec2 uMapN;
  float groundY(vec2 xz) {
    vec2 g = (xz - uMapMin) / uMapRes;
    ivec2 i = clamp(ivec2(floor(g)), ivec2(0), uMapN - 2);
    vec2 f = clamp(g - vec2(i), 0.0, 1.0);
    float a = texelFetch(tHeight, i, 0).r, b = texelFetch(tHeight, i + ivec2(1, 0), 0).r;
    float c = texelFetch(tHeight, i + ivec2(0, 1), 0).r, d = texelFetch(tHeight, i + ivec2(1, 1), 0).r;
    return f.x + f.y <= 1.0 ? a + (b - a) * f.x + (c - a) * f.y : d + (c - d) * (1.0 - f.x) + (b - d) * (1.0 - f.y);
  }
`;

export function createGroundMap(terrain, world, waterLevel) {
  const { H, nx, nz, minX, minZ, res } = terrain.grid;
  const N = nx * nz;
  // the three covers, interleaved: grass, stones, wood
  const cov = new Float32Array(N * 3).fill(NaN);
  const vert = new Uint8Array(N);      // a vertex of the mesh
  for (const chunk of terrain.group.children) {
    const g = chunk.geometry;
    const pos = g.attributes.position, spl = g.attributes.splat;
    if (!pos || !spl) continue;
    for (let v = 0; v < pos.count; v++) {
      const i = Math.round((pos.getX(v) - minX) / res), j = Math.round((pos.getZ(v) - minZ) / res);
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const k = j * nx + i;
      if (Math.abs(pos.getY(v) - H[k]) > 0.01) continue;          // a skirt
      vert[k] = 1;
      const mud = spl.getX(v), grass = spl.getY(v), forest = spl.getZ(v), cobble = spl.getW(v);
      const road = 1 - Math.min(1, cobble * 2);
      // grass, a little in the forest, none on the road
      cov[k * 3] = (smoothstep(0.35, 0.8, grass) + forest * 0.12) * road;
      // stones in the mud (the lanes, the yards, the street's muddy edges), a few in the forest
      cov[k * 3 + 1] = (smoothstep(0.25, 0.7, mud) * 0.9 + forest * 0.15) * road;
      // twigs and fallen wood on the forest floor
      cov[k * 3 + 2] = smoothstep(0.3, 0.8, forest);
    }
  }
  // between the coarse chunks' vertices: the average of the known neighbours (the
  // straight ones; the diagonal ones where both coordinates fall between)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (!Number.isNaN(cov[k * 3])) continue;
    for (const ring of [[[-1, 0], [1, 0], [0, -1], [0, 1]], [[-1, -1], [1, -1], [-1, 1], [1, 1]]]) {
      const sum = [0, 0, 0];
      let cnt = 0;
      for (const [di, dj] of ring) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const o = (b * nx + a) * 3;
        if (Number.isNaN(cov[o])) continue;
        sum[0] += cov[o]; sum[1] += cov[o + 1]; sum[2] += cov[o + 2];
        cnt++;
      }
      if (cnt) { for (let c = 0; c < 3; c++) cov[k * 3 + c] = sum[c] / cnt; break; }
    }
    if (Number.isNaN(cov[k * 3])) cov[k * 3] = cov[k * 3 + 1] = cov[k * 3 + 2] = 0;
  }
  // none on steep banks, none at the water
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const hx = H[j * nx + Math.min(nx - 1, i + 1)] - H[j * nx + Math.max(0, i - 1)];
    const hz = H[Math.min(nz - 1, j + 1) * nx + i] - H[Math.max(0, j - 1) * nx + i];
    const slope = 1 - (2 * res) / Math.hypot(hx, 2 * res, hz);
    const keep = (1 - smoothstep(0.25, 0.5, slope)) * smoothstep(0.1, 0.45, H[k] - waterLevel);
    for (let c = 0; c < 3; c++) cov[k * 3 + c] *= keep;
  }
  // nothing inside what is solid; a thin thing (a post, a plank, a
  // sandbag wall) clears at least the map's nearest points to it
  const reach = res * 0.72;
  for (const c of world.colliders) {
    if (c.type !== 'box' && c.type !== 'cyl') continue;
    if (!(c.flags & 1) || c.surface === 'foliage') continue;
    const ex = c.type === 'box' ? Math.max(c.hx + 0.1, reach) : 0, ez = c.type === 'box' ? Math.max(c.hz + 0.1, reach) : 0;
    const er = c.type === 'cyl' ? Math.max(c.r + 0.1, reach) : 0;
    const i0 = Math.max(0, Math.floor((c.minX - reach - minX) / res)), i1 = Math.min(nx - 1, Math.ceil((c.maxX + reach - minX) / res));
    const j0 = Math.max(0, Math.floor((c.minZ - reach - minZ) / res)), j1 = Math.min(nz - 1, Math.ceil((c.maxZ + reach - minZ) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * nx + i;
      const x = minX + i * res, z = minZ + j * res;
      if (c.top - H[k] < 0.03 || c.bottom - H[k] > 1.0) continue;   // buried, or high above (a bridge deck)
      const rx = x - c.x, rz = z - c.z;
      const inside = c.type === 'box'
        ? Math.abs(rx * c.c - rz * c.s) <= ex && Math.abs(rx * c.s + rz * c.c) <= ez
        : rx * rx + rz * rz <= er * er;
      if (inside) cov[k * 3] = cov[k * 3 + 1] = cov[k * 3 + 2] = 0;
    }
  }
  // the height as the mesh draws it: at a point between the coarse chunks'
  // vertices, on the edge between two of them, or on the cell's diagonal
  const MH = new Float32Array(H);
  const known = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && vert[j * nx + i] === 1;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (vert[k]) continue;
    if (known(i - 1, j) && known(i + 1, j)) MH[k] = (H[k - 1] + H[k + 1]) / 2;
    else if (known(i, j - 1) && known(i, j + 1)) MH[k] = (H[k - nx] + H[k + nx]) / 2;
    else if (known(i + 1, j - 1) && known(i - 1, j + 1)) MH[k] = (H[k - nx + 1] + H[k + nx - 1]) / 2;
  }
  const data = new Uint16Array(N * 4);
  for (let k = 0; k < N; k++) {
    data[k * 4] = THREE.DataUtils.toHalfFloat(cov[k * 3]);
    data[k * 4 + 1] = THREE.DataUtils.toHalfFloat(cov[k * 3 + 1]);
    data[k * 4 + 2] = THREE.DataUtils.toHalfFloat(cov[k * 3 + 2]);
    data[k * 4 + 3] = THREE.DataUtils.toHalfFloat(MH[k]);
  }
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const hTex = new THREE.DataTexture(MH, nx, nz, THREE.RedFormat, THREE.FloatType);
  hTex.minFilter = hTex.magFilter = THREE.NearestFilter;
  hTex.needsUpdate = true;
  const min = new THREE.Vector2(minX, minZ);
  return {
    tex, hTex, min, size: new THREE.Vector2((nx - 1) * res, (nz - 1) * res),
    /* the uniforms GROUND_GLSL reads */
    uniforms: { tHeight: { value: hTex }, uMapMin: { value: min }, uMapRes: { value: res }, uMapN: { value: new THREE.Vector2(nx, nz) } },
  };
}
