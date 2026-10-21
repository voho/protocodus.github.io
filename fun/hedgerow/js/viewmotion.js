/* Hedgerow — how the rifle and the eye move in first person beyond the
   body's own animation: small springs, all in radians or metres.

   Sway: the rifle lags a touch behind a quick turn of the view and swings
   back as the turn stops (a fifth as much down the sights, so the sight
   picture stays); at most about three degrees.
   Kick: each shot throws the muzzle up and the spring brings it back with a
   slight overshoot, as a rifle settles in the shoulder.
   Landing: the eye drops with the knees on landing, as far as the fall was
   hard, and comes back up. */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* a damped spring towards `target`, stepped in small pieces so it is steady at any frame rate */
function spring(stiff, damping) {
  const s = { x: 0, v: 0 };
  s.step = (dt, target) => {
    for (let left = dt; left > 1e-6;) {
      const h = Math.min(left, 1 / 240);
      s.v += (stiff * (target - s.x) - damping * s.v) * h;
      s.x += s.v * h;
      left -= h;
    }
    return s.x;
  };
  return s;
}

export function createViewMotion({ swayPerRad = 0.016, swayMax = 0.05, aimSway = 0.2 } = {}) {
  const swayYaw = spring(220, 26), swayPitch = spring(220, 26);
  const kick = spring(600, 30);            // a little under critical: one soft overshoot
  const drop = spring(160, 22);
  let lastYaw = null, lastPitch = null;
  return {
    /* a shot: `amount` is how far the muzzle is thrown up (radians per second of kick) */
    kick(amount) { kick.v += amount * 30; },
    /* touching down at `speed` metres per second (downwards) */
    land(speed) { drop.v -= clamp(speed - 2, 0, 12) * 0.12; },
    /* the frame: the view's yaw and pitch now, how far aimed in (0..1) */
    update(dt, yaw, pitch, aimT = 0) {
      if (lastYaw === null || dt <= 0) { lastYaw = yaw; lastPitch = pitch; return { yaw: 0, pitch: 0, drop: 0 }; }
      let dy = yaw - lastYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const vy = dy / dt, vp = (pitch - lastPitch) / dt;
      lastYaw = yaw; lastPitch = pitch;
      const k = swayPerRad * (1 - (1 - aimSway) * aimT);
      const ty = clamp(-vy * k, -swayMax, swayMax), tp = clamp(-vp * k, -swayMax, swayMax);
      return {
        yaw: swayYaw.step(dt, ty),
        pitch: swayPitch.step(dt, tp) + kick.step(dt, 0),
        drop: Math.min(0, drop.step(dt, 0)),
      };
    },
    reset() { for (const s of [swayYaw, swayPitch, kick, drop]) { s.x = 0; s.v = 0; } lastYaw = null; },
  };
}
