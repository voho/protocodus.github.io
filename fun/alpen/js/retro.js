/* The look, in four passes.

   Late-nineties console constraints treated as an art direction, executed
   with a precision that hardware never had. The constraints are real ones and
   they are kept honestly; what is added on top is everything those machines
   would have done if they could.

   THE CONSTRAINTS

   Low-poly geometry, flat facets, vertex-lit colour bands and a five-bit
   dithered grade. The old version also imitated the output resolution of the
   hardware. This one does not: the world is rendered at the panel's native
   resolution (with a measured quality governor for fragile GPUs), so the
   mountain is crisp on any window while its forms and colour still belong to
   the era.

   Sixteen-bit colour: five bits a channel, through a 4×4 Bayer matrix. That
   is literally what the console did squeezing its framebuffer into R5G5B5,
   and the ordered dither is what those machines used to hide it. Without the
   dither a snowfield at five bits is a contour map; with it, it is grain,
   and the sky gets the stippled gradient that is half the signature.

   THE MODERN HALF

   A highlight shoulder, so lit snow rolls off towards white instead of
   clipping flat and losing every fold in it. Bloom, from a bright pass at a
   quarter resolution. And crepuscular rays, marched from each pixel towards
   the sun's position on screen through the same bright buffer — which is the
   one effect here that no machine of that era could have attempted and the
   one that most makes a low sun over a ridge look like weather.

   The bright extraction and rays stay at quarter resolution; the final
   composite is native. All of it happens *before* the quantise, so it is
   dithered down to five bits together and never looks like a modern effect
   pasted on top of an old picture. */

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
    vec2 uv = vUv;
    float weight = 1.0;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      uv -= delta;
      sum += texture2D(tBright, clamp(uv, 0.0, 1.0)).rgb * weight;
      weight *= uDecay;
    }
    gl_FragColor = vec4(sum * (uStrength / 16.0), 1.0);
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
  precision mediump float;
  uniform sampler2D tDiffuse;
  uniform sampler2D tBright;
  uniform sampler2D tRays;
  uniform vec3 uShadow;
  uniform vec3 uHighlight;
  uniform float uTint;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uVignette;
  uniform float uSpeedVignette;
  uniform float uLevels;
  uniform float uFade;
  uniform float uBlur;
  uniform float uAberration;
  uniform float uBloom;
  uniform float uRays;
  uniform float uShoulder;
  uniform vec2 uFocus;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 linearToSrgb(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }

  // Bayer, built rather than stored: bayer2 is the 2×2 matrix as a closed
  // form, and one recursion of it is the 4×4. Returns [0, 1). A const array
  // cannot be indexed dynamically in GLSL ES 1.0, which is why it is arithmetic.
  //
  // It is only ever handed a coordinate already folded into the pattern's own
  // period — see dither4() — and that is not tidiness, it is the difference
  // between a dither and a stripe. a.y * a.y at the top of a 4K frame is
  // 2160² ≈ 4.7 million, and mediump guarantees ten bits of mantissa: the
  // squaring throws away every bit that decides which row of the matrix this
  // is, so on any GPU that honours the qualifier — which is most mobile ones —
  // the pattern degenerates into horizontal bands exactly where the picture is
  // darkest and the dither matters most.
  float bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x * 0.5 + a.y * a.y * 0.75);
  }

  /* The 4×4 threshold for this pixel. Folding the coordinate first is exact
     rather than approximate: both terms of bayer2() are read through fract(),
     and both x·0.5 and y²·0.75 differ by a whole number between a coordinate
     and that coordinate plus four, so the value is identical to the unfolded
     one on hardware where the unfolded one still works at all. */
  float dither4(vec2 frag) {
    vec2 p = mod(frag, 4.0);
    return bayer2(p * 0.5) * 0.25 + bayer2(p);
  }

  vec3 sceneSample(vec2 uv) {
    uv = clamp(uv, vec2(0.001), vec2(0.999));
    // The speed treatment belongs to the world rushing past the rider, not to
    // the rider himself. A compact projected safe zone keeps the board, limbs
    // and landing pose readable while the periphery still separates into RGB.
    vec2 focusDelta = (uv - uFocus) * vec2(uResolution.x / uResolution.y, 1.0);
    float outsideFocus = smoothstep(0.075, 0.20, length(focusDelta));
    float aberration = uAberration * outsideFocus;
    if (aberration <= 0.00001) return texture2D(tDiffuse, uv).rgb;
    vec2 split = (uv - 0.5) * aberration;
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
       that is actually between them. And it happens before the quantise
       along with everything else, so it is dithered down to five bits with
       the rest of the frame instead of sitting on top of it looking modern. */
    float threshold = dither4(gl_FragCoord.xy);

    vec3 lin = sceneSample(vUv);
    vec2 focusDelta = (vUv - uFocus) * vec2(uResolution.x / uResolution.y, 1.0);
    float outsideFocus = smoothstep(0.08, 0.22, length(focusDelta));
    float localBlur = uBlur * outsideFocus;
    if (localBlur > 0.0005) {
      /* The ladder is jittered by the same Bayer value that quantises the
         frame at the bottom of this shader, and it is the difference between
         a smear and a row of ghosts.

         Six taps at fixed multiples of one step is six copies of the picture,
         and at full speed the last of them is more than twenty pixels from
         the first — so a tree at the edge of the frame does not blur, it
         arrives six times. Offsetting each tap by a sub-step fraction that
         changes per pixel fills the gaps between the copies with neighbouring
         pixels' copies, which is what an integral along the path would have
         done and what the eye reads as motion.

         The Bayer value is the right jitter to use rather than a hash of the
         coordinate: it is already computed for the quantise, it is uniform
         over every 4×4 block so no pixel is favoured, and being ordered it
         cannot beat against itself the way white noise sampled twice does. */
      vec2 toCentre = vec2(0.5) - vUv;
      for (int i = 1; i < 6; i++) {
        lin += sceneSample(vUv + toCentre * localBlur * (float(i) - 0.5 + threshold));
      }
      lin /= 6.0;
    }
    lin += texture2D(tBright, vUv).rgb * uBloom;
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
    c = mix(c, c * tint, uTint);
    c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
    l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = clamp(mix(vec3(l), c, uSaturation), 0.0, 1.0);

    // Vignette, measured on a square so it does not stretch on a wide screen
    vec2 d = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float edge = smoothstep(0.26, 0.95, dot(d, d) * 1.6);
    c *= 1.0 - min(0.78, uVignette + uSpeedVignette) * edge;
    c *= uFade;

    // Dither, then quantise to five bits. Doing it in this order is the whole
    // trick: the dither is what turns a contour into grain. Everything above
    // — the bloom, the rays, the shoulder — has already happened, so all of
    // it is squeezed into R5G5B5 together and none of it can look bolted on.
    float steps = uLevels - 1.0;
    c = floor(c * steps + threshold) / steps;

    gl_FragColor = vec4(c, 1.0);
  }
`;

/* A tint that multiplies without dimming: divided through by its own
   luminance, so `c * tint` keeps c's brightness and only moves its hue. */
function hueOnly(THREE, hex) {
  const c = new THREE.Color(hex);
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return l > 0.001 ? c.multiplyScalar(1 / l) : c;
}

export function createRetro(THREE, renderer) {
  const targetOpts = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    // Left in linear: the composite below does the one and only conversion,
    // so the grade happens in the space the eye reads and nothing double-
    // encodes on the way out
    colorSpace: THREE.LinearSRGBColorSpace,
  };

  /* No multisampling, deliberately. Every edge in this picture is a hard
     colour boundary between two flat facets, and that is the point of it —
     smoothing them produces intermediate colours the five-bit quantise then
     has to invent a dither pattern for, which reads as fringing rather than
     as an antialiased edge. The pixels are supposed to be visible. */
  const scene3d = new THREE.WebGLRenderTarget(BASE_W, BASE_H, targetOpts);
  const bright = new THREE.WebGLRenderTarget(BASE_W / 4, BASE_H / 4,
    { ...targetOpts, depthBuffer: false });
  const rays = new THREE.WebGLRenderTarget(BASE_W / 4, BASE_H / 4,
    { ...targetOpts, depthBuffer: false });
  // The other half of the ping-pong. A separable blur cannot read and write
  // the same attachment, and this is the cheapest surface in the frame.
  const blurTmp = new THREE.WebGLRenderTarget(BASE_W / 4, BASE_H / 4,
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
      tRays: { value: rays.texture },
      uShadow: { value: hueOnly(THREE, GRADE.shadowTint) },
      uHighlight: { value: hueOnly(THREE, GRADE.highlightTint) },
      uTint: { value: GRADE.tintStrength },
      uContrast: { value: GRADE.contrast },
      uSaturation: { value: GRADE.saturation },
      uVignette: { value: GRADE.vignette },
      uSpeedVignette: { value: 0 },
      uLevels: { value: GRADE.levels },
      uFade: { value: 1 },
      uBlur: { value: 0 },
      uAberration: { value: 0 },
      uBloom: { value: GRADE.bloom },
      uRays: { value: GRADE.rays },
      uShoulder: { value: GRADE.shoulder },
      uFocus: { value: new THREE.Vector2(0.5, 0.32) },
      uResolution: { value: new THREE.Vector2(BASE_W, BASE_H) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
  });

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

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  /* Full-window, native-resolution output.

     `displayWidth/Height` are the panel-sized backing store. The world targets
     normally match them exactly. On a struggling GPU only the world targets
     step down; the DOM-sized canvas still covers the whole visual viewport
     and the separate HUD remains native and sharp. A hard 4K pixel budget
     prevents a high-DPI desktop from accidentally asking for an 8K frame. */
  function resizeTargets() {
    width = Math.max(2, Math.round(displayWidth * scale));
    height = Math.max(2, Math.round(displayHeight * scale));

    scene3d.setSize(width, height);
    const bw = Math.max(1, Math.floor(width / 4));
    const bh = Math.max(1, Math.floor(height / 4));
    bright.setSize(bw, bh);
    rays.setSize(bw, bh);
    blurTmp.setSize(bw, bh);

    material.uniforms.uResolution.value.set(width, height);
    brightMat.uniforms.uTexel.value.set(1 / width, 1 / height);
    blurMat.uniforms.uTexel.value.set(1 / bw, 1 / bh);

    /* The canvas stays at the panel's own resolution whatever the world is
       doing, and that is the whole point of there being two numbers here.

       It used to take `scale` along with everything else, which quietly undid
       the thing the governor exists to protect. The composite is where the
       grade, the vignette and — the one that matters — the five-bit ordered
       dither happen, and a dither is a pattern locked to the pixel grid. Run
       it into a buffer at 70% and let the browser scale that up, and every
       2×2 Bayer cell is resampled across 1.4 pixels: the grain that was
       holding a snowfield together turns into a soft blotchy wash, which
       reads as the picture having gone out of focus rather than as it having
       lost resolution. The framebuffer was the thing under pressure, not the
       screen.

       So only the world targets step down. `tDiffuse` is then sampled with
       the same bilinear filter the browser was applying anyway — the upscale
       happens exactly once either way — and the dither, which costs nothing,
       lands on real device pixels. */
    renderer.setPixelRatio(1);
    renderer.setSize(displayWidth, displayHeight, false);
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
      resizeTargets();
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
    if (!active || dt <= 0 || dt > 0.1) return false;
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
    resizeTargets();
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
    material.uniforms.uFade.value = v;
  }

  /* Where the sun is on screen, in UV, and how much of it is getting through.
     `sky.js` owns that answer because it owns the sun; this only marches
     towards whatever it is told. Strength of zero skips the pass entirely. */
  function setSun(x, y, strength) {
    rayMat.uniforms.uSun.value.set(x, y);
    rayMat.uniforms.uStrength.value = strength;
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
     than creeping in across the whole speed range. */
  function setSpeed(speed) {
    const t = Math.min(1, Math.max(0,
      (speed - GRADE.blurFrom) / (GRADE.blurFull - GRADE.blurFrom)));
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
    setSun,
    setFocus,
    setSpeed,
    updatePerformance,
    get width() { return width; },
    get height() { return height; },
    get displayWidth() { return displayWidth; },
    get displayHeight() { return displayHeight; },
    get dpr() { return dpr; },
    get scale() { return scale; },
    get pixel() { return 1; },
    get blur() { return material.uniforms.uBlur.value; },
    get aberration() { return material.uniforms.uAberration.value; },
    get speedVignette() { return material.uniforms.uSpeedVignette.value; },
    get rayStrength() { return rayMat.uniforms.uStrength.value; },
  };
}
