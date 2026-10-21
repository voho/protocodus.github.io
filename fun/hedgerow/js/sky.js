/* Hedgerow — the dusk sky: a dome with layered rain clouds drifting with
   the wind, a last orange glow low in the west, and lightning that lights
   the clouds from inside (and, about half the time, a forked bolt down to
   the horizon under it); burning farms light the cloud base over them,
   and the far barrage's flashes catch it. The colour at the horizon is the fog colour, so
   the land fades into the sky. Far beyond the trees, the front: three
   searchlights sweeping the cloud base, each a pale beam from the horizon
   to a pool of light on the cloud, and two flak guns sending streams of
   tracer up into it in bursts (front()). */

import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const FRAG = /* glsl */ `
uniform vec3 uZenith, uHorizon, uGlow, uFog;
uniform vec3 uGlowDir;
uniform float uTime, uFlash;
uniform vec3 uFlashDir;
uniform vec2 uWind;
uniform float uArty;
uniform vec3 uArtyDir;
uniform float uFlare;
uniform vec3 uFlareDir;
uniform float uFront;
uniform vec3 uCam;
uniform vec4 uFires[6];
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += noise(p) * a; p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

// a stroke of lightning down to the horizon under the flash (about half the strikes; the rest
// stay inside the cloud): a channel wandering in a random walk across, two branches forking off
// it, a core a couple of pixels wide (thinner and the anti-aliasing would dim it) and its glow.
// Per strike, from where it is (each strike is somewhere new).
float boltLine(float x, float w) { return exp(-x * x / (w * w)); }
// the channel's offset across (rad), by elevation: coarse kinks, finer jags
float boltPath(float el, float seed) {
  return (noise(vec2(el * 9.0, seed * 53.0)) - 0.5) * 0.07 + (noise(vec2(el * 36.0, seed * 91.0)) - 0.5) * 0.032 + (noise(vec2(el * 130.0, seed * 37.0)) - 0.5) * 0.009
    + (noise(vec2(el * 420.0, seed * 13.0)) - 0.5) * 0.003;
}
vec3 bolt(vec3 d) {
  float seed = fract(sin(dot(uFlashDir.xz, vec2(12.9898, 78.233))) * 43758.5453);
  if (seed > 0.55) return vec3(0.0);
  float az0 = atan(uFlashDir.x, uFlashDir.z);
  float da = mod(atan(d.x, d.z) - az0 + 3.14159, 6.28318) - 3.14159;
  float el = asin(clamp(d.y, -1.0, 1.0));
  float top = clamp(asin(uFlashDir.y), 0.2, 0.95);         // from the flash in the cloud
  if (el > top + 0.03 || el < -0.03 || abs(da) > 0.25) return vec3(0.0);
  float ce = cos(el);
  // the distance from the channel, across its own direction (where it jags sideways it would
  // otherwise thin out to nothing)
  float x = boltPath(el, seed);
  float slope = (boltPath(el + 0.0008, seed) - boltPath(el - 0.0008, seed)) / 0.0016;
  float a = abs(da * ce - x) * inversesqrt(1.0 + slope * slope);
  float k = boltLine(a, 0.0016) * 26.0 + boltLine(a, 0.006) * 2.2 + exp(-a / 0.035) * 0.35;
  k *= smoothstep(top + 0.03, top - 0.02, el);        // out of the cloud base
  // two branches, forking down and away from it, thinner, dying out
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float h = fract(seed * (7.13 + fi * 3.7));
    float e0 = top * (0.35 + 0.45 * h), len = 0.04 + 0.05 * fract(h * 5.3);
    if (el > e0 || el < e0 - len) continue;
    float t = (e0 - el) / len;
    float sl = (fi - 0.5) * 2.0 * (0.25 + 0.5 * fract(h * 9.1));
    float xb = boltPath(e0, seed) + sl * (e0 - el) + (noise(vec2(el * 300.0, seed * 51.0 + fi * 17.0)) - 0.5) * 0.004;
    float ab = abs(da * ce - xb) * inversesqrt(1.0 + sl * sl);
    k += (boltLine(ab, 0.0013) * 12.0 + boltLine(ab, 0.005) * 1.0) * (1.0 - t) * (1.0 - t);
  }
  return vec3(0.82, 0.88, 1.0) * k;
}

// the front at night, far beyond the trees (to the north, ahead)
vec3 front(vec3 d, float cloud) {
  vec3 add = vec3(0.0);
  // searchlights: a beam on the dome is the arc from its base on the horizon to its tip on the
  // cloud base; the tips sweep slowly
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float az0 = -0.75 + fi * 0.62 + 0.08 * sin(fi * 3.7);
    float az1 = az0 + 0.38 * sin(uTime * (0.045 + 0.012 * fi) + fi * 2.1);
    float e1 = 0.42 + 0.12 * sin(uTime * (0.033 + 0.01 * fi) + fi * 1.3);
    vec3 B = vec3(sin(az0), 0.0, cos(az0));
    vec3 T = vec3(cos(e1) * sin(az1), sin(e1), cos(e1) * cos(az1));
    vec3 n = normalize(cross(B, T));
    float off = dot(d, n);
    vec3 dp = normalize(d - n * off);
    if (dot(cross(B, dp), n) < 0.0 || dot(cross(dp, T), n) < -0.02) continue;
    float along = clamp(acos(clamp(dot(B, dp), -1.0, 1.0)) / max(acos(clamp(dot(B, T), -1.0, 1.0)), 1e-3), 0.0, 1.0);
    float w = mix(0.004, 0.012, along);               // wider away from the light
    float beam = exp(-off * off / (w * w)) * (1.0 - smoothstep(0.75, 1.0, along)) * (0.55 + 0.45 * (1.0 - along));
    add += vec3(0.55, 0.6, 0.7) * beam * 0.26;
    // its pool of light on the cloud base: a wide smear, flattened like the cloud, where there is cloud
    float dAz = atan(d.x, d.z) - az1;
    dAz = (mod(dAz + 3.14159, 6.28318) - 3.14159) * cos(e1);
    float dEl = (asin(clamp(d.y, -1.0, 1.0)) - e1) * 2.6;
    add += vec3(0.5, 0.55, 0.62) * exp(-(dAz * dAz + dEl * dEl) / (0.05 * 0.05)) * (0.04 + 0.12 * cloud);
  }
  // flak: two guns sending streams of tracer up into the cloud, in bursts
  for (int g = 0; g < 2; g++) {
    float fg = float(g);
    float ph = fract(uTime * 0.05 + fg * 0.43);
    float burst = smoothstep(0.55, 0.6, ph) * (1.0 - smoothstep(0.85, 0.9, ph));
    if (burst <= 0.0) continue;
    float az = -0.45 + fg * 0.7;
    for (int k = 0; k < 8; k++) {
      float s0 = fract(uTime * 0.55 + float(k) * 0.125 + fg * 0.37);
      // each round a short streak along its way up (a dot would move a couple of pixels a frame
      // and the anti-aliasing would all but drop it)
      float glow = 0.0;
      for (int j = 0; j < 3; j++) {
        float s = max(s0 - float(j) * 0.008, 0.0);
        float e = s * 0.42, a = az + (0.05 + 0.03 * fg) * s * s;
        vec3 p = vec3(cos(e) * sin(a), sin(e), cos(e) * cos(a));
        // 2 (1 - cos) is the angle squared, near enough
        glow = max(glow, exp(-2.0 * (1.0 - dot(d, p)) / (0.0024 * 0.0024)) * (1.0 - float(j) * 0.25));
      }
      add += mix(vec3(1.0, 0.75, 0.3), vec3(1.0, 0.35, 0.15), fg) * glow * (1.0 - s0 * 0.8) * burst * 2.5;
    }
  }
  return add;
}

void main() {
  vec3 d = normalize(vDir);
  float el = d.y;
  float h = clamp(el, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
  // last light in the west, under the cloud deck
  float g = max(dot(normalize(vec3(d.x, 0.0, d.z)), uGlowDir), 0.0);
  float band = exp(-max(el, 0.0) * 9.0) * pow(g, 3.0);
  col += uGlow * band * 0.9;
  // cloud deck projected on a plane (uv: where the view meets it, in units of its height
  // over the eye), rolled and billowed by noise warped by itself, slowly churning
  vec2 uv = d.xz / (max(el, 0.0) + 0.12);
  vec2 drift = uWind * uTime * 0.004;
  vec2 q = uv * 0.55 + drift;
  vec2 w = vec2(fbm(q * 0.8 + vec2(3.1, 1.7) + uTime * 0.003), fbm(q * 0.8 + vec2(-2.3, 5.9) - uTime * 0.002)) - 0.5;
  float c1 = fbm(q + w * 1.6);
  float c2 = fbm(uv * 1.3 - drift * 1.7 + 4.0 + w * 0.8);
  float dens = c1 * 0.7 + c2 * 0.45;
  float cloud = smoothstep(0.35, 0.8, dens);
  float belly = smoothstep(0.5, 0.95, dens);
  vec3 dark = uZenith * 0.55;
  vec3 lit = mix(uHorizon * 1.15, uGlow * 0.6 + uHorizon * 0.7, band * 1.5);
  float deck = smoothstep(0.06, 0.4, el);
  // the gaps show the darker sky above the deck; the bellies hang lower and catch more light
  col = mix(col * mix(1.0, 0.6, deck), mix(dark, lit * 1.3, c2 * 0.55 + belly * 0.45), cloud * deck);
  // the burning farms light the cloud base over them (taken 320 m up), the thick bellies
  // most, flickering with the flames
  vec2 P = uCam.xz + uv * 320.0;
  float fire = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 f = uFires[i];
    if (f.z <= 0.0) continue;
    vec2 dp = P - f.xy;
    float r2 = dot(dp, dp) + 102400.0;
    fire += f.z * (0.8 + 0.2 * sin(uTime * 6.3 + f.w) * sin(uTime * 2.9 + f.w * 1.7)) * 320.0 / (r2 * sqrt(r2));
  }
  col += vec3(1.0, 0.42, 0.14) * fire * 4500.0 * cloud * (0.35 + 0.65 * belly) * smoothstep(0.02, 0.2, el);
  // the far barrage's flashes catch the cloud over the horizon
  float ad0 = max(dot(normalize(vec3(d.x, 0.0, d.z)), uArtyDir), 0.0);
  col += vec3(1.0, 0.6, 0.3) * uArty * pow(ad0, 5.0) * exp(-max(el, 0.0) * 4.0) * cloud * 0.12;
  // lightning: a bright patch inside the clouds plus a general lift
  float fd = max(dot(d, uFlashDir), 0.0);
  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.25 + 1.6 * pow(fd, 6.0) * (0.4 + cloud));
  // a far barrage: orange pulses low on the horizon, under the clouds
  float ad = max(dot(normalize(vec3(d.x, 0.0, d.z)), uArtyDir), 0.0);
  col += vec3(1.0, 0.55, 0.25) * uArty * pow(ad, 24.0) * exp(-max(el, 0.0) * 14.0) * 1.6;
  // a flare under the cloud deck: the cloud round it lit white, a halo in the wet air
  float fl = max(dot(d, uFlareDir), 0.0);
  col += vec3(0.85, 0.9, 1.0) * uFlare * (pow(fl, 8.0) * (0.04 + 0.24 * cloud) + pow(fl, 90.0) * 0.5);
  // into the fog at and below the horizon
  col = mix(col, uFog, smoothstep(0.22, -0.01, el));
  // the glow sits on the horizon, behind the fog
  col += uGlow * band * 0.55 * smoothstep(-0.03, 0.02, el) * (1.0 - cloud * 0.5);
  // the front, its beams' feet softened by the haze on the horizon
  if (uFront > 0.0 && el > -0.01) col += front(d, cloud) * uFront * (0.35 + 0.65 * smoothstep(-0.01, 0.06, el));
  // the bolt, through the rain and the haze low down
  if (uFlash > 0.05) col += bolt(d) * sqrt(min(uFlash, 1.0)) * (0.45 + 0.55 * smoothstep(-0.01, 0.08, el));
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky({ zenith = '#161b21', horizon = '#3b4148', glow = '#a2643a', fog = '#3a4047', glowAzimuth = 1.0 } = {}) {
  const uniforms = {
    uZenith: { value: new THREE.Color(zenith) },
    uHorizon: { value: new THREE.Color(horizon) },
    uGlow: { value: new THREE.Color(glow) },
    uFog: { value: new THREE.Color(fog) },
    uGlowDir: { value: new THREE.Vector3(Math.sin(glowAzimuth), 0, Math.cos(glowAzimuth)) },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uFlashDir: { value: new THREE.Vector3(0, 0.4, 1).normalize() },
    uWind: { value: new THREE.Vector2(1.0, 0.3) },
    uArty: { value: 0 },
    uArtyDir: { value: new THREE.Vector3(0, 0, 1) },
    uFlare: { value: 0 },
    uFlareDir: { value: new THREE.Vector3(0, 0.6, 0.8) },
    uFront: { value: 1 },
    uCam: { value: new THREE.Vector3() },
    uFires: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
  };
  let fires = null;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  // last of the opaque things (everything blended is drawn after it): the depth test leaves
  // only the sky that shows to be shaded
  mesh.renderOrder = 1000;
  return {
    mesh, uniforms,
    /* the fires whose glow the cloud carries (effects.js addFire records: x, z, size, on) */
    setFires(list) { fires = list; },
    update(dt, time, camera, flash, flashDir) {
      mesh.position.copy(camera.position);
      uniforms.uCam.value.copy(camera.position);
      if (fires) uniforms.uFires.value.forEach((v, i) => {
        const f = fires[i];
        v.set(f?.x || 0, f?.z || 0, f && f.on !== false ? f.size : 0, i * 2.3);
      });
      uniforms.uTime.value = time;
      uniforms.uFlash.value = flash;
      if (flashDir) uniforms.uFlashDir.value.copy(flashDir);
    },
  };
}
