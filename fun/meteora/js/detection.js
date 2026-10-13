/* Meteora — being seen.

   The Harrow's Eyes watch for one thing: a ship's signature, the sum of
   how big a return it gives, how hot its reactor runs and what it is doing.

     signature = hull × reactor × (0.6 + 0.4 · speed / cruise)
                 × 2.2 while the afterburner burns
                 × 1.8 for two seconds after the guns fire
                 × the Hush reactor's silence once cold for three seconds

   An Eye notices the player when the player stays inside its range — 700 m
   times that signature — for a second, with a clear line of sight: a rock
   (or a hull) between the two hides the player completely. Leaving the
   range lets the Eye's attention fade at half the rate it built. The
   difficulty widens or narrows the range and quickens or slows the
   attention (`eyeRange`, `eyeTime`). */

import { len } from './vec.js';

export const DETECT = { buildTime: 1, fade: 0.5, firing: 2, burner: 2.2, firingMul: 1.8, silentAfter: 3 };

export function signature(world, e) {
  const S = e.ship.stats;
  const speed = len(e.ship.vel);
  let sig = (e.signature ?? 1) * (0.6 + 0.4 * Math.min(1.6, speed / Math.max(1, S.fa.forwardSpeed)));
  if (e.ship.afterburner) sig *= DETECT.burner;
  const sinceFire = world.time - (e.lastFired ?? -99);
  if (sinceFire < DETECT.firing) sig *= DETECT.firingMul;
  if ((e.silent ?? 1) < 1 && sinceFire > DETECT.silentAfter && !e.ship.afterburner && world.time - (e.lastBoost ?? -99) > DETECT.silentAfter) {
    sig *= e.silent;
  }
  return sig;
}

const blocked = (world, from, to, self, other) => {
  if (world.field.sweepSphere(from, to, 0.5)) return true;
  return false;
};

/* Step every active Eye against the player. Returns nothing; fires a
   `detected` event the moment an Eye's attention fills. */
export function stepSentries(world, dt) {
  const p = world.player;
  if (!p?.alive) return;
  const sig = signature(world, p);
  world.playerSignature = sig;
  const scale = world.diff?.eyeRange ?? 1, build = DETECT.buildTime * (world.diff?.eyeTime ?? 1);
  for (const e of world.sentries) {
    if (!e.alive || e.folding || e.frozen) continue;
    const range = (e.detectRange ?? 700) * sig * scale;
    e.detectRangeNow = range;
    const d = Math.hypot(p.ship.pos[0] - e.ship.pos[0], p.ship.pos[1] - e.ship.pos[1], p.ship.pos[2] - e.ship.pos[2]);
    e.seesPlayer = d < range && !blocked(world, e.ship.pos, p.ship.pos, e, p);
    if (e.seesPlayer) e.attention = Math.min(1, (e.attention ?? 0) + dt / build);
    else e.attention = Math.max(0, (e.attention ?? 0) - dt * DETECT.fade);
    if (e.attention >= 1 && !e.alarmed) {
      e.alarmed = true;
      world.events.push({ type: 'detected', id: e.id, pos: [...e.ship.pos] });
    }
  }
}
