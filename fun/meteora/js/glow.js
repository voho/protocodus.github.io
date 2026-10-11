/* Meteora — one draw call for everything that glows.

   Engine flames, plasma bolts, muzzle flashes and missile motors are all
   the same thing to the GPU: soft additive light, either a round blob or a
   capsule stretched along a direction. Each frame the effect modules refill
   one instanced batch and it is drawn once.

   A stretched sprite is built in view space between its two end points, so
   a bolt flying straight at the camera foreshortens into a dot the way a
   real streak would, instead of staying a flat card. Colours are linear and
   may go well above 1: the bloom pass (and until then tone mapping) turns
   that into the white-hot core and coloured halo. */

import * as THREE from 'three';

const VERTEX = /* glsl */`
attribute vec4 iCenter;   // world xyz, half-width (m)
attribute vec4 iColor;    // linear rgb, intensity
attribute vec4 iAxis;     // world direction xyz, length (m); 0 = round
varying vec2 vUv;
varying vec4 vColor;
varying float vCap;
void main() {
  vec3 c = (viewMatrix * vec4(iCenter.xyz, 1.0)).xyz;
  float s = iCenter.w;
  vec3 half_ = (viewMatrix * vec4(iAxis.xyz, 0.0)).xyz * (iAxis.w * 0.5);
  vec3 p0 = c - half_, p1 = c + half_;
  vec2 s0 = p0.xy / max(-p0.z, 1e-3), s1 = p1.xy / max(-p1.z, 1e-3);
  vec2 d = s1 - s0;
  float l = length(d);
  vec2 dir = l > 1e-6 ? d / l : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec3 p = mix(p0, p1, position.x * 0.5 + 0.5);
  p.xy += (dir * position.x + nrm * position.y) * s;
  float halfLength = length(p1 - p0) * 0.5;
  vCap = s / (halfLength + s);
  vUv = position.xy;
  vColor = iColor;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}`;

const FRAGMENT = /* glsl */`
varying vec2 vUv;
varying vec4 vColor;
varying float vCap;
void main() {
  float dx = max(0.0, abs(vUv.x) - (1.0 - vCap)) / vCap;
  float r = length(vec2(dx, vUv.y));
  if (r >= 1.0) discard;
  float core = exp(-r * r * 9.0);
  float halo = exp(-r * r * 2.2) * (1.0 - r);
  vec3 hot = mix(vColor.rgb, vec3(1.0), core * 0.75);
  gl_FragColor = vec4(hot * vColor.a * (core * 1.6 + halo * 0.55), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createGlowBatch(scene, capacity = 4096) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const center = new Float32Array(capacity * 4), color = new Float32Array(capacity * 4), axis = new Float32Array(capacity * 4);
  const attrs = [
    ['iCenter', center], ['iColor', color], ['iAxis', axis],
  ].map(([name, array]) => {
    const a = new THREE.InstancedBufferAttribute(array, 4);
    a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, a);
    return a;
  });
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  scene.add(mesh);

  let n = 0;
  return {
    mesh,
    get count() { return n; },
    begin() { n = 0; },
    // Position, half-width, colour × intensity, and an optional stretch axis.
    add(x, y, z, size, r, g, b, intensity, ax = 0, ay = 0, az = 0, length = 0) {
      if (n >= capacity || intensity <= 0) return;
      const i = n * 4;
      center[i] = x; center[i + 1] = y; center[i + 2] = z; center[i + 3] = size;
      color[i] = r; color[i + 1] = g; color[i + 2] = b; color[i + 3] = intensity;
      axis[i] = ax; axis[i + 1] = ay; axis[i + 2] = az; axis[i + 3] = length;
      n++;
    },
    end() {
      geometry.instanceCount = n;
      for (const a of attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    },
  };
}
