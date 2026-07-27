/* The look, in one pass.

   The scene is rendered into a buffer 288 lines tall — not the canvas, which
   is whatever size the window is — and then that buffer is graded, dithered,
   quantised and blown up by the browser with nearest-neighbour scaling. Four
   things happen here, and the order matters:

   1. Linearise out. The buffer holds linear light; everything below wants
      to work in the space the eye reads, so the sRGB transfer curve is
      applied first and by hand. A ShaderMaterial gets none of three's
      colour management for free, which for once is exactly what is wanted:
      there is precisely one conversion and it is visible in the source.

   2. Grade. Snow is the hardest subject in graphics — one colour, filling
      the frame, with nothing in it to read shape from. So the shadows are
      pushed towards the sky's blue and the highlights towards the sun's
      amber, saturation is lifted a little, and a vignette closes the
      corners. This is what makes it look photographed rather than computed.

   3. Dither, then quantise to thirty-two levels a channel. Five bits is
      what an RGBA5551 framebuffer held, and the ordered dither is what those
      machines used to hide it. Without the dither a snowfield at five bits
      is a contour map; with it, it is grain. The Bayer matrix is built
      recursively in two lines rather than stored, because a const array
      cannot be indexed dynamically in GLSL ES 1.0.

   4. Nothing. No antialiasing, no filtering, no motion blur. The pixels are
      the point.

   The vertical resolution is fixed and the width follows the viewport, so a
   wider monitor is shown more mountain rather than the same mountain in more
   pixels — which is the honest way to be resolution-independent about a look
   that is fundamentally about pixel size. */

import { RENDER, GRADE } from './config.js';

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = `
  precision mediump float;
  uniform sampler2D tDiffuse;
  uniform vec3 uShadow;
  uniform vec3 uHighlight;
  uniform float uTint;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uVignette;
  uniform float uLevels;
  uniform float uFade;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 linearToSrgb(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }

  // Bayer, built rather than stored: bayer2 is the 2×2 matrix as a closed
  // form, and one recursion of it is the 4×4. Returns [0, 1).
  float bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x * 0.5 + a.y * a.y * 0.75);
  }

  void main() {
    vec3 c = linearToSrgb(texture2D(tDiffuse, vUv).rgb);

    // Grade: split-tone by luminance, then contrast about middle grey,
    // then a little saturation back on top of what the tone took out.
    // Both tints arrive normalised to luminance 1, so this shifts hue and
    // nothing else — a grade that darkens the picture is a bug, not a look.
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

    // Dither, then quantise. Doing it in this order is the whole trick: the
    // dither is what turns a contour into grain.
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
  const target = new THREE.WebGLRenderTarget(320, RENDER.height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    // Left in linear: the pass below does the one and only conversion, so
    // the grade happens in the space the eye reads and nothing double-
    // encodes on the way out
    colorSpace: THREE.LinearSRGBColorSpace,
  });

  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: target.texture },
      uShadow: { value: hueOnly(THREE, GRADE.shadowTint) },
      uHighlight: { value: hueOnly(THREE, GRADE.highlightTint) },
      uTint: { value: GRADE.tintStrength },
      uContrast: { value: GRADE.contrast },
      uSaturation: { value: GRADE.saturation },
      uVignette: { value: GRADE.vignette },
      uLevels: { value: RENDER.levels },
      uFade: { value: 1 },
      uResolution: { value: new THREE.Vector2(320, RENDER.height) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let width = 320;
  const height = RENDER.height;

  /* Fits the internal buffer to the window's shape. Height is fixed; width
     is whatever the aspect ratio asks for, capped so an ultrawide monitor
     does not quietly turn this into a high-resolution game. */
  function setSize(cssWidth, cssHeight) {
    width = Math.max(160, Math.min(RENDER.maxWidth,
      Math.round((height * cssWidth) / Math.max(1, cssHeight))));
    target.setSize(width, height);
    material.uniforms.uResolution.value.set(width, height);
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    return { width, height };
  }

  function render(worldScene, worldCamera) {
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(worldScene, worldCamera);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  }

  /* Used to dip the whole picture behind a menu, so the game reads as
     paused rather than as stopped. */
  function fade(v) {
    material.uniforms.uFade.value = v;
  }

  return { setSize, render, fade, get width() { return width; }, height };
}
