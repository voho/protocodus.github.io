/* Meteora — the Well, as the eye sees it.

   A black hole is seen by what it does to light. Every pixel of the sky is
   a ray traced backwards from the camera through the hole's curved space:
   in the plane the ray shares with the hole, its path obeys the
   Schwarzschild orbit equation, u'' + u = 3/2 rₛ u² (u = 1/r, ' = d/dφ),
   stepped here with fourth-order Runge–Kutta in units of rₛ. A ray that
   falls inside the horizon is black — together those make the shadow,
   about 2.6 rₛ across as seen from afar. A ray that grazes the photon
   sphere at 1.5 rₛ loops round before escaping, which draws the thin
   bright photon ring. A ray that escapes is bent, and samples the sky
   where it finally points, so the stars and nebulae smear into arcs and
   the far sky shows twice round the shadow.

   On its way the ray may cross the accretion disk: a thin, opaque ring of
   gas from the innermost stable orbit at 3 rₛ outwards, glowing with the
   heat of a thin disk, T ∝ r^(−3/4) (1 − √(r_in / r))^(1/4). The gas
   orbits fast — half the speed of light near the inner edge — so the side
   coming towards the viewer is Doppler-brightened and bluer, the receding
   side dimmed and redder, and all of it redshifted by the hole's gravity,
   √(1 − rₛ/r). The disk's far side, bent up over the shadow and under it,
   is the same ring seen by light that went round the hole.

   The layer is a sphere round the camera, drawn as the sky is: behind
   everything, so ships pass in front of the hole as they would. */

import * as THREE from 'three';

const VERTEX = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAGMENT = /* glsl */`
varying vec3 vWorld;
uniform samplerCube uSky;
uniform vec3 uHole;
uniform float uRs;
uniform vec3 uDiskN;
uniform float uDiskIn;
uniform float uDiskOut;
uniform float uDiskGain;
uniform float uTime;
uniform float uMaxSteps;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}

// The colour of gas at a temperature (1 = the hottest the disk gets), as
// a blackbody runs: deep red, orange, white, blue-white.
vec3 heat(float t) {
  vec3 c = mix(vec3(0.6, 0.08, 0.02), vec3(1.0, 0.42, 0.1), smoothstep(0.15, 0.45, t));
  c = mix(c, vec3(1.0, 0.82, 0.6), smoothstep(0.45, 0.8, t));
  c = mix(c, vec3(0.85, 0.9, 1.0), smoothstep(0.8, 1.3, t));
  return c;
}

// Light from the disk where the ray crosses it: p the crossing (units of
// rₛ, from the hole), dir the traced ray's direction there.
vec4 disk(vec3 p, vec3 dir) {
  float r = length(p);
  if (r < uDiskIn || r > uDiskOut) return vec4(0.0);
  float t = pow(r / uDiskIn, -0.75) * pow(max(0.0, 1.0 - sqrt(uDiskIn / r)), 0.25) / 0.488;
  // Orbiting gas: speed (as a share of light's) from the pseudo-Newtonian
  // circular orbit, prograde round the disk's normal.
  float beta = min(0.7, sqrt(0.5 * r) / (r - 1.0));
  vec3 v = normalize(cross(uDiskN, p));
  float gamma = 1.0 / sqrt(1.0 - beta * beta);
  float doppler = 1.0 / (gamma * (1.0 - beta * dot(v, -dir)));
  float g = doppler * sqrt(1.0 - 1.0 / r);
  // Turbulence: rings and streaks that wind round with the gas.
  float angle = atan(dot(p, cross(uDiskN, vec3(1.0, 0.0, 0.0))), p.x);
  float spin = angle + uTime * beta / r * 0.6;
  float swirl = 0.55 + 0.45 * noise2(vec2(spin * 6.0 + r * 1.3, r * 3.0)) * (0.7 + 0.3 * noise2(vec2(r * 9.0, spin * 2.0)));
  float edge = smoothstep(uDiskIn, uDiskIn * 1.08, r) * smoothstep(uDiskOut, uDiskOut * 0.7, r);
  float bright = uDiskGain * pow(g, 3.0) * t * t * swirl;
  return vec4(heat(t * g) * bright, edge);
}

void main() {
  vec3 d = normalize(vWorld - cameraPosition);
  vec3 P = (cameraPosition - uHole) / uRs;
  float r0 = length(P);
  vec3 e1 = P / r0;
  float cpsi = dot(d, e1);
  vec3 tang = d - cpsi * e1;
  float spsi = length(tang);
  vec3 col = vec3(0.0);
  float cover = 0.0;
  if (spsi < 1e-5) {
    // Straight at the hole or straight away from it.
    gl_FragColor = vec4(cpsi < 0.0 ? vec3(0.0) : textureCube(uSky, d).rgb, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
  vec3 e2 = tang / spsi;
  float u = 1.0 / r0, du = -u * cpsi / spsi, phi = 0.0;
  vec3 prev = P;
  float prevSide = dot(P, uDiskN);
  bool captured = false, escaped = false;
  for (int i = 0; i < 400; i++) {
    if (float(i) >= uMaxSteps) break;
    // Finer steps close in, coarse ones far out.
    float h = clamp(0.3 / (1.0 + 40.0 * u), 0.012, 0.12);
    // RK4 on u'' = −u + 1.5 u².
    float k1u = du, k1v = -u + 1.5 * u * u;
    float u2 = u + 0.5 * h * k1u, v2 = du + 0.5 * h * k1v;
    float k2u = v2, k2v = -u2 + 1.5 * u2 * u2;
    float u3 = u + 0.5 * h * k2u, v3 = du + 0.5 * h * k2v;
    float k3u = v3, k3v = -u3 + 1.5 * u3 * u3;
    float u4 = u + h * k3u, v4 = du + h * k3v;
    float k4u = v4, k4v = -u4 + 1.5 * u4 * u4;
    u += h / 6.0 * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
    du += h / 6.0 * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);
    phi += h;
    if (u >= 1.0) { captured = true; break; }
    vec3 er = cos(phi) * e1 + sin(phi) * e2;
    vec3 p = er / max(u, 1e-4);
    float side = dot(p, uDiskN);
    if (side * prevSide < 0.0) {
      float f = prevSide / (prevSide - side);
      vec3 c = mix(prev, p, f);
      vec3 ephi = -sin(phi) * e1 + cos(phi) * e2;
      vec4 lit = disk(c, normalize(-du * er + u * ephi));
      col += (1.0 - cover) * lit.rgb * lit.a;
      cover += (1.0 - cover) * lit.a * 0.97;
      if (cover > 0.985) break;
    }
    prev = p; prevSide = side;
    if (u < 0.0015 && du < 0.0) { escaped = true; break; }
  }
  if (!captured && cover < 0.985) {
    vec3 er = cos(phi) * e1 + sin(phi) * e2, ephi = -sin(phi) * e1 + cos(phi) * e2;
    // A ray still circling when the steps ran out skims the photon sphere:
    // its light is the faint glow at the shadow's rim, not the sky.
    vec3 sky = escaped ? textureCube(uSky, normalize(-du * er + u * ephi)).rgb : vec3(0.0);
    col += (1.0 - cover) * sky;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* `hole`: { pos (world), rs (m), disk: { normal, inner, outer (in rₛ), gain } }. */
export function createLens(scene, sky, hole, { radius, steps = 260 } = {}) {
  const disk = { normal: [0, 1, 0], inner: 3, outer: 14, gain: 3.2, ...hole.disk };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
    uniforms: {
      uSky: { value: sky }, uHole: { value: new THREE.Vector3(...hole.pos) }, uRs: { value: hole.rs },
      uDiskN: { value: new THREE.Vector3(...disk.normal).normalize() }, uDiskIn: { value: disk.inner }, uDiskOut: { value: disk.outer },
      uDiskGain: { value: disk.gain }, uTime: { value: 0 }, uMaxSteps: { value: steps },
    },
    side: THREE.BackSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -101;
  scene.add(mesh);
  return {
    mesh,
    update(camera, dt) {
      mesh.position.copy(camera.position);
      material.uniforms.uTime.value += dt;
    },
    setSteps(n) { material.uniforms.uMaxSteps.value = n; },
    dispose() { scene.remove(mesh); mesh.geometry.dispose(); material.dispose(); },
  };
}
