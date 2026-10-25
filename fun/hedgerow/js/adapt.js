/* Hedgerow — the eye adapting to the light.

   The exposure is set for the night: lamps, fires, the glow of the sky. A flare bursting over
   the fields lights the scene many times brighter, and held at the night's exposure every wet
   roof and the road ahead go white and the sky a flat grey, a snowy overcast day instead of a
   night lit by a flare. So the frame is metered - a pass for `renderer.setEffects`, just ahead of
   the grade, takes the median of the log of its luminance over a 32 x 18 grid of patches of
   sixteen samples each, the hands and the rifle at the bottom counting for half - and the exposure
   follows it as an eye does: closing down quickly when the view brightens, opening up again slowly
   when it darkens, never further open than the night's own (the dark stays dark), and holding
   still through a lightning stroke's flash (gone before an eye could follow it).

   Nothing of this comes back to the CPU. Reading the metered patches back blocked the main thread
   for 70-100 ms on Chrome's Metal backend (it waits for every frame still in flight, fence or no
   fence), a dozen times a minute: the frame's worst stalls by far. So the median is found on the
   GPU - a pass ranks every patch against all the others and the one the half-weight falls on is
   the median - and the eye's state (its factor, where it is heading, what it last metered) lives
   in a one-pixel texture that the grade (post.js) multiplies into the frame just before the tone
   mapping, which is where `toneMappingExposure` would have scaled it: the same product. The
   readback is kept only for the checks (`read()`), and stalls as it always did. */

import * as THREE from 'three';

const W = 32, H = 18;
const HALF_ROWS = Math.ceil(H * 0.28);       // the rows from the bottom that count for half: the hands and the rifle

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// each texel: the mean log2 luminance of its patch of the frame
const METER_FRAG = /* glsl */ `
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
  gl_FragColor = vec4(s / 16.0, 0.0, 0.0, 1.0);
}`;

/* each texel: its patch's value if that is the weighted median of all the patches (the first value,
   patches sorted by value, at which the weight so far reaches half the total), else far below any */
const RANK_FRAG = /* glsl */ `
uniform sampler2D tMeter;
void main() {
  float v = texelFetch(tMeter, ivec2(gl_FragCoord.xy), 0).r;
  float total = 0.0, below = 0.0, same = 0.0;
  for (int j = 0; j < ${H}; j++) {
    float w = j < ${HALF_ROWS} ? 0.5 : 1.0;
    for (int i = 0; i < ${W}; i++) {
      float u = texelFetch(tMeter, ivec2(i, j), 0).r;
      total += w;
      if (u < v) below += w; else if (u == v) same += w;
    }
  }
  float halfWeight = total * 0.5;   // (\`half\` itself is a word GLSL keeps)
  gl_FragColor = vec4(below < halfWeight && below + same >= halfWeight ? v : -1e9, 0.0, 0.0, 1.0);
}`;

/* the eye, one pixel: (factor, target, metered, whether anything was metered yet), eased each frame
   from the last frame's; on a fresh metering the median is read off the ranked patches */
const STATE_FRAG = /* glsl */ `
uniform sampler2D tRank, tPrev;
uniform float uDt, uFresh, uRetarget, uReset, uResetFactor, uRef, uK, uMin;
void main() {
  vec4 p = texelFetch(tPrev, ivec2(0), 0);
  float factor = p.r, target = p.g, metered = p.b, has = p.a;
  if (uReset > 0.5) { factor = uResetFactor; target = uResetFactor; }
  if (uReset > 1.5) { metered = 0.0; has = 0.0; }
  if (uFresh > 0.5) {
    float m = -1e9;
    for (int j = 0; j < ${H}; j++) for (int i = 0; i < ${W}; i++) m = max(m, texelFetch(tRank, ivec2(i, j), 0).r);
    if (m > -1e8) { metered = m; has = 1.0; }
  }
  if (has > 0.5 && uRetarget > 0.5) target = min(1.0, max(uMin, exp2(uK * (uRef - metered))));
  float tau = target < factor ? 0.45 : 2.5;
  factor += (target - factor) * (1.0 - exp(-uDt / tau));
  gl_FragColor = vec4(factor, target, metered, has);
}`;

function target(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
  });
}

/* base: the night's exposure; ref: the log2 luminance the night meters at its brightest (above it
   the exposure closes down: the lit street meters -5.3, the dark lane -6.2, the forest -6.8; beside
   the burning truck -4.2, the street under a flare -3.7); k: how far it follows (1: all the way back
   to the night's brightness); min: how far down it may close */
export function createAdaptation({ base = 1.7, ref = -5, k = 0.75, min = 0.35 } = {}) {
  const meter = target(W, H), rank = target(W, H), states = [target(1, 1), target(1, 1)];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  // (three compiles every shader as GLSL ES 3.00 on WebGL2, so texelFetch is at hand with the usual
  // varying/gl_FragColor spelling)
  const shader = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const meterMat = shader(METER_FRAG, { tSrc: { value: null } });
  const rankMat = shader(RANK_FRAG, { tMeter: { value: meter.texture } });
  const stateMat = shader(STATE_FRAG, {
    tRank: { value: rank.texture }, tPrev: { value: null },
    uDt: { value: 0 }, uFresh: { value: 0 }, uRetarget: { value: 0 }, uReset: { value: 2 }, uResetFactor: { value: 1 },
    uRef: { value: ref }, uK: { value: k }, uMin: { value: min },
  });
  const quad = new THREE.Mesh(geometry, meterMat);
  quad.frustumCulled = false;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // the eye before its first frame: wide open (a factor of one)
  const open = new THREE.DataTexture(new Float32Array([1, 1, 1, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  open.minFilter = open.magFilter = THREE.NearestFilter;
  open.needsUpdate = true;
  let frame = 0, current = -1, holdT = 0, dt = 0, flash = 0, lastRenderer = null;
  let primed = false, reset = 0;               // primed: metered once; reset: a check's own start, for one frame
  let factor = NaN, metered = NaN;             // the last values read back by read()

  const draw = (renderer, material, rt) => {
    quad.material = material;
    renderer.setRenderTarget(rt);
    renderer.render(quad, camera);
  };

  return {
    enabled: true, needsSwap: false,
    params: { base, ref, k, min },
    // metering on (main.js: in play, a second after it starts); behind the menu the night's exposure stands
    metering: false,
    setSize() {},
    // A day/night switch starts from an open eye and discards the old GPU metering state.
    reset({ base = this.params.base, ref = this.params.ref } = {}) {
      this.params.base = base;
      this.params.ref = ref;
      frame = 0; current = -1; holdT = dt = flash = 0; primed = false; reset = 0;
      factor = 1; metered = NaN;
      stateMat.uniforms.uResetFactor.value = 1;
    },
    /* the eye's state, for the grade: before the first frame, wide open */
    get texture() { return current < 0 ? open : states[current].texture; },
    render(renderer, writeBuffer, readBuffer) {
      lastRenderer = renderer;
      const u = stateMat.uniforms;
      u.uRef.value = this.params.ref;
      u.uK.value = this.params.k;
      u.uMin.value = this.params.min;
      // every sixth frame in play, and never in a flash of lightning: the patches, then their ranks
      const fresh = this.metering && flash <= 0.02 && ++frame % 6 === 0;
      if (fresh) {
        meterMat.uniforms.tSrc.value = readBuffer.texture;
        draw(renderer, meterMat, meter);
        draw(renderer, rankMat, rank);
      }
      // the eye, eased from last frame's state into the other pixel
      const next = current < 0 ? 0 : 1 - current;
      u.tPrev.value = current < 0 ? open : states[current].texture;
      u.uDt.value = dt;
      u.uFresh.value = fresh ? 1 : 0;
      u.uRetarget.value = holdT <= 0 ? 1 : 0;
      // until it has metered once the eye is written wide open every frame, so a draw taken out (the
      // shader warm-up runs the chain with the drawing stubbed) or lost leaves nothing stale behind
      u.uReset.value = primed ? reset : 2;
      draw(renderer, stateMat, states[next]);
      reset = 0;
      if (fresh) primed = true;
      current = next;
      dt = 0;
    },
    /* each frame, ahead of the render: the time to ease by, and flash: lightning now (0..1), which
       holds the exposure still for half a second */
    update(delta, renderer, flashNow = 0) {
      lastRenderer = renderer;
      if (flashNow > 0.02) holdT = 0.5;
      holdT -= delta;
      dt += delta;
      flash = flashNow;
    },
    /* the checks and the debug HUD: read the eye back (this waits on the GPU; the game never does).
       `median` is the weighted median worked out here from the metered patches, to compare with
       what the ranking found */
    read() {
      const renderer = lastRenderer;
      if (!renderer || current < 0) return Promise.resolve({ factor: NaN, target: NaN, metered: NaN, has: 0, median: NaN, exposure: NaN });
      const s = new Float32Array(4);
      renderer.readRenderTargetPixels(states[current], 0, 0, 1, 1, s);
      const m = new Float32Array(W * H * 4);
      renderer.readRenderTargetPixels(meter, 0, 0, W, H, m);
      const order = Array.from({ length: W * H }, (_, i) => i);
      order.sort((x, y) => m[x * 4] - m[y * 4]);
      const weight = (i) => Math.floor(i / W) < HALF_ROWS ? 0.5 : 1;
      let total = 0, half = 0, median = NaN;
      for (const i of order) total += weight(i);
      for (const i of order) { half += weight(i); if (half >= total * 0.5) { median = m[i * 4]; break; } }
      factor = s[0]; metered = s[3] > 0.5 ? s[2] : NaN;
      return Promise.resolve({ factor: s[0], target: s[1], metered, has: s[3], median, exposure: this.params.base * s[0] });
    },
    get metered() { return metered; },
    get factor() { return factor; },
    set factor(v) { factor = v; primed = true; reset = 1; stateMat.uniforms.uResetFactor.value = v; },     // (checks: start from a given exposure)
  };
}
