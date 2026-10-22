/* Hedgerow — particles: muzzle flashes, tracers, impacts, blood, smoke,
   fire, explosions.

   Two instanced sprite systems share one generated texture atlas: one
   alpha-blended (smoke, dust, debris, water), one additive (fire, flashes,
   sparks, tracers). Particles live in flat typed arrays on the CPU; each
   frame the live ones are packed into the instance attributes. A sprite
   with a stretch vector is drawn as a streak along it (tracers, sparks,
   earth thrown up by a blast).

   Smoke, dust and spray are lit (at their corners) by the night's ambient
   and the same eight lamps, fires and flashes the light pool picked, so the
   smoke over a burning truck glows from below and a puff of gun smoke
   flares with the shot. With the effects chain (`pass`, first in it) the
   sprites are drawn into the scene's own buffer right after the scene and
   read its depth: each fades out where it meets a wall or the ground
   instead of cutting a hard line through it, and that fade is their depth
   test too. The passes after it (occlusion, reflections, the light in the
   rain) then treat them as part of the scene. Without the chain's light in
   the rain (low quality) they are drawn with the scene as before. */

import * as THREE from 'three';
import { rng } from './util.js';

const CELLS = { puff: 0, smoke: 1, flash: 2, spark: 3, chunk: 4, ring: 5, streak: 6, flame: 7 };

/* value noise and its octaves, for the smoke and flame cells */
function makeNoise(seed) {
  const R = rng(seed);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  const V = Float32Array.from({ length: 256 }, () => R());
  const h = (x, y) => V[perm[(perm[x & 255] + y) & 255]];
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y, oct = 5) => {
    let sum = 0, amp = 0.5, norm = 0;
    for (let k = 0; k < oct; k++) { sum += noise(x, y) * amp; norm += amp; x *= 2.03; y *= 2.03; amp *= 0.5; }
    return sum / norm;
  };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function makeAtlas() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S * 4; c.height = S * 2;
  const g = c.getContext('2d');
  const R = rng(9);
  const cell = (i) => [(i % 4) * S, Math.floor(i / 4) * S];
  // 0 soft puff
  {
    const [x, y] = cell(0);
    const gr = g.createRadialGradient(x + S / 2, y + S / 2, 0, x + S / 2, y + S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x, y, S, S);
  }
  // 1 billowing smoke: warped noise inside a lumpy outline, thicker in the middle
  {
    const [x, y] = cell(1);
    const fbm = makeNoise(5);
    const img = g.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const u = i / S - 0.5, v = j / S - 0.5, r = Math.hypot(u, v);
      const wx = fbm(u * 3 + 1.7, v * 3 + 9.2, 3), wy = fbm(u * 3 + 5.1, v * 3 + 2.3, 3);
      const n = fbm(u * 4.5 + wx * 1.6, v * 4.5 + wy * 1.6);
      const edge = 1 - smooth(0.16, 0.48, r + (n - 0.5) * 0.3);
      const dens = edge * smooth(0.2, 0.7, n * 0.85 + edge * 0.45);
      const o = (j * S + i) * 4, shade = 175 + 80 * n;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = shade;
      img.data[o + 3] = Math.round(255 * dens * 0.9);
    }
    g.putImageData(img, x, y);
  }
  // 2 flash star
  {
    const [x, y] = cell(2);
    g.save(); g.translate(x + S / 2, y + S / 2);
    for (let k = 0; k < 7; k++) {
      g.rotate((Math.PI * 2) / 7 + R() * 0.3);
      const len = S * (0.3 + R() * 0.2);
      const gr = g.createLinearGradient(0, 0, len, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, -S * 0.04); g.lineTo(len, 0); g.lineTo(0, S * 0.04); g.fill();
    }
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.25);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(-S / 2, -S / 2, S, S);
    g.restore();
  }
  // 3 spark (hard core)
  {
    const [x, y] = cell(3);
    const gr = g.createRadialGradient(x + S / 2, y + S / 2, 0, x + S / 2, y + S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x, y, S, S);
  }
  // 4 debris chunk
  {
    const [x, y] = cell(4);
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath();
    const n = 7;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, r = S * (0.25 + R() * 0.2);
      const px = x + S / 2 + Math.cos(a) * r, py = y + S / 2 + Math.sin(a) * r;
      k ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.fill();
  }
  // 5 ring
  {
    const [x, y] = cell(5);
    const gr = g.createRadialGradient(x + S / 2, y + S / 2, S * 0.3, x + S / 2, y + S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x, y, S, S);
  }
  // 6 streak (along v)
  {
    const [x, y] = cell(6);
    const gr = g.createLinearGradient(x, 0, x + S, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x, y, S, S);
    const gv = g.createLinearGradient(0, y, 0, y + S);
    gv.addColorStop(0, 'rgba(0,0,0,1)'); gv.addColorStop(0.15, 'rgba(0,0,0,0)'); gv.addColorStop(0.85, 'rgba(0,0,0,0)'); gv.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = gv; g.fillRect(x, y, S, S);
    g.globalCompositeOperation = 'source-over';
  }
  // 7 flame tongue, broken up by noise (licks, not a blob)
  {
    const [x, y] = cell(7);
    for (let k = 0; k < 10; k++) {
      const cx = x + S / 2 + (R() - 0.5) * S * 0.3, cy = y + S * (0.45 + R() * 0.25);
      const rad = S * (0.12 + R() * 0.15);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x, y, S, S);
    }
    const fbm = makeNoise(11);
    const img = g.getImageData(x, y, S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const n = fbm(i / S * 5, j / S * 2.5 + 3.1);
      const o = (j * S + i) * 4;
      img.data[o + 3] = Math.round(img.data[o + 3] * smooth(0.25, 0.65, n + (j / S - 0.5) * 0.35));
    }
    g.putImageData(img, x, y);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

const VERT = /* glsl */ `
#define LIGHTS 8
attribute vec3 aPos;
attribute vec4 aColor;
attribute vec4 aMisc;      // size, rotation, cell, dense (1: mud and dirt, lit on the side facing the light)
attribute vec3 aStretch;
uniform float uFogDensity;
uniform float uLit;        // 1: smoke and dust take the light; 0: fire and flashes make their own
uniform vec3 uAmbient;
uniform vec3 uLightPos[LIGHTS];
uniform vec3 uLightCol[LIGHTS];
uniform float uLightRange[LIGHTS];
uniform int uLightCount;
uniform vec2 uScreen;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
varying float vDist;       // from the camera (view depth), for the soft edge
varying float vSoft;       // how deep the soft edge is
varying vec2 vProj;        // the projection's depth terms, to read the scene depth
void main() {
  float size = aMisc.x;
  vec3 p = aPos;
  vec3 wp;
  vec2 q = uv - 0.5;
  float sl = length(aStretch);
  float widen = 1.0;
  if (sl > 1e-4) {
    vec3 axis = aStretch / sl;
    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = normalize(cross(axis, toCam));
    // a streak is never thinner than a pixel and a half: a tracer a hundred metres off is still
    // a line of fire (a few centimetres wide, it would fall between the pixels)
    float px = 2.0 * max(-(viewMatrix * vec4(p, 1.0)).z, 0.05) * uScreen.y / projectionMatrix[1][1];
    float w = max(size, 1.5 * px);
    widen = w / size;
    wp = p + side * q.x * w + axis * q.y * (sl + size);
  } else {
    float c = cos(aMisc.y), s = sin(aMisc.y);
    vec2 r = vec2(q.x * c - q.y * s, q.x * s + q.y * c) * size;
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    // a ring spreading on the water lies on it (turned to the eye it would stand up like a hoop)
    if (abs(aMisc.z - 5.0) < 0.5) { right = vec3(1.0, 0.0, 0.0); up = vec3(0.0, 0.0, 1.0); }
    wp = p + right * r.x + up * r.y;
  }
  float cellI = aMisc.z;
  vUv = (vec2(mod(cellI, 4.0), 1.0 - floor(cellI / 4.0)) + uv) * vec2(0.25, 0.5);
  vColor = aColor;
  // widened, a streak of dirt spreads its cover over the width; a burning one (a tracer, a
  // spark) is so much brighter than the frame can show that even a sliver of a pixel of it
  // would fill the pixel: it stays a bright line, a little brighter the thinner it really is
  if (uLit > 0.5) vColor.a /= widen; else vColor.rgb *= sqrt(widen);
  if (uLit > 0.5) {
    // the night's light at this corner: the ambient (1 = as the colours were
    // chosen in the dark) and the lamps, fires and flashes near, falling off
    // like the scene's point lights, relative to that ambient
    vec3 light = vec3(0.0);
    vec3 toEye = normalize(cameraPosition - wp);
    for (int i = 0; i < LIGHTS; i++) {
      if (i >= uLightCount) break;
      vec3 L = uLightPos[i] - wp;
      float d2 = dot(L, L), r = uLightRange[i];
      float win = clamp(1.0 - d2 * d2 / (r * r * r * r), 0.0, 1.0);
      // a clod of mud is lit on the side facing the light, which is not the side we see when the
      // light is behind it: dark against a fireball, not glowing with it (smoke lets it through)
      float side = aMisc.w > 0.5 ? 0.15 + 0.85 * smoothstep(-0.5, 0.6, dot(L * inversesqrt(max(d2, 1e-6)), toEye)) : 1.0;
      light += uLightCol[i] * (win * win / max(d2, 0.3)) * 2.0 * side;
    }
    // a blast right beside it lights smoke up to a glow, not to white
    vColor.rgb *= uAmbient + light * 6.0 / (6.0 + light);
  }
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float d = -mv.z;
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  vDist = d;
  vSoft = max(size * 0.3, 0.06);
  vProj = vec2(projectionMatrix[2][2], projectionMatrix[3][2]);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D tAtlas, tDepth;
uniform vec3 uFogColor;
uniform float uAdditive, uSoft;
uniform vec2 uScreen;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
varying float vDist;
varying float vSoft;
varying vec2 vProj;
void main() {
  vec4 t = texture2D(tAtlas, vUv);
  float a = t.a * vColor.a;
  // no sheet of smoke right in the lens
  a *= smoothstep(0.25, 1.1, vDist);
  if (uSoft > 0.5) {
    // fade out where the sprite meets what the scene drew (and behind it: the depth test)
    float zd = texture2D(tDepth, gl_FragCoord.xy * uScreen).x * 2.0 - 1.0;
    a *= clamp((vProj.y / (zd + vProj.x) - vDist) / vSoft, 0.0, 1.0);
  }
  if (a < 0.003) discard;
  vec3 col = vColor.rgb * t.rgb;
  if (uAdditive > 0.5) {
    gl_FragColor = vec4(col * a * (1.0 - vFog), 1.0);
  } else {
    gl_FragColor = vec4(mix(col, uFogColor, vFog), a);
  }
}`;

function createSystem(max, atlas, additive, fog, shared) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.attributes.position = quad.attributes.position;
  geo.attributes.uv = quad.attributes.uv;
  const aPos = new Float32Array(max * 3), aColor = new Float32Array(max * 4);
  const aMisc = new Float32Array(max * 4), aStretch = new Float32Array(max * 3);
  const attrs = {
    aPos: new THREE.InstancedBufferAttribute(aPos, 3),
    aColor: new THREE.InstancedBufferAttribute(aColor, 4),
    aMisc: new THREE.InstancedBufferAttribute(aMisc, 4),
    aStretch: new THREE.InstancedBufferAttribute(aStretch, 3),
  };
  for (const [k, a] of Object.entries(attrs)) { a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, a); }
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { tAtlas: { value: atlas }, uFogColor: fog.color, uFogDensity: fog.density, uAdditive: { value: additive ? 1 : 0 }, uLit: { value: additive ? 0 : 1 }, ...shared },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
  });
  if (additive) {
    mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneFactor; mat.blendEquation = THREE.AddEquation;
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = additive ? 7 : 6;

  // particle state
  const P = {
    n: 0, max,
    px: new Float32Array(max), py: new Float32Array(max), pz: new Float32Array(max),
    vx: new Float32Array(max), vy: new Float32Array(max), vz: new Float32Array(max),
    life: new Float32Array(max), age: new Float32Array(max),
    s0: new Float32Array(max), s1: new Float32Array(max),
    c0: new Float32Array(max * 4), c1: new Float32Array(max * 4),
    rot: new Float32Array(max), rotV: new Float32Array(max), cell: new Float32Array(max), dense: new Float32Array(max),
    drag: new Float32Array(max), grav: new Float32Array(max), streak: new Float32Array(max),
    fadeIn: new Float32Array(max),
    // carried by the air: how much it rides the wind (its drag pulls it to the wind, not to rest),
    // how hard the eddies in it push it about, and their phase
    ride: new Float32Array(max), swirl: new Float32Array(max), ph: new Float32Array(max),
  };

  function spawn(o) {
    if (P.n >= max) return -1;
    const i = P.n++;
    P.px[i] = o.x; P.py[i] = o.y; P.pz[i] = o.z;
    P.vx[i] = o.vx || 0; P.vy[i] = o.vy || 0; P.vz[i] = o.vz || 0;
    P.life[i] = o.life; P.age[i] = 0;
    P.s0[i] = o.size; P.s1[i] = o.size1 ?? o.size;
    const c0 = o.color, c1 = o.color1 || o.color;
    P.c0.set(c0, i * 4); P.c1.set(c1, i * 4);
    P.rot[i] = o.rot ?? 0; P.rotV[i] = o.rotV || 0;
    P.cell[i] = o.cell; P.drag[i] = o.drag || 0; P.grav[i] = o.gravity || 0;
    P.streak[i] = o.streak || 0; P.fadeIn[i] = o.fadeIn || 0;
    P.ride[i] = o.ride || 0; P.swirl[i] = o.swirl || 0; P.ph[i] = (o.x * 1.7 + o.z * 2.3 + o.life * 5.1) % 6.2832;
    P.dense[i] = o.dense ? 1 : 0;
    return i;
  }

  function kill(i) {
    const j = --P.n;
    if (i === j) return;
    for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'age', 's0', 's1', 'rot', 'rotV', 'cell', 'dense', 'drag', 'grav', 'streak', 'fadeIn', 'ride', 'swirl', 'ph']) P[k][i] = P[k][j];
    P.c0.copyWithin(i * 4, j * 4, j * 4 + 4);
    P.c1.copyWithin(i * 4, j * 4, j * 4 + 4);
  }

  function update(dt, groundFn, wind = null) {
    const wx = wind ? wind.x : 0, wz = wind ? wind.z : 0;
    for (let i = P.n - 1; i >= 0; i--) {
      P.age[i] += dt;
      if (P.age[i] >= P.life[i]) { kill(i); continue; }
      const drag = Math.exp(-P.drag[i] * dt);
      const rx = wx * P.ride[i], rz = wz * P.ride[i];
      P.vx[i] = rx + (P.vx[i] - rx) * drag; P.vy[i] = P.vy[i] * drag - P.grav[i] * dt; P.vz[i] = rz + (P.vz[i] - rz) * drag;
      if (P.swirl[i] > 0) {
        const a = P.age[i] * 2.3 + P.ph[i], k = P.swirl[i] * dt;
        P.vx[i] += Math.sin(a) * k; P.vz[i] += Math.cos(a * 1.31 + 0.7) * k; P.vy[i] += Math.sin(a * 0.77 + 1.7) * k * 0.6;
      }
      P.px[i] += P.vx[i] * dt; P.py[i] += P.vy[i] * dt; P.pz[i] += P.vz[i] * dt;
      P.rot[i] += P.rotV[i] * dt;
      if (P.grav[i] > 0 && groundFn) {
        const g = groundFn(P.px[i], P.pz[i]);
        if (P.py[i] < g) { P.py[i] = g; P.vy[i] *= -0.25; P.vx[i] *= 0.5; P.vz[i] *= 0.5; }
      }
    }
    for (let i = 0; i < P.n; i++) {
      const t = P.age[i] / P.life[i];
      aPos[i * 3] = P.px[i]; aPos[i * 3 + 1] = P.py[i]; aPos[i * 3 + 2] = P.pz[i];
      const fin = P.fadeIn[i] > 0 ? Math.min(1, P.age[i] / P.fadeIn[i]) : 1;
      for (let k = 0; k < 4; k++) {
        let c = P.c0[i * 4 + k] + (P.c1[i * 4 + k] - P.c0[i * 4 + k]) * t;
        if (k === 3) c *= fin;
        aColor[i * 4 + k] = c;
      }
      aMisc[i * 4] = P.s0[i] + (P.s1[i] - P.s0[i]) * Math.sqrt(t);
      aMisc[i * 4 + 1] = P.rot[i];
      aMisc[i * 4 + 2] = P.cell[i];
      aMisc[i * 4 + 3] = P.dense[i];
      const st = P.streak[i];
      aStretch[i * 3] = P.vx[i] * st; aStretch[i * 3 + 1] = P.vy[i] * st; aStretch[i * 3 + 2] = P.vz[i] * st;
    }
    geo.instanceCount = P.n;
    for (const a of Object.values(attrs)) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, P.n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  return { mesh, spawn, update, P };
}

/* ---------- the effects library ---------- */

const C = (hex, a = 1, mul = 1) => {
  const c = new THREE.Color(hex);
  return [c.r * mul, c.g * mul, c.b * mul, a];
};

const IMPACT = {
  mud: { dust: '#3a2e22', chunk: '#2a2018', n: 5, spark: 0 },
  grass: { dust: '#3c3a28', chunk: '#2b3019', n: 4, spark: 0 },
  forest: { dust: '#3a2e22', chunk: '#2e2318', n: 4, spark: 0 },
  dirt: { dust: '#3a2e22', chunk: '#2a2018', n: 5, spark: 0 },
  cobble: { dust: '#6a665e', chunk: '#4a4741', n: 4, spark: 2 },
  stone: { dust: '#77736a', chunk: '#5a564e', n: 5, spark: 2 },
  concrete: { dust: '#7d7b75', chunk: '#5d5b55', n: 5, spark: 2 },
  wood: { dust: '#5a4632', chunk: '#6b5039', n: 6, spark: 0 },
  metal: { dust: '#3a3a3a', chunk: '#2a2a2a', n: 1, spark: 8 },
  sandbag: { dust: '#6d6047', chunk: '#5d5038', n: 3, spark: 0 },
  foliage: { dust: '#2d3a22', chunk: '#3c4a29', n: 6, spark: 0 },
  flesh: { dust: '#3d0806', chunk: '#2a0504', n: 0, spark: 0 },
};

export function createEffects({ fog, camera, wet = { value: 1 }, seed = 21 }) {
  const R = rng(seed);
  const atlas = makeAtlas();
  // the light and the scene depth, shared by both systems
  const shared = {
    uAmbient: { value: new THREE.Vector3(1, 1, 1) },
    uLightPos: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
    uLightCol: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
    uLightRange: { value: new Array(8).fill(1) },
    uLightCount: { value: 0 },
    tDepth: { value: null }, uSoft: { value: 0 }, uScreen: { value: new THREE.Vector2(1 / 1024, 1 / 768) },
  };
  const alpha = createSystem(3000, atlas, false, fog, shared);
  const add = createSystem(2500, atlas, true, fog, shared);
  // and what a blast throws up, drawn with the late pass after its fireball (fireball.js), so the
  // mud covers the fire it flies through
  const thrown = createSystem(600, atlas, false, fog, shared);
  thrown.mesh.renderOrder = 6.5;
  const group = new THREE.Group();
  group.name = 'effects';
  group.add(alpha.mesh, add.mesh, thrown.mesh);
  const fires = [];
  let groundFn = null, paneAt = null;

  /* The effects-chain pass: the sprites drawn into the scene's buffer (the
     first pass reads it, with its depth) before anything else in the chain. */
  const passScene = new THREE.Scene();
  const pass = {
    enabled: false, needsSwap: false, scene: passScene,
    setSize(w, h) { shared.uScreen.value.set(1 / w, 1 / h); },
    render(renderer, writeBuffer, readBuffer) {
      shared.tDepth.value = readBuffer.depthTexture;
      shared.uSoft.value = readBuffer.depthTexture ? 1 : 0;
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(readBuffer);
      renderer.render(passScene, camera);
      renderer.autoClear = auto;
    },
  };
  /* draw in the effects chain (true) or with the scene (false, into `scene`) */
  function usePass(on, scene) {
    pass.enabled = on;
    (on ? passScene : scene).add(group);
    alpha.mesh.material.depthTest = add.mesh.material.depthTest = thrown.mesh.material.depthTest = !on;
    if (!on) shared.uSoft.value = 0;
  }
  /* The late pass: what would smear through the temporal anti-aliasing (taa.js) —
     sparks, tracers, flashes, flames: the additive system, and whatever else is put in
     its scene (the rain, weather.js) — drawn after it over the resolved frame, still
     fading into the scene by its depth (borrowed: depth()). */
  const lateScene = new THREE.Scene();
  let lateDepth = null;
  const late = {
    enabled: false, needsSwap: false, scene: lateScene,
    setSize(w, h) { shared.uScreen.value.set(1 / w, 1 / h); },
    render(renderer, writeBuffer, readBuffer) {
      const dt = lateDepth ? lateDepth() : null;
      shared.tDepth.value = dt;
      shared.uSoft.value = dt ? 1 : 0;
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(readBuffer);
      renderer.render(lateScene, camera);
      renderer.autoClear = auto;
    },
  };
  /* the additive system after the anti-aliasing (on, with the scene depth's getter) or with the rest */
  function useLate(on, depth = null) {
    late.enabled = on;
    lateDepth = depth;
    (on ? lateScene : group).add(add.mesh, thrown.mesh);
  }
  /* this frame's lights ([{x, y, z, color, intensity, range}], lights.js) and the ambient (1 = as chosen) */
  function setLights(list, ambient = 1) {
    const n = Math.min(8, list.length);
    for (let i = 0; i < n; i++) {
      const l = list[i];
      shared.uLightPos.value[i].set(l.x, l.y, l.z);
      shared.uLightCol.value[i].set(l.color.r, l.color.g, l.color.b).multiplyScalar(l.intensity / Math.PI / 0.16);
      shared.uLightRange.value[i] = l.range;
    }
    shared.uLightCount.value = n;
    shared.uAmbient.value.setScalar(ambient);
  }

  function muzzle(x, y, z, dx, dy, dz, power = 1) {
    // no two shots flash alike - bigger or smaller, hotter or duller - so an MG's flashes, back to
    // back, flicker instead of standing over the muzzle as one glowing ball
    const v = 0.65 + R() * 0.7, heat = 0.6 + R() * 0.6;
    // a white-hot star at the muzzle in ragged tongues of the gas burning round it, each turned
    // its own way: seen head-on it reads as a flash with a shape and a colour, not a white ball
    add.spawn({ x, y, z, life: 0.05, size: 0.26 * power * v, size1: 0.4 * power * v, color: C('#ffe4ae', 1, 1.8 * heat), color1: C('#ff9a40', 0, 1.2 * heat), cell: CELLS.flash, rot: R() * 6.28 });
    for (let k = 0; k < 2; k++) {
      add.spawn({
        x: x + dx * 0.05, y: y + dy * 0.05, z: z + dz * 0.05, life: 0.04, size: 0.34 * power * v, size1: 0.46 * power * v,
        color: C('#ffa456', 0.9, 1.0 * heat), color1: C('#c04810', 0, 0.4), cell: CELLS.flame, rot: R() * 6.28,
      });
    }
    add.spawn({ x: x + dx * 0.12, y: y + dy * 0.12, z: z + dz * 0.12, vx: dx * 4, vy: dy * 4, vz: dz * 4, life: 0.045, size: 0.18 * power * (0.7 + R() * 0.6), size1: 0.28 * power * v, color: C('#fff0c0', 1, 2 * heat), color1: C('#ff9040', 0), cell: CELLS.flame, streak: 0.06, rot: 0 });
    // grains of powder still burning, flung on ahead of it
    for (let k = 0, n = 1 + Math.floor(R() * 3); k < n; k++) {
      const sp = 9 + R() * 12;
      add.spawn({
        x, y, z, vx: (dx + (R() - 0.5) * 0.35) * sp, vy: (dy + (R() - 0.5) * 0.35) * sp, vz: (dz + (R() - 0.5) * 0.35) * sp,
        life: 0.05 + R() * 0.07, size: 0.012, color: C('#ffd08a', 1, 2.6), color1: C('#ff6020', 0, 1), cell: CELLS.spark, streak: 0.018,
      });
    }
    // smokeless powder: a thin grey haze, not a cloud (at an MG's rate the puffs pile up, each
    // lit by the next shot's flash)
    alpha.spawn({ x: x + dx * 0.2, y, z: z + dz * 0.2, vx: dx * 1.2 + (R() - 0.5) * 0.3, vy: 0.4 + dy, vz: dz * 1.2 + (R() - 0.5) * 0.3, life: 1.2, size: 0.12, size1: 0.65, color: C('#706f6c', 0.13), color1: C('#5e5d5a', 0), cell: CELLS.smoke, drag: 2.5, rot: R() * 6, rotV: (R() - 0.5) });
  }

  function tracer(x, y, z, dx, dy, dz, dist, speed = 320, color = '#ffb070') {
    const life = Math.min(dist / speed, 1.2);
    add.spawn({ x, y, z, vx: dx * speed, vy: dy * speed, vz: dz * speed, life, size: 0.045, color: C(color, 1, 3), color1: C(color, 0.8, 2), cell: CELLS.streak, streak: 0.012 });
  }

  /* a bullet through a hedge or a bush: leaves shredded out of it that flutter down on the air
     (falling slowly, eddying, carried downwind, turning over), a twig or two, and in the rain the
     water shaken off the leaves */
  const LEAVES = ['#3d4a26', '#4c5a2b', '#2f3b1f', '#5d6435', '#6b6a3a', '#45512a'];
  function leaves(x, y, z, nx, ny, nz, dx, dy, dz) {
    alpha.spawn({
      x: x + nx * 0.05, y: y + ny * 0.05, z: z + nz * 0.05, vx: nx * 0.6 + dx * 0.4, vy: 0.2, vz: nz * 0.6 + dz * 0.4,
      life: 0.6, size: 0.12, size1: 0.5, color: C('#2d3a22', 0.4), color1: C('#2d3a22', 0), cell: CELLS.smoke, drag: 3.5, rot: R() * 6, rotV: R() - 0.5,
    });
    // fewer as the sprites fill up (a machine gun raking a hedge must not crowd out a blast's smoke)
    const room = Math.max(0, 1 - alpha.P.n / (alpha.P.max * 0.6));
    for (let k = 0, n = Math.round((16 + R() * 9) * room); k < n; k++) {
      const sp = 1 + R() * 2.6, col = LEAVES[Math.floor(R() * LEAVES.length)];
      alpha.spawn({
        x: x + (R() - 0.5) * 0.3, y: y + (R() - 0.3) * 0.35, z: z + (R() - 0.5) * 0.3,
        vx: nx * sp + dx * sp * 0.5 + (R() - 0.5) * 1.6, vy: ny * sp + R() * 1.6, vz: nz * sp + dz * sp * 0.5 + (R() - 0.5) * 1.6,
        life: 2.2 + R() * 1.6, size: 0.035 + R() * 0.045, color: C(col, 1), color1: C(col, 0.45), cell: CELLS.chunk,
        gravity: 1.4, drag: 2.4, swirl: 3.5, ride: 0.5, rot: R() * 6, rotV: (R() - 0.5) * 18,
      });
    }
    for (let k = 0; k < 2; k++) {
      alpha.spawn({
        x, y, z, vx: nx * (1 + R() * 2) + (R() - 0.5) * 1.5, vy: ny * 1.5 + R() * 2, vz: nz * (1 + R() * 2) + (R() - 0.5) * 1.5,
        life: 0.8, size: 0.03, color: C('#2e2416', 1), color1: C('#2e2416', 0.9), cell: CELLS.streak, gravity: 9.8, rot: R() * 6, rotV: (R() - 0.5) * 25,
      });
    }
    if (wet.value > 0.5) {
      for (let k = 0; k < 8; k++) {
        alpha.spawn({
          x: x + (R() - 0.5) * 0.3, y: y + (R() - 0.2) * 0.3, z: z + (R() - 0.5) * 0.3,
          vx: nx * (0.6 + R() * 1.6) + (R() - 0.5) * 1.6, vy: R() * 1.8, vz: nz * (0.6 + R() * 1.6) + (R() - 0.5) * 1.6,
          life: 0.5, size: 0.016, color: C('#aab4ba', 0.7), color1: C('#aab4ba', 0.1), cell: CELLS.spark, gravity: 9.8, streak: 0.012,
        });
      }
    }
  }

  function impact(x, y, z, nx, ny, nz, surface = 'stone', dx = 0, dy = 0, dz = 0) {
    if (surface === 'water') return splash(x, y, z, 1);
    if (surface === 'foliage') return leaves(x, y, z, nx, ny, nz, dx, dy, dz);
    // a lit window's glass, not the wall round it (the panes are atmosphere.js's)
    if ((surface === 'stone' || surface === 'wood') && paneAt) {
      const g = paneAt(x, y, z);
      if (g) return glass(g.x, g.y, g.z, g.n.x, g.n.z);
    }
    const s = IMPACT[surface] || IMPACT.stone;
    // dust puff pushed out of the surface
    for (let k = 0; k < 2; k++) {
      alpha.spawn({
        x: x + nx * 0.05, y: y + ny * 0.05, z: z + nz * 0.05,
        vx: nx * (0.8 + R()) + (R() - 0.5) * 0.6, vy: ny * (0.8 + R()) + 0.3, vz: nz * (0.8 + R()) + (R() - 0.5) * 0.6,
        life: 0.7 + R() * 0.5, size: 0.15, size1: 0.7 + R() * 0.4,
        color: C(s.dust, surface === 'flesh' ? 0.75 : 0.55), color1: C(s.dust, 0), cell: CELLS.smoke, drag: 3.5, rot: R() * 6, rotV: (R() - 0.5),
      });
    }
    for (let k = 0; k < s.n; k++) {
      alpha.spawn({
        x, y, z,
        vx: nx * (1.5 + R() * 2.5) + (R() - 0.5) * 2.5, vy: ny * (1.5 + R() * 2) + R() * 2.5, vz: nz * (1.5 + R() * 2.5) + (R() - 0.5) * 2.5,
        life: 0.6 + R() * 0.6, size: 0.03 + R() * 0.04, color: C(s.chunk, 1), color1: C(s.chunk, 0.9), cell: CELLS.chunk,
        gravity: 9.8, rot: R() * 6, rotV: (R() - 0.5) * 20,
      });
    }
    for (let k = 0; k < s.spark; k++) {
      add.spawn({
        x, y, z,
        vx: nx * (2 + R() * 4) + (R() - 0.5) * 4, vy: ny * (2 + R() * 3) + R() * 3, vz: nz * (2 + R() * 4) + (R() - 0.5) * 4,
        life: 0.1 + R() * 0.2, size: 0.016, color: C('#ffc070', 1, 2.4), color1: C('#ff5010', 0, 1.6), cell: CELLS.spark, gravity: 9.8, streak: 0.035,
      });
    }
    // wet ground throws up water with the dirt
    if (ny > 0.6 && wet.value > 0.5 && s.n > 0 && surface !== 'foliage' && surface !== 'flesh') {
      for (let k = 0; k < 5; k++) {
        alpha.spawn({
          x, y: y + 0.03, z, vx: (R() - 0.5) * 1.8 + nx, vy: 1.6 + R() * 2.4, vz: (R() - 0.5) * 1.8 + nz,
          life: 0.5, size: 0.022, color: C('#aab4ba', 0.75), color1: C('#aab4ba', 0.1), cell: CELLS.spark, gravity: 9.8, streak: 0.012,
        });
      }
    }
  }

  /* a round through a window's glass (facing nx, nz): shards of it broken out, glinting as they turn
     in the room's light and the lamps', falling, most just below the pane, a few thrown out further;
     a fleck or two catching the light brightly for a moment */
  function glass(x, y, z, nx, nz) {
    for (let k = 0, n = 10 + Math.floor(R() * 7); k < n; k++) {
      const out = 0.2 + R() * R() * 2.2, side = (R() - 0.5) * 1.2;
      alpha.spawn({
        x: x + nx * 0.03 + (R() - 0.5) * 0.08, y: y + (R() - 0.5) * 0.08, z: z + nz * 0.03 + (R() - 0.5) * 0.08,
        vx: nx * out - nz * side, vy: R() * 1.2 - 0.2, vz: nz * out + nx * side,
        life: 0.9 + R() * 0.6, size: 0.016 + R() * 0.024, color: C('#d4dde2', 0.9), color1: C('#c3ccd2', 0.75),
        cell: CELLS.chunk, gravity: 9.8, rot: R() * 6, rotV: (R() - 0.5) * 30,
      });
    }
    // flecks catching the light: a burst at the hole, and some going down with the shards, glinting
    // as they turn
    for (let k = 0; k < 10; k++) {
      const fall = k >= 4;
      add.spawn({
        x: x + nx * 0.04, y: y + (R() - 0.5) * 0.1, z: z + nz * 0.04,
        vx: nx * (0.3 + R() * (fall ? 0.8 : 1)) + (R() - 0.5) * 0.8, vy: R() * 0.8, vz: nz * (0.3 + R() * (fall ? 0.8 : 1)) + (R() - 0.5) * 0.8,
        life: fall ? 0.5 + R() * 0.5 : 0.08 + R() * 0.12, size: fall ? 0.008 : 0.01,
        color: C('#fff2d8', 1, fall ? 1.1 : 2.2), color1: C('#ffd8a0', 0, fall ? 0.6 : 1), cell: CELLS.spark, gravity: 9.8,
      });
    }
  }

  /* a wisp of steam off something hot in the rain (k: how hot, 0..1): small, faint, drawn out
     along its rise, curling and carried off on the wind */
  function steam(x, y, z, k = 1) {
    alpha.spawn({
      x: x + (R() - 0.5) * 0.02, y, z: z + (R() - 0.5) * 0.02,
      vx: (R() - 0.5) * 0.1, vy: 0.22 + R() * 0.25 * k, vz: (R() - 0.5) * 0.1,
      life: 0.6 + R() * 0.5, size: 0.018, size1: 0.06 + R() * 0.06,
      color: C('#c9ccce', 0.13 * k), color1: C('#c9ccce', 0), cell: CELLS.smoke,
      drag: 0.6, ride: 0.35, swirl: 1.2, gravity: -0.05, streak: 0.35, fadeIn: 0.12,
    });
  }

  function blood(x, y, z, dx, dy, dz) {
    for (let k = 0; k < 3; k++) {
      alpha.spawn({
        x, y, z, vx: dx * (1 + R() * 1.5) + (R() - 0.5), vy: dy + R() * 0.6, vz: dz * (1 + R() * 1.5) + (R() - 0.5),
        life: 0.5 + R() * 0.4, size: 0.12, size1: 0.45, color: C('#4a0a07', 0.7), color1: C('#2a0503', 0), cell: CELLS.smoke, drag: 4, rot: R() * 6,
      });
    }
  }

  function splash(x, y, z, power = 1) {
    // a spout of spray thrown up, stretched along its rise
    for (let k = 0; k < 3; k++) {
      alpha.spawn({
        x, y, z, vx: (R() - 0.5) * 0.8, vy: 2.5 + R() * 2 * power, vz: (R() - 0.5) * 0.8,
        life: 0.55, size: 0.08 * power, size1: 0.3 * power, color: C('#c8d0d4', 0.45), color1: C('#c8d0d4', 0), cell: CELLS.puff, gravity: 9.8, drag: 1, streak: 0.07,
      });
    }
    for (let k = 0; k < 6 * power; k++) {
      alpha.spawn({
        x, y, z, vx: (R() - 0.5) * 3, vy: 2 + R() * 3, vz: (R() - 0.5) * 3,
        life: 0.6, size: 0.04, color: C('#d0d8dc', 0.8), color1: C('#d0d8dc', 0.2), cell: CELLS.spark, gravity: 9.8,
      });
    }
    alpha.spawn({ x, y: y + 0.02, z, life: 0.6, size: 0.2, size1: 1.0 * power, color: C('#c8d0d4', 0.5), color1: C('#c8d0d4', 0), cell: CELLS.ring, rot: 0 });
  }

  // the pressure waves of the last blasts, for the distortion pass (distort.js): a shell
  // racing out to 14 m (times the blast's scale) in half a second, fading as it goes
  const shocks = [];
  // and the last blasts' fireballs (fireball.js draws them), for their first second and a half
  const blasts = [];
  function explosion(x, y, z, scale = 1, water = false) {
    if (shocks.length >= 3) shocks.shift();
    shocks.push({ x, y: y + 0.6, z, scale, age: 0, radius: 0, strength: 1 });
    if (!water) {
      if (blasts.length >= 4) blasts.shift();
      blasts.push({ x, y, z, scale, age: 0, seed: R() });
    }
    // a short, sharp flash (a frame or two: a blast is not a ball of light), and tongues of flame
    // thrown out of the fireball (fireball.js draws its body)
    add.spawn({ x, y: y + 0.5, z, life: 0.045, size: 1.5 * scale, size1: 2.6 * scale, color: C('#ffe2b0', 1, 1.9), color1: C('#ff7a20', 0, 0.8), cell: CELLS.flash, rot: R() * 6 });
    for (let k = 0; k < (water ? 12 : 4); k++) {
      const a = R() * 6.28, r = R();
      add.spawn({
        x: x + Math.cos(a) * r * 0.6, y: y + 0.3 + R() * 0.8, z: z + Math.sin(a) * r * 0.6,
        vx: Math.cos(a) * (2 + R() * 4) * scale, vy: (1 + R() * 4) * scale, vz: Math.sin(a) * (2 + R() * 4) * scale,
        life: 0.45 + R() * 0.4, size: 1.0 * scale, size1: 2.8 * scale, color: C('#ffa050', 1, 1.5), color1: C('#7a2008', 0, 0.4),
        cell: CELLS.flame, drag: 4, rot: R() * 6, rotV: (R() - 0.5) * 3,
      });
    }
    // the smoke glowing with the fire inside it for its first half second
    if (!water) for (let k = 0; k < 6; k++) {
      const a = R() * 6.28;
      add.spawn({
        x: x + (R() - 0.5), y: y + 0.6 + R() * 0.8, z: z + (R() - 0.5),
        vx: Math.cos(a) * (0.8 + R() * 2) * scale, vy: (1 + R() * 2) * scale, vz: Math.sin(a) * (0.8 + R() * 2) * scale,
        life: 0.55 + R() * 0.3, size: 1.4 * scale, size1: 3.8 * scale, color: C('#ff7a30', 0.55, 1.0), color1: C('#601806', 0),
        cell: CELLS.smoke, drag: 2, rot: R() * 6, rotV: (R() - 0.5) * 0.6,
      });
    }
    for (let k = 0; k < 16; k++) {
      const a = R() * 6.28;
      alpha.spawn({
        x: x + (R() - 0.5), y: y + 0.4 + R(), z: z + (R() - 0.5),
        vx: Math.cos(a) * (1 + R() * 3) * scale, vy: (1 + R() * 3) * scale, vz: Math.sin(a) * (1 + R() * 3) * scale,
        life: 4 + R() * 4, size: 1.2 * scale, size1: (5 + R() * 4) * scale,
        color: water ? C('#b8c0c4', 0.6) : C('#4e4740', 0.8), color1: water ? C('#9aa2a6', 0) : C('#3a3632', 0),
        cell: CELLS.smoke, drag: 1.8, gravity: -0.25, rot: R() * 6, rotV: (R() - 0.5) * 0.6, fadeIn: 0.1,
      });
    }
    // the column of earth (or water) the blast throws up, falling back: wet mud in dark jets fanning
    // out of it, stretched along their flight - drawn after the fireball, so they cover the fire they
    // fly through, and lit on the side facing a light (dark against the fireball)
    for (let k = 0; k < (water ? 16 : 30); k++) {
      const a = R() * 6.28, r = R() * 0.4, out = 0.3 + R() * R() * 3.2;
      thrown.spawn({
        x: x + Math.cos(a) * r, y: y + 0.15 + R() * 0.5, z: z + Math.sin(a) * r,
        vx: Math.cos(a) * out * scale, vy: (5 + R() * 10) * scale, vz: Math.sin(a) * out * scale,
        life: 1.0 + R() * 0.8, size: (0.3 + R() * 0.3) * scale, size1: (0.9 + R() * 0.7) * scale,
        color: water ? C('#c4ccd0', 0.75) : C('#2c241b', 0.95), color1: water ? C('#b0b8bc', 0) : C('#2f281f', 0),
        cell: CELLS.smoke, gravity: 9.8, drag: 0.5, streak: 0.075, fadeIn: 0.02, dense: !water,
      });
    }
    // dust (or spray) rolling out along the ground: from wet ground, more spray and smoke than
    // dust - dark and low
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * 6.28 + R() * 0.3;
      alpha.spawn({
        x: x + Math.cos(a) * 0.6, y: y + 0.3, z: z + Math.sin(a) * 0.6,
        vx: Math.cos(a) * (6 + R() * 5) * scale, vy: 0.2 + R() * 0.4, vz: Math.sin(a) * (6 + R() * 5) * scale,
        life: 2.5 + R() * 2, size: 0.7 * scale, size1: (3 + R() * 2.2) * scale,
        color: water ? C('#c0c8cc', 0.5) : C('#433c33', 0.5), color1: water ? C('#a8b0b4', 0) : C('#36312b', 0),
        cell: CELLS.smoke, drag: 3.2, rot: R() * 6, rotV: (R() - 0.5) * 0.8, fadeIn: 0.05,
      });
    }
    // spray, or (the clods and stones are solid, chunks.js) a spray of fine mud flung out in streaks
    for (let k = 0; k < (water ? 26 : 34); k++) {
      const a = R() * 6.28, up = 4 + R() * 9;
      (water ? alpha : thrown).spawn({
        x, y: y + 0.3, z, vx: Math.cos(a) * (2 + R() * 8) * scale, vy: up * scale, vz: Math.sin(a) * (2 + R() * 8) * scale,
        life: 1.2 + R() * 1.2, size: water ? 0.06 + R() * 0.12 : 0.03 + R() * 0.04, color: water ? C('#c8d0d4', 0.8) : C('#1e1812', 1), color1: water ? C('#c8d0d4', 0) : C('#1e1812', 0.8),
        cell: water ? CELLS.puff : CELLS.chunk, gravity: 9.8, rot: R() * 6, rotV: (R() - 0.5) * 20,
        streak: water ? 0 : 0.02, dense: !water,
      });
    }
    for (let k = 0; k < 20; k++) {
      const a = R() * 6.28;
      add.spawn({
        x, y: y + 0.4, z, vx: Math.cos(a) * (4 + R() * 9), vy: 2 + R() * 7, vz: Math.sin(a) * (4 + R() * 9),
        life: 0.4 + R() * 0.6, size: 0.04, color: C('#ffd080', 1, 3), color1: C('#ff4000', 0), cell: CELLS.spark, gravity: 9.8, streak: 0.025,
      });
    }
  }

  /* A continuous fire (burning truck, house): flames, smoke column, embers. */
  function addFire(x, y, z, size = 1) {
    const f = { x, y, z, size, acc: 0, on: true };
    fires.push(f);
    return f;
  }

  // the share of the sprite flames still spawned (flames.js draws the body of the fire over them)
  let flameShare = 1;
  function updateFires(dt, wind, camPos) {
    for (const f of fires) {
      if (!f.on) continue;
      const d2 = (f.x - camPos.x) ** 2 + (f.z - camPos.z) ** 2;
      if (d2 > (f.far ? 260 : 160) ** 2) continue;
      f.acc += dt;
      const rate = 1 / 28;
      while (f.acc > rate) {
        f.acc -= rate;
        const s = f.size;
        if (f.far || R() < flameShare) add.spawn({
          x: f.x + (R() - 0.5) * 1.2 * s, y: f.y + R() * 0.3, z: f.z + (R() - 0.5) * 1.2 * s,
          vx: wind.x * 0.3 + (R() - 0.5) * 0.3, vy: 1.4 + R() * 1.2, vz: wind.z * 0.3 + (R() - 0.5) * 0.3,
          life: 0.5 + R() * 0.45, size: (0.6 + R() * 0.5) * s, size1: 0.2 * s, color: C('#ffa040', 1, 2.2), color1: C('#a02808', 0, 0.8),
          cell: CELLS.flame, rot: (R() - 0.5) * 0.6, rotV: (R() - 0.5) * 2, drag: 0.5,
        });
        if (R() < 0.35) {
          alpha.spawn({
            x: f.x + (R() - 0.5) * s, y: f.y + 1.2 * s, z: f.z + (R() - 0.5) * s,
            vx: wind.x * 0.8 + (R() - 0.5) * 0.4, vy: 1.5 + R(), vz: wind.z * 0.8 + (R() - 0.5) * 0.4,
            life: 4 + R() * 3, size: 0.8 * s, size1: (4 + R() * 3) * s, color: C('#2a2624', 0.6), color1: C('#3a3836', 0),
            cell: CELLS.smoke, drag: 0.4, rot: R() * 6, rotV: (R() - 0.5) * 0.4, fadeIn: 0.3,
          });
        }
        // embers: thrown up out of the flames, then carried off on the wind for seconds, rising
        // and swirling in its eddies as they cool from yellow to a dull red and go out
        if (R() < 0.55) {
          const big = R() < 0.3;
          add.spawn({
            x: f.x + (R() - 0.5) * s, y: f.y + (0.6 + R() * 0.8) * s, z: f.z + (R() - 0.5) * s,
            vx: wind.x + (R() - 0.5) * 1.5, vy: 2 + R() * 2.5, vz: wind.z + (R() - 0.5) * 1.5,
            life: big ? 4 + R() * 3 : 1.5 + R() * 2, size: big ? 0.05 + R() * 0.025 : 0.035 + R() * 0.015,
            color: C('#ffc060', 1, 4.2), color1: C('#ff3800', 0, 1.1), cell: CELLS.spark,
            drag: 0.9, gravity: -0.12, ride: 1.25, swirl: 2.2 + R() * 1.6, streak: 0.012,
          });
        }
      }
      // and now and then it spits a shower of sparks, as a beam falls in or the last of a tank's
      // fuel catches: up out of the flames, arcing over and falling back, gone in a second or two
      f.pop = (f.pop ?? 1 + R() * 3) - dt;
      if (f.pop < 0 && !f.far) {
        f.pop = 1.5 + R() * 3;
        const s = f.size, n = 14 + Math.floor(R() * 12);
        for (let k = 0; k < n; k++) {
          add.spawn({
            x: f.x + (R() - 0.5) * 0.8 * s, y: f.y + (0.4 + R() * 0.6) * s, z: f.z + (R() - 0.5) * 0.8 * s,
            vx: wind.x * 0.5 + (R() - 0.5) * 3, vy: 3.5 + R() * 4, vz: wind.z * 0.5 + (R() - 0.5) * 3,
            life: 0.8 + R() * 1.4, size: 0.03 + R() * 0.03, color: C('#ffd27a', 1, 5), color1: C('#ff4a10', 0, 1.2),
            cell: CELLS.spark, drag: 0.6, gravity: 2.5, ride: 0.6, swirl: 1.5, streak: 0.02,
          });
        }
      }
    }
  }

  /* A flare going up: a streak of burning composition climbing 'height' metres in 'time' seconds. */
  function flareLaunch(x, y, z, height, time) {
    add.spawn({ x, y, z, vy: height / time, life: time, size: 0.35, color: C('#ffe2b0', 1, 4), color1: C('#ffc890', 0.8, 3), cell: CELLS.streak, streak: 0.05 });
    for (let k = 0; k < 6; k++) {
      add.spawn({
        x, y, z, vx: (R() - 0.5) * 2, vy: height / time * (0.3 + R() * 0.4), vz: (R() - 0.5) * 2,
        life: 0.6 + R() * 0.5, size: 0.08, color: C('#ffc070', 1, 3), color1: C('#ff6020', 0, 1), cell: CELLS.spark, gravity: 9.8, streak: 0.03,
      });
    }
  }

  function smokePuff(x, y, z, size = 1, color = '#555', life = 3) {
    alpha.spawn({ x, y, z, vx: (R() - 0.5) * 0.3, vy: 0.4, vz: (R() - 0.5) * 0.3, life, size: 0.4 * size, size1: 2.5 * size, color: C(color, 0.5), color1: C(color, 0), cell: CELLS.smoke, drag: 1, rot: R() * 6, rotV: (R() - 0.5) * 0.5, fadeIn: 0.2 });
  }

  /* an empty case thrown out of the gun: a brass one of casings.js, once there are some */
  let casings = null;
  function shell(x, y, z, dx, dz) {
    if (casings) return casings.eject(x, y, z, dx, dz);
    alpha.spawn({ x, y, z, vx: dx * 2 + (R() - 0.5), vy: 2 + R(), vz: dz * 2 + (R() - 0.5), life: 0.9, size: 0.02, color: C('#c8a050', 1, 1.2), color1: C('#c8a050', 1), cell: CELLS.chunk, gravity: 9.8, rot: R() * 6, rotV: 25 });
  }

  function update(dt, wind, camPos) {
    for (let i = blasts.length - 1; i >= 0; i--) {
      blasts[i].age += dt;
      if (blasts[i].age >= 1.6) blasts.splice(i, 1);
    }
    for (let i = shocks.length - 1; i >= 0; i--) {
      const s = shocks[i];
      s.age += dt;
      if (s.age >= 0.5) { shocks.splice(i, 1); continue; }
      s.radius = 14 * s.scale * Math.sqrt(s.age / 0.5);
      s.strength = (1 - s.age / 0.5) ** 1.5;
    }
    updateFires(dt, wind, camPos);
    alpha.update(dt, groundFn, wind);
    add.update(dt, groundFn, wind);
    thrown.update(dt, groundFn, wind);
  }

  return {
    group, muzzle, tracer, impact, blood, splash, explosion, addFire, smokePuff, shell, steam, glass, flareLaunch, update, fires,
    pass, usePass, late, useLate, setLights, shocks, blasts,
    setFlameShare(v) { flameShare = v; },
    /* the scene depth, its texel and whether to fade by it: for others drawn in the late pass */
    depthUniforms: { tDepth: shared.tDepth, uScreen: shared.uScreen, uSoft: shared.uSoft },
    setGround(fn) { groundFn = fn; },
    /* fn(x, y, z): the lit window pane a hit on a wall there went into, or null (decals.paneAt) */
    setPaneAt(fn) { paneAt = fn; },
    setCasings(c) { casings = c; },
    get count() { return alpha.P.n + add.P.n + thrown.P.n; },
  };
}
