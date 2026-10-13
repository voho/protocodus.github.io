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
   wreck instead (`watch`).

   A mission opens on a short establishing shot (`intro`): the camera
   starts ahead of the fighter and off its right wing, looking back at it,
   and swings round and in to the chase position, where it hands over
   without a cut. Any input from the player hurries it to the end. And it
   closes on one (`outro`): when the mission is decided the camera lets go
   of the chase position and drifts back and up, round to one side, the
   fighter held in the middle of the frame.

   Whatever the shot, a rock or a hull between the fighter and the camera
   pulls the camera in front of it at once (`setObstruction` says how far
   along that line is clear); it eases back out when the way is free. A
   cutaway and the watch over a wreck keep clear of rocks the same way —
   only of rocks, as the ship they frame would otherwise block itself.

   A big moment elsewhere gets a cutaway (`cutaway`): a cut to a shot the
   caller frames, and after a few seconds a cut back to the chase view. */

import * as THREE from 'three';
import { RENDER } from './config.js';

// Far enough back that the ship takes about a fifth of the screen's width
// and the fight around it stays in view.
const CHASE = new THREE.Vector3(0, 5.2, 24);
const WATCH = 70;   // m: how far back the camera settles from a wreck
const INTRO_ARC = 2.4;   // rad: where the establishing shot starts, round from behind
const smoother = k => k * k * k * (k * (6 * k - 15) + 10);
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createChaseCamera(camera, cockpit) {
  const q = new THREE.Quaternion();
  const pull = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const shakeEuler = new THREE.Euler();
  const shakeQ = new THREE.Quaternion();
  // The field of view the player chose; the afterburner widens it.
  let baseFov = RENDER.fov, fov = RENDER.fov, orbit = 0, ready = false, wreck = null, shaken = false;
  // The establishing shot: progress 0 → 1, and how long the rest should take.
  let shot = 1, shotRate = 0;
  // The closing shot: seconds since it began (−1: none), and the frame it
  // orbits in, held from that moment so the fighter's turns do not swing it.
  let closing = -1;
  const closingQ = new THREE.Quaternion();
  const introQ = new THREE.Quaternion(), shipUp = new THREE.Vector3();
  // The cutaway: { framing(k, eye, look, up), k, rate } or null.
  let cut = null;
  const cutUp = new THREE.Vector3();
  // Keeping clear of rocks: the share of the wanted distance in use.
  let obstruct = null, reach = 1;
  const wanted = new THREE.Vector3();
  const keepClear = (pos, dt, rocksOnly = false) => {
    if (!obstruct) return;
    const t = obstruct(pos, camera.position, rocksOnly);
    const len = wanted.copy(camera.position).sub(pos).length();
    // Never closer than the fighter's own length allows.
    const least = Math.min(1, 9 * self.scale / Math.max(len, 1e-3));
    const want = t < 1 ? Math.max(least, t) : 1;
    reach = want < reach ? want : reach + (want - reach) * (1 - Math.exp(-dt * 2.5));
    if (reach < 0.999) camera.position.copy(pos).addScaledVector(wanted, reach);
  };
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
    // The chase distance follows the ship's size (1 = the Kestrel's), and
    // the cockpit eye point the ship's model.
    scale: 1,
    setShip(scale, eye) { self.scale = scale; if (eye) cockpit = eye; ready = false; },
    toggle() { self.mode = self.mode === 'chase' ? 'nose' : 'chase'; },
    reset() { ready = false; wreck = null; shot = 1; closing = -1; reach = 1; cut = null; },
    /* `framing(k, eye, look, up)` sets where the camera is, what it looks
       at and which way is up, k going 0 → 1 over `seconds`. */
    cutaway(framing, seconds) { cut = { framing, k: 0, rate: 1 / seconds }; shot = 1; },
    get inCutaway() { return !!cut; },
    get cutawayAge() { return cut ? cut.k / cut.rate : 0; },
    // The player wants the fighter back: cut to it at once.
    skipCutaway() { if (cut) { cut = null; ready = false; } },
    setObstruction(fn) { obstruct = fn; },
    setFov(degrees) { baseFov = degrees; },
    intro(seconds) { shot = 0; shotRate = 1 / seconds; },
    outro() { if (closing < 0) { closing = 0; shot = 1; cut = null; closingQ.copy(q); } },
    // The player wants the stick: finish the shot within half a second.
    skipIntro() { if (shot < 1) shotRate = Math.max(shotRate, (1 - shot) / 0.5); },
    get inIntro() { return shot < 1; },
    get inOutro() { return closing >= 0; },
    // How much of the screen belongs to the shot rather than the HUD (1 → 0
    // over its last part).
    get cinematic() { return cut ? 1 : closing >= 0 ? smoothstep(0, 0.8, closing) : shot < 1 ? 1 - smoothstep(0.7, 1, shot) : 0; },
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
      shot = 1; cut = null;
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
      camera.position.copy(eye);
      keepClear(aim, dt, true);
      look.lookAt(camera.position, aim, roll.copy(wreck.up));
      wreck.q.slerp(q.setFromRotationMatrix(look), 1 - Math.exp(-dt * 6));
      camera.quaternion.copy(wreck.q);
      applyShake(shake);
      easeFov(baseFov, dt);
    },
    update(pos, shipQ, accelLocal, afterburner, dt, shake, attract, orbitDistance = 34) {
      // The opening shot is a chase-camera move: any other view ends it.
      if (attract || self.mode === 'nose') shot = 1;
      if (attract) { closing = -1; cut = null; }
      if (cut) {
        cut.k += dt * cut.rate;
        if (cut.k < 1) {
          cutUp.set(0, 1, 0);
          cut.framing(cut.k, eye, aim, cutUp);
          camera.position.copy(eye);
          keepClear(aim, dt, true);
          look.lookAt(camera.position, aim, cutUp);
          camera.quaternion.setFromRotationMatrix(look);
          // Keep the chase spring on the fighter for the cut back.
          q.slerp(shipQ, 1 - Math.exp(-dt * 9));
          easeFov(baseFov, dt);
          return;
        }
        cut = null;
        ready = false;
      }
      if (closing >= 0) {
        closing += dt;
        const e = smoother(Math.min(1, closing / 5)), r = CHASE.z * self.scale;
        const arc = 0.9 * e, dist = r * (1 + 1.6 * e);
        offset.set(Math.sin(arc) * dist, CHASE.y * self.scale + r * 0.5 * e, Math.cos(arc) * dist).applyQuaternion(closingQ);
        camera.position.copy(pos).add(offset);
        keepClear(pos, dt);
        look.lookAt(camera.position, pos, shipUp.set(0, 1, 0).applyQuaternion(closingQ));
        camera.quaternion.copy(closingQ).slerp(introQ.setFromRotationMatrix(look), smoothstep(0, 1.2, closing));
        applyShake(shake);
        easeFov(baseFov, dt);
        return;
      }
      if (attract) {
        orbit += dt * 0.07;
        const r = orbitDistance;
        camera.position.set(pos.x + Math.sin(orbit) * r, pos.y + r * 0.26 + Math.sin(orbit * 0.6) * r * 0.12, pos.z + Math.cos(orbit) * r);
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
        if (shot < 1) {
          shot = Math.min(1, shot + dt * shotRate);
          // Round from ahead of the right wing to behind, in from far out
          // and down from above, all easing out at the chase position.
          const e = smoother(shot), r = CHASE.z * self.scale, away = 1 - e;
          const arc = INTRO_ARC * away, dist = r * (1 + 1.6 * away);
          offset.set(Math.sin(arc) * dist, CHASE.y * self.scale + r * 0.35 * away, Math.cos(arc) * dist)
            .addScaledVector(pull, e).applyQuaternion(q);
          camera.position.copy(pos).add(offset);
          keepClear(pos, dt);
          // Looking at the fighter at first, then along its course.
          look.lookAt(camera.position, pos, shipUp.set(0, 1, 0).applyQuaternion(q));
          introQ.setFromRotationMatrix(look).slerp(q, smoothstep(0.55, 1, shot));
          camera.quaternion.copy(introQ);
        } else {
          offset.copy(CHASE).multiplyScalar(self.scale).add(pull).applyQuaternion(q);
          camera.position.copy(pos).add(offset);
          keepClear(pos, dt);
          camera.quaternion.copy(q);
        }
      }
      applyShake(shake);
      // The afterburner widens the view as it builds (`afterburner` 0 → 1).
      easeFov(attract ? baseFov : baseFov + 14 * Number(afterburner), dt);
    },
  };
  return self;
}
