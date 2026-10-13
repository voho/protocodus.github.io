/* Meteora — measure the rocks.

   Reads the five asteroid models (assets/models/asteroid_N.glb, the near
   mesh `lod0`) and writes js/rock-shapes.js: for each, how far its surface
   lies from its centre in every direction, as a cube map of radii. The
   simulation collides against that shape, so nothing sails into a rock it
   can see or bounces off a rock it cannot.

     node tools/rock-shapes.mjs

   Run it again whenever the rock models change (tools/blender/
   build_asteroids.py). Each sample is the farthest the surface reaches
   within a cone around its direction as wide as a cell's diagonal, so the
   shape read back between samples is never inside the mesh: a ship may
   stop a hair short of a rock's skin, never under it. */

import { readFileSync, writeFileSync } from 'node:fs';
import { FIELD } from '../js/config.js';
import { SHAPE_N, encodeShape, faceDir } from '../js/rock-shapes-core.js';

const root = new URL('..', import.meta.url).pathname;
const CONE = 1.45 * Math.atan(2 / SHAPE_N);

function readGlb(path) {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
  return { json, bin: buf.subarray(20 + jsonLen + 8) };
}

// The near mesh's triangles, with the node's rotation and scale applied
// (as models.js does when it loads them).
function triangles(file) {
  const { json, bin } = readGlb(file);
  const node = json.nodes.find(n => n.name === 'lod0');
  if (!node) throw new Error(`${file}: no lod0`);
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const rot = v => {
    const [x, y, z] = [v[0] * sx, v[1] * sy, v[2] * sz];
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx];
  };
  const tris = [];
  for (const prim of json.meshes[node.mesh].primitives) {
    const read = (index, size) => {
      const acc = json.accessors[index], view = json.bufferViews[acc.bufferView];
      const off = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      const out = [];
      if (size === 3) {
        const stride = view.byteStride ?? 12;
        for (let i = 0; i < acc.count; i++) out.push(rot([bin.readFloatLE(off + i * stride), bin.readFloatLE(off + i * stride + 4), bin.readFloatLE(off + i * stride + 8)]));
      } else {
        const width = { 5121: 1, 5123: 2, 5125: 4 }[acc.componentType];
        for (let i = 0; i < acc.count; i++) out.push(width === 1 ? bin.readUInt8(off + i) : width === 2 ? bin.readUInt16LE(off + i * 2) : bin.readUInt32LE(off + i * 4));
      }
      return out;
    };
    const pos = read(prim.attributes.POSITION, 3);
    const idx = prim.indices !== undefined ? read(prim.indices, 1) : pos.map((_, i) => i);
    for (let i = 0; i < idx.length; i += 3) tris.push([pos[idx[i]], pos[idx[i + 1]], pos[idx[i + 2]]]);
  }
  return tris;
}

// Farthest hit of the ray from the centre along unit d (Möller–Trumbore).
function reach(tris, d) {
  let best = -1;
  for (const [a, b, c] of tris) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det, s = [-a[0], -a[1], -a[2]];
    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
    if (u < -1e-6 || u > 1 + 1e-6) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
    if (v < -1e-6 || u + v > 1 + 1e-6) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
    if (t > best) best = t;
  }
  return best;
}

// Directions within the cone around d: d itself and two rings.
function cone(d) {
  const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm([up[1] * d[2] - up[2] * d[1], up[2] * d[0] - up[0] * d[2], up[0] * d[1] - up[1] * d[0]]);
  const e2 = [d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]];
  const out = [d];
  for (const [ring, n] of [[0.5, 6], [1, 12]]) {
    const r = Math.tan(CONE * ring);
    for (let k = 0; k < n; k++) {
      const a = (k + ring) * 2 * Math.PI / n;
      out.push(norm([d[0] + r * (Math.cos(a) * e1[0] + Math.sin(a) * e2[0]), d[1] + r * (Math.cos(a) * e1[1] + Math.sin(a) * e2[1]), d[2] + r * (Math.cos(a) * e1[2] + Math.sin(a) * e2[2])]));
    }
  }
  return out;
}
const norm = v => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };

const shapes = [];
for (let type = 0; type < FIELD.types.length; type++) {
  const file = `${root}assets/models/asteroid_${type + 1}.glb`;
  const tris = triangles(file);
  const nominal = FIELD.types[type].radius;
  const W = SHAPE_N + 1, radii = new Float32Array(6 * W * W);
  let missed = 0;
  for (let f = 0; f < 6; f++) {
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        let r = -1;
        for (const d of cone(faceDir(f, i, j))) r = Math.max(r, reach(tris, d));
        if (r <= 0) { missed++; r = nominal * 0.3; }
        radii[(f * W + j) * W + i] = r / nominal;
      }
    }
  }
  const max = radii.reduce((a, b) => Math.max(a, b), 0), min = radii.reduce((a, b) => Math.min(a, b), Infinity);
  console.log(`asteroid_${type + 1}: ${tris.length} triangles, radius ${min.toFixed(2)}–${max.toFixed(2)} × ${nominal} m${missed ? `, ${missed} directions missed` : ''}`);
  shapes.push(encodeShape(radii));
}

writeFileSync(`${root}js/rock-shapes.js`, `/* Meteora — the rocks' shapes, measured from their models by
   tools/rock-shapes.mjs (do not edit; run the tool again instead). For each
   rock size: the radius of its surface in every direction, as a cube map of
   ${SHAPE_N} × ${SHAPE_N} cells a face, in units of the size's nominal radius. */

import { decodeShape } from './rock-shapes-core.js';

export const SHAPES = [
${shapes.map(s => `  decodeShape('${s}'),`).join('\n')}
];
`);
console.log('wrote js/rock-shapes.js');
