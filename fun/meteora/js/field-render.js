/* Meteora — drawing the belt.

   Twenty-one thousand rocks in ten draw calls: one per rock size for the
   near mesh and one for the far mesh. Every frame cull.js picks the rocks
   the camera can see, and their per-instance data — position and scale,
   tumble axis and rate, phase — is packed into the front of each size's
   instance buffers. A destroyed rock simply stops being picked.

   Rocks tumble in the vertex shader from that per-instance data, so
   spinning twenty thousand of them costs the CPU nothing. The collision
   sphere is the same at every angle, which is why the simulation never
   needs to know where a rock is in its turn. */

import * as THREE from 'three';
import { createCuller } from './cull.js';

const LOD_DISTANCE = 2000;

const TUMBLE_HEAD = /* glsl */`
attribute vec4 aOffset;   // position xyz, scale
attribute vec4 aSpin;     // axis xyz, rate
attribute float aPhase;
uniform float uTime;
vec3 meteoraTumble(vec3 v) {
  float a = aSpin.w * uTime + aPhase;
  float c = cos(a), s = sin(a);
  vec3 k = aSpin.xyz;
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
`;

export function tumbleMaterial(base, time) {
  const material = base.clone();
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = time;
    shader.vertexShader = TUMBLE_HEAD + shader.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = meteoraTumble(objectNormal);')
      .replace('#include <begin_vertex>', 'vec3 transformed = meteoraTumble(vec3(position)) * aOffset.w + aOffset.xyz;');
  };
  material.customProgramCacheKey = () => 'meteora-belt';
  return material;
}

function instancedFrom(base, capacity) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  for (const [name, attribute] of Object.entries(base.attributes)) g.setAttribute(name, attribute);
  const attr = (name, size) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
    return a;
  };
  g.instanceCount = 0;
  return { geometry: g, offset: attr('aOffset', 4), spin: attr('aSpin', 4), phase: attr('aPhase', 1) };
}

export function createFieldRender(scene, field, rocks, time) {
  const belt = field.belt, cfg = field.cfg;
  const group = new THREE.Group();
  group.name = 'belt';
  scene.add(group);
  const culler = createCuller(belt, cfg, { lodDistance: LOD_DISTANCE });
  const counts = cfg.types.map(() => 0);
  for (let i = 0; i < belt.count; i++) counts[belt.type[i]]++;

  const batches = rocks.map((rock, type) => {
    const material = tumbleMaterial(rock.material, time);
    const make = base => {
      const b = instancedFrom(base, counts[type]);
      const mesh = new THREE.Mesh(b.geometry, material);
      mesh.frustumCulled = false;   // cull.js already did
      mesh.receiveShadow = true;
      group.add(mesh);
      return b;
    };
    return { near: make(rock.lod0), far: make(rock.lod1) };
  });

  const fill = (batch, list) => {
    const o = batch.offset.array, s = batch.spin.array, ph = batch.phase.array;
    for (let k = 0; k < list.count; k++) {
      const i = list.index[k];
      o[4 * k] = belt.pos[3 * i]; o[4 * k + 1] = belt.pos[3 * i + 1]; o[4 * k + 2] = belt.pos[3 * i + 2]; o[4 * k + 3] = belt.scale[i];
      s[4 * k] = belt.axis[3 * i]; s[4 * k + 1] = belt.axis[3 * i + 1]; s[4 * k + 2] = belt.axis[3 * i + 2]; s[4 * k + 3] = belt.spin[i];
      ph[k] = belt.phase[i];
    }
    batch.geometry.instanceCount = list.count;
    for (const a of [batch.offset, batch.spin, batch.phase]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, list.count * a.itemSize);
      a.needsUpdate = true;
    }
  };

  // Fragments drift and turn on their own, so they get ordinary instancing.
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const dynamic = rocks.map((r, type) => {
    const mesh = new THREE.InstancedMesh(r.lod0, r.material, cfg.maxDynamic);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.nominal = cfg.types[type].radius;
    group.add(mesh);
    return mesh;
  });

  const frustum = new THREE.Frustum(), projScreen = new THREE.Matrix4();
  const planes = new Float64Array(24), eye = [0, 0, 0];
  const stats = { cells: culler.cells, drawn: 0 };
  return {
    group, stats,
    update(camera) {
      camera.updateMatrixWorld();
      projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreen, camera.coordinateSystem, camera.reversedDepth);
      frustum.planes.forEach((plane, k) => {
        planes[4 * k] = plane.normal.x; planes[4 * k + 1] = plane.normal.y;
        planes[4 * k + 2] = plane.normal.z; planes[4 * k + 3] = plane.constant;
      });
      eye[0] = camera.position.x; eye[1] = camera.position.y; eye[2] = camera.position.z;
      const lists = culler.cull(planes, eye, field.alive);
      let drawn = 0;
      lists.forEach((l, type) => {
        fill(batches[type].near, l.near);
        fill(batches[type].far, l.far);
        drawn += l.near.count + l.far.count;
      });
      stats.drawn = drawn;
    },
    syncDynamic(list) {
      const used = dynamic.map(() => 0);
      for (const rock of list) {
        const mesh = dynamic[rock.type];
        m.compose(p.set(rock.pos[0], rock.pos[1], rock.pos[2]),
          q.set(rock.q[0], rock.q[1], rock.q[2], rock.q[3]),
          sc.setScalar(rock.radius / mesh.userData.nominal));
        mesh.setMatrixAt(used[rock.type]++, m);
      }
      dynamic.forEach((mesh, type) => { mesh.count = used[type]; mesh.instanceMatrix.needsUpdate = true; });
    },
  };
}
