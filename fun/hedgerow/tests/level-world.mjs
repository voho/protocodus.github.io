// The level's collision world for the node checks, built as levelBuild.js
// builds it: the level data placed with the colliders authored in the GLBs,
// the analytic ground with its building pads, the river, the scattered
// trees and rocks. Shared by route-check.mjs and ai-check.mjs.
import { readFileSync } from 'node:fs';
import { createWorld } from '../js/world.js';
import { rectDistance, smoothstep, lerp } from '../js/util.js';
import L from '../js/levels/saint-clair.js';

export { L };
export const DEG = Math.PI / 180;
const here = new URL('..', import.meta.url).pathname;

/* ---------- models: colliders, anchors, bounds from the GLB JSON ---------- */
export const models = new Map();
for (const set of ['village', 'military', 'nature']) {
  const b = readFileSync(`${here}assets/models/${set}.glb`);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString());
  for (const n of j.nodes) {
    if (n.mesh == null) continue;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of j.meshes[n.mesh].primitives) {
      const a = j.accessors[p.attributes.POSITION];
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a.min[k]); mx[k] = Math.max(mx[k], a.max[k]); }
    }
    const ex = n.extras || {};
    models.set(n.name, {
      name: n.name, min: mn, max: mx,
      colliders: ex.colliders ? JSON.parse(ex.colliders) : [],
      anchors: ex.anchors ? JSON.parse(ex.anchors) : {},
    });
  }
}

function worldColliders(m, x, y, z, yaw, scale = 1) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return m.colliders.map((col) => {
    const [lx, ly, lz] = col.c;
    const w = { x: x + (lx * c + lz * s) * scale, y: y + ly * scale, z: z + (-lx * s + lz * c) * scale, kind: col.kind };
    if (col.type === 'box') return { ...w, type: 'box', hx: col.h[0] * scale, hy: col.h[1] * scale, hz: col.h[2] * scale, yaw: (col.ry || 0) + yaw };
    return { ...w, type: 'cyl', r: col.r * scale, h: col.hgt * scale };
  });
}

/* ---------- ground with building pads (as levelBuild.js) ---------- */
const pads = [];
export const missing = new Set();
for (const p of L.props) {
  const m = models.get(p.m);
  if (!m) { missing.add(p.m); continue; }
  if (!p.pad) continue;
  const yaw = p.yaw * DEG, c = Math.cos(yaw), s = Math.sin(yaw);
  const cxl = (m.min[0] + m.max[0]) / 2, czl = (m.min[2] + m.max[2]) / 2;
  const cx = p.x + cxl * c + czl * s, cz = p.z - cxl * s + czl * c;
  const h = typeof p.y === 'number' ? p.y : L.baseHeight(cx, cz);
  pads.push({ cx, cz, hx: (m.max[0] - m.min[0]) / 2 + 0.6, hz: (m.max[2] - m.min[2]) / 2 + 0.6, yaw, h, margin: 3.5 });
  p._padH = h;
}
export const height = (x, z) => {
  let h = L.baseHeight(x, z);
  for (const pd of pads) {
    const dx = x - pd.cx, dz = z - pd.cz, reach = Math.max(pd.hx, pd.hz) + pd.margin;
    if (dx * dx + dz * dz > reach * reach * 2) continue;
    const d = rectDistance(x, z, pd.cx, pd.cz, pd.hx, pd.hz, pd.yaw);
    if (d < pd.margin) h = lerp(h, pd.h, smoothstep(pd.margin, 0, d));
  }
  return h;
};
export const terrain = { height, normal: () => [0, 1, 0], surfaceAt: () => 'mud', raycast: () => Infinity };
export const world = createWorld({ ...L.bounds, cell: 8, terrain, water: L.water });

for (const p of L.props) {
  const m = models.get(p.m);
  if (!m) continue;
  const yaw = (p.yaw || 0) * DEG;
  let y;
  if (typeof p.y === 'number') y = p.y;
  else if (typeof p.y === 'function') y = p.y(p.x, p.z);
  else if (p._padH !== undefined) y = p._padH - 0.04;
  else {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const sx = Math.min(Math.abs(m.min[0]), Math.abs(m.max[0])) * (p.scale || 1) * 0.8;
    const sz = Math.min(Math.abs(m.min[2]), Math.abs(m.max[2])) * (p.scale || 1) * 0.8;
    y = height(p.x, p.z);
    for (const [lx, lz] of [[sx, sz], [-sx, sz], [sx, -sz], [-sx, -sz]]) y = Math.min(y, height(p.x + lx * c + lz * s, p.z - lx * s + lz * c));
    y -= 0.04;
  }
  for (const col of worldColliders(m, p.x, y, p.z, yaw, p.scale || 1)) world.add(col);
}
for (const s0 of L.scatter) {
  const s = models.has(s0.m) || !s0.alt ? s0 : { ...s0, m: s0.alt, scale: s0.scale * (s0.altScale || 1) };
  const m = models.get(s.m);
  if (!m || s.cover) continue;
  const y = height(s.x, s.z) - (s.rock ? 0.05 : 0.15);
  if (world.query(s.x - 1.2, s.z - 1.2, s.x + 1.2, s.z + 1.2).length) continue;
  for (const col of worldColliders(m, s.x, y, s.z, s.yaw * DEG, s.scale)) world.add(col);
}

