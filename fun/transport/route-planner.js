import { findPath, stationCoverage, getVehiclePurchase, passengerEndpoints, getRouteFleet, fareFor, priceFor, industryConditions } from './model.js';
import { CARGO, INDUSTRIES, TOWN_CARGO, VEHICLE_UPKEEP, INFRASTRUCTURE_UPKEEP } from './data.js';
import { passengerArrivals } from './settlements.js';
import { reviewGrowth } from './industry-simulation.js';

const pathCache = new WeakMap();
const canShip = (a, b, cargo) => {
  const producers = a.industries.filter(industry => INDUSTRIES[industry.kind].outputs[cargo]);
  return producers.length > 0 && (b.industries.some(industry => INDUSTRIES[industry.kind].inputs[cargo] && producers.every(producer => producer.id !== industry.id)) || (TOWN_CARGO.includes(cargo) && b.cities.length > 0));
};
const cargoNames = keys => keys.length ? keys.slice(0, 3).map(key => CARGO[key]?.name.toLowerCase() || key).join(', ') + (keys.length > 3 ? ', …' : '') : 'no cargo';
// Name the gap only when no cargo at all fits; one wrong choice keeps its own advice.
function sharedCargoGap(game, stations, coverage) {
  if (passengerEndpoints(game, ...stations)) return '';
  if ([...coverage[0].produces, ...coverage[1].produces].some(cargo => cargo !== 'passengers' && (canShip(coverage[0], coverage[1], cargo) || canShip(coverage[1], coverage[0], cargo)))) return '';
  return `No shared cargo · start loads ${cargoNames(coverage[0].produces)}; end accepts ${cargoNames(coverage[1].accepts)}`;
}

export function routeCargoList(game) {
  return Object.keys(CARGO).filter(key => key === 'passengers' || Object.values(INDUSTRIES).some(industry => industry.biomes.includes(game.biome) && (industry.inputs[key] || industry.outputs[key])));
}

// Match the launch rules without buying a vehicle or changing the world.
export function validateRoutePlan(game, draft, { ignoreFunds = false } = {}) {
  const mode = draft.mode, cargo = draft.cargo;
  const stations = [draft.from, draft.to].map(id => game.stations.find(stop => String(stop.id) === String(id)));
  const result = { valid: false, connected: false, state: 'missing', stations, path: null, reversed: false };
  const fail = message => ({ ...result, message });
  if (!['road', 'rail', 'water'].includes(mode) || !Object.hasOwn(CARGO, cargo)) return fail('Choose transport and cargo.');
  if (!stations[0]) return fail('Select a start stop on the map or from the list.');
  if (!stations[1]) return fail('Select an end stop on the map or from the list.');
  if (stations.some(stop => stop.mode !== mode)) return fail(`Choose two ${mode === 'water' ? 'ports' : mode === 'rail' ? 'rail stations' : 'road stops'}.`);
  if (stations[0].id === stations[1].id) return fail('Choose two different stops.');
  const key = [game.networkRevision || 0, mode, ...stations.flatMap(stop => [stop.id, stop.x, stop.y])].join(':');
  let cached = pathCache.get(game);
  if (!cached || cached.key !== key) {
    cached = { key, path: findPath(game, stations[0], stations[1], mode) };
    pathCache.set(game, cached);
  }
  result.path = cached.path;
  if (!result.path) {
    result.state = 'disconnected';
    return fail(mode === 'water' ? 'No water connection. Choose ports on the same river, lake or sea.' : `No connection. Join these stops with ${mode === 'rail' ? 'rails' : 'roads'}, bridges or tunnels.`);
  }
  result.connected = true;
  result.state = 'connected';
  if (result.path.length < 3) return fail('Stops are too close. Leave at least two tiles of travel.');
  const coverage = stations.map(stop => stationCoverage(game, stop));
  if (cargo === 'passengers') {
    if (!passengerEndpoints(game, ...stations)) return fail(sharedCargoGap(game, stations, coverage) || 'Connected. Each stop must serve a different town within 5 tiles.');
  } else if (!canShip(coverage[0], coverage[1], cargo)) {
    if (canShip(coverage[1], coverage[0], cargo)) result.reversed = true;
    else return fail(sharedCargoGap(game, stations, coverage) || `Connected. Add a ${CARGO[cargo].name.toLowerCase()} producer and buyer within 5 tiles of the stops.`);
  }
  // The same stops and cargo can take another vehicle instead of a duplicate service.
  const [first, second] = result.reversed ? [stations[1], stations[0]] : stations;
  result.existingRouteId = game.routes.find(route => route.mode === mode && route.cargo === cargo && (route.stops[0] === first.id && route.stops[1] === second.id || cargo === 'passengers' && route.stops[0] === second.id && route.stops[1] === first.id))?.id ?? null;
  if (!ignoreFunds && game.money < getVehiclePurchase(game,mode).cost) return fail('Connected. More funds are needed to buy the vehicle.');
  return { ...result, valid: true, message: `${mode === 'water' ? 'Connected by water' : 'Connected'} · ${result.path.length - 1} tiles${result.reversed ? ' · Loads at end stop' : ''}` };
}

// Every biome cargo with its verdict for these stops, fitting cargo first:
// loaded at the start, then loaded at the end, then passengers. Empty until connected.
export function routeCargoOptions(game, draft) {
  const plans = routeCargoList(game).map(cargo => [cargo, validateRoutePlan(game, { ...draft, cargo }, { ignoreFunds: true })]);
  if (!plans[0]?.[1].connected) return [];
  const rank = ([cargo, plan]) => !plan.valid ? 3 : cargo === 'passengers' ? 2 : plan.reversed ? 1 : 0;
  return plans.sort((a, b) => rank(a) - rank(b)).map(([cargo, plan]) => ({ cargo, valid: plan.valid, reversed: plan.reversed, message: plan.message }));
}

// travelSpeed's base tiles per day; weather, grade, traffic and daily variation cost about an eighth,
// and loading at both stops about .4 days per round trip.
const BASE_SPEED = { road: 2.8, rail: 4.6, water: 1.8 };
const roundTrip = (mode, tiles, level) => 2 * tiles / (BASE_SPEED[mode] * (1 + .1 * level) * .88) + .4;
const fleetRate = (game, route) => { const fleet = getRouteFleet(game, route.id); return route.active && fleet.count ? fleet.capacity / roundTrip(route.mode, route.path.length - 1, fleet.minLevel) : 0; };
const near = (a, b, reach) => Math.abs(a.x - b.x) <= reach && Math.abs(a.y - b.y) <= reach;
const forecastCache = new WeakMap(), HORIZON = 180, REVIEW_DAYS = 33;

// A site's mean capacity over the forecast's six months while its output is carried away: the mean
// review step every 33 days (21 plus a mean 12) from its next review, with activity near half the
// level its shipments build up to.
function averageCapacity(game, industry, productivity, shipped) {
  const step = reviewGrowth(productivity, Math.max(industry.activity || 0, shipped * 60));
  let gain = 0;
  for (let t = Math.max(0, (industry.nextReviewDay ?? game.day + REVIEW_DAYS) - game.day); t < HORIZON; t += REVIEW_DAYS) gain += step * (HORIZON - t) / HORIZON;
  return Math.min(3, industry.capacity + gain);
}
// A site's daily output of one cargo once the loading stop serves it. A raw producer grows while its
// output is carried away; a factory is held to what it made lately or to the ingredients your routes
// bring, whichever is more.
function siteSupply(game, industry, cargo, { stops, covers }, from) {
  const definition = INDUSTRIES[industry.kind], inputs = Object.entries(definition.inputs), output = definition.outputs[cargo];
  const productivity = industryConditions(game, industry, from).productivity, potential = output * industry.capacity * productivity;
  if (!inputs.length) return output * averageCapacity(game, industry, productivity, potential) * productivity;
  const inflow = new Map(inputs.map(([input]) => [input, 0]));
  for (const route of game.routes) {
    const stop = inflow.has(route.cargo) && stops.get(route.stops[1]);
    if (stop && near(stop, industry, 8) && covers(stop).industries.includes(industry)) inflow.set(route.cargo, inflow.get(route.cargo) + fleetRate(game, route));
  }
  const fed = Math.min(...inputs.map(([input, amount]) => inflow.get(input) / amount)) * output;
  const recent = (industry.production || 0) * output / Object.values(definition.outputs).reduce((sum, n) => sum + n, 0);
  return Math.min(potential, Math.max(fed, recent));
}
// Daily cargo left for a new vehicle at each loading end: one flow for freight, one per town for
// passengers, after the routes that already load there take what their fleets carry.
function loadingFlows(game, from, to, cargo) {
  const stops = new Map(game.stations.map(stop => [stop.id, stop])), coverage = new Map(), day = Math.floor(game.day);
  const covers = stop => { if (!coverage.has(stop)) coverage.set(stop, stationCoverage(game, stop)); return coverage.get(stop); };
  if (cargo === 'passengers') {
    const towns = passengerEndpoints(game, from, to), taken = new Map(towns.map(town => [town.id, 0]));
    for (const route of game.routes) if (route.cargo === 'passengers' && route.active) {
      const ends = route.stops.map(id => stops.get(id));
      if (ends.every(Boolean) && ends.some(stop => towns.some(town => near(stop, town, 5)))) for (const town of passengerEndpoints(game, ...ends) || []) if (taken.has(town.id)) taken.set(town.id, taken.get(town.id) + fleetRate(game, route));
    }
    return towns.map(town => { const made = passengerArrivals(game, town, day, undefined, undefined, .5); return { made, free: Math.max(0, made - taken.get(town.id)) }; });
  }
  const producers = covers(from).industries.filter(industry => INDUSTRIES[industry.kind].outputs[cargo]);
  const output = new Map(producers.map(industry => [industry.id, siteSupply(game, industry, cargo, { stops, covers }, from)]));
  const made = [...output.values()].reduce((sum, n) => sum + n, 0);
  let taken = 0;
  for (const route of game.routes) {
    const stop = route.cargo === cargo && route.active && stops.get(route.stops[0]);
    if (stop && near(stop, from, 16)) taken += Math.min(fleetRate(game, route), covers(stop).industries.reduce((sum, industry) => sum + (output.get(industry.id) || 0), 0));
  }
  return [{ made, free: Math.max(0, made - taken) }];
}
// Track, structures and stops a new route would share: each item's upkeep is split among its routes, as in maintenance.
function infrastructureShare(game, mode, path, stations) {
  const users = new Map(), use = key => users.set(key, (users.get(key) || 0) + 1);
  for (const route of game.routes) {
    if (mode !== 'water' && route.mode === mode) for (const point of route.path) use(point.y * game.width + point.x);
    for (const id of route.stops) use(`station:${id}`);
  }
  let share = 0;
  if (mode !== 'water') for (const point of path) {
    const key = point.y * game.width + point.x, tile = game.tiles[key];
    share += ((mode === 'rail' ? INFRASTRUCTURE_UPKEEP.rail : tile.publicRoad ? 0 : INFRASTRUCTURE_UPKEEP.road) + (tile.bridge || tile.tunnel ? INFRASTRUCTURE_UPKEEP.structure : 0)) / ((users.get(key) || 0) + 1);
  }
  for (const stop of stations) share += INFRASTRUCTURE_UPKEEP.stop[stop.mode] / ((users.get(`station:${stop.id}`) || 0) + 1);
  return share;
}
function computeForecast(game, draft, plan) {
  if (!plan.valid) return null;
  const { mode, cargo } = draft, purchase = getVehiclePurchase(game, mode), tiles = plan.path.length - 1, joining = Boolean(plan.existingRouteId);
  const [from, to] = plan.reversed ? [...plan.stations].reverse() : plan.stations, flows = loadingFlows(game, from, to, cargo);
  const oneWay = purchase.capacity / roundTrip(mode, tiles, purchase.level), perVehicleDay = oneWay * flows.length;
  const supplyDay = flows.reduce((sum, flow) => sum + flow.free, 0), movedDay = flows.reduce((sum, flow) => sum + Math.min(oneWay, flow.free), 0);
  // An added vehicle joins its route's share of the network; a new route takes its own.
  const upkeep = VEHICLE_UPKEEP[mode] + (joining ? 0 : infrastructureShare(game, mode, plan.path, [from, to]));
  const netMonth = fareFor(game, cargo, plan.path.length, movedDay * 30) - priceFor(game, upkeep * 30);
  const otherModes = Object.keys(BASE_SPEED).filter(other => other !== mode).map(other => { const vehicle = getVehiclePurchase(game, other), rate = vehicle.capacity / roundTrip(other, tiles, vehicle.level) * flows.length; return { mode: other, perVehicleDay: rate, ratio: rate / perVehicleDay }; });
  return {
    perVehicleDay, supplyDay, movedDay, netMonth, paybackMonths: netMonth > 0 ? purchase.cost / netMonth : Infinity,
    vehiclesToSaturate: Math.max(0, Math.ceil(Math.max(...flows.map(flow => flow.free)) / oneWay - 1e-9)), otherModes,
    madeDay: flows.reduce((sum, flow) => sum + flow.made, 0), fullLoad: fareFor(game, cargo, plan.path.length, purchase.capacity), cost: purchase.cost, joining,
  };
}

// A rough monthly outlook for one more vehicle on these stops: fares for what it can carry of the
// cargo not yet taken, less its upkeep and share of the network. Cached per draft, day and revision.
export function forecastRoute(game, draft, plan = null) {
  const key = [game.networkRevision || 0, game.revision, Math.floor(game.day), game.routes.length, game.vehicles.length, draft.mode, draft.from, draft.to, draft.cargo].join(':');
  const cached = forecastCache.get(game);
  if (cached?.key === key) return cached.forecast;
  const forecast = computeForecast(game, draft, plan?.valid ? plan : validateRoutePlan(game, draft, { ignoreFunds: true }));
  forecastCache.set(game, { key, forecast });
  return forecast;
}

const ROUTE_NAME_LENGTH = 36;
// Name a service by what it does: the two towns, or cargo from its producer to its buyer.
export function defaultRouteName(game, plan, cargo) {
  const [from, to] = plan.reversed ? [...plan.stations].reverse() : plan.stations;
  if (!from || !to) return '';
  const names = [];
  if (cargo === 'passengers') {
    const towns = passengerEndpoints(game, from, to);
    if (towns) names.push(`${towns[0].name} · ${towns[1].name}`);
  } else if (Object.hasOwn(CARGO, cargo)) {
    const source = stationCoverage(game, from).industries.find(industry => INDUSTRIES[industry.kind].outputs[cargo]), destination = stationCoverage(game, to);
    const buyer = destination.industries.find(industry => INDUSTRIES[industry.kind].inputs[cargo] && industry.id !== source?.id) || (TOWN_CARGO.includes(cargo) ? destination.cities[0] : null);
    const site = industry => industry.name || INDUSTRIES[industry.kind].name;
    if (source && buyer) names.push(`${CARGO[cargo].name} · ${site(source)} → ${buyer.name || site(buyer)}`, `${site(source)} → ${buyer.name || site(buyer)}`);
  }
  const name = names.find(name => name.length <= ROUTE_NAME_LENGTH) || names.at(-1) || `${from.name} → ${to.name}`;
  return name.length > ROUTE_NAME_LENGTH ? name.slice(0, ROUTE_NAME_LENGTH - 1).trimEnd() + '…' : name;
}

export function filterRoutes(game, filters = {}) {
  const words = String(filters.query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const stops = words.length ? new Map(game.stations.map(stop => [String(stop.id), stop.name])) : null;
  return game.routes.filter(route => {
    if (filters.mode && filters.mode !== 'all' && route.mode !== filters.mode) return false;
    if (filters.status === 'running' && !route.active) return false;
    if (filters.status === 'disconnected' && route.active) return false;
    if (filters.cargo && filters.cargo !== 'all' && route.cargo !== filters.cargo) return false;
    if (!words.length) return true;
    const search = [route.name, CARGO[route.cargo]?.name, route.cargo, route.mode, route.mode === 'water' ? 'ship ferry boat port' : route.mode === 'rail' ? 'train' : route.cargo === 'passengers' ? 'bus' : 'truck', ...route.stops.map(id => stops.get(String(id)))].join(' ').toLocaleLowerCase();
    return words.every(word => search.includes(word));
  });
}
