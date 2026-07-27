/* The look, in four passes.

   Late-nineties console constraints treated as an art direction, executed
   with a precision that hardware never had. The constraints are real ones and
   they are kept honestly; what is added on top is everything those machines
   would have done if they could.

   THE CONSTRAINTS

   A 640×360 framebuffer, scaled to the window by an integer and nothing else,
   so every pixel on screen is a hard square of exactly the same size. That
   integer is the whole discipline: a fractional scale resamples, and a
   resampled pixel is a blurry pixel, which is the one thing this look cannot
   survive. The buffer is allowed to grow past 640×360 to fill a window that
   is not sixteen by nine — what is fixed is the *size of a pixel*, not the
   count of them, because letterboxing a game to protect a number is the
   wrong trade.

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

   Both of those cost three extra draws at a quarter of a very small buffer,
   which is nothing, and both happen *before* the quantise — so they are
   dithered down to five bits along with everything else and never look like
   a modern effect pasted on top of an old picture. That ordering is the
   whole trick, and it is the difference between this and a filter. */

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
  uniform float uLevels;
  uniform float uFade;
  uniform float uBlur;
  uniform float uBloom;
  uniform float uRays;
  uniform float uShoulder;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 linearToSrgb(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }

  // Bayer, built rather than stored: bayer2 is the 2×2 matrix as a closed
  // form, and one recursion of it is the 4×4. Returns [0, 1). A const array
  // cannot be indexed dynamically in GLSL ES 1.0, which is why it is arithmetic.
  float bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x * 0.5 + a.y * a.y * 0.75);
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
    vec3 lin = texture2D(tDiffuse, vUv).rgb;
    if (uBlur > 0.0005) {
      vec2 toCentre = vec2(0.5) - vUv;
      for (int i = 1; i < 6; i++) {
        lin += texture2D(tDiffuse, vUv + toCentre * uBlur * float(i)).rgb;
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
    c *= 1.0 - uVignette * smoothstep(0.30, 0.95, dot(d, d) * 1.6);
    c *= uFade;

    // Dither, then quantise to five bits. Doing it in this order is the whole
    // trick: the dither is what turns a contour into grain. Everything above
    // — the bloom, the rays, the shoulder — has already happened, so all of
    // it is squeezed into R5G5B5 together and none of it can look bolted on.
    vec2 p = gl_FragCoord.xy;
    float threshold = bayer2(p * 0.5) * 0.25 + bayer2(p);
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
      uLevels: { value: GRADE.levels },
      uFade: { value: 1 },
      uBlur: { value: 0 },
      uBloom: { value: GRADE.bloom },
      uRays: { value: GRADE.rays },
      uShoulder: { value: GRADE.shoulder },
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

  let width = BASE_W;
  let height = BASE_H;
  let pixel = 1;      // device pixels per game pixel — always a whole number

  /* Fitting the window without ever resampling.

     The pixel size is chosen first: the largest whole number of device pixels
     that still leaves at least a 640×360 picture. The buffer is then whatever
     that pixel size divides the window into, which is how a 21:9 monitor gets
     more mountain rather than black bars down the sides, and a phone held
     upright gets a taller picture rather than a squashed one. Since the
     canvas backing store and the element differ by exactly `pixel` device
     pixels in each axis, the browser's nearest-neighbour upscale lands every
     texel on a perfect square and nothing is ever interpolated.

     The old version fixed the height at 288 lines and capped the width, which
     stretched the picture on any screen that was not roughly sixteen by nine
     — seven per cent on an ultrawide and twenty on a phone. Choosing the
     pixel and deriving the buffer is what fixes that without giving up the
     hard pixel that the whole look depends on. */
  function setSize(cssW, cssH) {
    const dpr = Math.min(RENDER.maxPixelRatio, window.devicePixelRatio || 1);
    const devW = Math.max(1, Math.round(cssW * dpr));
    const devH = Math.max(1, Math.round(cssH * dpr));
    /* The base picture chooses the pixel size and then has no further say.

       It used to floor the buffer as well — `max(BASE_W, ceil(devW / pixel))`
       — on the reasoning that the picture should never be coarser than the
       shape it was designed against. That is a promise that cannot be kept
       on a narrow window and it broke the one that matters: a phone held
       upright is 420 device pixels wide, the floor forced a 640-wide buffer
       into it, and the browser stretched the result across the screen at 52%
       horizontal distortion. Which is precisely the bug this whole rewrite
       exists to fix, reintroduced from the other end.

       So the buffer is exactly what the chosen pixel divides the window into,
       always, and the aspect ratio is therefore correct by construction. On a
       display too small for even a 1:1 pixel to leave 640×360 the picture is
       simply finer than the art direction intends, which is the honest
       outcome and is invisible next to the alternative. */
    pixel = Math.max(1, Math.floor(Math.min(devW / BASE_W, devH / BASE_H)));
    width = Math.max(2, Math.ceil(devW / pixel));
    height = Math.max(2, Math.ceil(devH / pixel));

    scene3d.setSize(width, height);
    const bw = Math.max(1, Math.floor(width / 4));
    const bh = Math.max(1, Math.floor(height / 4));
    bright.setSize(bw, bh);
    rays.setSize(bw, bh);

    material.uniforms.uResolution.value.set(width, height);
    brightMat.uniforms.uTexel.value.set(1 / width, 1 / height);

    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    RENDER.buffer.width = width;
    RENDER.buffer.height = height;
    return { width, height, pixel };
  }

  function render(worldScene, worldCamera) {
    renderer.setRenderTarget(scene3d);
    renderer.clear();
    renderer.render(worldScene, worldCamera);

    // Bright pass, then the march. Both at a quarter of an already small
    // buffer, which is why two extra full-screen passes cost nothing.
    passQuad.material = brightMat;
    renderer.setRenderTarget(bright);
    renderer.render(passScene, flat);

    passQuad.material = rayMat;
    renderer.setRenderTarget(rays);
    renderer.render(passScene, flat);

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

  /* How fast the run is, so the velocity blur knows whether it has been
     earned. Squared, so it arrives late and then arrives properly rather
     than creeping in across the whole speed range. */
  function setSpeed(speed) {
    const t = Math.min(1, Math.max(0,
      (speed - GRADE.blurFrom) / (GRADE.blurFull - GRADE.blurFrom)));
    material.uniforms.uBlur.value = t * t * GRADE.blurAmount;
  }

  return {
    setSize,
    render,
    fade,
    setSun,
    setSpeed,
    get width() { return width; },
    get height() { return height; },
    get pixel() { return pixel; },
  };
}
