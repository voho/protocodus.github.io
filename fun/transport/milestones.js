import { INDUSTRIES, TOWN_CARGO } from './data.js';
import { isTownTraffic } from './data.js';
import { productionChain } from './chains.js';
import { activeCities } from './settlements.js';
import { priceFor } from './economy-pricing.js';
import { industryDistance } from './industry-sites.js';
import { nearbyCities, nearbyIndustries } from './simulation-spatial.js';
import { money, number } from './copy.js';
import { stationReach, stationServes } from './station-sites.js';

// Company milestones are recognition only: they never grant money or unlock tools,
// vehicles, speeds or land. The simulation stamps each id with the day it was first
// met; only this module and the interface read the stamps.
const SUPPLIES = ['food', 'goods', 'furniture', 'machinery', 'fuel'];
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const freight = game => game.routes.filter(route => !isTownTraffic(route.cargo));
const carried = game => freight(game).reduce((sum, route) => sum + (route.delivered || 0), 0);
const flag = met => ({ value: met ? 1 : 0, target: 1 });
const count = (value, target) => ({ value: Math.max(0, Math.floor(value)), target });
const profit = base => game => count(game.history.at(-1)?.operatingProfit || 0, Math.round(priceFor(game, base)));
const served = target => game => count(activeCities(game).size, target);
const covers = (site, stop) => industryDistance(site, stop) <= stationReach(stop);
// Generated towns reach about 1,800 residents, so only a town the company serves and grows counts.
const largestTown = game => [...activeCities(game)].reduce((best, city) => !best || city.population > best.population ? city : best, null);

// Freight cargo delivered at an end stop that covers a town.
function townCargo(game) {
  const stops = new Map(game.stations.map(stop => [stop.id, stop])), cargo = new Set();
  for (const route of freight(game)) {
    const stop = stops.get(route.stops?.[1]);
    if (route.delivered > 0 && stop && TOWN_CARGO.includes(route.cargo) && !cargo.has(route.cargo) && nearbyCities(game, stop.x, stop.y, stationReach(stop)).some(city => stationServes(stop, city))) cargo.add(route.cargo);
  }
  return cargo;
}
// The largest capacity among industries a running service loads from.
function loadedCapacity(game) {
  const stops = new Map(game.stations.map(stop => [stop.id, stop]));
  let best = 0;
  for (const route of freight(game)) {
    const stop = route.active && stops.get(route.stops?.[0]);
    if (stop) for (const site of nearbyIndustries(game, stop.x, stop.y, stationReach(stop) + 3)) if (INDUSTRIES[site.kind].outputs[route.cargo] && covers(site, stop)) best = Math.max(best, site.capacity || 1);
  }
  return best;
}
// Raw material into a factory, its product into a second factory, and that product to a town.
const chains = new Map();
function fullChain(game) {
  if (!chains.has(game.biome)) chains.set(game.biome, productionChain(game.biome).edges);
  const edges = chains.get(game.biome), moved = new Set(freight(game).filter(route => route.delivered > 0).map(route => route.cargo)), town = townCargo(game);
  return edges.some(last => last.to === 'towns' && town.has(last.cargo) && edges.some(middle => middle.to === last.from && moved.has(middle.cargo) && Object.keys(INDUSTRIES[middle.from].inputs).length > 0 && edges.some(first => first.to === middle.from && moved.has(first.cargo))));
}

export const CHAPTERS = ['Getting started', 'A growing network', 'Thriving towns', 'A transport empire'];
export const MILESTONES = [
  { id: 'first-freight', chapter: 1, title: 'First freight delivery', detail: 'Carry cargo from a supplier to a buyer.', action: 'chains', button: 'Production chains', progress: game => flag(freight(game).some(route => route.delivered > 0)) },
  { id: 'freight-100', chapter: 1, title: 'First 100 freight deliveries', detail: 'Every freight delivery counts; passengers and mail don’t.', unit: 'delivered', action: 'routes', button: 'Open routes', progress: game => count(carried(game), 100) },
  { id: 'processing', chapter: 1, title: 'A factory at work', detail: 'Deliver a factory’s inputs and it makes something new.', action: 'chains', button: 'Production chains', progress: game => flag(game.industries.some(site => Object.keys(INDUSTRIES[site.kind].inputs).length > 0 && site.received > 0 && site.totalProduced > 0)) },
  { id: 'town-supply', chapter: 1, title: 'Supplies for a town', detail: 'Deliver food, goods, furniture, machinery or fuel to a town stop.', action: 'chains', button: 'Production chains', progress: game => flag(SUPPLIES.some(cargo => townCargo(game).has(cargo))) },
  { id: 'towns-5', chapter: 2, title: 'Five towns served', detail: 'Running routes stop in five different towns.', unit: 'served', action: 'atlas', button: 'Explore the region', progress: served(5) },
  { id: 'rail-30', chapter: 2, title: 'A 30-tile railway', detail: 'A rail route that runs 30 tiles or more.', unit: 'tiles', action: 'connect', tool: 'rail', button: 'Build rail', progress: game => count(game.routes.reduce((best, route) => route.mode === 'rail' && route.path ? Math.max(best, route.path.length - 1) : best, 0), 30) },
  { id: 'first-ship', chapter: 2, title: 'First ship route', detail: 'Ships link two ports on the same river, lake or sea.', action: 'connect', tool: 'port', button: 'Place a port', progress: game => flag(game.routes.some(route => route.mode === 'water')) },
  { id: 'profit-25k', chapter: 2, title: 'A $25,000 month', detail: 'Operating profit in one month, at 1950 prices.', unit: 'money', action: 'routes', button: 'Open routes', progress: profit(25000) },
  { id: 'industry-200', chapter: 2, title: 'An industry at 200%', detail: 'Industries grow while your routes carry their output away.', unit: 'percent', action: 'routes', button: 'Open routes', progress: game => count(loadedCapacity(game) * 100, 200) },
  { id: 'town-2000', chapter: 3, title: 'A town of 2,000', detail: 'Homes zoned near a served stop help any town you serve grow.', unit: 'residents', action: 'city', target: game => (largestTown(game) || game.cities[0])?.id, button: 'Show the town', progress: game => count(largestTown(game)?.population || 0, 2000) },
  { id: 'prestige-zone', chapter: 3, title: 'Prestige homes', detail: 'A residential zone grows to its third level.', unit: 'level', action: 'towns', button: 'Plan a neighborhood', progress: game => count(game.zones.reduce((best, zone) => zone.kind === 'residential' ? Math.max(best, game.tiles[zone.y * game.width + zone.x]?.building?.level || 0) : best, 0), 3) },
  { id: 'found-town', chapter: 3, title: 'A town of your own', detail: 'Found a town, then serve it.', action: 'towns', button: 'Open town tools', progress: game => flag(game.cities.some(city => city.founded === true && Number.isFinite(city.lastServiceDay))) },
  { id: 'freight-10k', chapter: 4, title: '10,000 freight deliveries', detail: 'Every freight delivery counts; passengers and mail don’t.', unit: 'delivered', action: 'routes', button: 'Open routes', progress: game => count(carried(game), 10000) },
  { id: 'profit-100k', chapter: 4, title: 'A $100,000 month', detail: 'Operating profit in one month, at 1950 prices.', unit: 'money', action: 'routes', button: 'Open routes', progress: profit(100000) },
  { id: 'towns-20', chapter: 4, title: 'Twenty towns served', detail: 'Running routes stop in twenty different towns.', unit: 'served', action: 'atlas', button: 'Explore the region', progress: served(20) },
  { id: 'full-chain', chapter: 4, title: 'A full production chain', detail: 'Raw material through two factories, and the product on to a town.', action: 'chains', button: 'Production chains', progress: game => flag(fullChain(game)) },
];

/** Runs once per simulated day: stamps every newly met milestone, in any order. A first run also backfills an older company silently. */
export function evaluateMilestones(game) {
  const reached = game.milestones ??= {}, day = Math.floor(game.day);
  for (const milestone of MILESTONES) if (!owns(reached, milestone.id)) { const { value, target } = milestone.progress(game); if (value >= target) reached[milestone.id] = day; }
}

/** Ids met right now, stamped or not: what a first evaluation would backfill. */
export function metMilestones(game) { return MILESTONES.filter(milestone => { const { value, target } = milestone.progress(game); return value >= target; }).map(milestone => milestone.id); }

export function validMilestones(game) {
  const value = game.milestones;
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const entries = Object.entries(value), day = Math.floor(game.day);
  return entries.length <= 64 && entries.every(([id, stamp]) => id.length <= 40 && Number.isInteger(stamp) && stamp >= 0 && stamp <= day);
}

function status(game, milestone) {
  const day = game.milestones?.[milestone.id], reached = Number.isInteger(day) ? day : null, progress = reached === null ? milestone.progress(game) : null;
  return { milestone, reached, progress, done: reached !== null || progress.value >= progress.target };
}
const chapterOf = (game, index) => {
  const items = MILESTONES.filter(milestone => milestone.chapter === index + 1).map(milestone => status(game, milestone)), done = items.filter(item => item.done).length;
  return { chapter: index + 1, title: CHAPTERS[index], items, done, complete: done >= items.length - 1 };
};

/** Every chapter with its goals, dates reached and live progress. */
export function milestoneChapters(game) { return CHAPTERS.map((title, index) => chapterOf(game, index)); }

/** The lowest chapter still open (all but one goal completes it) and its unmet goals; a preferred id stays chosen. */
export function nextMilestone(game, preferred) {
  for (let index = 0; index < CHAPTERS.length; index++) {
    const chapter = chapterOf(game, index);
    if (chapter.complete) continue;
    const open = chapter.items.filter(item => !item.done), choice = Math.max(0, open.findIndex(item => item.milestone.id === preferred));
    return { ...open[choice], chapter: chapter.chapter, choices: open.map(item => item.milestone.id), choice };
  }
  return null;
}

export function progressText(milestone, { value, target }) {
  if (target <= 1) return '';
  const whole = n => Math.floor(n);
  if (milestone.unit === 'money') return `${money(whole(value))} of ${money(whole(target))}`;
  if (milestone.unit === 'percent') return `${number(whole(value))}% of ${number(whole(target))}%`;
  if (milestone.unit === 'level') return `Level ${number(whole(value))} of ${number(whole(target))}`;
  return `${number(whole(value))} of ${number(whole(target))}${milestone.unit ? ' ' + milestone.unit : ''}`;
}
