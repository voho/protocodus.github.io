import { BUILDINGS, residentialKind, commercialKind } from './buildings.js';
import { localEnvironment, randomAt, weatherAt } from './environment.js';

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const tileAt = (game, x, y) => x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y * game.width + x] : null;
const land = biome => biome === 'desert' ? 'sand' : biome === 'tundra' ? 'snow' : 'grass';

function nearestCity(game, point) {
  let nearest = null, best = 10;
  for (const city of game.cities) {
    const separation = distance(city, point);
    if (separation < best) { nearest = city; best = separation; }
  }
  return nearest;
}

function recentlyServed(game, city) {
  return !!city && Number.isFinite(city.lastServiceDay) && game.day - city.lastServiceDay <= 30 &&
    game.stations.some(station => distance(city, station) <= 5 &&
      game.routes.some(route => route.active && route.stops.includes(station.id)));
}

function suitability(game, point, kind, environment, weather, city) {
  const e = environment, positive = [], negative = [];
  const connected = recentlyServed(game, city);
  const neighbors = kind === 'residential' ? e.housing : kind === 'commercial' ? e.housing + e.shops : e.industries;
  const clustering = clamp(neighbors / (kind === 'industrial' ? 3 : 10));
  const climate = clamp(weather.growth, .35, 1.2);
  let score;
  if (kind === 'industrial') {
    score = .30 + .22 * e.access + .13 * e.transport + .14 * clustering + .10 * Number(e.railAccess) + .09 * clamp(e.housing / 12) + .06 * e.moisture;
  } else if (kind === 'commercial') {
    score = .27 + .22 * e.access + .15 * e.transport + .17 * clustering + .12 * e.amenity + .06 * e.nature - .18 * e.pollution;
  } else {
    score = .30 + .20 * e.access + .13 * e.transport + .12 * clustering + .16 * e.amenity + .13 * e.nature - .30 * e.pollution;
  }
  score = clamp(score * (.78 + climate * .22));
  if (!e.roadAccess) score *= .28;
  if (!connected) score *= .4;
  if (e.roadAccess) positive.push('Road access'); else negative.push('Needs a road');
  if (connected) positive.push('Recent deliveries'); else negative.push('Needs deliveries');
  if (e.railAccess && kind === 'industrial') positive.push('Rail access');
  if (clustering > .18) positive.push(kind === 'industrial' ? 'Nearby industry' : kind === 'commercial' ? 'Nearby customers' : 'Neighbors');
  if (e.amenity > .15 && kind !== 'industrial') positive.push('Local services');
  if (e.nature > .2 && kind !== 'industrial') positive.push('Green surroundings');
  if (e.pollution > .18 && kind !== 'industrial') negative.push('Industrial pollution');
  if (weather.cold > .6) negative.push('Cold weather');
  if (weather.heat > .7 && weather.wetness < .3) negative.push('Dry weather');
  return { score: clamp(score), positive, negative };
}

// These are derived from the same neighborhood used by the simulation, so the
// inspector can explain why a plot is growing without adding save-only state.
export function settlementSuitability(game, point, kind = 'residential') {
  return suitability(game, point, kind, localEnvironment(game, point.x, point.y), weatherAt(game, point.x, point.y), nearestCity(game, point));
}

export function housingCapacity(building) {
  if (!building) return 0;
  const residents = BUILDINGS[building.kind]?.residents;
  return residents ? residents * building.level : ['house', 'apartment'].includes(building.kind) ? 15 * building.level : 0;
}

// Each day offers independent update opportunities to individual settlements
// and plots. Buffered building proposals see yesterday's neighbors; a new home
// cannot trigger a chain of same-day development across its entire street.
export function stepSettlements(game) {
  const day = Math.floor(game.day), proposals = [];
  const occupied = new Set([...game.industries, ...game.stations, ...game.cities].map(point => `${point.x},${point.y}`));
  for (const city of game.cities) {
    const environment = localEnvironment(game, city.x, city.y);
    const weather = weatherAt(game, city.x, city.y, day);
    const quality = suitability(game, city, 'residential', environment, weather, city).score;
    const connected = recentlyServed(game, city);
    const arrivals = city.population * (.005 + .006 * clamp(environment.housing / 14) + .003 * environment.amenity + .002 * clamp(environment.shops / 6)) *
      (.55 + randomAt(game, day, city.id, 101) * .95) * (.70 + weather.travel * .3) * (1 - environment.pollution * .22);
    city.passengers = clamp((city.passengers || 0) + arrivals, 0, Math.max(0, city.population * .9));
    const activityLoss = (.013 + randomAt(game, day, city.id, 102) * .020 + environment.pollution * .008) * (1 - environment.amenity * .22);
    city.activity = Math.max(0, (city.activity || 0) * (1 - activityLoss));
    const supplyUse = (.009 + randomAt(game, day, city.id, 103) * .014) * (1 + weather.cold * .25 + environment.housing / 150) * (1 - clamp(environment.shops / 10) * .16);
    city.supplies = Math.max(0, (city.supplies || 0) * (1 - supplyUse));
    const demand = clamp((city.activity + city.supplies * .6) / 65, .4, 1.25);
    city.growth = connected ? clamp((.015 + quality * .055) * demand, 0, .09) : 0;
    if (!connected || city.activity < 8 || randomAt(game, day, city.id, 104) >= (.055 + quality * .14) * demand * weather.growth) continue;

    const radius = 3 + Math.floor(randomAt(game, day, city.id, 105) * 4);
    let best = null;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const x = city.x + dx, y = city.y + dy, tile = tileAt(game, x, y), key = `${x},${y}`;
      // Paid buildings and landmarks are never replaced by organic growth.
      if (!tile || tile.building || tile.zone || tile.road || tile.rail || occupied.has(key) || !['grass', 'sand', 'snow', 'forest'].includes(tile.terrain)) continue;
      const local = localEnvironment(game, x, y, 2);
      if (!local.roadAccess) continue;
      const score = suitability(game, { x, y }, 'residential', local, weather, city).score;
      const rank = score * (.5 + randomAt(game, day, key, 106) * .5);
      if (!best || rank > best.rank) best = { x, y, tile, city, rank, building: { kind: residentialKind(tile.variant, 1), level: 1 } };
    }
    if (best) proposals.push(best);
  }

  for (const zone of game.zones) {
    const tile = tileAt(game, zone.x, zone.y);
    if (!tile || tile.zone !== zone.kind) continue;
    const city = nearestCity(game, zone), environment = localEnvironment(game, zone.x, zone.y);
    const key = `zone:${zone.x},${zone.y}`, occupiedLevel = tile.building?.level || 0;
    if (!recentlyServed(game, city) || !environment.roadAccess) {
      // Vacant development interest fades, but an occupied building is retained.
      if (randomAt(game, day, key, 201) < .18) zone.progress = clamp(zone.progress - (.005 + randomAt(game, day, key, 202) * .01), occupiedLevel, 3);
      continue;
    }
    const weather = weatherAt(game, zone.x, zone.y, day);
    const quality = suitability(game, zone, zone.kind, environment, weather, city).score;
    if (randomAt(game, day, key, 203) >= .25 + quality * .10) continue;
    const demand = clamp((city.activity + city.supplies * .6) / 65, .65, 1.2);
    const increment = (.026 + quality * .026) * (.7 + randomAt(game, day, key, 204) * .6) * weather.growth * demand;
    zone.progress = clamp(zone.progress + increment, occupiedLevel, 3);
    const level = Math.floor(zone.progress);
    if (level <= occupiedLevel) continue;
    const kind = zone.kind === 'residential' ? residentialKind(tile.variant, level) : zone.kind === 'commercial' ? commercialKind(tile.variant, level) : 'factory';
    proposals.push({ x: zone.x, y: zone.y, tile, city, zone, building: { kind, level } });
  }

  let changed = false;
  const claimed = new Set();
  for (const proposal of proposals) {
    const { x, y, tile, city, building, zone } = proposal, key = `${x},${y}`;
    if (claimed.has(key)) continue;
    claimed.add(key);
    const population = Math.max(0, housingCapacity(building) - housingCapacity(tile.building));
    // A later town foundation must not move an existing home's residents to a
    // different town. Explicit null identifies countryside housing, too.
    const populationCityId = Object.hasOwn(tile.building || {}, 'populationCityId') ? tile.building.populationCityId : city.id;
    if (housingCapacity(building) > 0) building.populationCityId = populationCityId;
    const previousLevel = tile.building?.level || 0;
    tile.building = building;
    tile.detail = '';
    if (tile.terrain === 'forest') tile.terrain = land(game.biome);
    const populationCity = game.cities.find(town => town.id === populationCityId);
    if (populationCity) populationCity.population = Math.max(0, populationCity.population + population);
    if (zone?.kind === 'commercial') city.supplies += (building.level - previousLevel) * 8;
    if (zone?.kind === 'industrial') city.activity += (building.level - previousLevel) * 10;
    changed = true;
  }
  if (changed) game.revision++;
}
