/* Hedgerow — the village has been fought over.

   The walls that look onto the lane, the street, the square and the forest
   track carry what was fired at them before you came: plaster blown off in
   patches down to the rubble stone or the brick under it, and bursts of
   machine-gun fire stitched across plaster and stone, now and then the
   crater a cannon shell left. All of it is put down at load from each
   building's own shape: a side of a model is drawn once (the first time a
   wall needs it), in software, into a grid of what is in front every 5 cm:
   how far out, how squarely it faces that way, the colour of its texture
   there. A mark goes only where the wall is open and even across its whole
   size, so never over a window, a shutter, a beam, a drainpipe, a corner or
   the ivy, and a plaster break only on a house's plaster (light and plain).
   How many marks a wall gets goes by how open the ground in front of it is
   and how near that is to the lines the fighting follows. High on the most
   exposed houses' plaster, a few old painted advertisements, which the
   breaks and the bursts go through. The marks are
   pinned decals in the bullet holes' own meshes (atmosphere.js; the breaks
   one more): the fighting never wears them away. Seeded, so the village is
   the same every time. */

import { rng, polylineDistance, smoothstep } from './util.js';

const STEP = 0.05;            // the grid's cell (m)
const TOP = 5.5;              // nothing marked higher on a wall than this (m over the model's base)
const BUILT = /^(house|barn|ruin|bunker)|^church$/;
const PLASTERED = /^house/;
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const SIGN = [4.2, 3.7, 3.3], SIGNS = 5;     // a painted advertisement's widths to try (m), and how many

/* a texture's colours, readable: drawn once at up to 1024 (enough to tell plaster, stone and a window apart) */
function texels(tex) {
  const img = tex?.image;
  if (!img || !img.width) return null;
  const S = Math.min(1024, img.width);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, S, S);
  return { S, data: g.getImageData(0, 0, S, S).data, flip: !!tex.flipY };
}

/* an attribute's values packed in a plain array (a glTF's may come interleaved or quantised) */
function floats(a) {
  if (!a.isInterleavedBufferAttribute && !a.normalized && a.array instanceof Float32Array) return a.array;
  const out = new Float32Array(a.count * a.itemSize), get = ['getX', 'getY', 'getZ'];
  for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a[get[c]](i);
  return out;
}

/* One side of a model, the one facing (dx, 0, dz) in its own space. For every cell of it (u across,
   v up) the front-most surface: how far out along the facing, how squarely it faces that way, and
   its colour (lightness and saturation, 0-255; none where `look` has no texture for the triangle's
   part: a window, the ivy). Only the triangles turned towards the side are drawn. */
function rasterSide(model, dx, dz, look) {
  const ux = dz, uz = -dx, b = model.box;
  const us = [b.min.x * ux + b.min.z * uz, b.max.x * ux + b.max.z * uz, b.min.x * ux + b.max.z * uz, b.max.x * ux + b.min.z * uz];
  const u0 = Math.min(...us), v0 = b.min.y;
  const W = Math.ceil((Math.max(...us) - u0) / STEP), H = Math.ceil((Math.min(b.max.y, v0 + TOP) - v0) / STEP);
  const depth = new Float32Array(W * H).fill(-1e9), face = new Float32Array(W * H);
  const tu = new Float32Array(W * H), tv = new Float32Array(W * H), part = new Int8Array(W * H).fill(-1);
  model.prims.forEach((pr, pi) => {
    const g = pr.geometry, idx = g.index;
    if (!g.attributes.uv) return;
    const P = floats(g.attributes.position), T = floats(g.attributes.uv), n = idx ? idx.count : g.attributes.position.count;
    for (let t = 0; t < n; t += 3) {
      const a = idx ? idx.getX(t) : t, bi = idx ? idx.getX(t + 1) : t + 1, ci = idx ? idx.getX(t + 2) : t + 2;
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const bx = P[bi * 3], by = P[bi * 3 + 1], bz = P[bi * 3 + 2];
      const cx = P[ci * 3], cy = P[ci * 3 + 1], cz = P[ci * 3 + 2];
      // how squarely it faces this side: its normal's share along the facing
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const f = (nx * dx + nz * dz) / (Math.hypot(nx, ny, nz) || 1);
      if (!(f > 0.05)) continue;
      const p0 = ax * ux + az * uz, p1 = bx * ux + bz * uz, p2 = cx * ux + cz * uz;
      const d0 = ax * dx + az * dz, d1 = bx * dx + bz * dz, d2 = cx * dx + cz * dz;
      const area = (p1 - p0) * (cy - ay) - (p2 - p0) * (by - ay);
      if (Math.abs(area) < 1e-9) continue;
      const ua = T[a * 2], va = T[a * 2 + 1], ub = T[bi * 2], vb = T[bi * 2 + 1], uc = T[ci * 2], vc = T[ci * 2 + 1];
      const i0 = Math.max(0, Math.ceil((Math.min(p0, p1, p2) - u0) / STEP - 0.5)), i1 = Math.min(W - 1, Math.floor((Math.max(p0, p1, p2) - u0) / STEP - 0.5));
      const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - v0) / STEP - 0.5)), j1 = Math.min(H - 1, Math.floor((Math.max(ay, by, cy) - v0) / STEP - 0.5));
      for (let j = j0; j <= j1; j++) {
        const v = v0 + (j + 0.5) * STEP;
        for (let i = i0; i <= i1; i++) {
          const u = u0 + (i + 0.5) * STEP;
          const w1 = ((u - p0) * (cy - ay) - (p2 - p0) * (v - ay)) / area, w2 = ((p1 - p0) * (v - ay) - (u - p0) * (by - ay)) / area, w0 = 1 - w1 - w2;
          if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
          const d = w0 * d0 + w1 * d1 + w2 * d2, k = j * W + i;
          if (d <= depth[k]) continue;
          depth[k] = d; face[k] = f; part[k] = pi;
          tu[k] = w0 * ua + w1 * ub + w2 * uc;
          tv[k] = w0 * va + w1 * vb + w2 * vc;
        }
      }
    }
  });
  const lum = new Uint8Array(W * H), sat = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const t = part[k] >= 0 ? look(part[k]) : null;
    if (!t) continue;
    const x = (((tu[k] % 1) + 1) % 1 * t.S) | 0, y = (((((t.flip ? 1 - tv[k] : tv[k]) % 1) + 1) % 1) * t.S) | 0;
    const o = (y * t.S + x) * 4, r = t.data[o], g = t.data[o + 1], bl = t.data[o + 2], mx = Math.max(r, g, bl);
    lum[k] = (r + g + bl) / 3;
    sat[k] = mx ? ((mx - Math.min(r, g, bl)) / mx) * 255 : 0;
  }
  return { dx, dz, ux, uz, u0, v0, W, H, depth, face, lum, sat };
}

/* is the rectangle hw cells across and hh up and down round (i, j) open wall: one surface facing about
   square on, no step in it (a shutter's edge, a window's reveal: a decal is drawn PULL nearer the eye
   than where it lies, which covers a plaster's gentle bulge but not those), nothing dark in it (a
   window, an opening, a gap); and for plaster, light and plain (bar a few grimy cells) */
function fits(s, i, j, hw, hh, plaster) {
  if (i - hw < 0 || j - hh < 0 || i + hw >= s.W || j + hh >= s.H) return false;
  const d0 = s.depth[j * s.W + i];
  let m = 0, m2 = 0, n = 0, off = 0;
  for (let y = j - hh; y <= j + hh; y++) {
    for (let x = i - hw; x <= i + hw; x++) {
      const k = y * s.W + x, l = s.lum[k], d = s.depth[k];
      if (s.face[k] < 0.9 || Math.abs(d - d0) > 0.05 || l < 45) return false;
      if ((x > i - hw && Math.abs(d - s.depth[k - 1]) > 0.012) || (y > j - hh && Math.abs(d - s.depth[k - s.W]) > 0.012)) return false;
      if (plaster && (l < 105 || s.sat[k] > 75)) off++;
      m += l; m2 += l * l; n++;
    }
  }
  m /= n;
  return !plaster || (off < n * 0.08 && m2 / n - m * m < 22 * 22);
}

/* a model's side, with its open wall cells (where marks may go) and how much of it there is; null where
   there is too little. `tex`: the model's colours, read on first use */
function sideOf(model, dx, dz, tex) {
  // only the model's main part has wall on it (the others: its windows, the ivy)
  let main = 0;
  model.prims.forEach((p, i) => { if (p.geometry.attributes.position.count > model.prims[main].geometry.attributes.position.count) main = i; });
  const t = tex(main);
  if (!t) return null;
  const s = rasterSide(model, dx, dz, (pi) => (pi === main ? t : null));
  s.cells = [];
  for (let k = 0; k < s.W * s.H; k++) if (s.face[k] >= 0.95 && s.lum[k] >= 45 && ((k / s.W) | 0) * STEP >= 0.25) s.cells.push(k);
  if (s.cells.length < 400) return null;
  s.area = s.cells.length * STEP * STEP;
  return s;
}

/* Marks the walls of the buildings in `props` (levelBuild's {m, x, y, z, yaw, scale}) with the decals'
   pin(); `lines`: the level's lines on the ground, the fighting's along LANE, STREET and TRACK. */
export function dressWalls(G, props, lines, { seed = 1944 } = {}) {
  const R = rng(seed), decals = G.decals, world = G.world;
  const fronts = ['LANE', 'STREET', 'TRACK'].map((k) => lines?.[k]).filter(Boolean);
  const sides = new Map(), colours = new Map(), tmp = {};
  let breaks = 0, holes = 0;
  const signs = [];
  for (const p of props) {
    const name = p.m.name || '', box = p.m.box;
    if (!BUILT.test(name)) continue;
    const c = Math.cos(p.yaw), sn = Math.sin(p.yaw), k = p.scale || 1;
    // a cell's place on the wall, in the world
    const at = (s, cell, out) => {
      const i = cell % s.W, j = (cell / s.W) | 0, u = s.u0 + (i + 0.5) * STEP, d = s.depth[cell];
      const mx = u * s.ux + d * s.dx, mz = u * s.uz + d * s.dz;
      out.x = p.x + (mx * c + mz * sn) * k; out.y = p.y + (s.v0 + (j + 0.5) * STEP) * k; out.z = p.z + (-mx * sn + mz * c) * k;
      return out;
    };
    for (const [dx, dz] of SIDES) {
      const nx = dx * c + dz * sn, nz = -dx * sn + dz * c;
      // how exposed: open ground in front of the side (rays out at chest height from just off the
      // middle of the model's box on that side) ...
      const fx = dx ? (dx > 0 ? box.max.x : box.min.x) : (box.min.x + box.max.x) / 2, fz = dz ? (dz > 0 ? box.max.z : box.min.z) : (box.min.z + box.max.z) / 2;
      const ox = p.x + (fx * c + fz * sn) * k + nx * 0.4, oz = p.z + (-fx * sn + fz * c) * k + nz * 0.4;
      const oy = (G.terrain?.height(ox, oz) ?? p.y) + 1.4;
      let open = 0;
      for (const a of [-0.7, -0.35, 0, 0.35, 0.7]) {
        const ca = Math.cos(a), sa = Math.sin(a);
        if (!world.raycast(ox, oy, oz, nx * ca - nz * sa, 0, nx * sa + nz * ca, 12)) open += 0.2;
      }
      // ... onto where the fighting went: the ground in front of it near the lane, the street, the track
      let near = Infinity;
      for (const l of fronts) near = Math.min(near, polylineDistance(l, ox + nx * 8, oz + nz * 8, tmp).d);
      const exposed = open * smoothstep(24, 6, near);
      if (exposed < 0.05) continue;
      // the side itself, drawn the first time one of the model's is needed
      const key = name + dx + dz;
      if (!sides.has(key)) {
        sides.set(key, sideOf(p.m, dx, dz, (main) => {
          if (!colours.has(name)) colours.set(name, texels(G.matlib.resolve(p.m.prims[main].material)?.map));
          return colours.get(name);
        }));
      }
      const s = sides.get(key);
      if (!s) continue;
      // the ground there, in the model's own height
      const ground = (oy - 1.4 - p.y) / k;
      const placed = [];
      const free = (i, j, hw, hh) => placed.every(([pi, pj, pw, ph]) => Math.abs(pi - i) > (pw + hw) * 0.8 || Math.abs(pj - j) > (ph + hh) * 0.8);
      // a cell of open wall from lo to hi metres over the ground
      const pick = (lo, hi) => {
        for (let t = 0; t < 40; t++) {
          const cell = s.cells[Math.floor(R() * s.cells.length)], h = s.v0 + (((cell / s.W) | 0) + 0.5) * STEP - ground;
          if (h >= lo && h <= hi) return cell;
        }
        return -1;
      };
      // where an old painted advertisement could be: high on a house's open plaster (the sign fills
      // 0.94 by 0.42 of its decal)
      if (PLASTERED.test(name) && exposed > 0.3) {
        let found = false;
        for (const size of SIGN) {
          const hw = Math.ceil(size * 0.47 / STEP), hh = Math.ceil(size * 0.21 / STEP);
          for (let t = 0; t < 40 && !found; t++) {
            const cell = pick(2.6, 4.9);
            if (cell < 0) break;
            const i = cell % s.W, j = (cell / s.W) | 0;
            if (!fits(s, i, j, hw, hh, true)) continue;
            at(s, cell, tmp);
            signs.push({ x: tmp.x, y: tmp.y, z: tmp.z, nx, nz, size: size * k, exposed: exposed * size });
            found = true;
          }
          if (found) break;
        }
      }
      // plaster blown off, bigger nearer the ground (the break fills an ellipse 0.94 by 0.62 of its
      // decal; a smaller one where a big one will not fit)
      const nb = PLASTERED.test(name) ? Math.floor(s.area * 0.1 * exposed + R()) : 0;
      for (let b = 0; b < nb; b++) {
        let done = false;
        for (let t = 0; t < 30 && !done; t++) {
          const cell = pick(0.4, 4.2);
          if (cell < 0) break;
          const i = cell % s.W, j = (cell / s.W) | 0, h = s.v0 + (j + 0.5) * STEP - ground;
          const big = (2.1 - 0.7 * Math.min(1, h / 3)) * (0.75 + R() * 0.25);
          for (const size of [big, big * 0.75, big * 0.55, big * 0.4]) {
            const hw = Math.ceil((size * 0.46) / STEP), hh = Math.ceil((size * 0.32) / STEP);
            if (!free(i, j, hw, hh) || !fits(s, i, j, hw, hh, true)) continue;
            at(s, cell, tmp);
            if (decals.pin('spall', tmp.x, tmp.y, tmp.z, nx, 0, nz, size * k, true, R)) { placed.push([i, j, hw, hh]); breaks++; }
            done = true;
            break;
          }
        }
      }
      // a cannon shell's or a grenade's: the face of the wall smashed in round a hole
      const ns = Math.floor(s.area * 0.02 * exposed + R());
      for (let b = 0; b < ns; b++) {
        for (let t = 0; t < 20; t++) {
          const cell = pick(0.3, 3.5);
          if (cell < 0) break;
          const i = cell % s.W, j = (cell / s.W) | 0, size = 0.45 + R() * 0.3, half = Math.ceil((size * 0.42) / STEP);
          if (!free(i, j, half, half) || !fits(s, i, j, half, half, false)) continue;
          at(s, cell, tmp);
          if (decals.pin('stone', tmp.x, tmp.y, tmp.z, nx, 0, nz, size * k, false, R)) { placed.push([i, j, half, half]); holes++; }
          break;
        }
      }
      // bursts of machine-gun fire: a line of holes, the gun swinging as it fired
      const nbu = Math.floor(s.area * 0.08 * exposed + R());
      for (let b = 0; b < nbu; b++) {
        const start = pick(0.5, 3.0);
        if (start < 0) break;
        const a = (R() - 0.5) * (R() < 0.8 ? 0.9 : 2.4), ca = Math.cos(a), sa = Math.sin(a), gap = 0.07 + R() * 0.15;
        const si = start % s.W, sj = (start / s.W) | 0, dir = R() < 0.5 ? -1 : 1;
        for (let h = 0, n = 3 + Math.floor(R() * 7); h < n; h++) {
          const along = h * gap * (0.7 + R() * 0.6), off = (R() - 0.5) * 0.08;
          const i = Math.round(si + (dir * along * ca - off * sa) / STEP), j = Math.round(sj + (along * sa + off * ca) / STEP);
          const size = 0.18 + R() * 0.1;
          if (!fits(s, i, j, 2, 2, false)) continue;
          const cell = j * s.W + i;
          at(s, cell, tmp);
          if (decals.pin(s.sat[cell] > 100 ? 'wood' : 'stone', tmp.x, tmp.y, tmp.z, nx, 0, nz, size * k, false, R)) holes++;
        }
      }
    }
  }
  // the advertisements: on the most exposed of those walls, no two within 20 m, each a different
  // trade as far as they go
  signs.sort((a, b) => b.exposed - a.exposed);
  const put = [];
  for (const g of signs) {
    if (put.length >= SIGNS) break;
    if (put.some((o) => Math.hypot(o.x - g.x, o.z - g.z) < 20)) continue;
    if (decals.pin('sign', g.x, g.y, g.z, g.nx, 0, g.nz, g.size, false, R, true, put.length)) put.push(g);
  }
  return { breaks, holes, signs: put.length };
}
