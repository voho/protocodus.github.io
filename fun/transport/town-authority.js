import { TOWN_CARGO } from './data.js';
import { priceFor } from './economy-pricing.js';
import { nearbyCities } from './simulation-spatial.js';
import { stationReach, stationServes } from './station-sites.js';

// A town's opinion of the company: Transport Tycoon's local authority, kept gentle.
// Towns remember regular service, stops and recent town cargo, and the homes and
// woodland the player cleared nearby. Opinion never blocks or slows anything; only
// Excellent and Outstanding towns build their own homes a little faster. DOM-free.
export const TOWN_RADIUS = 10;
export const DISTURBANCE = { building: 6, woodland: 1, max: 60, fadePerMonth: 5 };
export const TOWN_ACTIONS = { advertise: { days: 180, base: 5000, perResident: 12, passengers: 1.5 }, fund: { days: 365, base: 15000, perResident: 25, growth: 2 } };
// Highest first; no band slows growth.
export const OPINION_BANDS = [
  { min: 90, label: 'Outstanding', growth: 1.10 },
  { min: 80, label: 'Excellent', growth: 1.05 },
  { min: 65, label: 'Very good', growth: 1 },
  { min: 50, label: 'Good', growth: 1 },
  { min: 40, label: 'Mediocre', growth: 1 },
  { min: 30, label: 'Poor', growth: 1 },
  { min: 15, label: 'Very poor', growth: 1 },
  { min: 0, label: 'Appalling', growth: 1 },
];
const UNTIL = { advertise: 'advertisedUntil', fund: 'fundedUntil' };
const RECENT_SUPPLY = 60, SERVED_WITHIN = 31, MAX_MONTHS = 10;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** A town-hall action runs until the first day of `until`. */
export const actionActive = (until, day) => Number.isInteger(until) && Math.floor(day) < until;
/** Development funded at the town hall; false for no town (a zone far from every centre). */
export const fundedTown = (city, day) => !!city && actionActive(city.fundedUntil, day);
/** Map<city, n>: stops of running routes that serve each town (five tiles, seven for an airport), in station order. */
export function townStopCounts(game) {
  const stops = new Set(), counts = new Map();
  for (const route of game.routes) if (route.active) for (const id of route.stops) stops.add(id);
  for (const station of game.stations) if (stops.has(station.id)) for (const city of nearbyCities(game, station.x, station.y, stationReach(station) + (station.mode === 'air' ? 5 : 0))) if (stationServes(station, city)) counts.set(city, (counts.get(city) || 0) + 1);
  return counts;
}
export const opinionBand = score => OPINION_BANDS.find(band => score >= band.min) || OPINION_BANDS.at(-1);
/** {score, label, growth, reasons}: Good (50) plus each reason's points, clamped to 0-100. Money never buys points. */
export function townOpinion(game, city, stopCounts = townStopCounts(game)) {
  const day = Math.floor(game.day), reasons = [], months = Math.min(MAX_MONTHS, city.serviceMonths || 0), stops = stopCounts.get(city) || 0, disturbance = city.disturbance || 0;
  const cargo = TOWN_CARGO.filter(key => Number.isFinite(city.lastSupply?.[key]) && day - city.lastSupply[key] <= RECENT_SUPPLY);
  if (months > 0) reasons.push({ key: 'service', months, points: 2.5 * months });
  if (stops > 0) reasons.push({ key: 'stops', count: stops, points: 5 * Math.min(2, stops) });
  if (cargo.length > 0) reasons.push({ key: 'supplies', cargo, points: 5 * Math.min(2, cargo.length) });
  if (disturbance > 0) reasons.push({ key: 'demolition', amount: disturbance, months: Math.ceil(disturbance / DISTURBANCE.fadePerMonth), points: -disturbance });
  const score = clamp(Math.round(50 + reasons.reduce((sum, reason) => sum + reason.points, 0)), 0, 100), band = opinionBand(score);
  return { score, label: band.label, growth: band.growth, reasons };
}
/** The town hall's price, priced by town size and inflation and rounded up to $100. */
export function townActionQuote(game, city, action) {
  const rule = TOWN_ACTIONS[action], until = city[UNTIL[action]], active = actionActive(until, game.day);
  const cost = Math.ceil(priceFor(game, rule.base + rule.perResident * Math.floor(city.population)) / 100) * 100;
  return { action, cost, days: rule.days, active, until: active ? until : null, affordable: game.money >= cost };
}
/** Only bulldozing disturbs a town; returns the applied change (0 when capped or no town). */
export function disturbTown(city, points) {
  if (!city || !(points > 0)) return 0;
  const before = city.disturbance || 0;
  city.disturbance = Math.min(DISTURBANCE.max, before + points);
  return city.disturbance - before;
}
// At each month boundary: a month of service fills the meter, a month without drains it,
// demolition fades by five, and finished town-hall actions are forgotten without a notice.
export function monthlyTownRelations(game) {
  const day = Math.floor(game.day);
  for (const city of game.cities) {
    const served = Number.isFinite(city.lastServiceDay) && day - city.lastServiceDay <= SERVED_WITHIN, months = clamp((city.serviceMonths || 0) + (served ? 1 : -1), 0, MAX_MONTHS);
    if (months) city.serviceMonths = months; else delete city.serviceMonths;
    if (city.disturbance !== undefined) { const left = Math.max(0, city.disturbance - DISTURBANCE.fadePerMonth); if (left) city.disturbance = left; else delete city.disturbance; }
    for (const key of Object.values(UNTIL)) if (city[key] !== undefined && !actionActive(city[key], day)) delete city[key];
  }
}
