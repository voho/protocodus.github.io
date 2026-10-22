/* Hedgerow — rooms behind the lit windows.

   A house's lit windows are baked into its emissive texture (the glow of a
   room seen through a curtain). At load the panes are found — triangles
   whose emissive texel is lit, grouped into flat, upright islands at least a
   hand's breadth across (so lanterns stay as they are) — and split off into
   a primitive of their own whose vertices carry the pane's frame:
   aWin = (across and up from the pane's centre in metres, half width,
   half height + 16 × a seed); the glowing curtains drawn back in front of a
   pane go with it (aWin 0), to glow less. Their material (materials.js, `rooms`) draws a
   room behind each pane by interior mapping: the view ray carries on through
   the glass into a box — papered walls, a floor, a beamed ceiling — with a
   table and a cupboard in it, lit by a lamp that throws their shadows, so
   the room moves with parallax as you walk past. Each room is drawn from
   its seed: its size, paper, floor, furniture, lamp and, in some, a lace
   half-curtain across the bottom of the window. Up close, rain is beaded on
   the glass (rmDrops): each bead a little lens bending the view of the
   room, its rim bright, now and then one running down. */

import * as THREE from 'three';

const LIT = 40;                  // an emissive texel this bright (0-255) is a lit window

/* Splits each baked primitive's lit panes off into a primitive of its own
   (same textures, a material flagged userData.rooms). In place. */
export function splitRooms(prims) {
  if (typeof document === 'undefined') return;     // the node checks build no rooms
  const add = [], read = new Map();
  for (const p of prims) {
    const src = p.material;
    const img = src?.emissiveMap?.image;
    if (!img || /lamp/.test(src.name || '')) continue;
    if (!read.has(img)) read.set(img, pixels(img));
    const px = read.get(img);
    const parts = px && panes(p.geometry, px);
    if (!parts) continue;
    p.geometry = parts.rest;
    let rooms = roomMats.get(src);
    if (!rooms) {
      rooms = src.clone();
      rooms.name = src.name;
      rooms.userData = { ...src.userData, rooms: true };
      roomMats.set(src, rooms);
    }
    add.push({ geometry: parts.panes, key: p.key, material: rooms, node: p.node });
  }
  prims.push(...add);
}
const roomMats = new WeakMap();

function pixels(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
}

/* The lit panes of a non-indexed geometry: {panes, rest} or null. */
function panes(geo, px) {
  const P = geo.attributes.position.array, U = geo.attributes.uv.array, NV = geo.attributes.normal.array;
  const nt = P.length / 9;
  const lit = new Uint8Array(nt);
  const W = px.w, H = px.h, D = px.data;
  const SAMPLES = [[1 / 3, 1 / 3], [0.6, 0.2], [0.2, 0.6], [0.2, 0.2]];
  let any = false;
  for (let t = 0; t < nt; t++) {
    // the texel at the triangle's centre and a little toward each corner: a pane's
    // triangles are lit all over, a sliver at an island's edge is not
    let hits = 0;
    for (const [a, b] of SAMPLES) {
      const c = 1 - a - b, o = t * 6;
      const u = U[o] * a + U[o + 2] * b + U[o + 4] * c, v = U[o + 1] * a + U[o + 3] * b + U[o + 5] * c;
      const x = Math.min(W - 1, Math.max(0, Math.floor(u * W))), y = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
      const i = (y * W + x) * 4;
      if (Math.max(D[i], D[i + 1], D[i + 2]) > LIT) hits++;
    }
    if (hits >= 3) { lit[t] = 1; any = true; }
  }
  if (!any) return null;

  // islands: lit triangles sharing a corner (to the millimetre)
  const parent = new Int32Array(nt);
  for (let i = 0; i < nt; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const corner = new Map();
  for (let t = 0; t < nt; t++) {
    if (!lit[t]) continue;
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      const key = Math.round(P[o] * 1000) + ',' + Math.round(P[o + 1] * 1000) + ',' + Math.round(P[o + 2] * 1000);
      const prev = corner.get(key);
      if (prev === undefined) corner.set(key, t); else parent[find(t)] = find(prev);
    }
  }
  const islands = new Map();
  for (let t = 0; t < nt; t++) if (lit[t]) {
    const r = find(t);
    if (!islands.has(r)) islands.set(r, []);
    islands.get(r).push(t);
  }

  // a pane: flat, upright, big enough; its frame (across, up) and extent in it
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3(), n = new THREE.Vector3();
  const T = new THREE.Vector3(), B = new THREE.Vector3(), p = new THREE.Vector3();
  const win = new Float32Array(nt * 12);
  const isPane = new Uint8Array(nt);
  const found = [], others = [];
  let count = 0;
  for (const tris of islands.values()) {
    others.push(tris);
    n.set(0, 0, 0);
    let area = 0;
    for (const t of tris) {
      const o = t * 9;
      e1.set(P[o + 3] - P[o], P[o + 4] - P[o + 1], P[o + 5] - P[o + 2]);
      e2.set(P[o + 6] - P[o], P[o + 7] - P[o + 1], P[o + 8] - P[o + 2]);
      fn.crossVectors(e1, e2);
      area += fn.length() / 2;
      // the face as the vertex normals have it (they are what the shader sees)
      if (fn.x * NV[o] + fn.y * NV[o + 1] + fn.z * NV[o + 2] < 0) fn.negate();
      n.add(fn);
    }
    n.normalize();
    if (area < 0.1 || Math.abs(n.y) > 0.25) continue;
    let flat = true;
    for (const t of tris) {
      const o = t * 9;
      if (NV[o] * n.x + NV[o + 1] * n.y + NV[o + 2] * n.z < 0.985) { flat = false; break; }
    }
    if (!flat) continue;
    T.set(n.z, 0, -n.x).normalize();
    B.crossVectors(n, T);
    let s0 = Infinity, s1 = -Infinity, u0 = Infinity, u1 = -Infinity;
    for (const t of tris) for (let k = 0; k < 3; k++) {
      p.fromArray(P, t * 9 + k * 3);
      const s = p.dot(T), u = p.dot(B);
      s0 = Math.min(s0, s); s1 = Math.max(s1, s); u0 = Math.min(u0, u); u1 = Math.max(u1, u);
    }
    const hw = (s1 - s0) / 2, hh = (u1 - u0) / 2;
    if (hw < 0.15 || hh < 0.1) continue;
    const sc = (s0 + s1) / 2, uc = (u0 + u1) / 2;
    others.pop();
    found.push({ n: n.clone(), T: T.clone(), B: B.clone(), d: p.dot(n), sc, uc, hw, hh });
    const seed = Math.floor(hash3(sc, uc, n.x * 7 + n.z * 13) * 64);
    for (const t of tris) {
      isPane[t] = 1;
      for (let k = 0; k < 3; k++) {
        p.fromArray(P, t * 9 + k * 3);
        win.set([p.dot(T) - sc, p.dot(B) - uc, hw, hh + 16 * seed], t * 12 + k * 4);
      }
    }
    count += tris.length;
  }
  if (!count) return null;
  // the curtains drawn back in front of a pane glow with the room's light too: they go with
  // the panes, without a room (aWin 0), to be dimmed to the room's level
  for (const tris of others) {
    p.set(0, 0, 0);
    for (const t of tris) for (let k = 0; k < 9; k += 3) p.x += P[t * 9 + k], p.y += P[t * 9 + k + 1], p.z += P[t * 9 + k + 2];
    p.multiplyScalar(1 / (tris.length * 3));
    const near = found.some((f) => Math.abs(p.dot(f.n) - f.d) < 0.15
      && Math.abs(p.dot(f.T) - f.sc) < f.hw + 0.08 && Math.abs(p.dot(f.B) - f.uc) < f.hh + 0.15);
    if (!near) continue;
    for (const t of tris) isPane[t] = 1;
    count += tris.length;
  }

  const pick = (want, withWin) => {
    const n3 = want === 1 ? count : nt - count;
    const out = new THREE.BufferGeometry();
    for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) {
      const a = geo.attributes[name].array, dst = new Float32Array(n3 * 3 * size);
      let j = 0;
      for (let t = 0; t < nt; t++) if (isPane[t] === want) { dst.set(a.subarray(t * 3 * size, (t + 1) * 3 * size), j); j += 3 * size; }
      out.setAttribute(name, new THREE.BufferAttribute(dst, size));
    }
    if (withWin) {
      const dst = new Float32Array(n3 * 12);
      let j = 0;
      for (let t = 0; t < nt; t++) if (isPane[t]) { dst.set(win.subarray(t * 12, t * 12 + 12), j); j += 12; }
      out.setAttribute('aWin', new THREE.BufferAttribute(dst, 4));
    }
    return out;
  };
  const rest = pick(0, false), pn = pick(1, true);
  // the panes themselves, for what hits them (paneRects): centre, facing, across, up, half sizes
  pn.userData.panes = found.map((f) => ({
    c: f.T.clone().multiplyScalar(f.sc).addScaledVector(f.B, f.uc).addScaledVector(f.n, f.d), n: f.n, T: f.T, B: f.B, hw: f.hw, hh: f.hh,
  }));
  geo.dispose();
  return { rest, panes: pn };
}

/* The lit panes of the placed houses in the world: `props` as levelBuild places them
   ({m, x, y, z, yaw, scale}); each {c, n, T, B, hw, hh, prop} (centre, facing, across, up, half
   sizes, and the placement it's in). */
export function paneRects(props) {
  const out = [], q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const pr of props) {
    q.setFromAxisAngle(up, pr.yaw || 0);
    const k = pr.scale || 1;
    for (const prim of pr.m.prims || []) {
      for (const f of prim.geometry?.userData?.panes || []) {
        out.push({
          c: f.c.clone().applyQuaternion(q).multiplyScalar(k).add(new THREE.Vector3(pr.x, pr.y, pr.z)),
          n: f.n.clone().applyQuaternion(q), T: f.T.clone().applyQuaternion(q), B: f.B.clone().applyQuaternion(q),
          hw: f.hw * k, hh: f.hh * k, prop: pr,
        });
      }
    }
  }
  return out;
}

function hash3(a, b, c) {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return x - Math.floor(x);
}

/* A placement's own rooms: shifts the seeds of a pane geometry's copy. */
export function reseedRooms(geo, x, z) {
  const a = geo.attributes.aWin;
  if (!a) return;
  const k = 16 * Math.floor(hash3(x, z, 0.5) * 64);
  for (let i = 0; i < a.count; i++) a.setW(i, a.getW(i) + k);
}

/* How bright the rooms are (shared by every rooms material). */
export const ROOM_UNIFORMS = { uRoomGain: { value: 3.0 }, uCurtainGain: { value: 0.35 } };

/* The room behind a pane (interior mapping). pw: the point on the pane
   (across, up from its centre), d: the view ray in the pane's frame (across,
   up, into the room), hs: the pane's half size. Linear radiance. */
export const ROOMS_GLSL = /* glsl */`
  uniform float uRoomGain, uCurtainGain;
  float rmHash(float n) { return fract(sin(n * 78.233 + 0.5) * 43758.5453); }
  float rmHash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // a ray from outside an axis-aligned box: where it enters (1e9 if it misses), and the face
  float rmBox(vec3 o, vec3 id, vec3 bmin, vec3 bmax, out vec3 n) {
    vec3 t0 = (bmin - o) * id, t1 = (bmax - o) * id;
    vec3 tn = min(t0, t1), tf = max(t0, t1);
    float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z);
    n = vec3(0.0);
    if (a > b || b <= 0.0) return 1e9;
    n = a == tn.x ? vec3(-sign(id.x), 0.0, 0.0) : a == tn.y ? vec3(0.0, -sign(id.y), 0.0) : vec3(0.0, 0.0, -sign(id.z));
    return a;
  }
  vec3 rmSafeInv(vec3 d) {
    return 1.0 / vec3(abs(d.x) < 1e-5 ? 1e-5 : d.x, abs(d.y) < 1e-5 ? 1e-5 : d.y, abs(d.z) < 1e-5 ? 1e-5 : d.z);
  }
  vec3 rmRoom(vec2 pw, vec3 d, vec2 hs, float seed, float time) {
    float r1 = rmHash(seed), r2 = rmHash(seed + 1.31), r3 = rmHash(seed + 2.93), r4 = rmHash(seed + 4.17);
    float r5 = rmHash(seed + 5.71), r6 = rmHash(seed + 7.33), r7 = rmHash(seed + 8.97), r8 = rmHash(seed + 10.71);
    // the room: wider than the window, its sill a little under a metre (less for a tall window)
    float W = max(2.0 * hs.x + 1.4, 2.9 + 1.6 * r1);
    float D = 2.9 + 1.9 * r2;
    float H = max(2.4 + 0.35 * r3, 2.0 * hs.y + 0.6);
    float sill = clamp(H - 0.45 - 2.0 * hs.y, 0.04, 0.95);
    float cx = (r4 - 0.5) * max(W - 2.0 * hs.x - 0.6, 0.0);
    vec3 o = vec3(pw.x + cx, pw.y + sill + hs.y, 0.0);
    d.z = max(d.z, 1e-3);
    vec3 id = rmSafeInv(d);
    // walls, floor and ceiling, seen from inside
    float tx = ((d.x > 0.0 ? 0.5 : -0.5) * W - o.x) * id.x;
    float ty = ((d.y > 0.0 ? H : 0.0) - o.y) * id.y;
    float tz = D * id.z;
    float t = min(min(tx, ty), tz);
    vec3 n = t == tz ? vec3(0.0, 0.0, -1.0) : t == tx ? vec3(-sign(d.x), 0.0, 0.0) : vec3(0.0, -sign(d.y), 0.0);
    int what = t == tz ? 0 : t == tx ? 1 : d.y < 0.0 ? 2 : 3;      // back wall, side wall, floor, ceiling
    // a table (cloth-covered top, four legs) and a tall cupboard against the back wall
    vec2 tc = vec2(mix(-0.5 * W + 0.85, 0.5 * W - 0.85, r5), mix(1.0, D - 1.05, r6));
    vec3 tMin = vec3(tc.x - 0.6, 0.6, tc.y - 0.42), tMax = vec3(tc.x + 0.6, 0.77, tc.y + 0.42);
    vec3 fn;
    float tt = rmBox(o, id, tMin, tMax, fn);
    if (tt < t) { t = tt; n = fn; what = 4; }
    for (int k = 0; k < 4; k++) {
      vec2 c = tc + vec2(k < 2 ? -0.54 : 0.54, (k == 0 || k == 2) ? -0.36 : 0.36);
      tt = rmBox(o, id, vec3(c.x - 0.03, 0.0, c.y - 0.03), vec3(c.x + 0.03, 0.6, c.y + 0.03), fn);
      if (tt < t) { t = tt; n = fn; what = 5; }
    }
    float ax = mix(-0.5 * W + 0.15, 0.5 * W - 1.35, r7);
    vec3 aMin = vec3(ax, 0.0, D - 0.55), aMax = vec3(ax + 1.2, 1.95 + 0.15 * r3, D);
    tt = rmBox(o, id, aMin, aMax, fn);
    if (tt < t) { t = tt; n = fn; what = 6; }
    vec3 h = o + d * t;

    // the lamp: an oil lamp on the table, or a lamp hanging over it
    bool hanging = r8 > 0.6;
    vec3 lp = hanging ? vec3(tc.x, H - 0.62, tc.y) : vec3(tc.x + 0.3 * (r2 - 0.5), 1.0, tc.y + 0.2 * (r1 - 0.5));
    float flick = 1.0 + 0.05 * sin(time * 7.3 + seed * 3.1) * sin(time * 11.9 + seed);
    vec3 lc = (hanging ? vec3(1.0, 0.66, 0.36) : vec3(1.0, 0.56, 0.24)) * mix(1.6, 2.6, r6) * flick;

    // what it is made of
    vec3 paper = r8 < 0.2 ? vec3(0.2, 0.22, 0.15) : r8 < 0.4 ? vec3(0.33, 0.25, 0.13) : r8 < 0.6 ? vec3(0.3, 0.19, 0.15)
      : r8 < 0.8 ? vec3(0.17, 0.2, 0.23) : vec3(0.45, 0.42, 0.36);
    vec3 alb;
    float e;                                         // how far from the surface's edges (for the corners' gloom)
    if (what <= 1) {
      vec2 q = what == 0 ? h.xy : vec2(h.z, h.y);
      e = what == 0 ? min(0.5 * W - abs(h.x), min(h.y, H - h.y)) : min(D - h.z, min(h.y, H - h.y));
      // wallpaper: stripes or a small motif, faded
      float pat = r3 < 0.45 ? mix(1.0, 0.86, step(0.5, fract(q.x * 3.6)))
        : mix(0.8, 1.0, smoothstep(0.13, 0.2, length(fract(q * 5.0 + vec2(0.5 * step(0.5, fract(q.y * 2.5)), 0.0)) - 0.5)));
      alb = paper * pat * (0.9 + 0.2 * rmHash2(floor(q * 1.3)));
      // dark boards below a rail
      if (q.y < 0.88) alb = vec3(0.15, 0.095, 0.055) * (0.75 + 0.35 * rmHash2(vec2(floor(q.x / 0.13), seed))) * (fract(q.x / 0.13) < 0.06 ? 0.5 : 1.0);
      if (abs(q.y - 0.9) < 0.025) alb = vec3(0.2, 0.13, 0.075);
      if (q.y < 0.1) alb = vec3(0.08, 0.05, 0.03);
      if (what == 0) {
        // a picture on the back wall, in a dark frame
        vec2 pq = h.xy - vec2(mix(-0.5 * W + 0.6, 0.5 * W - 0.6, rmHash(seed + 12.3)), 1.62);
        vec2 ap = abs(pq);
        if (ap.x < 0.3 && ap.y < 0.23) {
          alb = (ap.x > 0.25 || ap.y > 0.18) ? vec3(0.22, 0.15, 0.06)
            : mix(vec3(0.07, 0.08, 0.05), vec3(0.2, 0.17, 0.1), smoothstep(-0.18, 0.12, pq.y + 0.05 * sin(pq.x * 17.0)));
        }
      } else if ((h.x > 0.0) == (r4 > 0.5)) {
        // a doorway in one side wall, into the dark of the next room
        float dz = mix(0.45, max(0.5, D - 1.5), rmHash(seed + 14.1));
        if (h.z > dz && h.z < dz + 0.95 && h.y < 2.05) {
          bool frame = h.z < dz + 0.07 || h.z > dz + 0.88 || h.y > 1.98;
          alb = frame ? vec3(0.17, 0.11, 0.06) : vec3(0.004);
        }
      }
    } else if (what == 2) {
      e = min(0.5 * W - abs(h.x), D - h.z);
      if (r1 > 0.5) {
        // boards running into the room
        float id0 = floor(h.x / 0.16);
        alb = vec3(0.21, 0.13, 0.07) * (0.7 + 0.4 * rmHash2(vec2(id0, seed)));
        if (fract(h.x / 0.16) < 0.05 || fract(h.z / 1.9 + rmHash2(vec2(id0, 3.0))) < 0.012) alb *= 0.45;
      } else {
        // red tiles
        vec2 tq = h.xz / 0.19;
        alb = vec3(0.36, 0.13, 0.07) * (0.75 + 0.35 * rmHash2(floor(tq)));
        vec2 f = abs(fract(tq) - 0.5);
        if (max(f.x, f.y) > 0.46) alb = vec3(0.16, 0.13, 0.1);
      }
      // a rug under the table
      vec2 rq = abs(h.xz - tc);
      if (rq.x < 0.95 && rq.y < 0.78) alb = (rq.x > 0.82 || rq.y > 0.65) ? vec3(0.38, 0.27, 0.1) : vec3(0.28, 0.05, 0.04) * (0.85 + 0.15 * sin(h.x * 40.0) * sin(h.z * 40.0));
    } else if (what == 3) {
      e = min(0.5 * W - abs(h.x), D - h.z);
      // plaster between dark joists, a beam across
      alb = vec3(0.5, 0.47, 0.4);
      if (fract(h.x / 0.52 + r5) < 0.26 || abs(h.z - D * 0.55) < 0.13) alb = vec3(0.1, 0.065, 0.04);
    } else if (what == 4) {
      e = 1.0;
      // the cloth: red-and-white check, plain white or bare boards
      vec2 cq = n.y > 0.5 ? h.xz : abs(n.x) > 0.5 ? h.zy : h.xy;
      alb = r3 > 0.66 ? vec3(0.2, 0.12, 0.065)
        : r3 > 0.33 ? vec3(0.62, 0.6, 0.54)
        : mix(vec3(0.62, 0.58, 0.5), vec3(0.42, 0.05, 0.04), mod(floor(cq.x / 0.07) + floor(cq.y / 0.07), 2.0));
    } else if (what == 5) {
      e = 1.0;
      alb = vec3(0.1, 0.065, 0.04);
    } else {
      e = 1.0;
      // the cupboard: dark oak, two panelled doors, a cornice
      alb = vec3(0.13, 0.08, 0.045);
      if (n.z < -0.5) {
        vec2 cq = vec2(h.x - ax, h.y);
        float dx = abs(fract(cq.x / 0.6) - 0.5) * 0.6;
        if (cq.y > aMax.y - 0.12) alb = vec3(0.17, 0.105, 0.06);
        else if (dx < 0.21 && abs(fract(cq.y / ((aMax.y - 0.2) * 0.5)) - 0.5) < 0.38) alb *= 1.25;
        if (abs(cq.x - 0.6) < 0.01) alb *= 0.4;
      }
    }

    // the lamp's light (with the table's and the cupboard's shadows), a little bounced light,
    // and darker corners
    vec3 tl = lp - h;
    float r2l = dot(tl, tl);
    vec3 l = tl * inversesqrt(r2l);
    float nl = max(dot(n, l), 0.0);
    if (hanging) nl *= mix(0.3, 1.0, smoothstep(-0.1, 0.5, -l.y));       // the shade throws it down
    vec3 sp = h + n * 0.004, sid = rmSafeInv(lp - sp);
    float sh = 1.0;
    if (rmBox(sp, sid, tMin, tMax, fn) < 1.0 || rmBox(sp, sid, aMin, aMax, fn) < 1.0) sh = 0.12;
    float gloom = 0.3 + 0.7 * smoothstep(0.0, 0.9, e);
    vec3 col = alb * (lc * (nl * sh / (r2l + 0.2)) + lc * 0.05 * gloom) * gloom;
    // the lamp itself, in front of what the ray hit
    float tl0 = dot(lp - o, d);
    if (tl0 > 0.0 && tl0 < t) {
      vec3 dl = o + d * tl0 - lp;
      float q2 = dot(dl, dl);
      col += lc * (exp(-q2 / 0.0005) * 3.0 + exp(-q2 / 0.012) * 0.35);
    }
    return col * uRoomGain;
  }
  // rain on the glass: beads of it, each a little lens over the room behind (the view through it
  // bent towards its edge, so it shows the room turned about its middle), its rim bright with the
  // room's light, and now and then one running down in a column; nothing where the drops would be
  // under a pixel (fw: metres a pixel). xy: the slope it gives the view through it, z: how much
  // of a bead's rim is here
  vec3 rmDrops(vec2 p, float time, float fw) {
    float near = 1.0 - smoothstep(0.003, 0.007, fw);
    if (near <= 0.0) return vec3(0.0);
    vec3 r = vec3(0.0);
    // the beads, on a 3.5 cm grid, about half its cells holding one
    vec2 g = p / 0.035, id = floor(g), f = fract(g) - 0.5;
    if (rmHash2(id + 0.37) < 0.55) {
      vec2 c = (vec2(rmHash2(id + 3.1), rmHash2(id + 7.7)) - 0.5) * 0.4;
      float rad = 0.16 + 0.22 * rmHash2(id + 11.3);
      vec2 d = (f - c) / rad;
      float l2 = dot(d, d);
      if (l2 < 1.0) {
        r.xy = -d * (1.0 - 0.5 * sqrt(1.0 - l2));
        r.z = smoothstep(0.55, 0.95, sqrt(l2)) * (0.35 + 0.65 * smoothstep(-0.2, 0.8, dot(d, vec2(-0.6, 0.8)) / max(sqrt(l2), 1e-3)));
      }
    }
    // running drops: columns 7 cm wide, now and then a drop sliding down with a thin wet trail
    float col = floor(p.x / 0.07), fx = fract(p.x / 0.07) - 0.5;
    float speed = 0.05 + 0.08 * rmHash2(vec2(col, 1.3));
    float y = fract((p.y + time * speed) / 0.9 + rmHash2(vec2(col, 7.1)));
    float wob = sin(p.y * 40.0 + col) * 0.06;
    if (rmHash2(vec2(col, 4.4)) < 0.35) {
      vec2 d = vec2((fx - wob) / 0.09, (y - 0.06) / 0.05);
      float l2 = dot(d, d);
      if (l2 < 1.0) { r.xy += -d * (1.0 - 0.5 * sqrt(1.0 - l2)); r.z = max(r.z, smoothstep(0.5, 0.95, sqrt(l2)) * 0.8); }
      else if (y > 0.06 && y < 0.5 && abs(fx - wob) < 0.035) r.xy += vec2((fx - wob) * 6.0, 0.0);
    }
    return r * near;
  }
  // a lace half-curtain on a rod across the lower part of some windows, glowing with the room
  // behind it; its holes melt into an even veil where they get too fine to draw (fw: metres a
  // pixel)
  vec3 rmLace(vec3 room, vec2 pw, vec2 hs, float seed, float fw) {
    if (rmHash(seed + 17.3) > 0.45 || hs.y < 0.3) return room;
    float top = -hs.y + min(0.9 * hs.y, 0.62);
    if (pw.y > top) return room;
    vec2 q = pw * vec2(30.0, 30.0);
    float thread = smoothstep(0.17, 0.27, length(fract(q + vec2(0.5 * step(0.5, fract(q.y * 0.5)), 0.0)) - 0.5));
    thread = mix(thread, 0.6, smoothstep(0.25, 0.8, fw * 30.0));
    float fold = 0.8 + 0.2 * sin(pw.x * 26.0 + rmHash(seed) * 6.0);
    vec3 glow = vec3(1.0, 0.62, 0.32) * 0.09 * uRoomGain * fold;
    // a hem along the rod
    if (pw.y > top - 0.025) thread = 1.0;
    return mix(room, glow, mix(0.4, 0.9, thread));
  }
`;
