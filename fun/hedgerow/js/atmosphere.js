/* Hedgerow — atmosphere: halos round lights in the wet air, low mist
   drifting over the fields, the river and the forest floor, and decals left
   by bullets and explosions. */

import * as THREE from 'three';
import { rng, smoothstep } from './util.js';
import { dimFillSpecular } from './fill.js';

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

/* What a bullet leaves, by what it hit, and the scorch of a blast. Each is a
   small lit quad with a relief of its own (a normal map, so a lamp, a fire, a
   flare or the muzzle flash picks out a crater's rim): stone chipped away pale
   round a black hole, cracked and powdered; wood splintered along its grain,
   the fresh wood showing; paint dented and flaked off to the bare steel round
   a hole; mud thrown up in clods. Every kind is painted four ways (the
   quarters of its textures), and each decal takes one at random, turned at
   random. A bullet stops at a collider, a flat box, and a wall's stones bulge a
   few centimetres out of it: so each decal is drawn pulled towards the eye
   along its own sight line (it stays where it is on the screen) by PULL, which
   brings it out over the stones instead of into them. */

const PULL = 0.06;
const FLAT = 160; // a relief's surface, on its height canvas (lower is sunk in)
const CELL = 256; // a variant's size in texels; four to a texture

/* A decal is painted with the same strokes on its canvases: the colour (opaque
   all over, so a texel at an edge filters with its own colour, not black), how
   much of it shows, its height and (metal) where it is bare. */
function painter(S, ground, bare = false) {
  const mk = (fill) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = fill;
    g.fillRect(0, 0, S, S);
    return g;
  };
  const p = { S, col: mk(ground), alpha: mk('#000'), height: mk(`rgb(${FLAT},${FLAT},${FLAT})`), bare: bare ? mk('#000') : null };
  const all = [p.col, p.alpha, p.height, p.bare].filter(Boolean);
  // one shape onto the canvases named in `styles` (a fill or stroke style each)
  p.fill = (path, styles) => { for (const k in styles) { p[k].fillStyle = styles[k]; p[k].fill(path); } };
  p.stroke = (path, styles, width) => { for (const k in styles) { p[k].strokeStyle = styles[k]; p[k].lineWidth = width; p[k].stroke(path); } };
  // paint only inside one variant's square
  p.clip = (x, y, w) => { for (const g of all) { g.save(); g.beginPath(); g.rect(x, y, w, w); g.clip(); } };
  p.unclip = () => { for (const g of all) g.restore(); };
  return p;
}

const grey = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;

/* a ragged outline round (x, y): n corners out to r, each pulled in by up to jag of it */
function ragged(R, x, y, r, n, jag) {
  const path = new Path2D();
  for (let i = 0; i < n; i++) {
    const a = ((i + (R() - 0.5) * 0.8) / n) * Math.PI * 2, rr = r * (1 - jag * R());
    path[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  path.closePath();
  return path;
}

function disc(x, y, r) {
  const path = new Path2D();
  path.arc(x, y, r, 0, Math.PI * 2);
  return path;
}

/* a crack wandering from (x, y) along ang */
function crack(R, x, y, ang, len, steps = 5) {
  const path = new Path2D();
  path.moveTo(x, y);
  for (let s = 0; s < steps; s++) {
    ang += (R() - 0.5) * 0.8;
    x += (Math.cos(ang) * len) / steps;
    y += (Math.sin(ang) * len) / steps;
    path.lineTo(x, y);
  }
  return path;
}

/* a splinter: a sliver from (x, y) along ang, w wide at its root, to a point */
function sliver(x, y, ang, len, w) {
  const path = new Path2D(), c = Math.cos(ang), s = Math.sin(ang);
  path.moveTo(x - s * w * 0.5, y + c * w * 0.5);
  path.lineTo(x + c * len * 0.6 - s * w * 0.3, y + s * len * 0.6 + c * w * 0.3);
  path.lineTo(x + c * len, y + s * len);
  path.lineTo(x + c * len * 0.55 + s * w * 0.35, y + s * len * 0.55 - c * w * 0.35);
  path.lineTo(x + s * w * 0.5, y - c * w * 0.5);
  path.closePath();
  return path;
}

/* stone (and brick, cobbles, concrete): the face spalled away in chips, lopsided, round a black hole */
function stoneHole(p, R, cx, cy, S) {
  const ox = cx + (R() - 0.5) * S * 0.08, oy = cy + (R() - 0.5) * S * 0.08;
  // the powder of it thrown round, and grit
  const dust = p.alpha.createRadialGradient(ox, oy, S * 0.1, ox, oy, S * 0.42);
  dust.addColorStop(0, grey(55 + R() * 30)); dust.addColorStop(1, grey(0));
  p.alpha.fillStyle = dust; p.alpha.fill(disc(ox, oy, S * 0.42));
  for (let k = 0; k < 60; k++) {
    const a = R() * Math.PI * 2, r = S * (0.13 + 0.27 * Math.sqrt(R())), v = 105 + R() * 70;
    p.fill(disc(ox + Math.cos(a) * r, oy + Math.sin(a) * r, S * (0.004 + R() * 0.008)), { col: `rgb(${v},${v * 0.95},${v * 0.87})`, alpha: grey(60 + R() * 100), height: grey(FLAT + 6) });
  }
  // cracks running out of it
  for (let k = 0, m = 2 + Math.floor(R() * 4); k < m; k++) {
    const a = R() * Math.PI * 2;
    p.stroke(crack(R, cx + Math.cos(a) * S * 0.13, cy + Math.sin(a) * S * 0.13, a, S * (0.1 + R() * 0.16)), { col: 'rgb(30,28,25)', alpha: grey(200), height: grey(FLAT - 28) }, S * (0.005 + R() * 0.005));
  }
  // the crater, in chips that each broke off at a depth of their own
  const cr = S * (0.15 + R() * 0.09), kx = (cx + ox) / 2, ky = (cy + oy) / 2;
  p.fill(ragged(R, kx, ky, cr, 13 + Math.floor(R() * 6), 0.45), { col: 'rgb(150,141,127)', alpha: grey(255), height: grey(FLAT - 34) });
  for (let k = 0, m = 8 + Math.floor(R() * 5); k < m; k++) {
    const a = R() * Math.PI * 2, r = cr * 0.6 * Math.sqrt(R()), v = 125 + R() * 55;
    p.fill(ragged(R, kx + Math.cos(a) * r, ky + Math.sin(a) * r, S * (0.04 + R() * 0.05), 7, 0.4), { col: `rgb(${v},${v * 0.94},${v * 0.85})`, alpha: grey(255), height: grey(FLAT - 70 + (r / S) * 300 + R() * 18) });
  }
  // deepest in the middle, round the hole the lead and soot the bullet wiped off
  const pit = p.height.createRadialGradient(cx, cy, 0, cx, cy, cr * 0.7);
  pit.addColorStop(0, 'rgba(60,60,60,1)'); pit.addColorStop(1, 'rgba(60,60,60,0)');
  p.height.fillStyle = pit; p.height.fill(disc(cx, cy, cr * 0.7));
  const hr = S * (0.035 + R() * 0.015);
  const wipe = p.col.createRadialGradient(cx, cy, hr * 0.8, cx, cy, hr * 2.4);
  wipe.addColorStop(0, 'rgba(22,20,18,0.95)'); wipe.addColorStop(1, 'rgba(22,20,18,0)');
  p.col.fillStyle = wipe; p.col.fill(disc(cx, cy, hr * 2.4));
  p.fill(ragged(R, cx, cy, hr, 9, 0.3), { col: 'rgb(5,4,4)', height: grey(0) });
}

/* wood: torn open along the grain (the texture's up and down), the fresh wood splintered out */
function woodHole(p, R, cx, cy, S) {
  const dust = p.alpha.createRadialGradient(cx, cy, S * 0.08, cx, cy, S * 0.3);
  dust.addColorStop(0, grey(70)); dust.addColorStop(1, grey(0));
  p.alpha.fillStyle = dust; p.alpha.fill(disc(cx, cy, S * 0.3));
  for (let k = 0, m = 14 + Math.floor(R() * 12); k < m; k++) {
    const ang = (R() < 0.5 ? -1 : 1) * Math.PI * 0.5 + (R() - 0.5) * 0.6, v = 140 + R() * 70;
    const x = cx + (R() - 0.5) * S * 0.09, y = cy + (R() - 0.5) * S * 0.07;
    p.fill(sliver(x, y, ang, S * (0.1 + R() * 0.28), S * (0.015 + R() * 0.03)), { col: `rgb(${v},${v * 0.8},${v * 0.54})`, alpha: grey(255), height: grey(FLAT + 14 + R() * 40) });
  }
  // the hole torn into it, darker where the wood is crushed
  p.fill(ragged(R, cx, cy, S * (0.07 + R() * 0.03), 11, 0.35), { col: 'rgb(62,44,26)', alpha: grey(255), height: grey(FLAT - 50) });
  p.fill(ragged(R, cx, cy, S * (0.038 + R() * 0.014), 9, 0.3), { col: 'rgb(8,6,4)', height: grey(0) });
}

/* painted steel: dented, the paint flaked off round a bright bowl, holed (or, a glancing hit, not) */
function metalHole(p, R, cx, cy, S) {
  const dr = S * (0.19 + R() * 0.07);
  const bowl = p.height.createRadialGradient(cx, cy, 0, cx, cy, dr);
  bowl.addColorStop(0, grey(70)); bowl.addColorStop(0.7, grey(FLAT - 6)); bowl.addColorStop(0.86, grey(FLAT + 22)); bowl.addColorStop(1, grey(FLAT));
  p.height.fillStyle = bowl; p.height.fill(disc(cx, cy, dr));
  // a scuff of soot and lead round it, flakes of paint gone further out
  const scuff = p.alpha.createRadialGradient(cx, cy, dr * 0.45, cx, cy, dr * 1.35);
  scuff.addColorStop(0, grey(150)); scuff.addColorStop(1, grey(0));
  p.alpha.fillStyle = scuff; p.alpha.fill(disc(cx, cy, dr * 1.35));
  p.col.fillStyle = 'rgb(28,27,26)'; p.col.fill(disc(cx, cy, dr * 1.35));
  for (let k = 0, m = 5 + Math.floor(R() * 8); k < m; k++) {
    const a = R() * Math.PI * 2, r = dr * (0.85 + R() * 0.45);
    p.fill(ragged(R, cx + Math.cos(a) * r, cy + Math.sin(a) * r, S * (0.01 + R() * 0.025), 6, 0.4), { col: 'rgb(150,151,154)', alpha: grey(255), bare: grey(255) });
  }
  p.fill(ragged(R, cx, cy, dr * 0.88, 18, 0.3), { col: 'rgb(150,151,154)', alpha: grey(255), bare: grey(255) });
  // the hole, its lip torn
  if (R() < 0.75) p.fill(ragged(R, cx, cy, S * (0.04 + R() * 0.02), 8, 0.35), { col: 'rgb(6,6,6)', bare: grey(0), height: grey(0) });
}

/* the ground: a pit kicked in the mud, clods thrown out of it */
function mudSplat(p, R, cx, cy, S) {
  for (let k = 0, m = 30 + Math.floor(R() * 30); k < m; k++) {
    const a = R() * Math.PI * 2, r = S * (0.1 + 0.32 * Math.sqrt(R())), v = 34 + R() * 26;
    p.fill(ragged(R, cx + Math.cos(a) * r, cy + Math.sin(a) * r, S * (0.008 + R() * 0.03), 6, 0.45), { col: `rgb(${v},${v * 0.8},${v * 0.6})`, alpha: grey(170 + R() * 85), height: grey(FLAT + 25 + R() * 45) });
  }
  p.fill(ragged(R, cx, cy, S * (0.12 + R() * 0.06), 13, 0.4), { col: 'rgb(30,24,17)', alpha: grey(235), height: grey(FLAT - 45) });
  p.fill(ragged(R, cx, cy, S * (0.05 + R() * 0.02), 9, 0.4), { col: 'rgb(18,14,10)', alpha: grey(255), height: grey(FLAT - 90) });
}

/* a blast's scorch on the ground, burnt out from the middle in streaks */
function scorchMark(p, R, cx, cy, S) {
  const burnt = p.alpha.createRadialGradient(cx, cy, 0, cx, cy, S * 0.48);
  burnt.addColorStop(0, grey(242)); burnt.addColorStop(0.5, grey(178)); burnt.addColorStop(1, grey(0));
  p.alpha.fillStyle = burnt; p.alpha.fill(disc(cx, cy, S * 0.48));
  for (let k = 0; k < 40; k++) {
    const a = R() * 6.28, r = S * (0.22 + R() * 0.24);
    const path = new Path2D();
    path.moveTo(cx, cy); path.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    p.stroke(path, { alpha: grey(80 + R() * 100) }, 1 + R() * 3);
  }
}

/* A kind's four variants as textures: the colour with how much of it shows, the relief as a
   normal map (`relief`: how steep a slope of the height comes out) and, for metal, roughness
   and metalness (green and blue). */
function decalSet(paint, seed, ground, relief, bare = false) {
  const S = CELL * 2, n = S * S, R = rng(seed);
  const p = painter(S, ground, bare);
  for (let i = 0; i < 4; i++) {
    const x = (i % 2) * CELL, y = (i >> 1) * CELL;
    p.clip(x, y, CELL);
    paint(p, R, x + CELL / 2, y + CELL / 2, CELL);
    p.unclip();
  }
  const data = (g) => g.getImageData(0, 0, S, S).data;
  const col = data(p.col), al = data(p.alpha), hd = data(p.height);
  // the height softened a little (twice over three texels each way): from eight bits its
  // slopes would come out in terraces
  const h = new Float32Array(n), t = new Float32Array(n);
  for (let i = 0; i < n; i++) h[i] = hd[i * 4] / 255;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < S; y++) {
      const r = y * S;
      for (let x = 0; x < S; x++) t[r + x] = (h[r + Math.max(0, x - 1)] + h[r + x] + h[r + Math.min(S - 1, x + 1)]) / 3;
    }
    for (let y = 0; y < S; y++) {
      const a = Math.max(0, y - 1) * S, b = y * S, c = Math.min(S - 1, y + 1) * S;
      for (let x = 0; x < S; x++) h[b + x] = (t[a + x] + t[b + x] + t[c + x]) / 3;
    }
  }
  const rgba = new Uint8Array(n * 4), nrm = new Uint8Array(n * 4);
  for (let y = 0; y < S; y++) {
    const a = Math.max(0, y - 1) * S, b = y * S, c = Math.min(S - 1, y + 1) * S;
    for (let x = 0; x < S; x++) {
      const i = b + x, o = i * 4;
      rgba[o] = col[o]; rgba[o + 1] = col[o + 1]; rgba[o + 2] = col[o + 2]; rgba[o + 3] = al[o];
      // the texture's rows run up its v (no flip): a rise along them tilts the normal back down v
      const dx = (h[b + Math.min(S - 1, x + 1)] - h[b + Math.max(0, x - 1)]) * relief, dy = (h[c + x] - h[a + x]) * relief;
      const l = Math.hypot(dx, dy, 1);
      nrm[o] = (0.5 - (0.5 * dx) / l) * 255; nrm[o + 1] = (0.5 - (0.5 * dy) / l) * 255; nrm[o + 2] = (0.5 + 0.5 / l) * 255; nrm[o + 3] = 255;
    }
  }
  const tex = (d, color) => {
    const tx = new THREE.DataTexture(d, S, S);
    tx.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tx.generateMipmaps = true;
    tx.minFilter = THREE.LinearMipmapLinearFilter;
    tx.magFilter = THREE.LinearFilter;
    tx.anisotropy = 4;
    tx.needsUpdate = true;
    return tx;
  };
  const set = { map: tex(rgba, true), normalMap: tex(nrm, false), orm: null };
  if (p.bare) {
    // bare steel smooth and metal, the paint round it rough
    const b = data(p.bare), orm = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { const k = b[i * 4] / 255; orm[i * 4 + 1] = (0.72 - 0.42 * k) * 255; orm[i * 4 + 2] = k * 255; orm[i * 4 + 3] = 255; }
    set.orm = tex(orm, false);
  }
  return set;
}

function decalMaterial(set, shared) {
  const mat = new THREE.MeshStandardMaterial({
    map: set.map, normalMap: set.normalMap, roughness: 0.9, metalness: 0,
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  if (set.orm) { mat.roughnessMap = mat.metalnessMap = set.orm; mat.roughness = mat.metalness = 1; }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = shared ? shared.wet : { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
      // its variant: a quarter of the textures
      #ifdef USE_MAP
        vMapUv = vMapUv * 0.5 + aCell;
      #endif
      #ifdef USE_NORMALMAP
        vNormalMapUv = vNormalMapUv * 0.5 + aCell;
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv = vRoughnessMapUv * 0.5 + aCell;
      #endif
      #ifdef USE_METALNESSMAP
        vMetalnessMapUv = vMetalnessMapUv * 0.5 + aCell;
      #endif`)
      .replace('#include <project_vertex>', `#include <project_vertex>
      mvPosition.xyz -= normalize(mvPosition.xyz) * min(${PULL.toFixed(3)}, length(mvPosition.xyz) * 0.2);
      gl_Position = projectionMatrix * mvPosition;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      // wet in the rain like what it is on, a little less (freshly broken)
      diffuseColor.rgb *= mix(1.0, 0.75, uWet);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.6 + 0.08, uWet);`);
    dimFillSpecular(shader);
  };
  return mat;
}

export function createDecals({ max = 200, shared = null } = {}) {
  const group = new THREE.Group();
  group.name = 'decals';
  const sets = {
    stone: decalSet(stoneHole, 9151, 'rgb(150,143,131)', 18),
    wood: decalSet(woodHole, 4243, 'rgb(158,124,84)', 22),
    metal: decalSet(metalHole, 777, 'rgb(150,151,154)', 20, true),
    splat: decalSet(mudSplat, 3301, 'rgb(44,35,26)', 14),
    scorch: decalSet(scorchMark, 6, 'rgb(12,11,9)', 0),
  };
  const kinds = {};
  for (const k in sets) {
    const cap = k === 'scorch' ? 24 : max;
    const geo = new THREE.PlaneGeometry(1, 1);
    const cells = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    geo.setAttribute('aCell', cells);
    const m = new THREE.InstancedMesh(geo, decalMaterial(sets[k], shared), cap);
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = 2;
    m.receiveShadow = true;
    group.add(m);
    kinds[k] = { mesh: m, cells, cursor: 0, n: 0, cap };
  }
  const n = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3();
  const mtx = new THREE.Matrix4(), turn = new THREE.Matrix4();

  /* A decal `size` across on a surface facing (nx, ny, nz): turned at random, or (along the
     grain) with its up along the surface's. */
  function add(kind, x, y, zz, nx, ny, nz, size, grain = false) {
    const K = kinds[kind];
    if (!K) return;
    n.set(nx, ny, nz).normalize();
    // its up: the world's laid on the surface (on a floor, any)
    up.set(0, 1, 0).addScaledVector(n, -n.y);
    if (up.lengthSq() < 0.04) up.set(1, 0, 0).addScaledVector(n, -n.x);
    up.normalize();
    side.crossVectors(up, n);
    mtx.makeBasis(side, up, n).multiply(turn.makeRotationZ(grain ? (Math.random() - 0.5) * 0.4 : Math.random() * Math.PI * 2));
    mtx.scale(side.set(size, size, 1));
    mtx.setPosition(x + n.x * 0.012, y + n.y * 0.012, zz + n.z * 0.012);
    K.mesh.setMatrixAt(K.cursor, mtx);
    const v = Math.floor(Math.random() * 4);
    K.cells.setXY(K.cursor, (v % 2) * 0.5, (v >> 1) * 0.5);
    K.cursor = (K.cursor + 1) % K.cap;
    K.n = Math.min(K.cap, K.n + 1);
    K.mesh.count = K.n;
    K.mesh.instanceMatrix.needsUpdate = true;
    K.cells.needsUpdate = true;
  }

  /* A bullet impact by surface. */
  function impact(x, y, zz, nx, ny, nz, surface) {
    if (surface === 'water' || surface === 'foliage' || surface === 'flesh') return;
    const r = Math.random();
    if (surface === 'mud' || surface === 'grass' || surface === 'forest' || surface === 'dirt') add('splat', x, y, zz, nx, ny, nz, 0.3 + r * 0.22);
    else if (surface === 'wood') add('wood', x, y, zz, nx, ny, nz, 0.17 + r * 0.08, true);
    else if (surface === 'metal') add('metal', x, y, zz, nx, ny, nz, 0.12 + r * 0.05);
    else add('stone', x, y, zz, nx, ny, nz, (surface === 'sandbag' ? 0.12 : 0.16) + r * 0.07);
  }

  function clear() { for (const K of Object.values(kinds)) { K.n = 0; K.cursor = 0; K.mesh.count = 0; } }

  return { group, add, impact, clear };
}
