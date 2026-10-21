/* Hedgerow — camera motion blur.

   A pass for `renderer.setEffects`, after the temporal anti-aliasing and
   before the late particles and the rain (they stay crisp): as the view
   turns or moves, each pixel is smeared along the way it moved on screen
   since the last frame — where it was then comes from the scene depth seen
   with last frame's camera, as in taa.js — over half the frame's time (a
   180-degree shutter), at most 28 pixels at 768 high, in eight taps. The
   rifle and the hands (nearer than 1.2 m) move with the camera and stay
   sharp, and no tap reads them, so they are not smeared into the street
   behind them. Skipped when the view barely moves, and on a cut (a jump of
   the camera, a turn of more than 20 degrees in one frame). */

import * as THREE from 'three';

const N = 8;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
#define N ${N}
uniform sampler2D tSrc, tDepth;
uniform mat4 uProjInv, uViewInv, uPrevViewProj;
uniform vec2 uTexel;
uniform float uShutter, uMaxPx, uNear;
varying vec2 vUv;

float distAt(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  if (d >= 1.0) return 1e4;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return length(v.xyz / v.w);
}

void main() {
  vec3 c0 = texture2D(tSrc, vUv).rgb;
  float d = texture2D(tDepth, vUv).x;
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  v.xyz /= v.w;
  // the rifle and the hands move with the camera
  if (d < 1.0 && length(v.xyz) < uNear) { gl_FragColor = vec4(c0, 1.0); return; }
  vec4 p = uPrevViewProj * (uViewInv * vec4(v.xyz, 1.0));
  vec2 vel = (vUv - (p.xy / p.w * 0.5 + 0.5)) * uShutter;
  float len = length(vel / uTexel);
  if (p.w <= 0.0 || len < 0.75) { gl_FragColor = vec4(c0, 1.0); return; }
  vel *= min(1.0, uMaxPx / len);
  vec3 sum = c0;
  float wsum = 1.0;
  for (int i = 0; i < N; i++) {
    vec2 uv = vUv + vel * ((float(i) + 0.5) / float(N) - 0.5);
    if (distAt(uv) < uNear) continue;
    sum += texture2D(tSrc, uv).rgb;
    wsum += 1.0;
  }
  gl_FragColor = vec4(sum / wsum, 1.0);
}`;

export function createMotionBlur(camera, depth, { shutter = 0.5 } = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      tSrc: { value: null }, tDepth: { value: null },
      uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 768) },
      uShutter: { value: shutter }, uMaxPx: { value: 28 }, uNear: { value: 1.2 },
    },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const u = material.uniforms;
  const prevQ = new THREE.Quaternion(), prevPos = new THREE.Vector3(), q = new THREE.Quaternion(), pos = new THREE.Vector3();
  const viewProj = new THREE.Matrix4();
  let have = false, on = true;

  return {
    enabled: false, needsSwap: true, uniforms: u,
    /* on or off (quality); each frame, before the render: is the view moving enough to blur? */
    setOn(v) { on = v; if (!v) this.enabled = false; },
    update() {
      camera.updateMatrixWorld();
      camera.getWorldQuaternion(q);
      camera.getWorldPosition(pos);
      const turn = have ? 2 * Math.acos(Math.min(1, Math.abs(q.dot(prevQ)))) : 0;
      const move = have ? pos.distanceTo(prevPos) : 0;
      // a cut: start again; barely moving: nothing to blur
      this.enabled = on && have && turn < 0.35 && move < 2 && (turn > 0.0015 || move > 0.005);
      have = true;
    },
    setSize(w, h) {
      u.uTexel.value.set(1 / w, 1 / h);
      u.uMaxPx.value = 28 * h / 768;
    },
    render(renderer, writeBuffer, readBuffer) {
      u.tSrc.value = readBuffer.texture;
      u.tDepth.value = depth();
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.uViewInv.value.copy(camera.matrixWorld);
      u.uPrevViewProj.value.copy(viewProj);
      renderer.setRenderTarget(writeBuffer);
      renderer.render(quad, ortho);
    },
    /* after the render: this frame's camera is next frame's last */
    store() {
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      prevQ.copy(q); prevPos.copy(pos);
    },
  };
}
