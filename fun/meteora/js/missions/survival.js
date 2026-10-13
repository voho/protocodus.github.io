/* Meteora — Survival: the original endless waves, as a mission.

   Waves of three, then one more each wave up to ten, folding in from
   somewhere the player is not looking. From the third wave the Harrow mix
   in their other craft: a pack of Mites every third wave, Talons from the
   fifth. A kill scores 100 × the wave; secondaries rearm one round every
   eight seconds; the best score is kept per hull. */

import { FIELD, COMBAT } from '../config.js';
import { defineMission } from '../mission.js';
import { spawnPoints, waveSize } from '../combat.js';
import { setDefaultMission } from '../world.js';
import { forward } from '../flight.js';
import { normalize, sub } from '../vec.js';

export const SURVIVAL = defineMission({
  id: 'survival', title: 'Survival', location: 'Belt sector 7', field: FIELD, fieldSeed: 1234, seed: 1234,
  bestKey: 'meteora.best', rearm: 8, hints: false, music: 'combat',
  // A kill scores its class's worth times the wave.
  scoreKill: (e, world) => (e.def.score ?? 100) * Math.max(1, world.wave),
  *script(m) {
    const w = m.world;
    const hostilesLeft = () => w.entities.some(e => e.team === 1 && e.alive);
    for (;;) {
      w.wave++;
      const p = w.player;
      const n = waveSize(w.wave);
      const points = spawnPoints(w.rng, p.ship.pos, forward([0, 0, 0], p.ship), n);
      for (const pos of points) {
        const cls = w.wave >= 5 && w.rng.next() < 0.22 ? 'talon' : 'thorn';
        m.spawn(cls, { team: 1, pos, forward: normalize([0, 0, 0], sub([0, 0, 0], p.ship.pos, pos)), throttle: 0.8, tags: ['wave'] });
      }
      if (w.wave >= 3 && w.wave % 3 === 0) {
        const at = points[0];
        for (let k = 0; k < 6; k++) {
          const pos = at.map((c, i) => c + w.rng.range(-80, 80) + (i === 1 ? 40 : 0));
          m.spawn('mite', { team: 1, pos, forward: normalize([0, 0, 0], sub([0, 0, 0], p.ship.pos, pos)), throttle: 1, tags: ['wave'] });
        }
      }
      w.events.push({ type: 'wave', n: w.wave, count: w.entities.filter(e => e.team === 1 && e.alive).length });
      yield m.until(() => !hostilesLeft());
      yield m.wait(COMBAT.wave.delay);
    }
  },
});

setDefaultMission(SURVIVAL);
