/* Small, static Three.js model builder for Prague's authored street pieces.
   All dimensions are metres, rotations are degrees, front is +z. Geometry
   is merged by palette/material key before it enters the normal world-cell
   batcher; there are no per-part objects or runtime updates. */

import * as THREE from 'three';

const DEG = Math.PI / 180;

function finish(source, tint, floor) {
  const g = source.index ? source.toNonIndexed() : source.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2), color = new Float32Array(p.count * 3);
  const oldColor = g.attributes.color, oldUV = g.attributes.uv;
  const c = new THREE.Color(tint ?? 0xffffff);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (source.userData.keepUV && oldUV) {
      uv[i * 2] = oldUV.getX(i); uv[i * 2 + 1] = oldUV.getY(i);
    } else {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      if (ax >= ay && ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y; }
      else if (ay >= az) { uv[i * 2] = x; uv[i * 2 + 1] = z; }
      else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
    }
    // Conservative ground/contact darkening. Detailed cavity colour can be
    // authored into the source geometry or supplied as a per-piece tint.
    const ao = 0.66 + 0.34 * Math.min(1, Math.max(0, (y - floor) / 1.15));
    color[i * 3] = c.r * ao * (oldColor ? oldColor.getX(i) : 1);
    color[i * 3 + 1] = c.g * ao * (oldColor ? oldColor.getY(i) : 1);
    color[i * 3 + 2] = c.b * ao * (oldColor ? oldColor.getZ(i) : 1);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return g;
}

export function createBuilder(name) {
  const parts = new Map(), materials = new Map();
  const model = { name, set: 'procedural', prims: [], colliders: [], anchors: {}, extras: {}, box: new THREE.Box3() };
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  const rotation = new THREE.Euler(), scaleV = new THREE.Vector3();
  const b = {
    model,
    add(key, geometry, at = [0, 0, 0], degrees = [0, 0, 0], scale = [1, 1, 1], tint = 0xffffff) {
      rotation.set(...degrees.map(v => v * DEG));
      matrix.compose(position.fromArray(at), quaternion.setFromEuler(rotation), scaleV.fromArray(scale));
      const g = geometry.clone().applyMatrix4(matrix);
      if (!parts.has(key)) parts.set(key, []);
      parts.get(key).push({ g, tint });
      return g;
    },
    box(key, size, at = [0, 0, 0], degrees = [0, 0, 0], tint = 0xffffff) {
      const g = new THREE.BoxGeometry(...size);
      b.add(key, g, at, degrees, [1, 1, 1], tint); g.dispose();
      return b;
    },
    cylinder(key, radius, length, at = [0, 0, 0], degrees = [0, 0, 0], segments = 8, tint = 0xffffff) {
      const g = new THREE.CylinderGeometry(radius, radius, length, segments);
      b.add(key, g, at, degrees, [1, 1, 1], tint); g.dispose();
      return b;
    },
    beam(key, from, to, width = 0.05, depth = width, tint = 0xffffff) {
      const a = new THREE.Vector3().fromArray(from), z = new THREE.Vector3().fromArray(to);
      const d = z.clone().sub(a), g = new THREE.BoxGeometry(width, d.length(), depth);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
      b.add(key, g, a.add(z).multiplyScalar(0.5).toArray(), [0, 0, 0], [1, 1, 1], tint); g.dispose();
      return b;
    },
    rod(key, from, to, radius = 0.025, segments = 6, tint = 0xffffff) {
      const a = new THREE.Vector3().fromArray(from), z = new THREE.Vector3().fromArray(to);
      const d = z.clone().sub(a), g = new THREE.CylinderGeometry(radius, radius, d.length(), segments);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
      b.add(key, g, a.add(z).multiplyScalar(0.5).toArray(), [0, 0, 0], [1, 1, 1], tint); g.dispose();
      return b;
    },
    collider(c, h, yaw = 0, kind, surface) {
      model.colliders.push({ type: 'box', c: [...c], h: [...h], ry: yaw * DEG,
        ...(kind ? { kind } : {}), ...(surface ? { surface } : {}) });
      return b;
    },
    material(key, source) { materials.set(key, source); return b; },
    done(floor = 0) {
      for (const [key, list] of parts) {
        const geometries = list.map(({ g, tint }) => finish(g, tint, floor));
        const count = geometries.reduce((n, g) => n + g.attributes.position.count, 0);
        const geometry = new THREE.BufferGeometry();
        for (const [attribute, itemSize] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) {
          const array = new Float32Array(count * itemSize); let offset = 0;
          for (const g of geometries) { array.set(g.attributes[attribute].array, offset); offset += g.attributes[attribute].array.length; }
          geometry.setAttribute(attribute, new THREE.BufferAttribute(array, itemSize));
        }
        geometry.computeBoundingBox(); geometry.computeBoundingSphere(); model.box.union(geometry.boundingBox);
        model.prims.push({ geometry, key, material: materials.get(key) || { name: key }, node: null });
        for (const g of geometries) g.dispose();
        for (const { g } of list) g.dispose();
      }
      return model;
    },
  };
  return b;
}
