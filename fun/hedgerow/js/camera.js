/* Hedgerow — the over-the-shoulder camera.

   Orbits a pivot just above the soldier's eyes, offset to one shoulder (Q
   swaps), pulled in when aiming, and pushed forward by walls, trees and the
   ground so it never ends up inside them. Recoil kicks the view and
   recovers; shake comes from explosions and near misses. */

import * as THREE from 'three';
import { CAMERA } from './config.js';
import { clamp, damp, lerp, noise2 } from './util.js';
import { SHOT } from './world.js';

export function createCameraRig(camera, world) {
  const rig = {
    yaw: 0, pitch: -0.05,
    aimT: 0, shoulder: 1, shoulderT: 1,
    kickPitch: 0, kickYaw: 0,
    shake: 0, shakeT: 0,
    dist: CAMERA.distance,
    fov: CAMERA.fov, baseFov: CAMERA.fov,
    pivot: new THREE.Vector3(),
    dir: new THREE.Vector3(0, 0, 1),
    bob: 0,
  };
  const desired = new THREE.Vector3();
  const rightV = new THREE.Vector3();
  const look = new THREE.Vector3();

  rig.forward = (out = new THREE.Vector3()) => {
    const p = rig.pitch + rig.kickPitch, y = rig.yaw + rig.kickYaw;
    return out.set(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p));
  };

  rig.look = (dx, dy, sens, invert) => {
    const k = 0.0022 * sens * lerp(1, 0.6, rig.aimT);
    rig.yaw -= dx * k;
    rig.pitch -= dy * k * (invert ? -1 : 1);
    rig.pitch = clamp(rig.pitch, CAMERA.minPitch, CAMERA.maxPitch);
  };

  rig.kick = (pitch, yaw) => {
    rig.kickPitch += pitch;
    rig.kickYaw += yaw;
  };

  rig.addShake = (amount) => { rig.shake = Math.min(1.5, rig.shake + amount); };

  /* `target`: the soldier's feet; `eye`: eye height for the stance. */
  rig.update = (dt, target, eye, aiming, moveSpeed = 0) => {
    rig.aimT = damp(rig.aimT, aiming ? 1 : 0, 14, dt);
    rig.shoulderT = damp(rig.shoulderT, rig.shoulder, 10, dt);
    // recoil recovers
    const rec = Math.exp(-9 * dt);
    rig.pitch += rig.kickPitch * (1 - rec) * 0.35;   // part of the kick stays (the player pulls down)
    rig.kickPitch *= rec;
    rig.kickYaw *= rec;
    rig.pitch = clamp(rig.pitch, CAMERA.minPitch, CAMERA.maxPitch);
    rig.shake *= Math.exp(-3.5 * dt);
    rig.shakeT += dt;
    rig.bob += dt * moveSpeed * 1.9;

    const dist = lerp(CAMERA.distance, CAMERA.aimDistance, rig.aimT);
    const shoulder = lerp(CAMERA.shoulder, CAMERA.aimShoulder, rig.aimT) * rig.shoulderT;
    rig.pivot.set(target.x, target.y + eye + CAMERA.height * (1 - rig.aimT * 0.4), target.z);
    rig.pivot.y += Math.sin(rig.bob * 2) * 0.025 * Math.min(1, moveSpeed / 4) * (1 - rig.aimT);

    rig.forward(rig.dir);
    rightV.set(-Math.cos(rig.yaw), 0, Math.sin(rig.yaw));     // camera right when looking along dir
    // shoulder point, kept out of walls first
    const sx = rig.pivot.x + rightV.x * shoulder, sz = rig.pivot.z + rightV.z * shoulder;
    let side = shoulder;
    const sideHit = world.raycast(rig.pivot.x, rig.pivot.y, rig.pivot.z, rightV.x * Math.sign(shoulder || 1), 0, rightV.z * Math.sign(shoulder || 1), Math.abs(shoulder) + CAMERA.collideRadius, SHOT, { noWater: true });
    if (sideHit) side = Math.sign(shoulder) * Math.max(0, sideHit.t - CAMERA.collideRadius);
    const ox = rig.pivot.x + rightV.x * side, oz = rig.pivot.z + rightV.z * side, oy = rig.pivot.y;
    // back along the view
    let d = dist;
    const hit = world.raycast(ox, oy, oz, -rig.dir.x, -rig.dir.y, -rig.dir.z, dist + CAMERA.collideRadius, SHOT, { noWater: true });
    if (hit) d = Math.max(0.25, hit.t - CAMERA.collideRadius);
    rig.dist = Math.min(d, damp(rig.dist, d, 12, dt));
    desired.set(ox - rig.dir.x * rig.dist, oy - rig.dir.y * rig.dist, oz - rig.dir.z * rig.dist);
    // never below the ground
    let g = world.terrain ? world.terrain.height(desired.x, desired.z) + 0.25 : -Infinity;
    if (world.water && world.water.contains(desired.x, desired.z)) g = Math.max(g, world.water.level + 0.3);
    if (desired.y < g) desired.y = g;

    // shake
    if (rig.shake > 0.001) {
      const s = rig.shake * 0.12;
      desired.x += noise2(rig.shakeT * 23, 1.3) * s;
      desired.y += noise2(rig.shakeT * 21, 7.1) * s;
      desired.z += noise2(rig.shakeT * 25, 3.7) * s;
    }
    camera.position.copy(desired);
    look.copy(desired).add(rig.dir);
    camera.lookAt(look);
    const fov = lerp(rig.baseFov, CAMERA.aimFov * rig.baseFov / CAMERA.fov, rig.aimT);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  };

  return rig;
}
