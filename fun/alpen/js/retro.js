/* The Alpine post stack.

   The world and final composite render at native display resolution, with a
   measured quality governor for GPUs that cannot sustain it. Quarter-
   resolution bright extraction drives soft bloom and crepuscular rays. The
   native composite adds a highlight shoulder, atmospheric colour grade and
   speed-responsive peripheral motion while preserving full colour precision
   and smooth gradients. */

import { RENDER, GRADE, BASE_WIDTH, BASE_HEIGHT } from './config.js';

const BASE_W = BASE_WIDTH;
const BASE_H = BASE_HEIGHT;

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/* Pass one of the light: everything above the shoulder, at a quarter size,
   with the sun's own disc allowed through hardest. Four taps a fetch, so the
   downsample is a box filter rather than a point sample — point-sampling a
   bright pass is how you get bloom that crawls. */
const BRIGHT_FRAG = `
  precision mediump float;
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  uniform float uThreshold;
  varying vec2 vUv;

  void main() {
    vec3 c = texture2D(tDiffuse, vUv + vec2(-uTexel.x, -uTexel.y)).rgb
           + texture2D(tDiffuse, vUv + vec2( uTexel.x, -uTexel.y)).rgb
           + texture2D(tDiffuse, vUv + vec2(-uTexel.x,  uTexel.y)).rgb
           + texture2D(tDiffuse, vUv + vec2( uTexel.x,  uTexel.y)).rgb;
    c *= 0.25;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.35, l), 1.0);
  }
`;

/* Pass two: the rays. Sixteen steps from the fragment towards the sun's
   screen position, each one a shade dimmer and a shade closer, accumulating
   whatever the bright buffer had along the way. It is the oldest screen-space
   god-ray in the book and it is still the only one that costs nothing.

   `uSun` is in UV space and `uStrength` is zero whenever the sun is behind
   the camera, under the horizon or smothered by a storm — so the whole pass
   is skipped rather than fading, and there is no frame on which rays appear
   from a sun that is not there. */
const RAY_FRAG = `
  precision mediump float;
  uniform sampler2D tBright;
  uniform vec2 uSun;
  uniform vec3 uSunColor;
  uniform float uStrength;
  uniform float uDecay;
  uniform float uDensity;
  varying vec2 vUv;

  void main() {
    if (uStrength <= 0.001) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    vec2 delta = (vUv - uSun) * (uDensity / 16.0);
    /* The march starts a random fraction of one step in. Sixteen fixed steps
       turn every compact bright source into sixteen discrete ghosts of
       itself; a per-pixel offset fills the gaps between the ghosts with the
       neighbours' ghosts, which is what an integral along the shaft would
       have produced. Same interleaved-gradient trick as the composite. */
    float jitter = fract(52.9829189
      * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    vec2 uv = vUv - delta * jitter;
    float weight = 1.0;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      uv -= delta;
      /* Off-screen samples contribute nothing. Clamping them to the border
         re-reads the edge texel over and over, which accumulated into hard
         spokes anchored to the frame's edge whenever the sun sat near it. */
      float inside = step(abs(uv.x - 0.5), 0.5) * step(abs(uv.y - 0.5), 0.5);
      sum += texture2D(tBright, uv).rgb * (weight * inside);
      weight *= uDecay;
    }
    /* Tinted by the sun's own stop: rays are the sun's light in the air, so
       they follow it from white noon to amber dusk instead of carrying
       whatever hue the bright buffer happened to have. */
    gl_FragColor = vec4(sum * uSunColor * (uStrength / 16.0), 1.0);
  }
`;

/* The blur the bright pass never had.

   `BRIGHT_FRAG` is a four-tap box into a quarter-resolution buffer, and that
   is a downsample, not a blur — what came out was the shape of the bright
   parts of the picture with its edges quantised to four-pixel steps, and the
   composite then added it straight back on top of the sharp original. So a
   sunlit ridge did not glow; it wore a staircase. At 288 lines those steps
   were a fifth of a pixel and the whole question was moot, which is why this
   was never noticed: at native resolution they are four.

   Two separable five-tap passes, run on the quarter-res buffer where they
   cost a sixteenth of what they would at full size. The weights are the
   binomial [1 4 6 4 1] taken at ±1 and ±2 texels — but sampled at ±1.2 and
   ±3.0 rather than on the integers, so each fetch's own bilinear filter is
   doing half the work and five taps cover the support of nine.

   It runs before the ray march rather than after it, which is worth a
   sentence because it was the other way round in the first attempt. The
   rays march *through* this same buffer, so blurring first also softens
   them — and a crepuscular ray is a shaft of light through air, which is the
   one thing in the frame that has no business having a hard edge. */
const BLUR_FRAG = `
  precision mediump float;
  uniform sampler2D tBright;
  uniform vec2 uTexel;
  uniform vec2 uDir;
  varying vec2 vUv;
  void main() {
    vec2 d = uDir * uTexel;
    vec3 sum = texture2D(tBright, vUv).rgb * 0.382;
    sum += (texture2D(tBright, vUv + d * 1.2).rgb
          + texture2D(tBright, vUv - d * 1.2).rgb) * 0.242;
    sum += (texture2D(tBright, vUv + d * 3.0).rgb
          + texture2D(tBright, vUv - d * 3.0).rgb) * 0.067;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

const FRAG = `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform sampler2D tBright;
  uniform sampler2D tWide;
  uniform sampler2D tRays;
  uniform vec3 uShadow;
  uniform vec3 uHighlight;
  uniform float uTint;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uVignette;
  uniform float uSpeedVignette;
  uniform float uFade;
  uniform float uBlur;
  uniform float uAberration;
  uniform float uBloom;
  uniform float uBloomWide;
  uniform float uTime;
  uniform float uRays;
  uniform float uShoulder;
  uniform float uFall;
  uniform float uFallSeed;
  uniform vec2 uFocus;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 linearToSrgb(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }

  float fallHash(float n) {
    return fract(sin(n * 127.1 + uFallSeed * 311.7) * 43758.5453);
  }

  /* A handful of broad, irregular powder marks around the lens edge. Their
     centres are regenerated per fall but held still while they fade; moving
     screen-space snow would read as a UI animation, while real powder sticks
     for the beat after it reaches the glass. The centre stays deliberately
     empty so the rider and the next obstacle remain readable. */
  float lensSnow(vec2 uv) {
    vec2 p = uv - 0.5;
    p.x *= uResolution.x / uResolution.y;
    float snow = 0.0;
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      float angle = fallHash(fi + 1.3) * 6.2831853;
      float ring = mix(0.31, 0.64, fallHash(fi + 8.7));
      vec2 centre = vec2(cos(angle), sin(angle)) * ring;
      vec2 q = p - centre;
      float squeeze = mix(0.68, 1.42, fallHash(fi + 19.1));
      q = vec2(q.x * squeeze, q.y / squeeze);
      float radius = mix(0.022, 0.060, fallHash(fi + 31.4));
      float d = length(q);
      float core = 1.0 - smoothstep(radius * 0.24, radius, d);
      float halo = (1.0 - smoothstep(radius, radius * 1.75, d)) * 0.2;
      snow = max(snow, core * 0.82 + halo);
    }
    return clamp(snow, 0.0, 1.0);
  }

  // Interleaved gradient noise decorrelates the motion-blur taps without
  // imposing a visible repeating matrix on the finished image.
  float sampleJitter(vec2 frag) {
    return fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715))));
  }

  /* The speed treatment belongs to the world rushing past the rider, not to
     the rider himself. The focus mask that protects him is computed once in
     main() — it used to be re-derived inside this function on every one of
     the blur loop's taps, six lengths and six smoothsteps per pixel measuring
     the same distance — and the resolved aberration arrives as a parameter.
     Both the colour split and the blur now pivot on uFocus rather than the
     screen centre, so the world streams away from the rider rather than from
     a point above his head whenever the air moves him off-centre. */
  vec3 sceneSample(vec2 uv, float aberration) {
    uv = clamp(uv, vec2(0.001), vec2(0.999));
    if (aberration <= 0.00001) return texture2D(tDiffuse, uv).rgb;
    vec2 split = (uv - uFocus) * aberration;
    return vec3(
      texture2D(tDiffuse, clamp(uv + split, vec2(0.001), vec2(0.999))).r,
      texture2D(tDiffuse, uv).g,
      texture2D(tDiffuse, clamp(uv - split, vec2(0.001), vec2(0.999))).b
    );
  }

  void main() {
    /* Velocity blur, first and in linear light.

       Six taps along the vector from this fragment to the centre of the
       frame, which is where the run is going — so the middle of the picture,
       where the rider and the next thing to hit both are, stays sharp
       however fast it gets, and everything streaming past the edges smears.
       It is scaled by speed and off entirely below a speed the rider had to
       earn, because a blurred picture standing still is not speed, it is a
       smudge.

       Averaging happens here rather than after the transfer curve because
       linear is the only space where the mean of two colours is the colour
       that is actually between them. */
    /* The jitter drifts with time. A static per-pixel pattern under a moving
       scene reads as a dirty window the world slides behind; re-seeding it
       each frame turns the same decorrelation into invisible noise. */
    float jitter = sampleJitter(gl_FragCoord.xy + vec2(uTime * 61.0, uTime * 83.0));

    vec2 focusDelta = (vUv - uFocus) * vec2(uResolution.x / uResolution.y, 1.0);
    float outsideFocus = smoothstep(0.075, 0.20, length(focusDelta));
    float aberration = uAberration * outsideFocus;
    vec3 lin = sceneSample(vUv, aberration);
    float localBlur = uBlur * outsideFocus;
    if (localBlur > 0.0005) {
      /* The sample ladder is decorrelated per pixel, which is the difference
         between a continuous smear and a row of repeated ghosts.

         Six taps at fixed multiples of one step is six copies of the picture,
         and at full speed the last of them is more than twenty pixels from
         the first — so a tree at the edge of the frame does not blur, it
         arrives six times. Offsetting each tap by a sub-step fraction that
         changes per pixel fills the gaps between the copies with neighbouring
         pixels' copies, which is what an integral along the path would have
         done and what the eye reads as motion. */
      vec2 toFocus = uFocus - vUv;
      for (int i = 1; i < 6; i++) {
        lin += sceneSample(vUv + toFocus * localBlur * (float(i) - 0.5 + jitter), aberration);
      }
      lin /= 6.0;
    }
    lin += texture2D(tBright, vUv).rgb * uBloom;
    /* The second octave: the same light at a sixteenth of the resolution,
       blurred again. The tight pass above rims a bright ridge; this one is
       the wide, dim halo the air itself wears around a low sun — the part of
       a glow that a single small kernel can never reach. */
    lin += texture2D(tWide, vUv).rgb * uBloomWide;
    lin += texture2D(tRays, vUv).rgb * uRays;

    /* The highlight shoulder, applied in linear light where it belongs.

       Snow under a key light of any strength runs straight off the top of
       the scale, and a channel that has clipped is a channel with no shape
       left in it — which on a surface that fills most of the frame means the
       hill loses every fold it had and reads as a sheet of paper. This is
       the film answer: everything under the knee is untouched and the range
       above it is compressed asymptotically towards one, so a lit face keeps
       rolling and never quite arrives. */
    vec3 knee = min(lin, vec3(uShoulder));
    vec3 over = max(lin - vec3(uShoulder), vec3(0.0));
    lin = knee + (1.0 - uShoulder) * (over / (over + vec3(1.0 - uShoulder)));

    vec3 c = linearToSrgb(lin);

    // Grade: split-tone by luminance, then contrast about middle grey, then a
    // little saturation back on top of what the tone took out. Both tints
    // arrive normalised to luminance 1, so this shifts hue and nothing else —
    // a grade that darkens the picture is a bug, not a look.
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 tint = mix(uShadow, uHighlight, smoothstep(0.25, 0.85, l));
    vec3 tinted = c * tint;
    float tintedLuma = dot(tinted, vec3(0.2126, 0.7152, 0.0722));
    tinted *= l / max(tintedLuma, 0.001);
    c = mix(c, tinted, uTint);
    c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
    l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = clamp(mix(vec3(l), c, uSaturation), 0.0, 1.0);

    /* Impact shock and powder on the lens. The wash is intentionally short
       and mostly peripheral; camera motion supplies the violence while this
       supplies the material — cold, bright snow rather than a generic red
       damage flash. */
    float fall = clamp(uFall, 0.0, 1.0);
    if (fall > 0.001) {
      float powder = lensSnow(vUv);
      float mono = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, vec3(mono), fall * 0.16);
      c = mix(c, vec3(0.94, 0.975, 1.0), fall * 0.055);
      c = mix(c, vec3(0.91, 0.965, 1.0), powder * fall * 0.72);
    }

    // Vignette, measured on a square so it does not stretch on a wide screen
    vec2 d = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float edge = smoothstep(0.26, 0.95, dot(d, d) * 1.6);
    c *= 1.0 - min(0.78, uVignette + uSpeedVignette + fall * 0.1) * edge;
    c *= uFade;

    /* One temporal dither step before the 8-bit panel. Dusk fog, the night
       zenith and the storm's grey are long, nearly flat gradients, and a
       contrast-boosted 8-bit ramp steps visibly across them. Half an LSB of
       time-varying noise is below anything the eye can name and is exactly
       the amount that turns those contour lines back into gradient. */
    c += (jitter - 0.5) * (1.2 / 255.0);

    gl_FragColor = vec4(c, 1.0);
  }
`;

/* A tint that multiplies without dimming: divided through by its own
   luminance, so `c * tint` keeps c's brightness and only moves its hue. */
function normalizeHue(c) {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return l > 0.001 ? c.multiplyScalar(1 / l) : c;
}

function hueOnly(THREE, hex) {
  return normalizeHue(new THREE.Color(hex));
}

export function createRetro(THREE, renderer) {
  /* High dynamic range wherever the hardware allows it.

     An 8-bit scene target clamps the world's light at 1.0 before the post
     stack ever sees it, and that one clamp quietly disabled most of what the
     stack is for: the bright pass's threshold window runs to 1.13, so the
     sun's disc, a specular glint and a merely lit ridge all extracted the
     same; and the highlight shoulder had only 0.68..1.0 of range left to
     compress, so "snow runs off the top of the scale" was a comment, not a
     behaviour. Sixteen-bit float restores the scale's top. The extension is
     universal on real WebGL2 hardware; everything falls back to bytes —
     including MSAA, which some mobile GPUs refuse on float targets, checked
     per-format below rather than assumed. */
  const gl = renderer.getContext();
  const isWebGL2 = renderer.capabilities.isWebGL2;
  const hdr = isWebGL2
    && (renderer.extensions.has('EXT_color_buffer_float')
      || renderer.extensions.has('EXT_color_buffer_half_float'));

  const targetOpts = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    // Left in linear: the composite below does the one and only conversion,
    // so the grade happens in the space the eye reads and nothing double-
    // encodes on the way out
    colorSpace: THREE.LinearSRGBColorSpace,
  };

  const scene3d = new THREE.WebGLRenderTarget(BASE_W, BASE_H, targetOpts);
  // The scene renders offscreen, so context antialiasing alone cannot smooth
  // its silhouettes. Use conservative WebGL2 MSAA and fall back cleanly to an
  // ordinary target on WebGL1 or hardware that exposes no samples. The
  // sample count is asked of the actual internal format: RGBA16F multisample
  // support is a per-GPU fact, not a WebGL2 guarantee.
  let maxSamples = 0;
  if (isWebGL2) {
    const fmt = hdr ? gl.RGBA16F : gl.RGBA8;
    const supported = gl.getInternalformatParameter(gl.RENDERBUFFER, fmt, gl.SAMPLES);
    maxSamples = supported && supported.length ? supported[0] : 0;
  }
  scene3d.samples = Math.min(4, maxSamples);

  const bright = new THREE.WebGLRenderTarget(BASE_W / 4, BASE_H / 4,
    { ...targetOpts, depthBuffer: false });
  const rays = new THREE.WebGLRenderTarget(BASE_W / 4, BASE_H / 4,
    { ...targetOpts, depthBuffer: false });
  // The other half of the ping-pong. A separable blur cannot read and write
  // the same attachment, and this is the cheapest surface in the frame.
  const blurTmp = new THREE.WebGLRenderTarget(BASE_W / 4, BASE_H / 4,
    { ...targetOpts, depthBuffer: false });
  /* The wide bloom octave: a sixteenth of the resolution, so its pixels are
     a 256th of the frame's and the two passes over them are effectively
     free. The tight quarter-res kernel rims a ridge; this is the halo. */
  const wide = new THREE.WebGLRenderTarget(BASE_W / 16, BASE_H / 16,
    { ...targetOpts, depthBuffer: false });
  const wideTmp = new THREE.WebGLRenderTarget(BASE_W / 16, BASE_H / 16,
    { ...targetOpts, depthBuffer: false });

  const brightMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: scene3d.texture },
      uTexel: { value: new THREE.Vector2(1 / BASE_W, 1 / BASE_H) },
      uThreshold: { value: GRADE.bloomThreshold },
    },
    vertexShader: VERT,
    fragmentShader: BRIGHT_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const blurMat = new THREE.ShaderMaterial({
    uniforms: {
      tBright: { value: bright.texture },
      uTexel: { value: new THREE.Vector2(4 / BASE_W, 4 / BASE_H) },
      uDir: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: VERT,
    fragmentShader: BLUR_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const rayMat = new THREE.ShaderMaterial({
    uniforms: {
      tBright: { value: bright.texture },
      uSun: { value: new THREE.Vector2(0.5, 0.8) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uStrength: { value: 0 },
      uDecay: { value: GRADE.rayDecay },
      uDensity: { value: GRADE.rayDensity },
    },
    vertexShader: VERT,
    fragmentShader: RAY_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: scene3d.texture },
      tBright: { value: bright.texture },
      tWide: { value: wide.texture },
      tRays: { value: rays.texture },
      uShadow: { value: hueOnly(THREE, GRADE.shadowTint) },
      uHighlight: { value: hueOnly(THREE, GRADE.highlightTint) },
      uTint: { value: GRADE.tintStrength },
      uContrast: { value: GRADE.contrast },
      uSaturation: { value: GRADE.saturation },
      uVignette: { value: GRADE.vignette },
      uSpeedVignette: { value: 0 },
      uFade: { value: 1 },
      uBlur: { value: 0 },
      uAberration: { value: 0 },
      uBloom: { value: GRADE.bloom },
      uBloomWide: { value: GRADE.bloomWide },
      uTime: { value: 0 },
      uRays: { value: GRADE.rays },
      uShoulder: { value: GRADE.shoulder },
      uFall: { value: 0 },
      uFallSeed: { value: 0 },
      uFocus: { value: new THREE.Vector2(0.5, 0.32) },
      uResolution: { value: new THREE.Vector2(BASE_W, BASE_H) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const gradeShadow = new THREE.Color(GRADE.shadowTint);
  const gradeHighlight = new THREE.Color(GRADE.highlightTint);
  const gradeShadowTarget = new THREE.Color();
  const gradeHighlightTarget = new THREE.Color();
  const gradeWhite = new THREE.Color(0xffffff);

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const post = new THREE.Scene();
  post.add(quad);
  const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const passQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), brightMat);
  passQuad.frustumCulled = false;
  const passScene = new THREE.Scene();
  passScene.add(passQuad);
  let raysLive = false;

  let width = BASE_W;
  let height = BASE_H;
  let displayWidth = BASE_W;
  let displayHeight = BASE_H;
  let dpr = 1;
  let scale = RENDER.maxScale;
  let averageFrame = 1 / 60;
  let slowFor = 0;
  let fastFor = 0;
  let sized = false;
  let fallFx = 0;
  let fallHold = 0;
  let fadeTarget = 1;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  /* Full-window, native-resolution output.

     `displayWidth/Height` are the panel-sized backing store. The world targets
     normally match them exactly. On a struggling GPU only the world targets
     step down; the DOM-sized canvas still covers the whole visual viewport
     and the separate HUD remains native and sharp. A hard 4K pixel budget
     prevents a high-DPI desktop from accidentally asking for an 8K frame. */
  function resizeTargets(touchCanvas) {
    width = Math.max(2, Math.round(displayWidth * scale));
    height = Math.max(2, Math.round(displayHeight * scale));

    scene3d.setSize(width, height);
    const bw = Math.max(1, Math.floor(width / 4));
    const bh = Math.max(1, Math.floor(height / 4));
    bright.setSize(bw, bh);
    rays.setSize(bw, bh);
    blurTmp.setSize(bw, bh);
    const ww = Math.max(1, Math.floor(width / 16));
    const wh = Math.max(1, Math.floor(height / 16));
    wide.setSize(ww, wh);
    wideTmp.setSize(ww, wh);

    material.uniforms.uResolution.value.set(width, height);
    brightMat.uniforms.uTexel.value.set(1 / width, 1 / height);
    blurMat.uniforms.uTexel.value.set(1 / bw, 1 / bh);

    /* The canvas and final grade stay at the panel's resolution. On a slow
       GPU only the 3D and lighting targets step down, then `tDiffuse` is
       reconstructed once through linear sampling. HUD and final colour remain
       crisp while the governor reduces the part of the frame that is costly.

       The canvas itself is only touched when the display size genuinely
       changed. Three's `setSize` reassigns the backing store unconditionally,
       which clears the drawing buffer — and the governor calls this on the
       exact frame it already judged slow, so a scale step was paying for a
       canvas reallocation it never needed. */
    if (touchCanvas) {
      renderer.setPixelRatio(1);
      renderer.setSize(displayWidth, displayHeight, false);
    }
    renderer.setRenderTarget(rays);
    renderer.clear();
    renderer.setRenderTarget(null);
    raysLive = false;
    RENDER.buffer.width = width;
    RENDER.buffer.height = height;
  }

  function setSize(cssW, cssH) {
    const nextCssW = Math.max(1, cssW);
    const nextCssH = Math.max(1, cssH);
    const rawDpr = Math.min(RENDER.maxPixelRatio, window.devicePixelRatio || 1);
    const pixelBudget = RENDER.maxPixels || 3840 * 2160;
    const budgetDpr = Math.sqrt(pixelBudget / (nextCssW * nextCssH));
    const nextDpr = Math.max(0.5, Math.min(rawDpr, budgetDpr));
    const nextDisplayW = Math.max(2, Math.round(nextCssW * nextDpr));
    const nextDisplayH = Math.max(2, Math.round(nextCssH * nextDpr));

    if (!sized || nextDisplayW !== displayWidth
      || nextDisplayH !== displayHeight || nextDpr !== dpr) {
      dpr = nextDpr;
      displayWidth = nextDisplayW;
      displayHeight = nextDisplayH;
      resizeTargets(true);
      sized = true;
    }

    return {
      width,
      height,
      displayWidth,
      displayHeight,
      dpr,
      scale,
      pixel: 1,
    };
  }

  /* A conservative dynamic-resolution governor. It reacts to sustained frame
     pressure, never a single terrain refill, and walks in small enough steps
     that the change is not visible through motion. Returning true lets the
     diagnostics know the backing store changed; camera aspect is unchanged. */
  function updatePerformance(dt, active = true) {
    /* This is the one consumer that receives the *unclamped* frame delta —
       `main.js` caps the simulation dt at 0.05, and against that clamp a
       stall guard is unsatisfiable: a genuine stall arrives looking exactly
       like a heavy frame, and rejecting the ceiling instead disables the
       governor for any device sustainedly below 20 fps, which is precisely
       the device it exists for. With the real duration the two are
       distinguishable again: a quarter of a second is a tab switch or a GC
       pause and is ignored; anything under it is honest rendering load and
       feeds the average. */
    if (!active || dt <= 0 || dt > 0.25) return false;
    averageFrame += (dt - averageFrame) * (1 - Math.exp(-dt * 2.5));

    if (averageFrame > 1 / 48) {
      slowFor += dt;
      fastFor = Math.max(0, fastFor - dt * 2);
    } else if (averageFrame < 1 / 57) {
      fastFor += dt;
      slowFor = Math.max(0, slowFor - dt);
    } else {
      slowFor = Math.max(0, slowFor - dt * 0.5);
      fastFor = Math.max(0, fastFor - dt * 0.5);
    }

    let next = scale;
    if (slowFor > 1.6 && scale > RENDER.minScale) {
      next = Math.max(RENDER.minScale, Math.round((scale - 0.1) * 20) / 20);
    } else if (fastFor > 6 && scale < RENDER.maxScale) {
      next = Math.min(RENDER.maxScale, Math.round((scale + 0.05) * 20) / 20);
    }
    if (next === scale) return false;

    scale = next;
    slowFor = 0;
    fastFor = 0;
    resizeTargets(false);
    return true;
  }

  function render(worldScene, worldCamera) {
    renderer.setRenderTarget(scene3d);
    renderer.clear();
    renderer.render(worldScene, worldCamera);

    // Bright pass, blur, then the march. All three stay at quarter resolution
    // while the scene and the final composite remain native.
    passQuad.material = brightMat;
    renderer.setRenderTarget(bright);
    renderer.render(passScene, flat);

    // Across, then down, and back into `bright` so everything downstream —
    // the march and the composite — reads one buffer and neither has to know
    // this happened.
    passQuad.material = blurMat;
    blurMat.uniforms.tBright.value = bright.texture;
    blurMat.uniforms.uDir.value.set(1, 0);
    renderer.setRenderTarget(blurTmp);
    renderer.render(passScene, flat);
    blurMat.uniforms.tBright.value = blurTmp.texture;
    blurMat.uniforms.uDir.value.set(0, 1);
    renderer.setRenderTarget(bright);
    renderer.render(passScene, flat);

    /* The halo octave. The first pass reads the finished quarter-res bloom
       into a buffer a quarter smaller again in each direction — its own
       bilinear minification is the downsample — and the second blurs across
       it. Both passes touch a 256th of the frame's pixels; the texel the
       kernel is measured in is four times as wide, so the same five taps
       reach four times as far. */
    const ww = Math.max(1, Math.floor(width / 16));
    const wh = Math.max(1, Math.floor(height / 16));
    blurMat.uniforms.tBright.value = bright.texture;
    blurMat.uniforms.uTexel.value.set(1 / ww, 1 / wh);
    blurMat.uniforms.uDir.value.set(1, 0);
    renderer.setRenderTarget(wideTmp);
    renderer.render(passScene, flat);
    blurMat.uniforms.tBright.value = wideTmp.texture;
    blurMat.uniforms.uDir.value.set(0, 1);
    renderer.setRenderTarget(wide);
    renderer.render(passScene, flat);
    // Restore the quarter-res texel for next frame's tight pair.
    blurMat.uniforms.uTexel.value.set(
      1 / Math.max(1, Math.floor(width / 4)),
      1 / Math.max(1, Math.floor(height / 4)),
    );

    if (rayMat.uniforms.uStrength.value > 0.001) {
      passQuad.material = rayMat;
      renderer.setRenderTarget(rays);
      renderer.render(passScene, flat);
      raysLive = true;
    } else if (raysLive) {
      renderer.setRenderTarget(rays);
      renderer.clear();
      raysLive = false;
    }

    renderer.setRenderTarget(null);
    renderer.render(post, flat);
  }

  /* Used to dip the whole picture behind a menu, so the game reads as
     paused rather than as stopped. */
  function fade(v) {
    fadeTarget = Math.min(1, Math.max(0, v));
  }

  /* One impact pulse, weighted by the same 0..1 severity as the crash mix.
     A small floor keeps a slow spill legible; the quick hold catches at least
     a few frames on a fast display before the exponential decay begins. */
  function crash(strength = 1) {
    const s = Math.min(1, Math.max(0, strength));
    const motion = reducedMotion ? 0.62 : 1;
    // Powder already on the glass stays where it landed: re-rolling the seed
    // while the last overlay is still fading teleported all seven marks to
    // new positions mid-fade. A fresh pattern only arrives on a clean lens.
    if (fallFx < 0.06) material.uniforms.uFallSeed.value = Math.random() * 97;
    fallFx = Math.max(fallFx, (0.22 + s * 0.78) * motion);
    fallHold = Math.max(fallHold, 0.055 + s * 0.055);
    material.uniforms.uFall.value = fallFx;
  }

  function updateEffects(dt, active = true) {
    if (dt <= 0) return;
    /* Menu dimming is part of the picture, not a state switch. It keeps
       advancing while simulation is paused; `main.js` renders those few
       settling frames and then returns to the single frozen pause frame. */
    const fadeNow = material.uniforms.uFade.value;
    const fadeNext = fadeNow + (fadeTarget - fadeNow) * (1 - Math.exp(-13 * dt));
    material.uniforms.uFade.value = Math.abs(fadeTarget - fadeNext) < 0.001
      ? fadeTarget : fadeNext;
    /* The lens snow is a lens fact too, for the same reason as the fade —
       and a wipeout is exactly when a player reaches for Escape. Decayed
       only while active, the full-strength powder wash froze on the glass
       the moment the game paused and sat over the pause menu (and the
       resumed run) indefinitely. */
    if (fallHold > 0) {
      fallHold = Math.max(0, fallHold - dt);
    } else if (fallFx > 0) {
      fallFx *= Math.exp(-2.65 * dt);
      if (fallFx < 0.002) fallFx = 0;
    }
    material.uniforms.uFall.value = fallFx;
    if (!active) return;
    // The dither's clock. Wrapped well inside float precision; the exact
    // period is irrelevant, only that consecutive frames differ.
    material.uniforms.uTime.value = (material.uniforms.uTime.value + dt) % 64;
  }

  /* Where the sun is on screen, in UV, and how much of it is getting through.
     `sky.js` owns that answer because it owns the sun; this only marches
     towards whatever it is told. Strength of zero skips the pass entirely. */
  function setSun(x, y, strength, color) {
    rayMat.uniforms.uSun.value.set(x, y);
    rayMat.uniforms.uStrength.value = strength;
    // The sun's own stop, straight from the weather — so the shafts follow
    // it from white noon to amber dusk without owning a colour of their own.
    if (color) rayMat.uniforms.uSunColor.value.copy(color);
  }

  /* The split tone belongs to the atmosphere it is grading. A fixed cobalt
     multiplier stacked on the lee-side albedo, hemisphere fill and terrain
     shadow, so clear-day walls went navy while dusk painted every surface
     magenta. Derive two quiet hues from the live sky/key and let the strength
     fall at low sun and in weather. The weather itself is continuous, and the
     short exponential here also makes debug/pause time moves glide. */
  function setGrade(w, dt = 1 / 60) {
    gradeShadowTarget.copy(w.mid).lerp(gradeWhite, 0.55);
    gradeHighlightTarget.copy(w.key).lerp(gradeWhite, 0.80);
    normalizeHue(gradeShadowTarget);
    normalizeHue(gradeHighlightTarget);

    const elevationRaw = Math.min(1, Math.max(0, (w.elevation - 0.08) / 0.38));
    const elevation = elevationRaw * elevationRaw * (3 - 2 * elevationRaw);
    const daylight = 0.11 + 0.09 * elevation;
    const clearStrength = daylight + (0.13 - daylight) * w.night;
    const stormRaw = Math.min(1, Math.max(0, w.storm));
    const storm = stormRaw * stormRaw * (3 - 2 * stormRaw);
    const targetStrength = Math.min(
      GRADE.tintStrength,
      clearStrength + (0.06 - clearStrength) * storm,
    );
    const alpha = dt <= 0 ? 1 : 1 - Math.exp(-6 * dt);
    gradeShadow.lerp(gradeShadowTarget, alpha);
    gradeHighlight.lerp(gradeHighlightTarget, alpha);
    material.uniforms.uShadow.value.copy(gradeShadow);
    material.uniforms.uHighlight.value.copy(gradeHighlight);
    material.uniforms.uTint.value += (targetStrength - material.uniforms.uTint.value) * alpha;
  }

  /* Projected centre of the rider. Keeping this dynamic matters in the air,
     where the chase framing opens and the body moves through the lower third
     of the picture rather than sitting at a fixed HUD coordinate. */
  function setFocus(x, y) {
    material.uniforms.uFocus.value.set(
      Math.min(0.95, Math.max(0.05, x)),
      Math.min(0.95, Math.max(0.05, y)),
    );
  }

  /* How fast the run is, so the velocity blur knows whether it has been
     earned. Squared, so it arrives late and then arrives properly rather
     than creeping in across the whole speed range — and never saturating, so
     it keeps answering a rider who is still accelerating. */
  function setSpeed(speed) {
    // Asymptotic rather than clamped — see `GRADE.blurSpan`. One `blurSpan`
    // past `blurFrom` is halfway, and nothing ever finishes arriving.
    const over = Math.max(0, speed - GRADE.blurFrom);
    const t = over / (over + GRADE.blurSpan);
    const eased = t * t * (3 - 2 * t);
    const motion = reducedMotion ? 0.35 : 1;
    material.uniforms.uBlur.value = eased * eased * GRADE.blurAmount * motion;
    material.uniforms.uAberration.value = Math.pow(eased, 1.35)
      * GRADE.aberration * motion;
    material.uniforms.uSpeedVignette.value = Math.pow(eased, 1.2)
      * GRADE.speedVignette;
  }

  return {
    setSize,
    render,
    fade,
    crash,
    updateEffects,
    setSun,
    setGrade,
    setFocus,
    setSpeed,
    updatePerformance,
    get width() { return width; },
    get height() { return height; },
    get displayWidth() { return displayWidth; },
    get displayHeight() { return displayHeight; },
    get dpr() { return dpr; },
    get scale() { return scale; },
    get samples() { return scene3d.samples; },
    get pixel() { return 1; },
    get blur() { return material.uniforms.uBlur.value; },
    get aberration() { return material.uniforms.uAberration.value; },
    get speedVignette() { return material.uniforms.uSpeedVignette.value; },
    get rayStrength() { return rayMat.uniforms.uStrength.value; },
    get fallEffect() { return material.uniforms.uFall.value; },
    get animating() {
      // Both lens facts: the menu dim, and any crash powder still clearing
      // off the glass. `main.js` keeps rendering paused frames while either
      // is moving, then settles on the single frozen pause frame.
      return Math.abs(fadeTarget - material.uniforms.uFade.value) >= 0.001
        || fallFx > 0;
    },
    // Kept for diagnostics compatibility now that AO is a neutral input.
    get aoStrength() { return 0; },
  };
}
