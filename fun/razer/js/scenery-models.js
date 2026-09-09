import { GLTFLoader } from '../assets/vendor/three-addons/loaders/GLTFLoader.js';

// Assets are deliberately self-contained GLB files. No CDN, external image
// request, decoder or build step is needed when a generated course is loaded.
const ASSETS = {
  boulder: { file: 'boulder.glb', label: 'Scanned sandstone boulders' },
  deadwood: { file: 'deadwood.glb', label: 'Fallen woodland trunks' },
};

/**
 * Load the reusable scenery prototypes once, before the static shadow bake.
 * The largest bounding-box extent is normalized to 1; X/Z are centered, Y=0
 * rests on the ground. A placement's scalar `scale` is its maximum size in metres.
 *
 * geometry(g), material(color, extras), keepTexture(t) are the renderer's normal
 * resource factories. dispose() releases instance buffers and ImageBitmaps;
 * geometries/materials/textures remain owned by those factories when provided.
 */
export async function loadSceneryModels(THREE, { geometry, material, keepTexture, renderer, onProgress = () => {} } = {}) {
  const prototypes = {}, dimensions = {}, sources = {}, failures = {};
  const ownedGeometries = new Set(), ownedMaterials = new Set(), ownedTextures = new Set();
  const imageBitmaps = new Set(), instanceGroups = new Set();
  const registeredGeometry = g => { ownedGeometries.add(g); return geometry ? geometry(g) : g; };
  const registeredTexture = t => { ownedTextures.add(t); return keepTexture ? keepTexture(t) : t; };
  const anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 4);
  const loader = new GLTFLoader();
  let disposed = false;
  function registerMaterial(source) {
    const result = material ? material(source.color || '#ffffff') : new THREE.MeshStandardMaterial();
    result.copy(source);
    // The scans are closed opaque props. One-sided rendering avoids shading
    // interior backsides and keeps the static shadow pass inexpensive.
    result.side = THREE.FrontSide;
    if (result.normalScale) result.normalScale.set(.72, .72);
    // Both shipped scans pack ambient occlusion, roughness and metalness in
    // R/G/B. Reuse that texture's red channel for natural crevice occlusion.
    if (!result.aoMap && result.roughnessMap && result.roughnessMap === result.metalnessMap) {
      result.aoMap = result.roughnessMap; result.aoMapIntensity = .75;
    }
    ownedMaterials.add(result);
    for (const value of Object.values(result)) {
      if (!value?.isTexture || ownedTextures.has(value)) continue;
      value.anisotropy = anisotropy; value.needsUpdate = true;
      registeredTexture(value);
      if (typeof value.image?.close === 'function') imageBitmaps.add(value.image);
    }
    return result;
  }
  async function load(kind) {
    const gltf = await loader.loadAsync(new URL(`../assets/models/${ASSETS[kind].file}`, import.meta.url).href);
    const scene = gltf.scene; scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3()), span = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(span) || span <= 0) throw new Error(`Empty scenery model: ${kind}`);
    const normalize = new THREE.Matrix4().makeScale(1 / span, 1 / span, 1 / span)
      .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
    const parts = [], materialCache = new Map(), originalGeometries = new Set(), originalMaterials = new Set();
    scene.traverse(object => {
      if (!object.isMesh) return;
      const g = object.geometry.clone().applyMatrix4(object.matrixWorld).applyMatrix4(normalize);
      g.computeBoundingBox(); g.computeBoundingSphere();
      originalGeometries.add(object.geometry);
      const original = Array.isArray(object.material) ? object.material : [object.material];
      const converted = original.map(source => {
        originalMaterials.add(source);
        if (!materialCache.has(source)) materialCache.set(source, registerMaterial(source));
        return materialCache.get(source);
      });
      parts.push({ geometry: registeredGeometry(g), material: Array.isArray(object.material) ? converted : converted[0] });
    });
    for (const g of originalGeometries) g.dispose();
    for (const m of originalMaterials) m.dispose();
    prototypes[kind] = parts;
    dimensions[kind] = { original: size.toArray(), normalized: size.divideScalar(span).toArray() };
    sources[kind] = ASSETS[kind].file;
  }
  const kinds = Object.keys(ASSETS);
  const loaded = await Promise.allSettled(kinds.map(kind => load(kind)));
  for (let index = 0; index < kinds.length; index++) {
    const kind = kinds[index];
    if (loaded[index].status === 'rejected') failures[kind] = String(loaded[index].reason?.message || loaded[index].reason);
    onProgress((index + 1) / kinds.length, ASSETS[kind].label);
  }
  const matrixObject = new THREE.Object3D();
  function instantiate(kind, placements, parent, { castShadow = true, receiveShadow = true } = {}) {
    const group = new THREE.Group(); group.name = `scenery-${kind}`;
    if (disposed || !prototypes[kind]?.length || !placements?.length) return group;
    const matrices = [];
    for (const placement of placements) {
      if (![placement.x, placement.y, placement.z].every(Number.isFinite)) continue;
      matrixObject.position.set(placement.x, placement.y, placement.z);
      const rotation = placement.rotation ?? placement.yaw ?? 0;
      if (Array.isArray(rotation)) matrixObject.rotation.set(...rotation);
      else matrixObject.rotation.set(0, Number.isFinite(rotation) ? rotation : 0, 0);
      const scale = placement.scale ?? 1;
      if (Array.isArray(scale)) matrixObject.scale.set(...scale);
      else if (typeof scale === 'object') matrixObject.scale.set(scale.x, scale.y, scale.z);
      else matrixObject.scale.setScalar(scale);
      if (!matrixObject.scale.toArray().every(n => Number.isFinite(n) && n > 0)) continue;
      matrixObject.updateMatrix(); matrices.push(matrixObject.matrix.clone());
    }
    if (!matrices.length) return group;
    for (const part of prototypes[kind]) {
      const batch = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
      batch.name = `scenery-${kind}-instances`;
      for (let index = 0; index < matrices.length; index++) batch.setMatrixAt(index, matrices[index]);
      batch.instanceMatrix.needsUpdate = true;
      batch.castShadow = castShadow; batch.receiveShadow = receiveShadow;
      batch.computeBoundingBox(); batch.computeBoundingSphere();
      group.add(batch);
    }
    group.userData.instanceCount = matrices.length;
    diagnostics.instances[kind] += matrices.length;
    diagnostics.instanceCount += matrices.length;
    diagnostics.instancedDrawCalls += prototypes[kind].length;
    diagnostics.usedModels = Object.values(diagnostics.instances).filter(count => count > 0).length;
    instanceGroups.add(group); parent?.add(group);
    return group;
  }
  const diagnostics = {
    loadedModels: Object.keys(prototypes).length,
    usedModels: 0, instanceCount: 0, instancedDrawCalls: 0,
    instances: Object.fromEntries(kinds.map(kind => [kind, 0])),
    prototypeTriangles: Object.fromEntries(Object.entries(prototypes).map(([kind, parts]) => [kind,
      parts.reduce((sum, part) => sum + (part.geometry.index?.count || part.geometry.attributes.position.count) / 3, 0)])),
    sources, failures,
  };
  return {
    models: prototypes, dimensions, diagnostics, instantiate,
    dispose() {
      if (disposed) return; disposed = true;
      for (const group of instanceGroups) {
        group.removeFromParent();
        for (const child of group.children) child.dispose?.();
        group.clear();
      }
      for (const bitmap of imageBitmaps) bitmap.close();
      if (!geometry) for (const g of ownedGeometries) g.dispose();
      if (!material) for (const m of ownedMaterials) m.dispose();
      if (!keepTexture) for (const t of ownedTextures) t.dispose();
      imageBitmaps.clear(); instanceGroups.clear();
      ownedGeometries.clear(); ownedMaterials.clear(); ownedTextures.clear();
    },
  };
}
