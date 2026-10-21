/* Hedgerow — temporal anti-aliasing.

   Every frame the projection is shifted by a fraction of a pixel (eight
   steps of a Halton sequence: jitter() before the render, restore() after),
   so over a few frames each pixel sees its whole area; this pass, after the
   light in the rain, blends each frame into the history of the ones before.
   Where a pixel was last frame comes from the scene depth: its point in the
   world, seen with last frame's camera (the rifle and the hands — nearer
   than 1.2 m — move with the camera, so they are not moved). The history is
   held to the colours of the pixel's 3 x 3 neighbourhood this frame (a box
   round their mean, in luma and chroma), so what moved or appeared does not
   leave a trail, and bright and dark are blended by their weight in light
   (a lone glint does not flicker the whole pixel). What the wet cobbles'
   sparkle, the grass and the twigs shimmered with in motion settles; the
   fine grain of the occlusion, the reflections and the flare's shafts
   averages out. The rain, sparks and flashes are drawn after it (they would
   smear: effects.js, weather.js). */

import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const RESOLVE = /* glsl */ `
uniform sampler2D tSrc, tHistory, tDepth;
uniform mat4 uProjInv, uViewInv, uPrevViewProj;
uniform vec2 uTexel;
uniform float uReset, uNear, uBlend;
varying vec2 vUv;

vec3 ycocg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 rgb(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec3 cur = texture2D(tSrc, vUv).rgb;
  // this frame's neighbourhood: a box round its mean, no wider than its extremes
  vec3 m1 = vec3(0.0), m2 = vec3(0.0), lo = vec3(1e9), hi = vec3(-1e9);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 c = ycocg(texture2D(tSrc, vUv + vec2(float(i), float(j)) * uTexel).rgb);
    m1 += c; m2 += c * c; lo = min(lo, c); hi = max(hi, c);
  }
  m1 /= 9.0; m2 /= 9.0;
  vec3 sd = sqrt(max(m2 - m1 * m1, 0.0));
  vec3 bl = max(lo, m1 - 1.25 * sd), bh = min(hi, m1 + 1.25 * sd);
  // where this pixel was last frame
  float d = texture2D(tDepth, vUv).x;
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  v.xyz /= v.w;
  vec2 prev = vUv;
  if (d >= 1.0 || length(v.xyz) > uNear) {
    vec4 p = uPrevViewProj * (uViewInv * vec4(v.xyz, 1.0));
    prev = p.xy / p.w * 0.5 + 0.5;
  }
  float off = any(lessThan(prev, vec2(0.0))) || any(greaterThan(prev, vec2(1.0))) ? 1.0 : 0.0;
  vec3 hist = rgb(clamp(ycocg(texture2D(tHistory, prev).rgb), bl, bh));
  float a = max(max(uReset, off), uBlend);
  // weighed by light, so a lone bright glint does not flicker the pixel
  float wc = a / (1.0 + luma(cur)), wh = (1.0 - a) / (1.0 + luma(hist));
  gl_FragColor = vec4((cur * wc + hist * wh) / max(wc + wh, 1e-5), 1.0);
}`;

const COPY = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }`;

// Halton (2, 3): eight sub-pixel offsets in -0.5..0.5
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const JITTER = Array.from({ length: 8 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);

export function createTAA(camera, depth) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const resolve = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: RESOLVE,
    uniforms: {
      tSrc: { value: null }, tHistory: { value: null }, tDepth: { value: null },
      uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2(1, 1) }, uReset: { value: 1 }, uNear: { value: 1.2 }, uBlend: { value: 0.1 },
    },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const copy = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: COPY, uniforms: { tSrc: { value: null } }, depthTest: false, depthWrite: false, toneMapped: false });
  const quad = new THREE.Mesh(geometry, resolve);
  quad.frustumCulled = false;
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const opts = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
  const hist = [new THREE.WebGLRenderTarget(4, 4, opts), new THREE.WebGLRenderTarget(4, 4, opts)];
  for (const t of hist) t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
  const u = resolve.uniforms;
  let cur = 0, frame = 0, reset = true;
  let w = 4, h = 4;
  const base = new THREE.Matrix4(), baseInv = new THREE.Matrix4();
  const prevViewProj = new THREE.Matrix4(), lastPos = new THREE.Vector3(), pos = new THREE.Vector3();

  return {
    enabled: true, needsSwap: true, uniforms: u,
    /* start again (a cut: a teleport, the death camera) */
    reset() { reset = true; },
    /* before the render: shift the projection by this frame's sub-pixel step */
    jitter() {
      if (!this.enabled) return;
      base.copy(camera.projectionMatrix);
      baseInv.copy(camera.projectionMatrixInverse);
      const [jx, jy] = JITTER[frame++ % JITTER.length];
      camera.projectionMatrix.elements[8] += (jx * 2) / w;
      camera.projectionMatrix.elements[9] += (jy * 2) / h;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      // a jump of the camera is a cut
      camera.updateMatrixWorld();
      camera.getWorldPosition(pos);
      if (pos.distanceToSquared(lastPos) > 4) reset = true;
      lastPos.copy(pos);
    },
    /* after the render: the projection as it was; this frame's camera is next frame's last */
    restore() {
      if (!this.enabled) return;
      camera.projectionMatrix.copy(base);
      camera.projectionMatrixInverse.copy(baseInv);
      prevViewProj.multiplyMatrices(base, camera.matrixWorldInverse);
    },
    setSize(width, height) {
      w = width; h = height;
      for (const t of hist) t.setSize(width, height);
      u.uTexel.value.set(1 / width, 1 / height);
      reset = true;
    },
    render(renderer, writeBuffer, readBuffer) {
      const dt = depth();
      if (!dt) { reset = true; }
      u.tSrc.value = readBuffer.texture;
      u.tHistory.value = hist[cur].texture;
      u.tDepth.value = dt;
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.uViewInv.value.copy(camera.matrixWorld);
      u.uPrevViewProj.value.copy(prevViewProj);
      u.uReset.value = reset || !dt ? 1 : 0;
      reset = false;
      // resolve into the next history, then hand it on
      cur ^= 1;
      quad.material = resolve;
      renderer.setRenderTarget(hist[cur]);
      renderer.render(quad, ortho);
      copy.uniforms.tSrc.value = hist[cur].texture;
      quad.material = copy;
      renderer.setRenderTarget(writeBuffer);
      renderer.render(quad, ortho);
    },
  };
}
