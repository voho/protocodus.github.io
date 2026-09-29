import { BUILDINGS } from './buildings.js';
import { seedNumber } from './world.js';
import { BIOME_NATURE, isPlantDetail } from './terrain-sprites.js';
import { industryTiles, industryDistance } from './industry-sites.js';
import { buildingSize } from './building-sites.js';
import { releaseTerrainObjectsCells } from './terrain-objects.js';
import { noteSurfaceChanges } from './change-journal.js';
import { stationTiles } from './station-sites.js';

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const NEIGHBORS = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
const indexCache = new WeakMap();
const seedCache = new WeakMap();
const weatherCache = new WeakMap();
const WEATHER_SAMPLE_LIMIT = 16384;
const emissions = { 'coal-mine': 1.2, 'iron-mine': .8, 'copper-mine': .8, 'oil-well': .9, refinery: 1.5, 'steel-mill': 1.5, 'cement-works': 1.2, quarry: .9, 'sand-pit': .6, 'logging-camp': .3, farm: .15, fishery: .1 };

function numericSeed(game) {
  let cached = seedCache.get(game);
  if (!cached || cached.seed !== game.seed) {
    cached = { seed: game.seed, value: seedNumber(game.seed ?? 0) };
    seedCache.set(game, cached);
  }
  return cached.value;
}

// Each decision owns a seed/day/cell/channel key. No random cursor is saved or
// consumed: simulation speed, camera activity and save/load cannot reorder it.
export function randomAt(game, day, key, salt = 0) {
  let value = numericSeed(game) ^ seedNumber(key) ^ Math.imul(Math.floor(day), 0x9e3779b1) ^ Math.imul(seedNumber(salt), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function tileAt(game, x, y) {
  return x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y * game.width + x] : null;
}

// Every survey shares one pooled window, cleared only once a site covers it.
// A caller finishes reading one window before requesting the next; none nest
// today, and a nested caller would need a window of its own.
const windowSites = [];
const buildingWindow = { left: 0, top: 0, width: 0, height: 0, any: false,
  at(x, y) { return this.any && x >= this.left && y >= this.top && x - this.left < this.width && y - this.top < this.height ? windowSites[(y - this.top) * this.width + x - this.left] : undefined; } };

// A bounded anchor scan resolves an entire neighborhood once, instead of
// repeating nine backwards lookups for every covered cell. It never scans the
// full map or stores occupancy in saved child tiles.
function neighborhoodBuildings(game, left, top, right, bottom) {
  const view = buildingWindow, width = right - left + 1, height = bottom - top + 1;
  view.left = left; view.top = top; view.width = width; view.height = height; view.any = false;
  for (let y = Math.max(0, top - 2); y <= Math.min(game.height - 1, bottom); y++) {
    for (let x = Math.max(0, left - 2); x <= Math.min(game.width - 1, right); x++) {
      const building = game.tiles[y * game.width + x]?.building;
      if (!building) continue;
      const size = buildingSize(building), site = { x, y, building };
      for (let py = Math.max(top, y); py <= Math.min(bottom, y + size - 1); py++) {
        for (let px = Math.max(left, x); px <= Math.min(right, x + size - 1); px++) {
          if (!view.any) { view.any = true; while (windowSites.length < width * height) windowSites.push(undefined); windowSites.fill(undefined, 0, width * height); }
          windowSites[(py - top) * width + px - left] = site;
        }
      }
    }
  }
  return view;
}

function entityIndex(game) {
  const day = Math.floor(game.day || 0);
  let cache = indexCache.get(game);
  if (cache && cache.day === day && cache.revision === game.revision && cache.industries === game.industries && cache.stations === game.stations && cache.routes === game.routes && cache.cities === game.cities && cache.zones === game.zones) return cache;
  const occupied = new Set(), industriesAt = new Map(), activeStations = new Map();
  for (const industry of game.industries || []) {
    for(const point of industryTiles(industry)) {
      const key = point.y * game.width + point.x;
      occupied.add(key); industriesAt.set(key, industry);
    }
  }
  for (const item of [...(game.stations || []).flatMap(stationTiles), ...(game.cities || []), ...(game.zones || [])]) occupied.add(item.y * game.width + item.x);
  const activeIds = new Set((game.routes || []).filter(route => route.active).flatMap(route => route.stops));
  // An airport gives factories no transport access.
  for (const station of game.stations || []) if (activeIds.has(station.id) && station.mode !== 'air') {
    const key = `${Math.floor(station.x / 8)},${Math.floor(station.y / 8)}`;
    if (!activeStations.has(key)) activeStations.set(key, []);
    activeStations.get(key).push(station);
  }
  cache = { day, revision: game.revision, industries: game.industries, stations: game.stations, routes: game.routes, cities: game.cities, zones: game.zones, occupied, industriesAt, activeStations };
  indexCache.set(game, cache);
  return cache;
}

// Lattice samples cache under a numeric id, below 2^30 while |xx| and |yy| stay
// under 4096; the seeded string key is only built for a missing sample.
function weatherSample(game, cache, xx, yy) {
  const id = (xx + 4096) * 16384 + (yy + 4096);
  let values = cache.samples.get(id);
  if (!values) {
    const key = `weather:${xx},${yy}`;
    values = [randomAt(game, cache.front, key, 11), randomAt(game, cache.front + 1, key, 11)];
    // A complete 2048² world's weather lattice fits; unusual callers remain
    // bounded too. Only immutable seeded front values are retained.
    if (cache.samples.size >= WEATHER_SAMPLE_LIMIT) cache.samples.delete(cache.samples.keys().next().value);
    cache.samples.set(id, values);
  }
  return values[0] * (1 - cache.eased) + values[1] * cache.eased;
}

// Weather fronts cross 24-tile cells and evolve over twelve days. Seasonal
// daylight, elevation and biome keep oases, highlands and lowlands distinct.
export function weatherAt(game, x, y, day = game.day || 0) {
  const wholeDay = Math.floor(day), front = Math.floor(wholeDay / 12), progress = (wholeDay % 12) / 12;
  let cache = weatherCache.get(game);
  if (!cache || cache.seed !== game.seed || cache.front !== front) {
    cache = { seed: game.seed, front, day: null, samples: new Map() };
    weatherCache.set(game, cache);
  }
  if (cache.day !== wholeDay) {
    cache.day = wholeDay;
    cache.eased = progress * progress * (3 - 2 * progress);
    cache.summer = Math.sin((wholeDay - 30) / 360 * Math.PI * 2);
  }
  const gx = Math.floor(x / 24), gy = Math.floor(y / 24), fx = x / 24 - gx, fy = y / 24 - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const north = weatherSample(game, cache, gx, gy) * (1 - sx) + weatherSample(game, cache, gx + 1, gy) * sx;
  const south = weatherSample(game, cache, gx, gy + 1) * (1 - sx) + weatherSample(game, cache, gx + 1, gy + 1) * sx;
  const rain = north * (1 - sy) + south * sy;
  const summer = cache.summer;
  const elevation = tileAt(game, Math.floor(x), Math.floor(y))?.elevation || 0;
  const desert = game.biome === 'desert', tundra = game.biome === 'tundra';
  const wetness = clamp((desert ? .1 : tundra ? .39 : .52) + (rain - .5) * .48 - summer * .07 + elevation * .08);
  const cold = clamp((tundra ? .66 : desert ? .08 : .33) - summer * (tundra ? .24 : .28) + elevation * .26);
  const heat = clamp((desert ? .69 : tundra ? .13 : .34) + summer * .22 - elevation * .24 + (.5 - rain) * .1);
  const growth = clamp(1.18 - cold * .61 - Math.max(0, heat - .55) * .8 - Math.max(0, .25 - wetness) * .48, .4, 1.2);
  const travel = clamp(1.08 - cold * .23 - wetness * .14 - Math.max(0, heat - .72) * .3, .65, 1.1);
  return { wetness, cold, heat, growth, travel };
}

export function localTransport(game, x, y, footprint = 1, served = null) {
  const extra = footprint - 1, entities = entityIndex(game);
  let transport = 0;
  for (let by = Math.floor((y - 5) / 8); by <= Math.floor((y + extra + 5) / 8); by++) for (let bx = Math.floor((x - 5) / 8); bx <= Math.floor((x + extra + 5) / 8); bx++) {
    for (const station of entities.activeStations.get(`${bx},${by}`) || []) {
      const distance = industryDistance({x,y,footprint},station);
      if (distance <= 5) transport = Math.max(transport, 1 - distance * .08);
    }
  }
  // A forecast counts the stop it plans to serve from as active.
  const distance = served ? industryDistance({x,y,footprint},served) : Infinity;
  return distance <= 5 ? Math.max(transport, 1 - distance * .08) : transport;
}

// localEnvironment's roadAccess for a one-tile site: a road in the 3 × 3 ring around it.
export function hasRoadAccess(game, x, y) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tileAt(game, x + dx, y + dy)?.road) return true;
  return false;
}

export function localEnvironment(game, x, y, radius = 3, footprint = 1, served = null) {
  x = Math.floor(x); y = Math.floor(y); radius = Number.isFinite(radius) ? Math.max(1, Math.min(8, Math.floor(radius))) : 3;
  footprint=Number.isInteger(footprint)?Math.max(1,Math.min(3,footprint)):1;const extra=footprint-1;
  const entities = entityIndex(game);
  const buildings = neighborhoodBuildings(game, x - radius, y - radius, x + radius + extra, y + radius + extra);
  const env = { roads: 0, rails: 0, water: 0, forest: 0, rocks: 0, buildings: 0, housing: 0, shops: 0, services: 0, civic: 0, industries: 0, school: 0, hospital: 0, police: 0, fire: 0, leisure: 0, roadAccess: false, railAccess: false, nature: 0, moisture: 0, amenity: 0, pollution: 0, access: 0, transport: 0, elevation: 0 };
  let cells = 0, vegetation = 0, disturbance = 0, amenity = 0;
  const seenBuildings = new Set(), seenIndustries = new Set();
  // Access has fixed catchments even when a caller requests a smaller sample.
  for (let dy = -Math.max(radius, 2); dy <= Math.max(radius, 2)+extra; dy++) for (let dx = -Math.max(radius, 2); dx <= Math.max(radius, 2)+extra; dx++) {
    const tile = tileAt(game, x + dx, y + dy);
    if (!tile) continue;
    if (dx>=-1&&dx<=1+extra&&dy>=-1&&dy<=1+extra&&tile.road) env.roadAccess = true;
    if (dx>=-2&&dx<=2+extra&&dy>=-2&&dy<=2+extra&&tile.rail) env.railAccess = true;
    if(dx < -radius || dx > radius+extra || dy < -radius || dy > radius+extra)continue;
    cells++; env.elevation += tile.elevation || 0;
    if (tile.road) env.roads++;
    if (tile.rail) env.rails++;
    if (tile.terrain === 'water') env.water++;
    if (tile.terrain === 'forest') env.forest++;
    if (tile.terrain === 'rock' || tile.terrain === 'mountain') env.rocks++;
    const site = buildings.at(x + dx, y + dy), key = site && site.y * game.width + site.x;
    if (!tile.road && !tile.rail && !site) vegetation += tile.terrain === 'forest' ? 1 : tile.terrain === 'water' ? .7 : isPlantDetail(tile.detail) ? .7 : tile.terrain === 'grass' ? .4 : .12;
    const kind = site?.building.kind, group = BUILDINGS[kind]?.group;
    if (kind && !seenBuildings.has(key)) {
      seenBuildings.add(key);
      env.buildings++;
      if (group === 'homes' || kind === 'house' || kind === 'apartment') env.housing++;
      else if (group === 'shops' || kind === 'shop') { env.shops++; amenity += .8; }
      else if (group === 'services' || kind === 'office') { env.services++; amenity += 1; }
      else if (group === 'community') {
        env.civic++; amenity += 1.6;
        if (kind === 'school') { env.school++; amenity += .5; }
        else if (kind === 'hospital') { env.hospital++; amenity += .7; }
        else if (kind === 'police-station') env.police++;
        else if (kind === 'fire-station') env.fire++;
        else env.leisure++;
      } else if (kind === 'factory') { env.industries++; disturbance += .7; }
    }
    const industry = entities.industriesAt.get((y + dy) * game.width + x + dx);
    if (industry && !seenIndustries.has(industry)) { seenIndustries.add(industry); env.industries++; disturbance += emissions[industry.kind] ?? .65; }
  }
  env.transport = localTransport(game, x, y, footprint, served);
  env.elevation /= Math.max(1, cells);
  env.nature = clamp(vegetation / Math.max(1, cells));
  const weather = weatherAt(game, x, y);
  env.moisture = clamp(weather.wetness * .7 + Math.min(.45, env.water / Math.max(1, cells) * 2.2) + env.forest / Math.max(1, cells) * .16 - env.elevation * .08);
  env.pollution = clamp(disturbance / 5 + env.roads / Math.max(1, cells) * .16 + env.buildings / Math.max(1, cells) * .08 - env.forest / Math.max(1, cells) * .16);
  env.amenity = clamp(amenity / 9 + env.nature * .12);
  env.access = clamp(Number(env.roadAccess) * .35 + Number(env.railAccess) * .18 + env.roads / Math.max(1, cells) * .7 + env.rails / Math.max(1, cells) * .5 + env.transport * .2);
  return env;
}

const eligible = (tile, index, entities) => tile && !tile.road && !tile.rail && !tile.bridge && !tile.tunnel && !tile.publicRoad && !tile.building && !tile.zone && !entities.occupied.has(index) && (tile.terrain === 'grass' || tile.terrain === 'sand' || tile.terrain === 'snow' || tile.terrain === 'forest');
function coprimeStride(length) {
  let stride = Math.min(65537, Math.max(1, length - 1));
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  while (gcd(stride, length) !== 1) stride--;
  return stride;
}

// A sparse asynchronous Moore-neighborhood automaton: one 128th of the land
// receives a chance each day, capped at 4,096 cells on continental worlds.
// Proposals commit together; growing trees never cascade within the same day.
export function stepEcology(game) {
  const length = game.tiles.length;
  if (!length) return 0;
  const day = Math.floor(game.day || 0), budget = Math.min(4096, Math.ceil(length / 128));
  const entities = entityIndex(game), proposals = [];
  const start = Math.floor(randomAt(game, day, 'ecology-sample', 1) * length), stride = coprimeStride(length);
  const desert = game.biome === 'desert', tundra = game.biome === 'tundra';
  const species = (BIOME_NATURE[game.biome] || BIOME_NATURE.taiga).trees.filter(detail => detail !== 'deadwood');
  for (let n = 0; n < budget; n++) {
    const index = (start + n * stride) % length, tile = game.tiles[index];
    if (!eligible(tile, index, entities)) continue;
    const x = index % game.width, y = Math.floor(index / game.width);
    const buildings = neighborhoodBuildings(game, x - 1, y - 1, x + 1, y + 1);
    if (buildings.at(x, y)) continue;
    let forests = 0, water = 0, wetGround = 0, pressure = 0;
    const nearbySpecies = [];
    for (const [dx, dy] of NEIGHBORS) {
      const near = tileAt(game, x + dx, y + dy);
      if (!near) continue;
      if (near.terrain === 'forest' && near.detail !== 'deadwood') { forests++; if (species.includes(near.detail)) nearbySpecies.push(near.detail); }
      if (near.terrain === 'water') water++;
      if (near.detail === 'marsh' || near.detail === 'reeds' || near.detail === 'cotton-grass') wetGround++;
      const nearBuilding = buildings.at(x + dx, y + dy)?.building;
      if (near.road || near.rail || nearBuilding) pressure += nearBuilding?.kind === 'factory' ? .22 : .07;
      const industry = entities.industriesAt.get((y + dy) * game.width + x + dx);
      if (industry) pressure += (emissions[industry.kind] ?? .65) * .3;
    }
    const weather = weatherAt(game, x, y, day);
    const moisture = clamp(weather.wetness * .7 + Math.min(.65, water * .22 + wetGround * .06) + forests * .012 - tile.elevation * .09);
    const disturbance = clamp(pressure), roll = randomAt(game, day, index, 21);
    const choose = (choices, salt = 22) => choices[Math.floor(randomAt(game, day, index, salt) * choices.length)];
    const recruit = () => choose(nearbySpecies.length && randomAt(game, day, index, 24) < .65 ? nearbySpecies : species);
    let terrain = tile.terrain, detail = tile.detail || '';
    if (terrain === 'forest') {
      const stress = clamp(disturbance * .58 + Math.max(0, (desert ? .28 : .18) - moisture) * .7 + Math.max(0, weather.cold - .83) * .3);
      if (detail === 'deadwood') {
        if (roll < .12 + stress * .16) { terrain = desert ? 'sand' : tundra ? 'snow' : 'grass'; detail = desert ? 'scrub' : 'shrubs'; }
        else if (roll > .76 && moisture > .25 && forests > 0 && disturbance < .25) detail = recruit();
      } else if (roll < .018 + stress * .25) detail = 'deadwood';
      else if (!species.includes(detail) && roll > .5 && moisture > .25 && disturbance < .2) detail = recruit();
      else if (forests >= 3 && moisture > .4 && disturbance < .15 && roll > .96) detail = recruit();
    } else {
      const suitable = moisture > (desert ? .34 : tundra ? .2 : .18) && tile.elevation < (tundra ? .5 : .6) && disturbance < .5;
      const spread = clamp((.055 + forests * .055) * weather.growth * (1 - disturbance) * (desert ? .7 : 1), 0, .4);
      if (forests > 0 && suitable && roll < spread) { terrain = 'forest'; detail = recruit(); }
      else if (roll > .58 && roll < .83 && disturbance < .45) {
        if (water && moisture > .4) { detail = choose(desert ? ['reeds','desert-flowers'] : tundra ? ['reeds','marsh','cotton-grass','willow-scrub'] : ['reeds','marsh','ferns'],23); if (desert) terrain = 'grass'; }
        else if (desert) detail = moisture < .12 ? choose(['dunes','scrub','dry-grass']) : moisture > .25 ? choose(['scrub','desert-flowers','aloe','dry-grass']) : choose(['cactus','agave','prickly-pear','aloe']);
        else if (tundra) detail = weather.cold > .73 ? choose(['snow','lichen','willow-scrub']) : moisture > .42 ? choose(['marsh','cotton-grass','arctic-poppies']) : choose(['heather','tundra-grass','lichen','shrubs']);
        else detail = moisture > .4 && weather.growth > .75 ? choose(['wildflowers','bluebells','ferns','berry-bushes']) : choose(['heather','grass-tufts','shrubs']);
      } else if (disturbance > .35 && roll < disturbance * .25) detail = desert ? 'scrub' : 'shrubs';
    }
    if (terrain !== tile.terrain || detail !== (tile.detail || '')) proposals.push({ index, terrain, detail });
  }
  // A changing constituent returns the shared grove/outcrop to its unchanged
  // single-tile fallbacks before the succession proposal takes effect.
  const released = proposals.length ? releaseTerrainObjectsCells(game, proposals.map(p => ({ x: p.index % game.width, y: Math.floor(p.index / game.width) }))) : [];
  for (const proposal of proposals) {
    const tile = game.tiles[proposal.index];
    tile.terrain = proposal.terrain; tile.detail = proposal.detail;
  }
  // Views patch only these cells; heights, water and structures never change.
  if (proposals.length) { const from = game.revision || 0; game.revision = from + 1; noteSurfaceChanges(game, from, game.revision, [...proposals.map(p => p.index), ...released]); }
  return proposals.length;
}
