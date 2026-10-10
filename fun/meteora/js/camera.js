/* Meteora — the chase camera.

   The camera rides behind and above the fighter, but it follows the ship's
   orientation through a spring rather than bolted to it, so a hard turn
   swings the ship across the frame before the view catches up. Thrust pulls
   it back a little and the afterburner widens the field of view: in vacuum
   speed itself is invisible, and the camera is one of the few honest places
   to feel acceleration.

   Shake offsets are applied last, in the camera's own frame, and never
   reach the simulation — the crosshair stays where the guns point. */

import * as THREE from 'three';
import { RENDER } from './config.js';

const CHASE = new THREE.Vector3(0, 4.2, 19);

export function createChaseCamera(camera, cockpit) {
  const q = new THREE.Quaternion();
  const pull = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const shakeEuler = new THREE.Euler();
  const shakeQ = new THREE.Quaternion();
  let fov = RENDER.fov, orbit = 0, ready = false;
  const self = {
    mode: 'chase',
    toggle() { self.mode = self.mode === 'chase' ? 'nose' : 'chase'; },
    reset() { ready = false; },
    update(pos, shipQ, accelLocal, afterburner, dt, shake, attract) {
      if (attract) {
        orbit += dt * 0.07;
        camera.position.set(pos.x + Math.sin(orbit) * 34, pos.y + 9 + Math.sin(orbit * 0.6) * 4, pos.z + Math.cos(orbit) * 34);
        camera.lookAt(pos);
        ready = false;
      } else if (self.mode === 'nose') {
        camera.quaternion.copy(shipQ);
        camera.position.copy(pos).add(offset.set(cockpit[0], cockpit[1], cockpit[2]).applyQuaternion(shipQ));
        q.copy(shipQ);
      } else {
        if (!ready) { q.copy(shipQ); pull.set(0, 0, 0); ready = true; }
        q.slerp(shipQ, 1 - Math.exp(-dt * 9));
        pull.lerp(offset.set(-accelLocal[0] * 0.01, -accelLocal[1] * 0.01, -accelLocal[2] * 0.012), 1 - Math.exp(-dt * 4));
        offset.copy(CHASE).add(pull).applyQuaternion(q);
        camera.position.copy(pos).add(offset);
        camera.quaternion.copy(q);
      }
      if (shake) {
        camera.position.add(offset.set(shake.pos[0], shake.pos[1], shake.pos[2]).applyQuaternion(camera.quaternion));
        camera.quaternion.multiply(shakeQ.setFromEuler(shakeEuler.set(shake.rot[0], shake.rot[1], shake.rot[2])));
      }
      const target = afterburner && !attract ? RENDER.fov + 8 : RENDER.fov;
      fov += (target - fov) * (1 - Math.exp(-dt * 3));
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    },
  };
  return self;
}
