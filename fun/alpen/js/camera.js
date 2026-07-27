/* The chase camera, which is most of what the player actually feels.

   Three ideas hold it together.

   It follows where the rider is *going*, not where the board is pointing.
   When the edge lets go and the board swings sideways, the camera stays
   behind the direction of travel — so you watch your own board slide out in
   front of you, which is the single most legible way to show a drift.

   It rides the rider's suspension. The camera's height is tied to the leg
   spring, so a landing drops it and lets it back up, and a hard carve squats
   it. The screen moves because the rider's body moved, not because a shake
   was scheduled.

   And it lags with a spring rather than a lerp, so it overshoots slightly on
   a direction change and settles — which reads as weight. A lerp reads as a
   camera on a stick. */

import { CAMERA, RENDER } from './config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createChaseCamera(THREE, camera) {
  const at = new THREE.Vector3();
  const look = new THREE.Vector3();
  const want = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const flat = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  let started = false;
  let shake = 0;
  let fov = RENDER.fov;
  let roll = 0;
  let seed = 0;

  function kick(amount) {
    shake = Math.min(2.4, shake + amount);
  }

  function update(rider, dt, world) {
    const speed = rider.speed;
    const ratio = clamp(speed / 42, 0, 1);
    const air = !rider.grounded;
    const tuck = rider.tucking ? 1 : 0;

    // Which way the run is actually heading: mostly the velocity, a little
    // the board. Pure velocity swims about at low speed; pure heading hides
    // every slide the rider makes.
    flat.set(rider.vel.x, 0, rider.vel.z);
    if (flat.lengthSq() < 9) flat.set(Math.sin(rider.yaw), 0, -Math.cos(rider.yaw));
    flat.normalize();
    tmp.set(Math.sin(rider.yaw), 0, -Math.cos(rider.yaw));
    dir.copy(flat).multiplyScalar(CAMERA.velocityBias)
      .addScaledVector(tmp, 1 - CAMERA.velocityBias).normalize();

    const back = CAMERA.distance + ratio * 1.6 + tuck * CAMERA.tuckPull;
    const up = (air ? CAMERA.airHeight : CAMERA.height)
      - rider.compression * 0.85
      - tuck * CAMERA.tuckDrop;

    want.copy(rider.pos).addScaledVector(dir, -back);
    want.y = rider.pos.y + up;

    // Never let the hill come between the camera and the rider
    const floor = world.height(want.x, want.z) + 1.5;
    if (want.y < floor) want.y = floor;

    // …and never let a tree. Ride into the forest and the chase position
    // lands inside a trunk, which fills the screen with the inside of a
    // cone at exactly the moment the player most needs to see what happened.
    // Walking the line back towards the rider costs five circle tests and
    // fixes it: the camera tucks in rather than clipping through.
    if (world.blocked) {
      for (let t = 0.85; t >= 0.3; t -= 0.18) {
        if (!world.blocked(want.x, want.z, 1.2)) break;
        want.x = rider.pos.x + (want.x - rider.pos.x) * t;
        want.z = rider.pos.z + (want.z - rider.pos.z) * t;
        want.y = Math.max(want.y, world.height(want.x, want.z) + 1.5);
      }
    }

    wantLook.copy(rider.pos).addScaledVector(dir, CAMERA.lookAhead * (0.6 + 0.4 * ratio));
    wantLook.y = rider.pos.y + 1.1 + (air ? -1.2 : 0);

    if (!started) {
      started = true;
      at.copy(want);
      look.copy(wantLook);
    }

    const lag = air ? CAMERA.airLag : CAMERA.lag;
    const k = 1 - Math.exp(-lag * dt);
    at.lerp(want, k);
    look.lerp(wantLook, 1 - Math.exp(-(lag + 2) * dt));

    // --- shake ------------------------------------------------------------
    // Two sources, both earned: the ground chattering under the board at
    // speed, and whatever just hit the rider. Neither happens in the air.
    const chatter = air || rider.state === 'fall'
      ? 0
      : ratio * ratio * CAMERA.shake * (0.5 + 0.5 * rider.carveLoad);
    shake = Math.max(0, shake - dt * 4.5);
    const amp = (chatter + shake) * 0.06;
    seed += dt * 47;
    const sx = Math.sin(seed * 1.7) * Math.sin(seed * 0.53);
    const sy = Math.sin(seed * 2.3 + 1.3) * Math.sin(seed * 0.71);

    camera.position.copy(at);
    camera.position.x += sx * amp;
    camera.position.y += sy * amp;
    camera.lookAt(look);

    // Roll the frame a little into the carve. Small — past about ten degrees
    // it stops reading as lean and starts reading as a broken horizon.
    const wantRoll = -rider.roll * CAMERA.roll + sx * amp * 0.06;
    roll += (wantRoll - roll) * (1 - Math.exp(-5 * dt));
    camera.rotateZ(roll);

    // Speed opens the frame; the tuck closes it again
    const wantFov = RENDER.fov
      + (RENDER.fovAtSpeed - RENDER.fov) * ratio * ratio
      + tuck * CAMERA.tuckFov
      + (air ? -3 : 0);
    fov += (wantFov - fov) * (1 - Math.exp(-3.5 * dt));
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function reset() {
    started = false;
    shake = 0;
    fov = RENDER.fov;
    roll = 0;
  }

  return { update, kick, reset, get shake() { return shake; } };
}

