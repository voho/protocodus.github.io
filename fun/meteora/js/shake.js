/* Meteora — what the pilot feels through the seat.

   A ship coasting in vacuum feels nothing; the shake here only comes from
   things that would really move a hull:

     fine    the main engine's tremor, proportional to the thrust it is
             actually making, plus a small kick each time a thruster fires;
             a barely-there hum at idle
     rumble  the afterburner's low, heavy shudder
     buffet  dust and grit hitting the hull — speed times how crowded the
             belt is here, so open space is a faint shiver and a dense clump
             at full speed is a rough ride

   Impact shake (hits, collisions, nearby explosions) is separate: it is
   feedback, not ambience, so the "ship vibration" setting never turns it
   off. Nothing here touches the simulation; aim and physics never shake. */

import { SHAKE } from './config.js';
import { makeRng } from './rng.js';

export function vibration({ thrust, afterburner, speed, density, rcs }, enabled) {
  if (!enabled) return { fine: 0, rumble: 0, buffet: 0 };
  return {
    fine: SHAKE.idle + SHAKE.engine * Math.max(0, thrust) + SHAKE.rcsKick * Math.min(1, rcs),
    rumble: afterburner ? SHAKE.rumble : 0,
    buffet: SHAKE.buffet * Math.max(0, speed) * Math.max(0, density),
  };
}

export function createShake(seed = 1) {
  const rng = makeRng(seed);
  const phase = () => [rng.range(0, 6.3), rng.range(0, 6.3), rng.range(0, 6.3)];
  return {
    rng, t: 0, impact: 0,
    finePhase: phase(), rumblePhase: phase(),
    buffet: [0, 0, 0], tick: [0, 0, 0], hit: [0, 0, 0],
  };
}

export function kick(shake, amount) {
  shake.impact = Math.min(SHAKE.maxImpact, shake.impact + amount);
}

export function stepShake(shake, amps, dt) {
  const { rng } = shake;
  shake.t += dt;
  shake.impact *= Math.pow(0.5, dt / 0.18);
  const k = Math.min(1, dt * 25);
  const tickChance = 0.6 * dt * 60 * SHAKE.buffetGrain * Math.min(1, amps.buffet * 4);
  const rot = [0, 0, 0], pos = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const t = shake.t;
    const fine = Math.sin(2 * Math.PI * 38 * t + shake.finePhase[i]) * 0.6
      + Math.sin(2 * Math.PI * 47 * t + shake.finePhase[i] * 1.7) * 0.4;
    const rumble = Math.sin(2 * Math.PI * 9 * t + shake.rumblePhase[i]) * 0.7
      + Math.sin(2 * Math.PI * 13.5 * t + shake.rumblePhase[i] * 2.3) * 0.3;
    // Grit: low-passed noise plus the occasional bigger grain.
    shake.buffet[i] += (rng.range(-1, 1) - shake.buffet[i]) * k;
    if (rng.next() < tickChance) shake.tick[i] = rng.range(-1, 1) * 2.5;
    shake.tick[i] *= Math.pow(0.5, dt / 0.03);
    shake.hit[i] += (rng.range(-1, 1) - shake.hit[i]) * Math.min(1, dt * 30);
    const ambient = amps.fine * fine + amps.rumble * rumble + amps.buffet * (shake.buffet[i] + shake.tick[i]);
    rot[i] = ambient * 0.004 + shake.impact * shake.hit[i] * 0.03;
    pos[i] = ambient * 0.05 + shake.impact * shake.hit[i] * 0.15;
  }
  return { rot, pos };
}
