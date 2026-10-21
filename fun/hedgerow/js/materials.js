/* Hedgerow — materials.

   Models carry palette keys as material names (tools/blender/kit.py). Each
   key maps to one shared MeshStandardMaterial here: the palette colour,
   a tiling detail texture (RGB normal, A albedo detail) in metres-based
   UVs, and the rain: porous surfaces darken, everything loses roughness,
   and upward faces get standing water and ripples. */

import * as THREE from 'three';
import { GLSL_HELPERS } from './terrain.js';
import { ROOMS_GLSL, ROOM_UNIFORMS } from './rooms.js';
import { dimFillSpecular } from './fill.js';
import { GUST_GLSL } from './weather.js';

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

/* how much light comes through the leaves (foliage, addWeather) */
export const FOLIAGE_UNIFORMS = { uLeafTrans: { value: 1.6 } };

/* what burns, and smoulders round its fire: the charred wood of a burning ruin (its char cracks
   and glows), the metal of a burnt-out wreck (it glows a dull red with the heat) */
const SMOULDER = [[/^(ruin|beam_charred)/, 'wood'], [/^(truck_burnt|halftrack_wreck|jeep_wreck)/, 'metal']];
/* the fires nearest the camera (x, y, z, size; size 0: none), for the smouldering (updateSmoulder) */
export const SMOULDER_UNIFORMS = { uFires: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) } };
const near4 = [];
export function updateSmoulder(fires, cam) {
  near4.length = 0;
  for (const f of fires) {
    if (!f.on || f.far) continue;
    near4.push([(f.x - cam.x) ** 2 + (f.z - cam.z) ** 2, f]);
  }
  near4.sort((a, b) => a[0] - b[0]);
  SMOULDER_UNIFORMS.uFires.value.forEach((v, i) => {
    const f = near4[i]?.[1];
    if (f) v.set(f.x, f.y, f.z, f.size); else v.set(0, -1000, 0, 0);
  });
}

/* the soldiers' atlases, whose skin (found by its colour) scatters light under its surface and
   whose wool (found by its baked roughness and metalness) has a fabric's sheen */
const SKIN = /^(allied|axis)$/;
/* how much of each, and a debug view of what is taken for which (1 skin red, 2 cloth green) */
export const SKIN_UNIFORMS = { uSkin: { value: 1 }, uCloth: { value: 1 }, uSkinDebug: { value: 0 }, uCloseUp: { value: 1 }, tFabric: { value: null } };

/* what rain does not run down in rivulets: the soldiers, their kit and weapons (and, by
   palette key, cloth, skin and the like) */
const CARRIED = /^(allied|axis|m1_garand|thompson|kar98k|mp40|mg42|grenade)/;
const NO_STREAKS = /^(cloth|skin|hair|leather|webbing|gun|rubber|wire|marking)/;

/* trunks that get close-up bark (detail strength, moss): furrowed oak and pine,
   smooth beech, papery birch, old dead wood */
const BARK = [[/^oak/, 1.0, 0.7], [/^(pine|fir)/, 0.9, 0.35], [/^beech/, 0.35, 0.85], [/^birch/, 0.4, 0.15], [/^(tree_dead|stump|log)/, 0.8, 0.6]];

/* the close-up grain of the baked solids (addWeather `grain`): its texture (grainTexture, made
   with the first material library) and how strong it is (0: none) */
export const GRAIN_UNIFORMS = { tGrain: { value: null }, uGrain: { value: 1 } };

/* A metre of surface, tiling: mottling a few centimetres across, finer grit and small pits. RGB
   its relief as a normal map, A the albedo detail (0.5 on average). Value noise on lattices
   that wrap, so it tiles. */
function grainTexture(S = 512) {
  let seed = 7;
  const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sizes = [8, 16, 32, 64, 128];
  const lattices = sizes.map((n) => Float32Array.from({ length: n * n }, R));
  const H = new Float32Array(S * S), A = new Float32Array(S * S);
  const oct = new Float32Array(sizes.length);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    for (let o = 0; o < sizes.length; o++) {
      const n = sizes[o], L = lattices[o], fx = (x / S) * n, fy = (y / S) * n;
      const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const x1 = (ix + 1) % n, y1 = (iy + 1) % n;
      const a = L[iy * n + ix], b = L[iy * n + x1], c = L[y1 * n + ix], d = L[y1 * n + x1];
      oct[o] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
    const i = y * S + x;
    H[i] = oct[1] * 0.35 + oct[2] * 0.35 + oct[3] * 0.3;
    A[i] = 0.5 + (oct[0] - 0.5) * 0.45 + (oct[1] - 0.5) * 0.35 + (oct[3] - 0.5) * 0.25 + (oct[4] - 0.5) * 0.15;
  }
  // pits, a few millimetres across, darker inside
  for (let k = 0; k < 900; k++) {
    const cx = R() * S, cy = R() * S, r = 1 + R() * 2.5, deep = 0.03 + R() * 0.05;
    for (let j = Math.floor(-r - 1); j <= r + 1; j++) for (let i = Math.floor(-r - 1); i <= r + 1; i++) {
      const px = (Math.floor(cx) + i + S) % S, py = (Math.floor(cy) + j + S) % S;
      const t = 1 - Math.hypot(Math.floor(cx) + i - cx, Math.floor(cy) + j - cy) / r;
      if (t <= 0) continue;
      H[py * S + px] -= deep * t * t;
      A[py * S + px] -= 0.25 * t;
    }
  }
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const dx = (H[y * S + ((x + 1) % S)] - H[y * S + ((x + S - 1) % S)]) * 9;
    const dy = (H[((y + 1) % S) * S + x] - H[((y + S - 1) % S) * S + x]) * 9;
    const l = Math.hypot(dx, dy, 1);
    data[i * 4] = (0.5 - (0.5 * dx) / l) * 255;
    data[i * 4 + 1] = (0.5 - (0.5 * dy) / l) * 255;
    data[i * 4 + 2] = (0.5 + 0.5 / l) * 255;
    data[i * 4 + 3] = Math.max(0, Math.min(1, A[i])) * 255;
  }
  const tex = new THREE.DataTexture(data, S, S);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function createMaterialLibrary(textures, shared) {
  const cache = new Map();
  GRAIN_UNIFORMS.tGrain.value ??= grainTexture();
  SKIN_UNIFORMS.tFabric.value = textures.fabric;

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
    addWeather(mat, shared, {
      porosity, detailTex: textures[tex], tile, foliage: tex === 'foliage',
      streaks: tex !== 'foliage' && !NO_STREAKS.test(key),
    });
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
        // the cut-out edges of leaves, needles and grass use the scene's
        // multisampling (alpha to coverage): soft, steady edges instead of
        // stair-steps that crawl as the camera moves
        m.alphaToCoverage = true;
      } else {
        m.side = THREE.FrontSide;      // baked solids are closed; no overdraw from the backs
      }
      if (m.emissiveMap) { m.emissive = new THREE.Color(1, 1, 1); m.emissiveIntensity = 2.2; }
      m.envMapIntensity = 1.0;
      // the far treelines and copses are scenery cards tens of metres tall: no wind
      const bk = !cards && BARK.find(([re]) => re.test(src.name || ''));
      addWeather(m, shared, {
        porosity: cards ? 0.4 : 0.75, foliage: cards, sway: cards && src.name !== 'nat_far',
        bark: bk ? { tex: textures.bark, k: bk[1], moss: bk[2] } : null,
        streaks: !cards && !CARRIED.test(src.name || ''),
        rooms: !!src.userData?.rooms,
        smoulder: !cards && (SMOULDER.find(([re]) => re.test(src.name || ''))?.[1] || null),
        skin: SKIN.test(src.name || ''),
        // the soldiers and their kit keep the fill light's sheen: it models their shape in the dark
        glints: CARRIED.test(src.name || ''),
        // the grain of the surface close up: houses, walls, wrecks, crates (not the leaves, the
        // bark, what is carried or the lit panes)
        grain: !cards && !bk && !CARRIED.test(src.name || '') && !src.userData?.rooms,
      });
      baked.set(src.uuid, m);
      return m;
    }
    return get((src.name || 'stone').replace(/\.\d+$/, ''));
  }

  return { get, resolve, cache };
}

/* Rain on a standard material: porous surfaces darken, everything gets
   glossier, faces turned to the sky hold a film of water with ripples, and
   (streaks) water runs down walls in rivulets that catch the light.
   With `detailTex` (palette materials) a tiling detail texture (RGB normal,
   A albedo detail) in metre UVs adds the surface grain. `rooms`: lit
   window panes (rooms.js) show the room behind them. */
function addWeather(mat, shared, { porosity = 0.75, detailTex = null, tile = 1, foliage = false, sway = foliage, bark = null, streaks = false, rooms = false, smoulder = null, skin = false, glints = false, grain = false }) {
  const detail = !!detailTex;
  const tileScale = 1 / tile;
  mat.customProgramCacheKey = () => 'hedgerow-' + (detail ? 'd' : 'b') + (foliage ? 'f' : '') + (sway ? 'w' : '') + (bark ? 'k' : '') + (streaks ? 's' : '') + (rooms ? 'r' : '') + (smoulder ? 'm' + smoulder[0] : '') + (skin ? 'h' : '') + (glints ? 'g' : '') + (grain ? 'G' : '') + (mat.normalMap ? 'n' : '');
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uTile: { value: tileScale }, uPorosity: { value: porosity },
      uWet: shared.wet, uTime: shared.time, uRain: shared.rain,
      tDetail: { value: detailTex },
      ...(bark ? { tBark: { value: bark.tex }, uBark: { value: bark.k }, uMoss: { value: bark.moss } } : {}),
      ...(rooms ? ROOM_UNIFORMS : {}),
      ...(foliage ? FOLIAGE_UNIFORMS : {}),
      ...(smoulder ? SMOULDER_UNIFORMS : {}),
      ...(skin ? { ...SKIN_UNIFORMS, tGrain: GRAIN_UNIFORMS.tGrain } : {}),
      ...(grain ? GRAIN_UNIFORMS : {}),
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTile;
        uniform float uTime;
        varying vec3 vWNormalM;
        varying vec2 vDetailUv;
        varying vec3 vWPosM;
        ${bark ? 'varying vec3 vBarkP, vBarkN;\n        varying float vBarkH;' : ''}
        ${rooms ? 'attribute vec4 aWin;\n        varying vec4 vWin;' : ''}
        ${sway ? GUST_GLSL : ''}`)
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
          // the gusts that drive the rain (weather.js) drive the trees: a gust sweeping through
          // bends them downwind and shakes them harder, a lull lets them stand
          vec2 wdir = normalize(vec2(1.6, 0.7));
          float gw = (gust(root.xz, uTime, wdir) - 0.55) / 1.05;
          float k = hgt * min(hgt, 14.0) * 0.0025 * (0.55 + 0.6 * gw);
          transformed.x += (sin(ph) * 0.6 + sin(ph * 2.7 + position.z * 1.3) * 0.25) * k;
          transformed.z += (cos(ph * 0.8) * 0.4 + sin(ph * 3.1 + position.x * 1.1) * 0.2) * k;
          // the lean downwind, in the tree's own space (it is turned and scaled as it stands)
          mat3 im = mat3(modelMatrix);
          #ifdef USE_INSTANCING
            im = im * mat3(instanceMatrix);
          #endif
          transformed += transpose(im) * vec3(wdir.x, 0.0, wdir.y) / dot(im[0], im[0]) * hgt * min(hgt, 14.0) * 0.0025 * gw * 0.9;
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
          ${rooms ? 'vWin = aWin;' : ''}
          ${bark ? `// the bark detail in the tree's own space (it stays on the bark), shifted per tree
          vBarkP = position;
          #ifdef USE_INSTANCING
            vBarkP += vec3(instanceMatrix[3].x * 0.37, instanceMatrix[3].z * 0.53, instanceMatrix[3].z * 0.29);
          #endif
          vBarkN = objectNormal;
          vBarkH = position.y;` : ''}
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uPorosity, uWet, uTime, uRain;
        uniform sampler2D tDetail;
        varying vec3 vWNormalM;
        varying vec2 vDetailUv;
        varying vec3 vWPosM;
        float mWetUp;
        ${bark ? `uniform sampler2D tBark;
        uniform float uBark, uMoss;
        varying vec3 vBarkP, vBarkN;
        varying float vBarkH;
        vec4 barkA, barkB;
        float barkK, barkW;` : ''}
        ${streaks ? 'float mRiv, mRivX;\n        vec3 mRivT;' : ''}
        ${rooms ? 'varying vec4 vWin;' : ''}
        ${grain ? `uniform sampler2D tGrain;
        uniform float uGrain;
        float grainK = 0.0, grainN = 0.0;
        vec3 grainW = vec3(0.0);
        vec4 grainX, grainY, grainZ;` : ''}
        ${GLSL_HELPERS}
        ${rooms ? ROOMS_GLSL : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        ${bark ? `{
          // close up, the bark's furrows and plates (the baked texture is stretched thin over a
          // big trunk): seen from two sides of the trunk, blended by which way it faces; none on
          // what faces up or down (branches, cut ends), gone by 16 m
          barkK = uBark * (1.0 - smoothstep(9.0, 16.0, length(vViewPosition))) * (1.0 - smoothstep(0.55, 0.85, abs(vBarkN.y)));
          barkW = smoothstep(0.35, 0.65, abs(vBarkN.x) / (abs(vBarkN.x) + abs(vBarkN.z) + 1e-4));
          barkA = barkB = vec4(0.5, 0.5, 1.0, 0.5);
          if (barkK > 0.01) {
            barkA = texture2D(tBark, vBarkP.xy);
            barkB = texture2D(tBark, vBarkP.zy);
            diffuseColor.rgb *= mix(1.0, 0.45 + 1.1 * mix(barkA.a, barkB.a, barkW), barkK);
          }
          // moss low on the trunk and on its weather side, in the furrows first
          float mossK = uMoss * (1.0 - smoothstep(0.2, 1.8, vBarkH)) * smoothstep(-0.2, 0.6, -vWNormalM.z + 0.3)
            * smoothstep(0.35, 0.65, 1.0 - mix(barkA.a, barkB.a, barkW) + 0.15);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.065, 0.02), clamp(mossK, 0.0, 0.85));
        }` : ''}
        {
          ${detail ? `float detail = texture2D(tDetail, vDetailUv).a;
          diffuseColor.rgb *= 0.55 + 0.9 * detail;` : `float detail = 0.5 + 0.8 * (dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1)) - 0.18);`}
          float up = smoothstep(0.55, 0.95, vWNormalM.y);
          // no standing water on leaves: a card's normal is the crown's, so a
          // film would turn the whole top of a crown into one mirror
          mWetUp = ${foliage ? '0.0' : 'up * uWet * smoothstep(0.35, 0.6, detail + 0.15)'};
          diffuseColor.rgb *= mix(1.0, 0.62, uWet * uPorosity);
          diffuseColor.rgb *= mix(1.0, 0.82, mWetUp);
        }
        ${streaks ? `// rain running down walls, close to the eye: rivulets ~22 cm apart, darker wet
        // stripes with a glossy core, each wandering as it runs and carrying water in
        // stretches that slide down the wall
        mRiv = 0.0; mRivX = 0.0; mRivT = vec3(1.0, 0.0, 0.0);
        #ifndef USE_SKINNING
        {
          float vert = 1.0 - smoothstep(0.2, 0.5, abs(vWNormalM.y));
          float k = vert * uWet * (0.4 + 0.6 * uRain) * (1.0 - smoothstep(14.0, 24.0, length(vViewPosition)));
          if (k > 0.01) {
            bool alongZ = abs(vWNormalM.x) > abs(vWNormalM.z);
            mRivT = alongZ ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
            vec2 q = vec2((alongZ ? vWPosM.z : vWPosM.x) * 4.5, vWPosM.y * 0.7 + uTime * 0.8);
            float col = floor(q.x);
            mRivX = fract(q.x + sin(vWPosM.y * 3.1 + col * 7.7) * 0.2) - 0.5;
            float line = 1.0 - smoothstep(0.06, 0.2, abs(mRivX));
            float fy = floor(q.y), ty = fract(q.y);
            float run = smoothstep(0.55, 0.8, mix(hash12(vec2(col, fy)), hash12(vec2(col, fy + 1.0)), ty * ty * (3.0 - 2.0 * ty)));
            mRiv = line * run * k;
            diffuseColor.rgb *= 1.0 - 0.45 * mRiv;
          }
        }
        #endif` : ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        ${grain ? `// close up, the grain of the surface (a baked texture stretched over a whole house goes
        // soft within a few metres): a metre of fine detail in world space, seen from the three
        // sides blended by which way the surface faces, gone by 7 m; its relief only on what is
        // rough (stone, plaster, old wood: paint or metal, glossy in the rain, would glitter) and
        // not under standing water, which fills it
        grainK = uGrain * (1.0 - smoothstep(3.0, 7.0, length(vViewPosition)));
        grainN = grainK * smoothstep(0.55, 0.85, roughnessFactor) * (1.0 - mWetUp);
        if (grainK > 0.01) {
          grainW = pow(abs(vWNormalM), vec3(4.0));
          grainW /= dot(grainW, vec3(1.0));
          grainX = texture2D(tGrain, vWPosM.zy);
          grainY = texture2D(tGrain, vWPosM.xz);
          grainZ = texture2D(tGrain, vWPosM.xy);
          float g = grainX.a * grainW.x + grainY.a * grainW.y + grainZ.a * grainW.z;
          diffuseColor.rgb *= mix(1.0, 0.7 + 0.6 * g, grainK);
        }` : ''}
        roughnessFactor = mix(roughnessFactor, ${foliage ? 'max(roughnessFactor * 0.75, 0.42)' : 'roughnessFactor * 0.5 + 0.06'}, uWet);
        roughnessFactor = mix(roughnessFactor, 0.08, mWetUp * 0.8);
        ${streaks ? 'roughnessFactor = mix(roughnessFactor, 0.04, mRiv);' : ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${bark ? `if (barkK > 0.01) {
          vec3 nA = cotangentFrame(normal, -vViewPosition, vBarkP.xy) * normalize(vec3((barkA.xy * 2.0 - 1.0) * barkK * 1.3, 1.0));
          vec3 nB = cotangentFrame(normal, -vViewPosition, vBarkP.zy) * normalize(vec3((barkB.xy * 2.0 - 1.0) * barkK * 1.3, 1.0));
          normal = normalize(mix(nA, nB, barkW));
        }` : ''}
        ${grain ? `if (grainN > 0.01) {
          // each side's relief laid along the two world axes of its plane
          vec2 gx = grainX.xy * 2.0 - 1.0, gy = grainY.xy * 2.0 - 1.0, gz = grainZ.xy * 2.0 - 1.0;
          vec3 dn = grainW.x * vec3(0.0, gx.y, gx.x) + grainW.y * vec3(gy.x, 0.0, gy.y) + grainW.z * vec3(gz.x, gz.y, 0.0);
          normal = normalize(normal + mat3(viewMatrix) * dn * grainN * 0.25);
        }` : ''}
        if (mWetUp > 0.01) {
          vec2 rip = rainRipples(vWPosM.xz * 1.9, uTime, rippleFade(length(vViewPosition))) * uRain * mWetUp;
          mat3 tbnR = cotangentFrame(normal, -vViewPosition, vWPosM.xz);
          normal = normalize(tbnR * normalize(vec3(rip * 0.8, 1.0)) * 0.5 + normal * 0.5);
        }
        ${streaks ? `// a rivulet bulges out of the wall: its sides lean, so it catches the light across it
        if (mRiv > 0.01) normal = normalize(normal + mat3(viewMatrix) * mRivT * (mRivX * 3.0 * mRiv));` : ''}`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        #ifdef OPAQUE
          gl_FragColor.a = mirrorAlpha(roughnessFactor, mWetUp);
        #endif`);
    if (skin) {
      // where each point of him is in his own (bind-pose) space, for the close-up detail: it stays
      // on the cloth and the skin however he moves
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n        varying vec3 vSkP, vSkN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n        vSkP = position; vSkN = normal;');
      // skin, found in the soldier's atlas by its colour (warm, middling saturation, light enough:
      // not the leather, the hair or the khaki), scatters light under its surface: the light
      // wraps round past the terminator, reddest, and thin parts lit from behind glow red.
      // Wool (what is baked rough and not metal: not the helmet, the leather or the skin) keeps
      // a fabric's look in the rain - darker, not glossy - and has its sheen, a soft glow of
      // the light at grazing angles along its folds and its silhouette (Charlie, as three's)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
        uniform float uSkin, uCloth, uSkinDebug, uCloseUp;
        uniform sampler2D tFabric, tGrain;
        varying vec3 vSkP, vSkN;
        float skinK = 0.0, clothK = 0.0, skK = 0.0, woolHue = 0.0;
        vec3 skW = vec3(0.0);
        const vec4 SK_FLAT = vec4(0.5, 0.5, 1.0, 0.5);
        vec4 skX = SK_FLAT, skY = SK_FLAT, skZ = SK_FLAT;
        vec3 clothSheen = vec3(0.0);
        void RE_Direct_Skin(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal,
            const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
          RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
          if (clothK > 0.0) {
            vec3 h = normalize(directLight.direction + geometryViewDir);
            float nl = saturate(dot(geometryNormal, directLight.direction)), nv = saturate(dot(geometryNormal, geometryViewDir));
            float nh = saturate(dot(geometryNormal, h));
            float a = 0.42 * 0.42, inv = 1.0 / a, s2 = max(1.0 - nh * nh, 0.0078125);
            float d = (2.0 + inv) * pow(s2, inv * 0.5) / (2.0 * PI);
            float v = saturate(1.0 / (4.0 * (nl + nv - nl * nv)));
            reflectedLight.directSpecular += directLight.color * clothSheen * nl * d * v * clothK;
          }
          if (skinK > 0.0) {
            float nl = dot(geometryNormal, directLight.direction);
            vec3 w = vec3(0.55, 0.24, 0.16);
            vec3 wrapped = saturate((vec3(nl) + w) / (1.0 + w));
            reflectedLight.directDiffuse += directLight.color * BRDF_Lambert(material.diffuseColor) * (wrapped - saturate(nl)) * skinK;
            float back = pow(saturate(dot(-geometryViewDir, directLight.direction)), 4.0) * 0.3;
            reflectedLight.directDiffuse += directLight.color * material.diffuseColor * vec3(1.0, 0.28, 0.18) * back * skinK;
          }
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Skin`)
        .replace('#include <roughnessmap_fragment>', `
        {
          vec3 sc = pow(max(diffuseColor.rgb, vec3(1e-4)), vec3(1.0 / 2.2));
          float mx = max(sc.r, max(sc.g, sc.b)), mn = min(sc.r, min(sc.g, sc.b));
          float sat = (mx - mn) / max(mx, 1e-4);
          float hue = (sc.g - sc.b) / max(sc.r - sc.b, 1e-4);     // 0 red .. 1 yellow, for r >= g >= b
          skinK = step(sc.b, sc.g) * step(sc.g, sc.r) * smoothstep(0.08, 0.18, hue) * (1.0 - smoothstep(0.52, 0.64, hue))
            * smoothstep(0.14, 0.24, sat) * (1.0 - smoothstep(0.62, 0.72, sat)) * smoothstep(0.3, 0.4, mx) * uSkin;
          // the colour of wool: field grey, olive or khaki - not a saturated brown (leather), not
          // black (boots, belts, pouches) - and below the collar (the painted helmet is the same grey)
          woolHue = (1.0 - smoothstep(0.36, 0.46, sat) * step(sc.g, sc.r)) * smoothstep(0.16, 0.22, mx)
            * (1.0 - smoothstep(1.54, 1.6, vSkP.y));
        }
        #include <roughnessmap_fragment>
        // skin: soft, not plastic (glossier wet)
        roughnessFactor = mix(roughnessFactor, 0.58, skinK);
        // wool: what is baked rough and is no metal (its sheen a little of its own colour, lightened)
        {
          float mtl = 0.0;
          #ifdef USE_METALNESSMAP
            mtl = texture2D(metalnessMap, vMetalnessMapUv).b;
          #endif
          clothK = max(smoothstep(0.72, 0.82, roughnessFactor), smoothstep(0.5, 0.62, roughnessFactor) * woolHue)
            * (1.0 - smoothstep(0.02, 0.06, mtl)) * (1.0 - skinK) * uCloth;
          clothSheen = mix(diffuseColor.rgb, vec3(0.5), 0.35) * 0.9;
        }
        // close up (the arms round the rifle, a man at arm's length; the atlas is stretched over the
        // whole of him): the weave of the wool, ~2.5 mm, and the fine grain of the skin, from the
        // three sides of his own space blended by which way the surface faces; gone by 3 m
        skK = uCloseUp * (1.0 - smoothstep(1.2, 3.0, length(vViewPosition))) * max(clothK, skinK);
        if (skK > 0.01) {
          skW = pow(abs(normalize(vSkN)), vec3(4.0));
          skW /= dot(skW, vec3(1.0));
          vec3 pf = vSkP / 0.12, pg = vSkP / 0.15;
          float wool = step(skinK, clothK);
          skX = mix(texture2D(tGrain, pg.zy), texture2D(tFabric, pf.zy), wool);
          skY = mix(texture2D(tGrain, pg.xz), texture2D(tFabric, pf.xz), wool);
          skZ = mix(texture2D(tGrain, pg.xy), texture2D(tFabric, pf.xy), wool);
          float d = skX.a * skW.x + skY.a * skW.y + skZ.a * skW.z;
          diffuseColor.rgb *= mix(1.0, mix(0.7 + 0.6 * d, 0.45 + 1.1 * d, wool), skK);
        }`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        if (uSkinDebug > 0.5) gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(4.0, 0.0, 0.0), skinK);
        if (uSkinDebug > 1.5) gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.0, 4.0, 0.0), clothK);`)
        // wet wool darkens but does not turn glossy
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        roughnessFactor = max(roughnessFactor, 0.72 * clothK);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (skK > 0.01) {
          // each side's relief turned onto the surface by its coordinates' frame on the screen
          float k = skK * mix(0.45, 1.3, step(skinK, clothK));
          vec3 nX = cotangentFrame(normal, -vViewPosition, vSkP.zy) * normalize(vec3((skX.xy * 2.0 - 1.0) * k, 1.0));
          vec3 nY = cotangentFrame(normal, -vViewPosition, vSkP.xz) * normalize(vec3((skY.xy * 2.0 - 1.0) * k, 1.0));
          vec3 nZ = cotangentFrame(normal, -vViewPosition, vSkP.xy) * normalize(vec3((skZ.xy * 2.0 - 1.0) * k, 1.0));
          normal = normalize(nX * skW.x + nY * skW.y + nZ * skW.z);
        }`);
    }
    if (smoulder) {
      // round its fire, the charred wood and metal smoulders: glowing cracks in what is darkest,
      // breathing slowly, brighter the nearer the flames
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
        uniform vec4 uFires[4];
        vec2 smHash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
        // the char's cracks: how near the border between two of its cells (0 on it), and the cell's id
        vec2 smCracks(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          float d1 = 8.0, d2 = 8.0, id = 0.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y)), o = smHash2(i + g);
            float d = length(g + o - f);
            if (d < d1) { d2 = d1; d1 = d; id = dot(i + g, vec2(7.0, 113.0)); } else if (d < d2) d2 = d;
          }
          return vec2(d2 - d1, id);
        }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float heat = 0.0;
          for (int i = 0; i < 4; i++) {
            vec4 f = uFires[i];
            if (f.w <= 0.0) continue;
            float d = length(vWPosM - f.xyz);
            heat = max(heat, 1.0 - smoothstep(0.3 * f.w, 2.4 * f.w, d));
          }
          if (heat > 0.0) {
            float charred = 1.0 - smoothstep(0.025, 0.09, dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)));
            vec2 q = vWPosM.xz * 9.0 + vWPosM.y * vec2(6.1, -4.3);
            vec2 cr = smCracks(q);
            float breathe = 0.5 + 0.5 * sin(uTime * (0.9 + 0.5 * fract(cr.y * 0.37)) + cr.y);
            ${smoulder === 'wood'
              ? `// charred wood: the char's alligator cracks glowing, a dull red under them, each cell
            // breathing on its own
            float crack = 1.0 - smoothstep(0.02, 0.09, cr.x);
            totalEmissiveRadiance += vec3(1.0, 0.22, 0.03) * (crack * 1.3 * breathe + 0.07) * charred * heat * heat;`
              : `// hot metal: a dull red glow, mottled, strongest nearest the flames
            float mottle = 0.6 + 0.4 * smoothstep(0.0, 0.3, cr.x);
            totalEmissiveRadiance += vec3(1.0, 0.16, 0.02) * 0.32 * mottle * (0.75 + 0.25 * breathe) * charred * heat * heat * heat;`}
          }
        }`);
    }
    if (rooms) {
      // the room behind the pane (instead of the baked glow), seen through old glass which
      // takes little light itself; running rain bends the view. The curtains drawn back in
      // front of it (no room) glow less, as cloth with a lamp behind it
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rmFw = length(fwidth(vWin.xy));
        if (vWin.z == 0.0) totalEmissiveRadiance *= uCurtainGain;
        else {
          vec3 wn = normalize(vWNormalM);
          vec3 wt = normalize(vec3(wn.z, 0.0, -wn.x));
          vec3 wb = cross(wn, wt);
          vec3 vd = normalize(vWPosM - cameraPosition);
          float seed = floor(vWin.w / 16.0);
          vec2 pw = vWin.xy;
          ${streaks ? 'pw.x += mRivX * mRiv * 0.05;' : ''}
          vec2 hs = vec2(vWin.z, vWin.w - 16.0 * seed);
          // rain beaded on the glass bends the view through it (each bead a little lens), its rim bright
          vec3 drops = rmDrops(vWin.xy, uTime, rmFw) * uWet;
          vec3 rd = vec3(dot(vd, wt), dot(vd, wb), -dot(vd, wn));
          rd = normalize(vec3(rd.xy + drops.xy * 0.6 * rd.z, rd.z));
          vec3 room = rmRoom(pw, rd, hs, seed, uTime);
          totalEmissiveRadiance = rmLace(room, vWin.xy, hs, seed, rmFw) * (1.0 - 0.35 * drops.z)
            + (room + vec3(0.02, 0.016, 0.012)) * drops.z * 0.9;
          diffuseColor.rgb *= 0.15;
        }`);
    }
    if (foliage) {
      // foliage: some light comes through the leaves, and a card lights the
      // same from both sides (its normals point out of the crown). Every light
      // also shines through them: onto the back of a card, and most where the
      // eye looks towards the light through the leaves (a crown between you and
      // a fire, a lamp or a flare glows at its edges), tinted by the leaf and its
      // baked occlusion (the inside of a crown is dark) and by the light's own
      // shadow where it has one
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
        uniform float uLeafTrans;
        float leafThin = 1.0;          // how thin the foliage is here (its baked occlusion, squared)
        void RE_Direct_Leaf(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal,
            const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
          RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
          float through = 0.12 * saturate(dot(-geometryNormal, directLight.direction))
            + pow(saturate(dot(-geometryViewDir, directLight.direction)), 8.0) * 1.4;
          reflectedLight.directDiffuse += directLight.color * BRDF_Lambert(material.diffuseColor) * through * leafThin * uLeafTrans;
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Leaf`)
        .replace('#include <lights_fragment_begin>', `
        #ifdef USE_COLOR
          leafThin = vColor.g * vColor.g;
        #endif
        #include <lights_fragment_begin>`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.12;`)
        .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
    }
    if (!glints) dimFillSpecular(shader);
  };
}

/* The river: opaque, murky, reflective; long low swells drawn out along the
   current with a finer chop over them, carried downstream (value noise and
   its slope, three octaves: no texture, whose straight cracks showed as
   creases across the water), and the rain's rings, small and many, where
   they are big enough to see; further off the rain only roughens it. It
   knows its own depth (the ground map's height, groundmap.js, through the
   grass map shared with the terrain): where it laps the bank a thin, broken
   line of scum drifts with the current, matte and reflecting nothing, and in
   the shallows it is browner, the bed showing through. A pond (ponds.js) is
   the same, still. */
export function createWaterMaterial(textures, shared, { flow = [1, 0] } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1d2420'), roughness: 0.16, metalness: 0.0 });
  mat.name = 'water';
  mat.envMapIntensity = 1.3;
  mat.customProgramCacheKey = () => 'hedgerow-water';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uTime: shared.time, uRain: shared.rain, uFlow: { value: new THREE.Vector2(flow[0], flow[1]) },
      // the ground under it: its height is the map's alpha (groundmap.js)
      tGroundW: shared.grassMap || { value: null }, uGroundMinW: shared.grassMin || { value: new THREE.Vector2() },
      uGroundSizeW: shared.grassSize || { value: new THREE.Vector2(1, 1) },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPosW;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWPosW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uRain;
        uniform vec2 uFlow, uGroundMinW, uGroundSizeW;
        uniform sampler2D tGroundW;
        varying vec3 vWPosW;
        float wFoam;
        ${GLSL_HELPERS}
        float vnoiseW(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        // value noise and its slope (Inigo Quilez's)
        vec3 vnoiseDW(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
          float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
          return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y, du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx));
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 p = vWPosW.xz;
          vec2 gm = (p - uGroundMinW) / uGroundSizeW;
          float bed = texture2D(tGroundW, gm).w, depth = vWPosW.y - bed;
          // the shallows: browner, the bed showing through
          float shallow = 1.0 - smoothstep(0.05, 0.75, depth);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.04, 0.026), shallow * 0.75);
          // a thin, broken line of scum where it laps the bank, drifting with the current: so many
          // centimetres from the water's edge (the depth over how steeply the bed rises there), not
          // so deep, or on a gentle bank (a shallow crater's) it spread into a wide pale band
          vec2 drift = uFlow * uTime * 0.35;
          float fn = vnoiseW(p * 3.1 - drift * 3.1) * 0.55 + vnoiseW(p * 7.7 - drift * 6.0) * 0.45;
          vec2 rise = vec2(texture2D(tGroundW, gm + vec2(0.25, 0.0) / uGroundSizeW).w, texture2D(tGroundW, gm + vec2(0.0, 0.25) / uGroundSizeW).w) - bed;
          float fromEdge = depth / max(length(rise) * 4.0, 0.04);
          float lap = 1.0 - smoothstep(0.0, 0.1 + 0.04 * sin(uTime * 1.3 + p.x * 0.7), fromEdge);
          wFoam = lap * smoothstep(0.45, 0.7, fn + lap * 0.15) * 0.75;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.095, 0.08), wFoam);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.75, wFoam);
        // where the rain's rings are too small to draw, they still roughen it
        roughnessFactor += 0.1 * uRain * (1.0 - rippleFade(length(vViewPosition)));`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec2 p = vWPosW.xz;
          // the slope of three octaves, each stretched along the current and carried down it at its own
          // speed (the finer, the faster), the second and third turned so the noise's grid does not line up
          vec2 st = mix(vec2(1.0), vec2(0.55, 1.0), min(1.0, length(uFlow)));
          mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
          vec2 g = vnoiseDW(p * st * 0.35 - uFlow * uTime * 0.18).yz * st * 0.35 * 0.6;
          g += st * 0.9 * 0.35 * (transpose(turn) * vnoiseDW(turn * (p * st * 0.9) - uFlow * uTime * 0.55 + 4.7).yz);
          g += st * 2.3 * 0.16 * (turn * vnoiseDW(transpose(turn) * (p * st * 2.3) - uFlow * uTime * 1.9 + vec2(9.1, 2.3)).yz);
          vec3 nts = vec3(-g * 0.14, 1.0);
          nts.xy += rainRipples(p * 1.5, uTime, rippleFade(length(vViewPosition))) * uRain * 0.8;
          mat3 tbn = cotangentFrame(normal, -vViewPosition, p);
          normal = normalize(tbn * normalize(nts));
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // the night's fill light is a sky, not a moon: no white-hot glint of it on still
        // water (the lamps' and the fires' reflections come mostly from the screen anyway)
        reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(1.2));`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        #ifdef OPAQUE
          gl_FragColor.a = mirrorAlpha(mix(0.07, 0.8, wFoam), 1.0);
        #endif`);
    dimFillSpecular(shader);
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
