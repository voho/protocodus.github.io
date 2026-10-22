/* Hedgerow — white sheets hung from the windows.

   While the fighting passed through their villages, Normandy's people hung
   white sheets from their windows: there are people in here, not soldiers.
   From a few of the lit upper-floor windows that look onto the street, a
   sheet hangs over the sill or the balcony's rail and down the wall below:
   old linen, stained, creased where it was folded away, its hem frayed or
   torn, soaked through by the rain. It hangs in pleats, darker down in
   their folds, and swings and ripples as the gusts that bend the trees go
   by (weather.js gust()), most at its hem, more where the house shelters
   it from the wind; it throws its shadow on the wall from the lamps. One
   mesh, the motion worked out in its vertex shader (and in its shadows',
   so they stay with it), its shading from the moved shape. */

import * as THREE from 'three';
import { GUST_GLSL } from './weather.js';
import { rng } from './util.js';
import { dimFillSpecular } from './fill.js';

const SX = 14, SY = 16;           // a sheet's quads across and down

/* the linen, four ways (the quarters of the texture): plain, edged with ticking stripes, torn at a
   corner, scalloped; stained, streaked with the grime the rain washes down off the sill, creased,
   soiled along the hem, frayed. The canvas's rows run down the sheet */
function linen() {
  const S = 1024, C = S / 2, R = rng(1944);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const base = ['rgb(228,223,210)', 'rgb(224,220,210)', 'rgb(216,214,206)', 'rgb(230,220,196)'];
  for (let i = 0; i < 4; i++) {
    const x0 = (i % 2) * C, y0 = (i >> 1) * C;
    g.save();
    g.beginPath(); g.rect(x0, y0, C, C); g.clip();
    // the cloth's outline: straight at the top (over the sill); its sides drawn in a little by its
    // pleats; its hem hanging askew, sagging, frayed or torn
    const path = new Path2D(), slant = (R() - 0.5) * 0.12, sag = (R() - 0.3) * 0.05;
    const side = (t, r) => C * ((0.012 + 0.03 * Math.sin(Math.PI * t) * r) + 0.004 * R());
    const rl = 0.5 + R(), rr = 0.5 + R();
    path.moveTo(x0, y0); path.lineTo(x0 + C, y0);
    for (let k = 1; k < 12; k++) path.lineTo(x0 + C - side(k / 12, rr), y0 + C * 0.9 * k / 12);
    for (let k = 0; k <= 32; k++) {
      const t = k / 32, x = x0 + C * (1 - t);
      let y = y0 + C * (0.95 - 0.02 * R() - slant * (t - 0.5) - sag * Math.sin(Math.PI * t));
      if (i === 3) y -= C * 0.03 * (0.5 + 0.5 * Math.cos(t * Math.PI * 12));     // scalloped
      if (i === 2 && t < 0.35) y -= C * (0.35 - t) * 0.9 * (0.8 + 0.4 * R());     // torn away at a corner
      path.lineTo(x + (t === 0 ? -side(1, rr) : t === 1 ? side(1, rl) : 0), y);
    }
    for (let k = 11; k > 0; k--) path.lineTo(x0 + side(k / 12, rl), y0 + C * 0.9 * k / 12);
    path.closePath();
    g.fillStyle = base[i];
    g.fill(path);
    g.save(); g.clip(path);
    // the weave, faint
    for (let k = 0; k < 160; k++) {
      g.fillStyle = `rgba(${R() < 0.5 ? '255,255,250' : '120,110,96'},${(0.03 + R() * 0.05).toFixed(3)})`;
      if (R() < 0.5) g.fillRect(x0, y0 + R() * C, C, 1 + R() * 3); else g.fillRect(x0 + R() * C, y0, 1 + R() * 3, C);
    }
    // ticking stripes along its edges, faded
    if (i === 1) for (const xs of [0.08, 0.13, 0.87, 0.92]) { g.fillStyle = 'rgba(70,86,120,0.4)'; g.fillRect(x0 + C * xs, y0, C * 0.025, C); }
    // grime run down from the sill, in streaks
    for (let k = 0; k < 14; k++) {
      const x = x0 + R() * C, len = C * (0.2 + R() * 0.6), wd = 2 + R() * 8;
      const gr = g.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, `rgba(105,90,70,${(0.08 + R() * 0.1).toFixed(3)})`); gr.addColorStop(1, 'rgba(105,90,70,0)');
      g.fillStyle = gr; g.fillRect(x, y0, wd, len);
    }
    // stains: water marks with darker rims
    for (let k = 0; k < 7; k++) {
      const x = x0 + R() * C, y = y0 + C * (0.2 + R() * 0.75), r = C * (0.05 + R() * 0.14);
      const gr = g.createRadialGradient(x, y, r * 0.5, x, y, r);
      gr.addColorStop(0, 'rgba(180,160,120,0.10)'); gr.addColorStop(0.85, 'rgba(150,125,85,0.22)'); gr.addColorStop(1, 'rgba(150,125,85,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    // creased where it lay folded in a cupboard: a shadow and a light line across
    for (const yy of [0.34, 0.67]) {
      const y = y0 + C * (yy + (R() - 0.5) * 0.04);
      g.fillStyle = 'rgba(70,62,52,0.13)'; g.fillRect(x0, y, C, 4);
      g.fillStyle = 'rgba(255,252,244,0.12)'; g.fillRect(x0, y + 4, C, 4);
    }
    // soaked and soiled along the hem (the rain splashes it, the wall's grime runs into it), and the
    // fold over the sill
    const dirt = g.createLinearGradient(0, y0 + C * 0.6, 0, y0 + C);
    dirt.addColorStop(0, 'rgba(85,70,52,0)'); dirt.addColorStop(1, 'rgba(85,70,52,0.5)');
    g.fillStyle = dirt; g.fillRect(x0, y0, C, C);
    g.fillStyle = 'rgba(80,70,58,0.25)'; g.fillRect(x0, y0 + C * 0.06, C, C * 0.012);
    g.restore();
    // frayed threads along the bottom
    g.strokeStyle = base[i]; g.lineWidth = 2;
    for (let k = 0; k < 40; k++) {
      const t = R(), x = x0 + C * (1 - t), y = y0 + C * (0.93 - slant * (t - 0.5) - sag * Math.sin(Math.PI * t));
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 8, y + C * (0.01 + R() * 0.04)); g.stroke();
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.anisotropy = 4;
  return t;
}

/* how far the sheet has moved off its hanging shape at (u across, v down): swinging out from the
   wall and along it as the gusts go by, rippling, most at its hem; never back into the wall. In the
   geometry's own space, which is the world's */
const SHEET_GLSL = /* glsl */ `
  attribute vec4 aFold;      // its wall's facing (x, z), its own phase, how far out of its pleats' folds
  attribute vec2 aSheet;     // across 0..1, down 0..1
  attribute vec3 aDu, aDv;   // the hanging shape's slopes, across and down (m per unit)
  uniform float uTime, uWet;
  uniform vec2 uWind;
  varying float vFold;
  ${GUST_GLSL}
  vec3 sheetMove(float u, float v, float g, vec3 n, vec3 t, float ph) {
    vec2 w = normalize(uWind);
    // a wet sheet is heavy: it swings less and clings
    float a = v * v * (0.04 + 0.11 * g) * mix(1.0, 0.65, uWet);
    // in the lee of its house it lifts off the wall; where the wind blows at the wall, it's pressed to it
    float lee = 0.5 + 0.5 * dot(w, n.xz);
    float lift = a * mix(0.4, 1.2, lee) * (0.55 + 0.45 * sin(uTime * 1.7 + ph + v * 2.0))
      + 0.02 * v * g * (0.5 + 0.5 * sin(u * 7.0 + v * 5.0 - uTime * 4.5 + ph));
    float along = a * (0.6 * sin(uTime * 1.1 + ph * 1.7 + v * 1.5) + 0.5 * dot(w, t.xz));
    return n * lift + t * along;
  }`;

function addMotion(mat, uniforms) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const facing = 'vec3 shN = vec3(aFold.x, 0.0, aFold.y), shT = vec3(aFold.y, 0.0, -aFold.x);\n'
      + 'float shG = gust(position.xz, uTime, uWind);\n'
      + 'vec3 shD = sheetMove(aSheet.x, aSheet.y, shG, shN, shT, aFold.z);\n';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + SHEET_GLSL)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        ${facing}
        transformed += shD;
        vFold = aFold.w;
      }`);
    if (!mat.isMeshStandardMaterial) return;
    // its shading from the moved shape: the slopes of the hanging shape and of the move added
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      {
        ${facing}
        vec3 du = aDu + (sheetMove(aSheet.x + 0.01, aSheet.y, shG, shN, shT, aFold.z) - shD) * 100.0;
        vec3 dv = aDv + (sheetMove(aSheet.x, aSheet.y + 0.01, shG, shN, shT, aFold.z) - shD) * 100.0;
        objectNormal = normalize(cross(dv, du));
        if (dot(objectNormal, shN) < 0.0) objectNormal = -objectNormal;
      }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;\nvarying float vFold;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        // soaked: darker; and darker down in the folds of its pleats, where less light gets in
        diffuseColor.rgb *= mix(1.0, 0.8, uWet) * mix(0.66, 1.0, vFold);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.62, uWet);`);
    dimFillSpecular(shader);
  };
  mat.customProgramCacheKey = () => 'hedgerow-sheet-' + mat.type;
}

/* A house's faces where it stands, as flat triangles (x, y, z three times over; the collision
   boxes are rougher than its walls). */
const houses = new Map();
function facesOf(pr) {
  let f = houses.get(pr);
  if (f) return f;
  const parts = [], c = Math.cos(pr.yaw || 0), sn = Math.sin(pr.yaw || 0), k = pr.scale || 1;
  let len = 0;
  for (const prim of pr.m.prims || []) {
    const g = prim.geometry, P = g?.attributes.position;
    if (!P) continue;
    const idx = g.index, n = idx ? idx.count : P.count, a = new Float32Array(n * 3);
    for (let t = 0; t < n; t++) {
      const i = idx ? idx.getX(t) : t, x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      a[t * 3] = pr.x + (x * c + z * sn) * k; a[t * 3 + 1] = pr.y + y * k; a[t * 3 + 2] = pr.z + (-x * sn + z * c) * k;
    }
    parts.push(a); len += a.length;
  }
  f = new Float32Array(len);
  let o = 0;
  for (const a of parts) { f.set(a, o); o += a.length; }
  houses.set(pr, f);
  return f;
}

/* What holds a sheet hung from pane p, looking at the house from the street in front of it: the top
   rail of a railing or the sill, the first thing below the glass that stands out in front of it.
   Down the wall from there, how far the sheet can hang before something sticks out into it (a shop's
   sign, a porch roof). Depths along n from the glass (m): the house's faces turned to the street
   around the window, laid out in its own frame (across u, up s, out d), and the outermost of them at
   a point is what a look straight at the wall would meet. */
function hanging(p, w) {
  const f = facesOf(p.prop), near = [];
  const hand = Math.sign(p.T.clone().cross(p.B).dot(p.n));
  const u0 = -0.5 * w - 0.05, u1 = 0.5 * w + 0.05, s0 = -p.hh - 2.3, s1 = 1.3 - p.hh;
  const q = new Float32Array(9);
  for (let i = 0; i < f.length; i += 9) {
    for (let k = 0; k < 9; k += 3) {
      const dx = f[i + k] - p.c.x, dy = f[i + k + 1] - p.c.y, dz = f[i + k + 2] - p.c.z;
      q[k] = dx * p.T.x + dy * p.T.y + dz * p.T.z;
      q[k + 1] = dx * p.B.x + dy * p.B.y + dz * p.B.z;
      q[k + 2] = dx * p.n.x + dy * p.n.y + dz * p.n.z;
    }
    if (Math.max(q[0], q[3], q[6]) < u0 || Math.min(q[0], q[3], q[6]) > u1) continue;
    if (Math.max(q[1], q[4], q[7]) < s0 || Math.min(q[1], q[4], q[7]) > s1) continue;
    if (Math.max(q[2], q[5], q[8]) < -0.6 || Math.min(q[2], q[5], q[8]) > 2) continue;
    const area = (q[3] - q[0]) * (q[7] - q[1]) - (q[6] - q[0]) * (q[4] - q[1]);
    if (!(hand * area > 1e-9)) continue;
    near.push(q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7], q[8], area);
  }
  const depth = (s, u) => {
    let best = -1;
    for (let i = 0; i < near.length; i += 10) {
      const ua = near[i], sa = near[i + 1], ub = near[i + 3], sb = near[i + 4], uc = near[i + 6], sc = near[i + 7], ar = near[i + 9];
      const w1 = ((u - ua) * (sc - sa) - (uc - ua) * (s - sa)) / ar, w2 = ((ub - ua) * (s - sa) - (u - ua) * (sb - sa)) / ar, w0 = 1 - w1 - w2;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const d = w0 * near[i + 2] + w1 * near[i + 5] + w2 * near[i + 8];
      if (d > best && d <= 2 && d >= -0.6) best = d;
    }
    return best;
  };
  const cols = [-0.35 * w, 0, 0.35 * w];
  const row = (s) => cols.map((u) => depth(s, u));
  // down the lower part of the window
  let top = null;
  for (let s = Math.min(1.1, 2 * p.hh - 0.15) - p.hh; s > -p.hh - 0.3; s -= 0.04) {
    if (row(s).every((d) => d > 0.05)) { top = s; break; }
  }
  if (top === null) return null;
  const front = Math.max(...row(top), ...row(top - 0.04), ...row(top - 0.08)) + 0.03;
  let len = 0;
  for (let s = top - 0.12; s > top - 1.9; s -= 0.05) {
    if (row(s).some((d) => d > front - 0.01)) break;
    len = top - s;
  }
  return { top, front, len };
}

/* panes: the lit windows in the world (rooms.js paneRects); world, terrain: for the open ground in
   front of each, and the ground below; shared: the frame's time and wetness */
export function createSheets(panes, world, terrain, shared, { count = 4, seed = 41 } = {}) {
  const R = rng(seed), up = new THREE.Vector3(0, 1, 0);
  // an upper-floor window that looks out onto open ground
  const cand = panes.filter((p) => {
    if (!p.prop || Math.abs(p.n.y) > 0.2 || p.c.y - terrain.height(p.c.x, p.c.z) < 4.2) return false;
    const o = p.c.clone().addScaledVector(p.n, 0.6);
    return !world.raycast(o.x, o.y, o.z, p.n.x, 0, p.n.z, 10);
  });
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  // on as many kinds of house as there are, before a second on any one kind
  const chosen = [];
  for (const again of [false, true]) {
    for (const p of cand) {
      if (chosen.length >= count) break;
      if (chosen.some((q) => q.p === p || q.p.c.distanceTo(p.c) < 14 || (!again && q.p.prop.m === p.prop.m))) continue;
      const w = Math.min(2 * p.hw + 0.2, 1.4), at = hanging(p, w);
      if (!at || at.len < 0.9) continue;
      chosen.push({ p, w, at });
    }
  }
  houses.clear();
  if (!chosen.length) return null;
  const pos = [], uv = [], fold = [], sheet = [], du = [], dv = [], idx = [];
  const W = SX + 1, H = SY + 1;
  chosen.forEach(({ p, w, at }, si) => {
    const h = Math.min(at.len, 1.3 + R() * 0.5), cell = si % 4, ph = R() * 6.28;
    const top = p.c.clone().addScaledVector(p.B, at.top + 0.02).addScaledVector(p.n, at.front);
    // hanging in pleats, gathered over the sill; the hem curls out a little
    const k1 = 1.2 + R() * 0.8, k2 = 2.6 + R() * 1.2, f1 = R() * 6.28, f2 = R() * 6.28;
    const shape = (u, v) => {
      const f = 0.5 + 0.5 * (0.55 * Math.sin(6.283 * k1 * u + f1) + 0.45 * Math.sin(6.283 * k2 * u + f2));
      const e = Math.min(1, Math.max(0, (v - 0.8) / 0.2));
      return { f, off: (0.02 + 0.035 * v) * f + 0.04 * e * e };
    };
    const at3 = (u, v) => top.clone().addScaledVector(p.T, (u - 0.5) * w).addScaledVector(up, -v * h).addScaledVector(p.n, shape(u, v).off);
    const base = pos.length / 3, e = 1e-3;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const u = i / SX, v = j / SY, q = at3(u, v);
        pos.push(q.x, q.y, q.z);
        uv.push((cell % 2) * 0.5 + u * 0.5, (cell >> 1) * 0.5 + v * 0.5);
        fold.push(p.n.x, p.n.z, ph, shape(u, v).f);
        sheet.push(u, v);
        const a = at3(u + e, v).sub(at3(u - e, v)).divideScalar(2 * e), b = at3(u, v + e).sub(at3(u, v - e)).divideScalar(2 * e);
        du.push(a.x, a.y, a.z); dv.push(b.x, b.y, b.z);
      }
    }
    // the faces turned to the street
    const out = p.T.clone().cross(up).dot(p.n) > 0;
    for (let j = 0; j < SY; j++) {
      for (let i = 0; i < SX; i++) {
        const a = base + j * W + i, b = a + 1, c = a + W, d = c + 1;
        if (out) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aFold', new THREE.Float32BufferAttribute(fold, 4));
  geo.setAttribute('aSheet', new THREE.Float32BufferAttribute(sheet, 2));
  geo.setAttribute('aDu', new THREE.Float32BufferAttribute(du, 3));
  geo.setAttribute('aDv', new THREE.Float32BufferAttribute(dv, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.boundingSphere.radius += 1;
  const map = linen();
  const uniforms = { uTime: shared.time, uWet: shared.wet, uWind: { value: new THREE.Vector2(1.4, 0.6) } };
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
  addMotion(mat, uniforms);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sheets';
  mesh.castShadow = mesh.receiveShadow = true;
  // its shadow moves with it, from the lamps and from a flare
  mesh.customDistanceMaterial = new THREE.MeshDistanceMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide });
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide });
  addMotion(mesh.customDistanceMaterial, uniforms);
  addMotion(mesh.customDepthMaterial, uniforms);
  return { mesh, count: chosen.length, at: chosen.map(({ p }) => p.c) };
}
