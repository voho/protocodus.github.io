import { passengerEndpoints, STATION_RADIUS } from './model.js';
import { TOWN_CARGO } from './data.js';
import { number } from './copy.js';

// Headlines: rare good news about the company, derived from state the simulation already keeps (a town's first
// lastServiceDay, a route's first delivery in a new mode, town peaks, the pricing year). DOM-free. Nothing here
// calls notify(), spends an id, bumps revision or draws on randomAt; recordHeadline only writes game.headlines.
export const HEADLINE_LIMIT = 24;
export const HEADLINE_TOWN_TIERS = [2500, 5000, 10000];
export const MODEL_YEAR_STEP = 5;
export const HEADLINE_PRIORITY = Object.freeze({ first: 1, rating: 1, achievement: 1, models: 2, town: 2, contract: 2, arrival: 3 });
const KICKERS = { arrival: 'Local news', first: 'Company first', town: 'Town news', models: 'New models', rating: 'Company news', achievement: 'Achievement', contract: 'Contracts' };
const ART = { bus: 'bus', truck: 'truck', train: 'train', ferry: 'ship', ship: 'ship' };
const TIMES = ['', 'once', 'twice', 'three times', 'four times', 'five times', 'six times', 'seven times', 'eight times', 'nine times', 'ten times'];
const TARGETS = ['industry', 'city', 'route'];
const residents = n => number(Math.floor(Number(n) || 0));
const factor = n => Number.isInteger(n) ? String(n) : n.toFixed(1);
const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= STATION_RADIUS;
const clip = (text, limit) => text.length > limit ? text.slice(0, limit - 1) + '…' : text;

export const headlineKicker = kind => KICKERS[kind] || 'Headline';
/** bus, truck, train, ferry or ship: the vehicle a headline names. */
export function headlineNoun(mode, cargo) {
  if (mode === 'water') return cargo === 'passengers' ? 'ferry' : 'ship';
  if (mode === 'rail') return 'train';
  return cargo === 'passengers' ? 'bus' : 'truck';
}

/** Towns already served (the starter bus's two included) and modes already run; rebuilt on every load. */
export function headlineWatch(game) {
  const towns = new Set(game.cities.filter(city => Number.isFinite(city.lastServiceDay)).map(city => city.id));
  for (const city of game.cities.slice(0, 2)) towns.add(city.id);
  const modes = new Set(['road']);
  for (const route of game.routes) if (route.delivered > 0) modes.add(route.mode);
  for (const entry of game.headlines || []) if (entry.key.startsWith('first:')) modes.add(entry.key.slice(6));
  return { game, towns, modes };
}

/** The newest delivering route that serves the town: a passenger route whose endpoints include it, or town freight into a stop near it. */
export function arrivalRoute(game, city) {
  const stops = new Map();
  for (const stop of game.stations) if (near(stop, city)) stops.set(stop.id, stop);
  if (!stops.size) return null;
  let byId = null;
  for (let i = game.routes.length - 1; i >= 0; i--) {
    const route = game.routes[i]; if (!(route.delivered > 0)) continue;
    if (route.cargo === 'passengers') {
      if (!stops.has(route.stops[0]) && !stops.has(route.stops[1])) continue;
      byId ??= new Map(game.stations.map(stop => [stop.id, stop]));
      if (passengerEndpoints(game, byId.get(route.stops[0]), byId.get(route.stops[1]))?.some(town => town.id === city.id)) return route;
    } else if (stops.has(route.stops[1]) && TOWN_CARGO.includes(route.cargo)) return route;
  }
  return null;
}
function arrivalEntry(city, route, first) {
  const n = residents(city.population);
  if (!route) return { key: `arrival:${city.id}`, kind: 'arrival', day: Math.floor(city.lastServiceDay), art: 'town', title: `${city.name} joins your network`, detail: `Its ${n} residents are now served by your company.`, target: { kind: 'city', id: city.id } };
  const noun = headlineNoun(route.mode, route.cargo), tail = `Its ${n} residents are now ${route.cargo === 'passengers' ? 'linked' : 'supplied'} by ${route.name}.`;
  return { key: first ? `first:${route.mode}` : `arrival:${city.id}`, kind: first ? 'first' : 'arrival', day: Math.floor(city.lastServiceDay), art: ART[noun],
    title: `Citizens celebrate as the first ${noun} arrives in ${city.name}`, detail: (first ? `The company’s first ${noun}. ` : '') + tail, target: { kind: 'city', id: city.id }, routeId: route.id };
}
function firstEntry(game, route) {
  const noun = headlineNoun(route.mode, route.cargo), stop = game.stations.find(item => item.id === route.stops[1]);
  let town = null, best = Infinity;
  if (stop) for (const city of game.cities) { const d = Math.hypot(city.x - stop.x, city.y - stop.y); if (d <= STATION_RADIUS && d < best) { best = d; town = city; } }
  const title = town ? `The company’s first ${noun} arrives in ${town.name}` : `The company’s first ${noun} ${route.mode === 'water' ? 'docks at' : 'pulls into'} ${stop?.name ?? route.name}`;
  return { key: `first:${route.mode}`, kind: 'first', day: Math.floor(game.day), art: ART[noun], title, detail: `First delivery on ${route.name}.`, target: { kind: 'route', id: route.id }, routeId: route.id };
}
/** New headlines since the last call, and the watch updated so a second call returns []. Entries carry routeId (never saved). */
export function detectHeadlines(game, watch) {
  const entries = [], firsts = [], arrivals = [];
  if (watch.modes.size < 3) for (const route of game.routes) if (route.delivered > 0 && !watch.modes.has(route.mode)) { watch.modes.add(route.mode); firsts.push(route); }
  for (const city of game.cities) { if (watch.towns.has(city.id) || !Number.isFinite(city.lastServiceDay)) continue; watch.towns.add(city.id); arrivals.push({ city, route: arrivalRoute(game, city) }); }
  // A first train or ship that is also a town's first arrival makes one headline about that town.
  for (const route of firsts) { const merged = arrivals.find(item => !item.used && item.route?.id === route.id); if (merged) merged.used = true; entries.push(merged ? arrivalEntry(merged.city, route, true) : firstEntry(game, route)); }
  for (const item of arrivals) if (!item.used) entries.push(arrivalEntry(item.city, item.route, false));
  return entries;
}

/** The highest town tier passed since the recorded peak, or 0. The 1,000 threshold stays a toast. */
export function headlineTier(peak, population) { return HEADLINE_TOWN_TIERS.filter(tier => peak < tier && population >= tier).at(-1) || 0; }
export function townHeadline(game, city, tier) {
  const stops = new Set(game.stations.filter(stop => near(stop, city)).map(stop => stop.id));
  const n = game.routes.filter(route => route.active && route.stops.some(id => stops.has(id))).length;
  const title = tier === 2500 ? `${city.name} welcomes its 2,500th resident` : tier === 5000 ? `${city.name} grows to 5,000 residents` : `${city.name} passes ${residents(tier)} residents`;
  return { key: `town:${tier}:${city.id}`, kind: 'town', day: Math.floor(game.day), art: 'town', title, detail: n === 1 ? 'One of your routes serves the town.' : `${n} of your routes serve the town.`, target: { kind: 'city', id: city.id } };
}

/** Every fifth January from 1955. Capacity grows by a fifth and speed by a tenth of the 1950 model each year. */
export function modelYearHeadline(year) {
  const level = year - 1950; if (!(level >= MODEL_YEAR_STEP) || level % MODEL_YEAR_STEP) return null;
  const load = 1 + level / 5;
  return { key: `models:${year}`, kind: 'models', art: 'trendUp', title: `New ${year} models carry ${TIMES[load] || `${load} times`} the load of 1950`, detail: `They also run ${factor(1 + level / 10)}× as fast.` };
}

/** The only writer of game.headlines. It stores a clean entry that always validates, or returns false. */
export function recordHeadline(game, entry) {
  const { key, kind } = entry || {};
  if (typeof key !== 'string' || !key.length || key.length > 64 || typeof kind !== 'string' || !kind.length || kind.length > 24) return false;
  if (game.headlines?.some(item => item.key === key)) return false;
  const title = String(entry.title || '').trim(); if (!title) return false;
  const today = Math.floor(game.day), day = Math.floor(entry.day ?? today);
  const saved = { key, kind, day: Number.isFinite(day) ? Math.max(0, Math.min(day, today)) : today, title: clip(title, 140) };
  if (typeof entry.detail === 'string' && entry.detail) saved.detail = clip(entry.detail, 240);
  if (typeof entry.art === 'string' && entry.art && entry.art.length <= 16) saved.art = entry.art;
  const id = entry.target && String(entry.target.id ?? '');
  if (TARGETS.includes(entry.target?.kind) && id.length && id.length <= 64) saved.target = { kind: entry.target.kind, id };
  const log = game.headlines ||= [];
  log.unshift(saved);
  // Company firsts stay; there are at most two of them.
  while (log.length > HEADLINE_LIMIT) { const i = log.findLastIndex(item => item.kind !== 'first'); log.splice(i < 0 ? log.length - 1 : i, 1); }
  return true;
}
