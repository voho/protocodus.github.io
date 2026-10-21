/* Hedgerow — rain and lightning.

   Rain is one instanced draw: thousands of streaks whose positions live on
   the GPU, wrapped in a box that follows the camera, each a quad stretched
   along its fall velocity and turned to face the view. Splashes are rings
   that grow and fade on the ground around the player. Lightning comes in
   flickering strokes every so often, lifting the sky and the light, and
   schedules its thunder for the audio by distance. */

import * as THREE from 'three';
import { rng } from './util.js';

const RAIN_VERT = /* glsl */ `
attribute vec4 aDrop;            // xyz: 0..1 position in the box, w: random
uniform vec3 uCam, uBox, uVel;
uniform float uTime, uLength, uWidth;
uniform vec3 uLightPos[6];
uniform vec3 uLightCol[6];
varying float vAlpha;
varying vec2 vUv;
varying vec3 vLit;
varying float vDist;
varying vec2 vProj;
void main() {
  vec3 vel = uVel * (0.85 + 0.3 * aDrop.w);
  vec3 p = aDrop.xyz * uBox + vel * uTime;
  p = mod(p - uCam + uBox * 0.5, uBox) + uCam - uBox * 0.5;
  vec3 axis = normalize(vel);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(axis, toCam));
  float len = uLength * (0.7 + 0.6 * aDrop.w);
  vec3 wp = p + side * (uv.x - 0.5) * uWidth + axis * (uv.y - 0.5) * len;
  float dist = length(p - cameraPosition);
  vAlpha = smoothstep(1.2, 4.5, dist) * (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, dist));
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
uniform vec3 uColor;
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
  float boost = min(dot(vLit, vec3(0.33)), 4.0);
  float a = edge * tail * vAlpha * uOpacity * (1.0 + boost * 1.5);
  gl_FragColor = vec4(uColor * (1.0 + uFlash * 3.0) + vLit * 2.0, min(a, 0.9));
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

export function createWeather({ count = 8000, terrain, onThunder, seed = 4 }) {
  const R = rng(seed);
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
    uWidth: { value: 0.016 },
    uColor: { value: new THREE.Color('#9aa4ad') },
    uOpacity: { value: 0.2 },
    uFlash: { value: 0 },
    uLightPos: { value: Array.from({ length: 6 }, () => new THREE.Vector3(0, -1000, 0)) },
    uLightCol: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
    tDepth: { value: null }, uScreen: { value: new THREE.Vector2(1, 1) }, uSoft: { value: 0 },
  };
  const rainMat = new THREE.ShaderMaterial({
    vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, uniforms: rainUniforms,
    transparent: true, depthWrite: false, fog: false,
  });
  const rain = new THREE.Mesh(geo, rainMat);
  rain.frustumCulled = false;
  rain.renderOrder = 5;
  group.add(rain);

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
    const az = R() * Math.PI * 2;
    flashDir.set(Math.sin(az), 0.25 + R() * 0.35, Math.cos(az)).normalize();
    const distance = 0.6 + R() * 3.2;             // km
    strike = { t: time, pulses, power: distance < 1.2 ? 1.3 : 1 / (0.5 + distance * 0.3) };
    onThunder?.({ delay: distance * 2.9, power: 1 / (0.4 + distance * 0.35), distance });
  }

  function update(dt, time, camera, rainAmount = 1) {
    rainUniforms.uTime.value = time;
    rainUniforms.uCam.value.copy(camera.position);
    rainUniforms.uOpacity.value = 0.2 * rainAmount;
    splashUniforms.uTime.value = time;

    // splashes around the camera
    splashAcc += dt * 900 * rainAmount;
    const cx = camera.position.x, cz = camera.position.z;
    let changed = false;
    while (splashAcc >= 1) {
      splashAcc -= 1;
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 16;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const y = terrain ? terrain.height(x, z) : 0;
      const k = splashCursor * 4;
      splashes[k] = x; splashes[k + 1] = y; splashes[k + 2] = z; splashes[k + 3] = time - R() * 0.02;
      splashCursor = (splashCursor + 1) % SPL;
      changed = true;
    }
    if (changed) splashAttr.needsUpdate = true;

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
  }

  return {
    group, update, flashDir, setLights, drawLate,
    get flash() { return flash; },
    setCount(n) { geo.instanceCount = Math.min(n, count); },
    strikeNow(time) { scheduleStrike(time); },
  };
}
