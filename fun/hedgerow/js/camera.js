/* Hedgerow — the camera.

   First person (CAMERA.firstPerson): through the soldier's eyes. The eye
   rides on his head as his body moves (so it bobs with his steps and dips
   as he crouches), and when he aims it goes down the rifle's sight line, a
   hand's breadth behind the rear sight; the view narrows to the sights and
   widens a little at a sprint, and leans a touch into a strafe.

   Over the shoulder (the death camera, and the old third-person view):
   orbits a pivot just above the soldier's eyes, offset to one shoulder,
   pulled in when aiming, and pushed forward by walls, trees and the ground
   so it never ends up inside them. Recoil kicks the view and recovers;
   shake comes from explosions and near misses.

   When the soldier dies the camera stays on the fall for a moment, then
   turns to the man who killed him, glides towards him (zoomed in while he
   is far, widening as it closes) and follows him a few metres off, above
   and to one side — never through a wall or under the ground. */

import * as THREE from 'three';
import { CAMERA } from './config.js';
import { clamp, damp, lerp, noise2, smoothstep } from './util.js';
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
    roll: 0, sprintT: 0,
    // first person: the head flinching from a hit (camera only; the aim stays)
    flinchRoll: 0, flinchRollV: 0, flinchPitch: 0, flinchPitchV: 0,
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

  /* A hit, first person: the head snaps away from the side it came from
     (`side` > 0: from his left) and up a little, and comes back. */
  rig.flinch = (side, amount = 1) => {
    rig.flinchRollV += -Math.sign(side || 1) * 2.2 * amount;
    rig.flinchPitchV += 1.1 * amount;
  };
  function settleFlinch(dt) {
    for (let left = dt; left > 1e-6;) {
      const h = Math.min(left, 1 / 240);
      rig.flinchRollV += (-500 * rig.flinchRoll - 34 * rig.flinchRollV) * h;
      rig.flinchPitchV += (-500 * rig.flinchPitch - 34 * rig.flinchPitchV) * h;
      rig.flinchRoll += rig.flinchRollV * h;
      rig.flinchPitch += rig.flinchPitchV * h;
      left -= h;
    }
  }

  /* ---------- the death camera ---------- */
  const dc = { t: 0, started: false, from: new THREE.Vector3(), pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), vd = new THREE.Vector3();
  const HOLD = 0.8, TRAVEL = 2.4;
  /* `body`: where he fell; `killer`: the killer's head (null: just the fall). */
  rig.deathCam = (dt, body, killer) => {
    dc.t += dt;
    if (!killer || dc.t < HOLD) {
      rig.update(dt, body, 0.6, false, 0);
      dc.pos.copy(camera.position);
      dc.look.copy(camera.position).add(rig.dir);
      return;
    }
    if (!dc.started) { dc.started = true; dc.from.copy(camera.position); }
    // the place to watch him from: on our side of him, a little above and aside
    const away = va.subVectors(dc.from, killer).setY(0);
    const dist = away.length() || 1;
    away.divideScalar(dist);
    const keep = clamp(dist * 0.4, 4.5, 9);
    const goal = vb.copy(killer).addScaledVector(away, keep).addScaledVector(vc.set(-away.z, 0, away.x), 1.4);
    goal.y = killer.y + 1.0;
    const want = vd.copy(dc.from).lerp(goal, smoothstep(HOLD, HOLD + TRAVEL, dc.t));
    // stop short of anything between where the camera is and where it wants to be
    const dx = want.x - dc.pos.x, dy = want.y - dc.pos.y, dz = want.z - dc.pos.z;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-4) {
      const hit = world.raycast(dc.pos.x, dc.pos.y, dc.pos.z, dx / len, dy / len, dz / len, len + 0.4, SHOT, { noWater: true });
      if (hit) want.set(dc.pos.x + (dx / len) * Math.max(0, hit.t - 0.4), dc.pos.y + (dy / len) * Math.max(0, hit.t - 0.4), dc.pos.z + (dz / len) * Math.max(0, hit.t - 0.4));
    }
    dc.pos.lerp(want, 1 - Math.exp(-6 * dt));
    let g = world.terrain ? world.terrain.height(dc.pos.x, dc.pos.z) + 0.4 : -Infinity;
    if (world.water && world.water.contains(dc.pos.x, dc.pos.z)) g = Math.max(g, world.water.level + 0.4);
    if (dc.pos.y < g) dc.pos.y = g;
    dc.look.lerp(killer, 1 - Math.exp(-5 * dt));
    camera.position.copy(dc.pos);
    camera.lookAt(dc.look);
    // keep him framed: tight while far, wider as the camera closes in
    const dk = dc.pos.distanceTo(killer);
    const fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(2.4 / Math.max(1, dk))) * 1.7, 16, rig.baseFov);
    camera.fov = damp(camera.fov, fov, 4, dt);
    camera.updateProjectionMatrix();
  };
  rig.resetDeathCam = () => { dc.t = 0; dc.started = false; };

  /* the aim blend, the recoil recovering, the shake dying away */
  function settle(dt, aiming, moveSpeed) {
    rig.aimT = damp(rig.aimT, aiming ? 1 : 0, 14, dt);
    rig.shoulderT = damp(rig.shoulderT, rig.shoulder, 10, dt);
    const rec = Math.exp(-9 * dt);
    rig.pitch += rig.kickPitch * (1 - rec) * 0.35;   // part of the kick stays (the player pulls down)
    rig.kickPitch *= rec;
    rig.kickYaw *= rec;
    rig.pitch = clamp(rig.pitch, CAMERA.minPitch, CAMERA.maxPitch);
    rig.shake *= Math.exp(-3.5 * dt);
    rig.shakeT += dt;
    rig.bob += dt * moveSpeed * 1.9;
  }
  function shakeAt(p) {
    if (rig.shake <= 0.001) return;
    const s = rig.shake * 0.12;
    p.x += noise2(rig.shakeT * 23, 1.3) * s;
    p.y += noise2(rig.shakeT * 21, 7.1) * s;
    p.z += noise2(rig.shakeT * 25, 3.7) * s;
  }

  /* First person. `eye`: his eyes this frame; `sight`: where the eye goes
     when aiming (behind the rear sight; null when the rifle is not up);
     `strafe`: sideways speed (positive to his left), for the lean. */
  rig.updateFirstPerson = (dt, eye, sight, aiming, { moveSpeed = 0, strafe = 0, sprint = false } = {}) => {
    settle(dt, aiming && !!sight, moveSpeed);
    rig.sprintT = damp(rig.sprintT, sprint ? 1 : 0, 6, dt);
    rig.forward(rig.dir);
    desired.copy(eye);
    if (sight) desired.lerp(sight, smoothstep(0, 1, rig.aimT));
    // a slight bob of the head with his steps (the body is steadied; less still down the sights)
    const amp = 0.0018 * Math.min(moveSpeed, 5.5) * (1 - 0.75 * rig.aimT);
    desired.y += Math.sin(rig.bob * 2) * amp;
    desired.x += -Math.cos(rig.yaw) * Math.sin(rig.bob) * amp * 0.6;
    desired.z += Math.sin(rig.yaw) * Math.sin(rig.bob) * amp * 0.6;
    shakeAt(desired);
    camera.position.copy(desired);
    look.copy(desired).add(rig.dir);
    camera.lookAt(look);
    rig.roll = damp(rig.roll, clamp(strafe, -4, 4) * 0.008 * (1 - rig.aimT), 6, dt);
    settleFlinch(dt);
    camera.rotateZ(rig.roll + rig.flinchRoll);
    camera.rotateX(rig.flinchPitch);
    // the over-the-shoulder orbit (death camera) starts from here, not 3 m back
    rig.dist = 0.3;
    const fov = lerp(rig.baseFov + CAMERA.sprintFov * rig.sprintT, CAMERA.fpAimFov * rig.baseFov / CAMERA.fov, rig.aimT);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  };

  /* `target`: the soldier's feet; `eye`: eye height for the stance. */
  rig.update = (dt, target, eye, aiming, moveSpeed = 0) => {
    settle(dt, aiming, moveSpeed);

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

    shakeAt(desired);
    camera.position.copy(desired);
    look.copy(desired).add(rig.dir);
    camera.lookAt(look);
    const fov = lerp(rig.baseFov, CAMERA.aimFov * rig.baseFov / CAMERA.fov, rig.aimT);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  };

  return rig;
}
