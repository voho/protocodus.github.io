/* Meteora — fireballs and shock rings.

   A fireball is a cluster of lobes. Each lobe is a ball traced per pixel on
   a camera-facing square: 3D noise, sampled in directions fixed in the
   world so the pattern holds still as the camera moves, gives it a ragged
   outline and a churning surface. It is coloured by temperature — born
   small and white-hot, it swells fast and then slowly, cools through
   yellow, orange and dull red, and burns out in patches from the edge in,
   gathering soot as it goes. Looking through the middle of a ball crosses
   more hot gas than grazing its edge, so the middle is drawn hotter; that
   one term is what turns a disc into a fireball.

   Rings are the flat flash of a shock front: an annulus in some plane,
   racing outward and fading.

   Both are instanced — one draw call each, however many explosions are
   burning. Like the glow batch, this module only draws: explosions.js
   decides where every lobe and ring is and how old it is. */

import * as THREE from 'three';

const NOISE = /* glsl */`
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Three octaves, stretched back out to roughly 0..1 (summing octaves
// gathers value noise round 0.5).
float fbm(vec3 p) {
  float s = 0.5 * vnoise(p);
  s += 0.25 * vnoise(p * 2.03 + 17.1);
  s += 0.125 * vnoise(p * 4.09 + 31.7);
  return clamp((s / 0.875 - 0.5) * 1.9 + 0.5, 0.0, 1.0);
}
`;

const LOBE_VERTEX = /* glsl */`
attribute vec4 iCenter;   // world xyz, radius (m)
attribute vec4 iState;    // age 0..1, seed, heat, gain
varying vec2 vP;
varying vec4 vState;
varying float vFade;
void main() {
  vec4 c = viewMatrix * vec4(iCenter.xyz, 1.0);
  // A lobe the camera is inside, or about to be, fades rather than
  // filling the screen.
  vFade = clamp((-c.z - iCenter.w * 0.5) / iCenter.w, 0.0, 1.0);
  vP = position.xy * 1.4;
  c.xy += vP * iCenter.w;
  vState = iState;
  gl_Position = projectionMatrix * c;
}`;

const LOBE_FRAGMENT = /* glsl */`
varying vec2 vP;
varying vec4 vState;
varying float vFade;
${NOISE}
// Glowing gas from dull red to white-hot, for T in 0..1.
vec3 fire(float T) {
  vec3 c = mix(vec3(0.0), vec3(0.6, 0.05, 0.0), smoothstep(0.0, 0.25, T));
  c = mix(c, vec3(1.0, 0.24, 0.03), smoothstep(0.2, 0.45, T));
  c = mix(c, vec3(1.0, 0.56, 0.14), smoothstep(0.4, 0.65, T));
  c = mix(c, vec3(1.0, 0.84, 0.5), smoothstep(0.6, 0.85, T));
  return mix(c, vec3(1.0, 0.97, 0.9), smoothstep(0.85, 1.0, T));
}
void main() {
  float age = vState.x, r = length(vP);
  // The point of the ball's near surface under this pixel, as a direction
  // fixed in the world, so the pattern stays put as the camera moves.
  vec3 s = vec3(vP / max(r, 1.0), sqrt(max(0.0, 1.0 - r * r)));
  vec3 w = (vec4(s, 0.0) * viewMatrix).xyz;
  // Three noises: big lumps and fine turbulence shape the outline; a third,
  // independent of the outline, carries the heat, so the edge is not the
  // only place hot enough to survive.
  float lumps = fbm(w * 1.6 + vState.y + vec3(0.0, age * 1.3, age * 0.6));
  float churn = fbm(w * 4.5 + vState.y * 1.7 + age * 2.0);
  float heat = fbm(w * 2.8 - vState.y * 0.7 + vec3(age * 0.9, 0.0, -age * 1.1)) * 0.7 + churn * 0.3;
  // The outline: lumps reach past the radius, hollows fall short.
  float re = r - (lumps * 0.7 + churn * 0.3 - 0.5) * 0.7;
  float body = 1.0 - smoothstep(0.72, 1.0, re);
  if (body <= 0.0) discard;
  float thick = sqrt(max(0.0, 1.0 - min(re * re, 1.0)));
  float T = vState.z * mix(1.0, 0.1, smoothstep(0.0, 0.85, age)) * (0.3 + 0.7 * thick) * (0.25 + 1.1 * heat);
  // It burns out in patches, from the edge in.
  float burnAt = age * 1.15 - 0.1 + (1.0 - thick) * 0.25;
  float burn = smoothstep(burnAt - 0.12, burnAt + 0.12, heat);
  T = clamp(T, 0.0, 1.1);
  vec3 flame = fire(T) * (pow(T, 2.4) * 2.2 + T * 0.4) * burn;
  // Soot gathers in the cooler parts as the lobe ages, glowing dull red
  // while it is still hot, until the smoke puffs take over.
  float soot = smoothstep(0.15, 0.6, age) * (0.2 + 0.4 * (1.0 - heat)) * (1.0 - smoothstep(0.7, 1.0, age));
  vec3 sootColor = mix(vec3(0.3, 0.07, 0.015), vec3(0.012, 0.011, 0.01), smoothstep(0.35, 0.8, age));
  // Flame and soot both hide what is behind them, so a lump in front covers
  // the lumps behind it rather than adding to them: six lobes summed would
  // burn out to a flat white disc.
  float k = vState.w * vFade;
  gl_FragColor = vec4((flame + sootColor * soot) * body * k, min(0.95, (0.6 * burn + soot) * body) * k);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const RING_VERTEX = /* glsl */`
attribute vec4 iCenter;   // world xyz, radius (m)
attribute vec4 iNormal;   // plane normal xyz, width as a fraction of the radius
attribute vec4 iColor;    // linear rgb, intensity
attribute vec2 iState;    // age 0..1, seed
varying vec2 vUv;
varying vec4 vColor;
varying vec2 vState;
varying float vWidth;
void main() {
  vec3 n = normalize(iNormal.xyz);
  vec3 t1 = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(n, t1);
  vec2 corner = position.xy * (1.0 + 3.0 * iNormal.w);
  vUv = corner;
  vColor = iColor;
  vState = iState;
  vWidth = iNormal.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(iCenter.xyz + (t1 * corner.x + t2 * corner.y) * iCenter.w, 1.0);
}`;

const RING_FRAGMENT = /* glsl */`
varying vec2 vUv;
varying vec4 vColor;
varying vec2 vState;
varying float vWidth;
${NOISE}
void main() {
  float r = length(vUv);
  float a = atan(vUv.y, vUv.x);
  float front = exp(-pow((r - 1.0) / vWidth, 2.0));
  float wake = exp(-pow((r - 0.9) / (vWidth * 2.5), 2.0)) * 0.08;
  float breakup = 0.35 + 0.65 * vnoise(vec3(cos(a) * 4.0, sin(a) * 4.0, vState.y));
  vec3 col = mix(vec3(1.0), vColor.rgb, 0.25 + 0.75 * vState.x);
  gl_FragColor = vec4(col * vColor.a * (front + wake) * breakup * pow(1.0 - vState.x, 2.2), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function batch(scene, base, capacity, layout, vertexShader, fragmentShader, blending) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', base.getAttribute('position'));
  if (base.index) geometry.setIndex(base.index);
  const arrays = {};
  const attrs = Object.entries(layout).map(([name, size]) => {
    const a = new THREE.InstancedBufferAttribute(arrays[name] = new Float32Array(capacity * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, a);
    return a;
  });
  geometry.instanceCount = 0;
  const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    vertexShader, fragmentShader, side: THREE.DoubleSide, transparent: true, depthWrite: false, ...blending,
  }));
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    mesh, arrays, n: 0,
    end() {
      geometry.instanceCount = this.n;
      for (const a of attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * a.itemSize); a.needsUpdate = true; }
    },
  };
}

export function createFireballs(scene, { lobes = 64, rings = 24 } = {}) {
  const quad = new THREE.BufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  // Lobes add their light and cover what is behind them (premultiplied
  // alpha), so explosions.js hands them over back to front; rings only add
  // light. main.js draws the lobes after the smoke and before the glow, so
  // sparks fly in front of the fire.
  const L = batch(scene, quad, lobes, { iCenter: 4, iState: 4 }, LOBE_VERTEX, LOBE_FRAGMENT, {
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const R = batch(scene, quad, rings, { iCenter: 4, iNormal: 4, iColor: 4, iState: 2 }, RING_VERTEX, RING_FRAGMENT,
    { blending: THREE.AdditiveBlending });

  return {
    lobes: L.mesh, rings: R.mesh,
    get count() { return L.n + R.n; },
    begin() { L.n = 0; R.n = 0; },
    // Centre, radius, age (0 → 1 over its life), seed, heat (1 = white-hot
    // at birth) and an overall gain.
    lobe(x, y, z, radius, age, seed, heat, gain) {
      if (L.n >= lobes) return;
      const i = L.n++ * 4, c = L.arrays.iCenter, s = L.arrays.iState;
      c[i] = x; c[i + 1] = y; c[i + 2] = z; c[i + 3] = radius;
      s[i] = age; s[i + 1] = seed; s[i + 2] = heat; s[i + 3] = gain;
    },
    // Centre, plane normal, radius, width (a fraction of the radius), age,
    // seed, colour × intensity.
    ring(x, y, z, nx, ny, nz, radius, width, age, seed, r, g, b, intensity) {
      if (R.n >= rings) return;
      const k = R.n++, i = k * 4, a = R.arrays;
      a.iCenter[i] = x; a.iCenter[i + 1] = y; a.iCenter[i + 2] = z; a.iCenter[i + 3] = radius;
      a.iNormal[i] = nx; a.iNormal[i + 1] = ny; a.iNormal[i + 2] = nz; a.iNormal[i + 3] = width;
      a.iColor[i] = r; a.iColor[i + 1] = g; a.iColor[i + 2] = b; a.iColor[i + 3] = intensity;
      a.iState[k * 2] = age; a.iState[k * 2 + 1] = seed;
    },
    end() { L.end(); R.end(); },
  };
}
