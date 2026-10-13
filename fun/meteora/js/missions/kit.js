/* Meteora — the pieces missions are built from.

   Small helpers over the mission API (mission.js) for the things every
   mission does: place a point off another, protect a ship (and lose when
   it dies), run a convoy, send a wave, keep a tally. */

import { normalize, sub } from '../vec.js';

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const dir = (a, b) => normalize([0, 0, 0], sub([0, 0, 0], b, a));
export const at = (from, bearingDeg, distance, y = 0) => {
  const r = bearingDeg * Math.PI / 180;
  return [from[0] + Math.sin(r) * distance, from[1] + y, from[2] - Math.cos(r) * distance];
};
export const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* Lose the mission when `e` is destroyed (a critical objective), or just
   fail an objective. */
export function protect(m, e, objectiveId, reason) {
  m.on('shipKilled', ev => { if (ev.id === e.id) m.fail(objectiveId, reason); });
}

/* Call `fn(ev)` once when `e` dies. */
export function onDeath(m, e, fn) {
  let done = false;
  m.on('shipKilled', ev => { if (!done && ev.id === e.id) { done = true; fn(ev); } });
}

/* A convoy: ships in a column along a path, each with a helm. */
export function convoy(m, list, path, { speed = 50, spacing = 260, then = 'hold', tags = ['convoy'], team = 0 } = {}) {
  const ships = [];
  const start = path[0], heading = dir(path[0], path[1]);
  list.forEach(([cls, name], k) => {
    const pos = [start[0] - heading[0] * spacing * k, start[1] - heading[1] * spacing * k, start[2] - heading[2] * spacing * k];
    const route = [pos, ...path.slice(1)];
    const e = m.spawn(cls, { team, name, pos, forward: heading, tags, helm: { path: route, speed, then }, objective: true });
    e.ship.vel = heading.map(v => v * speed);
    e.ship.throttle = 1;
    ships.push(e);
  });
  return ships;
}

/* Count arrivals (helm finished or folded out) and losses among `ships`. */
export function tally(m, ships) {
  const t = { arrived: new Set(), lost: new Set() };
  const ids = new Set(ships.map(s => s.id));
  m.on('arrived', ev => { if (ids.has(ev.id)) t.arrived.add(ev.id); });
  m.on('departed', ev => { if (ids.has(ev.id)) t.arrived.add(ev.id); });
  m.on('shipKilled', ev => { if (ids.has(ev.id)) t.lost.add(ev.id); });
  return t;
}

/* A wave folding in at a point, aimed at `toward`, preferring targets
   tagged `prefer`. Returns the ships. */
export function wave(m, cls, n, where, { toward = null, prefer = null, spread = 160, orders = null, tags = [], ...o } = {}) {
  const ships = m.group(cls, n, where, { team: 1, toward: toward ?? m.player, spread, prefer, tags: ['wave', ...tags], ...o });
  if (orders) m.order(ships, orders);
  return ships;
}

/* Bombers sent at a large target (optionally a named subsystem). */
export function strike(m, cls, n, where, target, { sub = null, escort = null, ...o } = {}) {
  const bombers = wave(m, cls, n, where, { toward: target, ...o });
  m.order(bombers, { type: 'strike', target, sub });
  return bombers;
}

export const aliveOf = list => list.filter(e => e.alive);
