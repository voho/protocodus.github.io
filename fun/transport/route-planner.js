import { findPath, stationCoverage, getVehiclePurchase, passengerEndpoints } from './model.js';
import { CARGO, INDUSTRIES, TOWN_CARGO } from './data.js';

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
