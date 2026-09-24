// Run with: node tests/flow-check.mjs
import assert from 'node:assert/strict';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { Rider, trickName, CLEAN, BAIL } from '../js/rider.js';
import { RIDER, SCORE, PROPS } from '../js/config.js';
import {
  heightAt, getTerrainMaterialAt, nearestCenter, corridorHalfAt, beyondLipAt,
  guideAt, gateSlotsIn,
} from '../js/terrain.js';
import { setWorldSeed } from '../js/noise.js';
import {
  comboFor, feedFlow, flowFromPoints, stepFlowMeter,
} from '../js/flow.js';

const dt = 1 / 120;

// The multiplier steps.
assert.equal(comboFor(0), 1);
assert.equal(comboFor(0.989), SCORE.comboMax - 1);
assert.equal(comboFor(0.99), SCORE.comboMax, 'a meter called full pays the top step');
assert.equal(comboFor(1), SCORE.comboMax);

// Awards cap at a full bar; a gate pays without holding the meter.
{
  const g = { flow: 0.95, flowHold: 0 };
  feedFlow(g, 0.2);
  assert.equal(g.flow, 1);
  assert.equal(g.flowHold, SCORE.flowHold);
  const gate = { flow: 0.4, flowHold: 0 };
  feedFlow(gate, 0.03, false);
  assert.equal(gate.flowHold, 0, 'staying on the piste is not a trick');
}

// Held while the hold runs, relaxing towards cruise once it lapses, and the
// clock only runs on the snow.
{
  const carving = {
    grounded: true, state: 'ride', slide: 0, speed: 30, carveLoad: 0.15, tucking: false,
  };
  const g = { flow: 1, flowHold: SCORE.flowHold };
  for (let t = 0; t < SCORE.flowHold - 0.05; t += dt) stepFlowMeter(g, carving, dt);
  assert.equal(g.flow, 1, 'a fresh award is not bled while its hold runs');
  const air = { ...carving, grounded: false };
  const before = g.flowHold;
  for (let t = 0; t < 1; t += dt) stepFlowMeter(g, air, dt);
  assert.equal(g.flowHold, before, 'airtime does not spend the hold');
  for (let t = 0; t < 30; t += dt) stepFlowMeter(g, carving, dt);
  assert.ok(g.flow > SCORE.flowCruise && g.flow < 0.4,
    `thirty seconds of plain riding brings a full bar back near cruise (${g.flow})`);
  // …and plain riding from empty settles under it.
  const fresh = { flow: 0, flowHold: 0 };
  for (let t = 0; t < 60; t += dt) stepFlowMeter(fresh, carving, dt);
  assert.ok(fresh.flow < SCORE.flowCruise && fresh.flow > SCORE.flowCruise * 0.6,
    `riding alone settles below cruise (${fresh.flow})`);
  // W spends the meter at any level.
  const tuck = { flow: 0.8, flowHold: SCORE.flowHold };
  stepFlowMeter(tuck, { ...carving, tucking: true }, 1);
  assert.ok(tuck.flow < 0.8 - SCORE.flowTuckDrain * 0.9, 'the tuck drains a held meter');
}

/* The economy on the real mountain: the real rider, a steering bot, and the
   award rules from main.js. Riding the line with no tricks must stay a low
   multiplier; a rider landing tricks must still reach the top of the bar. */
// The race gates as props.js plants them: a pair of panels either side of
// the racing line on every guide slot, scored across PROPS.gateHalf.
function raceGates(zLo) {
  return gateSlotsIn(zLo, 0).map((slot) => ({ x: slot.x, z: slot.z, half: PROPS.gateHalf }))
    .sort((a, b) => b.z - a.z);
}

function ride(seed, seconds, tricks) {
  setWorldSeed(seed);
  const world = {
    height: heightAt,
    surfaceAt: getTerrainMaterialAt,
    canStall: (x, z) => Math.abs(x - nearestCenter(x, z)) > corridorHalfAt(z),
    beyond: beyondLipAt,
    grip: 1,
    surfaceDrag: 1,
  };
  const rider = new Rider(THREE, world);
  rider.reset(0, guideAt(0));
  const game = { flow: 0, flowHold: 0, gateRun: 0 };
  let maxCombo = 1;
  let fullAt = null;
  let landed = 0;
  rider.on('land', (s) => {
    if (!s.judged || s.verdict === BAIL) return;
    const reach = (RIDER.grabs[s.grabKind] || RIDER.grabs[0]).reach;
    const pts = s.halfTurns * 180 * SCORE.perDegree + s.flipTurns * SCORE.perFlip
      + s.grabTime * SCORE.grabPerSecond * reach + s.airTime * SCORE.airPerSecond;
    if (!trickName(s, s.verdict) || pts < SCORE.minTrickScore) return;
    landed += 1;
    feedFlow(game, flowFromPoints(pts) * (s.verdict === CLEAN ? 1 : SCORE.flowSketchy));
  });
  rider.on('fall', () => {
    game.flow *= 1 - SCORE.flowBail;
    game.flowHold = 0;
  });
  const gates = raceGates(-4000);
  let next = 0;
  const control = { turn: 0, tuck: false, brake: false, jump: false, trickGrab: false, trickFlip: false };
  let turn = 0;
  let clock = 0;
  let spin = 0;
  const prevZ = { z: 0, x: 0 };
  for (let t = 0; t < seconds; t += dt) {
    // Steer for the racing line a little way ahead, as the attract rider does.
    const heading = Math.atan2(rider.vel.x, -rider.vel.z);
    const want = Math.atan2(guideAt(rider.pos.z - 26) - rider.pos.x, 26) - heading;
    turn += (Math.max(-1, Math.min(1, want * 2.4)) - turn) * Math.min(1, dt * 12);
    control.turn = Math.abs(turn) < 0.08 ? 0 : Math.sign(turn) * Math.min(1, Math.abs(turn) * 1.4);
    control.jump = false;
    control.trickGrab = false;
    if (tricks) {
      clock += dt;
      if (rider.grounded) {
        // Load for the full charge every four seconds, then let go.
        if (clock > 4) control.jump = clock < 4 + RIDER.chargeTime;
        if (clock > 4 + RIDER.chargeTime) { clock = 0; spin = 0.5; }
      } else if (rider.airTime > 0.05) {
        control.turn = spin > 0 && rider.airTime < 0.55 ? 1 : 0;
        control.trickGrab = rider.airTime > 0.12 && rider.airTime < 0.6;
      }
    }
    prevZ.z = rider.pos.z;
    prevZ.x = rider.pos.x;
    rider.step(dt, control);
    while (next < gates.length && gates[next].z > rider.pos.z) {
      const g = gates[next++];
      const f = (prevZ.z - g.z) / (prevZ.z - rider.pos.z || 1);
      const x = prevZ.x + (rider.pos.x - prevZ.x) * f;
      if (Math.abs(x - g.x) > g.half) { game.gateRun = 0; continue; }
      game.gateRun = Math.min(SCORE.gateRunMax, game.gateRun + 1);
      feedFlow(game, SCORE.flowGate * Math.sqrt(game.gateRun), false);
    }
    stepFlowMeter(game, rider, dt);
    rider.flowDrive = game.flow;
    maxCombo = Math.max(maxCombo, comboFor(game.flow));
    if (fullAt === null && game.flow >= 0.99) fullAt = t;
  }
  return { maxCombo, fullAt, landed, flow: game.flow };
}

const seeds = ['alpine-review', 'k2', 'matterhorn'];
for (const seed of seeds) {
  const cruise = ride(seed, 60, false);
  assert.equal(cruise.fullAt, null, `${seed}: riding the line alone never fills the bar`);
  assert.ok(cruise.maxCombo <= 5, `${seed}: riding the line alone stays a low multiplier (×${cruise.maxCombo})`);
  const trick = ride(seed, 60, true);
  assert.ok(trick.landed >= 8, `${seed}: the trick bot lands tricks (${trick.landed})`);
  // A modest spin-and-grab every four seconds, and the race gates missed
  // whenever a landing puts the bot off the line: within a minute. Where in
  // the minute swings by a trick's interval with any change to the flight
  // (41–59 s across seeds and tunings), so the minute is the claim.
  assert.ok(trick.fullAt !== null && trick.fullAt < 60,
    `${seed}: steady tricks reach a full bar (${trick.fullAt})`);
}

console.log('Flow checks passed: multiplier steps, hold and fade, tuck spend, cruise ceiling and trick-built max on three seeds.');
