/* Meteora — drawing the belt.

   Twenty-one thousand rocks in a few hundred draw calls. The belt is cut
   into 1 km cells, and each cell draws each rock size as one instanced mesh
   built once at load; three.js skips a whole cell mesh when its bounding
   sphere is off screen. Small sizes are not drawn past the distance where
   they would be under a pixel, and cells beyond 2 km switch to the far
   mesh.

   Rocks tumble in the vertex shader from a per-instance axis, rate and
   phase, so spinning twenty thousand of them costs the CPU nothing. The
   collision sphere is the same at every angle, which is why the
   simulation never needs to know where a rock is in its turn. */

import * as THREE from 'three';

const LOD_DISTANCE = 2000;

const TUMBLE_HEAD = /* glsl */`
attribute vec4 aSpin;
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
      .replace('#include <begin_vertex>', 'vec3 transformed = meteoraTumble(vec3(position));');
  };
  material.customProgramCacheKey = () => 'meteora-tumble';
  return material;
}

// A geometry that shares the model's vertex data but carries its own
// per-instance tumble attributes.
function shareGeometry(base, spin, phase) {
  const g = new THREE.BufferGeometry();
  g.index = base.index;
  for (const [name, attribute] of Object.entries(base.attributes)) g.setAttribute(name, attribute);
  g.setAttribute('aSpin', spin);
  g.setAttribute('aPhase', phase);
  g.boundingSphere = base.boundingSphere.clone();
  return g;
}

export function createFieldRender(scene, field, rocks, time) {
  const belt = field.belt, cfg = field.cfg;
  const group = new THREE.Group();
  group.name = 'belt';
  scene.add(group);
  const materials = rocks.map(r => tumbleMaterial(r.material, time));

  // Bucket every rock into its cell and size.
  const buckets = new Map();
  for (let i = 0; i < belt.count; i++) {
    const cx = Math.floor(belt.pos[3 * i] / cfg.cell);
    const cy = Math.floor(belt.pos[3 * i + 1] / cfg.cell);
    const cz = Math.floor(belt.pos[3 * i + 2] / cfg.cell);
    const key = `${cx},${cy},${cz},${belt.type[i]}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, list = []);
    list.push(i);
  }

  const meshes = [];
  const meshOf = new Array(belt.count), slotOf = new Int32Array(belt.count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const matrixFor = i => m.compose(
    p.set(belt.pos[3 * i], belt.pos[3 * i + 1], belt.pos[3 * i + 2]), q.identity(),
    s.setScalar(belt.scale[i]));
  for (const list of buckets.values()) {
    const type = belt.type[list[0]];
    const spin = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4);
    const phase = new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1);
    list.forEach((i, k) => {
      spin.setXYZW(k, belt.axis[3 * i], belt.axis[3 * i + 1], belt.axis[3 * i + 2], belt.spin[i]);
      phase.setX(k, belt.phase[i]);
    });
    const near = shareGeometry(rocks[type].lod0, spin, phase);
    const far = shareGeometry(rocks[type].lod1, spin, phase);
    const mesh = new THREE.InstancedMesh(near, materials[type], list.length);
    list.forEach((i, k) => { mesh.setMatrixAt(k, matrixFor(i)); meshOf[i] = mesh; slotOf[i] = k; });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData = { type, near, far, draw: cfg.types[type].draw, indices: list };
    mesh.receiveShadow = true;
    meshes.push(mesh);
    group.add(mesh);
  }

  // Fragments drift and turn on their own, so they get ordinary instancing.
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

  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const sphere = new THREE.Sphere();
  return {
    group, meshes,
    stats: { cells: meshes.length },
    update(camera) {
      let drawn = 0;
      for (const mesh of meshes) {
        sphere.copy(mesh.boundingSphere);
        const d = camera.position.distanceTo(sphere.center) - sphere.radius;
        mesh.visible = d < mesh.userData.draw;
        if (!mesh.visible) continue;
        const geometry = d > LOD_DISTANCE ? mesh.userData.far : mesh.userData.near;
        if (mesh.geometry !== geometry) mesh.geometry = geometry;
        drawn++;
      }
      this.stats.visible = drawn;
    },
    removeStatic(index) {
      const mesh = meshOf[index];
      if (!mesh) return;
      mesh.setMatrixAt(slotOf[index], zero);
      mesh.instanceMatrix.needsUpdate = true;
    },
    restoreAll() {
      for (const mesh of meshes) {
        mesh.userData.indices.forEach((i, k) => mesh.setMatrixAt(k, matrixFor(i)));
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
    syncDynamic(list) {
      const counts = dynamic.map(() => 0);
      for (const rock of list) {
        const mesh = dynamic[rock.type];
        const k = counts[rock.type]++;
        m.compose(p.set(rock.pos[0], rock.pos[1], rock.pos[2]),
          q.set(rock.q[0], rock.q[1], rock.q[2], rock.q[3]),
          s.setScalar(rock.radius / mesh.userData.nominal));
        mesh.setMatrixAt(k, m);
      }
      dynamic.forEach((mesh, type) => { mesh.count = counts[type]; mesh.instanceMatrix.needsUpdate = true; });
    },
  };
}
