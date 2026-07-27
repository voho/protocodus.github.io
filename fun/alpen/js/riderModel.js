/* The rider, as something to look at.

   Three pieces, and no more: a board, a body, and a blob of shadow. The
   board is separate because it has to stay flat on the snow while the body
   leans off it; the shadow is separate because it belongs to the ground.
   Everything else — the crouch, the tuck, the grab, the tumble — is done by
   moving and scaling the body, which is all a low-poly rider at this size
   can express anyway, and all it needs to.

   The orientation is composed rather than eulered: the board is stood up on
   the surface normal first, then turned, then flipped, then rolled. Doing it
   in that order means a flip is always about the board's own lateral axis
   and a carve is always about its length, whatever the hill underneath is
   doing. */

import { compose } from './geom.js';
import { RIDER } from './config.js';

const RISE_TIME = RIDER.riseTime;

const INK = '#232830';
const MINT = '#00ffc3';
const YELLOW = '#ffc400';
const SKIN = '#c98f6a';
const DENIM = '#39445a';

export function createRiderModel(THREE) {
  const root = new THREE.Group();

  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 7);
  const ball = new THREE.SphereGeometry(0.5, 7, 5);

  // --- board ---------------------------------------------------------------
  // Longer than it is wide by four to one, with the nose and tail lifted:
  // at this resolution the rocker is most of what says "snowboard"
  const board = new THREE.Mesh(
    compose(THREE, [
      { geo: box, color: YELLOW, pos: [0, 0.06, 0], scale: [0.31, 0.045, 1.15] },
      { geo: box, color: YELLOW, pos: [0, 0.10, -0.66], rot: [0.30, 0, 0], scale: [0.28, 0.045, 0.34] },
      { geo: box, color: YELLOW, pos: [0, 0.10, 0.66], rot: [-0.30, 0, 0], scale: [0.28, 0.045, 0.34] },
      // bindings
      { geo: box, color: INK, pos: [0, 0.12, -0.24], scale: [0.26, 0.07, 0.20] },
      { geo: box, color: INK, pos: [0, 0.12, 0.24], scale: [0.26, 0.07, 0.20] },
      // a stripe down the base so a spin reads from behind
      { geo: box, color: MINT, pos: [0, 0.032, 0], scale: [0.09, 0.04, 1.0] },
    ]),
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  root.add(board);

  // --- body ----------------------------------------------------------------
  // Built standing on the board's centre, facing -Z, feet at y = 0
  const body = new THREE.Group();
  const torso = new THREE.Mesh(
    compose(THREE, [
      // boots and legs, angled out to the bindings
      { geo: box, color: INK, pos: [0, 0.14, -0.24], scale: [0.20, 0.16, 0.22] },
      { geo: box, color: INK, pos: [0, 0.14, 0.24], scale: [0.20, 0.16, 0.22] },
      { geo: cyl, color: DENIM, pos: [0, 0.42, -0.18], rot: [0.22, 0, 0], scale: [0.19, 0.62, 0.19] },
      { geo: cyl, color: DENIM, pos: [0, 0.42, 0.18], rot: [-0.22, 0, 0], scale: [0.19, 0.62, 0.19] },
      // jacket
      { geo: box, color: INK, pos: [0, 0.95, 0], scale: [0.42, 0.52, 0.34] },
      { geo: box, color: MINT, pos: [0, 0.80, 0], scale: [0.43, 0.09, 0.35] },
      // arms, out for balance
      { geo: cyl, color: INK, pos: [-0.05, 0.94, -0.32], rot: [0.5, 0, 0.35], scale: [0.14, 0.56, 0.14] },
      { geo: cyl, color: INK, pos: [0.05, 0.94, 0.32], rot: [-0.5, 0, -0.35], scale: [0.14, 0.56, 0.14] },
      { geo: ball, color: SKIN, pos: [-0.11, 0.72, -0.46], scale: [0.13, 0.13, 0.13] },
      { geo: ball, color: SKIN, pos: [0.11, 0.72, 0.46], scale: [0.13, 0.13, 0.13] },
      // head, helmet, and a mint visor so the facing direction is never in doubt
      { geo: ball, color: SKIN, pos: [0, 1.32, 0], scale: [0.20, 0.22, 0.20] },
      { geo: ball, color: INK, pos: [0, 1.37, 0], scale: [0.23, 0.22, 0.23] },
      { geo: box, color: MINT, pos: [0, 1.32, -0.17], scale: [0.28, 0.10, 0.10] },
    ]),
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  body.add(torso);
  root.add(body);

  // --- shadow --------------------------------------------------------------
  // The blob every game of this vintage used, and still the cheapest way to
  // say exactly where in the air something is
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.85, 14),
    new THREE.MeshBasicMaterial({
      color: 0x0d1c33, transparent: true, opacity: 0.34,
      depthWrite: false, fog: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 2;

  // --- posing --------------------------------------------------------------
  const q = new THREE.Quaternion();
  const qy = new THREE.Quaternion();
  const qx = new THREE.Quaternion();
  const qz = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const AX = new THREE.Vector3(1, 0, 0);
  const AZ = new THREE.Vector3(0, 0, 1);
  const up = new THREE.Vector3();

  function update(rider, dt) {
    // How far down the rider is: all the way through the fall, then back up
    // across the recovery window. A step function here reads as the rider
    // teleporting upright the instant the timer runs out.
    const down = rider.state === 'fall'
      ? 1
      : rider.state === 'rise'
        ? Math.max(0, Math.min(1, rider.fallTimer / RISE_TIME))
        : 0;
    const falling = down > 0;

    // Stand the whole rider on the surface, then turn, flip and roll it in
    // its own frame. In the air the reference drifts back to true vertical.
    up.copy(rider.normal);
    if (!rider.grounded) up.lerp(UP, Math.min(1, rider.airTime * 2.5)).normalize();
    q.setFromUnitVectors(UP, up);
    qy.setFromAxisAngle(UP, rider.yaw);
    qx.setFromAxisAngle(AX, rider.flip + rider.tumble * down);
    qz.setFromAxisAngle(AZ, -rider.roll * (1 + 1.2 * down));
    q.multiply(qy).multiply(qx).multiply(qz);

    root.quaternion.copy(q);
    root.position.copy(rider.pos);
    // The board rides the extension: over a roller it floats, on a landing
    // it is pressed into the snow a moment before the body catches up
    root.position.y += Math.max(0, rider.extension) * 0.15;

    // Crouch. One number does the tuck, the ollie charge, the landing
    // absorption and the g-load of a hard carve, because they are the same
    // thing happening to the same legs.
    const squat = Math.max(0, rider.compression);
    const stretch = Math.max(0, -rider.compression);
    const grab = rider.grab;

    body.position.y = -squat * 0.75 + stretch * 0.5;
    body.scale.set(1 + squat * 0.22, 1 - squat * 0.5 + stretch * 0.28, 1 + squat * 0.22);
    // Into a grab the body folds over the board and reaches for the edge
    body.rotation.x = grab * 0.62 - squat * 0.35;
    body.position.z = grab * 0.1;
    if (falling) {
      // Blended rather than assigned, so getting up is a rise rather than a
      // snap: at down = 1 the rider is folded flat, at 0 they are riding
      body.rotation.x = body.rotation.x * (1 - down) + 1.1 * down;
      body.position.y = body.position.y * (1 - down) - 0.25 * down;
    }

    // Shadow: pinned to the ground under the rider, fading and shrinking as
    // the gap opens, which is what makes a jump's height readable
    const gy = rider.world.height(rider.pos.x, rider.pos.z);
    const gap = Math.max(0, rider.pos.y - gy);
    shadow.position.set(rider.pos.x, gy + 0.05, rider.pos.z);
    const k = Math.max(0, 1 - gap / 14);
    shadow.scale.setScalar(0.55 + 0.45 * k);
    shadow.material.opacity = 0.34 * k * k;
    shadow.visible = k > 0.02;
  }

  return { root, shadow, update };
}
