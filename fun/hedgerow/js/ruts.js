/* Hedgerow — wheel ruts along the lane and the forest track.

   At load the level's centrelines (L.lines) are drawn into a small
   half-float texture over the lanes: for every texel within a few metres
   of a lane, its signed distance across it (m, wandering a little along
   the lane, so the ruts do) and whether water stands in the ruts there
   (in stretches along the lane). The terrain shader (terrain.js) cuts two
   ruts a cart's track apart from that into its near-eye relief, dark with
   wet mud and holding water, with a grassy crown between them: one fetch
   and a little arithmetic, as it is read at every step of the relief's
   march. */

import * as THREE from 'three';

const RES = 0.25, REACH = 3.5;

// smooth 1D value noise (0..1)
const hash = (i) => { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); };
function noise1(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* lines: {name: [[x, z], ...]}; which: the ones that get ruts */
export function createRuts(lines, which = ['LANE', 'TRACK']) {
  const roads = which.map((k) => lines?.[k]).filter((l) => l && l.length > 1);
  if (!roads.length) return null;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const l of roads) for (const [x, z] of l) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  x0 -= REACH + 1; z0 -= REACH + 1; x1 += REACH + 1; z1 += REACH + 1;
  const w = Math.ceil((x1 - x0) / RES), h = Math.ceil((z1 - z0) / RES);
  // far from any lane by default
  const best = new Float32Array(w * h).fill(Infinity);
  const data = new Uint16Array(w * h * 2);
  const far = THREE.DataUtils.toHalfFloat(REACH + 1);
  for (let i = 0; i < w * h; i++) data[i * 2] = far;
  for (const l of roads) {
    let along = 0;
    for (let s = 0; s < l.length - 1; s++) {
      const [ax, az] = l[s], [bx, bz] = l[s + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1e-6;
      // the texels within reach of this segment
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - REACH - x0) / RES)), i1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + REACH - x0) / RES));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - REACH - z0) / RES)), j1 = Math.min(h - 1, Math.ceil((Math.max(az, bz) + REACH - z0) / RES));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * RES, z = z0 + (j + 0.5) * RES;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (len * len)));
        const px = ax + dx * t, pz = az + dz * t;
        const d = Math.hypot(x - px, z - pz);
        const k = j * w + i;
        if (d >= best[k] || d > REACH) continue;
        best[k] = d;
        // signed: which side of the lane (right of the way it runs is positive), wandering
        // a little along it; water in the ruts in stretches, some long, some a puddle's length
        const side = Math.sign(dz * (x - px) - dx * (z - pz)) || 1;
        const a = along + t * len;
        data[k * 2] = THREE.DataUtils.toHalfFloat(d * side + (noise1(a * 0.11) - 0.5) * 0.35);
        data[k * 2 + 1] = THREE.DataUtils.toHalfFloat(smooth(0.42, 0.62, noise1(a * 0.07 + 3.1) * 0.75 + noise1(a * 0.31 + 7.7) * 0.25));
      }
      along += len;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, min: new THREE.Vector2(x0, z0), size: new THREE.Vector2(w * RES, h * RES) };
}

/* GLSL: rutsAt(xz, mud) -> vec3(the trough 0..1, water standing in it 0..1, the crown 0..1);
   rutLane(xz): on a rutted lane */
export const RUTS_GLSL = /* glsl */ `
  uniform sampler2D tRut;
  uniform vec2 uRutMin, uRutSize;
  // 1 on a lane with ruts (within 1.6 m of its centreline), else 0
  float rutLane(vec2 xz) {
    vec2 q = (xz - uRutMin) / uRutSize;
    if (q.x <= 0.0 || q.y <= 0.0 || q.x >= 1.0 || q.y >= 1.0) return 0.0;
    return step(abs(texture2D(tRut, q).r), 1.6);
  }
  vec3 rutsAt(vec2 xz, float mud) {
    vec2 q = (xz - uRutMin) / uRutSize;
    if (mud < 0.01 || q.x <= 0.0 || q.y <= 0.0 || q.x >= 1.0 || q.y >= 1.0) return vec3(0.0);
    vec2 r = texture2D(tRut, q).rg;
    // two ruts a cart's track apart (1.56 m), a crown between them
    float off = abs(abs(r.x) - 0.78);
    float trough = (1.0 - smoothstep(0.09, 0.23, off)) * mud;
    float crown = (1.0 - smoothstep(0.22, 0.42, abs(r.x))) * mud;
    return vec3(trough, smoothstep(0.35, 0.85, trough) * r.y, crown);
  }
`;
