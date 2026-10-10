/* Meteora — the sky.

   Layers, from farthest in:

     deep      rendered once at load into a cubemap: the Milky Way with its
               dust lanes and bulge, unresolved and faint stars coloured by
               temperature, deep nebulae, and galaxies — an Andromeda-like
               spiral, a face-on spiral, an edge-on disc with its dust line,
               an elliptical, an interacting pair and a scatter of tiny far
               ones for the patient eye
     veils     two faint nebula veils, also baked once, each on its own
               sphere turning very slowly about its own axis
     stars     two layers of bright stars as sharp points, drifting very
               slowly in opposite senses, the nearer one with a hint of
               parallax as the ship moves
     planet    a ringed gas giant forty kilometres out, lit by the sun,
               throwing its shadow across its rings
     sun       a white-hot disc and corona (added to the glow batch, so the
               rocks hide it)

   The drift is not astronomy — the real sky would not move — it is there to
   keep the backdrop alive while the ship is coasting, and it is slow enough
   that it reads as depth rather than motion. */

import * as THREE from 'three';
import { RENDER } from './config.js';
import { makeRng } from './rng.js';

const LAYER_RADIUS = 40000;

const COMMON = /* glsl */`
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.96875;
}
// Approximate blackbody colour for t in 0..1 (≈3000 K → 12000 K).
vec3 blackbody(float t) {
  vec3 cool = vec3(1.0, 0.58, 0.32), sun = vec3(1.0, 0.93, 0.84), hot = vec3(0.66, 0.78, 1.0);
  return t < 0.45 ? mix(cool, sun, t / 0.45) : mix(sun, hot, (t - 0.45) / 0.55);
}
// Gnomonic coordinates around direction c, in units of the given radius (radians).
vec2 tangentCoords(vec3 d, vec3 c, float radius) {
  vec3 up = abs(c.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 e1 = normalize(cross(up, c));
  vec3 e2 = cross(c, e1);
  float k = max(dot(d, c), 1e-3);
  return vec2(dot(d, e1), dot(d, e2)) / (k * tan(radius));
}
`;

const DEEP_FRAGMENT = /* glsl */`
varying vec3 vDir;
uniform float uSeed;
uniform float uTexel;
uniform vec3 uGalNormal;
uniform vec3 uGalCenter;
uniform vec4 uNebula[5];      // dir, radius
uniform vec4 uNebulaKind[5];  // kind, seed, intensity
uniform vec4 uGalaxy[5];      // dir, radius
uniform vec4 uGalaxyShape[5]; // inclination, position angle, kind, seed
${COMMON}

vec3 stars(vec3 d, float scale, float threshold, float gain, float band) {
  vec3 p = d * scale, cell = floor(p), f = fract(p);
  float h = hash13(cell + uSeed);
  float t = threshold - 0.012 * band;
  if (h < t) return vec3(0.0);
  vec3 jitter = vec3(hash13(cell + 1.7), hash13(cell + 3.1), hash13(cell + 5.9)) * 0.7 + 0.15;
  float sigma = max(0.18, uTexel * scale * 0.75);
  float dist = length(f - jitter);
  float m = pow((h - t) / (1.0 - t), 5.0);
  return blackbody(pow(hash13(cell + 9.3), 1.6)) * gain * (0.15 + m) * exp(-dist * dist / (2.0 * sigma * sigma));
}

vec3 nebula(vec3 d, int i, inout float absorb) {
  vec3 c = uNebula[i].xyz;
  float radius = uNebula[i].w;
  float k = dot(d, c);
  if (k < cos(min(radius * 1.7, 1.5))) return vec3(0.0);
  float r = acos(clamp(k, -1.0, 1.0)) / radius;
  float kind = uNebulaKind[i].x, seed = uNebulaKind[i].y, gain = uNebulaKind[i].z;
  vec3 q = d * (2.2 / radius) + seed;
  vec3 warp = vec3(fbm(q), fbm(q + 5.2), fbm(q + 9.7));
  if (kind < 0.5) {            // emission: Hα crimson with OIII teal cores and dark pillars
    float n = fbm(q * 1.6 + warp * 1.8);
    float cloud = smoothstep(0.42, 0.9, n) * smoothstep(1.5, 0.15, r);
    float o3 = smoothstep(0.55, 0.95, fbm(q * 2.6 + warp * 2.2)) * smoothstep(1.0, 0.0, r);
    float pillars = smoothstep(0.58, 0.8, fbm(q * 3.4 - warp * 2.5)) * smoothstep(1.2, 0.3, r);
    absorb = max(absorb, pillars * 0.8);
    return (vec3(1.0, 0.16, 0.3) * cloud + vec3(0.12, 0.78, 0.72) * o3 * 0.7) * gain * (1.0 - 0.8 * pillars);
  }
  if (kind < 1.5) {            // reflection: soft blue around a cluster
    float n = 0.55 + 0.45 * fbm(q * 1.3 + warp);
    return vec3(0.32, 0.52, 1.0) * exp(-r * r * 2.6) * n * gain;
  }
  if (kind < 2.5) {            // planetary: ring with bipolar lobes, teal inside, red at the rim
    float ring = exp(-pow((r - 0.6) / 0.13, 2.0)) * (0.7 + 0.5 * fbm(q * 3.0));
    vec2 tc = tangentCoords(d, c, radius);
    float lobes = exp(-pow(abs(tc.x) * 1.8, 2.0) - pow(tc.y * 0.9, 2.0)) * 0.35;
    float inner = smoothstep(0.62, 0.0, r);
    return (vec3(0.15, 0.85, 0.8) * (inner * 0.45 + lobes) + vec3(1.0, 0.25, 0.25) * ring) * gain;
  }
  if (kind < 3.5) {            // supernova remnant: a thin filamentary shell
    float ridge = 1.0 - abs(fbm(q * 2.4 + warp) * 2.0 - 1.0);
    float shell = exp(-pow((r - 0.85) / 0.07, 2.0)) * pow(ridge, 3.0);
    return mix(vec3(1.0, 0.2, 0.25), vec3(0.25, 0.9, 0.6), smoothstep(0.4, 0.7, warp.x)) * shell * gain;
  }
  // dark cloud: hides what is behind it
  float cloud = smoothstep(0.42, 0.75, fbm(q * 1.4 + warp)) * smoothstep(1.4, 0.4, r);
  absorb = max(absorb, cloud * 0.85);
  return vec3(0.0);
}

vec3 galaxy(vec3 d, int i) {
  vec3 c = uGalaxy[i].xyz;
  float radius = uGalaxy[i].w;
  if (dot(d, c) < cos(radius * 1.6)) return vec3(0.0);
  vec4 s = uGalaxyShape[i];
  vec2 p = tangentCoords(d, c, radius);
  float ca = cos(s.y), sa = sin(s.y);
  p = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
  float ci = max(cos(s.x), 0.06);
  p.y /= ci;
  float r = length(p), th = atan(p.y, p.x);
  if (s.z < 0.5) {             // spiral, any inclination
    float arms = pow(0.5 + 0.5 * cos(2.0 * (th - log(r + 0.04) / 0.3)), 2.2);
    float disc = exp(-r * 3.4);
    float bulge = exp(-pow(r / 0.12, 2.0));
    float knots = smoothstep(0.66, 0.92, vnoise(vec3(p * 26.0, s.w))) * arms * disc;
    float dust = smoothstep(0.35, 0.7, vnoise(vec3(p * 13.0, s.w + 3.0))) * arms * disc;
    dust *= (p.y * sign(s.x) < 0.0 ? 1.0 : 0.25) * sin(abs(s.x));
    float lane = exp(-pow(p.y * ci / 0.025, 2.0)) * smoothstep(0.08, 0.3, r) * smoothstep(1.2, 0.5, r) * step(1.2, abs(s.x));
    vec3 col = vec3(1.0, 0.86, 0.66) * bulge * 1.7
      + vec3(0.78, 0.82, 1.0) * disc * (0.22 + 0.78 * arms) * 0.65
      + vec3(0.5, 0.68, 1.0) * knots * 0.8 + vec3(1.0, 0.4, 0.62) * knots * smoothstep(0.85, 0.95, vnoise(vec3(p * 40.0, s.w))) * 0.8;
    return col * (1.0 - 0.65 * dust) * (1.0 - 0.85 * lane);
  }
  if (s.z < 1.5) {             // elliptical
    return vec3(1.0, 0.84, 0.66) * (exp(-r * r * 5.0) * 0.55 + exp(-r * 14.0) * 0.6);
  }
  // interacting pair with a tidal tail
  vec2 a = p - vec2(-0.35, 0.05), b = p - vec2(0.38, -0.08);
  float ga = exp(-dot(a, a) * 26.0) + exp(-length(a) * 9.0) * 0.4;
  float gb = exp(-dot(b, b) * 34.0) + exp(-length(b) * 11.0) * 0.35;
  float tail = exp(-pow((length(p - vec2(0.1, -0.6)) - 0.62) / 0.06, 2.0)) * smoothstep(0.2, -0.4, p.y) * 0.35;
  return vec3(1.0, 0.88, 0.72) * (ga + gb) * 0.7 + vec3(0.7, 0.78, 1.0) * tail * (0.6 + 0.4 * vnoise(vec3(p * 18.0, s.w)));
}

vec3 tinyGalaxies(vec3 d, float band) {
  float scale = 26.0;
  vec3 cell = floor(d * scale);
  float h = hash13(cell + uSeed + 41.0);
  if (h < 0.955 || band > 0.35) return vec3(0.0);
  vec3 jitter = vec3(hash13(cell + 2.3), hash13(cell + 4.1), hash13(cell + 6.7)) * 0.4 + 0.3;
  vec3 c = normalize((cell + jitter) / scale);
  float size = 0.0018 + 0.0035 * hash13(cell + 8.8);
  if (dot(d, c) < cos(size * 3.0)) return vec3(0.0);
  vec2 p = tangentCoords(d, c, size);
  float pa = hash13(cell + 1.1) * 6.283, ca = cos(pa), sa = sin(pa);
  p = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
  p.y /= 0.25 + 0.75 * hash13(cell + 7.7);
  float r = length(p);
  vec3 tint = mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.82, 1.0), hash13(cell + 5.5));
  return tint * (exp(-r * r * 3.0) * 0.18 + exp(-r * r * 30.0) * 0.25);
}

void main() {
  vec3 d = normalize(vDir);
  float b = dot(d, uGalNormal);
  float band = exp(-pow(b / 0.17, 2.0));
  float along = acos(clamp(dot(normalize(d - uGalNormal * b), uGalCenter), -1.0, 1.0));
  float bulge = exp(-pow(along / 0.55, 2.0)) * exp(-pow(b / 0.22, 2.0));
  float glow = fbm(d * 3.5 + uSeed);
  float lanes = smoothstep(0.42, 0.72, fbm(d * 7.5 + vec3(fbm(d * 4.0), 0.0, 0.0) * 1.5 + uSeed * 2.0));
  float dust = exp(-pow(b / 0.045, 2.0)) * lanes;

  float absorb = 0.0;
  vec3 neb = vec3(0.0);
  for (int i = 0; i < 5; i++) neb += nebula(d, i, absorb);
  absorb = max(absorb, dust * 0.9);

  vec3 col = vec3(0.0015, 0.0019, 0.0032);
  col += mix(vec3(0.85, 0.82, 0.76), vec3(1.0, 0.78, 0.52), bulge) * (band * 0.045 * (0.5 + glow) + bulge * 0.14 * (0.4 + glow));
  col += stars(d, 1500.0, 0.9935, 0.25, band);
  col += stars(d, 620.0, 0.9945, 0.55, band);
  col += stars(d, 230.0, 0.9955, 1.1, band);
  col *= 1.0 - absorb;
  col += neb;
  for (int i = 0; i < 5; i++) col += galaxy(d, i);
  col += tinyGalaxies(d, band);
  gl_FragColor = vec4(col, 1.0);
}
`;

const VEIL_FRAGMENT = /* glsl */`
varying vec3 vDir;
uniform float uSeed;
uniform vec3 uTintA;
uniform vec3 uTintB;
uniform float uGain;
${COMMON}
void main() {
  vec3 d = normalize(vDir);
  vec3 q = d * 2.4 + uSeed;
  vec3 warp = vec3(fbm(q), fbm(q + 3.3), fbm(q + 7.1));
  float n = fbm(q * 1.4 + warp * 2.2);
  float wisps = pow(smoothstep(0.45, 0.85, n), 1.6);
  float tint = smoothstep(0.3, 0.75, fbm(q * 0.8 + 11.0));
  gl_FragColor = vec4(mix(uTintA, uTintB, tint) * wisps * uGain, 1.0);
}
`;

const BAKE_VERTEX = /* glsl */`
varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

function bake(renderer, size, fragmentShader, uniforms) {
  const target = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({ vertexShader: BAKE_VERTEX, fragmentShader, uniforms, side: THREE.BackSide, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), material));
  const cubeCamera = new THREE.CubeCamera(0.1, 100, target);
  const toneMapping = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  cubeCamera.update(renderer, scene);
  renderer.toneMapping = toneMapping;
  material.dispose();
  scene.children[0].geometry.dispose();
  return target;
}

const LAYER_VERTEX = /* glsl */`
varying vec3 vDir;
uniform mat3 uSpin;
void main() {
  vDir = uSpin * position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p;
}
`;
const LAYER_FRAGMENT = /* glsl */`
varying vec3 vDir;
uniform samplerCube uMap;
uniform float uGain;
void main() {
  gl_FragColor = vec4(textureCube(uMap, vDir).rgb * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const STAR_VERTEX = /* glsl */`
attribute float aSize;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale;
  gl_Position = projectionMatrix * mv;
}
`;
const STAR_FRAGMENT = /* glsl */`
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 14.0), halo = exp(-r2 * 3.5) * 0.35;
  gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.6) * (core + halo), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function starLayer(rng, count, bright, scale) {
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), sizes = new Float32Array(count);
  const bb = t => (t < 0.45
    ? [1, 0.58 + 0.35 * t / 0.45, 0.32 + 0.52 * t / 0.45]
    : [1 - 0.34 * (t - 0.45) / 0.55, 0.93 - 0.15 * (t - 0.45) / 0.55, 0.84 + 0.16 * (t - 0.45) / 0.55]);
  const d = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    rng.unit(d);
    positions.set([d[0] * LAYER_RADIUS, d[1] * LAYER_RADIUS, d[2] * LAYER_RADIUS], i * 3);
    // Many faint, few bright, like the real magnitude counts.
    const m = Math.pow(rng.next(), 7);
    const c = bb(Math.pow(rng.next(), 1.4));
    const k = (0.25 + 2.6 * m) * bright;
    colors.set([c[0] * k, c[1] * k, c[2] * k], i * 3);
    sizes[i] = (1.6 + 4.5 * m) * scale;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT,
    uniforms: { uScale: { value: Math.min(window.devicePixelRatio || 1, 2) } },
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -90;
  return points;
}

const PLANET_VERTEX = /* glsl */`
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = normalize(position);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const PLANET_FRAGMENT = /* glsl */`
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vWorld;
uniform vec3 uSun;
uniform vec3 uCenter;
uniform vec3 uPole;
uniform float uRadius;
${COMMON}
void main() {
  vec3 n = normalize(vNormal);
  float lat = vLocal.y;
  float lon = atan(vLocal.z, vLocal.x);
  float turb = fbm(vec3(lat * 9.0, lon * 1.6, 3.0)) * 0.55 + fbm(vec3(lat * 30.0, lon * 5.0, 7.0)) * 0.2;
  float bands = 0.5 + 0.5 * sin(lat * 26.0 + turb * 3.5);
  vec3 col = mix(vec3(0.78, 0.6, 0.42), vec3(0.95, 0.88, 0.74), bands);
  col = mix(col, vec3(0.62, 0.42, 0.32), smoothstep(0.55, 0.8, fbm(vec3(lat * 14.0, lon * 3.0, 11.0))) * 0.5);
  // A great storm south of the equator.
  vec2 storm = vec2((lon - 0.9) * 2.2, (lat + 0.32) * 7.0);
  col = mix(col, vec3(0.85, 0.45, 0.32), exp(-dot(storm, storm) * 3.0) * 0.8);
  float ndl = dot(n, uSun);
  float light = smoothstep(-0.08, 0.35, ndl) * (0.25 + 0.75 * max(ndl, 0.0));
  // Shadow of the rings on the cloud tops.
  vec3 toSun = uSun;
  float denom = dot(toSun, uPole);
  if (abs(denom) > 1e-3) {
    float t = -dot(vWorld - uCenter, uPole) / denom;
    if (t > 0.0) {
      float rr = length(vWorld + toSun * t - uCenter) / uRadius;
      float ring = smoothstep(1.4, 1.5, rr) * smoothstep(2.3, 2.15, rr) * (0.55 + 0.45 * sin(rr * 60.0));
      light *= 1.0 - 0.75 * ring;
    }
  }
  vec3 view = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - max(dot(n, view), 0.0), 3.0);
  vec3 atmosphere = vec3(0.45, 0.65, 1.0) * rim * smoothstep(-0.2, 0.4, ndl) * 0.8;
  gl_FragColor = vec4(col * light * 1.6 + atmosphere, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const RING_FRAGMENT = /* glsl */`
varying vec3 vWorld;
uniform vec3 uSun;
uniform vec3 uCenter;
uniform float uRadius;
${COMMON}
void main() {
  float rr = length(vWorld - uCenter) / uRadius;
  float density = smoothstep(1.4, 1.5, rr) * smoothstep(2.3, 2.15, rr);
  density *= 0.45 + 0.55 * vnoise(vec3(rr * 90.0, 0.0, 0.0));
  density *= 1.0 - 0.85 * exp(-pow((rr - 1.95) / 0.03, 2.0));   // the Cassini-like gap
  // Planet shadow: the ray to the sun passes through the planet.
  vec3 o = vWorld - uCenter;
  float b = dot(o, uSun), c = dot(o, o) - uRadius * uRadius;
  float shadow = (b < 0.0 && b * b - c > 0.0) ? 0.08 : 1.0;
  vec3 col = vec3(0.9, 0.82, 0.7) * shadow * 1.3;
  gl_FragColor = vec4(col * density, density * 0.85);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const RING_VERTEX = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export function createSky(renderer, scene, { seed = 7, sunDir }) {
  const rng = makeRng(seed);
  const unit = () => new THREE.Vector3(...rng.unit([0, 0, 0]));
  const galNormal = new THREE.Vector3(0.22, 0.92, 0.32).normalize();
  const galCenter = new THREE.Vector3().crossVectors(galNormal, new THREE.Vector3(1, 0, 0)).normalize();
  const inBand = (d, max) => Math.abs(d.dot(galNormal)) < max;
  const pick = (test) => { let d; do d = unit(); while (!test(d) || d.dot(sunDir) > 0.85); return d; };

  // Nebulae: emission near the band, reflection, planetary, remnant, dark.
  const nebulae = [
    { dir: pick(d => inBand(d, 0.25)), radius: 0.3, kind: 0, gain: 0.32 },
    { dir: pick(d => !inBand(d, 0.3)), radius: 0.12, kind: 1, gain: 0.22 },
    { dir: pick(d => !inBand(d, 0.2)), radius: 0.018, kind: 2, gain: 0.55 },
    { dir: pick(d => inBand(d, 0.5)), radius: 0.16, kind: 3, gain: 0.3 },
    { dir: pick(d => inBand(d, 0.2)), radius: 0.22, kind: 4, gain: 1 },
  ];
  const galaxies = [
    { dir: pick(d => !inBand(d, 0.45)), radius: 0.055, incl: 1.25, pa: 0.6, kind: 0 },
    { dir: pick(d => !inBand(d, 0.45)), radius: 0.018, incl: 0.25, pa: 1.9, kind: 0 },
    { dir: pick(d => !inBand(d, 0.45)), radius: 0.014, incl: 1.52, pa: -0.4, kind: 0 },
    { dir: pick(d => !inBand(d, 0.45)), radius: 0.009, incl: 0.6, pa: 0.9, kind: 1 },
    { dir: pick(d => !inBand(d, 0.45)), radius: 0.014, incl: 0.3, pa: 2.4, kind: 2 },
  ];

  const size = Math.min(RENDER.skyFace, renderer.capabilities.maxCubemapSize || 2048);
  const deep = bake(renderer, size, DEEP_FRAGMENT, {
    uSeed: { value: seed * 1.37 },
    uTexel: { value: (Math.PI / 2) / size },
    uGalNormal: { value: galNormal }, uGalCenter: { value: galCenter },
    uNebula: { value: nebulae.map(n => new THREE.Vector4(n.dir.x, n.dir.y, n.dir.z, n.radius)) },
    uNebulaKind: { value: nebulae.map((n, i) => new THREE.Vector4(n.kind, 10 + i * 7.3, n.gain, 0)) },
    uGalaxy: { value: galaxies.map(g => new THREE.Vector4(g.dir.x, g.dir.y, g.dir.z, g.radius)) },
    uGalaxyShape: { value: galaxies.map((g, i) => new THREE.Vector4(g.incl, g.pa, g.kind, 3 + i * 5.1)) },
  });
  scene.background = deep.texture;
  scene.backgroundIntensity = 1;

  // Two faint drifting veils.
  const veil = (s, a, b, gain) => bake(renderer, 512, VEIL_FRAGMENT, {
    uSeed: { value: s }, uTintA: { value: new THREE.Color(...a) }, uTintB: { value: new THREE.Color(...b) }, uGain: { value: gain },
  });
  const veils = [
    { map: veil(seed * 3.1, [0.1, 0.42, 0.55], [0.35, 0.2, 0.6], 0.07), axis: unit(), rate: 0.00035 },
    { map: veil(seed * 5.7, [0.6, 0.18, 0.3], [0.55, 0.38, 0.15], 0.05), axis: unit(), rate: -0.00022 },
  ].map(v => {
    const material = new THREE.ShaderMaterial({
      vertexShader: LAYER_VERTEX, fragmentShader: LAYER_FRAGMENT,
      uniforms: { uMap: { value: v.map.texture }, uGain: { value: 1 }, uSpin: { value: new THREE.Matrix3() } },
      side: THREE.BackSide, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(LAYER_RADIUS, 48, 24), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -100;
    scene.add(mesh);
    return { ...v, mesh, angle: rng.range(0, 6.28) };
  });

  // Two drifting layers of bright stars.
  const stars = [
    { points: starLayer(rng, 2200, 1, 1), axis: unit(), rate: 0.0006, parallax: 0 },
    { points: starLayer(rng, 3200, 0.55, 0.75), axis: unit(), rate: -0.00035, parallax: 0.04 },
  ];
  for (const s of stars) scene.add(s.points);

  // The gas giant and its rings.
  const radius = 9000;
  const planetDir = new THREE.Vector3(0.62, 0.1, 0.78).normalize();
  const center = planetDir.clone().multiplyScalar(44000);
  const pole = new THREE.Vector3(0.25, 1, -0.18).normalize();
  const planetUniforms = {
    uSun: { value: sunDir }, uCenter: { value: center }, uPole: { value: pole }, uRadius: { value: radius },
  };
  const planet = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64),
    new THREE.ShaderMaterial({ vertexShader: PLANET_VERTEX, fragmentShader: PLANET_FRAGMENT, uniforms: planetUniforms }));
  planet.position.copy(center);
  planet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pole);
  planet.renderOrder = -50;
  const rings = new THREE.Mesh(new THREE.RingGeometry(radius * 1.4, radius * 2.3, 256, 1),
    new THREE.ShaderMaterial({
      vertexShader: RING_VERTEX, fragmentShader: RING_FRAGMENT, uniforms: planetUniforms,
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
    }));
  rings.position.copy(center);
  rings.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pole);
  scene.add(planet, rings);

  const spin = new THREE.Matrix4(), m3 = new THREE.Matrix3();
  let time = 0;
  return {
    sunDir,
    environment: deep.texture,
    update(camera, dt, glow) {
      time += dt;
      for (const v of veils) {
        v.mesh.position.copy(camera.position);
        spin.makeRotationAxis(v.axis, v.angle + time * v.rate);
        v.mesh.material.uniforms.uSpin.value.copy(m3.setFromMatrix4(spin));
      }
      for (const s of stars) {
        s.points.position.copy(camera.position).multiplyScalar(1 - s.parallax);
        s.points.setRotationFromAxisAngle(s.axis, time * s.rate);
      }
      // The sun: a white disc with a warm corona, far enough to sit behind everything.
      const d = 30000, p = camera.position;
      const x = p.x + sunDir.x * d, y = p.y + sunDir.y * d, z = p.z + sunDir.z * d;
      glow?.add(x, y, z, 420, 1, 0.97, 0.9, 40);
      glow?.add(x, y, z, 1600, 1, 0.82, 0.6, 2.2);
      glow?.add(x, y, z, 5200, 1, 0.75, 0.5, 0.35);
    },
  };
}
