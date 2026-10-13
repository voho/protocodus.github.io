/* Meteora — the Blender-made models, loaded when they are needed.

   The five rocks load first, with the belt. Ships load on demand: the menu
   asks for what it shows, a briefing for what its mission flies, and the
   rest trickle in behind. A model that fails to load (or has not been built
   yet) is replaced by a plain stand-in of the right size, with a warning in
   the console — a missing file must never stop a mission.

   Large hulls get a detail layer in the shader: a tileable panel texture
   projected tri-planar in the model's own space, sixteen to thirty-two
   metres to a tile, that bumps the normals and varies the paint. It fades
   in as the camera comes close, so a kilometre-long hull still has plating
   when a fighter skims it, where the baked textures alone are a blur, and
   it fades out wherever its texels shrink below a pixel, so it never
   shimmers. */

import * as THREE from 'three';
import { GLTFLoader } from '../assets/vendor/GLTFLoader.js';
import { hardpoints } from './hardpoints.js';

const BASE = new URL('../assets/models/', import.meta.url);
const ROCK_FILES = [1, 2, 3, 4, 5].map(n => `asteroid_${n}.glb`);
export const SHIP_MODELS = [
  'fighter', 'interceptor', 'swift', 'anvil', 'maul', 'mite', 'talon', 'drone', 'torpedo', 'sentry', 'seed', 'anchor',
  'shuttle', 'freighter', 'station', 'perpetua', 'colony', 'mother', 'warden', 'halberd',
];
const LARGE = new Set(['freighter', 'station', 'perpetua', 'colony', 'mother', 'warden', 'halberd', 'anchor', 'seed']);
const HARROW = new Set(['interceptor', 'maul', 'mite', 'talon', 'sentry', 'seed', 'anchor', 'mother', 'warden']);

function firstMesh(object) {
  let mesh = null;
  object?.traverse(o => { if (!mesh && o.isMesh) mesh = o; });
  return mesh;
}

function prepareRock(gltf, file) {
  const lod0 = firstMesh(gltf.scene.getObjectByName('lod0'));
  const lod1 = firstMesh(gltf.scene.getObjectByName('lod1')) ?? lod0;
  if (!lod0) throw new Error(`${file}: no lod0 mesh`);
  for (const mesh of lod1 === lod0 ? [lod0] : [lod0, lod1]) {
    // The renderer places and tumbles rocks itself, so the node's rotation
    // and scale are baked into the geometry once; where the two LODs sat
    // side by side in Blender does not matter.
    mesh.updateWorldMatrix(true, false);
    mesh.geometry.applyMatrix4(new THREE.Matrix4().copy(mesh.matrixWorld).setPosition(0, 0, 0));
    let r = 0;
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) r = Math.max(r, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
    mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), r);
  }
  return { lod0: lod0.geometry, lod1: lod1.geometry, material: lod0.material };
}

/* ---------- the hull detail layer ---------- */

let detailTexture = null;
function panelTexture() {
  if (detailTexture) return detailTexture;
  // A tileable height field of plates: rectangles of random sizes, grooved
  // edges, a few rivet rows and fine grain, packed into one channel.
  const N = 256, data = new Uint8Array(N * N * 4);
  const h = new Float32Array(N * N).fill(0.55);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const plate = (x0, y0, w, hgt, level) => {
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
      const X = (x0 + x) % N, Y = (y0 + y) % N;
      const edge = Math.min(x, y, w - 1 - x, hgt - 1 - y);
      h[Y * N + X] = edge < 1 ? 0.18 : edge < 2 ? 0.4 : level;
    }
  };
  for (let k = 0; k < 90; k++) plate(Math.floor(rnd() * N), Math.floor(rnd() * N), 16 + Math.floor(rnd() * 64), 12 + Math.floor(rnd() * 48), 0.5 + rnd() * 0.25);
  for (let k = 0; k < 40; k++) {
    const y = Math.floor(rnd() * N), x0 = Math.floor(rnd() * N), n = 4 + Math.floor(rnd() * 10);
    for (let i = 0; i < n; i++) { const X = (x0 + i * 6) % N; h[y * N + X] = 0.95; h[((y + 1) % N) * N + X] = 0.85; }
  }
  for (let i = 0; i < N * N; i++) {
    const v = Math.max(0, Math.min(1, h[i] + (rnd() - 0.5) * 0.01));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.round(v * 255);
    data[i * 4 + 3] = 255;
  }
  detailTexture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  detailTexture.wrapS = detailTexture.wrapT = THREE.RepeatWrapping;
  detailTexture.magFilter = THREE.LinearFilter;
  detailTexture.minFilter = THREE.LinearMipmapLinearFilter;
  detailTexture.generateMipmaps = true;
  detailTexture.needsUpdate = true;
  return detailTexture;
}

function addHullDetail(material, tile) {
  if (material.userData.detail) return;
  material.userData.detail = true;
  const tex = panelTexture();
  material.onBeforeCompile = shader => {
    shader.uniforms.uDetail = { value: tex };
    shader.uniforms.uTile = { value: 1 / tile };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvObjNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vObjPos;
varying vec3 vObjNormal;
uniform sampler2D uDetail;
uniform float uTile;
float meteoraDetail(vec3 p, vec3 n) {
  vec3 w = pow(abs(normalize(n)), vec3(4.0));
  w /= (w.x + w.y + w.z);
  return texture2D(uDetail, p.yz * uTile).r * w.x + texture2D(uDetail, p.xz * uTile).r * w.y + texture2D(uDetail, p.xy * uTile).r * w.z;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // Only where a texel of the panel map still covers about a pixel: finer
  // than that, the bump can only shimmer, so it fades out with the
  // footprint as well as with distance.
  float footprint = length(fwidth(vObjPos)) * uTile * 256.0;
  float fade = (1.0 - smoothstep(60.0, 900.0, -vViewPosition.z)) * (1.0 - smoothstep(1.0, 3.0, footprint));
  if (fade > 0.0) {
    float hgt = meteoraDetail(vObjPos, vObjNormal);
    vec2 dh = vec2(dFdx(hgt), dFdy(hgt)) * 3.0 * fade;
    vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
    vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
    float det = dot(dpx, r1);
    vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
    normal = normalize(abs(det) * normal - grad);
    diffuseColor.rgb *= mix(1.0, 0.82 + 0.3 * hgt, fade);
  }
}`);
  };
  material.customProgramCacheKey = () => `meteora-hull-${tile}`;
  material.needsUpdate = true;
}

/* ---------- templates ---------- */

const NODE_KEYS = ['ring', 'drive', 'reactor', 'eye', 'emitter', 'rock', 'arm_L', 'arm_R', 'shield_0', 'shield_1'];

function prepareShip(model, scene) {
  const large = LARGE.has(model);
  const size = hardpoints(model).radius || 10;
  scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = !large;
    o.receiveShadow = true;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of materials) {
      m.envMapIntensity = large ? 0.45 : 0.6;
      if (m.emissiveMap || m.emissive?.getHex()) m.emissiveIntensity = large ? 3.5 : 3;
      if (large && size > 50 && m.map) addHullDetail(m, size > 300 ? 32 : 16);
    }
  });
  return { model, scene, large, harrow: HARROW.has(model) };
}

/* Something to draw when a model is missing: a wedge for small craft, a
   long hull of the right size for large ones. */
function placeholder(model) {
  const hp = hardpoints(model);
  const length = Math.max(2, hp.length || hp.radius * 2 || 10);
  const harrow = HARROW.has(model);
  const material = new THREE.MeshStandardMaterial({
    color: harrow ? 0x4a2024 : 0xbdb8ae, metalness: 0.5, roughness: 0.55,
    emissive: harrow ? 0x400000 : 0x000000,
  });
  const scene = new THREE.Group();
  const geometry = LARGE.has(model)
    ? new THREE.CapsuleGeometry(length * 0.14, length * 0.7, 4, 12).rotateX(Math.PI / 2)
    : new THREE.ConeGeometry(length * 0.22, length, 4).rotateX(-Math.PI / 2);
  scene.add(new THREE.Mesh(geometry, material));
  return { model, scene, large: LARGE.has(model), harrow, placeholder: true };
}

export function createModelLibrary({ onError = null } = {}) {
  const loader = new GLTFLoader();
  const pending = new Map(), ready = new Map();
  let rocks = null;

  const fetchModel = model => {
    if (pending.has(model)) return pending.get(model);
    const promise = loader.loadAsync(new URL(`${model}.glb`, BASE).href)
      .then(gltf => prepareShip(model, gltf.scene))
      .catch(error => {
        console.warn(`meteora: ${model}.glb could not be loaded; drawing a stand-in`, error);
        onError?.(model, error);
        return placeholder(model);
      })
      .then(t => { ready.set(model, t); return t; });
    pending.set(model, promise);
    return promise;
  };

  return {
    get rocks() { return rocks; },
    async loadRocks(onProgress) {
      let done = 0;
      const all = await Promise.all(ROCK_FILES.map(file => loader.loadAsync(new URL(file, BASE).href)
        .then(gltf => { onProgress?.(++done / ROCK_FILES.length, file); return prepareRock(gltf, file); })
        .catch(error => { throw Object.assign(new Error(`Could not load ${file}`), { file, cause: error }); })));
      rocks = all;
      return rocks;
    },
    load: fetchModel,
    /* Load several, reporting progress as each lands. */
    async preload(models, onProgress) {
      const list = [...new Set(models.filter(m => m && !m.startsWith('rock:')))];
      let done = 0;
      await Promise.all(list.map(m => fetchModel(m).then(() => onProgress?.(++done / list.length, m))));
    },
    has: model => ready.has(model) || (model?.startsWith('rock:') && !!rocks),
    /* A fresh object for one entity, and handles to its animated nodes.
       Null while the model is still on its way. */
    instantiate(model) {
      if (!model) return null;
      if (model.startsWith('rock:')) {
        if (!rocks) return null;
        const r = rocks[Number(model.slice(5))];
        const mesh = new THREE.Mesh(r.lod0, r.material);
        mesh.castShadow = false; mesh.receiveShadow = true;
        const group = new THREE.Group();
        group.add(mesh);
        return { root: group, nodes: {}, turrets: [], large: true, rock: true };
      }
      const t = ready.get(model);
      if (!t) { fetchModel(model); return null; }
      const root = t.scene.clone(true);
      const nodes = {}, turrets = [];
      root.traverse(o => {
        if (NODE_KEYS.includes(o.name)) nodes[o.name] = o;
        const m = /^turret_(\w+?)(_gun)?$/.exec(o.name);
        if (m && !m[2]) turrets.push({ name: o.name, node: o, gun: null, q0: o.quaternion.clone(), yaw: 0, pitch: 0 });
      });
      for (const tr of turrets) {
        const gun = root.getObjectByName(`${tr.name}_gun`);
        if (gun) { tr.gun = gun; tr.gq0 = gun.quaternion.clone(); }
      }
      return { root, nodes, turrets, large: t.large, harrow: t.harrow, placeholder: !!t.placeholder };
    },
  };
}

/* Bone-white paint for the Ninth Hand, and other per-entity tints: the
   materials are cloned so the template is untouched. */
export function tint(root, kind) {
  const colour = kind === 'bone' ? new THREE.Color(0.86, 0.84, 0.78) : kind === 'dark' ? new THREE.Color(0.35, 0.33, 0.32) : null;
  if (!colour) return;
  root.traverse(o => {
    if (!o.isMesh) return;
    o.material = (Array.isArray(o.material) ? o.material : [o.material]).map(m => {
      const c = m.clone();
      if (kind === 'bone') { c.color = colour.clone(); c.map = null; c.roughness = 0.45; }
      else c.color = c.color.clone().multiply(colour);
      return c;
    });
    if (o.material.length === 1) o.material = o.material[0];
  });
}
