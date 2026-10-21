/* Hedgerow — heat haze and shockwaves.

   A pass for `renderer.setEffects`, after the temporal anti-aliasing (a
   shimmer that changes every frame would only smear in its history) and
   before the focus and the bloom: it bends the finished image where hot
   air or a blast's pressure wave lies between the eye and what a pixel
   shows. Over each of the four nearest fires a column of hot air (four
   times the fire's size high, thinning upwards) shimmers with noise rising
   through it; a blast sends out a thin shell for half a second, seen edge-on
   as a ring that pushes the picture outwards as it races past. Each is
   found along the pixel's view ray against the scene depth, so a wall in
   front of a fire is not bent and the rifle in your hands never is (nor is
   it pulled into a neighbour's shimmer). Off when there is nothing near. */

import * as THREE from 'three';

const MAXF = 4, MAXS = 3;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
#define MAXF ${MAXF}
#define MAXS ${MAXS}
uniform sampler2D tSrc, tDepth;
uniform mat4 uProjInv, uViewInv, uViewProj;
uniform vec3 uCam;
uniform vec4 uFire[MAXF];
uniform int uFireN;
uniform vec4 uShock[MAXS];
uniform float uShockK[MAXS];
uniform int uShockN;
uniform float uTime, uNear;
varying vec2 vUv;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float dist(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  if (d >= 1.0) return 1e4;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return length(v.xyz / v.w);
}

void main() {
  float d = texture2D(tDepth, vUv).x;
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  v.xyz /= v.w;
  float T = d >= 1.0 ? 1e4 : length(v.xyz);
  vec3 dir = normalize(mat3(uViewInv) * v.xyz);
  vec2 off = vec2(0.0);
  if (T > uNear) {
    // hot air over the fires: where the ray passes closest to the column's axis
    for (int i = 0; i < MAXF; i++) {
      if (i >= uFireN) break;
      vec4 f = uFire[i];
      float r = 0.9 * f.w, hgt = 4.0 * f.w;
      vec2 o = uCam.xz - f.xz, dd = dir.xz;
      float a = dot(dd, dd);
      float t = a > 1e-6 ? -dot(o, dd) / a : 0.0;
      if (t <= 0.3 || t > T) continue;
      vec3 q = uCam + dir * t;
      float rad = length(q.xz - f.xz), y = q.y - f.y;
      if (rad > r || y < -0.2 || y > hgt) continue;
      float w = 1.0 - rad / r;
      w *= w * smoothstep(-0.2, 0.5, y) * (1.0 - smoothstep(hgt * 0.35, hgt, y));
      vec3 np = vec3(q.x * 2.2, q.y * 1.6 - uTime * 3.2, q.z * 2.2);
      off += (vec2(noise(np), noise(np + 17.3)) - 0.5) * w * 0.011 / (1.0 + t * 0.08);
    }
    // a blast's shell, seen edge-on as a ring racing outwards
    for (int i = 0; i < MAXS; i++) {
      if (i >= uShockN) break;
      vec4 s = uShock[i];
      vec3 L = s.xyz - uCam;
      float t0 = dot(L, dir);
      float h = sqrt(max(dot(L, L) - t0 * t0, 0.0));
      float band = 1.0 - smoothstep(0.0, 1.1, abs(h - s.w));
      if (band <= 0.0 || t0 - s.w > T || t0 + s.w < 0.0) continue;
      vec4 c = uViewProj * vec4(s.xyz, 1.0);
      if (c.w <= 0.0) continue;        // a blast behind the camera: no ring to see
      vec2 cuv = c.xy / c.w * 0.5 + 0.5;
      vec2 rd = vUv - cuv;
      rd /= max(length(rd), 1e-4);
      off += rd * band * uShockK[i] * 0.018 / (1.0 + max(t0, 0.0) * 0.04);
    }
  }
  vec2 uv = clamp(vUv + off, vec2(0.0), vec2(1.0));
  // never pull the rifle and the hands into a shimmer beside them
  if (off != vec2(0.0) && dist(uv) < uNear) uv = vUv;
  gl_FragColor = vec4(texture2D(tSrc, uv).rgb, 1.0);
}`;

export function createDistortion(camera, depth) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      tSrc: { value: null }, tDepth: { value: null },
      uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() }, uViewProj: { value: new THREE.Matrix4() },
      uCam: { value: new THREE.Vector3() },
      uFire: { value: Array.from({ length: MAXF }, () => new THREE.Vector4()) }, uFireN: { value: 0 },
      uShock: { value: Array.from({ length: MAXS }, () => new THREE.Vector4()) }, uShockK: { value: new Array(MAXS).fill(0) }, uShockN: { value: 0 },
      uTime: { value: 0 }, uNear: { value: 1.2 },
    },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const u = material.uniforms;
  const near = [];

  return {
    enabled: false, needsSwap: true, uniforms: u,
    /* this frame's fires (the four nearest burning within 35 m) and shockwaves (effects.js) */
    set(effects, cam, time) {
      near.length = 0;
      for (const f of effects.fires) {
        if (!f.on || f.far) continue;
        const d2 = (f.x - cam.x) ** 2 + (f.z - cam.z) ** 2;
        if (d2 < 35 * 35) near.push([d2, f]);
      }
      near.sort((a, b) => a[0] - b[0]);
      const nf = Math.min(MAXF, near.length);
      for (let i = 0; i < nf; i++) { const f = near[i][1]; u.uFire.value[i].set(f.x, f.y, f.z, f.size); }
      u.uFireN.value = nf;
      const ns = Math.min(MAXS, effects.shocks.length);
      for (let i = 0; i < ns; i++) {
        const s = effects.shocks[i];
        u.uShock.value[i].set(s.x, s.y, s.z, s.radius);
        u.uShockK.value[i] = s.strength;
      }
      u.uShockN.value = ns;
      u.uTime.value = time;
      this.enabled = nf + ns > 0;
    },
    render(renderer, writeBuffer, readBuffer) {
      camera.updateMatrixWorld();
      u.tSrc.value = readBuffer.texture;
      u.tDepth.value = depth();
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.uViewInv.value.copy(camera.matrixWorld);
      u.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      u.uCam.value.setFromMatrixPosition(camera.matrixWorld);
      renderer.setRenderTarget(writeBuffer);
      renderer.render(quad, ortho);
    },
  };
}
