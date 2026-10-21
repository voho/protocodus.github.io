/* Hedgerow — the film look, a pass for `renderer.setEffects` after the
   bloom (still in linear HDR; three tone-maps afterwards): a sharpening
   held inside each pixel's neighbourhood (no halos), a gentle S-curve
   about mid grey (deep blacks, firm highlights), a cool, slightly
   desaturated grade with warm highlights, vignette, film grain that lives
   in the shadows, and the hurt state (red edges, drained colour, a little
   chromatic split). A blast close by spatters the view with mud
   (spatter()): blobs of it, most at the edges and the bottom, wet and
   ragged, some dripping, wiped away over a few seconds. */

import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform float uTime, uHurt, uFlash, uSat, uGrain, uAspect, uSharp, uContrast;
uniform vec2 uTexel;
uniform vec3 uMud;          // how much mud (0: none), its seed, seconds since it hit
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoiseP(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// the mud on the view: how thick it is here (0..1), and how wet (for its sheen)
vec2 mud(vec2 uv) {
  vec2 q = (uv - 0.5) * vec2(uAspect, 1.0);
  float seed = uMud.y, age = uMud.z, amt = uMud.x;
  float k = 0.0, wet = 0.0;
  for (int i = 0; i < 22; i++) {
    float fi = float(i);
    if (fi > 6.0 + 16.0 * amt) break;            // the closer the blast, the more of it
    float h1 = hash(vec2(seed, fi * 1.7)), h2 = hash(vec2(fi * 3.1, seed + 0.5));
    float h3 = hash(vec2(seed * 1.3, fi)), h4 = hash(vec2(fi * 7.7, seed));
    // big splats along the bottom (thrown up from the ground), smaller ones round the edges
    bool big = i < 6;
    vec2 c;
    float r;
    if (big) {
      // in the lower corners, clear of the rifle in the middle
      c = vec2((0.3 + 0.5 * h1) * sign(h4 - 0.5) * uAspect * 0.62, -0.5 + h2 * 0.22);
      r = mix(0.05, 0.12, h3);
    } else {
      float a = h1 * 6.2832;
      c = vec2(cos(a) * uAspect * 0.5, min(sin(a) * 0.5, 0.25)) * mix(0.7, 1.05, h2);
      r = mix(0.015, 0.05, h3 * h3);
    }
    r *= 0.65 + 0.35 * amt;
    vec2 d = q - c;
    float dl = length(d / r);
    if (dl > 3.0) continue;
    // a ragged edge, spikes thrown out of it
    float ang = atan(d.y, d.x);
    float spikes = pow(vnoiseP(vec2(ang * 2.6 + fi * 5.0, fi * 1.3)), 3.0) * 1.1;
    float e = dl - spikes * smoothstep(0.55, 1.0, dl) + (vnoiseP(d / r * 3.0 + fi * 13.0) - 0.5) * 0.35;
    float blob = 1.0 - smoothstep(0.82, 1.0, e);
    // some of it runs down in a thin trickle
    float drip = step(0.45, h4) * min(age, 3.0) * 0.028 * (0.5 + h2);
    float wob = sin(d.y * 55.0 + fi) * r * 0.06;
    float tail = (d.y < -r * 0.4 && d.y > -r * 0.75 - drip)
      ? (1.0 - smoothstep(r * 0.07, r * 0.13, abs(d.x + wob))) * smoothstep(-r * 0.75 - drip, -r * 0.7 - drip * 0.8, d.y) : 0.0;
    // flecks thrown round it
    float fleck = step(0.88, vnoiseP(d * 230.0 + fi * 7.0)) * (1.0 - smoothstep(1.3, 2.8, dl));
    k = max(k, max(max(blob, tail), fleck * 0.85));
    // a thin wet highlight just inside its upper edge
    wet = max(wet, smoothstep(0.62, 0.78, e) * (1.0 - smoothstep(0.8, 0.9, e)) * smoothstep(0.1, 0.6, d.y / (length(d) + 1e-4)));
  }
  return vec2(k, wet);
}
void main() {
  vec2 c = vUv - 0.5;
  float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
  // sharpen, clamped to the neighbourhood so edges do not ring
  vec3 c0 = texture2D(tSrc, vUv).rgb;
  vec3 cn = texture2D(tSrc, vUv + vec2(0.0, uTexel.y)).rgb, cs = texture2D(tSrc, vUv - vec2(0.0, uTexel.y)).rgb;
  vec3 ce = texture2D(tSrc, vUv + vec2(uTexel.x, 0.0)).rgb, cw = texture2D(tSrc, vUv - vec2(uTexel.x, 0.0)).rgb;
  vec3 mn = min(c0, min(min(cn, cs), min(ce, cw))), mx = max(c0, max(max(cn, cs), max(ce, cw)));
  vec3 sharp = clamp(c0 + (4.0 * c0 - cn - cs - ce - cw) * 0.25 * uSharp, mn, mx);
  // chromatic split grows when hurt (and towards the corners)
  float ca = 0.0015 + uHurt * 0.006;
  vec3 col = sharp;
  col.r += texture2D(tSrc, vUv + c * ca).r - c0.r;
  col.b += texture2D(tSrc, vUv - c * ca).b - c0.b;
  col = max(col, 0.0);
  // mud on the view: dark, wet brown, a little of the light through its thin edges and a sheen
  if (uMud.x > 0.003) {
    vec2 m = mud(vUv);
    float fade = 1.0 - smoothstep(1.5, 4.5, uMud.z);
    // wet earth: near black-brown, a little of the light through it, a wet glint at its upper edge
    vec3 mc = vec3(0.011, 0.0075, 0.0045) * (0.7 + 0.6 * vnoiseP(vUv * 90.0)) + col * 0.03 + vec3(0.03, 0.028, 0.026) * m.y;
    col = mix(col, mc, m.x * 0.96 * fade);
  }
  // an S-curve about mid grey (in linear light: a power on the ratio to 0.18)
  col = 0.18 * pow(col / 0.18, vec3(uContrast));
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  // grade: cool shadows, warm highlights, a touch of desaturation
  vec3 cool = vec3(0.92, 0.98, 1.08), warm = vec3(1.08, 1.0, 0.9);
  float hl = smoothstep(0.05, 0.9, l);
  col *= mix(cool, warm, hl);
  col = mix(vec3(l), col, uSat * (1.0 - uHurt * 0.6));
  // vignette
  col *= 1.0 - smoothstep(0.18, 0.75, r2) * 0.55;
  // hurt: red at the edges
  col = mix(col, vec3(0.35, 0.02, 0.01) * (0.6 + l), uHurt * smoothstep(0.1, 0.6, r2) * 0.75);
  // grain, strongest in the shadows (as on film)
  float g = hash(vUv * vec2(1931.0, 1137.0) + fract(uTime * 7.13)) - 0.5;
  float gk = uGrain * mix(1.6, 0.6, smoothstep(0.02, 0.4, l));
  col += col * g * gk + g * 0.005;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

export function createGrade() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      tSrc: { value: null }, uTime: { value: 0 }, uHurt: { value: 0 }, uFlash: { value: 0 },
      uSat: { value: 0.82 }, uGrain: { value: 0.16 }, uAspect: { value: 1.6 },
      uSharp: { value: 0.45 }, uContrast: { value: 1.08 }, uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 768) },
      uMud: { value: new THREE.Vector3() },
    },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    enabled: true, needsSwap: true, uniforms: material.uniforms,
    /* a blast close by: mud thrown over the view (0..1, how close) */
    spatter(amount) {
      const m = material.uniforms.uMud.value;
      if (amount <= 0.05 || (m.x > amount && m.z < 1.5)) return;
      m.set(Math.min(1, amount), Math.random() * 97 + 1, 0);
    },
    /* time passing for the mud */
    tick(dt) {
      const m = material.uniforms.uMud.value;
      if (m.x <= 0) return;
      m.z += dt;
      if (m.z > 4.5) m.x = 0;
    },
    setSize(w, h) { material.uniforms.uAspect.value = w / Math.max(1, h); material.uniforms.uTexel.value.set(1 / w, 1 / h); },
    render(renderer, writeBuffer, readBuffer) {
      material.uniforms.tSrc.value = readBuffer.texture;
      renderer.setRenderTarget(writeBuffer);
      renderer.render(quad, camera);
    },
  };
}
