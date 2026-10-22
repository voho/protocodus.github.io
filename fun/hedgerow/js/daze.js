/* Hedgerow — dazed by a blast close by.

   How hard it hit (0..1: combat.js, by how close it was and whether a wall
   stood between) and how it wears off: at its worst for the first fifth of
   the time, then easing away, over three seconds for a blast that only just
   reached him and nine for one at his feet. A weaker blast while he is
   dazed changes nothing; a harder one starts it over. What it does is
   elsewhere: the view swims (camera.js), doubles, smears towards the edges,
   loses its colour and flashes white at the blast (post.js), everything he
   hears goes dull behind a ringing in the ears (audio.js), and he moves and
   turns slower (player.js). */

import { smoothstep } from './util.js';

export function createDaze() {
  let peak = 0, len = 0;
  const d = {
    level: 0,      // 0 clear .. 1 stunned
    t: 99,         // seconds since the blast
    hit(amount) {
      amount = Math.min(1, amount);
      if (amount <= d.level) return;
      peak = amount;
      len = 3 + 6 * amount;
      d.t = 0;
      d.level = amount;
    },
    update(dt) {
      if (d.level <= 0) return 0;
      d.t += dt;
      d.level = d.t >= len ? 0 : peak * (1 - smoothstep(0.2 * len, len, d.t));
      return d.level;
    },
    reset() { d.level = 0; d.t = 99; peak = 0; },
  };
  return d;
}
