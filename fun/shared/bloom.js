/* Bloom, shared by the puzzle tables. The same pass as Meteora's, kept
   here so the puzzles do not reach into a game's internals.

   The scene renders into a half-float buffer (three's output buffer), so
   engine flames, bolts, fireballs and the sun keep their real brightness
   until the final tone mapping. This pass lets the brightest of it bleed
   into its surroundings the way it does in a lens: the image is cut above
   a soft threshold and shrunk through a chain of ever smaller targets with
   a wide filter, then grown back up with a tent filter, each level adding
   to the next (the bloom of Jimenez's "Next Generation Post Processing in
   Call of Duty: Advanced Warfare"). The result is added to the scene before
   three tone-maps it.

   The first shrink averages each 2 × 2 block weighted by 1 / (1 + luma),
   so a single white-hot pixel (a bolt's core, a star) does not flicker into
   a blob as it crosses pixel boundaries. */

import * as THREE from 'three';


const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform bool uFirst;
uniform vec3 uCurve;      // threshold − knee, 2 × knee, 0.25 / knee
uniform float uThreshold;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 s(vec2 o) { return texture2D(tSrc, vUv + uTexel * o).rgb; }
// A block's colour, weighted down by its brightness (Karis).
vec4 karis(vec3 c) { float w = 1.0 / (1.0 + luma(c)); return vec4(c * w, w); }

void main() {
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 col;
  if (uFirst) {
    vec4 sum = karis((j + k + l + m) * 0.25) * 0.5
      + karis((a + b + d + e) * 0.25) * 0.125 + karis((b + c + e + f) * 0.25) * 0.125
      + karis((d + e + g + h) * 0.25) * 0.125 + karis((e + f + h + i) * 0.25) * 0.125;
    col = sum.rgb / max(sum.a, 1e-4);
    // The soft threshold: a smooth knee instead of a hard cut.
    float br = max(col.r, max(col.g, col.b));
    float rq = clamp(br - uCurve.x, 0.0, uCurve.y);
    rq = uCurve.z * rq * rq;
    col *= max(rq, br - uThreshold) / max(br, 1e-4);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

const UP = /* glsl */ `
uniform sampler2D tSrc;    // the smaller level, already grown
uniform sampler2D tBase;   // this level, as it was shrunk
uniform vec2 uTexel;
uniform float uSpread;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + uTexel * o * uSpread).rgb; }
void main() {
  vec3 tent = (s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0)) + s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0))
    + 2.0 * (s(vec2(0.0, 1.0)) + s(vec2(-1.0, 0.0)) + s(vec2(1.0, 0.0)) + s(vec2(0.0, -1.0)))
    + 4.0 * s(vec2(0.0))) / 16.0;
  gl_FragColor = vec4(texture2D(tBase, vUv).rgb + tent, 1.0);
}`;

const MIX = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec4 scene = texture2D(tScene, vUv);
  gl_FragColor = vec4(scene.rgb + texture2D(tBloom, vUv).rgb * uStrength, scene.a);
}`;

const material = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
  vertexShader: VERTEX, fragmentShader, uniforms,
  depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
});

/* A pass for `renderer.setEffects`: it reads the HDR scene and writes the
   scene with its bloom into the next buffer. `strength` scales the glow,
   `threshold` is the brightness (in linear units, before exposure) where
   it starts, `knee` how softly, `spread` how far each level reaches.
   `resolutionScale` reduces just the glow buffers, keeping the scene sharp. */
// Five levels reach about a tenth of the screen; a sixth, a few pixels
// across, cost more GPU time than all the others on the GPUs we measured.
export function createBloom({ strength = 0.25, threshold = 1, knee = 0.7, spread = 1, levels = 5, resolutionScale = 1 } = {}) {
  const LEVELS = levels;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const quad = new THREE.Mesh(geometry);
  quad.frustumCulled = false;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const down = material(DOWN, {
    tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: false },
    uCurve: { value: new THREE.Vector3() }, uThreshold: { value: 0 },
  });
  const up = material(UP, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uSpread: { value: 1 } });
  const mix = material(MIX, { tScene: { value: null }, tBloom: { value: null }, uStrength: { value: strength } });

  const target = () => new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
  });
  const downs = Array.from({ length: LEVELS }, target);
  const ups = Array.from({ length: LEVELS - 1 }, target);

  const draw = (renderer, mat, out) => {
    quad.material = mat;
    renderer.setRenderTarget(out);
    renderer.render(quad, camera);
  };

  const pass = {
    enabled: true, needsSwap: true,
    setSize(width, height) {
      let w = width * resolutionScale, h = height * resolutionScale;
      for (let i = 0; i < LEVELS; i++) {
        w = Math.max(1, Math.round(w / 2)); h = Math.max(1, Math.round(h / 2));
        downs[i].setSize(w, h);
        if (i < LEVELS - 1) ups[i].setSize(w, h);
      }
    },
    render(renderer, writeBuffer, readBuffer) {
      const k = Math.max(1e-4, pass.knee);
      down.uniforms.uCurve.value.set(pass.threshold - k, 2 * k, 0.25 / k);
      down.uniforms.uThreshold.value = pass.threshold;
      up.uniforms.uSpread.value = pass.spread;
      // Shrink: the scene into the first level, each level into the next.
      let src = readBuffer.texture, srcW = readBuffer.width, srcH = readBuffer.height;
      for (let i = 0; i < LEVELS; i++) {
        down.uniforms.tSrc.value = src;
        down.uniforms.uTexel.value.set(1 / srcW, 1 / srcH);
        down.uniforms.uFirst.value = i === 0;
        draw(renderer, down, downs[i]);
        src = downs[i].texture; srcW = downs[i].width; srcH = downs[i].height;
      }
      // Grow back: each level adds the tent-filtered level below it.
      for (let i = LEVELS - 2; i >= 0; i--) {
        const smaller = i === LEVELS - 2 ? downs[LEVELS - 1] : ups[i + 1];
        up.uniforms.tSrc.value = smaller.texture;
        up.uniforms.tBase.value = downs[i].texture;
        up.uniforms.uTexel.value.set(1 / smaller.width, 1 / smaller.height);
        draw(renderer, up, ups[i]);
      }
      mix.uniforms.tScene.value = readBuffer.texture;
      mix.uniforms.tBloom.value = ups[0].texture;
      mix.uniforms.uStrength.value = pass.strength;
      draw(renderer, mix, writeBuffer);
    },
    strength, threshold, knee, spread,
    dispose() {
      for (const t of [...downs, ...ups]) t.dispose();
      for (const m of [down, up, mix]) m.dispose();
      geometry.dispose();
    },
  };
  return pass;
}

/* Whether this browser can render into half-float targets (and so keep the
   scene in HDR for the bloom). */
export function canRenderHalfFloat(gl) {
  return !!(gl && (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')));
}
