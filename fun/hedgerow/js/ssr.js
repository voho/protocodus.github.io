/* Hedgerow — reflections in the wet street.

   A pass for `renderer.setEffects`, next to the occlusion ahead of the
   light-in-the-rain pass and, like it, without a swap: it fills its own
   half-resolution target, which volumetric.js lays over the scene with an
   upsample that respects depth edges. The scene pass leaves in its alpha
   how mirror-like each pixel is (terrain.js and materials.js write it from
   the wet roughness, `mirrorAlpha`: a puddle or the river is a mirror, wet
   cobbles a dull sheen, everything else nothing). For those pixels a ray
   goes from the surface along the reflected view direction through the
   depth buffer — 24 growing steps, then a binary search for the crossing —
   and what the screen shows at the crossing is the reflection: lit
   windows, lamps, the houses opposite, a soldier walking past. Standing
   water lies level and the rain rings of terrain.js ruffle it; a rough
   film scatters its rays round the mirror direction, which at a low angle
   stretches the reflection into the long streaks of a wet road. A ray that
   meets nothing near reflects what the camera sees where its direction
   vanishes on screen, when that is far (the sky, the glow over the
   horizon, the far roofs); one that leaves the screen, or passed behind
   something, keeps the material's own reflection of the sky. Fresnel-
   weighted, faded towards the edges of the screen. */

import * as THREE from 'three';
import { GLSL_HELPERS } from './terrain.js';

const STEPS = 24;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
#define STEPS ${STEPS}
uniform sampler2D tSrc, tDepth;
uniform mat4 uProj, uProjInv, uView, uViewInv;
uniform vec2 uTexel;
uniform float uTime, uRain;
varying vec2 vUv;
${GLSL_HELPERS}

vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
// view-space z of what the screen shows at uv (the far plane for the sky)
float viewZ(vec2 uv) { return -uProj[3][2] / (texture2D(tDepth, uv).x * 2.0 - 1.0 + uProj[2][2]); }
vec2 toScreen(vec3 p) { vec4 c = uProj * vec4(p, 1.0); return c.xy / c.w * 0.5 + 0.5; }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  // on the centre of a full-resolution texel (half way between two, the
  // neighbours below would be the same texel every other row)
  vec2 uv0 = (floor(vUv / uTexel) + 0.5) * uTexel;
  float mirror = clamp(1.0 - texture2D(tSrc, uv0).a * 4.0, 0.0, 1.0);
  float d = texture2D(tDepth, uv0).x;
  if (mirror < 0.03 || d >= 1.0) { gl_FragColor = vec4(0.0); return; }
  vec3 P = viewPos(uv0);
  // the surface normal from the depth (the side with the smaller step keeps edges clean)
  vec3 px = viewPos(uv0 + vec2(uTexel.x, 0.0)) - P, nx = P - viewPos(uv0 - vec2(uTexel.x, 0.0));
  vec3 py = viewPos(uv0 + vec2(0.0, uTexel.y)) - P, ny = P - viewPos(uv0 - vec2(0.0, uTexel.y));
  vec3 n = normalize(cross(abs(px.z) < abs(nx.z) ? px : nx, abs(py.z) < abs(ny.z) ? py : ny));
  if (dot(n, P) > 0.0) n = -n;
  vec3 nW = mat3(uViewInv) * n;
  // water stands on what is about level: streets, yards, puddles, tops (not roofs)
  float level = smoothstep(0.82, 0.95, nW.y);
  if (level <= 0.0) { gl_FragColor = vec4(0.0); return; }
  vec3 W = (uViewInv * vec4(P, 1.0)).xyz;
  // standing water lies level; the rain rings ruffle it (the rings terrain.js draws)
  float pool = smoothstep(0.6, 0.95, mirror);
  nW = normalize(mix(nW, vec3(0.0, 1.0, 0.0), pool));
  vec2 rip = pool > 0.01 ? rainRipples(W.xz * 1.7, uTime) * uRain * pool : vec2(0.0);
  // a rough film scatters the rays round the mirror direction
  float j = ign(gl_FragCoord.xy);
  vec2 sc = (vec2(j, ign(gl_FragCoord.yx + 17.0)) - 0.5) * (1.0 - mirror) * 0.24;
  nW = normalize(nW + vec3(rip.x * 0.06 + sc.x, 0.0, rip.y * 0.06 + sc.y));
  n = normalize(mat3(uView) * nW);
  vec3 V = normalize(P);
  vec3 R = reflect(V, n);
  // rays turned down into the ground, or back past the camera, find nothing on screen
  if ((mat3(uViewInv) * R).y < 0.005) { gl_FragColor = vec4(0.0); return; }
  float facing = 1.0 - smoothstep(-0.15, 0.2, R.z);
  if (facing <= 0.0) { gl_FragColor = vec4(0.0); return; }

  float dist = -P.z;
  vec3 O = P + n * (0.02 + dist * 0.002);
  float stp = 0.05 + dist * 0.01;
  float t = stp * j, tPrev = 0.0;
  vec2 hit = vec2(-1.0);
  float found = 0.0;
  bool blocked = false;
  for (int i = 0; i < STEPS; i++) {
    tPrev = t;
    t += stp;
    vec3 Q = O + R * t;
    if (Q.z > -0.05) break;
    vec2 uv = toScreen(Q);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float dz = viewZ(uv) - Q.z;
    if (dz > 0.0) {
      // behind what the screen shows, but not far behind (or it passed behind a thin thing);
      // and clearly above the water (not the next bump of the same ground)
      if (dz < stp * 1.5 + 0.25 && (uViewInv * vec4(Q, 1.0)).y - W.y > 0.12) {
        float a = tPrev, b = t;
        for (int k = 0; k < 5; k++) {
          float m = 0.5 * (a + b);
          vec3 M = O + R * m;
          if (viewZ(toScreen(M)) - M.z > 0.0) b = m; else a = m;
        }
        hit = toScreen(O + R * b);
        // the last steps are long: fade rather than cut off where the march ends
        found = 1.0 - smoothstep(float(STEPS) - 6.0, float(STEPS), float(i));
        break;
      }
      blocked = true;
    }
    stp *= 1.18;
  }
  // nothing near in the way: the sky and far scenery in the mirror direction
  // are on screen where that direction vanishes (if they are), as the
  // camera sees them — the glow over the horizon, far roofs, lightning
  if (found <= 0.0 && !blocked) {
    vec4 cv = uProj * vec4(R, 0.0);
    vec2 uvInf = cv.xy / max(cv.w, 1e-4) * 0.5 + 0.5;
    if (cv.w > 0.0 && uvInf.x > 0.0 && uvInf.x < 1.0 && uvInf.y > 0.0 && uvInf.y < 1.0 && viewZ(uvInf) < -60.0) {
      hit = uvInf;
      found = 1.0;
    }
  }
  if (found <= 0.0) { gl_FragColor = vec4(0.0); return; }
  vec3 c = texture2D(tSrc, hit).rgb;
  vec2 e = smoothstep(vec2(0.0), vec2(0.06, 0.1), hit) * (1.0 - smoothstep(vec2(0.94, 0.88), vec2(1.0), hit));
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, -V), 0.0), 5.0);
  float w = F * found * facing * level * e.x * e.y;
  // premultiplied, so the upsample averages it right
  gl_FragColor = vec4(c * w, w);
}`;

export function createSSR(camera, shared, { scale = 0.5 } = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      tSrc: { value: null }, tDepth: { value: null },
      uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() },
      uView: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 768) },
      uTime: shared.time, uRain: shared.rain,
    },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
  target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter;
  const u = material.uniforms;
  const texel = new THREE.Vector2(1, 1);

  return {
    enabled: true, needsSwap: false, uniforms: u, texture: target.texture,
    texel,                // of the half-resolution target, for the upsample
    setSize(w, h) {
      const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
      target.setSize(tw, th);
      texel.set(1 / tw, 1 / th);
      u.uTexel.value.set(1 / w, 1 / h);
    },
    render(renderer, writeBuffer, readBuffer) {
      if (!readBuffer.depthTexture) { this.enabled = false; return; }
      camera.updateMatrixWorld();
      u.uProj.value.copy(camera.projectionMatrix);
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.uView.value.copy(camera.matrixWorldInverse);
      u.uViewInv.value.copy(camera.matrixWorld);
      u.tSrc.value = readBuffer.texture;
      u.tDepth.value = readBuffer.depthTexture;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(quad, ortho);
      renderer.setRenderTarget(prev);
    },
  };
}
