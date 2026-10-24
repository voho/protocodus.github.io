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
  addScaled, clamp, cross, dot, len, lenSq, normalize, qIntegrate, qRotate, qRotateInv, scale,
} from './vec.js';

export const NEUTRAL_CONTROLS = Object.freeze({
  pitch: 0, yaw: 0, roll: 0, strafe: 0, lift: 0,
  throttleDelta: 0, throttleSet: null, throttleZero: false, boost: false, toggleFA: false,
  speedSet: null,   // m/s: hold this forward speed (speed lock); null = throttle
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
    burnTime: 0, burnRamp: 0,   // how long the afterburner has been held, and its build-up 0 → 1
    thrust: 0,
    cruise: 0,   // the forward speed flight assist is holding, m/s
  };
}

export const forward = (o, ship) => qRotate(o, ship.q, [0, 0, -1]);
export const BURN_BUILD = 2.5;   // s for the afterburner to build to full

/* Mouse flight: the stick that swings the nose toward a world direction.
   The command grows with the angle off the nose and saturates at full
   stick, so the cursor's distance from the centre is the turn rate. Inside
   a third of a degree it is zero, so a held aim does not hunt. Roll is
   left to the pilot. */
const AIM_GAIN = 4, AIM_DEADZONE = 0.3 * Math.PI / 180;
const aimLocal = [0, 0, 0];
export function aimCommands(ship, dir, out = { pitch: 0, yaw: 0 }) {
  out.pitch = 0; out.yaw = 0;
  if (lenSq(dir) < 1e-12) return out;
  qRotateInv(aimLocal, ship.q, dir);
  const off = Math.acos(clamp(-aimLocal[2] / Math.sqrt(lenSq(aimLocal)), -1, 1));
  if (off < AIM_DEADZONE) return out;
  out.pitch = clamp(Math.atan2(aimLocal[1], -aimLocal[2]) * AIM_GAIN, -1, 1);
  out.yaw = clamp(Math.atan2(aimLocal[0], -aimLocal[2]) * AIM_GAIN, -1, 1);
  return out;
}
export const up = (o, ship) => qRotate(o, ship.q, [0, 1, 0]);
export const right = (o, ship) => qRotate(o, ship.q, [1, 0, 0]);

const vLocal = [0, 0, 0], aWorld = [0, 0, 0], cmd = [0, 0, 0], raw = [0, 0, 0];

export function stepShip(ship, c, dt) {
  const S = ship.stats, A = S.accel;
  if (c.toggleFA) ship.fa = !ship.fa;
  // A speed lock holds a speed directly — up to the afterburner's, without
  // spending its energy — and the throttle follows it, so letting go of the
  // lock leaves the ship where it was.
  const speedSet = c.speedSet != null ? clamp(c.speedSet, 0, S.fa.boostSpeed) : null;
  // A hulk with no cruise speed has no throttle to set.
  if (speedSet != null) ship.throttle = S.fa.forwardSpeed > 0 ? speedSet / S.fa.forwardSpeed : 0;
  else if (c.throttleSet != null) ship.throttle = c.throttleSet;
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
  // The afterburner builds: held longer, it pushes harder and runs faster —
  // twice the thrust and a third more speed after BURN_BUILD seconds.
  ship.burnTime = burning ? ship.burnTime + dt : 0;
  ship.burnRamp = Math.min(1, ship.burnTime / BURN_BUILD);
  const boostAccel = A.boost * (1 + ship.burnRamp);
  const boostSpeed = S.fa.boostSpeed * (1 + 0.35 * ship.burnRamp);

  const a = ship.accelLocal;
  const forwardMax = burning ? boostAccel : A.forward;
  if (ship.fa) {
    const tau = Math.max(S.fa.tau, dt);
    const target = burning ? boostSpeed : speedSet ?? ship.throttle * S.fa.forwardSpeed;
    ship.cruise = target;
    qRotateInv(vLocal, ship.q, ship.vel);
    a[0] = clamp((c.strafe * S.fa.strafeSpeed - vLocal[0]) / tau, -A.lateral, A.lateral);
    a[1] = clamp((c.lift * S.fa.strafeSpeed - vLocal[1]) / tau, -A.lateral, A.lateral);
    a[2] = clamp((-target - vLocal[2]) / tau, -forwardMax, A.reverse);
  } else {
    a[0] = c.strafe * A.lateral;
    a[1] = c.lift * A.lateral;
    if (burning) a[2] = -boostAccel;
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
// Each port's push and twist directions never change: worked out once per
// set of ports, six numbers a port, rather than for every small craft at
// every step.
const portAxes = new WeakMap();
function axesOf(ports) {
  let axes = portAxes.get(ports);
  if (!axes || axes.length !== ports.length * 6) {
    axes = new Float64Array(ports.length * 6);
    for (let index = 0; index < ports.length; index++) {
      const p = ports[index], k = index * 6;
      scale(push, p.dir, -1);
      normalize(torque, cross(torque, p.pos, push));
      axes[k] = push[0]; axes[k + 1] = push[1]; axes[k + 2] = push[2];
      axes[k + 3] = torque[0]; axes[k + 4] = torque[1]; axes[k + 5] = torque[2];
    }
    portAxes.set(ports, axes);
  }
  return axes;
}
export function selectRcsPorts(ports, accel, alpha, S, out = []) {
  lin[0] = accel[0]; lin[1] = accel[1]; lin[2] = Math.max(0, accel[2]);
  const linMag = len(lin), angMag = len(alpha);
  let n = 0;
  if (linMag < 1e-6 && angMag < 1e-6) { out.length = 0; return out; }
  normalize(lin, lin);
  normalize(ang, alpha);
  const A = S.angAccel;
  const linScale = Math.min(1, linMag / S.accel.lateral);
  const angScale = Math.min(1, angMag / Math.max(A[0], A[1], A[2]));
  const axes = axesOf(ports);
  for (let index = 0; index < ports.length; index++) {
    const k = index * 6;
    const l = linMag > 1e-6 ? (axes[k] * lin[0] + axes[k + 1] * lin[1] + axes[k + 2] * lin[2]) * linScale : 0;
    const r = angMag > 1e-6 ? (axes[k + 3] * ang[0] + axes[k + 4] * ang[1] + axes[k + 5] * ang[2]) * angScale : 0;
    const intensity = Math.min(1, Math.max(l, r));
    if (intensity > 0.15 && (l > 0.5 * linScale || r > 0.3 * angScale)) {
      // Entries are reused from step to step; only a new high-water mark
      // allocates. The list is written in place and cut to length after:
      // emptied first and pushed to, it would get a new store every step.
      if (!out.pool) out.pool = [];
      const entry = out.pool[n] ?? (out.pool[n] = { index: 0, intensity: 0 });
      entry.index = index; entry.intensity = intensity;
      out[n++] = entry;
    }
  }
  out.length = n;
  return out;
}
