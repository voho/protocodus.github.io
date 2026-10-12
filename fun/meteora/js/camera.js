/* Meteora — the chase camera.

   The camera rides behind and above the fighter, but it follows the ship's
   orientation through a spring rather than bolted to it, so a hard turn
   swings the ship across the frame before the view catches up. Thrust pulls
   it back a little and the afterburner widens the field of view: in vacuum
   speed itself is invisible, and the camera is one of the few honest places
   to feel acceleration.

   Shake offsets are applied last, in the camera's own frame, and never
   reach the simulation: `steady` takes them off again before the aim is
   read through the camera, so the crosshair stays where the guns point.

   When the fighter is destroyed the camera stops riding it and watches the
   wreck instead (`watch`). */

import * as THREE from 'three';
import { RENDER } from './config.js';

const CHASE = new THREE.Vector3(0, 4.2, 19);
const WATCH = 70;   // m: how far back the camera settles from a wreck

export function createChaseCamera(camera, cockpit) {
  const q = new THREE.Quaternion();
  const pull = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const shakeEuler = new THREE.Euler();
  const shakeQ = new THREE.Quaternion();
  let fov = RENDER.fov, orbit = 0, ready = false, wreck = null, shaken = false;
  const look = new THREE.Matrix4(), eye = new THREE.Vector3(), aim = new THREE.Vector3(), roll = new THREE.Vector3();
  const steadyPos = new THREE.Vector3(), steadyQ = new THREE.Quaternion();
  const easeFov = (target, dt) => {
    fov += (target - fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  };
  const applyShake = shake => {
    if (!shake) return;
    steadyPos.copy(camera.position); steadyQ.copy(camera.quaternion); shaken = true;
    camera.position.add(offset.set(shake.pos[0], shake.pos[1], shake.pos[2]).applyQuaternion(camera.quaternion));
    camera.quaternion.multiply(shakeQ.setFromEuler(shakeEuler.set(shake.rot[0], shake.rot[1], shake.rot[2])));
  };
  const self = {
    mode: 'chase',
    toggle() { self.mode = self.mode === 'chase' ? 'nose' : 'chase'; },
    reset() { ready = false; wreck = null; },
    // The camera as it was before this frame's shake.
    steady() {
      if (!shaken) return;
      camera.position.copy(steadyPos); camera.quaternion.copy(steadyQ); camera.updateMatrixWorld();
      shaken = false;
    },
    /* The fighter is gone. At first the view keeps the wreck's momentum, so
       the explosion holds still in frame; it backs off, then sheds that
       momentum over the next few seconds, and the burning cloud drifts away
       down its old course; a wreck drifting toward the camera pushes it back
       rather than passing through it. `origin` and `velocity` are where and
       how fast the ship was going when it died, `t` the seconds since. The
       view turns without rolling: the pilot's last "up" stays up. */
    watch(origin, velocity, t, dt, shake) {
      if (!wreck) {
        const away = camera.position.clone().sub(eye.set(origin[0], origin[1], origin[2]));
        const d0 = Math.max(1, away.length());
        wreck = { away: away.divideScalar(d0), d0, up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), q: camera.quaternion.clone() };
      }
      const travel = 4 * (1 - Math.exp(-t / 4));
      const back = WATCH - (WATCH - wreck.d0) * Math.exp(-t / 0.6);
      eye.set(origin[0] + velocity[0] * travel, origin[1] + velocity[1] * travel, origin[2] + velocity[2] * travel)
        .addScaledVector(wreck.away, back);
      aim.set(origin[0] + velocity[0] * t, origin[1] + velocity[1] * t, origin[2] + velocity[2] * t);
      const gap = offset.copy(eye).sub(aim).dot(wreck.away);
      if (gap < WATCH / 2) eye.addScaledVector(wreck.away, WATCH / 2 - gap);
      look.lookAt(eye, aim, roll.copy(wreck.up));
      wreck.q.slerp(q.setFromRotationMatrix(look), 1 - Math.exp(-dt * 6));
      camera.position.copy(eye);
      camera.quaternion.copy(wreck.q);
      applyShake(shake);
      easeFov(RENDER.fov, dt);
    },
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
      applyShake(shake);
      easeFov(afterburner && !attract ? RENDER.fov + 8 : RENDER.fov, dt);
    },
  };
  return self;
}
