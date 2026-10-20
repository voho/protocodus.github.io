/* Hedgerow — the film look, a pass for `renderer.setEffects` after the
   bloom (still in linear HDR; three tone-maps afterwards): a cool, slightly
   desaturated grade with warm highlights, vignette, fine grain, and the
   hurt state (red edges, drained colour, a little chromatic split). */

import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform float uTime, uHurt, uFlash, uSat, uGrain, uAspect;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 c = vUv - 0.5;
  float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
  // chromatic split grows when hurt
  float ca = 0.0015 + uHurt * 0.006;
  vec3 col;
  col.r = texture2D(tSrc, vUv + c * ca).r;
  col.g = texture2D(tSrc, vUv).g;
  col.b = texture2D(tSrc, vUv - c * ca).b;
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
  // grain
  float g = hash(vUv * vec2(1931.0, 1137.0) + fract(uTime * 7.13)) - 0.5;
  col += col * g * uGrain + g * 0.004;
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
    },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    enabled: true, needsSwap: true, uniforms: material.uniforms,
    setSize(w, h) { material.uniforms.uAspect.value = w / Math.max(1, h); },
    render(renderer, writeBuffer, readBuffer) {
      material.uniforms.tSrc.value = readBuffer.texture;
      renderer.setRenderTarget(writeBuffer);
      renderer.render(quad, camera);
    },
  };
}
