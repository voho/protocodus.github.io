/* Bursts of small tumbling pieces: confetti for a solved board, dust for
   a patch landing, sparks along a finished line. One instanced mesh per
   system; a dead piece is scaled to nothing. */
import * as THREE from 'three';

const dummy = new THREE.Object3D();
const tint = new THREE.Color();
const up = new THREE.Vector3(0, 1, 0);

export function createBursts(scene, { max = 500, additive = false } = {}) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide, transparent: additive, depthWrite: !additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  dummy.scale.set(0, 0, 0);
  dummy.updateMatrix();
  for (let i = 0; i < max; i++) { mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, tint.set('#ffffff')); }
  scene.add(mesh);

  const alive = new Uint8Array(max);
  const pos = new Float32Array(max * 3), vel = new Float32Array(max * 3);
  const rot = new Float32Array(max * 3), spin = new Float32Array(max * 3);
  const colour = new Float32Array(max * 3);
  const age = new Float32Array(max), life = new Float32Array(max);
  const sizeW = new Float32Array(max), sizeH = new Float32Array(max);
  const gravity = new Float32Array(max), drag = new Float32Array(max);
  let cursor = 0;
  let any = false;

  /* `direction` is the cone axis, `spread` its half-angle in radians. */
  function burst({
    origin, count = 40, colours = ['#ffffff'], speed = [2, 5], direction = up, spread = 0.6,
    gravityPull = 9, airDrag = 1.2, lifespan = [0.8, 1.6], size = [0.1, 0.07], spinRate = 10, scatter = 0,
  }) {
    const axis = direction.clone().normalize();
    const side = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(axis, side).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    for (let k = 0; k < count; k++) {
      const i = cursor;
      cursor = (cursor + 1) % max;
      alive[i] = 1;
      const angle = Math.random() * Math.PI * 2;
      const tilt = Math.random() * spread;
      const s = speed[0] + Math.random() * (speed[1] - speed[0]);
      const dir = axis.clone().multiplyScalar(Math.cos(tilt))
        .addScaledVector(u, Math.sin(tilt) * Math.cos(angle))
        .addScaledVector(v, Math.sin(tilt) * Math.sin(angle));
      pos[i * 3] = origin.x + (Math.random() - 0.5) * scatter;
      pos[i * 3 + 1] = origin.y + (Math.random() - 0.5) * scatter * 0.3;
      pos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * scatter;
      vel[i * 3] = dir.x * s; vel[i * 3 + 1] = dir.y * s; vel[i * 3 + 2] = dir.z * s;
      for (let a = 0; a < 3; a++) { rot[i * 3 + a] = Math.random() * Math.PI * 2; spin[i * 3 + a] = (Math.random() - 0.5) * spinRate; }
      tint.set(colours[Math.floor(Math.random() * colours.length)]);
      colour[i * 3] = tint.r; colour[i * 3 + 1] = tint.g; colour[i * 3 + 2] = tint.b;
      age[i] = 0;
      life[i] = lifespan[0] + Math.random() * (lifespan[1] - lifespan[0]);
      sizeW[i] = size[0] * (0.7 + Math.random() * 0.6);
      sizeH[i] = size[1] * (0.7 + Math.random() * 0.6);
      gravity[i] = gravityPull;
      drag[i] = airDrag;
      mesh.setColorAt(i, tint);
    }
    mesh.instanceColor.needsUpdate = true;
    any = true;
  }

  function update(dt) {
    if (!any) return;
    let living = false;
    for (let i = 0; i < max; i++) {
      if (!alive[i]) continue;
      age[i] += dt;
      if (age[i] >= life[i]) {
        alive[i] = 0;
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      living = true;
      const damp = Math.max(0, 1 - drag[i] * dt);
      vel[i * 3 + 1] -= gravity[i] * dt;
      vel[i * 3] *= damp; vel[i * 3 + 1] *= damp; vel[i * 3 + 2] *= damp;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      rot[i * 3] += spin[i * 3] * dt; rot[i * 3 + 1] += spin[i * 3 + 1] * dt; rot[i * 3 + 2] += spin[i * 3 + 2] * dt;
      const left = 1 - age[i] / life[i];
      const scale = Math.min(1, left * 3.5); // shrink away over the last third
      dummy.position.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      dummy.rotation.set(rot[i * 3], rot[i * 3 + 1], rot[i * 3 + 2]);
      dummy.scale.set(sizeW[i] * scale, sizeH[i] * scale, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (additive) {
        tint.setRGB(colour[i * 3] * left, colour[i * 3 + 1] * left, colour[i * 3 + 2] * left);
        mesh.setColorAt(i, tint);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (additive) mesh.instanceColor.needsUpdate = true;
    any = living;
  }

  return { burst, update, mesh, get alive() { return any; } };
}
