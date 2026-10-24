/* Hedgerow — the fireball of a blast.

   Over each blast of the last second and a half (effects.js `blasts`)
   stands a billboard facing the camera, and the fireball is worked out in
   its shader: a ball of turbulent flame that swells out in a tenth of a
   second and rolls upward as it goes, white-yellow at its heart, cooling
   from the outside in through orange to a dull red glow inside a ball of
   dark smoke, which then thins into the blast's particle smoke. Drawn with
   the late particles (after the anti-aliasing, so its turbulence stays
   crisp), hidden behind what stands in front and soft where it meets it;
   without the effects chain it is drawn with the scene. */

import * as THREE from 'three';

const MAXB = 4;

const VERT = /* glsl */ `
attribute vec4 aBlast;         // xyz: where it went off, w: its scale
attribute vec2 aAge;           // seconds since, seed
varying vec2 vUv;
varying float vAge, vSeed, vDist;
varying vec2 vProj;
void main() {
  float s = aBlast.w, t = aAge.x;
  vec3 c = aBlast.xyz + vec3(0.0, (0.9 + 1.1 * t) * s, 0.0);
  float q = 2.6 * s;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p = c + (right * position.x + up * position.y) * q;
  vUv = position.xy;
  vAge = t;
  vSeed = aAge.y;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vDist = -mv.z;
  vProj = vec2(projectionMatrix[2][2], projectionMatrix[3][2]);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uGain, uSoft, uFlash;
uniform vec3 uSky;
uniform sampler2D tDepth;
uniform vec2 uScreen;
varying vec2 vUv;
varying float vAge, vSeed, vDist;
varying vec2 vProj;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
void main() {
  float t = vAge;
  vec2 p = vUv;
  float r = length(p);
  // swells out in a tenth of a second, then keeps growing slowly
  float R = 0.3 + 0.55 * (1.0 - exp(-t * 11.0)) + 0.1 * t;
  // rolling turbulence, flowing out of the heart and up
  vec2 dir = p / max(r, 1e-3);
  float n1 = fbm(p * 2.4 + vec2(vSeed * 7.0, -t * 1.6));
  float n2 = fbm(p * 5.1 - dir * t * 1.4 + vSeed * 3.0);
  float edge = r / R + (n1 - 0.5) * 0.7 + (n2 - 0.5) * 0.3;
  float body = 1.0 - smoothstep(0.55, 1.0, edge);
  float fade = 1.0 - smoothstep(0.75, 1.5, t);
  if (body * fade < 0.01) discard;
  // heat: hottest at the heart and at first; it cools from the outside in, from the start (white
  // only for a frame or two, at its heart: a blast is not a ball of light)
  float cool = smoothstep(0.0, 0.55, t);
  // (folds of cooler, sootier flame through it: the turbulence decides much of it)
  float heat = clamp((1.0 - edge) * 1.05 - cool * 1.1 + (n2 - 0.5) * 1.1 + (n1 - 0.5) * 0.5, 0.0, 1.0);
  // a black body: deep red, orange, yellow, white only at the hottest
  vec3 fire = mix(vec3(0.45, 0.04, 0.0), vec3(1.0, 0.3, 0.02), smoothstep(0.05, 0.35, heat));
  fire = mix(fire, vec3(1.0, 0.6, 0.12), smoothstep(0.35, 0.65, heat));
  fire = mix(fire, vec3(1.0, 0.85, 0.45), smoothstep(0.65, 0.85, heat));
  fire = mix(fire, vec3(1.0, 0.95, 0.8), smoothstep(0.93, 1.0, heat));
  float glow = smoothstep(0.02, 0.3, heat) * body;
  // smoke where it has cooled: dark, lit by the fire still in it, the night, a flare, lightning
  float smoke = body * smoothstep(0.06, 0.45, t) * (1.0 - smoothstep(0.1, 0.5, heat));
  vec3 smokeCol = vec3(0.1, 0.092, 0.082) * (0.35 + uSky * 0.7 + vec3(0.7, 0.75, 0.9) * uFlash)
    + fire * 0.25 * (1.0 - cool) * (0.4 + 0.6 * n1);
  float a = (smoke * 0.7 + glow * 0.25) * fade;
  // the hotter, the brighter: a yellow heart, orange folds, dull red where it is cooling
  vec3 col = fire * glow * uGain * (0.15 + 1.6 * heat * heat) * (0.6 + 0.4 * (1.0 - cool)) * fade + smokeCol * smoke * fade;
  // drawn over the finished frame: hidden behind what is in front, soft where it meets it
  if (uSoft > 0.5) {
    float zd = texture2D(tDepth, gl_FragCoord.xy * uScreen).x * 2.0 - 1.0;
    float k = clamp((vProj.y / (zd + vProj.x) - vDist) / 1.2, 0.0, 1.0);
    a *= k; col *= k;
  }
  col *= smoothstep(0.5, 2.0, vDist);
  a *= smoothstep(0.5, 2.0, vDist);
  gl_FragColor = vec4(col, a);
}`;

export function createFireballs(effects, { gain = 0.9 } = {}) {
  const quad = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  const blastA = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 4), 4);
  const ageA = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 2), 2);
  blastA.setUsage(THREE.DynamicDrawUsage);
  ageA.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aBlast', blastA);
  geo.setAttribute('aAge', ageA);
  geo.instanceCount = 0;
  const own = { tDepth: { value: null }, uScreen: { value: new THREE.Vector2(1, 1) }, uSoft: { value: 0 } };
  const uniforms = { uGain: { value: gain }, uFlash: { value: 0 }, uSky: { value: new THREE.Vector3() }, ...own };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, fog: false,
  });
  mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor; mat.blendEquation = THREE.AddEquation;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fireballs';
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;

  return {
    mesh,
    /* drawn after the frame in this scene (the late pass, hidden behind the scene by its
       depth: depth = {tDepth, uScreen, uSoft} uniforms that pass keeps), or with the scene */
    drawLate(lateScene, scene, depth = null) {
      (lateScene || scene).add(mesh);
      mat.depthTest = !lateScene;
      const d = lateScene && depth ? depth : own;
      uniforms.tDepth = d.tDepth; uniforms.uScreen = d.uScreen; uniforms.uSoft = d.uSoft;
      mat.needsUpdate = true;
    },
    /* flash: lightning (0..1); sky: a burning flare's light at the eye ({color, intensity} or null) */
    update(flash, sky) {
      uniforms.uFlash.value = flash;
      const k = sky ? Math.min(sky.intensity, 8) * 0.05 : 0;
      if (sky) uniforms.uSky.value.set(sky.color.r * k, sky.color.g * k, sky.color.b * k);
      else uniforms.uSky.value.set(0, 0, 0);
      const list = effects.blasts;
      const n = Math.min(MAXB, list.length);
      for (let i = 0; i < n; i++) {
        const b = list[list.length - n + i];
        blastA.array.set([b.x, b.y, b.z, b.scale], i * 4);
        ageA.array[i * 2] = b.age; ageA.array[i * 2 + 1] = b.seed;
      }
      geo.instanceCount = n;
      mesh.visible = n > 0;
      blastA.needsUpdate = true;
      ageA.needsUpdate = true;
    },
  };
}
