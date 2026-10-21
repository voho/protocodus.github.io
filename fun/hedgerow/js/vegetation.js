/* Hedgerow — instanced vegetation with distance LOD and CPU culling.

   Trees, bushes, rocks and ground cover are InstancedMeshes. Every few
   frames each kind's placements are sorted into "near" (full model), "mid"
   (its thinned _mid model, when there is one, from `midNear` metres; big
   trees a little further) and "far" (its _lod impostor) by distance to the
   camera, dropping the ones behind the camera or beyond the fog, and the
   instance buffers are refilled. Ground cover (grass, ferns, reeds) only exists in
   a radius around the camera. */

import * as THREE from 'three';

export function createVegetation(library, matlib, { near = 60, far = 175, coverRadius = 34, midNear = 22 } = {}) {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const kinds = new Map();      // model name -> kind
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let timer = 0;

  function meshesFor(model, capacity) {
    return model.prims.map((p) => {
      const m = new THREE.InstancedMesh(p.geometry, matlib.resolve(p.material), capacity);
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.name = model.name + ':' + p.key;
      group.add(m);
      return m;
    });
  }

  function kindOf(name, cover) {
    let k = kinds.get(name);
    if (k) return k;
    const model = library.get(name);
    if (!model) return null;
    k = { name, model, lod: library.get(name + '_lod') || null, mid: library.get(name + '_mid') || null, items: [], cover,
      nearMeshes: null, midMeshes: null, farMeshes: null, radius: 0, midD: midNear };
    const sz = new THREE.Vector3();
    model.box.getSize(sz);
    k.radius = Math.max(sz.x, sz.y, sz.z) * 0.6;
    // the tall ones keep their full detail a little further out
    if (sz.y > 20) k.midD = midNear * 1.25;
    kinds.set(name, k);
    return k;
  }

  /* Add one placement. */
  function add(name, x, y, z, yaw = 0, scale = 1, { cover = false, tilt = null } = {}) {
    const k = kindOf(name, cover);
    if (!k) return false;
    tmpQ.setFromAxisAngle(up, yaw);
    if (tilt) {
      const t = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt[0], 0, tilt[1]));
      tmpQ.premultiply(t);
    }
    tmpS.setScalar(scale);
    tmpP.set(x, y, z);
    const m = new THREE.Matrix4().compose(tmpP, tmpQ, tmpS);
    k.items.push({ x, y, z, m, r: k.radius * scale });
    return true;
  }

  function finalize() {
    for (const k of kinds.values()) {
      const n = k.items.length;
      k.nearMeshes = meshesFor(k.model, n);
      if (k.lod && !k.cover) k.farMeshes = meshesFor(k.lod, n);
      if (k.mid && !k.cover) k.midMeshes = meshesFor(k.mid, n);
    }
  }

  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const sphere = new THREE.Sphere();

  function update(dt, camera, settings) {
    timer -= dt;
    if (timer > 0) return;
    timer = 0.12;
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    const cx = camera.position.x, cz = camera.position.z;
    const nearD = settings?.treeNear ?? near;
    const coverD = coverRadius * Math.sqrt(settings?.grass ?? 1);
    const coverDensity = settings?.grass ?? 1;
    for (const k of kinds.values()) {
      let nN = 0, nM = 0, nF = 0;
      const limit = k.cover ? coverD : far;
      const midD2 = k.midMeshes ? Math.min(k.midD, nearD) ** 2 : Infinity;
      for (let i = 0; i < k.items.length; i++) {
        const it = k.items[i];
        const dx = it.x - cx, dz = it.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > (limit + it.r) * (limit + it.r)) continue;
        if (k.cover && coverDensity < 1 && (i % 10) / 10 >= coverDensity) continue;
        sphere.center.set(it.x, it.y + it.r * 0.6, it.z);
        sphere.radius = it.r * 1.2;
        if (!frustum.intersectsSphere(sphere)) continue;
        if (!k.farMeshes || d2 < nearD * nearD) {
          if (d2 < midD2) {
            for (const m of k.nearMeshes) m.setMatrixAt(nN, it.m);
            nN++;
          } else {
            for (const m of k.midMeshes) m.setMatrixAt(nM, it.m);
            nM++;
          }
        } else {
          for (const m of k.farMeshes) m.setMatrixAt(nF, it.m);
          nF++;
        }
      }
      for (const m of k.nearMeshes) { m.count = nN; m.instanceMatrix.needsUpdate = true; }
      if (k.midMeshes) for (const m of k.midMeshes) { m.count = nM; m.instanceMatrix.needsUpdate = true; }
      if (k.farMeshes) for (const m of k.farMeshes) { m.count = nF; m.instanceMatrix.needsUpdate = true; }
    }
  }

  function stats() {
    let inst = 0, tris = 0;
    for (const k of kinds.values()) {
      for (const m of [...(k.nearMeshes || []), ...(k.midMeshes || []), ...(k.farMeshes || [])]) {
        inst += m.count;
        tris += m.count * (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      }
    }
    return { inst, tris: Math.round(tris) };
  }

  return { group, add, finalize, update, kinds, stats, forceUpdate() { timer = 0; } };
}
