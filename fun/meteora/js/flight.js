/* Meteora — the flight model.

   Six degrees of freedom and nothing else: a ship has a position, a
   velocity, an orientation and a body-frame angular velocity, and the only
   way to change the last two is a thruster with a finite push. There is no
   drag and no speed limit in the physics.

   Flight assist is a controller on top of that physics, not a different
   physics. With FA on, the throttle and the strafe keys ask for a velocity
   in the ship's own frame, and each axis's thrusters push toward it as hard
   as they can and no harder. Turn the nose 90° at speed and the old
   velocity is now sideways; the lateral thrusters, at half the main
   engine's push, take seconds to cancel it, and the ship slides. That
   slide is the whole feel of the game, and it falls out of honest thrust
   limits rather than being animated in.

   With FA off the controller is gone: the stick fires the rotation
   thrusters and the throttle fires the main engine, and whatever you set
   moving stays moving, spin included.

   Sign conventions (body frame, nose −Z, top +Y, right +X):
     w[0] about +X — positive raises the nose  (pitch +1 = nose up)
     w[1] about +Y — positive swings the nose left, so yaw +1 = −w[1]
     w[2] about +Z — positive lifts the right wing, so roll +1 = −w[2] */

import {
  addScaled, clamp, cross, dot, len, normalize, qIntegrate, qRotate, qRotateInv, scale,
} from './vec.js';

export const NEUTRAL_CONTROLS = Object.freeze({
  pitch: 0, yaw: 0, roll: 0, strafe: 0, lift: 0,
  throttleDelta: 0, throttleSet: null, throttleZero: false, boost: false, toggleFA: false,
});

export function createShip(stats, { pos, vel, q } = {}) {
  return {
    stats,
    pos: pos ? [...pos] : [0, 0, 0],
    vel: vel ? [...vel] : [0, 0, 0],
    q: q ? [...q] : [0, 0, 0, 1],
    w: [0, 0, 0],
    throttle: 0,
    boost: stats.boost.capacity,
    boostIdle: 0,
    boostLocked: false,
    fa: true,
    accelLocal: [0, 0, 0],
    alphaLocal: [0, 0, 0],
    afterburner: false,
    thrust: 0,
  };
}

export const forward = (o, ship) => qRotate(o, ship.q, [0, 0, -1]);
export const up = (o, ship) => qRotate(o, ship.q, [0, 1, 0]);
export const right = (o, ship) => qRotate(o, ship.q, [1, 0, 0]);

const vLocal = [0, 0, 0], aWorld = [0, 0, 0], cmd = [0, 0, 0], raw = [0, 0, 0];

export function stepShip(ship, c, dt) {
  const S = ship.stats, A = S.accel;
  if (c.toggleFA) ship.fa = !ship.fa;
  if (c.throttleSet != null) ship.throttle = c.throttleSet;
  else if (c.throttleZero) ship.throttle = 0;
  else ship.throttle += c.throttleDelta * S.throttle.rampPerSecond * dt;
  ship.throttle = clamp(ship.throttle, S.throttle.min, 1);

  // Afterburner energy: drain while burning, regenerate only after a quiet
  // spell, and once it runs dry stay off until there is enough to matter —
  // otherwise a held key flickers the burner on every regenerated drop.
  const burning = c.boost && !ship.boostLocked && ship.boost > 0;
  if (burning) {
    ship.boost = Math.max(0, ship.boost - S.boost.drain * dt);
    ship.boostIdle = 0;
    if (ship.boost === 0) ship.boostLocked = true;
  } else {
    ship.boostIdle += dt;
    if (ship.boostIdle >= S.boost.regenDelay) {
      ship.boost = Math.min(S.boost.capacity, ship.boost + S.boost.regen * dt);
    }
    if (ship.boostLocked && ship.boost >= S.boost.relock) ship.boostLocked = false;
  }
  ship.afterburner = burning;

  const a = ship.accelLocal;
  const forwardMax = burning ? A.boost : A.forward;
  if (ship.fa) {
    const tau = Math.max(S.fa.tau, dt);
    const target = burning ? S.fa.boostSpeed : ship.throttle * S.fa.forwardSpeed;
    qRotateInv(vLocal, ship.q, ship.vel);
    a[0] = clamp((c.strafe * S.fa.strafeSpeed - vLocal[0]) / tau, -A.lateral, A.lateral);
    a[1] = clamp((c.lift * S.fa.strafeSpeed - vLocal[1]) / tau, -A.lateral, A.lateral);
    a[2] = clamp((-target - vLocal[2]) / tau, -forwardMax, A.reverse);
  } else {
    a[0] = c.strafe * A.lateral;
    a[1] = c.lift * A.lateral;
    if (burning) a[2] = -A.boost;
    else if (ship.throttle >= 0) a[2] = -ship.throttle * A.forward;
    else a[2] = (ship.throttle / S.throttle.min) * A.reverse;
  }

  raw[0] = c.pitch; raw[1] = -c.yaw; raw[2] = -c.roll;
  for (let i = 0; i < 3; i++) {
    let alpha;
    if (ship.fa) {
      const tau = Math.max(S.fa.tauAngular, dt);
      cmd[i] = raw[i] * S.rate[i];
      alpha = clamp((cmd[i] - ship.w[i]) / tau, -S.angAccel[i], S.angAccel[i]);
    } else {
      alpha = clamp(raw[i], -1, 1) * S.angAccel[i];
    }
    ship.alphaLocal[i] = alpha;
    const cap = S.rate[i] * S.spinCap;
    ship.w[i] = clamp(ship.w[i] + alpha * dt, -cap, cap);
  }

  ship.thrust = Math.max(0, -a[2]) / A.forward;
  // Semi-implicit Euler: velocity first, then position from the new velocity.
  addScaled(ship.vel, ship.vel, qRotate(aWorld, ship.q, a), dt);
  addScaled(ship.pos, ship.pos, ship.vel, dt);
  qIntegrate(ship.q, ship.w, dt);
}

/* Attitude thrusters. The main engine owns forward thrust along −Z; every
   other push — sideways, vertical, reverse, and every torque — comes from
   the small ports. A port's gas leaves along `dir`, so it pushes the ship
   along −dir and twists it by pos × −dir. A port fires when that push or
   that twist lines up with what the controller is asking for, scaled by
   how hard it is asking. */
const push = [0, 0, 0], torque = [0, 0, 0], lin = [0, 0, 0], ang = [0, 0, 0];
export function selectRcsPorts(ports, accel, alpha, S) {
  lin[0] = accel[0]; lin[1] = accel[1]; lin[2] = Math.max(0, accel[2]);
  const linMag = len(lin), angMag = len(alpha), out = [];
  if (linMag < 1e-6 && angMag < 1e-6) return out;
  normalize(lin, lin);
  normalize(ang, alpha);
  const linScale = Math.min(1, linMag / S.accel.lateral);
  const angScale = Math.min(1, angMag / Math.max(...S.angAccel));
  for (let index = 0; index < ports.length; index++) {
    const p = ports[index];
    scale(push, p.dir, -1);
    normalize(torque, cross(torque, p.pos, push));
    const l = linMag > 1e-6 ? dot(push, lin) * linScale : 0;
    const r = angMag > 1e-6 ? dot(torque, ang) * angScale : 0;
    const intensity = Math.min(1, Math.max(l, r));
    if (intensity > 0.15 && (l > 0.5 * linScale || r > 0.3 * angScale)) out.push({ index, intensity });
  }
  return out;
}
