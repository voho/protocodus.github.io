/* Hedgerow — the brass thrown out of the gun.

   Every shot of the player's rifle or sub-machine gun throws its empty case
   out to the right (effects.js shell): a little brass case — the Garand's
   long, bottlenecked .30-06, the Thompson's short .45 — tumbling as it
   flies, catching the muzzle flash, the lamps and the sky, then bouncing
   off the cobbles or the mud and lying where it fell. One instanced mesh
   per shape; the last CAP cases of each stay on the ground. */

import * as THREE from 'three';

const CAP = 64;

/* each case's profile from its base up (radius, height, metres): rim, extractor groove, body,
   and the rifle's shoulder and neck */
const RIFLE = [[0, 0], [0.006, 0], [0.006, 0.0012], [0.0051, 0.0016], [0.0051, 0.0026], [0.0059, 0.003], [0.0057, 0.049], [0.0044, 0.054], [0.0044, 0.063], [0.0038, 0.063]];
const PISTOL = [[0, 0], [0.006, 0], [0.006, 0.0012], [0.0054, 0.0018], [0.006, 0.003], [0.006, 0.0228], [0.0054, 0.0228]];

export function createCasings(G) {
  // polished where it rubbed through the chamber; the glow over the horizon in it a little
  // stronger than in the wet stone round it, so a case reads as brass for the moment it flies
  const material = new THREE.MeshStandardMaterial({ color: '#c49a4c', metalness: 1, roughness: 0.26, envMapIntensity: 1.8 });
  material.name = 'brass';
  const kinds = [RIFLE, PISTOL].map((profile) => {
    const h = profile[profile.length - 1][1];
    // turned about its middle, so it tumbles about it
    const geometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y - h / 2)), 12);
    const mesh = new THREE.InstancedMesh(geometry, material, CAP);
    mesh.name = 'casings';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    return { mesh, list: [], cursor: 0, half: h / 2 };
  });
  const group = new THREE.Group();
  group.name = 'casings';
  for (const k of kinds) group.add(k.mesh);

  const Y = new THREE.Vector3(0, 1, 0), f = new THREE.Vector3(), axis = new THREE.Vector3(), tmp = new THREE.Vector3();
  const dq = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), m = new THREE.Matrix4();

  /* A case out of the gun at (x, y, z), thrown towards (rx, rz) (the gun's right); pistol: the
     sub-machine gun's short one (by default when the player holds the Thompson) */
  function eject(x, y, z, rx, rz, pistol = G.player?.weapon === 'thompson') {
    const K = kinds[pistol ? 1 : 0];
    let c;
    if (K.list.length < CAP) {
      c = { slot: K.list.length, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), rest: false };
      K.list.push(c);
      K.mesh.count = K.list.length;
    } else {
      c = K.list[K.cursor];
      K.cursor = (K.cursor + 1) % CAP;
    }
    // along the barrel (the gun points along the right turned a quarter left), out to the right
    // and up, a little forward (away from the eye), tumbling end over end and spinning
    f.set(rz, 0, -rx);
    c.p.set(x, y, z);
    c.v.set(rx, 0, rz).multiplyScalar(1.4 + Math.random() * 0.8).addScaledVector(Y, 1.8 + Math.random() * 1.1).addScaledVector(f, 0.1 + Math.random() * 0.3);
    c.q.setFromUnitVectors(Y, f);
    c.w.set(rx, 0, rz).multiplyScalar((Math.random() - 0.5) * 30).addScaledVector(Y, 18 + Math.random() * 20);
    c.rest = false;
  }

  function update(dt) {
    for (const K of kinds) {
      let moved = false;
      for (const c of K.list) {
        if (c.rest) continue;
        moved = true;
        c.v.y -= 9.8 * dt;
        c.p.addScaledVector(c.v, dt);
        const w = c.w.length();
        if (w > 1e-3) c.q.premultiply(dq.setFromAxisAngle(axis.copy(c.w).divideScalar(w), w * dt));
        // off a wall it bounces back
        tmp.copy(c.p);
        if (G.world.pushOut(tmp, 0.01, c.p.y - 0.01, 0.02, 0.02)) {
          c.v.x = (tmp.x - c.p.x) / Math.max(dt, 1e-3) * 0.3; c.v.z = (tmp.z - c.p.z) / Math.max(dt, 1e-3) * 0.3;
          c.p.x = tmp.x; c.p.z = tmp.z;
        }
        const g = G.world.groundAt(c.p.x, c.p.z, c.p.y + 0.2, 0.25, 0.02) + 0.006;
        if (c.p.y < g) {
          c.p.y = g;
          if (c.v.y < -0.9) {
            // a bounce, losing most of it, and a new tumble
            c.v.y *= -0.32; c.v.x *= 0.55; c.v.z *= 0.55;
            c.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(w * 1.2);
          } else {
            // down on its side
            c.rest = true;
            const a = Math.random() * Math.PI * 2;
            c.q.setFromUnitVectors(Y, axis.set(Math.cos(a), 0, Math.sin(a)));
          }
        }
        K.mesh.setMatrixAt(c.slot, m.compose(c.p, c.q, one));
      }
      if (moved) K.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function clear() { for (const K of kinds) { K.list.length = 0; K.cursor = 0; K.mesh.count = 0; } }

  return { group, eject, update, clear };
}
