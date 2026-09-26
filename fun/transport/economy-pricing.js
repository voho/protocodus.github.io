import { randomAt } from './environment.js';

const START_DATE = Date.UTC(1950, 0, 1);
const DAY_MS = 86400000;
const MAX_INDEX = 1_000_000;
const MAX_PRICE = 1_000_000_000_000;
const cache = new WeakMap();

export function calendarYear(game, day = game.day) {
  return new Date(START_DATE + Math.max(0, Math.floor(day || 0)) * DAY_MS).getUTCFullYear();
}

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
