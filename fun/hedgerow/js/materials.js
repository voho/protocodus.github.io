/* Hedgerow — materials.

   Models carry palette keys as material names (tools/blender/kit.py). Each
   key maps to one shared MeshStandardMaterial here: the palette colour,
   a tiling detail texture (RGB normal, A albedo detail) in metres-based
   UVs, and the rain: porous surfaces darken, everything loses roughness,
   and upward faces get standing water and ripples. */

import * as THREE from 'three';
import { GLSL_HELPERS } from './terrain.js';

/* key: [detail texture, metres per tile, normal strength, wet porosity, extra] */
const SPEC = {
  stone: ['stone', 2.2, 1.0, 0.9],
  stone_dark: ['stone', 2.2, 1.0, 0.9],
  plaster: ['plaster', 2.5, 0.6, 1.0],
  plaster_dirty: ['plaster', 2.5, 0.6, 1.0],
  brick: ['brick', 1.0, 0.9, 0.9],
  roof_tile: ['tile', 2.0, 1.0, 0.7],
  roof_slate: ['slate', 2.0, 0.9, 0.4],
  thatch: ['bark', 1.2, 1.0, 1.0],
  wood: ['planks', 2.0, 0.8, 0.9],
  wood_dark: ['planks', 2.0, 0.8, 0.9],
  wood_old: ['planks', 2.0, 0.9, 1.0],
  paint_green: ['planks', 2.0, 0.6, 0.5],
  paint_blue: ['planks', 2.0, 0.6, 0.5],
  paint_red: ['metal', 1.0, 0.4, 0.4],
  paint_white: ['metal', 1.0, 0.4, 0.4],
  glass: ['metal', 1.0, 0.1, 0.0, { roughness: 0.05, metalness: 0.0, env: 1.6 }],
  window_lit: ['metal', 1.0, 0.0, 0.0, { emissive: '#ffa04a', emissiveIntensity: 2.4 }],
  iron: ['metal', 1.0, 0.5, 0.2],
  rust: ['metal', 1.0, 0.8, 0.6],
  concrete: ['concrete', 2.5, 0.9, 0.9],
  cobble: ['stone', 1.2, 1.0, 0.8],
  sandbag: ['fabric', 0.6, 1.2, 1.0],
  canvas: ['fabric', 0.8, 0.8, 1.0],
  canvas_gray: ['fabric', 0.8, 0.8, 1.0],
  metal_olive: ['metal', 1.0, 0.5, 0.3],
  metal_gray: ['metal', 1.0, 0.5, 0.3],
  metal_dark: ['metal', 1.0, 0.5, 0.2],
  rubber: ['fabric', 0.5, 0.4, 0.3],
  burnt: ['concrete', 1.5, 1.2, 0.6],
  wire: ['metal', 0.5, 0.3, 0.2],
  marking_white: ['metal', 1.0, 0.3, 0.3],
  cloth_od: ['fabric', 0.35, 0.8, 1.0],
  cloth_od_dark: ['fabric', 0.35, 0.8, 1.0],
  cloth_khaki: ['fabric', 0.35, 0.8, 1.0],
  cloth_feldgrau: ['fabric', 0.35, 0.8, 1.0],
  cloth_feldgrau_dark: ['fabric', 0.35, 0.8, 1.0],
  skin: ['plaster', 0.4, 0.25, 0.3],
  hair: ['fabric', 0.2, 0.5, 0.5],
  leather: ['plaster', 0.5, 0.5, 0.4],
  leather_black: ['plaster', 0.5, 0.5, 0.3],
  webbing: ['fabric', 0.25, 0.7, 1.0],
  helmet_od: ['concrete', 0.6, 0.4, 0.4],
  helmet_gray: ['concrete', 0.6, 0.4, 0.4],
  gun_wood: ['planks', 0.7, 0.4, 0.3],
  gun_metal: ['metal', 0.4, 0.3, 0.1],
  gun_metal_worn: ['metal', 0.4, 0.4, 0.1],
  bark_pine: ['bark', 1.2, 1.2, 0.9],
  bark_oak: ['bark', 1.5, 1.2, 0.9],
  bark_birch: ['bark', 1.5, 0.6, 0.7],
  needles: ['foliage', 0.8, 0.55, 0.6],
  leaves: ['foliage', 1.0, 0.55, 0.6],
  leaves_dry: ['foliage', 1.2, 0.9, 0.7],
  moss: ['foliage', 0.6, 0.7, 1.0],
  rock: ['rock', 2.5, 1.0, 0.8],
  rock_dark: ['rock', 3.0, 1.0, 0.8],
  grass: ['foliage', 0.6, 0.6, 0.7],
  reed: ['bark', 0.5, 0.5, 0.7],
  dirt: ['rock', 2.0, 0.6, 1.0],
  hay: ['bark', 0.8, 0.8, 1.0],
  deadwood: ['bark', 1.2, 1.1, 0.9],
};

const PALETTE = {
  stone: '#8a8478', stone_dark: '#5f5a52', plaster: '#b5ab97', plaster_dirty: '#978c77', brick: '#84483a',
  roof_tile: '#7a4030', roof_slate: '#3f444a', thatch: '#7d6a45', wood: '#6b5039', wood_dark: '#3f2e22',
  wood_old: '#6d6458', paint_green: '#3d5240', paint_blue: '#4a5d6e', paint_red: '#7a2a22', paint_white: '#c9c6bc',
  glass: '#151b21', window_lit: '#ffb35c', iron: '#2e2f31', rust: '#6e3b22', concrete: '#8c8a84', cobble: '#6c6862',
  sandbag: '#8b7a58', canvas: '#5d5a3e', canvas_gray: '#5f6158', metal_olive: '#4b5132', metal_gray: '#545a5a',
  metal_dark: '#2b2c2c', rubber: '#1d1d1d', burnt: '#1c1a18', wire: '#3a3632', marking_white: '#d8d4c8',
  cloth_od: '#5b5a3c', cloth_od_dark: '#4a4630', cloth_khaki: '#7d7152', cloth_feldgrau: '#5c6152',
  cloth_feldgrau_dark: '#45493f', skin: '#c08f74', hair: '#2e2219', leather: '#3b2a1d', leather_black: '#1e1c1b',
  webbing: '#8a7d5a', helmet_od: '#4b4d34', helmet_gray: '#4f5650', gun_wood: '#5a3a22', gun_metal: '#2a2b2d',
  gun_metal_worn: '#45474a', bark_pine: '#4a3a2e', bark_oak: '#4d473f', bark_birch: '#c4c0b4', needles: '#28372a',
  leaves: '#3c4a29', leaves_dry: '#6a5a34', moss: '#4a5a32', rock: '#7d7a72', rock_dark: '#57554f', grass: '#4e5a34',
  reed: '#6d6c42', dirt: '#4a3d2e', hay: '#a08a50', deadwood: '#5e5448',
};
const ROUGH = {
  roof_slate: 0.6, glass: 0.1, iron: 0.5, rust: 0.8, metal_olive: 0.5, metal_gray: 0.5, metal_dark: 0.45,
  wire: 0.6, skin: 0.7, leather: 0.6, leather_black: 0.5, helmet_od: 0.7, helmet_gray: 0.7, gun_wood: 0.6,
  gun_metal: 0.4, gun_metal_worn: 0.45, needles: 0.85, leaves: 0.8, roof_tile: 0.75, paint_green: 0.6,
  paint_blue: 0.6, paint_red: 0.6, paint_white: 0.6, brick: 0.85, wood: 0.8, wood_dark: 0.8,
};
const METAL = {
  iron: 0.8, rust: 0.3, metal_olive: 0.4, metal_gray: 0.4, metal_dark: 0.7, wire: 0.7, gun_metal: 0.85,
  gun_metal_worn: 0.85, helmet_od: 0.1, helmet_gray: 0.1,
};

export function createMaterialLibrary(textures, shared) {
  const cache = new Map();

  function get(key, opts = {}) {
    const id = key + (opts.variant ? ':' + opts.variant : '');
    if (cache.has(id)) return cache.get(id);
    const spec = SPEC[key] || ['metal', 1.0, 0.3, 0.6];
    const [tex, tile, nStrength, porosity, extra = {}] = spec;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(opts.color || PALETTE[key] || '#808080'),
      roughness: opts.roughness ?? extra.roughness ?? ROUGH[key] ?? 0.9,
      metalness: opts.metalness ?? extra.metalness ?? METAL[key] ?? 0,
      vertexColors: true,
      normalMap: nStrength > 0 ? textures[tex] : null,
      normalScale: new THREE.Vector2(nStrength, nStrength),
    });
    mat.name = key;
    mat.envMapIntensity = extra.env ?? 1.0;
    if (extra.emissive) {
      mat.emissive = new THREE.Color(extra.emissive);
      mat.emissiveIntensity = extra.emissiveIntensity ?? 1;
    }
    addWeather(mat, shared, { porosity, detailTex: textures[tex], tile, foliage: tex === 'foliage' });
    cache.set(id, mat);
    return mat;
  }

  /* The material for a loaded glTF material: baked models keep their own
     textures (made wet here); untextured ones map to the palette by name. */
  const baked = new Map();
  function resolve(src) {
    if (!src) return get('stone');
    if (src.map || src.emissiveMap) {
      if (baked.has(src.uuid)) return baked.get(src.uuid);
      const m = src;
      // COLOR_0 carries occlusion on foliage cards (white elsewhere)
      m.vertexColors = true;
      const cards = m.alphaTest > 0 || m.transparent;
      if (cards) {
        m.transparent = false;
        m.alphaTest = Math.max(0.4, m.alphaTest || 0.5);
        m.side = THREE.DoubleSide;
      } else {
        m.side = THREE.FrontSide;      // baked solids are closed; no overdraw from the backs
      }
      if (m.emissiveMap) { m.emissive = new THREE.Color(1, 1, 1); m.emissiveIntensity = 2.2; }
      m.envMapIntensity = 1.0;
      // the far treelines and copses are scenery cards tens of metres tall: no wind
      addWeather(m, shared, { porosity: cards ? 0.4 : 0.75, foliage: cards, sway: cards && src.name !== 'nat_far' });
      baked.set(src.uuid, m);
      return m;
    }
    return get((src.name || 'stone').replace(/\.\d+$/, ''));
  }

  return { get, resolve, cache };
}

/* Rain on a standard material: porous surfaces darken, everything gets
   glossier, faces turned to the sky hold a film of water with ripples.
   With `detailTex` (palette materials) a tiling detail texture (RGB normal,
   A albedo detail) in metre UVs adds the surface grain. */
function addWeather(mat, shared, { porosity = 0.75, detailTex = null, tile = 1, foliage = false, sway = foliage }) {
  const detail = !!detailTex;
  const tileScale = 1 / tile;
  mat.customProgramCacheKey = () => 'hedgerow-' + (detail ? 'd' : 'b') + (foliage ? 'f' : '') + (sway ? 'w' : '') + (mat.normalMap ? 'n' : '');
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uTile: { value: tileScale }, uPorosity: { value: porosity },
      uWet: shared.wet, uTime: shared.time, uRain: shared.rain,
      tDetail: { value: detailTex },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTile;
        uniform float uTime;
        varying vec3 vWNormalM;
        varying vec2 vDetailUv;
        varying vec3 vWPosM;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        ${detail ? `#ifdef USE_NORMALMAP
          vNormalMapUv = uv * uTile;
        #endif` : ''}
        vDetailUv = uv * uTile;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${sway ? `{
          // wind: the higher, the more it moves (growing more slowly above
          // 14 m, so a 28 m spruce leans under a metre); phase from where it stands
          vec3 root = vec3(0.0);
          #ifdef USE_INSTANCING
            root = instanceMatrix[3].xyz;
          #endif
          root += modelMatrix[3].xyz;
          float hgt = max(0.0, position.y);
          float ph = uTime * 1.3 + root.x * 0.21 + root.z * 0.17;
          float gust = 0.6 + 0.4 * sin(uTime * 0.37 + root.x * 0.05);
          float k = hgt * min(hgt, 14.0) * 0.0025 * gust;
          transformed.x += (sin(ph) * 0.6 + sin(ph * 2.7 + position.z * 1.3) * 0.25) * k;
          transformed.z += (cos(ph * 0.8) * 0.4 + sin(ph * 3.1 + position.x * 1.1) * 0.2) * k;
        }` : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec3 on = objectNormal;
          #ifdef USE_INSTANCING
            on = mat3(instanceMatrix) * on;
          #endif
          vWNormalM = normalize(mat3(modelMatrix) * on);
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vWPosM = (modelMatrix * wp).xyz;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uPorosity, uWet, uTime, uRain;
        uniform sampler2D tDetail;
        varying vec3 vWNormalM;
        varying vec2 vDetailUv;
        varying vec3 vWPosM;
        float mWetUp;
        ${GLSL_HELPERS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          ${detail ? `float detail = texture2D(tDetail, vDetailUv).a;
          diffuseColor.rgb *= 0.55 + 0.9 * detail;` : `float detail = 0.5 + 0.8 * (dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1)) - 0.18);`}
          float up = smoothstep(0.55, 0.95, vWNormalM.y);
          // no standing water on leaves: a card's normal is the crown's, so a
          // film would turn the whole top of a crown into one mirror
          mWetUp = ${foliage ? '0.0' : 'up * uWet * smoothstep(0.35, 0.6, detail + 0.15)'};
          diffuseColor.rgb *= mix(1.0, 0.62, uWet * uPorosity);
          diffuseColor.rgb *= mix(1.0, 0.82, mWetUp);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, ${foliage ? 'max(roughnessFactor * 0.75, 0.42)' : 'roughnessFactor * 0.5 + 0.06'}, uWet);
        roughnessFactor = mix(roughnessFactor, 0.08, mWetUp * 0.8);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (mWetUp > 0.01) {
          vec2 rip = rainRipples(vWPosM.xz * 1.9, uTime) * uRain * mWetUp;
          mat3 tbnR = cotangentFrame(normal, -vViewPosition, vWPosM.xz);
          normal = normalize(tbnR * normalize(vec3(rip * 0.8, 1.0)) * 0.5 + normal * 0.5);
        }`);
    if (foliage) {
      // foliage: some light comes through the leaves, and a card lights the
      // same from both sides (its normals point out of the crown)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.12;`)
        .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
    }
  };
}

/* The river: opaque, murky, reflective, with flowing normals and rain rings. */
export function createWaterMaterial(textures, shared) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1d2420'), roughness: 0.16, metalness: 0.0,
    normalMap: textures.rock, normalScale: new THREE.Vector2(0.15, 0.15),
  });
  mat.name = 'water';
  mat.envMapIntensity = 1.3;
  mat.customProgramCacheKey = () => 'hedgerow-water';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTime: shared.time, uRain: shared.rain, uFlow: { value: new THREE.Vector2(1.0, 0.0) } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPosW;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWPosW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uRain;
        uniform vec2 uFlow;
        varying vec3 vWPosW;
        ${GLSL_HELPERS}`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec2 p = vWPosW.xz;
          vec3 n1 = texture2D(normalMap, p / 9.0 + uFlow * uTime * 0.03).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, p / 4.3 - uFlow.yx * uTime * 0.02 + uFlow * uTime * 0.05).xyz * 2.0 - 1.0;
          vec3 nts = normalize(vec3((n1.xy + n2.xy) * 0.12, 1.0));
          nts.xy += rainRipples(p * 1.5, uTime) * uRain * 0.8;
          mat3 tbn = cotangentFrame(normal, -vViewPosition, p);
          normal = normalize(tbn * normalize(nts));
        }`);
  };
  return mat;
}

/* Load the texture set. Detail textures are linear data (normal + detail);
   the ground albedos are sRGB. */
export async function loadTextures(base, onProgress) {
  const loader = new THREE.TextureLoader();
  const detail = ['stone', 'plaster', 'brick', 'tile', 'slate', 'planks', 'bark', 'fabric', 'concrete', 'metal', 'rock', 'foliage'];
  const ground = ['mud', 'grass', 'forest', 'cobble'];
  const names = [...detail, ...ground, ...ground.map(g => g + '_n')];
  const out = {};
  let done = 0;
  await Promise.all(names.map(name => new Promise((resolve, reject) => {
    loader.load(`${base}/${name}.webp`, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      tex.colorSpace = ground.includes(name) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      out[name] = tex;
      onProgress?.(++done / names.length);
      resolve();
    }, undefined, reject);
  })));
  return out;
}
