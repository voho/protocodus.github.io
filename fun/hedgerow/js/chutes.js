/* Hedgerow — parachutes in the trees.

   The airborne came down over these woods in the dark a month ago, and not
   every man found the ground: by the forest track a canopy still hangs
   where it caught in the crown of a tree, its silk draped over the
   branches and spilling down the side in great soft folds, torn, soaked
   and stained by weeks of rain, its rigging lines hanging in a sheaf below
   to where a man cut himself free. Pale in the dark wood, it catches the
   flares, the fires and the lightning; the gusts that bend the trees stir
   what hangs loose. The drape is worked out once, at load: a net of
   points with the silk's own lengths between them, snagged near its apex
   on the crown, falls and settles over the crown (the body its own
   branches and leaves fill) and the ground. One mesh for the canopies, one
   for their lines. */

import * as THREE from 'three';
import { GUST_GLSL } from './weather.js';
import { rng } from './util.js';
import { dimFillSpecular } from './fill.js';

const NR = 10, NS = 28;           // the canopy's rings out from its apex, and its points round each
const BROAD = /^(oak_a|oak_b|birch_a|tree_dead|oak_big|beech_big)$/;
const SPARSE = /^(birch_a|tree_dead)$/;   // bare or thin crowns: their branches fill less of the body round them
const LINE_R = 0.0025;            // a rigging line's radius (m)
const STEPS = 120, ITER = 5;      // the settling: steps of 1/60 s, passes over the lengths each

/* the silk: pale, its gores' seams running out from the apex, a band at half its depth and the hem
   at the skirt, the vent at the apex; stained in streaks and blotches by weeks of rain and mould, torn
   here and there (holes the alpha test cuts), the hem ragged. The canvas's rows run from the apex
   (v 0) out to the skirt (v 1), across it once round */
function silk() {
  const S = 512, R = rng(1906);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(214,208,190)';
  g.fillRect(0, 0, S, S);
  // blotches of grime and mould, and the streaks the rain washed out towards the hem
  for (let k = 0; k < 240; k++) {
    const x = R() * S, y = R() * S, r = 6 + R() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const col = R() < 0.6 ? '96,88,64' : '70,80,58';
    gr.addColorStop(0, `rgba(${col},${(0.05 + R() * 0.12).toFixed(3)})`);
    gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  for (let k = 0; k < 140; k++) {
    g.fillStyle = `rgba(84,76,56,${(0.04 + R() * 0.08).toFixed(3)})`;
    g.fillRect(R() * S, R() * S * 0.7, 1 + R() * 3, S * (0.1 + R() * 0.5));
  }
  // the 28 gores' seams, and the bands
  g.strokeStyle = 'rgba(140,130,100,0.55)';
  g.lineWidth = 2;
  for (let i = 0; i < 28; i++) { const x = (i / 28) * S + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
  g.fillStyle = 'rgba(150,140,112,0.6)';
  for (const v of [0.07, 0.5, 0.95]) g.fillRect(0, v * S - 3, S, 6);
  // the vent, the tears (more out towards the hem, where it caught on the branches) and a ragged hem
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S * 0.045);
  for (let k = 0; k < 11; k++) {
    const x = R() * S, y = S * (0.3 + 0.65 * Math.sqrt(R())), r = 4 + R() * 22;
    g.beginPath();
    for (let a = 0; a < 12; a++) {
      const t = (a / 12) * Math.PI * 2, q = r * (0.4 + R() * 0.8);
      g.lineTo(x + Math.cos(t) * q * 0.6, y + Math.sin(t) * q * 1.5);
    }
    g.fill();
  }
  g.beginPath();
  g.moveTo(0, S);
  for (let x = 0; x <= S; x += 4) g.lineTo(x, S * (0.975 - 0.03 * R() - (R() < 0.06 ? 0.06 * R() : 0)));
  g.lineTo(S, S);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/* a tree's crown in its model's own frame: the body its branches and leaves fill (an ellipsoid: a
   centre and half-sizes), from the model's points above a third of its height */
const crowns = new Map();
function crownOf(model, name) {
  let cr = crowns.get(model);
  if (cr) return cr;
  let top = 0;
  for (const prim of model.prims || []) {
    const P = prim.geometry?.attributes.position;
    if (P) for (let i = 0; i < P.count; i++) top = Math.max(top, P.getY(i));
  }
  const xs = [], ys = [], zs = [];
  for (const prim of model.prims || []) {
    const P = prim.geometry?.attributes.position;
    if (!P) continue;
    for (let i = 0; i < P.count; i++) {
      if (P.getY(i) < top * 0.36) continue;
      xs.push(P.getX(i)); ys.push(P.getY(i)); zs.push(P.getZ(i));
    }
  }
  if (xs.length < 20) return null;
  const span = (a, lo, hi) => {
    const s = Float32Array.from(a).sort(), q = (f) => s[Math.floor(f * (s.length - 1))];
    return [(q(lo) + q(hi)) / 2, (q(hi) - q(lo)) / 2];
  };
  const [cx, rx] = span(xs, 0.06, 0.94), [cy, ry] = span(ys, 0.04, 0.97), [cz, rz] = span(zs, 0.06, 0.94);
  const f = SPARSE.test(name) ? 0.62 : 1;
  cr = { c: new THREE.Vector3(cx, cy, cz), r: new THREE.Vector3(rx * f, ry * f, rz * f) };
  crowns.set(model, cr);
  return cr;
}

/* The canopy's drape on one tree (its placement's matrix M, its crown cr in the model's frame), the
   side it spills down turned towards the track (toward: a unit vector, level). Points (x, y, z) and,
   for each, how freely it hangs (0 lying on the crown, 1 hanging clear). */
function drape(M, cr, terrain, toward, R) {
  const Mi = M.clone().invert();
  const n = 1 + NR * NS, P = new Float32Array(n * 3), Q = new Float32Array(n * 3);
  const pinned = new Uint8Array(n), touch = new Float32Array(n);
  const Rc = 3.3 + R() * 0.8;
  // the flat silk: the apex, then ring after ring
  const flat = [[0, 0]];
  for (let i = 1; i <= NR; i++) for (let j = 0; j < NS; j++) {
    const a = (j / NS) * Math.PI * 2, r = (Rc * i) / NR;
    flat.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const id = (i, j) => (i === 0 ? 0 : 1 + (i - 1) * NS + (((j % NS) + NS) % NS));
  const cons = [];
  const tie = (a, b) => cons.push(a, b, Math.hypot(flat[a][0] - flat[b][0], flat[a][1] - flat[b][1]));
  for (let j = 0; j < NS; j++) {
    tie(0, id(1, j));
    for (let i = 1; i <= NR; i++) {
      tie(id(i, j), id(i, j + 1));                       // round the ring
      if (i < NR) { tie(id(i, j), id(i + 1, j)); tie(id(i, j), id(i + 1, j + 1)); tie(id(i, j + 1), id(i + 1, j)); }
      if (i < NR - 1) tie(id(i, j), id(i + 2, j));        // stiffer across two: the silk folds, not creases
      tie(id(i, j), id(i, j + 2));
    }
  }
  // snagged by its apex on the crown's flank turned to the track, a third of the way down from its
  // top, and by two points either side of it a little lower, caught on branches of their own: the
  // rest hangs down that side in folds, draped over what it meets
  const Yi = new THREE.Vector3(toward.x, 0, toward.z).transformDirection(Mi);
  const onCrown = (dx, dy, dz) => {
    const d = new THREE.Vector3(dx, dy, dz).normalize();
    return new THREE.Vector3(cr.c.x + d.x * cr.r.x * 1.03, cr.c.y + d.y * cr.r.y * 1.03, cr.c.z + d.z * cr.r.z * 1.03).applyMatrix4(M);
  };
  const lift = 0.35 + R() * 0.2, wide = 0.38 + R() * 0.12;
  const apex = onCrown(Yi.x, lift, Yi.z);
  const left = onCrown(Yi.x - Yi.z * wide, lift - 0.2, Yi.z + Yi.x * wide), right = onCrown(Yi.x + Yi.z * wide, lift - 0.25, Yi.z - Yi.x * wide);
  // to start with, flat at the apex's height, turned at random, crumpled (so it falls into folds of
  // its own, not a dome)
  const spin = R() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const [fx, fz] = flat[i], c = Math.cos(spin), s = Math.sin(spin), cr2 = Math.hypot(fx, fz) / Rc;
    P[i * 3] = apex.x + (fx * c - fz * s) * (1 - 0.15 * R() * cr2);
    P[i * 3 + 1] = apex.y + (R() - 0.5) * 0.7 * cr2;
    P[i * 3 + 2] = apex.z + (fx * s + fz * c) * (1 - 0.15 * R() * cr2);
  }
  // the snags: the apex, and the points of its third ring nearest each side's branch
  const snag = (i, at) => { P[i * 3] = at.x; P[i * 3 + 1] = at.y; P[i * 3 + 2] = at.z; pinned[i] = 1; };
  snag(0, apex);
  for (const at of [left, right]) {
    let best = -1, bd = 1e9;
    for (let j = 0; j < NS; j++) {
      const p = id(3, j), d = Math.hypot(P[p * 3] - at.x, P[p * 3 + 2] - at.z);
      if (d < bd && !pinned[p]) { bd = d; best = p; }
    }
    snag(best, at);
  }
  Q.set(P);
  // the placement's matrix and its inverse as plain numbers, the ground under the tree (the loop below
  // runs some millions of times)
  const me = M.elements, mi = Mi.elements;
  const cx = cr.c.x, cy = cr.c.y, cz = cr.c.z, rx = cr.r.x, ry = cr.r.y, rz = cr.r.z;
  const g0 = terrain.height(me[12], me[14]), g = 9.8 / 3600;
  // the crown holds it up (a body a little bigger than its leaves, so they show through only at its
  // edge), and the trunk below it, and the ground; where it lies, it clings
  const collide = (late) => {
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const o = i * 3, x = P[o], y = P[o + 1], z = P[o + 2];
      let mx = mi[0] * x + mi[4] * y + mi[8] * z + mi[12], my = mi[1] * x + mi[5] * y + mi[9] * z + mi[13], mz = mi[2] * x + mi[6] * y + mi[10] * z + mi[14];
      const qx = (mx - cx) / rx, qy = (my - cy) / ry, qz = (mz - cz) / rz, qq = Math.sqrt(qx * qx + qy * qy + qz * qz);
      let hit = false;
      if (qq < 1.02) {
        const f = 1.02 / Math.max(qq, 1e-4);
        mx = cx + qx * f * rx; my = cy + qy * f * ry; mz = cz + qz * f * rz;
        hit = true;
      } else if (my < cy) {
        const h = Math.sqrt(mx * mx + mz * mz);
        if (h < 0.45) { const f = 0.45 / Math.max(h, 1e-4); mx *= f; mz *= f; hit = true; }
      }
      if (hit) {
        P[o] = me[0] * mx + me[4] * my + me[8] * mz + me[12];
        P[o + 1] = me[1] * mx + me[5] * my + me[9] * mz + me[13];
        P[o + 2] = me[2] * mx + me[6] * my + me[10] * mz + me[14];
        for (let a = 0; a < 3; a++) Q[o + a] += (P[o + a] - Q[o + a]) * 0.8;
        if (late) touch[i] = 1;
      }
      if (P[o + 1] < g0 + 4) {
        const gy = terrain.height(P[o], P[o + 2]) + 0.05;
        if (P[o + 1] < gy) { P[o + 1] = gy; Q[o] = P[o]; Q[o + 2] = P[o + 2]; touch[i] = 1; }
      }
    }
  };
  for (let step = 0; step < STEPS; step++) {
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      for (let a = 0; a < 3; a++) {
        const o = i * 3 + a, vel = (P[o] - Q[o]) * 0.97;
        Q[o] = P[o];
        P[o] += vel - (a === 1 ? g : 0);
      }
    }
    for (let it = 0; it < ITER; it++) {
      for (let c = 0; c < cons.length; c += 3) {
        const a = cons[c] * 3, b = cons[c + 1] * 3, L = cons[c + 2];
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        // the silk does not stretch; it crumples freely (a slack length is all but left alone)
        const e = d > L ? (d - L) / d : (d - L) / d * 0.04;
        const wa = pinned[cons[c]] ? 0 : 1, wb = pinned[cons[c + 1]] ? 0 : 1, w = wa + wb;
        if (!w) continue;
        P[a] += dx * e * wa / w; P[a + 1] += dy * e * wa / w; P[a + 2] += dz * e * wa / w;
        P[b] -= dx * e * wb / w; P[b + 1] -= dy * e * wb / w; P[b + 2] -= dz * e * wb / w;
      }
      if (it % 3 === 2 || it === ITER - 1) collide(step > STEPS - 30);
    }
  }
  // how freely each point hangs: by how far it is from the nearest point that lies on something
  const free = new Float32Array(n);
  const lying = [];
  for (let i = 0; i < n; i++) if (touch[i] || pinned[i]) lying.push(i);
  for (let i = 0; i < n; i++) {
    let d = 1e9;
    for (const j of lying) d = Math.min(d, Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]));
    free[i] = Math.min(1, d / 2.2);
  }
  return { P, free, apex, Rc };
}

/* veg: the planted trees (vegetation.js: per kind its model and its placements); lines: the
   level's (the forest track); terrain; shared: the frame's time and wetness */
export function createChutes(veg, lines, terrain, shared, { count = 3, seed = 6 } = {}) {
  const track = lines?.TRACK;
  if (!veg?.kinds || !track) return null;
  const R = rng(seed), t0 = performance.now();
  // the track's nearest point to (x, z)
  const nearest = (x, z) => {
    let best = null;
    for (let i = 0; i < track.length - 1; i++) {
      const [ax, az] = track[i], [bx, bz] = track[i + 1], dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { d, x: px, z: pz };
    }
    return best;
  };
  // broadleaved trees beside the forest track, their crowns low enough to see from it
  const cand = [];
  for (const k of veg.kinds.values()) {
    if (!BROAD.test(k.name)) continue;
    const cr = crownOf(k.model, k.name);
    if (!cr) continue;
    for (const it of k.items) {
      if (it.z < 300 || it.z > 480) continue;
      const nt = nearest(it.x, it.z);
      if (nt.d < 5.5 || nt.d > 12) continue;
      const sc = new THREE.Vector3().setFromMatrixScale(it.m).x;
      if ((cr.c.y - cr.r.y) * sc > 9) continue;
      cand.push({ it, cr, nt, name: k.name });
    }
  }
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  const chosen = [];
  for (const c of cand) {
    if (chosen.length >= count) break;
    if (chosen.some((o) => Math.abs(o.it.z - c.it.z) < 45)) continue;
    chosen.push(c);
  }
  if (!chosen.length) return null;

  const pos = [], uv = [], free = [], idx = [];
  const lpos = [], lctr = [], lnrm = [], lsway = [], lidx = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3(), Bn = new THREE.Vector3();
  // a line from a to b sagging by sag, as a thin tube; sway: how far along the sheaf from the silk
  const tube = (a, b, sag, s0, s1) => {
    const base = lctr.length / 3, SEG = 8, SIDES = 4;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      C.lerpVectors(a, b, t); C.y -= sag * 4 * t * (1 - t);
      T.subVectors(b, a).normalize();
      N.set(0, 1, 0).cross(T); if (N.lengthSq() < 1e-6) N.set(1, 0, 0); N.normalize();
      Bn.crossVectors(T, N);
      for (let j = 0; j < SIDES; j++) {
        const q = (j / SIDES) * Math.PI * 2, nx = N.x * Math.cos(q) + Bn.x * Math.sin(q), ny = N.y * Math.cos(q) + Bn.y * Math.sin(q), nz = N.z * Math.cos(q) + Bn.z * Math.sin(q);
        lctr.push(C.x, C.y, C.z); lnrm.push(nx, ny, nz); lpos.push(C.x + nx * LINE_R, C.y + ny * LINE_R, C.z + nz * LINE_R);
        lsway.push(s0 + (s1 - s0) * t);
      }
    }
    for (let i = 0; i < SEG; i++) for (let j = 0; j < SIDES; j++) {
      const a0 = base + i * SIDES + j, b0 = base + i * SIDES + (j + 1) % SIDES;
      lidx.push(a0, b0, a0 + SIDES, b0, b0 + SIDES, a0 + SIDES);
    }
  };
  for (const { it, cr, nt } of chosen) {
    const toward = new THREE.Vector3(nt.x - it.x, 0, nt.z - it.z).normalize();
    const d = drape(it.m, cr, terrain, toward, R);
    const base = pos.length / 3, n = 1 + NR * NS;
    for (let i = 0; i < n; i++) {
      pos.push(d.P[i * 3], d.P[i * 3 + 1], d.P[i * 3 + 2]);
      const ring = i === 0 ? 0 : Math.floor((i - 1) / NS) + 1, j = i === 0 ? 0 : (i - 1) % NS;
      uv.push(j / NS, 1 - ring / NR);
      free.push(d.free[i]);
    }
    // the last column again, for the seam of the texture round it (u 1)
    const seam = pos.length / 3;
    for (let i = 1; i <= NR; i++) {
      const p = 1 + (i - 1) * NS;
      pos.push(d.P[p * 3], d.P[p * 3 + 1], d.P[p * 3 + 2]); uv.push(1, 1 - i / NR); free.push(d.free[p]);
    }
    const at = (i, j) => (i === 0 ? base : j === NS ? seam + i - 1 : base + 1 + (i - 1) * NS + j);
    for (let j = 0; j < NS; j++) {
      idx.push(at(0, 0), at(1, j), at(1, j + 1));
      for (let i = 1; i < NR; i++) {
        const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j), e = at(i + 1, j + 1);
        idx.push(a, c, b, b, c, e);
      }
    }
    // the rigging lines: from every other point round the skirt down to where they meet, below the
    // lowest of the hem, clear of a man's head over the ground; and the two risers below, cut
    const skirt = [];
    for (let j = 0; j < NS; j += 2) { const p = 1 + (NR - 1) * NS + j; skirt.push(new THREE.Vector3(d.P[p * 3], d.P[p * 3 + 1], d.P[p * 3 + 2])); }
    const low = skirt.slice().sort((a, b) => a.y - b.y).slice(0, 6);
    const meet = low.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(low.length);
    meet.addScaledVector(toward, 0.6);
    meet.y -= 3.2 + R() * 1.4;
    meet.y = Math.max(meet.y, terrain.height(meet.x, meet.z) + 2.3);
    for (const s of skirt) tube(s, meet, 0.04 + 0.12 * R(), 0, 1);
    for (const side of [-1, 1]) {
      A.copy(meet);
      B.copy(meet).add(new THREE.Vector3(side * 0.12 + (R() - 0.5) * 0.1, -0.6 - R() * 0.35, (R() - 0.5) * 0.15));
      tube(A, B, 0.01, 1, 1.25);
    }
  }

  const group = new THREE.Group();
  group.name = 'chutes';
  const uniforms = { uTime: shared.time, uWet: shared.wet, uWind: { value: new THREE.Vector2(1.4, 0.6) } };
  // the canopies
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aFree', new THREE.Float32BufferAttribute(free, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.boundingSphere.radius += 1;
  const map = silk();
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
  const MOVE = /* glsl */ `
    attribute float aFree;
    uniform float uTime, uWet;
    uniform vec2 uWind;
    ${GUST_GLSL}`;
  // what hangs clear swings out downwind in a gust and flutters; soaked, it is heavy and swings less
  const move = (shader, fabric) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + MOVE + (fabric ? '\nvarying float vFree;' : ''))
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float g = gust(position.xz, uTime, uWind);
        vec2 w = normalize(uWind);
        float a = aFree * aFree * mix(1.0, 0.6, uWet);
        transformed.xz += w * a * (0.1 + 0.32 * g) * (0.6 + 0.4 * sin(uTime * 1.3 + position.x * 0.7));
        transformed += normal * a * 0.06 * g * sin(uTime * 4.1 + position.y * 2.3 + position.x);
        ${fabric ? 'vFree = aFree;' : ''}
      }`);
  };
  mat.onBeforeCompile = (shader) => {
    move(shader, true);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;\nvarying float vFree;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        // soaked through: darker, and darker still where it lies in the leaves
        diffuseColor.rgb *= mix(1.0, 0.78, uWet) * mix(0.8, 1.0, vFree);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.6, uWet);`);
    dimFillSpecular(shader);
  };
  mat.customProgramCacheKey = () => 'hedgerow-chute';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'chute-canopies';
  mesh.castShadow = mesh.receiveShadow = true;
  for (const [key, M] of [['customDepthMaterial', THREE.MeshDepthMaterial], ['customDistanceMaterial', THREE.MeshDistanceMaterial]]) {
    const m = new M({ map, alphaTest: 0.5, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => move(shader, false);
    m.customProgramCacheKey = () => 'hedgerow-chute-' + key;
    mesh[key] = m;
  }
  group.add(mesh);
  // the lines: never thinner than about a pixel; they swing with what they hang from
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.Float32BufferAttribute(lpos, 3));
  lgeo.setAttribute('normal', new THREE.Float32BufferAttribute(lnrm, 3));
  lgeo.setAttribute('aCenter', new THREE.Float32BufferAttribute(lctr, 3));
  lgeo.setAttribute('aSway', new THREE.Float32BufferAttribute(lsway, 1));
  lgeo.setIndex(lidx);
  lgeo.computeBoundingSphere();
  lgeo.boundingSphere.radius += 1;
  const lmat = new THREE.MeshStandardMaterial({ color: '#b4ad96', roughness: 0.85, metalness: 0 });
  lmat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aCenter;
        attribute float aSway;
        uniform float uTime;
        uniform vec2 uWind;
        ${GUST_GLSL}`)
      .replace('#include <begin_vertex>', `
        float g = gust(aCenter.xz, uTime, uWind);
        vec3 transformed = aCenter + objectNormal * max(${LINE_R}, length(aCenter - cameraPosition) * 0.0009);
        transformed.xz += normalize(uWind) * aSway * aSway * (0.12 + 0.3 * g) * (0.6 + 0.4 * sin(uTime * 1.3 + aCenter.x * 0.7));`);
    dimFillSpecular(shader);
  };
  lmat.customProgramCacheKey = () => 'hedgerow-chute-lines';
  const lmesh = new THREE.Mesh(lgeo, lmat);
  lmesh.name = 'chute-lines';
  lmesh.receiveShadow = true;
  group.add(lmesh);
  crowns.clear();
  return { group, count: chosen.length, at: chosen.map(({ it, name }) => ({ name, x: it.x, z: it.z })), ms: performance.now() - t0 };
}
