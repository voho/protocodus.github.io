/* Hedgerow — light in the rain.

   A pass for `renderer.setEffects`, first in the chain (it reads the
   scene's depth): the glow that lamps, fires, muzzle flashes and
   explosions put into the wet air between the camera and whatever each
   pixel sees. For a point light in an even medium the light scattered
   towards the eye along a view ray has a closed form (the "airlight"
   integral): with the ray's closest approach to the light at distance h
   and parameter t0, the inverse-square falloff integrates to
       (atan((t1 - t0) / h) - atan((ta - t0) / h)) / h
   over the stretch [ta, t1] of the ray inside the light's range, and that
   stretch ends at the surface the pixel shows — so a wall in front of a
   lamp hides the lamp's glow behind it, and a soldier walking past a fire
   cuts a dark shape out of its haze. A forward-leaning phase function
   makes lights ahead of the camera glow more than those behind it, and a
   slow noise drifting with the wind breaks the haze into rain curtains.
   Up to eight of the strongest lights near the camera (the light pool's
   choice, lights.js) take part each frame.

   It also lays the ambient occlusion of ssao.js and the reflections of
   ssr.js onto the scene first: both half-resolution, brought up with one
   depth-aware 3 x 3 filter (so they do not bleed across edges). The
   occlusion spares bright pixels — lamps, fires and lit windows are not
   darkened by what is near them — and so do the reflections, which take
   the place of what the material reflected (the sky) in proportion to how
   mirror-like the scene pass says the pixel is (its alpha). */

import * as THREE from 'three';

const MAX = 8;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
#define MAX ${MAX}
uniform sampler2D tSrc;
uniform sampler2D tDepth;
uniform mat4 uProjInv, uViewInv;
uniform vec3 uCam;
uniform vec3 uPos[MAX];
uniform vec3 uCol[MAX];
uniform float uRange[MAX];
uniform float uCone[MAX];
uniform int uCount;
uniform float uDensity, uTime, uRain, uFar;
uniform vec2 uWind;
uniform sampler2D tAO, tSSR, tShafts, tPVis;
uniform float uPVis;
uniform vec2 uAOTexel;
uniform float uAO, uSSR;
uniform vec3 uShaftCol;
varying vec2 vUv;

float viewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.z / v.w;
}
// the half-resolution layers brought up to full size, weighted by depth likeness
void layers(vec2 uv, float z0, bool refl, out float ao, out vec4 rf) {
  float wsum = 0.0;
  ao = 0.0; rf = vec4(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j)) * uAOTexel;
    float w = (i == 0 && j == 0 ? 2.0 : 1.0) / (0.02 + abs(viewZ(uv + o) - z0));
    ao += texture2D(tAO, uv + o).r * w;
    if (refl) rf += texture2D(tSSR, uv + o) * w;
    wsum += w;
  }
  ao /= wsum; rf /= wsum;
}
// the share of the shadow-casting light's glow not in shadow (shafts.js), brought up the same way
float pvisLayer(vec2 uv, float z0) {
  float s = 0.0, wsum = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j)) * uAOTexel * 1.5;
    float w = 1.0 / (0.05 + abs(viewZ(uv + o) - z0) * 0.5);
    s += texture2D(tPVis, uv + o).r * w;
    wsum += w;
  }
  return s / wsum;
}
// the flare's shafts (shafts.js), brought up the same way and a little wider (they are grainy)
float shaftLayer(vec2 uv, float z0) {
  float s = 0.0, wsum = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j)) * uAOTexel * 1.5;
    float w = 1.0 / (0.05 + abs(viewZ(uv + o) - z0) * 0.5);
    s += texture2D(tShafts, uv + o).r * w;
    wsum += w;
  }
  return s / wsum;
}

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

void main() {
  vec4 src = texture2D(tSrc, vUv);
  vec3 col = src.rgb;
  float d = texture2D(tDepth, vUv).x;
  // the view ray and the distance to what this pixel shows
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  v.xyz /= v.w;
  float T = d >= 1.0 ? uFar : min(length(v.xyz), uFar);
  // how mirror-like the scene pass says this pixel is (mirrorAlpha in terrain.js)
  float mirror = uSSR * clamp(1.0 - src.a * 4.0, 0.0, 1.0);
  if ((uAO > 0.0 || mirror > 0.0) && d < 1.0) {
    float ao; vec4 rf;
    layers(vUv, v.z, mirror > 0.0, ao, rf);
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col *= mix(1.0, ao, uAO * (1.0 - smoothstep(0.8, 5.0, lum)));
    if (rf.a > 1e-4) col = mix(col, rf.rgb / rf.a, rf.a * mirror * (1.0 - smoothstep(1.5, 6.0, lum)));
  }
  // a flare's light in the wet air, in shafts where houses and trees shadow it
  if (uShaftCol.r + uShaftCol.g + uShaftCol.b > 0.0) col += uShaftCol * shaftLayer(vUv, v.z);
  vec3 dir = normalize(mat3(uViewInv) * v.xyz);
  vec3 add = vec3(0.0);
  for (int i = 0; i < MAX; i++) {
    if (i >= uCount) break;
    vec3 L = uPos[i] - uCam;
    float t0 = dot(L, dir);
    float h2 = max(dot(L, L) - t0 * t0, 0.0);
    float R = uRange[i];
    if (h2 > R * R) continue;
    // the stretch of the ray inside the light's range, cut by the surface
    float w = sqrt(R * R - h2);
    float ta = max(0.0, t0 - w), tb = min(T, t0 + w);
    if (tb <= ta) continue;
    // Only the first light uses the shadow visibility layer. Its nine depth and nine
    // visibility taps cannot contribute unless this ray actually passes through its glow.
    float pv = i == 0 && uPVis > 0.5 ? pvisLayer(vUv, v.z) : 1.0;
    float h = sqrt(h2) + 0.35;                 // a soft core: no singularity at the bulb
    float I;
    if (uCone[i] > -1.5) {
      // a lamp under its cap lights only the air below the cap's edge, and the cap throws back down
      // what would have gone up: a bell of light in the rain, brighter than a bare bulb's glow, dark
      // above it. The stretch is taken in pieces, each by the closed form, weighted by how far under
      // the cap its middle lies
      I = 0.0;
      for (int k = 0; k < 6; k++) {
        float s0 = mix(ta, tb, float(k) / 6.0), s1 = mix(ta, tb, float(k + 1) / 6.0);
        vec3 p = uCam + dir * (0.5 * (s0 + s1)) - uPos[i];
        float down = -p.y / max(length(p), 1e-3);
        I += (atan((s1 - t0) / h) - atan((s0 - t0) / h)) / h * smoothstep(uCone[i], uCone[i] + 0.35, down) * 2.2;
      }
    } else {
      I = (atan((tb - t0) / h) - atan((ta - t0) / h)) / h;
    }
    // fade towards the edge of the range like the light itself
    float edge = 1.0 - smoothstep(0.55, 1.0, sqrt(h2) / R);
    // forward scattering (Henyey-Greenstein, g = 0.45) seen from the closest point
    float c = t0 / max(length(L), 1e-3);
    float g = 0.45;
    float phase = 0.0795775 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
    // rain curtains drifting with the wind, round the closest point of approach
    vec3 q = uCam + dir * clamp(t0, ta, tb);
    float n = noise(vec3(q.x * 0.35 + uWind.x * uTime, q.y * 0.18 - uTime * 0.9, q.z * 0.35 + uWind.y * uTime));
    add += uCol[i] * I * edge * phase * (0.55 + 0.9 * n) * pv;
  }
  col += add * uDensity * (0.6 + 0.4 * uRain);
  gl_FragColor = vec4(col, 1.0);
}`;

export function createVolumetric(camera) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      tSrc: { value: null }, tDepth: { value: null },
      uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() },
      uCam: { value: new THREE.Vector3() },
      uPos: { value: Array.from({ length: MAX }, () => new THREE.Vector3()) },
      uCol: { value: Array.from({ length: MAX }, () => new THREE.Vector3()) },
      uRange: { value: new Array(MAX).fill(1) },
      uCone: { value: new Array(MAX).fill(-2) },
      uCount: { value: 0 },
      uDensity: { value: 0.03 }, uTime: { value: 0 }, uRain: { value: 1 }, uFar: { value: 140 },
      uWind: { value: new THREE.Vector2(0.5, 0.2) },
      tAO: { value: null }, uAOTexel: { value: new THREE.Vector2(1, 1) }, uAO: { value: 0 },
      tSSR: { value: null }, uSSR: { value: 0 },
      tShafts: { value: null }, uShaftCol: { value: new THREE.Vector3() },
      tPVis: { value: null }, uPVis: { value: 0 },
    },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const u = material.uniforms;

  return {
    enabled: true, needsSwap: true, uniforms: u,
    /* this frame's lights: [{x, y, z, color, intensity, range, fog, cone}] (fog: how
       much of it hangs in the air, 1 unless a light says otherwise; cone: a capped lamp's
       cosine from straight down where its light in the air gives out) */
    setLights(list, time, rain = 1) {
      const n = Math.min(MAX, list.length);
      for (let i = 0; i < n; i++) {
        const l = list[i];
        u.uPos.value[i].set(l.x, l.y, l.z);
        u.uCol.value[i].set(l.color.r, l.color.g, l.color.b).multiplyScalar(l.intensity * (l.fog ?? 1));
        u.uRange.value[i] = l.range * 0.8;
        u.uCone.value[i] = l.cone ?? -2;
      }
      u.uCount.value = n;
      u.uTime.value = time;
      u.uRain.value = rain;
    },
    /* the occlusion pass to apply (ssao.js), and how strongly (0: none) */
    setAO(ssao, strength = 0.85) {
      u.tAO.value = ssao ? ssao.texture : null;
      u.uAOTexel.value = ssao ? ssao.uniforms.uTexel.value : u.uAOTexel.value;
      u.uAO.value = ssao ? strength : 0;
    },
    /* the reflections pass to lay on (ssr.js, at the occlusion's half
       resolution: the upsample shares its texel), and how strongly */
    /* the flare's shafts to lay on (shafts.js, at the occlusion's half resolution), lit by a
       light of this colour and irradiance in air that scatters 'density' of it per metre */
    setShafts(shafts, color = null, irradiance = 0, density = 0.0012) {
      const on = !!(shafts && shafts.enabled && color);
      u.tShafts.value = on ? shafts.texture : null;
      if (on) u.uShaftCol.value.set(color.r, color.g, color.b).multiplyScalar(irradiance * density);
      else u.uShaftCol.value.set(0, 0, 0);
      if (on && !u.tAO.value && !u.tSSR.value) u.uAOTexel.value = shafts.texel;
    },
    /* the shadow-casting light's shafts (shafts.js pointTexture): on while it draws them */
    setPointShafts(shafts) {
      const on = !!(shafts && shafts.enabled && shafts.pointOn);
      u.tPVis.value = on ? shafts.pointTexture : null;
      u.uPVis.value = on ? 1 : 0;
      if (on && !u.tAO.value && !u.tSSR.value) u.uAOTexel.value = shafts.texel;
    },
    setSSR(ssr, strength = 1) {
      u.tSSR.value = ssr ? ssr.texture : null;
      u.uSSR.value = ssr ? strength : 0;
      if (ssr && !u.tAO.value) u.uAOTexel.value = ssr.texel;
    },
    render(renderer, writeBuffer, readBuffer) {
      if (!readBuffer.depthTexture) { this.enabled = false; return; }
      camera.updateMatrixWorld();
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.uViewInv.value.copy(camera.matrixWorld);
      u.uCam.value.setFromMatrixPosition(camera.matrixWorld);
      u.tSrc.value = readBuffer.texture;
      u.tDepth.value = readBuffer.depthTexture;
      renderer.setRenderTarget(writeBuffer);
      renderer.render(quad, ortho);
    },
  };
}
