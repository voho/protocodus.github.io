/* Hedgerow — atmosphere: halos round lights in the wet air, low mist
   drifting over the fields, the river and the forest floor, and decals left
   by bullets and explosions. */

import * as THREE from 'three';
import { rng, smoothstep } from './util.js';

function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) gr.addColorStop(p, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- halos ---------- */

export function createHalos(fogDensity = 0.018) {
  const tex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,255,255,0.55)'], [0.4, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
  const group = new THREE.Group();
  group.name = 'halos';
  const items = [];

  function add(x, y, z, color = '#ffb060', size = 2, strength = 1, flicker = 0) {
    const m = new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(color).multiplyScalar(strength), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const s = new THREE.Sprite(m);
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    s.renderOrder = 8;
    group.add(s);
    const it = { s, size, strength, flicker, phase: Math.random() * 100, on: true };
    items.push(it);
    return it;
  }

  function update(dt, time, cam) {
    for (const it of items) {
      const d = it.s.position.distanceTo(cam);
      const vis = it.on && d < 600;
      it.s.visible = vis;
      if (!vis) continue;
      let k = 1;
      if (it.flicker) {
        const t = time * 9 + it.phase;
        k = 1 - it.flicker * (0.5 + 0.5 * Math.sin(t) * Math.sin(t * 2.31 + 1.3));
      }
      // fade into the fog, and not right in the face
      const fog = Math.exp(-(d * fogDensity) * (d * fogDensity));
      it.s.material.opacity = k * fog * smoothstep(0.8, 3, d);
      it.s.scale.setScalar(it.size * (0.9 + 0.2 * k));
    }
  }

  return { group, add, update, items };
}

/* ---------- mist ---------- */

const MIST_VERT = /* glsl */ `
attribute vec4 aMist;      // xyz centre, w seed
attribute vec2 aSize;      // width, height
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
void main() {
  vec3 c = aMist.xyz + vec3(sin(uTime * 0.05 + aMist.w * 6.0) * 2.0, 0.0, cos(uTime * 0.04 + aMist.w * 4.0) * 2.0);
  // cylindrical billboard: turn about y to the camera
  vec3 toCam = cameraPosition - c;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
  vec3 p = c + right * (uv.x - 0.5) * aSize.x + vec3(0.0, (uv.y - 0.2) * aSize.y, 0.0);
  vUv = uv;
  vSeed = aMist.w;
  float d = length(toCam);
  vFade = smoothstep(2.0, 10.0, d) * (1.0 - smoothstep(55.0, 80.0, d));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const MIST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime, uOpacity, uFlash;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec2 q = vUv * vec2(3.0, 1.2) + vec2(uTime * 0.02 + vSeed * 9.0, vSeed * 3.0);
  float n = noise(q) * 0.6 + noise(q * 2.3) * 0.3 + noise(q * 5.1) * 0.1;
  float shape = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
  float a = shape * smoothstep(0.25, 0.75, n) * uOpacity * vFade;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * (1.0 + uFlash * 2.5), a);
}`;

export function createMist({ count = 70, terrain, density = () => 1, seed = 31, color = '#4a5058' }) {
  const R = rng(seed);
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0.5, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.attributes.position = quad.attributes.position;
  geo.attributes.uv = quad.attributes.uv;
  const aMist = new Float32Array(count * 4), aSize = new Float32Array(count * 2);
  const mistAttr = new THREE.InstancedBufferAttribute(aMist, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aMist', mistAttr);
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 2));
  geo.instanceCount = count;
  const uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0.16 }, uFlash: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, uniforms, transparent: true, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  let placed = false;

  function place(i, cx, cz, near) {
    for (let k = 0; k < 6; k++) {
      const a = R() * Math.PI * 2, r = near ? 8 + R() * 55 : 45 + R() * 25;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const d = density(x, z);
      if (R() > d) continue;
      aMist[i * 4] = x; aMist[i * 4 + 1] = terrain.height(x, z) - 0.3; aMist[i * 4 + 2] = z; aMist[i * 4 + 3] = R();
      aSize[i * 2] = 10 + R() * 12; aSize[i * 2 + 1] = 2.5 + R() * 3 * d;
      return;
    }
    aMist[i * 4 + 1] = -1000;
  }

  function update(dt, cam, time = 0, flash = 0) {
    uniforms.uTime.value += dt;
    uniforms.uFlash.value = flash;
    let changed = false;
    for (let i = 0; i < count; i++) {
      const dx = aMist[i * 4] - cam.x, dz = aMist[i * 4 + 2] - cam.z;
      if (!placed || dx * dx + dz * dz > 85 * 85 || aMist[i * 4 + 1] < -500) {
        place(i, cam.x, cam.z, !placed);
        changed = true;
      }
    }
    placed = true;
    if (changed) { mistAttr.needsUpdate = true; geo.attributes.aSize.needsUpdate = true; }
  }

  return { mesh, update, uniforms };
}

/* ---------- decals ---------- */

function decalTexture(kind) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const R = rng(kind.length * 17);
  if (kind === 'hole') {
    // chipped crater with a dark core
    for (let k = 0; k < 14; k++) {
      const a = R() * 6.28, r = R() * S * 0.18;
      g.fillStyle = `rgba(${40 + R() * 30},${36 + R() * 25},${30 + R() * 20},${0.35 + R() * 0.3})`;
      g.beginPath();
      g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, S * (0.06 + R() * 0.12), 0, 6.28);
      g.fill();
    }
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.12);
    gr.addColorStop(0, 'rgba(5,4,3,1)'); gr.addColorStop(1, 'rgba(5,4,3,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  } else if (kind === 'splat') {
    for (let k = 0; k < 22; k++) {
      const a = R() * 6.28, r = R() * S * 0.3;
      g.fillStyle = `rgba(${30 + R() * 20},${24 + R() * 15},${16 + R() * 10},${0.25 + R() * 0.4})`;
      g.beginPath();
      g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, S * (0.03 + R() * 0.08), 0, 6.28);
      g.fill();
    }
  } else {
    // scorch
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(8,7,6,0.95)'); gr.addColorStop(0.5, 'rgba(14,12,10,0.7)'); gr.addColorStop(1, 'rgba(20,18,15,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 40; k++) {
      const a = R() * 6.28, r = S * (0.25 + R() * 0.25);
      g.strokeStyle = `rgba(10,9,8,${0.3 + R() * 0.4})`;
      g.lineWidth = 1 + R() * 3;
      g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createDecals({ max = 260 } = {}) {
  const group = new THREE.Group();
  group.name = 'decals';
  const kinds = {};
  const geo = new THREE.PlaneGeometry(1, 1);
  for (const k of ['hole', 'splat', 'scorch']) {
    const mat = new THREE.MeshStandardMaterial({
      map: decalTexture(k), transparent: true, depthWrite: false, roughness: 0.95,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const m = new THREE.InstancedMesh(geo, mat, k === 'scorch' ? 24 : max);
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = 2;
    group.add(m);
    kinds[k] = { mesh: m, cursor: 0, n: 0, cap: k === 'scorch' ? 24 : max };
  }
  const q = new THREE.Quaternion(), z = new THREE.Vector3(0, 0, 1), n = new THREE.Vector3(), roll = new THREE.Quaternion();
  const mtx = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3();

  function add(kind, x, y, zz, nx, ny, nz, size) {
    const K = kinds[kind];
    if (!K) return;
    n.set(nx, ny, nz).normalize();
    q.setFromUnitVectors(z, n);
    roll.setFromAxisAngle(n, Math.random() * Math.PI * 2);
    q.premultiply(roll);
    pos.set(x + nx * 0.012, y + ny * 0.012, zz + nz * 0.012);
    scl.set(size, size, 1);
    mtx.compose(pos, q, scl);
    K.mesh.setMatrixAt(K.cursor, mtx);
    K.cursor = (K.cursor + 1) % K.cap;
    K.n = Math.min(K.cap, K.n + 1);
    K.mesh.count = K.n;
    K.mesh.instanceMatrix.needsUpdate = true;
  }

  /* A bullet impact by surface. */
  function impact(x, y, zz, nx, ny, nz, surface) {
    if (surface === 'water' || surface === 'foliage' || surface === 'flesh') return;
    const ground = surface === 'mud' || surface === 'grass' || surface === 'forest' || surface === 'dirt';
    add(ground ? 'splat' : 'hole', x, y, zz, nx, ny, nz, ground ? 0.35 + Math.random() * 0.2 : 0.09 + Math.random() * 0.06);
  }

  function clear() { for (const K of Object.values(kinds)) { K.n = 0; K.cursor = 0; K.mesh.count = 0; } }

  return { group, add, impact, clear };
}
