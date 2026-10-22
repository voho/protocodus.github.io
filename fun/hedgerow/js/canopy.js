/* Hedgerow — the forest canopy over the ground, as a flare sees it.

   Under a flare the trees shadow the forest floor - its shadow map draws that (flares.js), but only
   over the 80 m round the player: further off, the floor under the crowns would be lit as if it
   lay in the open, and a track through the woods glows pale far down it. So at load the planted
   trees' crowns are laid out on a map from above (how much of the sky each metre of ground has
   over it in leaves: a pine or a fir thick, an oak or a beech a little less, a birch's crown thin,
   a dead tree's hardly at all), and the ground's shader dims the flare's light by it, looked up
   where the light's ray passes through the crowns some ten metres up: from where the shadow map
   ends (blended in over its last few metres), and everywhere on low quality, which draws no
   shadows for the flare. A lightning stroke takes the flare's light, and its canopy with it. */

import * as THREE from 'three';
import { breathe } from './pace.js';

/* the map, and the flare's light's direction (world, towards it), set each frame (setCanopyLight) */
export const CANOPY_UNIFORMS = {
  tCanopy: { value: null }, uCanopyMin: { value: new THREE.Vector2() }, uCanopySize: { value: new THREE.Vector2(1, 1) },
  uFlareDir: { value: new THREE.Vector3(0, 1, 0) },
};

// how much of the sky a crown keeps off the ground under it
const KINDS = [[/^(pine|fir)/, 0.85], [/^(oak|beech)/, 0.8], [/^birch/, 0.55], [/^tree_dead/, 0.25]];

/* veg: the planted trees (vegetation.js: per kind its model and placements); bounds: the
   terrain's ({minX, maxX, minZ, maxZ}, m); cell: the map's metres per texel */
// (a kind of tree at a time, the browser getting its turns between: pace.js, while loading)
export async function buildCanopy(veg, bounds, { cell = 1 } = {}) {
  const W = Math.ceil((bounds.maxX - bounds.minX) / cell), H = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
  // the share of the sky each cell sees through the leaves over it, crowns overlapping
  const open = new Float32Array(W * H).fill(1);
  const sc = new THREE.Vector3();
  for (const k of veg?.kinds?.values() || []) {
    const thick = KINDS.find(([re]) => re.test(k.name))?.[1];
    if (!thick) continue;
    const box = k.model.box, half = ((box.max.x - box.min.x) + (box.max.z - box.min.z)) * 0.25 * 0.9;
    for (const it of k.items) {
      await breathe();
      const r = half * sc.setFromMatrixScale(it.m).x / cell;
      const cx = (it.x - bounds.minX) / cell, cz = (it.z - bounds.minZ) / cell;
      for (let j = Math.max(0, Math.floor(cz - r)); j <= Math.min(H - 1, Math.ceil(cz + r)); j++) {
        for (let i = Math.max(0, Math.floor(cx - r)); i <= Math.min(W - 1, Math.ceil(cx + r)); i++) {
          const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cz) / r;
          if (d >= 1) continue;
          // thinner towards the crown's edge
          const t = Math.min(1, (1 - d) / 0.4);
          open[j * W + i] *= 1 - thick * t * t * (3 - 2 * t);
        }
      }
    }
  }
  // softened over a couple of metres (the gaps between the leaves, the ray's slant through them)
  const tmp = new Float32Array(W * H);
  const R = Math.max(1, Math.round(2 / cell));
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < H; j++) {
      await breathe();
      for (let i = 0; i < W; i++) {
        let s = 0, n = 0;
        for (let d = -R; d <= R; d++) { const x = i + d; if (x >= 0 && x < W) { s += open[j * W + x]; n++; } }
        tmp[j * W + i] = s / n;
      }
    }
    for (let j = 0; j < H; j++) {
      await breathe();
      for (let i = 0; i < W; i++) {
        let s = 0, n = 0;
        for (let d = -R; d <= R; d++) { const y = j + d; if (y >= 0 && y < H) { s += tmp[y * W + i]; n++; } }
        open[j * W + i] = s / n;
      }
    }
  }
  const data = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) data[i] = Math.round((1 - open[i]) * 255);
  const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  CANOPY_UNIFORMS.tCanopy.value = tex;
  CANOPY_UNIFORMS.uCanopyMin.value.set(bounds.minX, bounds.minZ);
  CANOPY_UNIFORMS.uCanopySize.value.set(W * cell, H * cell);
  return tex;
}

/* the flare's light this frame (flares.js: a directional light at its position, aimed at its target) */
export function setCanopyLight(light) {
  CANOPY_UNIFORMS.uFlareDir.value.copy(light.position).sub(light.target.position).normalize();
}

// the cover over a point, looked up where the flare's ray passes through the crowns some ten metres
// over it: in the vertex shader (the ground's fragment shader has no texture unit to spare; its
// vertices are a metre or less apart, finer than the map). The rain's crowns (weather.js) look it
// up for each splash.
export const CANOPY_VERT = /* glsl */ `
uniform sampler2D tCanopy;
uniform vec2 uCanopyMin, uCanopySize;
uniform vec3 uFlareDir;
varying float vCanopy;
float canopyCover(vec3 wpos) {
  if (uCanopySize.x <= 1.0) return 0.0;
  vec2 p = wpos.xz + uFlareDir.xz / max(uFlareDir.y, 0.2) * 10.0;
  return texture2D(tCanopy, (p - uCanopyMin) / uCanopySize).r;
}
`;

const CANOPY_FRAG = /* glsl */ `
uniform vec3 uFlareDir;
varying float vCanopy;
// how much of a directional light gets through the crowns: for any but the flare's, all of it; for
// the flare's, what its shadow map (coord: x and y 0..1 inside it) says where that map reaches and
// the canopy map's estimate where it does not, blended over the map's last few metres
float canopyFar(vec3 dirView, vec4 coord) {
  vec3 L = (vec4(dirView, 0.0) * viewMatrix).xyz;
  if (dot(L, uFlareDir) < 0.9995) return 1.0;
  float e = min(min(coord.x, 1.0 - coord.x), min(coord.y, 1.0 - coord.y));
  float inMap = smoothstep(0.02, 0.12, e) * step(coord.z, 1.0);
  return mix(1.0 - 0.9 * vCanopy, 1.0, inMap);
}
`;

// three's directional lights' shadow line, with the canopy after it (and, for a light drawn without
// a shadow map, the canopy alone)
const ANCHOR = /(vDirectionalShadowCoord\[ i \] \) : 1\.0;)(\s*)#endif/;
let patched = null;
function chunk() {
  if (patched !== null) return patched;
  const src = THREE.ShaderChunk.lights_fragment_begin;
  patched = ANCHOR.test(src)
    ? src.replace(ANCHOR, '$1$2directLight.color *= canopyFar( directLight.direction, vDirectionalShadowCoord[ i ] );$2#else$2directLight.color *= canopyFar( directLight.direction, vec4( -1.0 ) );$2#endif')
    : '';
  return patched;
}

/* in a material's onBeforeCompile: wpos, its vertex shader's world position (an expression, valid
   by the end of its main) */
export function addCanopy(shader, wpos) {
  const c = chunk();
  if (!c || !shader.fragmentShader.includes('#include <lights_fragment_begin>') || !shader.vertexShader.includes('#include <fog_vertex>')) return;
  Object.assign(shader.uniforms, CANOPY_UNIFORMS);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + CANOPY_VERT)
    .replace('#include <fog_vertex>', `vCanopy = canopyCover(${wpos});\n#include <fog_vertex>`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + CANOPY_FRAG)
    .replace('#include <lights_fragment_begin>', c);
}
