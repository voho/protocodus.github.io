import { findPath, stationCoverage, getVehiclePurchase, passengerEndpoints, getRouteFleet, fareFor, priceFor, industryConditions, stationServes, airAvailable, AIRPORT_MIN_TILES, AIRPORT_REACH } from './model.js';
import { freightFits, workshopLoop } from './model.js';
import { FULL_LOAD_MAX_WAIT } from './model.js';
import { workshopLevels, workshopOutputs } from './town-market.js';
import { WORKSHOP } from './data.js';
import { CARGO, INDUSTRIES, TOWN_CARGO, VEHICLE_UPKEEP, INFRASTRUCTURE_UPKEEP } from './data.js';
import { passengerArrivals } from './settlements.js';
import { reviewGrowth } from './industry-simulation.js';
import { routeNeedsAttention } from './gameplay-insights.js';
import { money, tiles, listJoin, cargoName, vehicleNoun } from './copy.js';
import { defaultRouteName as routeName } from './route-lines.js';
import { payTiles, travelTiles, scheduledDays, transitPay } from './economy-pricing.js';
import { VEHICLE_SPEEDS } from './data.js';
import { familyOf, marketView, MARKET } from './town-market.js';
import { isTownTraffic } from './data.js';
import { mailRate } from './settlements.js';
import { localEnvironment } from './environment.js';

const pathCache = new WeakMap();
const cargoNames = keys => keys.length ? listJoin([...keys.slice(0, 3).map(key => cargoName(key)), ...keys.length > 3 ? ['more'] : []]) : 'no cargo';
// Name the gap only when no cargo at all fits; one wrong choice keeps its own advice.
function sharedCargoGap(game, stations, coverage) {
  if (passengerEndpoints(game, ...stations)) return '';
  if ([...coverage[0].produces, ...coverage[1].produces].some(cargo => !isTownTraffic(cargo) && (freightFits(game, coverage[0], coverage[1], cargo) || freightFits(game, coverage[1], coverage[0], cargo)))) return '';
  return `No cargo fits both stops. The start loads ${cargoNames(coverage[0].produces)}, and the end accepts ${cargoNames(coverage[1].accepts)}.`;
}

export function routeCargoList(game) {
  return Object.keys(CARGO).filter(key => isTownTraffic(key) || Object.values(INDUSTRIES).some(industry => industry.biomes.includes(game.biome) && (industry.inputs[key] || industry.outputs[key])));
}

// Match the launch rules without buying a vehicle or changing the world.
export function validateRoutePlan(game, draft, { ignoreFunds = false } = {}) {
  const mode = draft.mode, cargo = draft.cargo;
  const stations = [draft.from, draft.to].map(id => game.stations.find(stop => String(stop.id) === String(id)));
  const result = { valid: false, connected: false, state: 'missing', stations, path: null, reversed: false };
  const fail = message => ({ ...result, message });
  if (!['road', 'rail', 'water', 'air'].includes(mode) || !Object.hasOwn(CARGO, cargo)) return fail('Choose transport and cargo.');
  if (!stations[0]) return fail('Select a start stop on the map or from the list.');
  if (!stations[1]) return fail('Select an end stop on the map or from the list.');
  if (stations.some(stop => stop.mode !== mode)) return fail(`Choose two ${mode === 'water' ? 'ports' : mode === 'rail' ? 'rail stations' : mode === 'air' ? 'airports' : 'road stops'}.`);
  if (stations[0].id === stations[1].id) return fail('Choose two different stops.');
  if (mode === 'air' && !isTownTraffic(cargo)) return fail('Planes carry passengers and mail.');
  const key = [game.networkRevision || 0, mode, ...stations.flatMap(stop => [stop.id, stop.x, stop.y])].join(':');
  let cached = pathCache.get(game);
  if (!cached || cached.key !== key) {
    cached = { key, path: findPath(game, stations[0], stations[1], mode) };
    pathCache.set(game, cached);
  }
  result.path = cached.path;
  if (!result.path) {
    result.state = 'disconnected';
    return fail(mode === 'water' ? 'These ports don’t share open water. Choose ports on the same river, lake or sea.' : `${stations[0].name} and ${stations[1].name} aren’t joined by ${mode}. Build the missing ${mode === 'rail' ? 'track' : 'road'}, or pick another stop.`);
  }
  result.connected = true;
  result.state = 'connected';
  if (result.path.length < 3) return fail('Stops are too close. Leave at least two tiles of travel.');
  if (mode === 'air' && result.path.length - 1 < AIRPORT_MIN_TILES) return fail(`Airports must be at least ${AIRPORT_MIN_TILES} tiles apart for a flight.`);
  const coverage = stations.map(stop => stationCoverage(game, stop));
  if (isTownTraffic(cargo)) {
    if (!passengerEndpoints(game, ...stations)) return fail(mode === 'air' ? `Connected. Each airport must serve a different town within ${AIRPORT_REACH} tiles.` : sharedCargoGap(game, stations, coverage) || 'Connected, but each stop needs a different town within 5 tiles.');
  } else if (!freightFits(game, coverage[0], coverage[1], cargo)) {
    if (freightFits(game, coverage[1], coverage[0], cargo)) result.reversed = true;
    else return fail(workshopLoop(game, coverage[0], coverage[1], cargo) || sharedCargoGap(game, stations, coverage) || `Connected. Add a ${cargoName(cargo)} supplier and a buyer within 5 tiles of the stops.`);
  }
  // The same stops and cargo can take another vehicle instead of a duplicate service.
  const [first, second] = result.reversed ? [stations[1], stations[0]] : stations;
  result.existingRouteId = game.routes.find(route => route.mode === mode && route.cargo === cargo && (route.stops[0] === first.id && route.stops[1] === second.id || isTownTraffic(cargo) && route.stops[0] === second.id && route.stops[1] === first.id))?.id ?? null;
  if (!ignoreFunds && game.money < getVehiclePurchase(game,mode).cost) return fail(`Connected. Need ${money(getVehiclePurchase(game,mode).cost)} for the first ${vehicleNoun(mode, cargo)}.`);
  return { ...result, valid: true, message: mode === 'air' ? `Flight, ${tiles(result.path.length - 1)}.` : `Connected by ${mode === 'water' ? 'water' : mode}, ${tiles(result.path.length - 1)}.${result.reversed ? ' Loads at the end stop.' : ''}` };
}

// Every biome cargo with its verdict for these stops, fitting cargo first:
// loaded at the start, then loaded at the end, then passengers, then mail. Empty until connected.
export function routeCargoOptions(game, draft) {
  const plans = routeCargoList(game).map(cargo => [cargo, validateRoutePlan(game, { ...draft, cargo }, { ignoreFunds: true })]);
  if (!plans[0]?.[1].connected) return [];
  const rank = ([cargo, plan]) => !plan.valid ? 3 : cargo === 'mail' ? 2.5 : cargo === 'passengers' ? 2 : plan.reversed ? 1 : 0;
  return plans.sort((a, b) => rank(a) - rank(b)).map(([cargo, plan]) => ({ cargo, valid: plan.valid, reversed: plan.reversed, message: plan.message }));
}

// The timetable of scheduledDays: travelSpeed's base tiles per day, less the typical share weather, grade,
// traffic and daily variation cost (an eighth on land, more on water), and about .2 days at each stop.
const roundTrip = (mode, tiles, level) => 2 * scheduledDays(mode, tiles, level);
const fleetRate = (game, route) => { const fleet = getRouteFleet(game, route.id); return route.active && fleet.count ? fleet.capacity / roundTrip(route.mode, travelTiles(route.mode, route.path), fleet.minLevel) : 0; };
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
// passengers or mail, after the routes that already load there take what their fleets carry.
function loadingFlows(game, from, to, cargo) {
  const stops = new Map(game.stations.map(stop => [stop.id, stop])), coverage = new Map(), day = Math.floor(game.day);
  const covers = stop => { if (!coverage.has(stop)) coverage.set(stop, stationCoverage(game, stop)); return coverage.get(stop); };
  if (isTownTraffic(cargo)) {
    const towns = passengerEndpoints(game, from, to), taken = new Map(towns.map(town => [town.id, 0]));
    for (const route of game.routes) if (route.cargo === cargo && route.active) {
      const ends = route.stops.map(id => stops.get(id));
      if (ends.every(Boolean) && ends.some(stop => towns.some(town => near(stop, town, 5)))) for (const town of passengerEndpoints(game, ...ends) || []) if (taken.has(town.id)) taken.set(town.id, taken.get(town.id) + fleetRate(game, route));
    }
    return towns.map(town => { const made = cargo === 'mail' ? mailRate(town, localEnvironment(game, town.x, town.y)) : passengerArrivals(game, town, day, undefined, undefined, .5); return { made, free: Math.max(0, made - taken.get(town.id)) }; });
  }
  const producers = covers(from).industries.filter(industry => INDUSTRIES[industry.kind].outputs[cargo]);
  const output = new Map(producers.map(industry => [industry, siteSupply(game, industry, cargo, { stops, covers }, from)]));
  // A town's workshops send what their levels worked last month, one product for every two materials: nothing until a month has closed.
  const ends = covers(to).cities, towns = covers(from).cities.filter(city => !ends.includes(city) && workshopOutputs(game, city).includes(cargo)).map(city => [city, marketView(game, city).utilization]);
  for (const [city, used] of towns) output.set(city, workshopLevels(game, city) * WORKSHOP.rate * (used || 0) / WORKSHOP.ratio);
  const made = [...output.values()].reduce((sum, n) => sum + n, 0);
  let taken = 0;
  for (const route of game.routes) {
    const stop = route.cargo === cargo && route.active && stops.get(route.stops[0]);
    if (stop && near(stop, from, 16)) taken += Math.min(fleetRate(game, route), [...covers(stop).industries, ...covers(stop).cities].reduce((sum, site) => sum + (output.get(site) || 0), 0));
  }
  return [{ made, free: Math.max(0, made - taken), pending: towns.some(([, used]) => used === undefined) }];
}
// Track, structures and stops a new route would share: each item's upkeep is split among its routes, as in maintenance.
function infrastructureShare(game, mode, path, stations) {
  const users = new Map(), use = key => users.set(key, (users.get(key) || 0) + 1);
  for (const route of game.routes) {
    if ((mode === 'road' || mode === 'rail') && route.mode === mode) for (const point of route.path) use(point.y * game.width + point.x);
    for (const id of route.stops) use(`station:${id}`);
  }
  let share = 0;
  if (mode === 'road' || mode === 'rail') for (const point of path) {
    const key = point.y * game.width + point.x, tile = game.tiles[key];
    share += ((mode === 'rail' ? INFRASTRUCTURE_UPKEEP.rail : tile.publicRoad ? 0 : INFRASTRUCTURE_UPKEEP.road) + (tile.bridge || tile.tunnel ? INFRASTRUCTURE_UPKEEP.structure : 0)) / ((users.get(key) || 0) + 1);
  }
  for (const stop of stations) share += INFRASTRUCTURE_UPKEEP.stop[stop.mode] / ((users.get(`station:${stop.id}`) || 0) + 1);
  return share;
}
function computeForecast(game, draft, plan) {
  if (!plan.valid) return null;
  const { mode, cargo } = draft, purchase = getVehiclePurchase(game, mode), tiles = travelTiles(mode, plan.path), paid = payTiles(plan.path), joining = Boolean(plan.existingRouteId);
  const [from, to] = plan.reversed ? [...plan.stations].reverse() : plan.stations, flows = loadingFlows(game, from, to, cargo);
  const oneWay = purchase.capacity / roundTrip(mode, tiles, purchase.level), perVehicleDay = oneWay * flows.length;
  const supplyDay = flows.reduce((sum, flow) => sum + flow.free, 0), movedDay = flows.reduce((sum, flow) => sum + Math.min(oneWay, flow.free), 0);
  // With full load a freight vehicle stands at the start for the share of its round trips the supply cannot fill, at the
  // idle 45% of its upkeep, and what boards during a wait rides along for about half of it. A supply that fills it never waits.
  const full = draft.fullLoad === true && !isTownTraffic(cargo), moving = full ? Math.min(1, supplyDay / perVehicleDay) : 1, wait = moving < 1 ? Math.min(FULL_LOAD_MAX_WAIT, purchase.capacity / Math.max(.01, supplyDay)) / 2 : 0;
  // One trip's days on the way set the share of the fare a delivery keeps.
  const days = Math.round(scheduledDays(mode, tiles, purchase.level) + wait), share = transitPay(cargo, days), perUnit = fareFor(game, cargo, paid + 1, 1, game.day, days);
  // An added vehicle joins its route's share of the network; a new route takes its own.
  const upkeep = VEHICLE_UPKEEP[mode] * (moving + .45 * (1 - moving)) + (joining ? 0 : infrastructureShare(game, mode, plan.path, [from, to]));
  let netMonth = fareFor(game, cargo, paid + 1, movedDay * 30, game.day, days) - priceFor(game, upkeep * 30);
  // The receiving town's shops pay a quarter more for what they still wanted last month.
  const receiver = TOWN_CARGO.includes(cargo) ? stationCoverage(game, to).cities[0] : null, family = receiver && familyOf(game, cargo), market = family && marketView(game, receiver);
  const marketBonus = market ? MARKET.bonus * perUnit * Math.min(movedDay * 30, Math.max(0, Math.round(market.wants[family] * (1 - market.met[family])))) : 0;
  netMonth += marketBonus;
  // A plane is compared only once air travel has arrived and an airport serves each end's town.
  const flies = mode !== 'air' && isTownTraffic(cargo) && airAvailable(game) && Boolean(passengerEndpoints(game, from, to)?.every(town => game.stations.some(stop => stop.mode === 'air' && stationServes(stop, town))));
  const otherModes = Object.keys(VEHICLE_SPEEDS).filter(other => other !== mode && (other !== 'air' || flies)).map(other => { const vehicle = getVehiclePurchase(game, other), rate = vehicle.capacity / roundTrip(other, tiles, vehicle.level) * flows.length; return { mode: other, perVehicleDay: rate, ratio: rate / perVehicleDay, share: transitPay(cargo, Math.round(scheduledDays(other, tiles, vehicle.level))) }; });
  return {
    perVehicleDay, supplyDay, movedDay, netMonth, paybackMonths: netMonth > 0 ? purchase.cost / netMonth : Infinity,
    vehiclesToSaturate: Math.max(0, Math.ceil(Math.max(...flows.map(flow => flow.free)) / oneWay - 1e-9)), otherModes,
    madeDay: flows.reduce((sum, flow) => sum + flow.made, 0), fullFare: fareFor(game, cargo, paid + 1, purchase.capacity, game.day, days), cost: purchase.cost, joining,
    tiles: paid, travel: tiles, days, share, perUnit, wait,
    marketBonus, workshopsPending: flows.some(flow => flow.pending),
  };
}

// A rough monthly outlook for one more vehicle on these stops: fares for what it can carry of the
// cargo not yet taken, less its upkeep and share of the network. Cached per draft, day and revision.
export function forecastRoute(game, draft, plan = null) {
  const key = [game.networkRevision || 0, game.revision, Math.floor(game.day), game.routes.length, game.vehicles.length, draft.mode, draft.from, draft.to, draft.cargo, draft.fullLoad === true].join(':');
  const cached = forecastCache.get(game);
  if (cached?.key === key) return cached.forecast;
  const forecast = computeForecast(game, draft, plan?.valid ? plan : validateRoutePlan(game, draft, { ignoreFunds: true }));
  forecastCache.set(game, { key, forecast });
  return forecast;
}

/** Forecast details' fare line. 'Full load' names only the order, so this is what one full vehicle pays. */
export const fullFareText = (mode, cargo, fare) => `A full ${vehicleNoun(mode, cargo)} pays ≈ ${money(fare)}`;

// Name a route by what it does, as route-lines.js does at launch; `except` is the route being edited.
export function defaultRouteName(game, plan, cargo, except = null) {
  const [from, to] = plan.reversed ? [...plan.stations].reverse() : plan.stations;
  return from && to ? routeName(game, [from, to], cargo, except) : '';
}

export function filterRoutes(game, filters = {}) {
  const words = String(filters.query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const stops = words.length ? new Map(game.stations.map(stop => [String(stop.id), stop.name])) : null;
  return game.routes.filter(route => {
    if (filters.mode && filters.mode !== 'all' && route.mode !== filters.mode) return false;
    if (filters.status === 'running' && !route.active) return false;
    if (filters.status === 'disconnected' && route.active) return false;
    if (filters.status === 'attention' && !routeNeedsAttention(game, route)) return false;
    if (filters.cargo && filters.cargo !== 'all' && route.cargo !== filters.cargo) return false;
    if (!words.length) return true;
    const search = [route.name, CARGO[route.cargo]?.name, route.cargo, route.mode, route.mode === 'water' ? 'ship ferry boat port' : route.mode === 'rail' ? 'train' : route.mode === 'air' ? 'plane airport flight air' : vehicleNoun(route.mode, route.cargo), ...route.stops.map(id => stops.get(String(id)))].join(' ').toLocaleLowerCase();
    return words.every(word => search.includes(word));
  });
}
