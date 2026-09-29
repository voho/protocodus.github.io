import { randomAt } from './environment.js';
import { CARGO, TRANSIT_CLASSES, TRANSIT_PAY_FLOOR, DISTANCE_TILES, HANDLING_TILES, DETOUR_PAY_LIMIT, VEHICLE_SPEEDS, TRAVEL_PACE, STOP_DAYS } from './data.js';

const START_DATE = Date.UTC(1950, 0, 1);
const DAY_MS = 86400000;
const MAX_INDEX = 1_000_000;
const MAX_PRICE = 1_000_000_000_000;
const cache = new WeakMap();

export function calendarYear(game, day = game.day) {
  return new Date(START_DATE + Math.max(0, Math.floor(day || 0)) * DAY_MS).getUTCFullYear();
}

/** Air travel opens on 1 January of this year; earlier companies see the Airport tool greyed. */
export const AIR_DEBUT_YEAR = 1952;
export const airAvailable = (game, day = game.day) => calendarYear(game, day) >= AIR_DEBUT_YEAR;

export function calendarMonth(game, day = game.day) {
  const date = new Date(START_DATE + Math.max(0, Math.floor(day || 0)) * DAY_MS);
  return (date.getUTCFullYear() - 1950) * 12 + date.getUTCMonth();
}

export function availableVehicleLevel(game) {
  return Math.max(0, calendarYear(game) - 1950);
}

function annualRate(game, yearIndex) {
  return (100 + Math.floor(randomAt(game, yearIndex, 'inflation', 811) * 401)) / 10000;
}

/** Gregorian years match the HUD; rates depend only on the saved world seed. */
export function inflationInfo(game, day = game.day) {
  const year = calendarYear(game, day), yearIndex = Math.max(0, year - 1950);
  let previous = cache.get(game);
  if (!previous || previous.seed !== game.seed || previous.yearIndex > yearIndex) previous = { seed: game.seed, yearIndex: 0, index: 1 };
  let index = previous.index;
  // A financial ceiling bounds work even for a far-future save. Ordinary play
  // compounds every annual rate exactly, with no generated schedule to persist.
  for (let n = previous.yearIndex + 1; n <= yearIndex && index < MAX_INDEX; n++) index = Math.min(MAX_INDEX, index * (1 + annualRate(game, n)));
  cache.set(game, { seed: game.seed, yearIndex, index });
  return { year, yearIndex, rate: yearIndex ? annualRate(game, yearIndex) : 0, index };
}

export function priceFor(game, basePrice, day = game.day) {
  if (!Number.isFinite(basePrice) || basePrice <= 0) return 0;
  return Math.min(MAX_PRICE, Math.round(basePrice * inflationInfo(game, day).index));
}

// Cargo payment: a fare grows in a straight line with distance, and once a cargo class's
// full-pay window has passed, each further day on the way costs a share of it, never more than half.
export function distancePay(tiles) { return (Math.max(0, tiles) + HANDLING_TILES) / DISTANCE_TILES; }

/** Share of the distance fare after `days` in transit; 1 for unknown days (legacy cargo). */
export function transitPay(cargo, days) {
  const c = TRANSIT_CLASSES[CARGO[cargo]?.transit];
  if (!c || !(days > c.fullDays)) return 1;
  return Math.max(TRANSIT_PAY_FLOOR, 1 - (days - c.fullDays) * c.dailyLoss);
}

/** Typical one-way days for `tiles` of travel with a vehicle of `level`. */
export function scheduledDays(mode, tiles, level = 0) {
  const base = VEHICLE_SPEEDS[mode];
  if (!base || !(tiles > 0)) return 0;
  return tiles / (base * TRAVEL_PACE[mode] * (1 + .1 * (level || 0))) + (STOP_DAYS[mode] ?? .2);
}

/** Tiles a route is paid for: its path, but at most DETOUR_PAY_LIMIT × the grid distance between its end stops. */
export function payTiles(path) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  const a = path[0], b = path[path.length - 1];
  return Math.min(path.length - 1, DETOUR_PAY_LIMIT * (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)));
}

/** Tiles actually travelled: the path, or the straight line for a flight. */
export function travelTiles(mode, path) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  const a = path[0], b = path[path.length - 1];
  return mode === 'air' ? Math.hypot(b.x - a.x, b.y - a.y) : path.length - 1;
}
