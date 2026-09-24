/* Flow — the meter behind the score multiplier, and every rule that moves it.

   It lived inline in `main.js`, which is the one file in the game that cannot
   be imported without a page around it, so the rules that decide what a run
   is worth could only ever be judged by riding. They are pure arithmetic on
   two numbers — the meter and its hold — so they live here, and the node
   checks can drive them with the real rider on the real mountain.

   THE METER WAS FREE, and that is the whole reason this file changed rather
   than merely moved. Measured with the physics harness, a rider doing nothing
   but steering down the groomed line filled the meter in nine seconds and
   then spent ninety per cent of the run at the top multiplier. A wipeout took
   half of it away and plain riding put it back inside five seconds. So the
   multiplier said nothing about how a run was going, the MAX FLOW banner
   fired on every drop-in, and a crash cost nothing worth avoiding.

   Riding is now worth a floor rather than a ceiling. Clean, fast carving on
   its own settles at `SCORE.flowCruise` — a ×3 run — and everything above
   that has to be earned by something the rider did: a landed trick, a
   butter, a cocoa stop. Each of those re-arms `flowHold`, and while the hold
   runs nothing fades; once it lapses the surplus relaxes back towards the
   cruise level, so a ×12 run is one that keeps doing things rather than one
   that did something once. The clock only runs on the snow, because a rider
   in the air is already in the middle of the next thing. */

import { RIDER, SCORE } from './config.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* What a payout is worth in meter. Sub-linear on purpose: a trick worth ten
   times another should not fill the bar ten times faster, or one enormous
   air ends the progression and everything after it is decoration. */
export function flowFromPoints(pts) {
  return Math.sqrt(Math.max(0, pts)) * SCORE.flowPerPoint;
}

/* An award paid into the meter. Most awards also re-arm the hold; a gate
   does not, because every gate on this mountain spans the whole piste and
   staying on the piste is riding, not a trick. */
export function feedFlow(game, amount, hold = true) {
  game.flow = Math.min(1, game.flow + amount);
  if (hold) game.flowHold = SCORE.flowHold;
}

/* The multiplier the meter is worth, in whole steps. `>= 0.99` counts as
   full, the same threshold MAX FLOW fires on: a meter the player has been
   told is full must show the multiplier they were promised. */
export function comboFor(flow) {
  const t = flow >= 0.99 ? 1 : flow;
  return Math.min(SCORE.comboMax,
    1 + Math.floor(t * (SCORE.comboMax - 1) + 1e-6));
}

/* One fixed physics step of the meter, for a live run.

   The three riding terms are the three things "flow" means on a snowboard:
   keep moving, keep it clean, and put the board on edge. (They were once
   gated on `carveLoad > 0.4`, which nothing on the piste ever reaches — carve
   load is the share of available grip a turn is using, and a full-lock turn
   sits near 0.08 — so the meter only moved when a trick or a gate moved it.)
   They now fill only the room left under the cruise level, easing off over
   its last stretch so the meter settles instead of stepping onto a limit.
   Below the cruise level the leak still applies, so a straight glide holds
   rather than climbs. Above it, the surplus is untouched while the hold runs
   and relaxes towards cruise once it lapses.

   W spends the meter at any level. Flow is the fuel for the powered tuck as
   well as the multiplier — `rider.flowDrive`, written from this after every
   step, is what the powered floor reads — so a fast line or a big
   multiplier remains the decision it was built to be. */
export function stepFlowMeter(game, rider, dt) {
  if (!rider.grounded) return;
  const cruise = SCORE.flowCruise;
  game.flowHold = Math.max(0, (game.flowHold || 0) - dt);

  const clean = rider.state === 'ride' && rider.slide < 1.2;
  if (clean && rider.speed > 6) {
    const fast = clamp01((rider.speed - 6) / (RIDER.baseMaxSpeed - 6));
    const room = clamp01((cruise - game.flow) / (cruise * SCORE.flowCruiseEase));
    game.flow += (0.058 + fast * 0.06 + rider.carveLoad * 0.40) * room * dt;
  } else if (rider.slide > 2.0) {
    game.flow -= rider.slide * 0.1 * dt;
  }

  if (game.flow <= cruise) {
    game.flow -= 0.05 * dt;
  } else if (game.flowHold <= 0) {
    game.flow -= (game.flow - cruise) * SCORE.flowFade * dt;
  }

  if (rider.tucking && rider.state === 'ride') {
    game.flow -= SCORE.flowTuckDrain * dt;
  }
  game.flow = clamp01(game.flow);
}
