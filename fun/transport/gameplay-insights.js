import { INDUSTRIES, TOWN_CARGO } from './data.js';
import { isTownTraffic } from './data.js';
import { STATION_RADIUS, findPath, getRouteFleet, getVehiclePurchase, stationServes, stationDistance, stationReach, stationSiteAt, airAvailable } from './model.js';
import { number, count, listJoin, capital, cargoName, vehicleNoun, token, plain, namesIn } from './copy.js';
import { townGrowth, townNeeds, townOutlook } from './settlements.js';
import { findIndustryTargets } from './chains.js';
import { industryDistance, industryContains, industrySize } from './industry-sites.js';
import { buildingAt } from './building-sites.js';
import { networkTerrainShape } from './terrain-engineering.js';
import { nearbyIndustries } from './simulation-spatial.js';
import { outputFill } from './industry-simulation.js';
import { nextMilestone, progressText } from './milestones.js';
import { workshopInputs, workshopOutputs, workshopRecipes } from './town-market.js';
import { waitingForFullLoad } from './model.js';
import { scheduledDays, travelTiles } from './economy-pricing.js';

const nearby = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= STATION_RADIUS;
const covers = (site, stop) => industryDistance(site, stop) <= STATION_RADIUS;
const isCity = site => !INDUSTRIES[site?.kind];
const reach = (site, point) => isCity(site) ? Math.hypot(site.x - point.x, site.y - point.y) : industryDistance(site, point);
const siteName = site => site.name || INDUSTRIES[site.kind]?.name || 'Town';
const isRaw = site => !Object.keys(INDUSTRIES[site.kind].inputs).length;
const PROCESSED = new Set(Object.values(INDUSTRIES).filter(definition => Object.keys(definition.inputs).length).flatMap(definition => Object.keys(definition.outputs)));
const plural = name => /s$/.test(name) ? name : /y$/.test(name) ? name.slice(0, -1) + 'ies' : name + 's';
const recipe = kind => { const d = INDUSTRIES[kind], amounts = entries => listJoin(Object.entries(entries).map(([key, n]) => `${n} ${cargoName(key)}`)); return `${plural(d.name)} turn ${amounts(d.inputs)} into ${amounts(d.outputs)}.`; };
const buyerOf = target => ({ id: target.id, kind: target.kind, name: target.name, x: target.x, y: target.y });
const cargoToken = key => token('cargo', key), cargoTokens = (keys, word) => listJoin(keys.map(cargoToken), word), cargoNames = (keys, word) => listJoin(keys.map(key => cargoName(key)), word);
// A status (DESIGN.md 6.4): the machine state, a tone (ok, warn, error, paused or info), one word, a reason
// template and an optional fix {action, label, cost?}. label and detail repeat word and the plain reason
// for the interface that still reads them. Names come from the sites at hand first, then the game.
function status(game, state, tone, word, reason, extra, known = []) {
  const names = game ? namesIn(game) : null, name = (kind, id) => { const item = known.find(entry => entry.id === id); return item ? siteName(item) : names?.(kind, id); };
  return { state, tone, word, label: word, reason, detail: plain(reason, name), ...extra };
}
const EDIT = { action: 'edit', label: 'Edit route' };

// Suggestions and checklists are recomputed only when sites, stops or the network
// change; game.revision moves every day, so it would defeat the cache.
const memos = new WeakMap(), stepMemos = new WeakMap();
const siteKey = game => `${game.networkRevision || 0}:${game.industries.length}:${game.industries.at(-1)?.id}:${game.cities.length}:${game.cities.at(-1)?.id}:${game.stations.length}`;
function memo(game, name, key, compute) {
  let entry = memos.get(game);
  if (!entry) memos.set(game, entry = {});
  if (!entry[name] || entry[name].key !== key) entry[name] = { key, value: compute() };
  return entry[name].value;
}

// Where a new stop could serve a site: a free road or rail tile, or dry, level
// land for one; otherwise shoreline water for a port. Mountains need tunnels,
// and stations never sit on bridges or tunnels.
function siteAccess(game, site) {
  const city = isCity(site), size = city ? 1 : industrySize(site), R = STATION_RADIUS;
  const centers = new Set(game.cities.map(town => town.y * game.width + town.x));
  const industries = game.industries.filter(other => other.x <= site.x + size + R && other.y <= site.y + size + R && other.x + 3 >= site.x - R && other.y + 3 >= site.y - R);
  const tile = (x, y) => x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y * game.width + x] : null;
  let land = city, port = false;
  for (let y = site.y - R; y < site.y + size + R; y++) for (let x = site.x - R; x < site.x + size + R; x++) {
    const t = tile(x, y), distance = reach(site, { x, y });
    if (!t || distance > R || (!city && distance === 0)) continue;
    const blocked = stationSiteAt(game, x, y) || t.zone || industries.some(other => industryContains(other, x, y));
    if ((t.road || t.rail) && !t.bridge && !t.tunnel && !blocked) return { kind: 'road', stop: t.road ? 'bus-stop' : 'train-stop' };
    if (t.terrain === 'water') { if (!t.bridge && !port) port = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tile(x + dx, y + dy) && tile(x + dx, y + dy).terrain !== 'water'); continue; }
    if (!land && t.terrain !== 'mountain' && !blocked && !centers.has(y * game.width + x) && !buildingAt(game, x, y) && networkTerrainShape(game, x, y).kind !== 'complex') land = true;
  }
  return { kind: land ? 'road' : port ? 'port' : null, stop: null };
}
export const stopSiteKind = (game, site) => siteAccess(game, site).kind;

function firstRouteChoices(game) {
  const home = game.cities[0] || { x: game.width / 2, y: game.height / 2 }, byId = new Map(game.industries.map(site => [site.id, site]));
  const sources = game.industries.filter(isRaw).map(site => ({ site, distance: Math.hypot(site.x - home.x, site.y - home.y) })).sort((a, b) => a.distance - b.distance).slice(0, 40);
  const candidates = sources.flatMap(({ site: source, distance }) => findIndustryTargets(game, source, 5).map(target => {
    const buyer = target.kind === 'industry' ? byId.get(target.id) : null;
    const extraInputs = buyer ? Math.max(0, Object.keys(INDUSTRIES[buyer.kind].inputs).length - 1) : 0;
    return { source, buyer, target, score: target.distance + distance * .8 + extraInputs * 40 };
  })).sort((a, b) => a.score - b.score);
  // Access only adjusts a score by -5 to +60, so the walk stops once no later candidate can overtake.
  const access = new Map(), seen = new Set(), choices = [];
  const kindOf = site => { if (!access.has(site)) access.set(site, siteAccess(game, site)); return access.get(site); };
  for (const candidate of candidates) {
    if (choices.length === 3 && choices[2].score <= candidate.score - 5) break;
    if (seen.has(candidate.source)) continue;
    const source = kindOf(candidate.source);
    if (!source.kind || (candidate.buyer && !kindOf(candidate.buyer).kind)) continue;
    seen.add(candidate.source);
    // A second quarry for the same town would read as the same idea; keep the better one.
    const choice = { source: candidate.source, buyer: buyerOf(candidate.target), cargo: candidate.target.cargo[0], distance: Math.round(candidate.target.distance), score: candidate.score + (source.kind === 'port' ? 60 : 0) - (source.stop ? 5 : 0) };
    const twin = choices.findIndex(other => siteName(other.source) === siteName(choice.source) && other.buyer.name === choice.buyer.name);
    if (twin < 0) choices.push(choice); else if (choice.score < choices[twin].score) choices[twin] = choice; else continue;
    choices.sort((a, b) => a.score - b.score);
    if (choices.length > 3) choices.pop();
  }
  return choices.map(({ score, ...choice }) => choice);
}

function factoryPair(game) {
  const home = game.cities[0] || { x: game.width / 2, y: game.height / 2 }, stops = game.stations.filter(stop => stop.mode !== 'air'), stations = stops.length ? stops : [home], byId = new Map(game.industries.map(site => [site.id, site]));
  const industrial = { industries: game.industries, cities: [] };
  const sources = game.industries.filter(isRaw).map(site => ({ site, distance: Math.min(...stations.map(stop => industryDistance(site, stop))) })).sort((a, b) => a.distance - b.distance).slice(0, 40);
  const candidates = sources.flatMap(({ site: source, distance }) => findIndustryTargets(industrial, source, 5).map(target => ({
    source, buyer: byId.get(target.id), target, score: distance + target.distance + Math.max(0, Object.keys(INDUSTRIES[byId.get(target.id).kind].inputs).length - 1) * 40,
  }))).sort((a, b) => a.score - b.score);
  const access = new Map(), open = site => { if (!access.has(site)) access.set(site, siteAccess(game, site).kind); return access.get(site); };
  const pair = candidates.find(candidate => open(candidate.source) && open(candidate.buyer));
  return pair ? { source: pair.source, buyer: buyerOf(pair.target), factory: pair.buyer.kind, cargo: pair.target.cargo[0], distance: Math.round(pair.target.distance) } : null;
}

// The first route's Plan road also serves the two freight goals after it, on land: the card previews a road that
// follows the terrain and the stops it needs, builds them in one undoable step and drafts the route (app.js).
function roadPlan(game, { source, buyer, cargo }) {
  const target = buyer.kind === 'city' ? game.cities.find(city => city.id === buyer.id) : game.industries.find(site => site.id === buyer.id);
  if (!target || [source, target].some(site => siteAccess(game, site).kind === 'port')) return {};
  return { plan: 'road', choices: [{ source, buyer, cargo }], choice: 0 };
}

// Factories at the end of a freight route, and the first whose output nothing loads yet.
function openProcessor(game) {
  const stops = new Map(game.stations.map(stop => [stop.id, stop])), freight = game.routes.filter(route => !isTownTraffic(route.cargo));
  const supplied = [];
  for (const route of freight) {
    const end = stops.get(route.stops?.[1]);
    if (end) for (const site of nearbyIndustries(game, end.x, end.y, STATION_RADIUS + 3)) if (INDUSTRIES[site.kind].inputs[route.cargo] && covers(site, end) && !supplied.includes(site)) supplied.push(site);
  }
  const loads = site => freight.some(route => INDUSTRIES[site.kind].outputs[route.cargo] && stops.get(route.stops?.[0]) && covers(site, stops.get(route.stops[0])));
  const processor = supplied.find(site => !loads(site));
  if (!processor) return { supplied: supplied.length > 0, processor: null };
  const byId = new Map(game.industries.map(site => [site.id, site])), target = findIndustryTargets(game, processor, 5).find(target => target.kind === 'city' || siteAccess(game, byId.get(target.id)).kind);
  const missing = Object.keys(INDUSTRIES[processor.kind].inputs).filter(cargo => !freight.some(route => route.cargo === cargo && stops.get(route.stops?.[1]) && covers(processor, stops.get(route.stops[1]))));
  return { supplied: true, processor, missing, buyer: target ? buyerOf(target) : null, factory: byId.get(target?.id)?.kind, cargo: target?.cargo[0], distance: target ? Math.round(target.distance) : 0 };
}

/** The checklist for one suggested first route; each step ticks from the live company. */
export function firstRouteSteps(game, choice) {
  if (!choice) return [];
  const { source, buyer, cargo } = choice;
  const key = `${siteKey(game)}:${game.routes.length}:${game.routes.at(-1)?.id}:${source.id}:${buyer.id}:${cargo}`;
  let state = stepMemos.get(game);
  if (!state || state.key !== key) {
    const target = buyer.kind === 'city' ? game.cities.find(city => city.id === buyer.id) : game.industries.find(site => site.id === buyer.id);
    // An airport never serves an industry, so the checklist leaves airports out.
    const serving = site => site ? game.stations.filter(stop => stop.mode !== 'air' && reach(site, stop) <= STATION_RADIUS).sort((a, b) => reach(site, a) - reach(site, b)) : [];
    const from = serving(source), to = serving(target), ids = [new Set(from.map(stop => stop.id)), new Set(to.map(stop => stop.id))];
    let pair = null;
    for (const a of from.slice(0, 3)) for (const b of to.slice(0, 3)) if (!pair && a !== b && a.mode === b.mode && findPath(game, a, b, a.mode)?.length >= 3) pair = [a, b];
    const route = game.routes.find(route => route.cargo === cargo && route.stops?.some(id => ids[0].has(id)) && route.stops.some(id => ids[1].has(id)));
    const tool = site => { const access = site ? siteAccess(game, site) : { kind: 'road' }; return access.kind === 'port' ? 'port' : access.stop || 'road'; };
    state = { key, from: from.length > 0, to: to.length > 0, pair, route, mode: (pair?.[0] || from[0])?.mode || 'road', tools: [tool(source), tool(target)] };
    stepMemos.set(game, state);
  }
  const stopButton = tool => tool === 'road' ? 'Build road' : tool === 'port' ? 'Place port' : 'Place stop', mode = state.mode;
  return [
    { id: 'source', label: `Stop near ${siteName(source)}`, done: state.from, action: 'stop', tool: state.tools[0], button: stopButton(state.tools[0]) },
    { id: 'buyer', label: `Stop near ${buyer.name}`, done: state.to, action: 'stop', tool: state.tools[1], button: stopButton(state.tools[1]) },
    { id: 'connect', label: 'Connect them', done: Boolean(state.pair), ...mode === 'water' ? {} : { action: 'connect', tool: mode, button: mode === 'rail' ? 'Build rail' : 'Build road' } },
    { id: 'launch', label: `Launch a ${cargoName(cargo)} route`, done: Boolean(state.route), action: 'launch', mode, from: state.pair?.[0].id, to: state.pair?.[1].id, cargo, button: 'Set up route' },
    { id: 'deliver', label: 'First delivery', done: state.route?.delivered > 0 },
  ];
}

// These explanations use the same catchment and storage rules as the simulation.
export function townService(game, city, activeStops = null) {
  if (!activeStops) {
    const stops = new Set(game.routes.filter(route => route.active).flatMap(route => route.stops));
    activeStops = game.stations.filter(stop => stops.has(stop.id));
  }
  const connected = activeStops.some(stop => stationServes(stop, city));
  const served = connected && Number.isFinite(city.lastServiceDay) && game.day - city.lastServiceDay <= 30;
  // The HUD counts connected towns on every tick, so the words, which read growth, needs and room, wait until read.
  let words = null;const read = () => words ??= townWords(game, city, connected, served);
  return { connected, served, label: served ? 'Served recently' : connected ? 'Awaiting deliveries' : 'No route yet', get state() { return read().state; }, get tone() { return read().tone; }, get word() { return read().word; }, get reason() { return read().reason; }, get detail() { return read().detail; }, get fix() { return read().fix; } };
}
// Growing, Needs <cargo> (only while zones nearby wait on it), Out of room or Steady. Needs only speed growth up.
function townWords(game, city, connected, served) {
  const me = token('town', city.id), say = (state, tone, word, reason, extra) => status(game, state, tone, word, reason, extra, [city]);
  if (!connected) return say('steady', 'info', 'Steady', `${me} grows slowly on its own. A route stop within ${STATION_RADIUS} tiles helps it grow.`);
  const growth = townGrowth(game, city);
  if (growth?.change > 0) return say('growing', 'ok', 'Growing', `${me} gained ${count(growth.change, 'resident')} in ${count(growth.days, 'day')}.`);
  const zones = (game.zones || []).filter(zone => Math.hypot(zone.x - city.x, zone.y - city.y) <= 10);
  const need = zones.length ? townNeeds(game, city).find(need => !need.met && need.cargo.length && zones.some(zone => need.kind === 'construction' || zone.kind === need.kind)) : null;
  if (need) return say('needs', 'warn', `Needs ${cargoNames(need.cargo, 'or')}`, `${me} grows faster with ${cargoTokens(need.cargo, 'or')} deliveries.`);
  if (townOutlook(game, city).plots === 0) return say('crowded', 'warn', 'Out of room', `${me} has no free road-side plots. It lays new streets over time, and zones nearby speed this up.`, { fix: { action: 'zone', label: 'Add zones' } });
  return say('steady', 'info', 'Steady', served ? `${me} is served and holding steady.` : `${me} is waiting for its next delivery.`);
}

// With a game, a piling-up store names the route that already loads here. A factory nothing has
// supplied yet is Idle; once supplied, a missing input reads Needs <cargo>.
export function industryStatus(industry, game = null) {
  const definition = INDUSTRIES[industry.kind], inventory = industry.inventory || {}, inputs = Object.keys(definition.inputs), made = cargoTokens(Object.keys(definition.outputs));
  const me = token('industry', industry.id), say = (state, tone, word, reason) => status(game, state, tone, word, reason, { missing }, [industry]);
  const missing = inputs.filter(key => !(inventory[key] > 0));
  if (missing.length) return industry.received > 0 ? say('waiting', 'warn', `Needs ${cargoNames(missing)}`, `${me} needs ${cargoTokens(missing)} to keep making ${made}.`) : say('waiting', 'info', 'Idle', `${me} makes ${made} once it gets ${cargoTokens(inputs)}.`);
  const fill = outputFill(industry);
  if (fill >= .5) {
    const loads = game?.routes.find(route => route.active && definition.outputs[route.cargo] && game.stations.some(stop => stop.id === route.stops?.[0] && covers(industry, stop)));
    const more = loads && `Another ${vehicleNoun(loads.mode, loads.cargo)} on ${token('route', loads.id)} would carry more`;
    return fill >= .9 ? say('full', 'warn', 'Storage nearly full', loads ? `${more}.` : `${me} has almost no room left. A route to a buyer would carry its ${made} away.`)
      : say('backlog', 'warn', 'Output piling up', loads ? `${more}, and let ${me} grow.` : `${me} grows while its ${made} is carried away. A route to a buyer would do that.`);
  }
  const month = Math.round((industry.production || 0) * 30);
  return say('producing', 'ok', 'Producing', month > 0 ? `${me} makes about ${number(month)} ${made} a month.` : `${me} makes ${made}.`);
}

// The sites your freight services load at (first stop) or deliver to (last stop), with the first such route's colour.
// Passenger, mail and offline routes serve no industry; each stop's catchment, as stationCoverage reads it, is found once per call.
export function industryService(game) {
  const stops = new Map(game.stations.map(stop => [stop.id, stop])), coverage = new Map(), service = new Map();
  const covered = id => { const stop = stops.get(id); if (!coverage.has(id)) coverage.set(id, stop ? nearbyIndustries(game, stop.x, stop.y, STATION_RADIUS + 2).filter(site => covers(site, stop)) : []); return coverage.get(id); };
  for (const route of game.routes) {
    if (!route.active || isTownTraffic(route.cargo)) continue;
    for (const [end, role, list] of [[0, 'source', 'outputs'], [1, 'buyer', 'inputs']]) for (const site of covered(route.stops?.[end])) {
      if (!INDUSTRIES[site.kind][list][route.cargo]) continue;
      if (!service.has(site.id)) service.set(site.id, { source: false, buyer: false, color: route.color });
      service.get(site.id)[role] = true;
    }
  }
  return service;
}

// The town pair a passenger or mail service actually links, as passengerEndpoints picks it.
function endpointTowns(towns, stops) {
  let best = null, bestDistance = Infinity;
  for (const a of towns[0]) for (const b of towns[1]) {
    const walking = stationDistance(stops[0], a) + stationDistance(stops[1], b);
    if (a.id !== b.id && walking < bestDistance) { best = [a, b]; bestDistance = walking; }
  }
  return best;
}
// A working route reads Running whatever waits for it: spare demand is routeCapacity's quiet opportunity, never a state.
// Before its first delivery a route is on its first trip. Reasons stay short: the route card already shows both stops.
const fleetCapacity = (game, route, stats) => stats?.capacity ?? game.vehicles.reduce((sum, vehicle) => vehicle.routeId === route.id ? sum + (vehicle.capacity || 0) : sum, 0);
function fleetHealth(game, route, stats, waiting, reason, known) {
  const extra = { waiting, capacity: fleetCapacity(game, route, stats) };
  return route.delivered === 0 ? status(game, 'running', 'info', 'First trip', `The first ${vehicleNoun(route.mode, route.cargo)} is on its way.`, extra, known) : status(game, 'running', 'ok', 'Running', reason, extra, known);
}
/** A full-load route's line at its loading stop from one scan: how many wait, and the head, the earliest arrival (array order on a tie). */
export function fullLoadQueue(game, routeId) {
  let count = 0, head = null;
  for (const vehicle of game.vehicles) if (vehicle.routeId === routeId && waitingForFullLoad(vehicle)) { count++; if (!head || vehicle.fullLoadSince < head.fullLoadSince) head = vehicle; }
  return { count, head };
}
const NO_QUEUE = { count: 0, head: null };
// Loading is the order at work, so it reads as running: the head's load, and a line behind it is the sign that one vehicle fewer would do.
function loadingHealth(game, route, stats, { count: line, head }, waiting, known) {
  return status(game, 'running', 'ok', 'Loading', `Waiting for a full load, ${number(head.load)} of ${number(head.capacity)}${line > 1 ? `, with ${number(line - 1)} more in line` : ''}.`, { waiting, capacity: fleetCapacity(game, route, stats) }, known);
}
// A buyer with full stores still takes and pays for every delivery (unloadVehicle), so the route runs; the reason only suggests
// what would set the buyer working: its missing inputs, or carrying its output away.
function storesFull(game, route, buyer, extra, known) {
  const definition = INDUSTRIES[buyer.kind], missing = Object.keys(definition.inputs).filter(key => key !== route.cargo && !(buyer.inventory?.[key] > 0)), made = cargoTokens(Object.keys(definition.outputs)), me = token('industry', buyer.id), cargo = cargoToken(route.cargo);
  const reason = missing.length ? `Deliveries still pay. Supply ${cargoTokens(missing)} too and ${me} will make ${made}.` : outputFill(buyer) >= .5 ? `Deliveries still pay. Carry ${made} away from ${me} and it will use more ${cargo}.` : `Deliveries still pay while ${me} works through its ${cargo}.`;
  return status(game, 'running', 'info', 'Stores full', reason, extra, known);
}

/** Spare demand as a quiet opportunity, never a state: {waiting, capacity, room, perMonth}. room holds once a working route has run a
 * month and its start holds two full fleet loads (at least 50) of freight, or its quieter town four of passengers or mail. perMonth is
 * what one more vehicle of today's model would carry a month, loading at both ends for town traffic. Pass the health already read. */
export function routeCapacity(game, route, stats = null, health = routeHealth(game, route, stats)) {
  const waiting = health.waiting ?? 0, capacity = health.capacity ?? fleetCapacity(game, route, stats), town = isTownTraffic(route.cargo);
  const purchase = getVehiclePurchase(game, route.mode), trip = 2 * scheduledDays(route.mode, travelTiles(route.mode, route.path), purchase?.level);
  const room = health.state === 'running' && health.word !== 'Loading' && game.day - (route.accountingStartDay ?? 0) >= 30 && waiting >= Math.max(50, (town ? 4 : 2) * capacity);
  return { waiting, capacity, room, perMonth: purchase && trip > 0 ? Math.round(purchase.capacity * (town ? 2 : 1) * 30 / trip) : 0 };
}

export function routeHealth(game, route, stats = null) {
  const stops = route.stops.map(id => game.stations.find(stop => stop.id === id)), [from, to] = stops, ends = from && to ? `${token('stop', from.id)} and ${token('stop', to.id)}` : '';
  const say = (state, tone, word, reason, extra, known = []) => status(game, state, tone, word, reason, extra, [...stops.filter(Boolean), ...known]);
  if (!route.active) return say('blocked', 'error', 'Not connected', route.mode === 'water' ? 'Its ports no longer share open water.' : `Its ${route.mode === 'rail' ? 'track' : 'road'} is cut. Rebuild it, including any bridge or tunnel.`, { fix: { action: 'show-gap', label: 'Show the gap' } });
  if (!ends) return say('blocked', 'error', 'Stop missing', 'One of its stops was removed. Edit the route to pick another, or retire it.', { fix: EDIT });
  if (isTownTraffic(route.cargo)) {
    const towns = stops.map(stop => game.cities.filter(city => stationServes(stop, city))), mail = route.cargo === 'mail';
    if (!towns[0].some(a => towns[1].some(b => a.id !== b.id))) return say('blocked', 'error', mail ? 'No mail' : 'No passengers', `${ends} each need a different town within ${stationReach(from)} tiles.`, { fix: EDIT });
    const pair = endpointTowns(towns, stops), waiting = Math.min(...pair.map(city => Math.floor(city[route.cargo] || 0)));
    return fleetHealth(game, route, stats, waiting, mail ? 'Mail travels both ways.' : 'Passengers travel both ways.', stops);
  }
  const sources = game.industries.filter(site => covers(site, from) && INDUSTRIES[site.kind].outputs[route.cargo]);
  const buyers = game.industries.filter(site => covers(site, to) && INDUSTRIES[site.kind].inputs[route.cargo] && !sources.includes(site));
  // Towns load their workshops' products for another town, and towns with workshops buy their materials.
  const towns = game.cities.filter(city => nearby(city, to)), makers = game.cities.filter(city => nearby(city, from) && !towns.includes(city) && workshopOutputs(game, city).includes(route.cargo));
  const townBuyer = towns.some(city => workshopInputs(game, city).includes(route.cargo) || TOWN_CARGO.includes(route.cargo) && !makers.includes(city)), cargo = cargoToken(route.cargo);
  if (!sources.length && !makers.length) return say('blocked', 'error', 'No supplier', `Nothing within ${STATION_RADIUS} tiles of ${token('stop', from.id)} supplies ${cargo}. Add a supplier there, or edit the route.`, { fix: EDIT });
  if (!buyers.length && !townBuyer) return say('blocked', 'error', 'No buyer', `Nothing within ${STATION_RADIUS} tiles of ${token('stop', to.id)} buys ${cargo}. Add a buyer there, or edit the route.`, { fix: EDIT });
  // Full stores still take and pay for every delivery, so they give way to a supplier's warning and to a full-load line.
  const full = !townBuyer && buyers.every(site => (site.inventory?.[route.cargo] || 0) >= 900 * (site.capacity || 1) - .001);
  // Only a full-load route reads its line; vehicles waiting in it hold cargo that has not left yet.
  const queue = route.fullLoad === true ? stats?.queue ?? fullLoadQueue(game, route.id) : NO_QUEUE;
  const loaded = game.vehicles.some(vehicle => vehicle.routeId === route.id && vehicle.load > 0 && !(queue.count && waitingForFullLoad(vehicle))), nouns = capital(vehicleNoun(route.mode, route.cargo, 2));
  if (!loaded && !sources.some(site => (site.inventory?.[route.cargo] || 0) >= 1) && !makers.some(city => (city.workshop?.output[route.cargo] || 0) >= 1) && !sources.length) {
    const inputs = workshopRecipes(game).filter(recipe => recipe.output === route.cargo).map(recipe => recipe.input), maker = makers[0], works = `${token('town', maker.id)} workshops`;
    if (!inputs.some(input => maker.workshop?.input[input] > 0)) return say('waiting', 'warn', `Needs ${cargoNames(inputs, 'or')}`, `Deliver ${cargoTokens(inputs, 'or')} to ${works}. More ${nouns.toLowerCase()} won’t help yet.`, {}, makers);
    if (!queue.count && !full) return say('running', route.delivered === 0 ? 'info' : 'ok', route.delivered === 0 ? 'First trip' : 'Running', `${works} are making more ${cargo}. More ${nouns.toLowerCase()} won’t help yet.`, {}, makers);
  } else if (!loaded && !sources.some(site => (site.inventory?.[route.cargo] || 0) >= 1) && !makers.some(city => (city.workshop?.output[route.cargo] || 0) >= 1)) {
    const missing = [...new Set(sources.flatMap(site => industryStatus(site).missing))], source = token('industry', sources[0].id);
    if (missing.length) return say('waiting', 'warn', `Needs ${cargoNames(missing)}`, `${source} needs ${cargoTokens(missing)} before it can make ${cargo}. More ${nouns.toLowerCase()} won’t help yet.`, {}, sources);
    if (!queue.count && !full) return say('running', route.delivered === 0 ? 'info' : 'ok', route.delivered === 0 ? 'First trip' : 'Running', `${source} is making more ${cargo}. More ${nouns.toLowerCase()} won’t help yet.`, {}, sources);
  }
  const waiting = sources.reduce((sum, site) => sum + Math.floor(site.inventory?.[route.cargo] || 0), 0) + makers.reduce((sum, city) => sum + Math.floor(city.workshop?.output[route.cargo] || 0), 0);
  if (queue.count) return loadingHealth(game, route, stats, queue, waiting, stops);
  if (full) return storesFull(game, route, buyers[0], { waiting, capacity: fleetCapacity(game, route, stats) }, [...stops, ...buyers]);
  return fleetHealth(game, route, stats, waiting, route.fullLoad === true ? `${nouns} leave the start full, or after a month at most.` : `${nouns} load ${cargo} at the start and return for more.`, stops);
}

/** One optional goal at a time. Searches are memoised; the stage is re-read on every call. */
export function nextProject(game, { source: preferred } = {}) {
  const freight = game.routes.filter(route => !isTownTraffic(route.cargo));
  if (!freight.some(route => route.delivered > 0)) {
    const choices = memo(game, 'first', siteKey(game), () => firstRouteChoices(game)), index = Math.max(0, choices.findIndex(choice => choice.source.id === preferred)), choice = choices[index];
    if (!choice) return { title: 'Your first cargo route', detail: 'Pick a supplier and a buyer in Production chains.', action: 'chains', button: 'Production chains', choices, choice: 0, steps: [] };
    // Until the two ends are joined, the card can also plan the line and its stops, on land only.
    const steps = firstRouteSteps(game, choice), line = steps[2], plan = line.done || line.action !== 'connect' || steps.some(step => step.tool === 'port') ? null : line.tool;
    return { title: 'Your first cargo route', detail: `Carry ${cargoName(choice.cargo)} from ${siteName(choice.source)} to ${choice.buyer.name}. Place a stop within 5 tiles of each.`, action: 'source', target: choice.source.id, button: 'Find cargo', choices, choice: index, steps, plan };
  }
  const delivered = freight.reduce((total, route) => total + route.delivered, 0);
  if (delivered < 100) return { title: 'First 100 cargo deliveries', detail: `${Math.floor(delivered)} of 100 delivered. Every freight delivery counts; passengers and mail don’t.`, action: 'routes', button: 'Open routes', progress: { value: Math.floor(delivered), max: 100 }, figure: `${Math.floor(delivered)} of 100` };
  if (!freight.some(route => route.delivered > 0 && PROCESSED.has(route.cargo))) {
    const chain = memo(game, 'chain', `${siteKey(game)}:${game.routes.length}:${game.routes.at(-1)?.id}`, () => openProcessor(game));
    const pair = chain.supplied ? null : memo(game, 'factory', siteKey(game), () => factoryPair(game));
    if (pair) return { title: 'Supply a factory', detail: `Carry ${cargoName(pair.cargo)} from ${siteName(pair.source)} to ${pair.buyer.name}, ${count(pair.distance, 'tile')}. ${recipe(pair.factory)}`, action: 'source', target: pair.source.id, buyer: pair.buyer, cargo: pair.cargo, button: 'Find cargo', ...roadPlan(game, pair) };
    if (chain.processor && chain.buyer) {
      // A factory takes and pays for what it is sent even while it waits for another input, so the goal says so.
      const name = siteName(chain.processor), supplied = Object.keys(INDUSTRIES[chain.processor.kind].inputs).filter(key => !chain.missing.includes(key));
      const next = chain.missing.length ? `${name} also needs ${cargoNames(chain.missing)} to make ${cargoName(chain.cargo)}; ${cargoNames(supplied)} deliveries pay either way.` : chain.buyer.kind === 'city' ? `Towns buy ${cargoName(chain.cargo)}.` : recipe(chain.factory);
      return { title: `Carry ${cargoName(chain.cargo)} onward`, detail: `Carry ${cargoName(chain.cargo)} from ${name} to ${chain.buyer.name}, ${count(chain.distance, 'tile')}. ${next}`, action: 'source', target: chain.processor.id, buyer: chain.buyer, cargo: chain.cargo, button: 'Find cargo', ...roadPlan(game, { source: chain.processor, buyer: chain.buyer, cargo: chain.cargo }) };
    }
    if (!chain.supplied || chain.processor) return { title: 'Complete a production chain', detail: 'Find an industry near your network in Production chains, then carry its inputs and its output.', action: 'chains', button: 'Production chains' };
  }
  if (!game.zones.length) {
    // A town served within the month stays put; the latest service day would change hands daily.
    const served = game.cities.filter(city => Number.isFinite(city.lastServiceDay)), city = served.find(city => game.day - city.lastServiceDay <= 30) || served.reduce((best, city) => city.lastServiceDay > best.lastServiceDay ? city : best, served[0]) || game.cities[0];
    return { title: 'Grow a neighborhood', detail: `Zone homes beside roads in ${city?.name || 'a town'}, near a regularly served stop. Add shops and a school to help them flourish.`, action: city ? 'city' : 'towns', target: city?.id, button: 'Plan a neighborhood' };
  }
  // Then the company milestones: the lowest open chapter's goals, any of which can be chosen.
  const next = nextMilestone(game, preferred);
  if (next) {
    const { milestone, progress } = next, text = progressText(milestone, progress);
    return { title: milestone.title, detail: text ? `${milestone.detail} ${text}.` : milestone.detail, action: milestone.action, target: milestone.target?.(game), tool: milestone.tool, button: milestone.button, ...progress.target > 1 ? { progress: { value: Math.min(progress.value, progress.target), max: progress.target }, figure: text } : {}, milestone: milestone.id, chapter: next.chapter, choices: next.choices, choice: next.choice };
  }
  return { title: 'Build your own story', detail: airAvailable(game) ? 'Reach a new town, develop a riverside port, open an airport or supply a complex factory. There is no deadline.' : 'Reach a new town, develop a riverside port, or supply a complex factory. There is no deadline.', action: 'atlas', button: 'Explore the region' };
}

// Routes that cannot run at all: offline, missing a stop, or without two towns, a producer
// or a buyer. Waiting services and spare demand never count. Only sites, stops,
// routes and connections decide this; game.revision moves daily, so it stays out of the key,
// and a route going offline moves no revision, so the offline set is part of it.
const attention = new WeakMap();
function blockedRoutes(game) {
  const lists = [game.routes, game.industries, game.stations, game.cities], offline = game.routes.reduce((key, route, index) => route.active ? key : `${key},${index}`, '');
  const key = `${game.networkRevision || 0}:${lists.map(list => list.length)}:${offline}`, cached = attention.get(game);
  if (cached?.key === key && cached.lists.every((list, n) => list === lists[n])) return cached.ids;
  const ids = new Set(game.routes.filter(route => routeHealth(game, route, getRouteFleet(game, route.id)).state === 'blocked').map(route => route.id));
  attention.set(game, { key, lists, ids });
  return ids;
}
export const routesNeedingAttention = game => blockedRoutes(game).size;
export const routeNeedsAttention = (game, route) => blockedRoutes(game).has(route.id);
