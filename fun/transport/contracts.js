import { isUnderConstruction } from './building-construction.js';
import { CARGO, INDUSTRIES, TOWN_CARGO } from './data.js';
import { isTownTraffic } from './data.js';
import { randomAt } from './environment.js';
import { calendarMonth, distancePay } from './economy-pricing.js';
import { industrySize } from './industry-sites.js';
import { nearbyCities, nearbyIndustries } from './simulation-spatial.js';

// Transport contracts are optional. After the company's first freight delivery, up to three
// offers name a distant generated producer and a buyer. The first route that serves the exact
// pair earns a bonus on every delivery for a year; ignored offers lapse without a word. The
// simulation spends no ids and sends no notices here: the interface derives both moments.
export const OFFER_SLOTS = 3, MAX_CONTRACTS = 8, CONTRACT_DAYS = 365;
const NEAREST = 20, FARTHEST = 70, SAMPLES = 64, KEEP_DAYS = 31;
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const shortId = value => typeof value === 'string' && value.length > 0 && value.length <= 64;
const center = site => INDUSTRIES[site.kind] ? { x: site.x + (industrySize(site) - 1) / 2, y: site.y + (industrySize(site) - 1) / 2 } : site;
// Fares grow with distancePay(L) = (L + 12) ÷ 9 while a round trip grows with L, so income per vehicle-day falls as f(L).
const perDay = length => distancePay(length) / length;
const producing = site => !isUnderConstruction(site) && site.owner !== 'player' && Object.keys(INDUSTRIES[site.kind].outputs).length > 0 && (Object.keys(INDUSTRIES[site.kind].inputs).length === 0 || site.production > 0);
const started = game => game.contracts !== undefined || game.routes.some(route => !isTownTraffic(route.cargo) && route.delivered > 0);

/** The bonus paid on top of the fare: a served contract earns 1.6× what a 10-tile route earns per vehicle-day. */
export function contractMultiplier(distance) { return Math.min(4, Math.max(1, 1.6 * perDay(10) / perDay(distance) - 1)); }

/** The producer and buyer, or null once either is gone. */
export function contractSites(game, contract) {
  const source = game.industries.find(site => site.id === contract.sourceId), target = (contract.target.kind === 'city' ? game.cities : game.industries).find(site => site.id === contract.target.id);
  return source && target ? { source, target, from: center(source), to: center(target) } : null;
}

/** 'offer', 'active', 'complete' or 'expired'. A missing site or route counts as expired. */
export function contractState(game, contract, day = game.day) {
  if (!contractSites(game, contract)) return 'expired';
  if (contract.routeId === undefined) return day < contract.expiresDay ? 'offer' : 'expired';
  if (!game.routes.some(route => route.id === contract.routeId)) return 'expired';
  return day < contract.until ? 'active' : 'complete';
}

// The pair is served when the first stop loads at the producer and the last delivers to the buyer:
// an industry anywhere in the end stop's coverage, or the town that receives its town cargo.
const serves = (contract, from, to) => from.industries.some(site => site.id === contract.sourceId) && (contract.target.kind === 'city' ? to.cities[0]?.id === contract.target.id : to.industries.some(site => site.id === contract.target.id));
function routeCoverage(game, route, coverageOf) {
  const stops = route.stops.map(id => game.stations.find(stop => stop.id === id));
  return stops.every(Boolean) ? stops.map(coverageOf) : null;
}
const pairKey = (cargo, sourceId, target) => `${cargo}|${sourceId}|${target.kind}:${target.id}`;
// Every producer and buyer pair an active freight route serves, each stop's coverage read once.
function servedPairs(game, coverageOf) {
  const pairs = new Set(), stops = new Map(game.stations.map(stop => [stop.id, stop])), covered = new Map();
  const cover = id => { if (!covered.has(id)) covered.set(id, stops.has(id) ? coverageOf(stops.get(id)) : null); return covered.get(id); };
  for (const route of game.routes) {
    if (!route.active || isTownTraffic(route.cargo)) continue;
    const from = cover(route.stops[0]), to = cover(route.stops[1]);
    if (!from || !to) continue;
    const targets = to.industries.filter(site => INDUSTRIES[site.kind].inputs[route.cargo]).map(site => ({ kind: 'industry', id: site.id }));
    if (to.cities.length) targets.push({ kind: 'city', id: to.cities[0].id });
    for (const site of from.industries) if (INDUSTRIES[site.kind].outputs[route.cargo]) for (const target of targets) pairs.add(pairKey(route.cargo, site.id, target));
  }
  return pairs;
}

function buyers(game, source, cargo) {
  const from = center(source), reach = point => { const d = Math.hypot(point.x - from.x, point.y - from.y); return d >= NEAREST && d <= FARTHEST; };
  const found = nearbyIndustries(game, from.x, from.y, FARTHEST + 3).filter(site => site !== source && !isUnderConstruction(site) && INDUSTRIES[site.kind].inputs[cargo] && reach(center(site))).map(site => ({ kind: 'industry', site }));
  if (TOWN_CARGO.includes(cargo)) for (const city of nearbyCities(game, from.x, from.y, FARTHEST)) if (reach(city)) found.push({ kind: 'city', site: city });
  return found;
}
// Each empty slot draws at most 64 candidates from the month's own random stream.
function fillOffers(game, list, day, coverageOf) {
  const open = list.filter(contract => contract.routeId === undefined).length;
  if (open >= OFFER_SLOTS || list.length >= MAX_CONTRACTS) return;
  const producers = game.industries.filter(producing), month = calendarMonth(game), listed = new Set(list.map(contract => pairKey(contract.cargo, contract.sourceId, contract.target)));
  if (!producers.length) return;
  let served = null;
  for (let slot = open; slot < OFFER_SLOTS && list.length < MAX_CONTRACTS; slot++) for (let k = 0; k < SAMPLES; k++) {
    const pick = randomAt(game, month, 'contract', slot * SAMPLES + k) * producers.length, source = producers[Math.floor(pick)], outputs = Object.keys(INDUSTRIES[source.kind].outputs);
    const spin = pick % 1 * outputs.length, cargo = outputs[Math.floor(spin)], candidates = buyers(game, source, cargo);
    if (!candidates.length) continue;
    const { kind, site } = candidates[Math.floor(spin % 1 * candidates.length)], offer = { id: `contract-${month}-${slot * SAMPLES + k}`, cargo, sourceId: source.id, target: { kind, id: site.id } };
    const key = pairKey(cargo, source.id, offer.target);
    if (listed.has(key) || list.some(other => other.id === offer.id) || (served ??= servedPairs(game, coverageOf)).has(key)) continue;
    const to = center(site), distance = Math.round(Math.hypot(to.x - center(source).x, to.y - center(source).y));
    list.push({ ...offer, distance, multiplier: Math.round(contractMultiplier(distance) * 100) / 100, offeredDay: day, expiresDay: day + CONTRACT_DAYS });listed.add(key);
    break;
  }
}

/** Runs at each new calendar month: drops lapsed and dangling contracts, then fills empty offer slots. */
export function stepContracts(game, coverageOf) {
  const day = Math.floor(game.day), list = game.contracts || [];
  const kept = list.filter(contract => { const state = contractState(game, contract, day); return state === 'offer' || state === 'active' || state === 'complete' && day < contract.until + KEEP_DAYS; });
  if (started(game)) fillOffers(game, kept, day, coverageOf);
  if (kept.length !== list.length || kept.some((contract, index) => contract !== list[index])) game.contracts = kept;
}

// Unloading stays O(1): each route's pair matches are kept until the world revision or the list changes.
const matches = new WeakMap();
function candidates(game, route, coverageOf) {
  let cache = matches.get(game);
  if (!cache || cache.revision !== game.revision || cache.contracts !== game.contracts) matches.set(game, cache = { revision: game.revision, contracts: game.contracts, routes: new Map() });
  let found = cache.routes.get(route.id);
  if (!found) {
    const same = game.contracts.filter(contract => contract.cargo === route.cargo), ends = same.length ? routeCoverage(game, route, coverageOf) : null;
    cache.routes.set(route.id, found = ends ? same.filter(contract => serves(contract, ...ends)) : []);
  }
  return found;
}

/** Extra income for a paid delivery. The first route to serve an open offer's exact pair wins it for a year. */
export function contractBonus(game, route, fare, day, coverageOf) {
  let contract = null;
  for (const candidate of candidates(game, route, coverageOf)) {
    if (candidate.routeId === route.id && day < candidate.until) { contract = candidate; break; }
    if (!contract && candidate.routeId === undefined && day < candidate.expiresDay) contract = candidate;
  }
  if (!contract) return 0;
  if (contract.routeId === undefined) Object.assign(contract, { routeId: route.id, awardedDay: Math.floor(day), until: Math.floor(day) + CONTRACT_DAYS, earned: 0 });
  const bonus = Math.round(fare * contract.multiplier);
  contract.earned += bonus;
  return bonus;
}

/** Optional state: at most eight contracts. Ids that no longer exist are allowed and read as expired. */
export function validContracts(game) {
  const list = game.contracts, ids = new Set();
  if (list === undefined) return true;
  if (!Array.isArray(list) || list.length > MAX_CONTRACTS) return false;
  return list.every(contract => {
    if (!contract || typeof contract !== 'object' || !shortId(contract.id) || ids.has(contract.id) || !owns(CARGO, contract.cargo) || isTownTraffic(contract.cargo) || !shortId(contract.sourceId)) return false;
    ids.add(contract.id);
    const { target } = contract;
    if (!target || typeof target !== 'object' || !['industry', 'city'].includes(target.kind) || !shortId(target.id) || !finite(contract.distance, 0, 10000) || !finite(contract.multiplier, 1, 4)) return false;
    if (!Number.isInteger(contract.offeredDay) || !finite(contract.offeredDay, 0, game.day) || contract.expiresDay !== contract.offeredDay + CONTRACT_DAYS) return false;
    if (contract.routeId === undefined) return contract.awardedDay === undefined && contract.until === undefined && contract.earned === undefined;
    return shortId(contract.routeId) && Number.isInteger(contract.awardedDay) && finite(contract.awardedDay, contract.offeredDay, game.day) && contract.until === contract.awardedDay + CONTRACT_DAYS && finite(contract.earned, 0, 1e15);
  });
}
