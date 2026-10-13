/* Meteora — the Tender, the repair drone a damaged pilot can call.

   It comes from the nearest friendly carrier or station when there is one
   within reach, otherwise it folds in nearby. It flies to its patient
   flat out, slows to match, and docks on the patient's spine when the two
   are within 40 m and the patient is holding under 35 m/s. Docked, it rides
   along — the patient can fly, but not fast: above 80 m/s the clamps let go
   and it has to catch up again. It mends hull up to 85 % (or 60 points of
   per cent more, whichever is higher) at 9 % a second and restocks the
   secondary banks, then it leaves and folds out. Enemies can shoot it down. */

import { NEUTRAL_CONTROLS, aimCommands } from './flight.js';
import { hardpoints } from './hardpoints.js';
import { steerClear } from './ai.js';
import { clamp, len, qRotate, sub } from './vec.js';

export const TENDER = {
  dockRange: 40, dockSpeed: 35, holdSpeed: 80,
  rate: 0.09, floor: 0.85, gain: 0.6, restock: 1.5, leave: 3, giveUp: 30,
};

const dockW = [0, 0, 0], tmp = [0, 0, 0], off = [0, 0, 0];

/* World position the drone's centre should sit at when docked. */
function dockPosition(o, drone, patient) {
  const pd = hardpoints(patient.model).dock ?? [0, patient.radius * 0.3, 0];
  const dd = hardpoints(drone.model).dock ?? [0, -1, 0];
  qRotate(dockW, patient.ship.q, pd);
  qRotate(off, patient.ship.q, dd);
  o[0] = patient.ship.pos[0] + dockW[0] - off[0];
  o[1] = patient.ship.pos[1] + dockW[1] - off[1];
  o[2] = patient.ship.pos[2] + dockW[2] - off[2];
  return o;
}

export function repairTarget(patient) {
  return Math.min(patient.maxHull, Math.max(patient.maxHull * TENDER.floor, patient.hull + patient.maxHull * TENDER.gain));
}

export function stepTender(world, drone, dt) {
  const c = { ...NEUTRAL_CONTROLS, fire: false };
  const T = drone.tender;
  const patient = world.byId.get(T.patientId);
  if (T.state !== 'leave' && (!patient || !patient.alive)) { T.state = 'leave'; T.t = 0; }
  if (T.state === 'approach') {
    const at = dockPosition(tmp, drone, patient);
    const to = sub([0, 0, 0], at, drone.ship.pos);
    const d = len(to);
    const pv = patient.ship.vel, ps = len(pv);
    // Close on the dock point, matching the patient's motion as it nears;
    // on the way, steer round rocks and hulls (its own station's included)
    // as the pilots do.
    if (d > 120) steerClear(drone, { field: world.field, larges: world.larges }, [to[0] / d, to[1] / d, to[2] / d], c);
    else aimCommands(drone.ship, d > 30 ? to : (ps > 3 ? pv : to), c);
    c.speedSet = clamp(ps + d * 0.9, 0, drone.ship.stats.fa.boostSpeed);
    // Held up for too long (boxed in by rock, a hull in the way): it folds
    // across to its patient instead.
    T.t += dt;
    if (T.t > TENDER.giveUp && d > 300) {
      const back = qRotate([0, 0, 0], patient.ship.q, [0.4, 0.5, 1]);
      const n = len(back) || 1;
      for (let k = 0; k < 3; k++) { drone.ship.pos[k] = patient.ship.pos[k] + back[k] / n * 160; drone.ship.vel[k] = pv[k]; }
      T.t = 0;
      world.events.push({ type: 'foldIn', id: drone.id, pos: [...drone.ship.pos], q: [...drone.ship.q], radius: drone.radius, big: false, team: drone.team, dur: 0.8 });
      return c;
    }
    const rel = Math.hypot(drone.ship.vel[0] - pv[0], drone.ship.vel[1] - pv[1], drone.ship.vel[2] - pv[2]);
    // The player must slow down for it; a crippled wingman is simply caught.
    const slowEnough = patient !== world.player || ps < TENDER.dockSpeed;
    if (d < TENDER.dockRange && slowEnough && rel < 60) {
      T.state = 'docked'; T.t = 0;
      world.events.push({ type: 'tenderDocked', id: drone.id, patientId: patient.id });
    }
    return c;
  }
  if (T.state === 'docked') {
    // Ride along on the spine; let go if the patient runs.
    if (patient === world.player && len(patient.ship.vel) > TENDER.holdSpeed) {
      T.state = 'approach';
      world.events.push({ type: 'tenderLost', id: drone.id, patientId: patient.id });
      return c;
    }
    dockPosition(drone.ship.pos, drone, patient);
    drone.ship.vel[0] = patient.ship.vel[0]; drone.ship.vel[1] = patient.ship.vel[1]; drone.ship.vel[2] = patient.ship.vel[2];
    for (let k = 0; k < 4; k++) drone.ship.q[k] = patient.ship.q[k];
    drone.ship.w[0] = drone.ship.w[1] = drone.ship.w[2] = 0;
    T.t += dt;
    const goal = T.goal ?? (T.goal = repairTarget(patient));
    patient.hull = Math.min(goal, patient.hull + patient.maxHull * TENDER.rate * dt);
    // Restock the racks, a round at a time.
    T.restock -= dt;
    if (T.restock <= 0 && patient.banks) {
      T.restock = 1 / TENDER.restock;
      const bank = patient.banks.find(b => b.count < b.max);
      if (bank) bank.count++;
    }
    const stocked = !patient.banks || patient.banks.every(b => b.count >= b.max);
    if (patient.hull >= goal - 1e-6 && stocked && T.t > 2) {
      T.state = 'leave'; T.t = 0;
      world.events.push({ type: 'tenderDone', id: drone.id, patientId: patient.id });
    }
    return { ...c, docked: true };
  }
  // Leaving: climb away off the patient's back, then fold out.
  T.t += dt;
  const away = patient?.alive ? qRotate([0, 0, 0], patient.ship.q, [0, 1, 0.4]) : qRotate([0, 0, 0], drone.ship.q, [0, 0, -1]);
  aimCommands(drone.ship, away, c);
  c.speedSet = 160;
  if (T.t > TENDER.leave && !drone.folding) world.foldOut(drone);
  return c;
}
