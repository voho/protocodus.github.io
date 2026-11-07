/* Prague's authored glass can crack while its closed facade remains solid.
   Resolve the actual existing mesh at the incoming ray, then place a bounded
   non-emissive fracture and existing lit shards at that physical pane.
   Ballistic hits, colliders, source geometry and ambient-window materials
   stay owned by their existing systems. The fracture atlas is borrowed. */
import * as THREE from 'three';
import { worldColliders } from './assets.js';
import { rng } from './util.js';

const HOUSE = /^prague_(ochre|rose|gray|passage|damaged|old_classical|old_classical_attic|classical_sage|interwar)$/;
const key = c => c?.type === 'box' ? ['box', c.x, c.y, c.z, c.hx, c.hy, c.hz, c.yaw || 0].map(v => typeof v === 'number' ? Math.round(v * 1e5) : v).join(':') : null;

function createPragueGlassRegistry(props) {
  const probeMaterial = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
  const templates = new Map(), colliders = new Map(), ray = new THREE.Raycaster();
  const d = new THREE.Vector3(), n = new THREE.Vector3(), start = new THREE.Vector3();
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  let queries = 0, meshQueries = 0;
  function template(model) {
    if (templates.has(model)) return templates.get(model);
    const meshes = model.prims.filter(p => p.key !== 'marking_white').map(p => {
      const mesh = new THREE.Mesh(p.geometry, probeMaterial);
      mesh.userData.primitive = p;
      mesh.updateMatrixWorld(true);
      return mesh;
    });
    const boxes = new Map();
    for (const prim of model.prims) if (prim.key === 'glass') {
      const a = prim.geometry.attributes.position;
      if (prim.geometry.index || a.count % 36) throw new Error('Expected authored closed Prague glazing boxes');
      const all = [];
      for (let first = 0; first < a.count; first += 36) {
        const box = new THREE.Box3();
        for (let i = first; i < first + 36; i++) box.expandByPoint(new THREE.Vector3().fromBufferAttribute(a, i));
        all.push(box);
      }
      boxes.set(prim, all);
    }
    const result = { meshes, boxes };
    templates.set(model, result);
    return result;
  }
  for (const prop of props) {
    const model = prop.m;
    if (!model || !HOUSE.test(model.name)) continue;
    const scale = prop.scale || 1;
    q.setFromAxisAngle(up, prop.yaw || 0);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(prop.x, prop.y, prop.z), q, new THREE.Vector3(scale, scale, scale));
    const record = { prop, model, scale, matrix, inverse: matrix.clone().invert(), rotation: q.clone(), template: template(model) };
    for (const collider of worldColliders(model, prop.x, prop.y, prop.z, prop.yaw || 0, scale)) colliders.set(key(collider), record);
  }
  return {
    stats: () => ({ templates: templates.size, colliderKeys: colliders.size,
      meshes: [...templates.values()].reduce((n, t) => n + t.meshes.length, 0),
      panes: [...templates.values()].reduce((n, t) => n + [...t.boxes.values()].reduce((m, b) => m + b.length, 0), 0),
      renderedDraws: 0, geometryBytes: 0, queries, meshQueries }),
    at(hit, direction) {
      queries++;
      if (!hit || !direction || !['stone', 'wood', 'concrete'].includes(hit.surface)) return null;
      const record = colliders.get(key(hit.collider));
      if (!record) return null;
      n.set(hit.nx, hit.ny, hit.nz).transformDirection(record.inverse);
      if (Math.abs(n.y) > .01 || Math.abs(n.z) < .99) return null;
      d.copy(direction).normalize();
      const into = -(d.x * hit.nx + d.y * hit.ny + d.z * hit.nz);
      if (into <= .01) return null;
      const front = n.z > 0 ? record.model.box.max.z : -record.model.box.min.z;
      const retreat = Math.min(hit.t ?? Infinity, Math.min(16, (front - 5 + .08) * record.scale / into));
      start.set(hit.x, hit.y, hit.z).addScaledVector(d, -retreat).applyMatrix4(record.inverse);
      d.transformDirection(record.inverse);
      ray.set(start, d); ray.near = 0; ray.far = retreat / record.scale + .001;
      meshQueries++;
      const first = ray.intersectObjects(record.template.meshes, false)[0];
      if (!first || first.object.userData.primitive.key !== 'glass' || Math.abs(first.face.normal.z) < .99) return null;
      const primitive = first.object.userData.primitive;
      const box = record.template.boxes.get(primitive)[Math.floor(first.faceIndex / 12)];
      const sign = Math.sign(first.face.normal.z), frontZ = sign > 0 ? box.max.z : box.min.z;
      const localCentre = box.getCenter(new THREE.Vector3()).setZ(frontZ);
      const centre = localCentre.applyMatrix4(record.matrix);
      const facing = new THREE.Vector3(0, 0, sign).applyQuaternion(record.rotation);
      const tangent = new THREE.Vector3(sign, 0, 0).applyQuaternion(record.rotation);
      const point = first.point.clone().applyMatrix4(record.matrix);
      return { x: point.x, y: point.y, z: point.z, n: facing, c: centre, T: tangent, B: new THREE.Vector3(0, 1, 0),
        hw: (box.max.x - box.min.x) * record.scale / 2, hh: (box.max.y - box.min.y) * record.scale / 2,
        lit: false, feedbackSurface: 'glass', prop: record.prop, sourceFace: first.faceIndex,
        paneID: record.model.name + ':' + record.prop.x + ':' + record.prop.z + ':' + Math.floor(first.faceIndex / 12) };
    },
    dispose() { probeMaterial.dispose(); templates.clear(); colliders.clear(); },
  };
}

function createDarkGlassFractures(atlas, { capacity = 48 } = {}) {
  if (!atlas?.isTexture) throw new Error('Borrow the existing glass decal atlas');
  const geometry = new THREE.PlaneGeometry(1, 1);
  const cells = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  const limits = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  geometry.setAttribute('aCell', cells); geometry.setAttribute('aPaneClip', limits);
  const material = new THREE.MeshStandardMaterial({ map: atlas, color: 0xc6d3d3, roughness: .38,
    metalness: 0, transparent: true, opacity: 1, depthWrite: false, depthTest: true });
  material.name = 'prague-dark-glass-fractures';
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCell;\nattribute vec4 aPaneClip;\nvarying vec2 vFractureXY;\nvarying vec4 vFractureClip;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv=vMapUv*.5+aCell;\nvFractureXY=position.xy;\nvFractureClip=aPaneClip;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFractureXY;\nvarying vec4 vFractureClip;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif(any(lessThan(vFractureXY,vFractureClip.xy))||any(greaterThan(vFractureXY,vFractureClip.zw)))discard;');
  };
  material.customProgramCacheKey = () => 'prague-dark-glass-fractures-v1';
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'prague-dark-glass-fractures'; mesh.count = 0; mesh.visible = false;
  mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.renderOrder = 3;
  const matrix = new THREE.Matrix4(), delta = new THREE.Vector3(), scale = new THREE.Vector3();
  let cursor = 0;
  return {
    mesh,
    add(pane, { size = .34, variant = 0 } = {}) {
      delta.set(pane.x, pane.y, pane.z).sub(pane.c);
      const x = delta.dot(pane.T), y = delta.dot(pane.B);
      limits.setXYZW(cursor, (-pane.hw - x) / size, (-pane.hh - y) / size, (pane.hw - x) / size, (pane.hh - y) / size);
      matrix.makeBasis(pane.T, pane.B, pane.n).scale(scale.set(size, size, 1));
      matrix.setPosition(pane.x + pane.n.x * .003, pane.y + pane.n.y * .003, pane.z + pane.n.z * .003);
      mesh.setMatrixAt(cursor, matrix);
      cells.setXY(cursor, variant % 2 * .5, Math.floor(variant % 4 / 2) * .5);
      mesh.count = Math.max(mesh.count, cursor + 1); mesh.visible = true;
      mesh.instanceMatrix.needsUpdate = true; cells.needsUpdate = true; limits.needsUpdate = true;
      cursor = (cursor + 1) % capacity;
    },
    clear() { cursor = 0; mesh.count = 0; mesh.visible = false; },
    stats() {
      return { capacity, drawsBeforeHit: mesh.visible ? 1 : 0, maximumDraws: 1,
        maximumTriangles: capacity * 2, geometryBytes: Object.values(geometry.attributes).reduce((n, a) => n + a.array.byteLength, 0) + geometry.index.array.byteLength + mesh.instanceMatrix.array.byteLength,
        newTextureMaps: 0, ownedTextures: 0, emissive: material.emissive.getHex(), shadows: false, normalOffset: .003, viewDepthPull: 0 };
    },
    releaseGraphicsResources() { mesh.dispose(); geometry.dispose(); material.dispose(); },
    dispose() { mesh.removeFromParent(); mesh.dispose(); geometry.dispose(); material.dispose(); },
  };
}


/* One cosmetic dispatch after ballistics has resolved the closed wall hit.
   A separate feedback name is sent to audio; hit.surface is never changed. */
export function createPragueGlassFeedback(props, { map, effects, audio, random = rng(19450507) } = {}) {
  if (typeof effects?.glass !== 'function' || typeof audio?.impact !== 'function') throw new Error('Prague glass feedback needs its existing effects/audio owners');
  const registry = createPragueGlassRegistry(props), fractures = createDarkGlassFractures(map);
  let disposed = false, impacts = 0;
  return {
    mesh: fractures.mesh,
    impact(hit, direction) {
      if (disposed) return null;
      const pane = registry.at(hit, direction);
      if (!pane) return null;
      fractures.add(pane, { size: .28 + .1 * random(), variant: Math.floor(random() * 4) });
      effects.glass(pane.x, pane.y, pane.z, pane.n.x, pane.n.z, { glints: false });
      audio.impact(pane.x, pane.y, pane.z, 'glass');
      impacts++;
      return pane;
    },
    clear() { fractures.clear(); impacts = 0; },
    releaseGraphicsResources() { fractures.releaseGraphicsResources(); },
    stats() { return { registry: registry.stats(), fractures: fractures.stats(), impacts }; },
    dispose() { if (disposed) return; disposed = true; fractures.dispose(); registry.dispose(); },
  };
}
