import { INDUSTRIES, CARGO, TOWN_CARGO } from './data.js';
import { STATION_RADIUS, findPath, vehicleNoun, getRouteFleet } from './model.js';
import { findIndustryTargets } from './chains.js';
import { industryDistance, industryContains, industrySize } from './industry-sites.js';
import { buildingAt } from './building-sites.js';
import { networkTerrainShape } from './terrain-engineering.js';
import { nearbyIndustries } from './simulation-spatial.js';
import { outputFill } from './industry-simulation.js';
import { nextMilestone, progressText } from './milestones.js';

const nearby = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= STATION_RADIUS;
const covers = (site, stop) => industryDistance(site, stop) <= STATION_RADIUS;
const joinCargo = keys => keys.map(key => CARGO[key].name.toLowerCase()).join(' + ');
const isCity = site => !INDUSTRIES[site?.kind];
const reach = (site, point) => isCity(site) ? Math.hypot(site.x - point.x, site.y - point.y) : industryDistance(site, point);
const siteName = site => site.name || INDUSTRIES[site.kind]?.name || 'Town';
const isRaw = site => !Object.keys(INDUSTRIES[site.kind].inputs).length;
const PROCESSED = new Set(Object.values(INDUSTRIES).filter(definition => Object.keys(definition.inputs).length).flatMap(definition => Object.keys(definition.outputs)));
const cargoName = key => CARGO[key].name.toLowerCase();
const listing = parts => parts.length < 3 ? parts.join(' and ') : parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1);
const plural = name => /s$/.test(name) ? name : /y$/.test(name) ? name.slice(0, -1) + 'ies' : name + 's';
const recipe = kind => { const d = INDUSTRIES[kind], amounts = entries => listing(Object.entries(entries).map(([key, n]) => `${n} ${cargoName(key)}`)); return `${plural(d.name)} turn ${amounts(d.inputs)} into ${amounts(d.outputs)}.`; };
const buyerOf = target => ({ id: target.id, kind: target.kind, name: target.name, x: target.x, y: target.y });

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
  const stops = new Set(game.stations.map(stop => stop.y * game.width + stop.x)), centers = new Set(game.cities.map(town => town.y * game.width + town.x));
  const industries = game.industries.filter(other => other.x <= site.x + size + R && other.y <= site.y + size + R && other.x + 3 >= site.x - R && other.y + 3 >= site.y - R);
  const tile = (x, y) => x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y * game.width + x] : null;
  let land = city, port = false;
  for (let y = site.y - R; y < site.y + size + R; y++) for (let x = site.x - R; x < site.x + size + R; x++) {
    const t = tile(x, y), distance = reach(site, { x, y });
    if (!t || distance > R || (!city && distance === 0)) continue;
    const blocked = stops.has(y * game.width + x) || t.zone || industries.some(other => industryContains(other, x, y));
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
  const home = game.cities[0] || { x: game.width / 2, y: game.height / 2 }, stations = game.stations.length ? game.stations : [home], byId = new Map(game.industries.map(site => [site.id, site]));
  const industrial = { industries: game.industries, cities: [] };
  const sources = game.industries.filter(isRaw).map(site => ({ site, distance: Math.min(...stations.map(stop => industryDistance(site, stop))) })).sort((a, b) => a.distance - b.distance).slice(0, 40);
  const candidates = sources.flatMap(({ site: source, distance }) => findIndustryTargets(industrial, source, 5).map(target => ({
    source, buyer: byId.get(target.id), target, score: distance + target.distance + Math.max(0, Object.keys(INDUSTRIES[byId.get(target.id).kind].inputs).length - 1) * 40,
  }))).sort((a, b) => a.score - b.score);
  const access = new Map(), open = site => { if (!access.has(site)) access.set(site, siteAccess(game, site).kind); return access.get(site); };
  const pair = candidates.find(candidate => open(candidate.source) && open(candidate.buyer));
  return pair ? { source: pair.source, buyer: buyerOf(pair.target), factory: pair.buyer.kind, cargo: pair.target.cargo[0], distance: Math.round(pair.target.distance) } : null;
}

// Factories at the end of a freight route, and the first whose output nothing loads yet.
function openProcessor(game) {
  const stops = new Map(game.stations.map(stop => [stop.id, stop])), freight = game.routes.filter(route => route.cargo !== 'passengers');
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
    const serving = site => site ? game.stations.filter(stop => reach(site, stop) <= STATION_RADIUS).sort((a, b) => reach(site, a) - reach(site, b)) : [];
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
  const connected = activeStops.some(stop => nearby(stop, city));
  const served = connected && Number.isFinite(city.lastServiceDay) && game.day - city.lastServiceDay <= 30;
  return { connected, served, label: served ? 'Served recently' : connected ? 'Awaiting deliveries' : 'No service' };
}

// With a game, a piling-up store names the service that already loads here.
export function industryStatus(industry, game = null) {
  const definition = INDUSTRIES[industry.kind], inventory = industry.inventory || {};
  const missing = Object.keys(definition.inputs).filter(key => !(inventory[key] > 0));
  if (missing.length) return { state: 'waiting', label: 'Needs ' + joinCargo(missing), missing, detail: 'Deliver every input to restart production.' };
  const full = Object.keys(definition.outputs).some(key => (inventory[key] || 0) >= 900 * (industry.capacity || 1) - .001);
  if (full || outputFill(industry) >= .5) {
    const loads = game?.routes.find(route => route.active && definition.outputs[route.cargo] && game.stations.some(stop => stop.id === route.stops?.[0] && covers(industry, stop)));
    const detail = loads ? `Your service can't keep up. Add vehicles to ${loads.name}.` : full ? 'Carry output to a buyer to make room.' : 'Growth paused until more is shipped. Add vehicles or another route.';
    return full ? { state: 'full', label: 'Storage full', missing: [], detail } : { state: 'backlog', label: 'Output piling up', missing: [], detail };
  }
  return { state: 'producing', label: 'Producing', missing: [], detail: 'Output depends on nearby nature, roads, workers and weather.' };
}

// The town pair a passenger service actually links, as passengerEndpoints picks it.
function endpointTowns(towns, stops) {
  let best = null, bestDistance = Infinity;
  for (const a of towns[0]) for (const b of towns[1]) {
    const walking = Math.hypot(a.x - stops[0].x, a.y - stops[0].y) + Math.hypot(b.x - stops[1].x, b.y - stops[1].y);
    if (a.id !== b.id && walking < bestDistance) { best = [a, b]; bestDistance = walking; }
  }
  return best;
}
// Another vehicle pays only while at least two full loads wait for the fleet.
function fleetHealth(game, route, stats, waiting, running) {
  const capacity = stats?.capacity ?? game.vehicles.reduce((sum, vehicle) => vehicle.routeId === route.id ? sum + (vehicle.capacity || 0) : sum, 0);
  if (waiting < Math.max(50, 2 * capacity)) return { ...running, waiting, capacity };
  return { state: 'busy', label: route.cargo === 'passengers' ? 'Passengers waiting' : 'Cargo piling up', detail: `About ${Math.round(waiting / Math.max(1, capacity))} loads. Add a ${vehicleNoun(route.mode, route.cargo)}.`, waiting, capacity };
}

export function routeHealth(game, route, stats = null) {
  if (!route.active) return { state: 'blocked', label: 'Disconnected', detail: 'Repair the connection between the two stops.' };
  const stops = route.stops.map(id => game.stations.find(stop => stop.id === id));
  if (stops.some(stop => !stop)) return { state: 'blocked', label: 'Missing stop', detail: 'This service needs both stops.' };
  if (route.cargo === 'passengers') {
    const towns = stops.map(stop => game.cities.filter(city => nearby(city, stop)));
    if (!towns[0].some(a => towns[1].some(b => a.id !== b.id))) return { state: 'blocked', label: 'No passengers', detail: 'Each stop must cover a different town.' };
    const waiting = Math.min(...endpointTowns(towns, stops).map(city => Math.floor(city.passengers || 0)));
    return fleetHealth(game, route, stats, waiting, { state: 'running', label: 'Running', detail: 'Passengers travel both ways.' });
  }
  const sources = game.industries.filter(site => covers(site, stops[0]) && INDUSTRIES[site.kind].outputs[route.cargo]);
  const buyers = game.industries.filter(site => covers(site, stops[1]) && INDUSTRIES[site.kind].inputs[route.cargo] && !sources.includes(site));
  const townBuyer = TOWN_CARGO.includes(route.cargo) && game.cities.some(city => nearby(city, stops[1]));
  if (!sources.length) return { state: 'blocked', label: 'No producer', detail: `Add a producer of ${CARGO[route.cargo].name.toLowerCase()} within 5 tiles of the start.` };
  if (!buyers.length && !townBuyer) return { state: 'blocked', label: 'No buyer', detail: 'Add a buyer within 5 tiles of the end stop.' };
  if (!townBuyer && buyers.every(site => (site.inventory?.[route.cargo] || 0) >= 900 * (site.capacity || 1) - .001)) {
    return { state: 'waiting', label: 'Buyer full', detail: 'Supply its other inputs and carry away its output.' };
  }
  const loaded = game.vehicles.some(vehicle => vehicle.routeId === route.id && vehicle.load > 0);
  if (!loaded && !sources.some(site => (site.inventory?.[route.cargo] || 0) >= 1)) {
    const missing = [...new Set(sources.flatMap(site => industryStatus(site).missing))];
    return { state: 'waiting', label: missing.length ? 'Needs inputs' : 'Waiting for cargo', detail: missing.length ? 'Supply ' + joinCargo(missing) + ' to the producer.' : 'The producer is replenishing its stock. Extra vehicles will not help yet.' };
  }
  const waiting = sources.reduce((sum, site) => sum + Math.floor(site.inventory?.[route.cargo] || 0), 0);
  return fleetHealth(game, route, stats, waiting, { state: 'running', label: 'Running', detail: 'Freight loads at the start and returns for the next shipment.' });
}

/** One optional goal at a time. Searches are memoised; the stage is re-read on every call. */
export function nextProject(game, { source: preferred } = {}) {
  const freight = game.routes.filter(route => route.cargo !== 'passengers');
  if (!freight.some(route => route.delivered > 0)) {
    const choices = memo(game, 'first', siteKey(game), () => firstRouteChoices(game)), index = Math.max(0, choices.findIndex(choice => choice.source.id === preferred)), choice = choices[index];
    if (!choice) return { title: 'Your first cargo route', detail: 'Use Chains to choose a producer and a buyer.', action: 'chains', button: 'Explore chains', choices, choice: 0, steps: [] };
    return { title: 'Your first cargo route', detail: `Carry ${cargoName(choice.cargo)} from ${siteName(choice.source)} to ${choice.buyer.name}. Place a stop within 5 tiles of each.`, action: 'source', target: choice.source.id, button: 'Find cargo', choices, choice: index, steps: firstRouteSteps(game, choice) };
  }
  const delivered = freight.reduce((total, route) => total + route.delivered, 0);
  if (delivered < 100) return { title: 'First 100 cargo deliveries', detail: `${Math.floor(delivered)} / 100 delivered. Keep inputs supplied and your connections intact.`, action: 'routes', button: 'View services', progress: { value: Math.floor(delivered), max: 100 } };
  if (!freight.some(route => route.delivered > 0 && PROCESSED.has(route.cargo))) {
    const chain = memo(game, 'chain', `${siteKey(game)}:${game.routes.length}:${game.routes.at(-1)?.id}`, () => openProcessor(game));
    const pair = chain.supplied ? null : memo(game, 'factory', siteKey(game), () => factoryPair(game));
    if (pair) return { title: 'Supply a factory', detail: `${CARGO[pair.cargo].name} from ${siteName(pair.source)} → ${pair.buyer.name} (${pair.distance} tiles). ${recipe(pair.factory)}`, action: 'source', target: pair.source.id, buyer: pair.buyer, cargo: pair.cargo, button: 'Find cargo' };
    if (chain.processor && chain.buyer) {
      const name = siteName(chain.processor), next = chain.missing.length ? `${name} also needs ${joinCargo(chain.missing)}.` : chain.buyer.kind === 'city' ? `Towns buy ${cargoName(chain.cargo)}.` : recipe(chain.factory);
      return { title: `Carry ${cargoName(chain.cargo)} onward`, detail: `${CARGO[chain.cargo].name} from ${name} → ${chain.buyer.name} (${chain.distance} tiles). ${next}`, action: 'source', target: chain.processor.id, buyer: chain.buyer, cargo: chain.cargo, button: 'Find cargo' };
    }
    if (!chain.supplied || chain.processor) return { title: 'Complete a production chain', detail: 'Use Chains to find a factory near your network, then carry its inputs and its output.', action: 'chains', button: 'Explore chains' };
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
    return { title: milestone.title, detail: text ? `${milestone.detail} ${text}.` : milestone.detail, action: milestone.action, target: milestone.target?.(game), tool: milestone.tool, button: milestone.button, ...progress.target > 1 ? { progress: { value: Math.min(progress.value, progress.target), max: progress.target } } : {}, milestone: milestone.id, chapter: next.chapter, choices: next.choices, choice: next.choice };
  }
  return { title: 'Build your own story', detail: 'Reach a new town, develop a riverside port, or supply a complex factory. There is no deadline.', action: 'atlas', button: 'Explore the region' };
}

// Routes that cannot run at all: offline, missing a stop, or without two towns, a producer
// or a buyer. Waiting and busy services still work, so they never count. Only sites, stops,
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
