/* Hedgerow — the eye adapting to the light.

   The exposure is set for the night: lamps, fires, the glow of the sky. A flare bursting over
   the fields lights the scene many times brighter, and held at the night's exposure every wet
   roof and the road ahead go white and the sky a flat grey, a snowy overcast day instead of a
   night lit by a flare. So the frame is metered - a pass for `renderer.setEffects`, just ahead of
   the grade, takes the median of the log of its luminance over a 32 x 18 grid of patches of
   sixteen samples each, the hands and the rifle at the bottom counting for half, and reads it
   back a few frames later without waiting on the GPU - and the exposure follows it as an eye
   does: closing down quickly when the view brightens, opening up again slowly when it darkens,
   never further open than the night's own (the dark stays dark), and holding still through a
   lightning stroke's flash (gone before an eye could follow it). */

import * as THREE from 'three';

const W = 32, H = 18;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// each texel: the mean log2 luminance of its patch of the frame, -16..8 in two bytes (red, green)
const FRAG = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() {
  vec2 cell = vec2(${W}.0, ${H}.0);
  vec2 base = floor(vUv * cell) / cell;
  float s = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec3 c = texture2D(tSrc, base + (vec2(float(i), float(j)) + 0.5) / (cell * 4.0)).rgb;
    s += log2(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5));
  }
  float v = clamp((s / 16.0 + 16.0) / 24.0, 0.0, 1.0) * 255.0;
  gl_FragColor = vec4(floor(v) / 255.0, fract(v), 0.0, 1.0);
}`;

/* base: the night's exposure; ref: the log2 luminance the night meters at its brightest (above it
   the exposure closes down: the lit street meters -5.3, the dark lane -6.2, the forest -6.8; beside
   the burning truck -4.2, the street under a flare -3.7); k: how far it follows (1: all the way back
   to the night's brightness); min: how far down it may close */
export function createAdaptation({ base = 1.7, ref = -5, k = 0.75, min = 0.35 } = {}) {
  const rt = new THREE.WebGLRenderTarget(W, H, {
    type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms: { tSrc: { value: null } },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const buf = new Uint8Array(W * H * 4), patches = new Float32Array(W * H * 2), order = Array.from({ length: W * H }, (_, i) => i);
  let frame = 0, pending = false, metered = null, target = 1, factor = 1, holdT = 0, stale = false;

  return {
    enabled: true, needsSwap: false,
    params: { base, ref, k, min },
    // metering on (main.js: in play, a second after it starts): the readback waits on the GPU, and
    // just after loading, while it is still busy taking up the textures and shaders, that held the
    // page for hundreds of milliseconds; behind the menu the night's exposure stands
    metering: false,
    setSize() {},
    render(renderer, writeBuffer, readBuffer) {
      if (!this.metering || pending || ++frame % 6) return;
      material.uniforms.tSrc.value = readBuffer.texture;
      renderer.setRenderTarget(rt);
      renderer.render(quad, camera);
      pending = true;
      stale = false;
      renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H, buf).then(() => {
        pending = false;
        if (stale) return;                       // taken in a flash of lightning
        // the median patch: the brightness of the field of view at large, not of the lights in it (a
        // fire or a lamp fills a few patches, a flare lifts them all)
        let n = 0;
        for (let j = 0; j < H; j++) {
          const w = j < H * 0.28 ? 0.5 : 1;      // row 0 is the bottom: the hands and the rifle
          for (let i = 0; i < W; i++) {
            const o = (j * W + i) * 4;
            patches[n * 2] = (buf[o] + buf[o + 1] / 255) / 255 * 24 - 16;
            patches[n * 2 + 1] = w;
            n++;
          }
        }
        order.sort((x, y) => patches[x * 2] - patches[y * 2]);
        let half = 0, total = 0;
        for (let i = 0; i < n; i++) total += patches[i * 2 + 1];
        for (const i of order) { half += patches[i * 2 + 1]; if (half >= total * 0.5) { metered = patches[i * 2]; break; } }
      }, () => { pending = false; });
    },
    /* each frame: the exposure eased towards what the last metering asks for; flash: lightning
       now (0..1) */
    update(dt, renderer, flash = 0) {
      const p = this.params;
      if (flash > 0.02) { holdT = 0.5; stale = true; }
      holdT -= dt;
      if (metered !== null && holdT <= 0) target = Math.min(1, Math.max(p.min, Math.pow(2, p.k * (p.ref - metered))));
      const tau = target < factor ? 0.45 : 2.5;
      factor += (target - factor) * (1 - Math.exp(-dt / tau));
      renderer.toneMappingExposure = p.base * factor;
    },
    get metered() { return metered; },
    get factor() { return factor; },
    set factor(v) { factor = target = v; },     // (checks: start from a given exposure)
  };
}
