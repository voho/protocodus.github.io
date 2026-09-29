// DOM-free flight choreography. Presentation only: the simulation moves a plane along its straight saved path and
// holds it on the ground for AIR_TURNAROUND days at each airport; this module turns (route, stations, vehicle)
// into a pose: ground position, height, heading and phase. Continuous tile space (tile x spans [x, x + 1]); heights in levels.
import { AIR_TURNAROUND } from './station-sites.js';
// Ground timeline inside one turnaround, in days from touchdown.
export const GROUND = { rollout: .2, taxiIn: .3, parked: .5, taxiOut: .3, roll: .3 };
export const RUNWAY_V = 1.5, APRON_V = .52, CONNECTORS = [2.1, 3.9], STANDS = [2.45, 3.55];
const TOUCHDOWN_U = .9, LIFTOFF_U = 1.4; // for a landing toward +u; mirrored (6 − u) otherwise
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

export function airportAxis(station) { return station.axis === 'y' ? { x: 0, y: 1 } : { x: 1, y: 0 }; }
export function airportPlace(station, u, v) { return station.axis === 'y' ? { x: station.x + v, y: station.y + u } : { x: station.x + u, y: station.y + v }; }
export function airportCentre(station) { return airportPlace(station, 3, 1); }
/** +1 when a plane from `other` lands toward local +u at `here`; −1 otherwise. Take-off back is the opposite. */
export function landingSign(here, other) {
  const a = airportCentre(here), b = airportCentre(other), U = airportAxis(here);
  return (a.x - b.x) * U.x + (a.y - b.y) * U.y >= 0 ? 1 : -1;
}
const mirrorU = (s, u) => s > 0 ? u : 6 - u;
// Polyline with rounded corners, sampled into an arc-length table.
function roundedPath(points, radius = .28, samples = 10) {
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const la = Math.hypot(b.x - a.x, b.y - a.y), lc = Math.hypot(c.x - b.x, c.y - b.y), r = Math.min(radius, la / 2, lc / 2);
    const p = { x: b.x + (a.x - b.x) * r / la, y: b.y + (a.y - b.y) * r / la }, q = { x: b.x + (c.x - b.x) * r / lc, y: b.y + (c.y - b.y) * r / lc };
    for (let k = 0; k <= samples; k++) { const t = k / samples, m = 1 - t; out.push({ x: m * m * p.x + 2 * m * t * b.x + t * t * q.x, y: m * m * p.y + 2 * m * t * b.y + t * t * q.y }); }
  }
  out.push(points.at(-1));
  return table(out);
}
function table(points) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  return { points, lengths, total: lengths.at(-1) };
}
function along(path, fraction) {
  const target = Math.max(0, Math.min(1, fraction)) * path.total, L = path.lengths;
  let lo = 0, hi = L.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (L[mid] <= target) lo = mid; else hi = mid; }
  const a = path.points[lo], b = path.points[hi], span = L[hi] - L[lo] || 1, t = (target - L[lo]) / span;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, heading: Math.atan2(b.y - a.y, b.x - a.x) };
}
function cubicTable(p0, p1, p2, p3, samples = 48) {
  const points = [];
  for (let k = 0; k <= samples; k++) { const t = k / samples, m = 1 - t; points.push({ x: m * m * m * p0.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t * t * t * p3.x, y: m * m * m * p0.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t * t * t * p3.y }); }
  return table(points);
}
/** Local ground paths at one airport for a landing sign and stand, cached by the caller. */
export function groundPaths(station, sign, stand) {
  const P = (u, v) => airportPlace(station, mirrorU(sign, u), v);
  const standU = STANDS[stand], exit = CONNECTORS[0], leave = CONNECTORS[1];
  return {
    rollout: table([P(TOUCHDOWN_U, RUNWAY_V), P(exit - .3, RUNWAY_V)]),
    taxiIn: roundedPath([P(exit - .3, RUNWAY_V), P(exit, RUNWAY_V), P(exit, APRON_V), P(standU, APRON_V)]),
    parked: P(standU, APRON_V),
    parkedHeading: Math.atan2(P(standU + 1, APRON_V).y - P(standU, APRON_V).y, P(standU + 1, APRON_V).x - P(standU, APRON_V).x),
    taxiOut: roundedPath([P(standU, APRON_V), P(leave, APRON_V), P(leave, RUNWAY_V), P(leave - .3, RUNWAY_V)]),
    roll: table([P(leave - .3, RUNWAY_V), P(LIFTOFF_U, RUNWAY_V)]),
  };
}
/** The visible flight from lift-off at `from` to touchdown at `to`: one cubic, tangent to both runways. */
export function flightPath(from, to) {
  const out = landingSign(from, to), inn = landingSign(to, from);
  const start = airportPlace(from, mirrorU(out, LIFTOFF_U), RUNWAY_V), end = airportPlace(to, mirrorU(inn, TOUCHDOWN_U), RUNWAY_V);
  const U0 = airportAxis(from), U1 = airportAxis(to), h0 = -out, h1 = inn; // take-off runs opposite to that airport's landings
  const span = Math.hypot(end.x - start.x, end.y - start.y), k = Math.max(2, Math.min(6, span / 3));
  return cubicTable(start, { x: start.x + U0.x * h0 * k, y: start.y + U0.y * h0 * k }, { x: end.x - U1.x * h1 * k, y: end.y - U1.y * h1 * k }, end);
}
/** Height in levels along a flight of `total` tiles: climb over 7 tiles, descend over 9. */
export function flightHeight(distance, total, groundFrom, groundTo, cruise) {
  const climb = groundFrom + (cruise - groundFrom) * smooth(distance / 7), descend = groundTo + (cruise - groundTo) * smooth((total - distance) / 9);
  return Math.min(climb, descend);
}
const hash = id => { let h = 2166136261; for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
export const standFor = vehicle => hash(vehicle.id) % 2;
/** Ground phase name for a dwell, for the vehicle card ('rollout' | 'taxiIn' | 'parked' | 'taxiOut' | 'roll'). */
export function groundPhase(dwellRemaining) { let t = AIR_TURNAROUND - dwellRemaining; for (const [name, d] of Object.entries(GROUND)) { if (t < d) return name; t -= d; } return 'roll'; }
/**
 * Pose for one plane. `stations` = [stop0, stop1]; heights(station) → its ground level;
 * cruise → the route's cruise level. Returns {x, y, z, heading, phase, ground}. `cache` is kept per route by the renderer.
 */
export function aircraftPose(route, stations, vehicle, { heights, cruise, cache = {} }) {
  const [a, b] = stations, max = route.path.length - 1, dwell = vehicle.dwellRemaining || 0;
  const atEnd = vehicle.progress >= max - 1e-9, atStart = vehicle.progress <= 1e-9;
  if (dwell > 0 && (atEnd || atStart)) {
    // After an arrival the direction has already flipped: −1 means the plane is at stop 1.
    const here = vehicle.direction === -1 ? b : a, other = here === a ? b : a, sign = landingSign(here, other), stand = standFor(vehicle);
    const key = `${here.id}:${sign}:${stand}`, paths = cache[key] ||= groundPaths(here, sign, stand), z = heights(here);
    let t = AIR_TURNAROUND - dwell;
    const phase = (name, path, ease) => { const p = along(path, ease(t / GROUND[name])); return { ...p, z, phase: name, ground: true }; };
    if (t < GROUND.rollout) return phase('rollout', paths.rollout, u => 1 - (1 - u) * (1 - u)); t -= GROUND.rollout;
    if (t < GROUND.taxiIn) return phase('taxiIn', paths.taxiIn, smooth); t -= GROUND.taxiIn;
    if (t < GROUND.parked) return { ...paths.parked, heading: paths.parkedHeading, z, phase: 'parked', ground: true }; t -= GROUND.parked;
    if (t < GROUND.taxiOut) return phase('taxiOut', paths.taxiOut, smooth); t -= GROUND.taxiOut;
    return phase('roll', paths.roll, u => u * u);
  }
  // In the air: the model's progress fraction maps onto the visible flight by arc length.
  const from = vehicle.direction === 1 ? a : b, to = from === a ? b : a;
  const key = `${from.id}>${to.id}`, flight = cache[key] ||= flightPath(from, to);
  const fraction = vehicle.direction === 1 ? vehicle.progress / max : 1 - vehicle.progress / max;
  const p = along(flight, fraction), distance = fraction * flight.total;
  const z = flightHeight(distance, flight.total, heights(from), heights(to), cruise);
  return { ...p, z, phase: 'air', ground: false, distance, total: flight.total };
}
