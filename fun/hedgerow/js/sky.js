/* Hedgerow — the dusk sky: a dome with layered rain clouds drifting with
   the wind, a last orange glow low in the west, and lightning that lights
   the clouds from inside. The colour at the horizon is the fog colour, so
   the land fades into the sky. */

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

void main() {
  vec3 d = normalize(vDir);
  float el = d.y;
  float h = clamp(el, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
  // last light in the west, under the cloud deck
  float g = max(dot(normalize(vec3(d.x, 0.0, d.z)), uGlowDir), 0.0);
  float band = exp(-max(el, 0.0) * 9.0) * pow(g, 3.0);
  col += uGlow * band * 0.9;
  // cloud deck projected on a plane
  vec2 uv = d.xz / (max(el, 0.0) + 0.12);
  vec2 drift = uWind * uTime * 0.004;
  float c1 = fbm(uv * 0.55 + drift);
  float c2 = fbm(uv * 1.3 - drift * 1.7 + 4.0);
  float cloud = smoothstep(0.35, 0.8, c1 * 0.7 + c2 * 0.45);
  vec3 dark = uZenith * 0.55;
  vec3 lit = mix(uHorizon * 1.15, uGlow * 0.6 + uHorizon * 0.7, band * 1.5);
  col = mix(col, mix(dark, lit, c2), cloud * smoothstep(0.06, 0.4, el));
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
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return {
    mesh, uniforms,
    update(dt, time, camera, flash, flashDir) {
      mesh.position.copy(camera.position);
      uniforms.uTime.value = time;
      uniforms.uFlash.value = flash;
      if (flashDir) uniforms.uFlashDir.value.copy(flashDir);
    },
  };
}
