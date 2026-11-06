/* Small geometry decisions shared by enemy tactics and the simulation checks.
   These use plain positions; no render objects or random state are involved. */

/* A soldier holds fire when a living comrade's body crosses the muzzle-to-
   target corridor. The extra width accounts for the next footstep rather
   than letting two men shoot through one another while changing places. */
export function friendlyInFireLane(shooter, muzzle, target, soldiers) {
  const dx = target.x - muzzle.x, dz = target.z - muzzle.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 0.01) return null;
  for (const other of soldiers) {
    if (other === shooter || other.dead) continue;
    const t = ((other.pos.x - muzzle.x) * dx + (other.pos.z - muzzle.z) * dz) / len2;
    if (t <= 0 || t >= 1) continue;
    const x = muzzle.x + dx * t, z = muzzle.z + dz * t;
    if ((other.pos.x - x) ** 2 + (other.pos.z - z) ** 2 > 0.52 ** 2) continue;
    const y = muzzle.y + (target.y - muzzle.y) * t;
    const top = other.pos.y + (other.stance === 'crouch' ? 1.25 : 1.85);
    if (y > other.pos.y + 0.08 && y < top) return other;
  }
  return null;
}

/* The flank must change the firing angle, not simply move another man to
   the same wall. Moving closer to the threat is not itself a flank. */
export function flankAngle(from, to, threat) {
  const ax = from.x - threat.x, az = from.z - threat.z;
  const bx = to.x - threat.x, bz = to.z - threat.z;
  const len = Math.hypot(ax, az) * Math.hypot(bx, bz);
  return len > 0.01 ? Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / len))) : 0;
}
