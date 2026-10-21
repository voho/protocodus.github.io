/* Hedgerow — rain and lightning.

   Rain is one instanced draw: thousands of streaks whose positions live on
   the GPU, wrapped in a box that follows the camera, each a quad stretched
   along its fall velocity and turned to face the view, as thin as a drop
   but never under a pixel and a half (fainter instead). Beyond them, out
   to ~60 m, sheets of rain: four cylinders round the eye, worked out per
   pixel in one full-screen draw, each with streaks falling at the rain's
   speed and slant, hidden behind what is nearer, lit by the lamps near
   them and fading into the haze. Both come in gusts: bands of heavier rain,
   leaning harder, sweeping across downwind (gust(), a slow noise blown
   along at gust speed). Splashes are rings, and near the eye each
   drop that lands throws up a crown of droplets for a moment, glittering by
   the lamps; splashes are rings
   that grow and fade on the ground around the player. Lightning comes in
   flickering strokes every so often, lifting the sky and the light, and
   schedules its thunder for the audio by distance. */

import * as THREE from 'three';
import { rng } from './util.js';

// the gusts: how hard it is raining here now (about 0.55 .. 1.6), bands of it some 30 m across
// blown downwind at gust speed. An integer hash, so gustAt() below gives the same on the CPU
// (the splashes follow it)
export const GUST_GLSL = /* glsl */ `
float gHash(vec2 p) {
  uvec2 q = uvec2(ivec2(p) + 32768);
  uint h = (q.x * 1597334677u) ^ (q.y * 3812015801u);
  h = h * 747796405u + 2891336453u;
  h ^= h >> 16u; h *= 2246822519u; h ^= h >> 13u;
  return float(h) / 4294967295.0;
}
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float gust(vec2 xz, float time, vec2 wind) {
  vec2 w = normalize(wind);
  // stretched across the wind (a front of rain), carried along it
  vec2 q = vec2(dot(xz, w), dot(xz, vec2(-w.y, w.x)) * 0.45) / 30.0 - vec2(time * 7.0 / 30.0, 0.0);
  float n = gNoise(q) * 0.7 + gNoise(q * 2.3 + 5.1) * 0.3;
  return 0.55 + 1.05 * smoothstep(0.3, 0.75, n);
}`;

function gHash(x, y) {
  let h = (Math.imul((x + 32768) >>> 0, 1597334677) ^ Math.imul((y + 32768) >>> 0, 3812015801)) >>> 0;
  h = (Math.imul(h, 747796405) + 2891336453) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0; h = Math.imul(h, 2246822519) >>> 0; h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967295;
}
function gNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = gHash(ix, iy), b = gHash(ix + 1, iy), c = gHash(ix, iy + 1), d = gHash(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
/* GUST_GLSL's gust() on the CPU */
export function gustAt(x, z, time, wx, wz) {
  const l = Math.hypot(wx, wz) || 1, ux = wx / l, uz = wz / l;
  const qx = (x * ux + z * uz) / 30 - time * 7 / 30, qy = (x * -uz + z * ux) * 0.45 / 30;
  const n = gNoise(qx, qy) * 0.7 + gNoise(qx * 2.3 + 5.1, qy * 2.3 + 5.1) * 0.3;
  const t = Math.min(1, Math.max(0, (n - 0.3) / 0.45));
  return 0.55 + 1.05 * t * t * (3 - 2 * t);
}

const RAIN_VERT = /* glsl */ `
${GUST_GLSL}
attribute vec4 aDrop;            // xyz: 0..1 position in the box, w: random
uniform vec3 uCam, uBox, uVel;
uniform float uTime, uLength, uWidth;
uniform vec3 uLightPos[6];
uniform vec3 uLightCol[6];
uniform vec2 uScreen;
uniform float uSoft;
varying float vAlpha;
varying vec2 vUv;
varying vec3 vLit;
varying float vDist;
varying vec2 vProj;
void main() {
  vec3 vel = uVel * (0.85 + 0.3 * aDrop.w);
  vec3 p = aDrop.xyz * uBox + vel * uTime;
  p = mod(p - uCam + uBox * 0.5, uBox) + uCam - uBox * 0.5;
  // in a gust, more drops show and they lean harder
  float g = gust(p.xz, uTime, uVel.xz);
  vec3 axis = normalize(vel + vec3(uVel.x, 0.0, uVel.z) * (g - 0.8) * 1.4);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(axis, toCam));
  float len = uLength * (0.7 + 0.6 * aDrop.w);
  float dist = length(p - cameraPosition);
  // as wide as the drop, but at least a pixel and a half: a thinner one covers less of it
  float pxPerM = projectionMatrix[1][1] * 0.5 / (dist * (uSoft > 0.5 ? uScreen.y : 1.0 / 900.0));
  float width = max(uWidth, 1.5 / pxPerM);
  vec3 wp = p + side * (uv.x - 0.5) * width + axis * (uv.y - 0.5) * len;
  vAlpha = smoothstep(1.2, 4.5, dist) * (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, dist))
    * (uWidth / width) * (0.45 + 1.1 * fract(aDrop.w * 7.31 + aDrop.x * 3.7))
    * smoothstep(0.0, 0.35, g - fract(aDrop.w * 13.7) * 0.9);
  vUv = uv;
  // drops passing near a lamp or a fire catch its light
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

const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor, uSky;
uniform float uOpacity, uFlash, uSoft;
uniform sampler2D tDepth;
uniform vec2 uScreen;
varying float vAlpha;
varying vec2 vUv;
varying vec3 vLit;
varying float vDist;
varying vec2 vProj;
void main() {
  // drawn after the frame (the late pass): hidden behind what the scene drew
  if (uSoft > 0.5) {
    float zd = texture2D(tDepth, gl_FragCoord.xy * uScreen).x * 2.0 - 1.0;
    if (vDist > vProj.y / (zd + vProj.x)) discard;
  }
  float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float tail = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
  vec3 lit = vLit + uSky;
  float boost = min(dot(lit, vec3(0.33)), 4.0);
  float a = edge * tail * vAlpha * uOpacity * (1.0 + boost * 1.5);
  gl_FragColor = vec4(uColor * (1.0 + uFlash * 3.0) + lit * 2.0, min(a, 0.9));
}`;

// rain sheets: a full-screen triangle; the view ray of each pixel meets four cylinders round
// the eye, each carrying streaks one to two pixels wide on an angular grid (so they stay put as
// the view turns) that fall at the rain's speed and lean with its drift along the cylinder
const SHEET_VERT = /* glsl */ `
varying vec3 vRay;
varying vec3 vProj;
void main() {
  vRay = transpose(mat3(viewMatrix)) * vec3(position.x / projectionMatrix[0][0], position.y / projectionMatrix[1][1], -1.0);
  vProj = vec3(projectionMatrix[2][2], projectionMatrix[3][2], projectionMatrix[1][1]);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const SHEET_FRAG = /* glsl */ `
${GUST_GLSL}
uniform vec3 uColor, uVel, uSky;
uniform float uTime, uOpacity, uFlash, uFog;
uniform vec3 uLightPos[6];
uniform vec3 uLightCol[6];
uniform sampler2D tDepth;
uniform vec2 uScreen;
varying vec3 vRay;
varying vec3 vProj;
float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 dir = normalize(vRay);
  float hd = length(dir.xz);
  if (hd < 0.08) discard;
  // the scene's depth along this ray (view-space z, as the rain's own occlusion test)
  float zd = texture2D(tDepth, gl_FragCoord.xy * uScreen).x * 2.0 - 1.0;
  float sceneZ = vProj.y / (zd + vProj.x);
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float cosF = dot(dir, fwd);
  float theta = atan(dir.z, dir.x);
  vec3 tang = vec3(-sin(theta), 0.0, cos(theta));
  float vt = dot(uVel.xz, tang.xz), fall = -uVel.y;
  float pxPerRad = vProj.z * 0.5 / uScreen.y;
  vec3 sum = vec3(0.0);
  float alpha = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float r = 14.0 * pow(1.6, fi);                       // 14, 22, 36, 57 m
    float t = r / hd;
    vec3 P = cameraPosition + dir * t;
    float vis = smoothstep(0.0, 2.0, sceneZ - t * cosF);  // hidden behind what is nearer
    vis *= 1.0 - smoothstep(14.0, 30.0, P.y - cameraPosition.y);
    if (vis <= 0.0) continue;
    // angular cells about five pixels wide, a whole number of them round the circle
    float n = floor(6.2832 * pxPerRad / 5.0);
    float dth = 6.2832 / n;
    float U = (theta + P.y * vt / (fall * r)) / dth;
    float len = 0.9 + 0.5 * fi;                          // longer streaks further off
    float V = (P.y + uTime * fall) / 2.4;
    vec2 id = mod(floor(vec2(U, V)), vec2(n, 4096.0)) + fi * 17.0;     // seamless round the circle
    vec2 f = fract(vec2(U, V));
    if (sHash(id) > 0.22) continue;
    float x0 = 0.25 + 0.5 * sHash(id + 3.7), y0 = 0.7 * sHash(id + 7.1);
    float sx = 1.0 - smoothstep(0.4, 1.0, abs(f.x - x0) * 5.0);
    float sy = smoothstep(y0, y0 + 0.04, f.y) * smoothstep(y0 + len / 2.4, y0 + len / 2.4 - 0.08, f.y);
    float k = sx * sy * vis * exp(-t * uFog) * (0.6 + 0.8 * sHash(id + 11.3));
    if (k <= 0.0) continue;
    k *= gust(P.xz, uTime, uVel.xz);       // only on a streak: it is the dearest part
    // lit by the lamps near it
    vec3 lit = uSky;
    for (int j = 0; j < 6; j++) {
      vec3 d = P - uLightPos[j];
      lit += uLightCol[j] / (1.0 + dot(d, d) * 0.12);
    }
    // seen by the light they catch: faint in the dark, bright by a lamp or a fire
    sum += (uColor * (0.3 + uFlash * 3.0) + lit * 2.0) * k;
    alpha += k;
  }
  if (alpha <= 0.001) discard;
  gl_FragColor = vec4(sum / alpha, min(alpha * uOpacity, 0.8));
}`;

// the crowns: a quad standing on each young splash near the eye, droplets flung up and out
// along their arcs worked out in it (never under a pixel and a half)
const CROWN_VERT = /* glsl */ `
attribute vec4 aSplash;          // xyz world position, w birth time
uniform float uTime;
uniform vec3 uLightPos[6];
uniform vec3 uLightCol[6];
varying vec2 vUv;
varying float vAge, vSeed, vDist;
varying vec3 vLit;
varying vec2 vProj;
void main() {
  float age = uTime - aSplash.w;
  float d = length(aSplash.xyz - cameraPosition);
  float size = (age >= 0.0 && age < 0.17 && d < 9.0) ? 0.16 : 0.0;
  vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
  vec3 p = aSplash.xyz + right * (uv.x - 0.5) * size + vec3(0.0, uv.y * size * 0.5, 0.0);
  vUv = uv;
  vAge = age;
  vSeed = fract(aSplash.x * 3.17 + aSplash.z * 1.93 + aSplash.w * 0.71);
  vec3 lit = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    vec3 dd = aSplash.xyz - uLightPos[i];
    lit += uLightCol[i] / (1.0 + dot(dd, dd) * 0.9);
  }
  vLit = lit;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vDist = -mv.z;
  vProj = vec2(projectionMatrix[2][2], projectionMatrix[3][2]);
  gl_Position = projectionMatrix * mv;
}`;

export const CROWN_FRAG = /* glsl */ `
uniform vec3 uColor, uSky;
uniform float uOpacity, uFlash, uSoft;
uniform sampler2D tDepth;
uniform vec2 uScreen;
varying vec2 vUv;
varying float vAge, vSeed, vDist;
varying vec3 vLit;
varying vec2 vProj;
float cHash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  // drawn after the frame (the late pass): hidden behind what the scene drew
  if (uSoft > 0.5) {
    float zd = texture2D(tDepth, gl_FragCoord.xy * uScreen).x * 2.0 - 1.0;
    if (vDist > vProj.y / (zd + vProj.x) + 0.05) discard;
  }
  // metres, from where the drop landed (some drops bigger than others)
  vec2 p = vec2((vUv.x - 0.5) * 0.16, vUv.y * 0.08) / (0.55 + 0.6 * cHash(vSeed * 71.0));
  float px = max(fwidth(p.x), 1e-4);
  float t = vAge, a = 0.0;
  for (int j = 0; j < 7; j++) {
    float fj = float(j);
    float ang = fj * 0.8976 + cHash(vSeed * 91.0 + fj) * 0.7;
    float sp = 0.22 + 0.3 * cHash(vSeed * 37.0 + fj * 3.1);      // outward, m/s
    float up = 0.75 + 0.55 * cHash(vSeed * 13.0 + fj * 7.3);     // upward, m/s
    vec2 c = vec2(cos(ang) * (0.006 + sp * t), up * t - 4.9 * t * t);
    if (c.y < 0.0) continue;
    vec2 dv = normalize(vec2(cos(ang) * sp, up - 9.8 * t));
    vec2 dd = p - c;
    float al = dot(dd, dv), ac = dot(dd, vec2(-dv.y, dv.x));
    float w = max(0.0022, px * 1.0), l = max(0.007, px * 2.0);
    a += exp(-ac * ac / (w * w) - al * al / (l * l)) * (0.6 + 0.4 * cHash(fj + vSeed * 5.0));
  }
  // the sheet of the crown, for its first instant
  float ring = exp(-pow((p.y - 0.012 * (1.0 - t * 8.0)) / max(0.003, px), 2.0)) * (1.0 - smoothstep(0.0, 0.05, t))
    * (1.0 - smoothstep(0.012 + t * 0.25, 0.02 + t * 0.3, abs(p.x)));
  a += ring * 0.5;
  a *= (1.0 - smoothstep(0.09, 0.17, t)) * (1.0 - smoothstep(4.0, 9.0, vDist));
  if (a < 0.01) discard;
  vec3 lit = vLit + uSky;
  // seen by the light they catch: hardly in the dark, glinting by a lamp, a fire or a flare
  gl_FragColor = vec4(uColor * (0.22 + uFlash * 3.0) + lit * 2.4, min(a * uOpacity * (0.45 + min(dot(lit, vec3(0.33)) * 2.0, 0.55) + uFlash), 0.8));
}`;

const SPLASH_VERT = /* glsl */ `
attribute vec4 aSplash;          // xyz world position, w birth time
uniform float uTime;
varying float vLife;
varying vec2 vUv;
void main() {
  float age = uTime - aSplash.w;
  vLife = clamp(age / 0.32, 0.0, 1.0);
  float size = mix(0.04, 0.3, sqrt(vLife));
  vec3 p = aSplash.xyz + vec3((uv.x - 0.5) * size, 0.015, (uv.y - 0.5) * size);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const SPLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uFlash;
varying float vLife;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(0.65, 0.85, r) * smoothstep(1.0, 0.88, r);
  float a = ring * (1.0 - vLife) * 0.55;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * (1.0 + uFlash * 2.0), a);
}`;

export function createWeather({ count = 8000, terrain, water = null, onThunder, seed = 4 }) {
  const R = rng(seed);
  // where a drop lands: the ground, or the river's surface over it
  const landY = (x, z) => {
    const y = terrain ? terrain.height(x, z) : 0;
    return water && y < water.level && water.contains(x, z) ? water.level : y;
  };
  const group = new THREE.Group();
  group.name = 'weather';

  // ---------- rain streaks ----------
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0.5, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.attributes.position = quad.attributes.position;
  geo.attributes.uv = quad.attributes.uv;
  const drops = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    drops[i * 4] = R(); drops[i * 4 + 1] = R(); drops[i * 4 + 2] = R(); drops[i * 4 + 3] = R();
  }
  geo.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drops, 4));
  geo.instanceCount = count;
  const rainUniforms = {
    uCam: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(36, 22, 36) },
    uVel: { value: new THREE.Vector3(1.6, -11.5, 0.7) },
    uTime: { value: 0 },
    uLength: { value: 0.5 },
    uWidth: { value: 0.006 },
    uColor: { value: new THREE.Color('#9aa4ad') },
    uOpacity: { value: 0.2 },
    uFlash: { value: 0 },
    uLightPos: { value: Array.from({ length: 6 }, () => new THREE.Vector3(0, -1000, 0)) },
    uLightCol: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
    tDepth: { value: null }, uScreen: { value: new THREE.Vector2(1, 1) }, uSoft: { value: 0 },
    uSky: { value: new THREE.Vector3() },
  };
  const rainMat = new THREE.ShaderMaterial({
    vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, uniforms: rainUniforms,
    transparent: true, depthWrite: false, fog: false,
  });
  const rain = new THREE.Mesh(geo, rainMat);
  rain.frustumCulled = false;
  rain.renderOrder = 5;
  group.add(rain);

  // ---------- rain sheets, further off (drawn only in the late pass: they need the depth) ----------
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const sheetUniforms = {
    uColor: rainUniforms.uColor, uVel: rainUniforms.uVel, uTime: rainUniforms.uTime, uFlash: rainUniforms.uFlash,
    uLightPos: rainUniforms.uLightPos, uLightCol: rainUniforms.uLightCol, uSky: rainUniforms.uSky,
    uOpacity: { value: 0.16 }, uFog: { value: 0.012 },
    tDepth: { value: null }, uScreen: { value: new THREE.Vector2(1, 1) },
  };
  const sheets = new THREE.Mesh(tri, new THREE.ShaderMaterial({
    vertexShader: SHEET_VERT, fragmentShader: SHEET_FRAG, uniforms: sheetUniforms,
    transparent: true, depthTest: false, depthWrite: false, fog: false,
  }));
  sheets.frustumCulled = false;
  sheets.renderOrder = 4;
  sheets.visible = false;

  // ---------- splashes ----------
  const SPL = 420;
  const sgeo = new THREE.InstancedBufferGeometry();
  sgeo.index = quad.index;
  sgeo.attributes.position = quad.attributes.position;
  sgeo.attributes.uv = quad.attributes.uv;
  const splashes = new Float32Array(SPL * 4).fill(-100);
  const splashAttr = new THREE.InstancedBufferAttribute(splashes, 4);
  splashAttr.setUsage(THREE.DynamicDrawUsage);
  sgeo.setAttribute('aSplash', splashAttr);
  sgeo.instanceCount = SPL;
  const splashUniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color('#b8c0c8') }, uFlash: { value: 0 } };
  const splashMat = new THREE.ShaderMaterial({
    vertexShader: SPLASH_VERT, fragmentShader: SPLASH_FRAG, uniforms: splashUniforms,
    transparent: true, depthWrite: false, fog: true,
  });
  splashMat.fog = false;
  const splashMesh = new THREE.Mesh(sgeo, splashMat);
  splashMesh.frustumCulled = false;
  group.add(splashMesh);
  // the crowns: drops landing near the eye, far more of them than the rings (drawn with the
  // near rain, after the frame)
  const CR = 640;
  const cgeo = new THREE.InstancedBufferGeometry();
  cgeo.index = quad.index;
  cgeo.attributes.position = quad.attributes.position;
  cgeo.attributes.uv = quad.attributes.uv;
  const crownData = new Float32Array(CR * 4).fill(-100);
  const crownAttr = new THREE.InstancedBufferAttribute(crownData, 4);
  crownAttr.setUsage(THREE.DynamicDrawUsage);
  cgeo.setAttribute('aSplash', crownAttr);
  cgeo.instanceCount = CR;
  let crownCursor = 0, crownAcc = 0;
  const crownUniforms = {
    uTime: splashUniforms.uTime, uColor: rainUniforms.uColor, uFlash: rainUniforms.uFlash, uSky: rainUniforms.uSky,
    uLightPos: rainUniforms.uLightPos, uLightCol: rainUniforms.uLightCol, uOpacity: { value: 0.8 },
    tDepth: { value: null }, uScreen: { value: new THREE.Vector2(1, 1) }, uSoft: { value: 0 },
  };
  crownUniforms.uOpacity.value = 0.5;
  const crowns = new THREE.Mesh(cgeo, new THREE.ShaderMaterial({
    vertexShader: CROWN_VERT, fragmentShader: CROWN_FRAG, uniforms: crownUniforms,
    transparent: true, depthWrite: false, fog: false,
  }));
  crowns.frustumCulled = false;
  crowns.renderOrder = 5;
  group.add(crowns);
  let splashCursor = 0, splashAcc = 0;

  // ---------- lightning ----------
  let nextStrike = 8 + R() * 10;
  let strike = null;            // {t, pulses: [[start, dur, power]...], dir}
  const flashDir = new THREE.Vector3(0, 0.5, 1).normalize();
  let flash = 0;

  function scheduleStrike(time) {
    const pulses = [];
    let t = 0;
    const n = 2 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) {
      pulses.push([t, 0.05 + R() * 0.08, 0.5 + R() * 0.6]);
      t += 0.06 + R() * 0.16;
    }
    const az = R() * Math.PI * 2, jitter = R();
    const distance = 0.6 + R() * 3.2;             // km
    // the flash high in the cloud over it (a cloud base about a kilometre up): the nearer, the higher
    const el = Math.atan2(1.1, distance) + (jitter - 0.5) * 0.1;
    flashDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    strike = { t: time, pulses, power: distance < 1.2 ? 1.3 : 1 / (0.5 + distance * 0.3) };
    onThunder?.({ delay: distance * 2.9, power: 1 / (0.4 + distance * 0.35), distance });
  }

  function update(dt, time, camera, rainAmount = 1) {
    rainUniforms.uTime.value = time;
    rainUniforms.uCam.value.copy(camera.position);
    rainUniforms.uOpacity.value = 0.2 * rainAmount;
    sheetUniforms.uOpacity.value = 0.16 * rainAmount;
    crownUniforms.uOpacity.value = 0.5 * rainAmount;
    splashUniforms.uTime.value = time;

    // splashes around the camera, as many as the gust over it brings
    const g = gustAt(camera.position.x, camera.position.z, time, rainUniforms.uVel.value.x, rainUniforms.uVel.value.z);
    splashAcc += dt * 900 * rainAmount * g;
    const cx = camera.position.x, cz = camera.position.z;
    let changed = false;
    while (splashAcc >= 1) {
      splashAcc -= 1;
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 16;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const y = landY(x, z);
      const k = splashCursor * 4;
      splashes[k] = x; splashes[k + 1] = y; splashes[k + 2] = z; splashes[k + 3] = time - R() * 0.02;
      splashCursor = (splashCursor + 1) % SPL;
      changed = true;
    }
    if (changed) splashAttr.needsUpdate = true;
    // crowns, within 7 m
    crownAcc += dt * 3500 * rainAmount * g;
    let cChanged = false;
    while (crownAcc >= 1) {
      crownAcc -= 1;
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 7;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const k = crownCursor * 4;
      crownData[k] = x; crownData[k + 1] = landY(x, z); crownData[k + 2] = z; crownData[k + 3] = time - R() * 0.016;
      crownCursor = (crownCursor + 1) % CR;
      cChanged = true;
    }
    if (cChanged) crownAttr.needsUpdate = true;

    // lightning
    if (time > nextStrike && !strike) {
      scheduleStrike(time);
      nextStrike = time + 14 + R() * 26;
    }
    flash = 0;
    if (strike) {
      const t = time - strike.t;
      let done = true;
      for (const [s, d, p] of strike.pulses) {
        if (t < s + d + 0.25) done = false;
        if (t >= s && t < s + d) flash = Math.max(flash, p * strike.power);
        else if (t >= s + d && t < s + d + 0.25) flash = Math.max(flash, p * strike.power * 0.25 * (1 - (t - s - d) / 0.25));
      }
      if (done) strike = null;
    }
    rainUniforms.uFlash.value = flash;
    splashUniforms.uFlash.value = flash;
    return flash;
  }

  /* A light over everything (a burning flare: its colour and intensity at the eye) lights
     every drop. */
  function setSkyLight(color, intensity) {
    const k = Math.min(intensity, 8) * 0.04;
    rainUniforms.uSky.value.set(color.r * k, color.g * k, color.b * k);
  }

  /* The strongest point lights near the camera light the rain. */
  function setLights(list) {
    const P = rainUniforms.uLightPos.value, C = rainUniforms.uLightCol.value;
    for (let i = 0; i < 6; i++) {
      const l = list[i];
      if (!l) { P[i].set(0, -1000, 0); C[i].set(0, 0, 0); continue; }
      P[i].set(l.x, l.y, l.z);
      const k = Math.min(l.intensity, 40) * 0.05;
      C[i].set(l.color.r * k, l.color.g * k, l.color.b * k);
    }
  }

  /* the rain drawn in another scene after the frame (the late pass of effects.js, hidden
     behind the scene by its depth: depth = {tDepth, uScreen, uSoft} uniforms that pass keeps),
     or with the rest of the weather again (scene null) */
  function drawLate(scene, depth = null) {
    (scene || group).add(rain);
    rainMat.depthTest = !scene;
    const own = { tDepth: { value: null }, uScreen: { value: new THREE.Vector2(1, 1) }, uSoft: { value: 0 } };
    const d = scene && depth ? depth : own;
    rainUniforms.tDepth = d.tDepth; rainUniforms.uScreen = d.uScreen; rainUniforms.uSoft = d.uSoft;
    (scene || group).add(crowns);
    crowns.material.depthTest = !scene;
    crownUniforms.tDepth = d.tDepth; crownUniforms.uScreen = d.uScreen; crownUniforms.uSoft = d.uSoft;
    // the sheets only where the depth is there to hide them behind the scene
    (scene || group).add(sheets);
    sheetUniforms.tDepth = d.tDepth; sheetUniforms.uScreen = d.uScreen;
    sheetsOn = !!(scene && depth);
    sheets.visible = sheetsOn && geo.instanceCount > 0;
  }
  let sheetsOn = false;

  return {
    group, update, flashDir, setLights, setSkyLight, drawLate,
    get flash() { return flash; },
    setCount(n) { geo.instanceCount = Math.min(n, count); sheets.visible = sheetsOn && n > 0; },
    strikeNow(time) { scheduleStrike(time); },
  };
}
