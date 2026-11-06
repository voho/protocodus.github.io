/* Meteora — bloom.

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
uniform sampler2D tWide;   // the smallest level: the light of the whole frame's bright things, spread wide
uniform sampler2D tDirt;
uniform float uStrength, uDirt, uAspect;
varying vec2 vUv;
void main() {
  vec4 scene = texture2D(tScene, vUv);
  // the dirt on the lens shows only where a bright light's glow falls across it; its texture is
  // square, laid over the middle of the frame and repeated out to the sides
  vec2 du = vec2((vUv.x - 0.5) * uAspect + 0.5, vUv.y);
  vec3 dirt = texture2D(tWide, vUv).rgb * texture2D(tDirt, du).r * uDirt;
  gl_FragColor = vec4(scene.rgb + texture2D(tBloom, vUv).rgb * uStrength + dirt, scene.a);
}`;

/* The lens's dirt: soft smudges, drops dried to rings, a few fine streaks, in one channel, made
   once (a seeded random, so it is the same every time). Black where the lens is clean. */
function lensDirt(size = 256) {
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const px = new Float32Array(size * size);
  const spot = (cx, cy, r, amp, ring) => {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(size - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(size - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d >= 1) continue;
      // a dried drop: faint inside, its edge where the grime gathered
      const body = 1 - d * d;
      px[y * size + x] += amp * (ring ? 0.35 * body + 0.65 * Math.exp(-((d - 0.85) ** 2) / 0.006) : body * body);
    }
  };
  for (let i = 0; i < 26; i++) spot(rnd() * size, rnd() * size, 18 + rnd() * 50, 0.08 + rnd() * 0.14, false);
  for (let i = 0; i < 70; i++) spot(rnd() * size, rnd() * size, 2 + rnd() * 9, 0.25 + rnd() * 0.5, rnd() < 0.6);
  for (let i = 0; i < 9; i++) {
    // a wiped streak: a line of tiny specks
    let x = rnd() * size, y = rnd() * size;
    const a = rnd() * Math.PI, n = 20 + rnd() * 40, amp = 0.15 + rnd() * 0.2;
    for (let k = 0; k < n; k++, x += Math.cos(a) * 1.5, y += Math.sin(a) * 1.5) spot(x, y, 1.6, amp, false);
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(Math.min(1, px[i]) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const material = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
  vertexShader: VERTEX, fragmentShader, uniforms,
  depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
});

/* A pass for `renderer.setEffects`: it reads the HDR scene and writes the
   scene with its bloom into the next buffer. `strength` scales the glow,
   `threshold` is the brightness (in linear units, before exposure) where
   it starts, `knee` how softly, `spread` how far each level reaches. */
// Five levels reach about a tenth of the screen; a sixth, a few pixels
// across, cost more GPU time than all the others on the GPUs we measured.
// `dirt`: how much the dirt on the lens catches the wide glow of bright lights (0: a clean lens).
export function createBloom({ strength = 0.25, threshold = 1, knee = 0.7, spread = 1, levels = 5, dirt = 0 } = {}) {
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
  const mix = material(MIX, {
    tScene: { value: null }, tBloom: { value: null }, tWide: { value: null }, tDirt: { value: lensDirt() },
    uStrength: { value: strength }, uDirt: { value: dirt }, uAspect: { value: 1 },
  });

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
      let w = width, h = height;
      for (let i = 0; i < LEVELS; i++) {
        w = Math.max(1, Math.round(w / 2)); h = Math.max(1, Math.round(h / 2));
        downs[i].setSize(w, h);
        if (i < LEVELS - 1) ups[i].setSize(w, h);
      }
      mix.uniforms.uAspect.value = width / Math.max(1, height);
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
      mix.uniforms.tWide.value = downs[LEVELS - 1].texture;
      mix.uniforms.uStrength.value = pass.strength;
      mix.uniforms.uDirt.value = pass.dirt;
      draw(renderer, mix, writeBuffer);
    },
    strength, threshold, knee, spread, dirt,
    dispose() {
      mix.uniforms.tDirt.value.dispose();
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
