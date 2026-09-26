import { findPath, stationCoverage, getVehiclePurchase, passengerEndpoints } from './model.js';
import { CARGO, INDUSTRIES, TOWN_CARGO } from './data.js';

const pathCache = new WeakMap();

// Match the launch rules without buying a vehicle or changing the world.
export function validateRoutePlan(game, draft) {
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
    if (!passengerEndpoints(game, ...stations)) return fail('Connected. Each stop must serve a different town within 5 tiles.');
  } else {
    const canShip = (a, b) => {
      const producers = a.industries.filter(industry => INDUSTRIES[industry.kind].outputs[cargo]);
      return producers.length > 0 && (b.industries.some(industry => INDUSTRIES[industry.kind].inputs[cargo] && producers.every(producer => producer.id !== industry.id)) || (TOWN_CARGO.includes(cargo) && b.cities.length > 0));
    };
    if (!canShip(coverage[0], coverage[1])) {
      if (canShip(coverage[1], coverage[0])) result.reversed = true;
      else return fail(`Connected. Add a ${CARGO[cargo].name.toLowerCase()} producer and buyer within 5 tiles of the stops.`);
    }
  }
  if (game.money < getVehiclePurchase(game,mode).cost) return fail('Connected. More funds are needed to buy the vehicle.');
  return { ...result, valid: true, message: `${mode === 'water' ? 'Connected by water' : 'Connected'} · ${result.path.length - 1} tiles${result.reversed ? ' · Loads at end stop' : ''}` };
}

export function filterRoutes(game, filters = {}) {
  const words = String(filters.query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const stops = new Map(game.stations.map(stop => [String(stop.id), stop.name]));
  return game.routes.filter(route => {
    if (filters.mode && filters.mode !== 'all' && route.mode !== filters.mode) return false;
    if (filters.status === 'running' && !route.active) return false;
    if (filters.status === 'disconnected' && route.active) return false;
    if (filters.cargo && filters.cargo !== 'all' && route.cargo !== filters.cargo) return false;
    const search = [route.name, CARGO[route.cargo]?.name, route.cargo, route.mode, route.mode === 'water' ? 'ship ferry boat port' : route.mode === 'rail' ? 'train' : route.cargo === 'passengers' ? 'bus' : 'truck', ...route.stops.map(id => stops.get(String(id)))].join(' ').toLocaleLowerCase();
    return words.every(word => search.includes(word));
  });
}
