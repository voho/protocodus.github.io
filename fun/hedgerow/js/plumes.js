/* Hedgerow — smoke plumes over the fires.

   A fire's own smoke (effects.js particles) rises a dozen metres. Above it
   each fire carries a plume out to ~90 m: a ribbon turned to the camera
   about its axis, which leans downwind more the higher it climbs and sways
   a little, and the smoke worked out in its shader — billows of noise in
   metres rising through a column that widens and thins as it goes, dark
   grey against the glowing cloud, lit orange from below by its fire and
   bright grey by a burning flare or lightning, fading into the haze with
   distance. Drawn in the effects chain's first pass with the particles
   (effects.js), hidden behind what stands in front and soft where it meets
   it, before the light in the rain (volumetric.js) lays the glow of lamps,
   fires and muzzle flashes over the frame: that glow hangs in the air in
   front of the smoke, so the smoke must not cover it. Without the effects
   chain it is drawn with the scene. */

import * as THREE from 'three';

const SEG = 24, MAXP = 8;

const VERT = /* glsl */ `
attribute vec4 aPlume;         // xyz: the fire, w: its size
attribute float aSeed;
uniform float uTime;
uniform vec2 uWind;
varying vec2 vUv;
varying float vH, vW, vSeed, vDist;
varying vec2 vProj;
void main() {
  float s = aPlume.w;
  float h = position.y * 90.0 * (0.75 + 0.25 * min(s, 2.0));
  // downwind, more the higher it climbs, and swaying
  vec2 sway = vec2(sin(uTime * 0.11 + aSeed * 6.0 + h * 0.03), cos(uTime * 0.09 + aSeed * 4.0 + h * 0.025)) * h * 0.04;
  vec2 off = uWind * h * (0.15 + 0.0025 * h) + sway;
  vec3 axis = aPlume.xyz + vec3(off.x, h + 2.0 * s, off.y);
  vec3 tang = normalize(vec3(uWind.x * (0.15 + 0.005 * h), 1.0, uWind.y * (0.15 + 0.005 * h)));
  vec3 toCam = cameraPosition - axis;
  vec3 side = cross(tang, toCam);
  side = dot(side, side) < 1e-6 ? vec3(1.0, 0.0, 0.0) : normalize(side);
  float w = s * (1.0 + 0.22 * h);
  vec3 p = axis + side * position.x * w;
  vUv = position.xy;
  vH = h;
  vW = w;
  vSeed = aSeed;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vDist = -mv.z;
  vProj = vec2(projectionMatrix[2][2], projectionMatrix[3][2]);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uTime, uFlash, uSoft, uFogDensity;
uniform vec3 uSky, uFogColor;
uniform sampler2D tDepth;
uniform vec2 uScreen;
varying vec2 vUv;
varying float vH, vW, vSeed, vDist;
varying vec2 vProj;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
void main() {
  // billows about 7 m across, rising (in metres, so the plume looks the same size near or far)
  vec2 q = vec2(vUv.x * vW / 7.0 + vSeed * 13.0, (vH - uTime * 2.2) / 7.0);
  float d = fbm(q) * 0.65 + fbm(q * 2.3 + vec2(5.2, uTime * 0.05)) * 0.35;
  // a soft column, ragged at its edges, thickest low down; it comes out of the fire's own
  // smoke and thins away as it climbs
  float edge = abs(vUv.x) + (d - 0.5) * 0.7;
  float dens = (1.0 - smoothstep(0.3, 0.95, edge)) * smoothstep(0.32, 0.62, d + 0.18 * (1.0 - vUv.y));
  dens *= smoothstep(0.02, 0.12, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
  if (dens < 0.01) discard;
  // lit: its fire from below (flickering), the glow of the burning country, a flare, lightning
  float fl = 0.8 + 0.2 * sin(uTime * 7.0 + vSeed * 9.0) * sin(uTime * 3.3 + vSeed * 4.0);
  vec3 lit = vec3(1.0, 0.42, 0.14) * 1.4 * exp(-vH / 13.0) * fl * (0.6 + 0.4 * (1.0 - abs(vUv.x)));
  lit += vec3(0.05, 0.042, 0.036) + uSky * 0.7 + vec3(0.7, 0.75, 0.9) * uFlash * 0.8;
  vec3 col = vec3(0.09, 0.085, 0.08) * lit * (0.7 + 0.6 * d);
  // into the haze
  float fog = 1.0 - exp(-vDist * uFogDensity);
  col = mix(col, uFogColor * 0.6, fog * 0.85);
  // (and gone right at the eye, where the ribbon would show as a flat sheet)
  float a = dens * 0.9 * (1.0 - fog * 0.5) * smoothstep(3.0, 10.0, vDist);
  // drawn over the scene in the chain: hidden behind what is in front, soft where it meets it
  if (uSoft > 0.5) {
    float zd = texture2D(tDepth, gl_FragCoord.xy * uScreen).x * 2.0 - 1.0;
    a *= clamp((vProj.y / (zd + vProj.x) - vDist) / 3.0, 0.0, 1.0);
  }
  gl_FragColor = vec4(col * a, a);
}`;

export function createPlumes(effects, { fog }) {
  // a strip from the base (y 0) to the top (y 1), denser low down where it bends least
  const pos = [], idx = [];
  for (let i = 0; i <= SEG; i++) {
    const v = Math.pow(i / SEG, 1.3);
    pos.push(-1, v, 0, 1, v, 0);
    if (i < SEG) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const plumeA = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4);
  const seedA = new THREE.InstancedBufferAttribute(new Float32Array(MAXP), 1);
  plumeA.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPlume', plumeA);
  geo.setAttribute('aSeed', seedA);
  geo.instanceCount = 0;
  const own = { tDepth: { value: null }, uScreen: { value: new THREE.Vector2(1, 1) }, uSoft: { value: 0 } };
  const uniforms = {
    uTime: { value: 0 }, uWind: { value: new THREE.Vector2(1.4, 0.6) }, uFlash: { value: 0 },
    uSky: { value: new THREE.Vector3() }, uFogColor: fog.color, uFogDensity: fog.density, ...own,
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, fog: false, side: THREE.DoubleSide,
  });
  mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor; mat.blendEquation = THREE.AddEquation;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'plumes';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  let time = 0;

  return {
    mesh,
    /* drawn in this scene (the effects chain's first pass, hidden behind the scene by its
       depth: depth = {tDepth, uScreen, uSoft} uniforms that pass keeps), or with the scene */
    drawIn(passScene, scene, depth = null) {
      (passScene || scene).add(mesh);
      mat.depthTest = !passScene;
      const d = passScene && depth ? depth : own;
      uniforms.tDepth = d.tDepth; uniforms.uScreen = d.uScreen; uniforms.uSoft = d.uSoft;
      mat.needsUpdate = true;
    },
    /* wind {x, z} in m/s; flash: lightning (0..1); sky: a burning flare's light at the eye
       ({color, intensity} or null) */
    update(dt, wind, flash, sky) {
      time += dt;
      uniforms.uTime.value = time;
      uniforms.uWind.value.set(wind.x, wind.z);
      uniforms.uFlash.value = flash;
      const k = sky ? Math.min(sky.intensity, 8) * 0.05 : 0;
      if (sky) uniforms.uSky.value.set(sky.color.r * k, sky.color.g * k, sky.color.b * k);
      else uniforms.uSky.value.set(0, 0, 0);
      let n = 0;
      for (const f of effects.fires) {
        if (!f.on || n >= MAXP) continue;
        plumeA.array.set([f.x, f.y, f.z, f.size], n * 4);
        seedA.array[n] = (f.x * 0.137 + f.z * 0.071) % 1;
        n++;
      }
      geo.instanceCount = n;
      mesh.visible = n > 0;
      plumeA.needsUpdate = true;
      seedA.needsUpdate = true;
    },
  };
}
