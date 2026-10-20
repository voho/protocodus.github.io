/* Hedgerow — particles: muzzle flashes, tracers, impacts, blood, smoke,
   fire, explosions.

   Two instanced sprite systems share one generated texture atlas: one
   alpha-blended (smoke, dust, debris, water), one additive (fire, flashes,
   sparks, tracers). Particles live in flat typed arrays on the CPU; each
   frame the live ones are packed into the instance attributes. A sprite
   with a stretch vector is drawn as a streak along it (tracers, sparks). */

import * as THREE from 'three';
import { rng } from './util.js';

const CELLS = { puff: 0, smoke: 1, flash: 2, spark: 3, chunk: 4, ring: 5, streak: 6, flame: 7 };

function makeAtlas() {
  const S = 128;
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
  // 1 lumpy smoke puff
  {
    const [x, y] = cell(1);
    for (let k = 0; k < 18; k++) {
      const a = R() * Math.PI * 2, r = R() * S * 0.22;
      const cx = x + S / 2 + Math.cos(a) * r, cy = y + S / 2 + Math.sin(a) * r;
      const rad = S * (0.14 + R() * 0.16);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x, y, S, S);
    }
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
  // 7 flame tongue
  {
    const [x, y] = cell(7);
    for (let k = 0; k < 10; k++) {
      const cx = x + S / 2 + (R() - 0.5) * S * 0.3, cy = y + S * (0.45 + R() * 0.25);
      const rad = S * (0.12 + R() * 0.15);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x, y, S, S);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aColor;
attribute vec4 aMisc;      // size, rotation, cell, unused
attribute vec3 aStretch;
uniform float uFogDensity;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main() {
  float size = aMisc.x;
  vec3 p = aPos;
  vec3 wp;
  vec2 q = uv - 0.5;
  float sl = length(aStretch);
  if (sl > 1e-4) {
    vec3 axis = aStretch / sl;
    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = normalize(cross(axis, toCam));
    wp = p + side * q.x * size + axis * q.y * (sl + size);
  } else {
    float c = cos(aMisc.y), s = sin(aMisc.y);
    vec2 r = vec2(q.x * c - q.y * s, q.x * s + q.y * c) * size;
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    wp = p + right * r.x + up * r.y;
  }
  float cellI = aMisc.z;
  vUv = (vec2(mod(cellI, 4.0), 1.0 - floor(cellI / 4.0)) + uv) * vec2(0.25, 0.5);
  vColor = aColor;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float d = -mv.z;
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D tAtlas;
uniform vec3 uFogColor;
uniform float uAdditive;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main() {
  vec4 t = texture2D(tAtlas, vUv);
  float a = t.a * vColor.a;
  if (a < 0.003) discard;
  vec3 col = vColor.rgb * t.rgb;
  if (uAdditive > 0.5) {
    gl_FragColor = vec4(col * a * (1.0 - vFog), 1.0);
  } else {
    gl_FragColor = vec4(mix(col, uFogColor, vFog), a);
  }
}`;

function createSystem(max, atlas, additive, fog) {
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
    uniforms: { tAtlas: { value: atlas }, uFogColor: fog.color, uFogDensity: fog.density, uAdditive: { value: additive ? 1 : 0 } },
    transparent: true, depthWrite: false,
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
    rot: new Float32Array(max), rotV: new Float32Array(max), cell: new Float32Array(max),
    drag: new Float32Array(max), grav: new Float32Array(max), streak: new Float32Array(max),
    fadeIn: new Float32Array(max),
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
    return i;
  }

  function kill(i) {
    const j = --P.n;
    if (i === j) return;
    for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'age', 's0', 's1', 'rot', 'rotV', 'cell', 'drag', 'grav', 'streak', 'fadeIn']) P[k][i] = P[k][j];
    P.c0.copyWithin(i * 4, j * 4, j * 4 + 4);
    P.c1.copyWithin(i * 4, j * 4, j * 4 + 4);
  }

  function update(dt, groundFn) {
    for (let i = P.n - 1; i >= 0; i--) {
      P.age[i] += dt;
      if (P.age[i] >= P.life[i]) { kill(i); continue; }
      const drag = Math.exp(-P.drag[i] * dt);
      P.vx[i] *= drag; P.vy[i] = P.vy[i] * drag - P.grav[i] * dt; P.vz[i] *= drag;
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

export function createEffects({ fog, seed = 21 }) {
  const R = rng(seed);
  const atlas = makeAtlas();
  const alpha = createSystem(3000, atlas, false, fog);
  const add = createSystem(2500, atlas, true, fog);
  const group = new THREE.Group();
  group.name = 'effects';
  group.add(alpha.mesh, add.mesh);
  const fires = [];
  let groundFn = null;

  function muzzle(x, y, z, dx, dy, dz, power = 1) {
    add.spawn({ x, y, z, life: 0.05, size: 0.32 * power, size1: 0.5 * power, color: C('#ffd08a', 1, 2.4), color1: C('#ff8a30', 0, 1.5), cell: CELLS.flash, rot: R() * 6.28 });
    add.spawn({ x: x + dx * 0.12, y: y + dy * 0.12, z: z + dz * 0.12, vx: dx * 4, vy: dy * 4, vz: dz * 4, life: 0.045, size: 0.18 * power, size1: 0.28 * power, color: C('#fff0c0', 1, 2), color1: C('#ff9040', 0), cell: CELLS.flame, streak: 0.06, rot: 0 });
    alpha.spawn({ x: x + dx * 0.2, y, z: z + dz * 0.2, vx: dx * 1.2 + (R() - 0.5) * 0.3, vy: 0.4 + dy, vz: dz * 1.2 + (R() - 0.5) * 0.3, life: 0.9, size: 0.12, size1: 0.6, color: C('#9a9a98', 0.22), color1: C('#7a7a78', 0), cell: CELLS.smoke, drag: 2.5, rot: R() * 6, rotV: (R() - 0.5) });
  }

  function tracer(x, y, z, dx, dy, dz, dist, speed = 320, color = '#ffb070') {
    const life = Math.min(dist / speed, 1.2);
    add.spawn({ x, y, z, vx: dx * speed, vy: dy * speed, vz: dz * speed, life, size: 0.045, color: C(color, 1, 3), color1: C(color, 0.8, 2), cell: CELLS.streak, streak: 0.012 });
  }

  function impact(x, y, z, nx, ny, nz, surface = 'stone', dx = 0, dy = 0, dz = 0) {
    if (surface === 'water') return splash(x, y, z, 1);
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
        life: 0.15 + R() * 0.25, size: 0.025, color: C('#ffc070', 1, 3), color1: C('#ff5010', 0, 2), cell: CELLS.spark, gravity: 9.8, streak: 0.02,
      });
    }
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
    for (let k = 0; k < 3; k++) {
      alpha.spawn({
        x, y, z, vx: (R() - 0.5) * 0.8, vy: 2.5 + R() * 2 * power, vz: (R() - 0.5) * 0.8,
        life: 0.55, size: 0.1 * power, size1: 0.45 * power, color: C('#c8d0d4', 0.5), color1: C('#c8d0d4', 0), cell: CELLS.puff, gravity: 9.8, drag: 1,
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

  function explosion(x, y, z, scale = 1, water = false) {
    add.spawn({ x, y: y + 0.5, z, life: 0.14, size: 4 * scale, size1: 7 * scale, color: C('#ffd9a0', 1, 4), color1: C('#ff7a20', 0, 2), cell: CELLS.flash, rot: R() * 6 });
    for (let k = 0; k < 12; k++) {
      const a = R() * 6.28, r = R();
      add.spawn({
        x: x + Math.cos(a) * r * 0.6, y: y + 0.3 + R() * 0.8, z: z + Math.sin(a) * r * 0.6,
        vx: Math.cos(a) * (2 + R() * 4) * scale, vy: (1 + R() * 4) * scale, vz: Math.sin(a) * (2 + R() * 4) * scale,
        life: 0.35 + R() * 0.35, size: 0.8 * scale, size1: 2.6 * scale, color: C('#ffb060', 1, 3), color1: C('#a03010', 0, 0.6),
        cell: CELLS.flame, drag: 4, rot: R() * 6, rotV: (R() - 0.5) * 3,
      });
    }
    for (let k = 0; k < 16; k++) {
      const a = R() * 6.28;
      alpha.spawn({
        x: x + (R() - 0.5), y: y + 0.4 + R(), z: z + (R() - 0.5),
        vx: Math.cos(a) * (1 + R() * 3) * scale, vy: (1 + R() * 3) * scale, vz: Math.sin(a) * (1 + R() * 3) * scale,
        life: 2.5 + R() * 2.5, size: 1.2 * scale, size1: (4 + R() * 3) * scale,
        color: water ? C('#b8c0c4', 0.6) : C('#3a3430', 0.75), color1: water ? C('#9aa2a6', 0) : C('#2a2826', 0),
        cell: CELLS.smoke, drag: 1.8, gravity: -0.25, rot: R() * 6, rotV: (R() - 0.5) * 0.6, fadeIn: 0.1,
      });
    }
    for (let k = 0; k < 26; k++) {
      const a = R() * 6.28, up = 4 + R() * 9;
      alpha.spawn({
        x, y: y + 0.3, z, vx: Math.cos(a) * (2 + R() * 7) * scale, vy: up * scale, vz: Math.sin(a) * (2 + R() * 7) * scale,
        life: 1.2 + R() * 1.2, size: 0.06 + R() * 0.12, color: water ? C('#c8d0d4', 0.8) : C('#241c14', 1), color1: water ? C('#c8d0d4', 0) : C('#241c14', 0.8),
        cell: water ? CELLS.puff : CELLS.chunk, gravity: 9.8, rot: R() * 6, rotV: (R() - 0.5) * 20,
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
        add.spawn({
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
        if (R() < 0.15) {
          add.spawn({
            x: f.x + (R() - 0.5) * s, y: f.y + 0.6 * s, z: f.z + (R() - 0.5) * s,
            vx: wind.x + (R() - 0.5) * 1.5, vy: 2 + R() * 2.5, vz: wind.z + (R() - 0.5) * 1.5,
            life: 1 + R() * 1.5, size: 0.03, color: C('#ffb050', 1, 3), color1: C('#ff5010', 0), cell: CELLS.spark, drag: 0.8,
          });
        }
      }
    }
  }

  function smokePuff(x, y, z, size = 1, color = '#555', life = 3) {
    alpha.spawn({ x, y, z, vx: (R() - 0.5) * 0.3, vy: 0.4, vz: (R() - 0.5) * 0.3, life, size: 0.4 * size, size1: 2.5 * size, color: C(color, 0.5), color1: C(color, 0), cell: CELLS.smoke, drag: 1, rot: R() * 6, rotV: (R() - 0.5) * 0.5, fadeIn: 0.2 });
  }

  function shell(x, y, z, dx, dz) {
    alpha.spawn({ x, y, z, vx: dx * 2 + (R() - 0.5), vy: 2 + R(), vz: dz * 2 + (R() - 0.5), life: 0.9, size: 0.02, color: C('#c8a050', 1, 1.2), color1: C('#c8a050', 1), cell: CELLS.chunk, gravity: 9.8, rot: R() * 6, rotV: 25 });
  }

  function update(dt, wind, camPos) {
    updateFires(dt, wind, camPos);
    alpha.update(dt, groundFn);
    add.update(dt, groundFn);
  }

  return {
    group, muzzle, tracer, impact, blood, splash, explosion, addFire, smokePuff, shell, update, fires,
    setGround(fn) { groundFn = fn; },
    get count() { return alpha.P.n + add.P.n; },
  };
}
