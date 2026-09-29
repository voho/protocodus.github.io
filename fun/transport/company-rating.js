import { priceFor, calendarYear } from './economy-pricing.js';
import { INDUSTRIES, BUILD_COSTS } from './data.js';
import { networkIndex } from './network-index.js';

// The company rating is recognition only. Each quarter a review scores nine measures out of
// 1,000 and every 120 points earns a career title that is kept for good; nothing in the
// simulation reads game.performance, and a falling score changes nothing. DOM-free; this
// module never imports model.js, which calls reviewPerformance from monthlyUpdate.
export const CAREER_TITLES = Object.freeze(['Engineer', 'Traffic manager', 'Transport coordinator', 'Route supervisor', 'Director', 'Chief executive', 'Chairman', 'President', 'Tycoon']);
export const TITLE_STEP = 120;
export const titleForScore = score => Math.min(CAREER_TITLES.length - 1, Math.floor(Math.max(0, score) / TITLE_STEP));
export const MIN_RATED_FLEET = 10;
export const CENTURY_MONTH = 100 * 12 - 1; // December 2049, closed on 1 January 2050 (day 36525)
// Full marks: a count, or 1950 dollars when `money` is set (priced at the review day). Points rise with the
// square root of the share, so half a target earns about 70% of its points; `linear` parts rise evenly.
export const RATING_PARTS = Object.freeze([
  { id: 'vehicles', label: 'Vehicles earning a profit', target: 250, max: 100 },
  { id: 'stops', label: 'Stops in use', target: 150, max: 100 },
  { id: 'weakest', label: 'Weakest route', target: 25000, max: 100, money: true },
  { id: 'weakQuarter', label: 'Weakest quarter', target: 5000000, max: 50, money: true },
  { id: 'bestQuarter', label: 'Best quarter', target: 10000000, max: 100, money: true },
  { id: 'delivered', label: 'Cargo delivered', target: 400000, max: 400 },
  { id: 'cargo', label: 'Cargo types', target: 8, max: 50, linear: true },
  { id: 'cash', label: 'Cash', target: 100000000, max: 50, money: true },
  { id: 'loan', label: 'No loan', target: 0, max: 50, linear: true },
].map(Object.freeze));

const START = Date.UTC(1950, 0, 1), DAY = 86400000;
const firstDay = (year, month = 0) => Math.round((Date.UTC(year, month, 1) - START) / DAY);
const finite = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e15;
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** A route is rated on its profit last year (ttd-vehicle-models' profitLastYear) only when its accounts cover that whole year: one launched or edited during it waits for the next December. */
export const ratedYear = (route, since) => Number.isFinite(route.profitLastYear) && (route.accountingStartDay ?? 0) <= since;

/** The nine measured values in RATING_PARTS order, and the route with the weakest profit a vehicle (null below MIN_RATED_FLEET rated vehicles). */
export function ratingInputs(game, loan = game.loan || 0) {
  const vehicles = new Map(), stops = new Set(), cargo = new Set(), since = firstDay(calendarYear(game) - 1);
  for (const vehicle of game.vehicles) vehicles.set(vehicle.routeId, (vehicles.get(vehicle.routeId) || 0) + 1);
  let profitable = 0, rated = 0, weakest = Infinity, weakestRouteId = null;
  for (const route of game.routes) {
    if (route.active === true && !route.paused) for (const id of route.stops) stops.add(id);
    if (route.delivered > 0) cargo.add(route.cargo);
    const count = vehicles.get(route.id) || 0;
    if (!count || !ratedYear(route, since)) continue;
    rated += count;
    if (route.profitLastYear > 0) profitable += count;
    if (route.profitLastYear / count < weakest) { weakest = route.profitLastYear / count; weakestRouteId = route.id; }
  }
  // Whole calendar quarters among the closed months, the latest twelve.
  const quarters = [];
  for (const h of game.history) {
    const q = Math.floor(h.month / 3), last = quarters.at(-1), profit = h.operatingProfit ?? h.profit;
    if (last?.q === q) { last.months++; last.profit += profit; } else quarters.push({ q, months: 1, profit });
  }
  const profits = quarters.filter(q => q.months === 3).slice(-12).map(q => q.profit);
  const h = game.history, delivered = h.length ? Math.max(0, h.at(-1).delivered - (h.length >= 13 ? h.at(-13).delivered : 0)) : 0, full = rated >= MIN_RATED_FLEET;
  return {
    values: [profitable, stops.size, full ? Math.round(weakest) : null, profits.length ? Math.round(Math.min(...profits)) : 0, profits.length ? Math.round(Math.max(...profits)) : 0, Math.round(delivered), cargo.size, Math.round(game.money), Math.max(0, Math.round(loan))],
    weakestRouteId: full ? weakestRouteId : null,
  };
}
export const ratingValues = (game, loan) => ratingInputs(game, loan).values;

/** Full marks for one part at a day: the count, or its 1950 dollars priced then. */
export const partTarget = (game, part, day = game.day) => part.money ? priceFor(game, part.target, day) : part.target;
export function ratingPoints(game, values, day = game.day, loanLimit = 0) {
  return RATING_PARTS.map((part, i) => {
    const value = values[i];
    if (part.id === 'loan') return value <= 0 ? part.max : loanLimit > 0 ? Math.floor(Math.max(0, loanLimit - value) / loanLimit * part.max) : 0;
    const target = partTarget(game, part, day);
    if (value === null || !(value > 0) || !(target > 0)) return 0;
    const share = Math.min(1, value / target);
    return Math.floor((part.linear ? share : Math.sqrt(share)) * part.max + 1e-9);
  });
}

/** The quarterly review, run by monthlyUpdate as March, June, September and December close. It never notifies, draws on randomAt, spends ids or touches money or revision. A backfill (restoreGame) stamps no century. */
export function reviewPerformance(game, { loanLimit = 0, backfill = false } = {}) {
  const closed = game.history.at(-1)?.month ?? -1, day = Math.floor(game.day), { values, weakestRouteId } = ratingInputs(game), points = ratingPoints(game, values, day, loanLimit);
  const score = points.reduce((sum, n) => sum + n, 0), previous = game.performance, reached = previous ? previous.reached.slice() : [day];
  for (let i = reached.length; i <= titleForScore(score); i++) reached.push(day);
  game.performance = { day, score, best: Math.max(previous?.best ?? 0, score), values, points, reached, weakest: weakestRouteId };
  if (previous?.century) game.performance.century = previous.century;
  else if (!backfill && closed === CENTURY_MONTH) game.performance.century = { day, score, title: reached.length - 1, value: companyValue(game).total };
  return game.performance;
}

export function validPerformance(game) {
  const r = game.performance; if (r === undefined) return true;
  if (!r || typeof r !== 'object' || Array.isArray(r) || !int(r.day, 0, Math.floor(game.day)) || !int(r.score, 0, 1000) || !int(r.best, r.score, 1000)) return false;
  if (!Array.isArray(r.values) || r.values.length !== 9 || !r.values.every((v, i) => finite(v) || (i === 2 && v === null))) return false;
  if (!Array.isArray(r.points) || r.points.length !== 9 || !r.points.every(p => int(p, 0, 1000)) || r.points.reduce((a, b) => a + b, 0) !== r.score) return false;
  if (!Array.isArray(r.reached) || r.reached.length < 1 || r.reached.length > CAREER_TITLES.length || !r.reached.every((d, i) => int(d, 0, r.day) && (i === 0 || d >= r.reached[i - 1]))) return false;
  if (!(r.weakest === undefined || r.weakest === null || (typeof r.weakest === 'string' && r.weakest.length <= 100))) return false;
  const c = r.century;
  return c === undefined || Boolean(c) && typeof c === 'object' && int(c.day, 0, r.day) && int(c.score, 0, 1000) && int(c.title, 0, r.reached.length - 1) && finite(c.value);
}

// Today's cost of the player's network in 1950 dollars: each network tile once, stops and bought industries.
function infrastructureBase(game) {
  let base = 0;
  for (const id of networkIndex(game)) {
    const t = game.tiles[id];
    if (t.bridge) base += t.rail ? BUILD_COSTS.railbridge : BUILD_COSTS.bridge;
    else if (t.tunnel) base += t.rail ? BUILD_COSTS.railtunnel : BUILD_COSTS.tunnel;
    else base += (t.road && !t.publicRoad ? BUILD_COSTS.road : 0) + (t.rail ? BUILD_COSTS.rail : 0);
  }
  for (const s of game.stations) base += s.mode === 'water' ? BUILD_COSTS.port : s.mode === 'rail' ? BUILD_COSTS['train-stop'] : BUILD_COSTS['bus-stop'];
  for (const i of game.industries) if (i.owner === 'player') base += INDUSTRIES[i.kind]?.cost ?? 0;
  return base;
}
/** Cash, vehicles at their resale value and half of today's infrastructure cost, less any loan. On demand only: O(network tiles). */
export function companyValue(game, loan = game.loan || 0) {
  const cash = Math.round(game.money);
  const vehicles = game.vehicles.reduce((sum, v) => sum + Math.round((v.paidPrice ?? 0) * .45), 0);
  const infrastructure = Math.round(priceFor(game, infrastructureBase(game)) * .5);
  const total = cash - loan + vehicles + infrastructure;
  return { cash, loan, vehicles, infrastructure, total };
}

export const careerTitle = game => game.performance ? game.performance.reached.length - 1 : 0;
export function nextTitle(game) { const index = careerTitle(game) + 1; return index < CAREER_TITLES.length ? { index, name: CAREER_TITLES[index], score: index * TITLE_STEP } : null; }
/** The first day of the next calendar quarter, when the next review runs. */
export function nextReviewDay(game) {
  const date = new Date(START + Math.floor(game.day) * DAY), month = date.getUTCFullYear() * 12 + date.getUTCMonth(), next = (Math.floor(month / 3) + 1) * 3;
  return firstDay(Math.floor(next / 12), next % 12);
}
