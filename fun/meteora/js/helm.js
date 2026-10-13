/* Meteora — the helm: how freighters, shuttles and capital ships get about.

   A large ship has no dogfight to fly. It follows a route — a list of
   waypoints the mission laid through the belt's cleared lanes — at the speed
   it was given, through the same flight model as everything else: the
   controls point the nose at the next waypoint, hold the speed and keep the
   ship's "up" close to the belt's, so a convoy looks like a convoy and not
   a tumbling stack. It eases off toward the last waypoint and then holds
   station, or folds out if the mission said so. A halted ship (a convoy
   waiting for a lane to clear) brakes to a stop; a disabled one drifts. */

import { NEUTRAL_CONTROLS, aimCommands } from './flight.js';
import { clamp, len, qRotateInv, sub } from './vec.js';

const to = [0, 0, 0], worldUp = [0, 1, 0], local = [0, 0, 0], leg = [0, 0, 0];

export function createHelm({ path = [], speed = 50, arrive = null, then = 'hold', loop = false } = {}) {
  return { path: path.map(p => [...p]), index: 0, speed, arrive, then, loop, done: path.length === 0, halt: false };
}

export function setRoute(helm, path, { speed = helm.speed, then = helm.then } = {}) {
  helm.path = path.map(p => [...p]); helm.index = 0; helm.speed = speed; helm.then = then; helm.done = path.length === 0;
}

export function stepHelm(world, e, dt) {
  const c = { ...NEUTRAL_CONTROLS, fire: false };
  const h = e.helm;
  if (!h || e.disabled) return c;
  const ship = e.ship;
  if (h.halt || h.done || !h.path.length) {
    c.speedSet = 0;
  } else {
    const wp = h.path[h.index];
    sub(to, wp, ship.pos);
    const d = len(to);
    const arrive = h.arrive ?? Math.max(60, e.radius * 0.6);
    // A waypoint is reached when the ship comes within `arrive` of it, or
    // when it has crossed the gate: the plane through the waypoint square to
    // the leg it is flying. A heavy hull that slid past (a halt, a shove)
    // carries on instead of turning back to circle the point.
    const prev = h.index > 0 ? h.path[h.index - 1] : null;
    let passed = false;
    if (prev && d < Math.max(arrive * 6, 400)) {
      sub(leg, wp, prev);
      passed = -(to[0] * leg[0] + to[1] * leg[1] + to[2] * leg[2]) > 0;
    }
    if (d < arrive || passed) {
      h.index++;
      if (h.index >= h.path.length) {
        if (h.loop) h.index = 0;
        else {
          h.done = true;
          world.events.push({ type: 'arrived', id: e.id, name: e.name, pos: [...ship.pos] });
          if (h.then === 'fold') world.foldOut?.(e);
          c.speedSet = 0;
          return c;
        }
      }
    }
    // Ease off over the last stretch so the ship stops where it was sent.
    const last = h.index === h.path.length - 1 && !h.loop;
    const brake = last ? clamp(d / Math.max(arrive * 4, h.speed * 6), 0.15, 1) : 1;
    c.speedSet = h.speed * brake;
    aimCommands(ship, to, c);
  }
  // Keep the deck level with the belt: roll the ship's top toward world up,
  // as far as its heading allows (positive roll swings the top to the right).
  qRotateInv(local, ship.q, worldUp);
  c.roll = clamp(Math.atan2(local[0], local[1]) * 1.5, -1, 1);
  return c;
}
