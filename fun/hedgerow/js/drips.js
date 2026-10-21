/* Hedgerow — water dripping off the eaves.

   The rain runs down every roof and drips off its lower edge. At load the
   houses', the church's and the barn's eaves are found in their models: the
   bare lower edges of the sloping faces, level, over two metres up (a model
   stands on its own y = 0). Along them, every quarter metre a point where
   the water lets go, a little out from the edge, and how far its drops fall:
   to the ground, or to the part of the building below (a lower roof, a
   sill). Each point's whole fall is one thin ribbon, and its shader works
   out where the water is on it now: the water at a height left the edge as
   long ago as it takes to fall that far, so drops speed up and their blur
   stretches as they go. Most points drip, a drop every second or so; where
   water runs together (one in seven) it pours as a string that leaves the
   edge whole and breaks into drops further down. Lit like the rain by the
   lamps, the fires, a flare and the lightning, hidden behind what stands in
   front. */

import * as THREE from 'three';

const EAVED = /^(house|church|barn|shed)/;
const STEP = 0.25;

const VERT = /* glsl */ `
attribute vec4 aEmit;            // xyz: where the water lets go, w: how far it falls
attribute vec2 aSeed;            // x: how much water runs off here (a string of it when high), y: a phase
uniform float uWidth;
uniform vec2 uWind;
uniform vec3 uLightPos[6];
uniform vec3 uLightCol[6];
uniform vec2 uScreen;
uniform float uSoft;
varying float vS, vCover, vFade;
varying vec2 vSeed;
varying float vX;
varying vec3 vLit;
varying float vDist;
varying vec2 vProj;
void main() {
  float fall = aEmit.w;
  float T = sqrt(2.0 * fall / 9.8);
  // the whole fall as one thin ribbon, top to where it lands, leaning a little with the wind
  vec3 top = aEmit.xyz;
  vec3 bottom = top + vec3(uWind.x * 0.06 * T * T, -fall, uWind.y * 0.06 * T * T);
  vec3 axis = normalize(bottom - top);
  vec3 p = mix(bottom, top, uv.y);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(axis, toCam));
  float dist = length(p - cameraPosition);
  // as wide as the water, but at least a pixel and a half: a thinner one covers less of it
  float pxPerM = projectionMatrix[1][1] * 0.5 / (dist * (uSoft > 0.5 ? uScreen.y : 1.0 / 900.0));
  float width = max(uWidth * (1.0 + aSeed.x * 0.8), 1.5 / pxPerM);
  vec3 wp = p + side * (uv.x - 0.5) * width;
  vS = (1.0 - uv.y) * fall;
  vCover = uWidth * (1.0 + aSeed.x * 0.8) / width;
  vFade = smoothstep(0.6, 2.0, dist) * (1.0 - smoothstep(28.0, 42.0, dist));
  vSeed = aSeed;
  vX = uv.x;
  vec3 lit = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    vec3 d = p - uLightPos[i];
    lit += uLightCol[i] / (1.0 + dot(d, d) * 0.9);
  }
  vLit = lit;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vDist = -mv.z;
  vProj = vec2(projectionMatrix[2][2], projectionMatrix[3][2]);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor, uSky;
uniform float uOpacity, uFlash, uSoft, uTime, uRain;
uniform sampler2D tDepth;
uniform vec2 uScreen;
varying float vS, vCover, vFade;
varying vec2 vSeed;
varying float vX;
varying vec3 vLit;
varying float vDist;
varying vec2 vProj;
float hash(float n) { return fract(sin(n * 12.9898 + vSeed.y * 78.233) * 43758.5453); }
void main() {
  // drawn after the frame (the late pass): hidden behind what the scene drew
  if (uSoft > 0.5) {
    float zd = texture2D(tDepth, gl_FragCoord.xy * uScreen).x * 2.0 - 1.0;
    if (vDist > vProj.y / (zd + vProj.x)) discard;
  }
  // the water here left the edge this long ago: free fall, so it speeds up and its blur over a
  // frame stretches as it goes
  float left = uTime - sqrt(2.0 * vS / 9.8);
  // where water runs together it pours as a broken string, elsewhere it drips: slots in time,
  // each with a drop or not, the drop lasting a frame's blur (longer in a string)
  float string = smoothstep(0.82, 0.9, vSeed.x);
  float rate = mix(1.2 + 2.0 * vSeed.x, 11.0, string) * (0.6 + 0.4 * uRain);
  float k = left * rate + vSeed.y * 37.0;
  float slot = floor(k), f = fract(k);
  float has = step(hash(slot), mix(0.7, 0.92, string));
  float len = mix(0.025, 0.4, string) * rate;
  float water = has * (1.0 - smoothstep(len * 0.5, len, f)) * smoothstep(0.0, 0.004 * rate, f);
  // a string is whole as it leaves the edge and breaks up into drops further down, its own way
  float bits = 3.0 + floor(fract(vSeed.y * 13.7) * 6.0);
  water *= mix(1.0, step(0.75 * smoothstep(0.15, 3.0, vS), hash(slot * 7.1 + floor(f * bits))), string);
  float edge = 1.0 - abs(vX - 0.5) * 2.0;
  vec3 lit = vLit + uSky;
  float boost = min(dot(lit, vec3(0.33)), 4.0);
  float a = water * edge * vCover * vFade * uOpacity * (1.0 + boost * 1.5) * smoothstep(0.0, 0.05, vS);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * (1.0 + uFlash * 3.0) + lit * 2.0, min(a, 0.9));
}`;

/* A model's eaves as points the water lets go from, in its own space: [x, y, z, fall], fall
   the drop down to the model itself below the point (Infinity: to the ground). */
function eavesOf(model) {
  const tris = [];
  for (const p of model.prims) {
    const pos = p.geometry.attributes.position, idx = p.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const t = [];
      for (let k = 0; k < 3; k++) { const v = idx ? idx.getX(i + k) : i + k; t.push(pos.getX(v), pos.getY(v), pos.getZ(v)); }
      tris.push(t);
    }
  }
  // the sloping faces (a roof), and how many of them share each edge
  const key = (x, y, z) => `${Math.round(x * 50)},${Math.round(y * 50)},${Math.round(z * 50)}`;
  const edges = new Map();
  for (const t of tris) {
    const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2], vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-8 || ny / L < 0.3 || ny / L > 0.97) continue;
    const cy = (t[1] + t[4] + t[7]) / 3;
    for (let e = 0; e < 3; e++) {
      const a = e * 3, b = ((e + 1) % 3) * 3;
      const ka = key(t[a], t[a + 1], t[a + 2]), kb = key(t[b], t[b + 1], t[b + 2]);
      const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      const r = edges.get(k);
      if (r) r.n++;
      else edges.set(k, { n: 1, x0: t[a], y0: t[a + 1], z0: t[a + 2], x1: t[b], y1: t[b + 1], z1: t[b + 2], cy, ox: nx / L, oz: nz / L });
    }
  }
  // a drop is stopped by what faces up (a lower roof, a sill, a gutter; the next course of tiles
  // under one that is not the eave), not by the underside of the roof it leaves: those faces,
  // found through a coarse grid
  const CELL = 0.5, grid = new Map();
  tris.forEach((t, i) => {
    const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2], vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2];
    const ny = uz * vx - ux * vz, L = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
    if (!(L > 1e-8) || ny / L < 0.3) return;
    const x0 = Math.floor(Math.min(t[0], t[3], t[6]) / CELL), x1 = Math.floor(Math.max(t[0], t[3], t[6]) / CELL);
    const z0 = Math.floor(Math.min(t[2], t[5], t[8]) / CELL), z1 = Math.floor(Math.max(t[2], t[5], t[8]) / CELL);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const k = gx * 4096 + gz;
      (grid.get(k) || grid.set(k, []).get(k)).push(i);
    }
  });
  const below = (x, y, z) => {
    let best = Infinity;
    for (const i of grid.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL)) || []) {
      const t = tris[i];
      // where the vertical through (x, z) meets the triangle, if it does
      const d = (t[5] - t[8]) * (t[0] - t[6]) + (t[6] - t[3]) * (t[2] - t[8]);
      if (Math.abs(d) < 1e-10) continue;
      const w0 = ((t[5] - t[8]) * (x - t[6]) + (t[6] - t[3]) * (z - t[8])) / d;
      const w1 = ((t[8] - t[2]) * (x - t[6]) + (t[0] - t[6]) * (z - t[8])) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const hy = w0 * t[1] + w1 * t[4] + w2 * t[7];
      // the next course of tiles right under it: no eave; a moulding or a gutter's lip a little
      // way down: the water runs off it and on down; further down: where it lands
      const d2 = y - hy;
      if (d2 > 0.01 && d2 < 0.12) return d2;
      if (d2 > 0.5 && d2 < best) best = d2;
    }
    return best;
  };
  const out = [];
  let s = 1;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (const r of edges.values()) {
    if (r.n !== 1) continue;
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0), my = (r.y0 + r.y1) / 2;
    // bare, level, the lowest edge of its face, well off the ground (a roof is finely cut: its
    // eave is many short edges)
    if (Math.abs(r.y1 - r.y0) > Math.max(0.15 * len, 0.02) || my > r.cy - 0.015 || my < 2) continue;
    // a little out from the edge, downhill; a point every STEP along it (a short edge has one now and then)
    const oh = Math.hypot(r.ox, r.oz) || 1, ox = (r.ox / oh) * 0.02, oz = (r.oz / oh) * 0.02;
    const n = Math.floor(len / STEP + R());
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      const x = r.x0 + (r.x1 - r.x0) * f + ox, y = r.y0 + (r.y1 - r.y0) * f - 0.01, z = r.z0 + (r.z1 - r.z0) * f + oz;
      out.push([x, y, z, below(x, y, z)]);
    }
  }
  return out;
}

/* props: the placed props ({m: model, x, y, z, yaw, scale}, levelBuild.js); terrain: its height() */
export function createDrips(props, terrain, { seed = 5 } = {}) {
  const cache = new Map(), emit = [], seeds = [];
  let s = seed;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (const p of props) {
    if (!EAVED.test(p.m.name)) continue;
    if (!cache.has(p.m.name)) cache.set(p.m.name, eavesOf(p.m));
    const c = Math.cos(p.yaw), sn = Math.sin(p.yaw), k = p.scale;
    for (const [lx, ly, lz, lfall] of cache.get(p.m.name)) {
      const x = p.x + (lx * c + lz * sn) * k, z = p.z + (-lx * sn + lz * c) * k, y = p.y + ly * k;
      const fall = Math.min(lfall * k, y - terrain.height(x, z));
      if (!(fall > 0.4)) continue;
      emit.push(x, y, z, fall);
      seeds.push(R(), R());
    }
  }
  const n = emit.length / 4;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.attributes.position = quad.attributes.position;
  geo.attributes.uv = quad.attributes.uv;
  geo.setAttribute('aEmit', new THREE.InstancedBufferAttribute(new Float32Array(emit), 4));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 2));
  geo.instanceCount = n;
  const uniforms = {
    uTime: { value: 0 }, uRain: { value: 1 }, uWidth: { value: 0.004 }, uWind: { value: new THREE.Vector2(1.4, 0.6) },
    uColor: { value: new THREE.Color('#9aa4ad') }, uOpacity: { value: 0.8 }, uFlash: { value: 0 }, uSky: { value: new THREE.Vector3() },
    uLightPos: { value: Array.from({ length: 6 }, () => new THREE.Vector3(0, -1000, 0)) },
    uLightCol: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
    tDepth: { value: null }, uScreen: { value: new THREE.Vector2(1, 1) }, uSoft: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'drips';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  const own = { tDepth: uniforms.tDepth, uScreen: uniforms.uScreen, uSoft: uniforms.uSoft };

  return {
    mesh, count: n,
    /* drawn after the frame in this scene (the late pass, hidden behind the scene by its depth:
       depth = {tDepth, uScreen, uSoft} uniforms that pass keeps), or with the scene */
    drawLate(lateScene, scene, depth = null) {
      (lateScene || scene).add(mesh);
      mat.depthTest = !lateScene;
      const d = lateScene && depth ? depth : own;
      uniforms.tDepth = d.tDepth; uniforms.uScreen = d.uScreen; uniforms.uSoft = d.uSoft;
      mat.needsUpdate = true;
    },
    /* time; rain: how hard it rains (weather.js); flash: lightning; sky: a flare's light at the eye */
    update(time, rain, flash, sky) {
      uniforms.uTime.value = time;
      uniforms.uRain.value = rain;
      uniforms.uFlash.value = flash;
      if (sky) uniforms.uSky.value.set(sky.color.r, sky.color.g, sky.color.b).multiplyScalar(Math.min(sky.intensity, 8) * 0.04);
      else uniforms.uSky.value.set(0, 0, 0);
    },
    /* this frame's lights ([{x, y, z, color, intensity}], lights.js), the six strongest */
    setLights(list) {
      const P = uniforms.uLightPos.value, C = uniforms.uLightCol.value;
      for (let i = 0; i < 6; i++) {
        const l = list[i];
        if (!l) { P[i].set(0, -1000, 0); C[i].set(0, 0, 0); continue; }
        P[i].set(l.x, l.y, l.z);
        const k = Math.min(l.intensity, 40) * 0.05;
        C[i].set(l.color.r * k, l.color.g * k, l.color.b * k);
      }
    },
  };
}
