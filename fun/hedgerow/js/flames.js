/* Hedgerow — fire as flame: procedural flames at each fire near the camera.

   Over every fire within 60 m (the burning truck, the house, the flak gun
   once it is blown) stand five billboards over its whole breadth, rising
   out of the wreck two to three metres, each turned to the camera about
   its upright axis, and each a body of flame worked out in its shader:
   turbulent noise rising through a shape that is wide at the base and licks
   up to points, eaten away from the top, coloured by its heat like a black
   body — deep red at its ragged edges, through orange, to a yellow-white
   core — bright enough to bloom. Drawn with the late particles (after the
   anti-aliasing, so the flicker stays crisp: effects.js), hidden behind
   what stands in front and soft where it meets the truck's cab or the wall;
   without the effects chain it is drawn with the scene. The sprite flames
   of effects.js thin out to the odd lick over it; the smoke and the embers
   stay. */

import * as THREE from 'three';

const PER = 5, MAXF = 16, RANGE = 60;

const VERT = /* glsl */ `
attribute vec4 aFire;          // xyz: the base, w: size
attribute vec3 aSeed;          // seed, share (0..1: how big this one is), gain (its fire's)
varying vec2 vUv;
varying float vSeed, vDist, vGain;
varying vec2 vProj;
void main() {
  float s = aFire.w;
  // turned to the camera about the upright axis
  vec3 t = cameraPosition - aFire.xyz;
  t.y = 0.0;
  if (dot(t, t) < 1e-4) t = vec3(0.0, 0.0, 1.0);
  vec3 right = normalize(vec3(t.z, 0.0, -t.x));
  float w = (0.95 + 0.45 * aSeed.y) * s, h = (1.8 + 1.1 * aSeed.y) * s;
  vec3 p = aFire.xyz + right * position.x * w + vec3(0.0, position.y * h, 0.0);
  vUv = vec2(position.x * 2.0, position.y);
  vSeed = aSeed.x;
  vGain = aSeed.z;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vDist = -mv.z;
  vProj = vec2(projectionMatrix[2][2], projectionMatrix[3][2]);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uTime, uGain, uSoft;
uniform sampler2D tDepth;
uniform vec2 uScreen;
varying vec2 vUv;
varying float vSeed, vDist, vGain;
varying vec2 vProj;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
void main() {
  // drawn over the finished frame: hidden behind what is in front, soft where it meets it (first,
  // before the noise: most of a fire inside a house is behind its walls)
  float seen = 1.0;
  if (uSoft > 0.5) {
    float zd = texture2D(tDepth, gl_FragCoord.xy * uScreen).x * 2.0 - 1.0;
    seen = clamp((vProj.y / (zd + vProj.x) - vDist) / 0.35, 0.0, 1.0);
    if (seen <= 0.0) discard;
  }
  float t = uTime + vSeed * 7.3;
  vec2 uv = vUv;                 // x: -1..1 across, y: 0..1 up
  // noise rising through it, faster higher up; the flame bends with it
  float n1 = fbm(vec2(uv.x * 1.6 + vSeed * 3.1, uv.y * 2.2 - t * 2.1));
  float n2 = fbm(vec2(uv.x * 3.4 - vSeed * 1.7, uv.y * 4.0 - t * 3.6));
  float x = uv.x + (n1 - 0.5) * 0.9 * uv.y;
  // wide at the base, licking up to points, eaten away from above
  float width = mix(0.9, 0.08, pow(uv.y, 0.7));
  float body = 1.0 - smoothstep(width * 0.45, width, abs(x));
  body *= 1.0 - smoothstep(0.25, 0.95, uv.y + (n2 - 0.5) * 0.6 - (n1 - 0.5) * 0.3);
  // a ragged base, fading in (it rises out of something, not off a line)
  body *= smoothstep(0.0, 0.28, uv.y + (n1 - 0.5) * 0.3);
  // broken into tongues by the rising noise (more of it whole near the base)
  body *= smoothstep(0.3, 0.62, n2 + (1.0 - uv.y) * 0.32);
  float heat = clamp(body * (1.05 - uv.y * 0.8) * (0.5 + 0.6 * n1), 0.0, 1.0);
  if (heat < 0.04) discard;
  // a black body: deep red at the ragged edges, mostly orange, yellow, white only at the hottest
  vec3 col = mix(vec3(0.45, 0.04, 0.0), vec3(1.0, 0.3, 0.02), smoothstep(0.05, 0.35, heat));
  col = mix(col, vec3(1.0, 0.6, 0.12), smoothstep(0.35, 0.65, heat));
  col = mix(col, vec3(1.0, 0.85, 0.45), smoothstep(0.65, 0.85, heat));
  col = mix(col, vec3(1.0, 0.95, 0.8), smoothstep(0.88, 1.0, heat));
  float a = smoothstep(0.04, 0.35, heat) * seen;
  gl_FragColor = vec4(col * a * uGain * vGain, 1.0);
}`;

export function createFlames(effects, { gain = 1.4 } = {}) {
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  const fireA = new THREE.InstancedBufferAttribute(new Float32Array(MAXF * PER * 4), 4);
  const seedA = new THREE.InstancedBufferAttribute(new Float32Array(MAXF * PER * 3), 3);
  fireA.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aFire', fireA);
  geo.setAttribute('aSeed', seedA);
  geo.instanceCount = 0;
  const own = { tDepth: { value: null }, uScreen: { value: new THREE.Vector2(1, 1) }, uSoft: { value: 0 } };
  const uniforms = { uTime: { value: 0 }, uGain: { value: gain }, ...own };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, fog: false,
  });
  mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneFactor; mat.blendEquation = THREE.AddEquation;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'flames';
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  // each fire's five flames: where round its base, how big, their seeds (fixed per fire)
  const layout = new WeakMap();
  const lay = (f) => {
    let l = layout.get(f);
    if (!l) {
      const k = (f.x * 12.9898 + f.z * 78.233) % 1;
      l = [[-0.45, 0.15, 0.6, k], [0.4, -0.15, 0.75, k + 0.37], [0.02, 0.05, 1.0, k + 0.71],
        [-0.15, -0.38, 0.5, k + 0.19], [0.22, 0.36, 0.65, k + 0.53]];
      layout.set(f, l);
    }
    return l;
  };
  const near = [];
  let time = 0;

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
      // the sprite flames thin out to the odd lick over these
      effects.setFlameShare?.(0.3);
    },
    update(dt, cam) {
      time += dt;
      uniforms.uTime.value = time;
      near.length = 0;
      for (const list of [effects.fires, effects.debris || []]) for (const f of list) {
        if (!f.on || f.far) continue;
        const d2 = (f.x - cam.x) ** 2 + (f.z - cam.z) ** 2;
        if (d2 < RANGE * RANGE) near.push([d2, f]);
      }
      near.sort((a, b) => a[0] - b[0]);
      const n = Math.min(MAXF, near.length);
      for (let i = 0; i < n; i++) {
        const f = near[i][1];
        const l = lay(f);
        for (let j = 0; j < PER; j++) {
          const [ox, oz, share, seed] = l[j], k = i * PER + j;
          fireA.array.set([f.x + ox * f.size, f.y - 0.25, f.z + oz * f.size, f.size], k * 4);
          seedA.array[k * 3] = seed; seedA.array[k * 3 + 1] = share; seedA.array[k * 3 + 2] = f.gain ?? 1;
        }
      }
      geo.instanceCount = n * PER;
      fireA.needsUpdate = true;
      seedA.needsUpdate = true;
    },
  };
}
