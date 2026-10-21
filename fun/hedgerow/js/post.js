/* Hedgerow — the film look, a pass for `renderer.setEffects` after the
   bloom (still in linear HDR; three tone-maps afterwards): a sharpening
   held inside each pixel's neighbourhood (no halos), a gentle S-curve
   about mid grey (deep blacks, firm highlights), a cool, slightly
   desaturated grade with warm highlights, vignette, film grain that lives
   in the shadows, and the hurt state (red edges, drained colour, a little
   chromatic split). */

import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform float uTime, uHurt, uFlash, uSat, uGrain, uAspect, uSharp, uContrast;
uniform vec2 uTexel;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
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
    },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    enabled: true, needsSwap: true, uniforms: material.uniforms,
    setSize(w, h) { material.uniforms.uAspect.value = w / Math.max(1, h); material.uniforms.uTexel.value.set(1 / w, 1 / h); },
    render(renderer, writeBuffer, readBuffer) {
      material.uniforms.tSrc.value = readBuffer.texture;
      renderer.setRenderTarget(writeBuffer);
      renderer.render(quad, camera);
    },
  };
}
