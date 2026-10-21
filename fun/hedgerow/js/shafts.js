/* Hedgerow — shafts of flare light in the rain.

   A pass for `renderer.setEffects`, with the occlusion and the reflections
   ahead of the light-in-the-rain pass and, like them, without a swap: it
   fills its own half-resolution target, which volumetric.js lays on with
   the same depth-aware upsample. While a flare burns (flares.js), each
   pixel's view ray is marched through the first 45 m of wet air (or to
   what the pixel shows, if nearer) in 20 steps, each looked up in the
   flare's shadow map: what lies in a house's or a tree's shadow is dark
   air, the rest is lit. The lit length, weighted by how strongly rain
   scatters light forward (towards the flare: looking into it, the beams
   between the houses and down through the crowns show most), is what it
   writes. The steps start at a different fraction per pixel, so the
   sampling shows as fine grain rather than bands, which the upsample
   smooths. Free when no flare burns.

   It does the same for the light that casts shadows near the camera
   (lights.js: the strongest lamp or fire about), in its cube shadow map:
   along the stretch of each view ray inside its glow, twelve points spaced
   equiangularly about the light (as its inverse-square light falls on the
   ray, so their average visibility is the share of its closed-form glow,
   volumetric.js, that reaches the eye) are looked up, and that share is
   written to a second target. A truck's cab in front of its fire, the
   walls of a burning ruin, a soldier by a lamp cut dark shafts out of the
   glow in the rain. */

import * as THREE from 'three';

const STEPS = 20;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
#define STEPS ${STEPS}
uniform sampler2D tDepth;
uniform highp sampler2DShadow tShadow;
uniform mat4 uProjInv, uViewInv, uShadowMatrix;
uniform vec3 uCam, uLightDir;
uniform float uMaxDist, uG;
varying vec2 vUv;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  float d = texture2D(tDepth, vUv).x;
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  v.xyz /= v.w;
  float T = d >= 1.0 ? uMaxDist : min(length(v.xyz), uMaxDist);
  vec3 dir = normalize(mat3(uViewInv) * v.xyz);
  float dt = T / float(STEPS);
  float j = ign(gl_FragCoord.xy);
  float lit = 0.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = uCam + dir * ((float(i) + j) * dt);
    vec4 sc = uShadowMatrix * vec4(p, 1.0);
    // outside the shadow map nothing is known: no beam there
    if (any(lessThan(sc.xyz, vec3(0.0))) || any(greaterThan(sc.xyz, vec3(1.0)))) continue;
    lit += texture(tShadow, vec3(sc.xy, sc.z - 0.0008));
  }
  // rain throws light forward (Henyey-Greenstein, normalised)
  float c = dot(dir, uLightDir);
  float phase = 0.0795775 * (1.0 - uG * uG) / pow(1.0 + uG * uG - 2.0 * uG * c, 1.5);
  gl_FragColor = vec4(lit * dt * phase, 0.0, 0.0, 1.0);
}`;

// the share of the shadow-casting point light's glow along each view ray that is not in shadow
const PSTEPS = 12;
const PFRAG = /* glsl */ `
#define PSTEPS ${PSTEPS}
uniform sampler2D tDepth;
uniform highp samplerCubeShadow tCube;
uniform mat4 uProjInv, uViewInv;
uniform vec3 uCam, uPL;
uniform float uPLNear, uPLFar, uPLBias, uPLRange;
varying vec2 vUv;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  float d = texture2D(tDepth, vUv).x;
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  v.xyz /= v.w;
  float T = d >= 1.0 ? 1e4 : length(v.xyz);
  vec3 dir = normalize(mat3(uViewInv) * v.xyz);
  // the same stretch of the ray, and the same soft core, as volumetric.js integrates
  vec3 L = uPL - uCam;
  float t0 = dot(L, dir);
  float h2 = max(dot(L, L) - t0 * t0, 0.0);
  float R = uPLRange, vis = 1.0;
  if (h2 < R * R) {
    float w = sqrt(R * R - h2);
    float ta = max(0.0, t0 - w), tb = min(T, t0 + w);
    if (tb > ta) {
      float h = sqrt(h2) + 0.35;
      float aa = atan((ta - t0) / h), ab = atan((tb - t0) / h);
      float j = ign(gl_FragCoord.xy), s = 0.0;
      for (int i = 0; i < PSTEPS; i++) {
        float t = t0 + h * tan(mix(aa, ab, (float(i) + j) / float(PSTEPS)));
        vec3 lp = uCam + dir * t - uPL;
        vec3 al = abs(lp);
        float z = max(max(al.x, al.y), al.z);
        // as three's point shadows compare it: the depth on the cube face it falls on
        if (z <= uPLNear) { s += 1.0; continue; }
        float dp = (uPLFar * (z - uPLNear)) / (z * (uPLFar - uPLNear)) + uPLBias;
        s += texture(tCube, vec4(lp / max(length(lp), 1e-4), dp));
      }
      vis = s / float(PSTEPS);
    }
  }
  gl_FragColor = vec4(vis, 0.0, 0.0, 1.0);
}`;

export function createShafts(camera, { scale = 0.5, maxDist = 45 } = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      tDepth: { value: null }, tShadow: { value: null },
      uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() }, uShadowMatrix: { value: new THREE.Matrix4() },
      uCam: { value: new THREE.Vector3() }, uLightDir: { value: new THREE.Vector3(0, 1, 0) },
      uMaxDist: { value: maxDist }, uG: { value: 0.6 },
    },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false, stencilBuffer: false });
  target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter;
  const u = material.uniforms;
  const texel = new THREE.Vector2(1, 1);
  let light = null;
  // the point light's shafts
  const pmat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: PFRAG,
    uniforms: {
      tDepth: { value: null }, tCube: { value: null },
      uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() },
      uCam: { value: new THREE.Vector3() }, uPL: { value: new THREE.Vector3() },
      uPLNear: { value: 0.15 }, uPLFar: { value: 12 }, uPLBias: { value: 0 }, uPLRange: { value: 10 },
    },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const pquad = new THREE.Mesh(geometry, pmat);
  pquad.frustumCulled = false;
  const ptarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false, stencilBuffer: false });
  ptarget.texture.minFilter = ptarget.texture.magFilter = THREE.LinearFilter;
  const pu = pmat.uniforms;
  let plight = null, flareOn = false;

  return {
    enabled: false, needsSwap: false, uniforms: u, texture: target.texture,
    pointTexture: ptarget.texture,
    texel,                // of the half-resolution target, for the upsample
    /* the flares (flares.js): on while one's shadow map is being drawn */
    set(flares) {
      const l = flares?.light;
      const map = l?.shadow?.map?.depthTexture;
      flareOn = !!(flares?.shadowing && map);
      light = flareOn ? l : null;
      this.enabled = flareOn || !!plight;
    },
    /* the point light casting shadows near the camera (lights.js), with the range its glow is
       integrated over (volumetric.js); on while it is lit and its cube shadow map exists */
    setPoint(lights, glowRange = 0.8) {
      const l = lights?.shadowLight;
      const map = l?.shadow?.map?.depthTexture;
      plight = l && l.castShadow && l.intensity > 0 && lights.shadowOf && map?.isCubeDepthTexture ? l : null;
      if (plight) pu.uPLRange.value = lights.shadowOf.range * glowRange;
      this.enabled = flareOn || !!plight;
    },
    /* whether the point light's shafts are drawn this frame */
    get pointOn() { return !!plight; },
    setSize(w, h) {
      const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
      target.setSize(tw, th);
      ptarget.setSize(tw, th);
      texel.set(1 / tw, 1 / th);
    },
    render(renderer, writeBuffer, readBuffer) {
      if (!readBuffer.depthTexture) return;
      if (plight) {
        camera.updateMatrixWorld();
        pu.uProjInv.value.copy(camera.projectionMatrixInverse);
        pu.uViewInv.value.copy(camera.matrixWorld);
        pu.uCam.value.setFromMatrixPosition(camera.matrixWorld);
        pu.tDepth.value = readBuffer.depthTexture;
        pu.tCube.value = plight.shadow.map.depthTexture;
        pu.uPL.value.setFromMatrixPosition(plight.matrixWorld);
        pu.uPLNear.value = plight.shadow.camera.near;
        pu.uPLFar.value = plight.shadow.camera.far;
        pu.uPLBias.value = plight.shadow.bias;
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(ptarget);
        renderer.render(pquad, ortho);
        renderer.setRenderTarget(prev);
      }
      if (!light) return;
      camera.updateMatrixWorld();
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.uViewInv.value.copy(camera.matrixWorld);
      u.uCam.value.setFromMatrixPosition(camera.matrixWorld);
      u.tDepth.value = readBuffer.depthTexture;
      u.tShadow.value = light.shadow.map.depthTexture;
      u.uShadowMatrix.value.copy(light.shadow.matrix);
      u.uLightDir.value.copy(light.position).sub(light.target.position).normalize();
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(quad, ortho);
      renderer.setRenderTarget(prev);
    },
  };
}
