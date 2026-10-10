/* Meteora — loading the Blender-made models.

   Seven GLBs, built by tools/blender and committed: the fighter, the
   interceptor and five rocks, each rock with a near and a far mesh. The
   game never starts with a model missing — a failed file stops the
   loading bar with its name and a Retry, rather than flying grey boxes. */

import * as THREE from 'three';
import { GLTFLoader } from '../assets/vendor/GLTFLoader.js';

const BASE = new URL('../assets/models/', import.meta.url);
const ROCK_FILES = [1, 2, 3, 4, 5].map(n => `asteroid_${n}.glb`);

function firstMesh(object) {
  let mesh = null;
  object?.traverse(o => { if (!mesh && o.isMesh) mesh = o; });
  return mesh;
}

function prepareShip(scene) {
  scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of materials) {
      m.envMapIntensity = 0.6;
      if (m.emissiveMap) m.emissiveIntensity = 3;
    }
  });
  return { scene };
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

// Debug builds only: a wedge standing in for a ship model that is still
// being regenerated, so the rest of the game can be worked on meanwhile.
function placeholderShip(length, color) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(length * 0.22, length, 4).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.5 }));
  const scene = new THREE.Group();
  scene.add(mesh);
  return { scene };
}

export async function loadModels(onProgress, { placeholders = false } = {}) {
  const loader = new GLTFLoader();
  const files = ['fighter.glb', 'interceptor.glb', ...ROCK_FILES];
  let done = 0;
  const load = file => loader.loadAsync(new URL(file, BASE).href)
    .then(gltf => { onProgress?.(++done / files.length, file); return gltf; })
    .catch(error => {
      if (placeholders && !file.startsWith('asteroid')) {
        console.warn(`meteora: ${file} missing, using a placeholder (debug only)`);
        return { scene: placeholderShip(file === 'fighter.glb' ? 14 : 11, file === 'fighter.glb' ? 0xd9d6cf : 0x5e1a1d).scene };
      }
      throw Object.assign(new Error(`Could not load ${file}`), { file, cause: error });
    });
  const [fighter, interceptor, ...rocks] = await Promise.all(files.map(load));
  return {
    fighter: prepareShip(fighter.scene),
    interceptor: prepareShip(interceptor.scene),
    rocks: rocks.map((gltf, i) => prepareRock(gltf, ROCK_FILES[i])),
  };
}

// Clones share geometry and materials with the template.
export const instantiateShip = template => template.scene.clone(true);
