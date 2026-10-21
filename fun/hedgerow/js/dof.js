/* Hedgerow — depth of field when aiming.

   A pass for `renderer.setEffects`, after the light in the rain and
   before the bloom (so the bloom of a soft lamp is soft too). While the soldier
   aims down his sights the background beyond the point under the
   crosshair goes soft, more the further it lies behind it (focus
   pulling, as a camera lens or the eye does); what is at the focus and in
   front of it stays sharp. The depth comes from the scene pass of the same
   frame (the first passes of the chain see it; this one borrows it). A
   16-tap golden-angle disc, each tap weighted by its own blur so a sharp
   soldier in front does not smear into the soft hedge behind him. Off
   (and free) when not aiming. */

import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
uniform sampler2D tSrc, tDepth;
uniform mat4 uProjInv;
uniform float uAim, uMaxPx;
uniform vec2 uTexel;
varying vec2 vUv;

float dist(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  if (d >= 1.0) return 1e4;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return length(v.xyz / v.w);
}
// blur in pixels for a point at distance d with the focus at f
float coc(float d, float f) { return clamp((d - f) / max(d, 1e-3) * 1.25, 0.0, 1.0) * uMaxPx * uAim; }

void main() {
  // the focus: what lies under the crosshair (a few taps, the nearest wins)
  float f = min(min(dist(vec2(0.5)), dist(vec2(0.5) + uTexel * vec2(6.0, 0.0))), dist(vec2(0.5) - uTexel * vec2(6.0, 0.0)));
  f = max(f, 2.0);
  vec3 c0 = texture2D(tSrc, vUv).rgb;
  float r0 = coc(dist(vUv), f);
  if (r0 < 0.5) { gl_FragColor = vec4(c0, 1.0); return; }
  vec3 sum = c0;
  float wsum = 1.0;
  for (int i = 0; i < 16; i++) {
    float t = (float(i) + 0.5) / 16.0;
    float a = float(i) * 2.39996323;
    vec2 o = vec2(cos(a), sin(a)) * sqrt(t) * r0 * uTexel;
    vec2 uv = vUv + o;
    // a tap counts as far as its own blur reaches this pixel
    float w = smoothstep(0.0, 1.0, coc(dist(uv), f) / max(r0 * sqrt(t), 1e-3));
    sum += texture2D(tSrc, uv).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, 1.0);
}`;

export function createDOF(camera) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      tSrc: { value: null }, tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() },
      uAim: { value: 0 }, uMaxPx: { value: 7 }, uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 768) },
    },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const u = material.uniforms;
  let depth = null;
  return {
    enabled: false, needsSwap: true, uniforms: u,
    /* this frame's scene depth (borrowed from the first pass) and how far the aim is in (0..1) */
    set(depthTexture, aim) {
      depth = depthTexture;
      u.uAim.value = aim;
      this.enabled = !!depthTexture && aim > 0.02;
    },
    setSize(w, h) {
      u.uTexel.value.set(1 / w, 1 / h);
      u.uMaxPx.value = 5 * h / 768;
    },
    render(renderer, writeBuffer, readBuffer) {
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.tSrc.value = readBuffer.texture;
      u.tDepth.value = depth;
      renderer.setRenderTarget(writeBuffer);
      renderer.render(quad, ortho);
    },
  };
}
