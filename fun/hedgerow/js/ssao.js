/* Hedgerow — ambient occlusion in screen space.

   A pass for `renderer.setEffects`, ahead of the light-in-the-rain pass
   and without a swap: it only fills its own half-resolution target, which
   volumetric.js applies (multiplying the scene before adding the glow)
   with an upsample that respects depth edges. From the scene's depth each
   pixel rebuilds its view-space position and normal and asks, for a
   hemisphere of 14 sample points (rotated per pixel), how many lie behind
   the depth already drawn there — corners, the foot of walls, the ground
   under crates and soldiers, the inside of a hedge. Range-checked so a
   wall far behind a soldier does not darken his outline, faded out with
   distance (the fog takes over), radius 0.9 m. */

import * as THREE from 'three';

const N = 14;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
#define N ${N}
uniform sampler2D tDepth;
uniform mat4 uProj, uProjInv;
uniform vec3 uKernel[N];
uniform vec2 uTexel;
uniform float uRadius, uFade;
varying vec2 vUv;

vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  float d = texture2D(tDepth, vUv).x;
  if (d >= 1.0) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  float dist = -P.z;
  if (dist > uFade) { gl_FragColor = vec4(1.0); return; }
  // the normal from the neighbours, the side with the smaller step (keeps edges clean)
  vec3 px = viewPos(vUv + vec2(uTexel.x, 0.0)) - P, nx = P - viewPos(vUv - vec2(uTexel.x, 0.0));
  vec3 py = viewPos(vUv + vec2(0.0, uTexel.y)) - P, ny = P - viewPos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(px.z) < abs(nx.z) ? px : nx, dy = abs(py.z) < abs(ny.z) ? py : ny;
  vec3 n = normalize(cross(dx, dy));
  // a random rotation about the normal, per pixel
  float a = hash(gl_FragCoord.xy) * 6.2831853;
  vec3 r = vec3(cos(a), sin(a), 0.0);
  vec3 t = normalize(r - n * dot(r, n)), b = cross(n, t);
  mat3 tbn = mat3(t, b, n);
  float occ = 0.0;
  for (int i = 0; i < N; i++) {
    vec3 s = P + tbn * uKernel[i] * uRadius;
    vec4 q = uProj * vec4(s, 1.0);
    vec2 uv = q.xy / q.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
    float sceneZ = viewPos(uv).z;
    float range = smoothstep(0.0, 1.0, uRadius / max(abs(P.z - sceneZ), 1e-3));
    occ += (sceneZ >= s.z + 0.03 ? 1.0 : 0.0) * range;
  }
  float ao = 1.0 - occ / float(N);
  ao = mix(ao, 1.0, smoothstep(uFade * 0.6, uFade, dist));
  gl_FragColor = vec4(vec3(ao), 1.0);
}`;

export function createSSAO(camera, { scale = 0.5 } = {}) {
  const kernel = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < N; i++) {
    // points in the hemisphere round +z, crowded towards the centre
    const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 0.85 + 0.15).normalize();
    const k = i / N;
    v.multiplyScalar(THREE.MathUtils.lerp(0.15, 1.0, k * k) * (0.6 + 0.4 * rnd()));
    kernel.push(v);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() },
      uKernel: { value: kernel }, uTexel: { value: new THREE.Vector2(1 / 512, 1 / 384) },
      uRadius: { value: 0.9 }, uFade: { value: 70 },
    },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false });
  target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter;
  const u = material.uniforms;

  return {
    enabled: true, needsSwap: false, uniforms: u, texture: target.texture,
    depth: null,          // the scene depth it read, for the upsample in volumetric.js
    setSize(w, h) {
      const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
      target.setSize(tw, th);
      u.uTexel.value.set(1 / tw, 1 / th);
    },
    render(renderer, writeBuffer, readBuffer) {
      if (!readBuffer.depthTexture) { this.enabled = false; return; }
      u.uProj.value.copy(camera.projectionMatrix);
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.tDepth.value = readBuffer.depthTexture;
      this.depth = readBuffer.depthTexture;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(quad, ortho);
      renderer.setRenderTarget(prev);
    },
  };
}
