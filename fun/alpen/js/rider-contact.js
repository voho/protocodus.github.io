// The existing rider contact volume: a horizontal disc and a vertical band.
const RADIUS_SQ = 2.5;
const RADIUS = Math.sqrt(RADIUS_SQ);
const HALF_HEIGHT = 2.2;

/* A and B are player-minus-NPC positions at the two ends of a frame. Return
   the first contact fraction, or -1 when their paths do not meet. The open
   horizontal and vertical intervals must overlap in time: testing height
   only at the closest horizontal point misses some descending contacts. */
export function sweptRiderContact(ax, ay, az, bx, by, bz) {
  // Most figures are far away. Reject their bounds before solving roots.
  if ((ax >= RADIUS && bx >= RADIUS) || (ax <= -RADIUS && bx <= -RADIUS)
    || (az >= RADIUS && bz >= RADIUS) || (az <= -RADIUS && bz <= -RADIUS)
    || (ay >= HALF_HEIGHT && by >= HALF_HEIGHT)
    || (ay <= -HALF_HEIGHT && by <= -HALF_HEIGHT)) return -1;

  let enter = 0;
  let exit = 1;
  const dy = by - ay;
  if (dy === 0) {
    if (!(Math.abs(ay) < HALF_HEIGHT)) return -1;
  } else {
    const a = (-HALF_HEIGHT - ay) / dy;
    const b = (HALF_HEIGHT - ay) / dy;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (!(enter < exit)) return -1;
  }

  const dx = bx - ax;
  const dz = bz - az;
  const a = dx * dx + dz * dz;
  const c = ax * ax + az * az - RADIUS_SQ;
  if (a === 0) {
    if (!(c < 0)) return -1;
  } else {
    const b = ax * dx + az * dz;
    const discriminant = b * b - a * c;
    // A tangent only touches the boundary, matching the original strict <.
    if (!(discriminant > 0)) return -1;
    const root = Math.sqrt(discriminant);
    enter = Math.max(enter, (-b - root) / a);
    exit = Math.min(exit, (-b + root) / a);
  }
  return enter < exit ? enter : -1;
}
