import { BUILDINGS, residentialKind, commercialKind } from './buildings.js';
import { localEnvironment, randomAt, weatherAt } from './environment.js';
import { industryTiles } from './industry-sites.js';
import { buildingAt, buildingFootprint, buildingSiteProblem, buildingTiles, placeBuildingSite } from './building-sites.js';
import { nearbyStations } from './simulation-spatial.js';
import { terrainObjectAt } from './terrain-objects.js';
import { networkTerrainProblem } from './terrain-engineering.js';
import { BIOMES, CARGO, INDUSTRIES } from './data.js';
import { townStopCounts, townOpinion, actionActive, TOWN_ACTIONS } from './town-authority.js';

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const tileAt = (game, x, y) => x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y * game.width + x] : null;
const developmentKind = (kind, variant, level) => kind === 'residential' ? residentialKind(variant, level) : kind === 'commercial' ? commercialKind(variant, level) : 'factory';
const GROUND = ['grass', 'sand', 'snow', 'forest'], STREET_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// A zone may still grow into a 2 × 2 building over the tiles right of and below it.
const zoneRoom = (game, x, y) => !!(tileAt(game, x - 1, y)?.zone || tileAt(game, x, y - 1)?.zone || tileAt(game, x - 1, y - 1)?.zone);
// Paid buildings, landmarks and zoned land are never taken by organic growth.
const openLot = (game, x, y, occupied, tile = tileAt(game, x, y)) => !!tile && !buildingAt(game, x, y) && !tile.zone && !tile.road && !tile.rail && !occupied.has(`${x},${y}`) && GROUND.includes(tile.terrain) && !zoneRoom(game, x, y);
const houseLot = (game, x, y, occupied) => openLot(game, x, y, occupied) && !buildingSiteProblem(game, residentialKind(tileAt(game, x, y).variant, 1), x, y);
const roadBeside = (game, x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tileAt(game, x + dx, y + dy)?.road) return true; return false; };
// Larger towns reach a little further for new homes: 3-6 tiles, plus up to 3.
const reachBonus = city => Math.min(3, Math.floor(Math.sqrt(city.population / 400)));

function nearestCity(game, point) {
  let nearest = null, best = 10;
  for (const city of game.cities) {
    const separation = distance(city, point);
    if (separation < best) { nearest = city; best = separation; }
  }
  return nearest;
}

export function activeCities(game) {
  return new Set(townStopCounts(game).keys());
}
function recentlyServed(game, city, connectedCities) {
  return !!city && Number.isFinite(city.lastServiceDay) && game.day - city.lastServiceDay <= 30 && (connectedCities||activeCities(game)).has(city);
}

// Town needs only speed development up: an unmet need slows the next tier and
// never stops it. Only cargo the biome can make is listed.
const NEEDS = [
  { tier: 2, kind: 'residential', label: 'Comfortable homes', cargo: ['food'] },
  { tier: 3, kind: 'residential', label: 'Prestige homes', cargo: ['goods', 'furniture', 'machinery'] },
  { tier: 2, kind: 'commercial', label: 'Services', cargo: ['goods', 'fuel'] },
  { tier: null, kind: 'construction', label: 'Construction', cargo: ['stone', 'cement'] },
];
const BIOME_NEEDS = Object.fromEntries(Object.keys(BIOMES).map(biome => [biome, NEEDS.map(need => ({ ...need, cargo: need.cargo.filter(key => Object.values(INDUSTRIES).some(site => site.biomes.includes(biome) && site.outputs[key])) }))]));
export const NEED_WINDOW = 120;
export function townNeeds(game, city) {
  const supplied = cargo => Number.isFinite(city?.lastSupply?.[cargo]) && game.day - city.lastSupply[cargo] <= NEED_WINDOW;
  return BIOME_NEEDS[game.biome].map(need => ({ ...need, cargo: [...need.cargo], met: need.cargo.some(supplied) }));
}
const nextNeed = (needs, zone) => needs.find(need => need.kind === zone.kind && need.tier === Math.floor(zone.progress) + 1);
const needText = need => `Faster with ${need.cargo.map(key => CARGO[key].name.toLowerCase()).join(' or ')} deliveries`;

function suitability(game, point, kind, environment, weather, city, connectedCities) {
  const e = environment, positive = [], negative = [];
  const connected = recentlyServed(game, city, connectedCities);
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
  const result = suitability(game, point, kind, localEnvironment(game, point.x, point.y), weatherAt(game, point.x, point.y), nearestCity(game, point));
  const tile = tileAt(game, point.x, point.y), zone = game.zones.find(z => z.x === point.x && z.y === point.y);
  const level = Math.floor(zone?.progress || 0);
  if (zone && level > (tile?.building?.level || 0)) {
    const next = developmentKind(zone.kind, tile.variant, level), size = buildingFootprint(next), exclude = buildingAt(game, point.x, point.y);
    const mixed = buildingTiles({ ...point, building: { footprint: size } }).some(p => { const t = tileAt(game, p.x, p.y); return t?.zone && t.zone !== zone.kind; });
    if (mixed || buildingSiteProblem(game, next, point.x, point.y, size, { exclude, allowZone: true })) result.negative.push(`Needs ${size} × ${size} clear tiles`);
  }
  const city = zone && nearestCity(game, point), need = city && nextNeed(townNeeds(game, city), zone);
  result.notes = need && !need.met ? [needText(need)] : [];
  return result;
}

export function housingCapacity(building) {
  if (!building) return 0;
  const residents = BUILDINGS[building.kind]?.residents;
  return residents ? residents * building.level : ['house', 'apartment'].includes(building.kind) ? 15 * building.level : 0;
}

// New passengers a town sends to its stops in one day. The route forecast
// passes the mean draw, .5, instead of the day's seeded sample.
export function passengerArrivals(game, city, day = Math.floor(game.day), environment = localEnvironment(game, city.x, city.y), weather = weatherAt(game, city.x, city.y, day), draw = randomAt(game, day, city.id, 101)) {
  return city.population * (.005 + .006 * clamp(environment.housing / 14) + .003 * environment.amenity + .002 * clamp(environment.shops / 6)) *
    (.55 + draw * .95) * (.70 + weather.travel * .3) * (1 - environment.pollution * .22) * (actionActive(city.advertisedUntil, day) ? TOWN_ACTIONS.advertise.passengers : 1);
}

const occupiedSites = game => new Set([...game.industries.flatMap(industryTiles), ...game.stations, ...game.cities].map(point => `${point.x},${point.y}`));
// Road-side lots organic growth could still take; a limit stops the count early.
function townLots(game, city, reach, occupied, limit = Infinity) {
  let lots = 0;
  for (let y = city.y - reach; y <= city.y + reach; y++) for (let x = city.x - reach; x <= city.x + reach; x++) if (roadBeside(game, x, y) && houseLot(game, x, y, occupied) && ++lots >= limit) return lots;
  return lots;
}
const monthStart = month => (Date.UTC(1950, month, 1) - Date.UTC(1950, 0, 1)) / 864e5;
// Residents gained since the oldest of the last four monthly counts, taken on
// the first day of each month (model.js monthlyUpdate).
export function townGrowth(game, city) {
  const counts = city.popHistory;
  return counts?.length ? { change: Math.floor(city.population) - counts[0], days: Math.floor(game.day) - monthStart(game.lastMonth - counts.length + 1) } : null;
}
// The inspector's outlook: recent growth and the lots left within the reach
// that decides when a town lays a street. Counted once per day and revision.
const outlooks = new WeakMap();
export function townOutlook(game, city) {
  const day = Math.floor(game.day);
  let cache = outlooks.get(game);
  if (cache?.day !== day || cache.revision !== game.revision) outlooks.set(game, cache = { day, revision: game.revision, cities: new Map() });
  if (!cache.cities.has(city.id)) {
    const reach = 6 + reachBonus(city), recent = townGrowth(game, city);
    cache.cities.set(city.id, { plots: townLots(game, city, reach, occupiedSites(game)), reach, growth: city.growth, change: recent?.change ?? null, days: recent?.days ?? null });
  }
  return cache.cities.get(city.id);
}
// Towns keep clear of the player's stations, ports, rails and zones, and of
// the stroke the player is drawing.
function streetTile(game, x, y, occupied, blocked) {
  const tile = tileAt(game, x, y);
  if (!tile || !GROUND.includes(tile.terrain) || tile.road || tile.rail || tile.bridge || tile.tunnel || tile.structureAxis || tile.zone || zoneRoom(game, x, y) || blocked.has(`${x},${y}`) || occupied.has(`${x},${y}`) || buildingAt(game, x, y) || terrainObjectAt(game, x, y)) return false;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (tileAt(game, x + dx, y + dy)?.rail) return false;
  return !nearbyStations(game, x, y, 2).some(station => Math.abs(station.x - x) <= 2 && Math.abs(station.y - y) <= 2);
}
// A town out of lots extends one road 2-3 tiles straight on or aside, never
// back toward its center, where it opens the most new lots within its reach.
function townStreet(game, city, day, reach, occupied, blocked) {
  let best = null;
  for (let dy = -reach - 2; dy <= reach + 2; dy++) for (let dx = -reach - 2; dx <= reach + 2; dx++) {
    const ox = city.x + dx, oy = city.y + dy, origin = tileAt(game, ox, oy);
    if (!origin?.road || origin.bridge || origin.tunnel || origin.structureAxis) continue;
    for (const [sx, sy] of STREET_DIRECTIONS) {
      if (sx * dx + sy * dy < 0) continue;
      const points = [], planned = new Set();
      for (let n = 1; n <= 3; n++) {
        const x = ox + sx * n, y = oy + sy * n, index = y * game.width + x;
        // A road alongside would only double an existing street.
        if (!streetTile(game, x, y, occupied, blocked) || tileAt(game, x + sy, y + sx)?.road || tileAt(game, x - sy, y - sx)?.road) break;
        planned.add(index);
        if (networkTerrainProblem(game, x, y, 'road', { axis: sx ? 'x' : 'y', proposed: planned })) { planned.delete(index); break; }
        points.push({ x, y });
      }
      if (points.length < 2) continue;
      const lots = new Set();
      for (const p of points) for (let y = p.y - 1; y <= p.y + 1; y++) for (let x = p.x - 1; x <= p.x + 1; x++) {
        const index = y * game.width + x;
        if (!planned.has(index) && !blocked.has(`${x},${y}`) && Math.max(Math.abs(x - city.x), Math.abs(y - city.y)) <= reach && houseLot(game, x, y, occupied)) lots.add(index);
      }
      if (!lots.size) continue;
      const rank = lots.size * (.5 + randomAt(game, day, `${ox},${oy},${sx},${sy}`, 108) * .5);
      if (!best || rank > best.rank) best = { points, rank };
    }
  }
  return best?.points || null;
}

// Each day offers independent update opportunities to individual settlements
// and plots. Buffered building proposals see yesterday's neighbors; a new home
// cannot trigger a chain of same-day development across its entire street.
// Streets are handed to extendStreets (model.js) once per day, before any
// building commits, and at most four towns lay one each day.
export function stepSettlements(game, { extendStreets = null, reserved = [] } = {}) {
  const day = Math.floor(game.day), proposals = [], streets = [], stopCounts = townStopCounts(game), connectedCities = new Set(stopCounts.keys());
  let blocked = null;
  const occupied = occupiedSites(game);
  for (const city of game.cities) {
    const environment = localEnvironment(game, city.x, city.y);
    const weather = weatherAt(game, city.x, city.y, day);
    const quality = suitability(game, city, 'residential', environment, weather, city, connectedCities).score;
    const connected = recentlyServed(game, city, connectedCities);
    const arrivals = passengerArrivals(game, city, day, environment, weather);
    city.passengers = clamp((city.passengers || 0) + arrivals, 0, Math.max(0, city.population * .9));
    const activityLoss = (.013 + randomAt(game, day, city.id, 102) * .020 + environment.pollution * .008) * (1 - environment.amenity * .22);
    city.activity = Math.max(0, (city.activity || 0) * (1 - activityLoss));
    const supplyUse = (.009 + randomAt(game, day, city.id, 103) * .014) * (1 + weather.cold * .25 + environment.housing / 150) * (1 - clamp(environment.shops / 10) * .16);
    city.supplies = Math.max(0, (city.supplies || 0) * (1 - supplyUse));
    const demand = clamp((city.activity + city.supplies * .6) / 65, .4, 1.25);
    city.growth = connected ? clamp((.015 + quality * .055) * demand, 0, .09) : 0;
    // Funded towns build without service; opinion only speeds Excellent and Outstanding towns up.
    const funded = actionActive(city.fundedUntil, day);
    if (!funded && (!connected || city.activity < 8)) continue;
    const growthFactor = townOpinion(game, city, stopCounts).growth, pull = funded ? Math.max(1, demand) : demand;
    if (randomAt(game, day, city.id, 104) >= (.055 + quality * .14) * pull * weather.growth * growthFactor * (funded ? TOWN_ACTIONS.fund.growth : 1)) continue;

    const bonus = reachBonus(city), radius = 3 + Math.floor(randomAt(game, day, city.id, 105) * 4) + bonus;
    let best = null;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const x = city.x + dx, y = city.y + dy, tile = tileAt(game, x, y), key = `${x},${y}`;
      if (!openLot(game, x, y, occupied, tile)) continue;
      const local = localEnvironment(game, x, y, 2);
      if (!local.roadAccess) continue;
      const score = suitability(game, { x, y }, 'residential', local, weather, city, connectedCities).score;
      const rank = score * (.5 + randomAt(game, day, key, 106) * .5);
      const kind = residentialKind(tile.variant, 1);
      if (buildingSiteProblem(game, kind, x, y)) continue;
      if (!best || rank > best.rank) best = { x, y, tile, city, rank, building: { kind, level: 1 } };
    }
    if (best) proposals.push(best);
    else if (extendStreets && streets.length < 4 && pull >= 1 && day - (city.lastStreetDay ?? -Infinity) >= 30 && randomAt(game, day, city.id, 107) < .08 * pull * weather.growth * growthFactor && !townLots(game, city, 6 + bonus, occupied, 1)) {
      blocked ??= new Set(reserved.map(point => `${point.x},${point.y}`));
      const street = townStreet(game, city, day, 6 + bonus, occupied, blocked);
      if (street) { streets.push(street); city.lastStreetDay = day; for (const point of street) blocked.add(`${point.x},${point.y}`); }
    }
  }
  if (streets.length) extendStreets(streets.flat());

  for (const zone of game.zones) {
    const tile = tileAt(game, zone.x, zone.y);
    if (!tile || tile.zone !== zone.kind) continue;
    const existing = buildingAt(game, zone.x, zone.y);
    if (existing && (existing.x !== zone.x || existing.y !== zone.y)) continue;
    const city = nearestCity(game, zone), environment = localEnvironment(game, zone.x, zone.y);
    const key = `zone:${zone.x},${zone.y}`, occupiedLevel = tile.building?.level || 0;
    if (!recentlyServed(game, city, connectedCities) || !environment.roadAccess) {
      // Vacant development interest fades, but an occupied building is retained.
      if (randomAt(game, day, key, 201) < .18) zone.progress = clamp(zone.progress - (.005 + randomAt(game, day, key, 202) * .01), occupiedLevel, 3);
      continue;
    }
    const weather = weatherAt(game, zone.x, zone.y, day);
    const quality = suitability(game, zone, zone.kind, environment, weather, city, connectedCities).score;
    if (randomAt(game, day, key, 203) >= .25 + quality * .10) continue;
    const demand = clamp((city.activity + city.supplies * .6) / 65, .65, 1.2);
    const needs = townNeeds(game, city), need = nextNeed(needs, zone);
    const increment = (.026 + quality * .026) * (.7 + randomAt(game, day, key, 204) * .6) * weather.growth * demand * (need && !need.met ? .25 : 1) * (needs.some(n => n.kind === 'construction' && n.met) ? 1.3 : 1);
    zone.progress = clamp(zone.progress + increment, occupiedLevel, 3);
    const level = Math.floor(zone.progress);
    if (level <= occupiedLevel) continue;
    const kind = developmentKind(zone.kind, tile.variant, level);
    proposals.push({ x: zone.x, y: zone.y, tile, city, zone, building: { kind, level } });
  }

  let changed = false;
  const claimed = new Set();
  for (const proposal of proposals) {
    const { x, y, tile, city, building, zone } = proposal;
    const size = buildingFootprint(building.kind), points = buildingTiles({ x, y, building: { footprint: size } });
    // Several plots can propose growth on the same day. Validate and reserve
    // the entire square before committing any building, population or goods.
    if (points.some(p => claimed.has(`${p.x},${p.y}`))) continue;
    if (zone && points.some(p => { const t = tileAt(game, p.x, p.y); return t?.zone && t.zone !== zone.kind; })) continue;
    const existing = buildingAt(game, x, y);
    if (existing && (existing.x !== x || existing.y !== y)) continue;
    if (buildingSiteProblem(game, building.kind, x, y, size, { exclude: existing, allowZone: Boolean(zone) })) continue;
    const population = Math.max(0, housingCapacity(building) - housingCapacity(tile.building));
    // A later town foundation must not move an existing home's residents to a
    // different town. Explicit null identifies countryside housing, too.
    const populationCityId = Object.hasOwn(tile.building || {}, 'populationCityId') ? tile.building.populationCityId : city.id;
    if (housingCapacity(building) > 0) building.populationCityId = populationCityId;
    const previousLevel = tile.building?.level || 0;
    if (!placeBuildingSite(game, building.kind, x, y, { size, building, exclude: existing, allowZone: Boolean(zone) })) continue;
    for (const p of points) claimed.add(`${p.x},${p.y}`);
    const populationCity = game.cities.find(town => town.id === populationCityId);
    if (populationCity) populationCity.population = Math.max(0, populationCity.population + population);
    if (zone?.kind === 'commercial') city.supplies += (building.level - previousLevel) * 8;
    if (zone?.kind === 'industrial') city.activity += (building.level - previousLevel) * 10;
    changed = true;
  }
  if (changed) game.revision++;
}
