/* Meteora — the Well: a black hole's pull.

   Gravity near a black hole is not Newton's: it grows faster than 1/r² as
   the horizon nears, and there is a radius inside which no orbit holds and
   nothing falls slowly. The Paczyński–Wiita potential, Φ = −GM / (r − rₛ),
   catches both in a form a game can step — the pull −GM / (r − rₛ)²
   becomes infinite at the horizon rₛ, the innermost stable orbit falls at
   3 rₛ and the marginally bound one at 2 rₛ, as in general relativity —
   and it is what this module applies to every ship.

   Two numbers are a game's, not nature's. The horizon is drawn kilometres
   across, and GM is chosen not from it (a real hole that size would
   accelerate things at billions of g) but so that a dead hulk dropped
   twenty kilometres out takes some four minutes to reach the horizon:
   time for a rescue. Everything else follows from the law: hulks with a
   little sideways speed swing in on long arcs and arrive later, ships
   under power hold their place until the pull outgrows their thrust, and
   for each ship there is a radius — its point of no return — below which
   full thrust straight out no longer climbs. */

export function createWell({ pos, rs, gm }) {
  const self = {
    pos: [...pos], rs, gm,
    /* The pull at a point: acceleration into `out`; returns its size. */
    accel(p, out = [0, 0, 0]) {
      const dx = self.pos[0] - p[0], dy = self.pos[1] - p[1], dz = self.pos[2] - p[2];
      const r = Math.hypot(dx, dy, dz);
      if (r < 1e-6) { out[0] = out[1] = out[2] = 0; return Infinity; }
      const a = gm / Math.max(1, r - rs) ** 2;
      out[0] = dx / r * a; out[1] = dy / r * a; out[2] = dz / r * a;
      return a;
    },
    distance(p) { return Math.hypot(p[0] - self.pos[0], p[1] - self.pos[1], p[2] - self.pos[2]); },
    /* The radius where the pull equals an acceleration: below it, a ship
       with that much thrust can only fall. */
    radiusFor(accel) { return rs + Math.sqrt(gm / Math.max(1e-6, accel)); },
    /* The speed of a circular orbit at r — though inside 3 rₛ no orbit is
       stable, and a nudge sends a hulk down. */
    circular(r) { return r > rs ? Math.sqrt(gm * r) / (r - rs) : Infinity; },
    /* How long a hulk with this position and velocity has before it
       reaches the horizon, by stepping its fall ahead: Infinity if it does
       not within `limit` seconds. */
    timeToHorizon(p, v, { limit = 900, dt = 0.5 } = {}) {
      const x = [p[0] - self.pos[0], p[1] - self.pos[1], p[2] - self.pos[2]], u = [...v];
      let t = 0;
      while (t < limit) {
        const r = Math.hypot(x[0], x[1], x[2]);
        if (r <= rs * 1.05) return t;
        if (r > 1e6) return Infinity;
        // Finer steps where the pull is strong and the fall fast.
        const h = Math.max(0.005, Math.min(dt, 0.02 * (r - rs) / Math.max(1, Math.hypot(u[0], u[1], u[2]))));
        const a = gm / Math.max(1, r - rs) ** 2;
        for (let k = 0; k < 3; k++) u[k] -= x[k] / r * a * h;
        for (let k = 0; k < 3; k++) x[k] += u[k] * h;
        t += h;
      }
      return Infinity;
    },
  };
  return self;
}
