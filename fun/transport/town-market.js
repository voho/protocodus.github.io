import { BUILDINGS, commercialKind } from './buildings.js';
import { nearbyCities, nearbyZones } from './simulation-spatial.js';
import { localEnvironment, hasRoadAccess } from './environment.js';
import { TOWN_RADIUS, townStopCounts } from './town-authority.js';
import { WORKSHOP, WORKSHOP_RECIPES } from './data.js';

// A town's market, DOM-free. Each month close reviews three demand bars (homes, shops, workshops)
// and next month's shop wants. Demand only ever speeds growth up, and wanted cargo earns a bonus on
// top of the full fare: towns keep taking every delivery. Markets change only at a month close and
// inside chronological vehicle arrivals; the interface and forecasts read marketView, which never writes.
export { TOWN_RADIUS };
const freeze = object => { for (const value of Object.values(object)) if (value && typeof value === 'object') freeze(value); return Object.freeze(object); };
export const MARKET = freeze({ perResident: { food: .10, household: .04, fuel: .03 }, reach: { food: 300, household: 500, fuel: 800 }, materialsPerZone: 6, materialsCap: { perResident: .1, base: 24 }, bonus: .25, jobs: { shop: 15, works: 25 }, shopperReach: 200, demandBonus: .5, homesInfillBonus: .5 });
// The family each shop sells; a legacy 'shop' counts as food.
export const OUTLET = freeze({ 'shop-grocery': 'food', 'shop-bakery': 'food', 'shop-butcher': 'food', pub: 'food', 'service-hotel': 'food', 'shop-hardware': 'household', 'shop-florist': 'household', 'service-garage': 'fuel', shop: 'food' });
export const HOUSEHOLD = freeze({ taiga: ['furniture'], tundra: ['goods'], desert: ['goods'] });
export const FAMILIES = freeze(['food', 'household', 'fuel', 'materials']);
const SOLD = ['food', 'household', 'fuel'];
export const ZONE_SECTOR = freeze({ residential: 0, commercial: 1, industrial: 2 });
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finiteIn = (min, max) => value => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const integerIn = (min, max) => value => Number.isInteger(value) && value >= min && value <= max;
const optional = valid => value => value === undefined || valid(value);
const families = valid => value => plain(value) && Object.keys(value).length === FAMILIES.length && FAMILIES.every(key => Object.hasOwn(value, key) && valid(value[key]));
// Every key a saved market may hold, with its validator. Later items (city-workshops, city-property) add theirs here.
export const MARKET_KEYS = freeze({
  wants: families(integerIn(0, 1e7)), supplied: families(finiteIn(0, 1e9)), met: families(finiteIn(0, 1)),
  demand: value => Array.isArray(value) && value.length === 3 && value.every(finiteIn(0, 1)),
  shops: integerIn(0, 1e6), works: integerIn(0, 1e6), visitors: finiteIn(0, 1e9), visitorsNow: finiteIn(0, 1e9), bonus: finiteIn(0, 1e12), bonusLast: finiteIn(0, 1e12),
  processed: optional(finiteIn(0, 1e9)), utilization: optional(finiteIn(0, 1)),
});
export const validMarket = market => plain(market) && Object.keys(market).every(key => Object.hasOwn(MARKET_KEYS, key)) && Object.entries(MARKET_KEYS).every(([key, valid]) => valid(market[key]));
// Month-close steps of later items (workshop utilization, property rent): (game, city, market, ledger) at a close only.
export const CLOSE_HOOKS = [];

const zeros = () => ({ food: 0, household: 0, fuel: 0, materials: 0 });
const emptyMarket = () => ({ wants: zeros(), supplied: zeros(), met: zeros(), demand: [0, 0, 0], shops: 0, works: 0, visitors: 0, visitorsNow: 0, bonus: 0, bonusLast: 0 });
const zoneIndex = (game, zones) => new Map(zones.map(zone => [zone.y * game.width + zone.x, zone]));

/** 'food', 'household', 'fuel', 'materials' or null (passengers, mail, machinery and any cargo it does not know). */
export function familyOf(game, cargo) {
  if (cargo === 'food' || cargo === 'fuel') return cargo;
  if (cargo === 'stone' || cargo === 'cement') return 'materials';
  return HOUSEHOLD[game.biome]?.includes(cargo) ? 'household' : null;
}
export function familyCargo(game, family) { return family === 'household' ? [...HOUSEHOLD[game.biome] || []] : family === 'materials' ? ['stone', 'cement'] : [family]; }
/** The nearest town strictly within TOWN_RADIUS; a tie goes to the first in game.cities order. */
export function townOf(game, x, y) {
  let town = null, best = TOWN_RADIUS;
  for (const city of nearbyCities(game, x, y, TOWN_RADIUS)) { const d = Math.hypot(city.x - x, city.y - y); if (d < best) { town = city; best = d; } }
  return town;
}
/** One pass over the tiles the town owns (townOf would name it): homes, shop units and outlets, workshops, landmarks and developing zones. */
export function townLedger(game, city, zoneMap) {
  const ledger = { homes: 0, shopUnits: 0, outlets: { food: 0, household: 0, fuel: 0 }, works: 0, civic: 0, developing: 0 }, rivals = [];
  // Towns that could be nearer to one of its tiles, each with whether it comes first in game.cities (nearbyCities keeps that order).
  let earlier = true;
  for (const other of nearbyCities(game, city.x, city.y, 2 * TOWN_RADIUS)) if (other === city) earlier = false; else if (Math.hypot(other.x - city.x, other.y - city.y) < 2 * TOWN_RADIUS) rivals.push(other, earlier);
  // Each row of the square reads only the tiles strictly within the radius.
  for (let y = Math.max(0, city.y - TOWN_RADIUS + 1); y <= Math.min(game.height - 1, city.y + TOWN_RADIUS - 1); y++) {
    const span = Math.ceil(Math.sqrt(TOWN_RADIUS ** 2 - (y - city.y) ** 2)) - 1, row = y * game.width;
    tiles: for (let x = Math.max(0, city.x - span); x <= Math.min(game.width - 1, city.x + span); x++) {
      const tile = game.tiles[row + x];
      if (!tile.zone && !tile.building) continue;
      // Squared distances compare exactly, so a tie really is one.
      const own = (city.x - x) ** 2 + (city.y - y) ** 2;
      for (let r = 0; r < rivals.length; r += 2) { const d = (rivals[r].x - x) ** 2 + (rivals[r].y - y) ** 2; if (d < own || d === own && rivals[r + 1]) continue tiles; }
      if (tile.zone) { const zone = zoneMap.get(row + x); if (zone && zone.progress < 3 && hasRoadAccess(game, x, y)) ledger.developing++; }
      const building = tile.building;
      if (!building) continue;
      const kind = building.kind, group = BUILDINGS[kind]?.group, level = Math.floor(building.level) || 1;
      if (group === 'homes' || kind === 'house' || kind === 'apartment') ledger.homes++;
      else if (group === 'shops' || group === 'services' || kind === 'shop' || kind === 'office') {
        // A developed commercial zone also keeps the family of the shop it grew from.
        const sells = OUTLET[kind], grewFrom = tile.zone === 'commercial' ? OUTLET[commercialKind(tile.variant, 1)] : undefined;
        ledger.shopUnits += level;
        if (sells) ledger.outlets[sells] += level;
        if (grewFrom && grewFrom !== sells) ledger.outlets[grewFrom] += level;
      } else if (kind === 'factory') ledger.works += level;
      else if (group === 'community') { ledger.civic++; if (OUTLET[kind]) ledger.outlets[OUTLET[kind]] += level; }
    }
  }
  return ledger;
}
/** Why a town's bars read as they do, from the same inputs the month close uses. */
export function demandInputs(game, city, market) {
  const population = Math.max(0, city.population), served = Number.isFinite(city.lastServiceDay) && Math.floor(game.day) - city.lastServiceDay <= 60;
  let stock = 0;
  for (const cargo in city.workshop?.input) stock += city.workshop.input[cargo];
  return { population, served, amenity: localEnvironment(game, city.x, city.y).amenity, shoppers: population + 2 * market.visitors, stock };
}
/** Closes a month (close) and reviews demand and next month's wants into `target`, or into city.market, created zeroed when missing. */
export function reviewMarket(game, city, { close = false, stopCounts = townStopCounts(game), zoneMap = zoneIndex(game, nearbyZones(game, city.x, city.y, TOWN_RADIUS)), target } = {}) {
  let market = target ?? city.market;
  if (!market) market = city.market = emptyMarket();
  if (close) {
    for (const key of FAMILIES) market.met[key] = market.wants[key] > 0 ? Math.min(1, market.supplied[key] / market.wants[key]) : 0;
    market.visitors = market.visitorsNow;market.bonusLast = market.bonus;
  }
  const ledger = townLedger(game, city, zoneMap);
  market.shops = ledger.shopUnits;market.works = ledger.works;
  const { population: P, served, amenity, shoppers, stock } = demandInputs(game, city, market);
  const service = served ? Math.min(1, .6 + .2 * (stopCounts.get(city) || 0)) : 0;
  const jobs = P > 0 ? clamp((ledger.shopUnits * MARKET.jobs.shop + ledger.works * MARKET.jobs.works) / (.25 * P)) : 0;
  const homes = clamp(.5 * service + .25 * amenity + .25 * jobs);
  const shops = clamp((shoppers / (ledger.shopUnits * MARKET.shopperReach + 100) - .5) / 1.5);
  const materials = ledger.works > 0 ? clamp(stock / (ledger.works * 150)) : 0;
  const workshops = clamp(.5 * materials + .5 * (P >= 150 ? 1 - jobs : 0));
  market.demand = [homes, shops, workshops].map(value => Math.round(value * 100) / 100);
  // The month's workshop use, once the town has had workshops: what its levels worked of what they could have.
  if (close && (ledger.works > 0 || market.processed !== undefined)) { market.utilization = ledger.works > 0 ? clamp((market.processed || 0) / (ledger.works * WORKSHOP.rate * 30)) : 0; market.processed = 0; }
  if (close) for (const hook of CLOSE_HOOKS) hook(game, city, market, ledger);
  for (const key of SOLD) market.wants[key] = Math.round(P * MARKET.perResident[key] * clamp(P > 0 ? ledger.outlets[key] * MARKET.reach[key] / P : 0));
  market.wants.materials = Math.min(MARKET.materialsPerZone * ledger.developing, Math.round(MARKET.materialsCap.perResident * P) + MARKET.materialsCap.base);
  for (const key of FAMILIES) market.supplied[key] = 0;
  market.visitorsNow = 0;market.bonus = 0;
  return market;
}
/** Simulation paths only: a town's market, created from today's state on its first arrival. */
export function ensureMarket(game, city) { return city.market ?? reviewMarket(game, city); }
/** For the interface and forecasts: the saved market, or a preview that never writes to the game. */
export function marketView(game, city) { return city.market ?? reviewMarket(game, city, { target: emptyMarket() }); }
/** The month close, first in monthlyUpdate: every town in order, a town without a market closing a zeroed one. */
export function monthlyMarkets(game) {
  const stopCounts = townStopCounts(game), zoneMap = zoneIndex(game, game.zones);
  for (const city of game.cities) reviewMarket(game, city, { close: true, stopCounts, zoneMap });
}
/** Records a town delivery and returns the units still wanted this month, which earn the market bonus. */
export function recordTownSupply(game, city, cargo, units) {
  const family = familyOf(game, cargo);
  if (!family) return 0;
  const market = ensureMarket(game, city), wanted = Math.max(0, market.wants[family] - market.supplied[family]);
  market.supplied[family] += units;
  return Math.min(units, wanted);
}
/** Passengers who arrive in a town shop there next month. */
export function recordVisitors(game, city, n) { ensureMarket(game, city).visitorsNow += n; }
export const demandLabel = value => value < .25 ? 'Low' : value < .6 ? 'Some' : 'Strong';

// Workshops: 'factory' buildings, from industrial zones or placed, turn delivered materials into products that other
// towns buy. Their levels are derived from the tiles, so placing, developing, removing, undoing or a new town nearer
// by all show the same day; only the stock in city.workshop is saved. Towns take every delivery and pay in full.
export const workshopRecipes = game => WORKSHOP_RECIPES[game.biome] || [];
const levelMemo = new WeakMap();
/** A town's workshop levels: the 'factory' anchors within reach that townOf gives to it. Only the towns asked about are counted. */
export function workshopLevels(game, city) {
  let memo = levelMemo.get(game);
  if (!memo || memo.revision !== game.revision || memo.cities !== game.cities || memo.count !== game.cities.length) levelMemo.set(game, memo = { revision: game.revision, cities: game.cities, count: game.cities.length, levels: new Map() });
  let levels = memo.levels.get(city);
  if (levels === undefined) {
    levels = 0;
    for (let y = Math.max(0, city.y - TOWN_RADIUS); y <= Math.min(game.height - 1, city.y + TOWN_RADIUS); y++) for (let x = Math.max(0, city.x - TOWN_RADIUS); x <= Math.min(game.width - 1, city.x + TOWN_RADIUS); x++) {
      const building = game.tiles[y * game.width + x].building;
      if (building?.kind === 'factory' && townOf(game, x, y) === city) levels += Math.floor(building.level) || 1;
    }
    memo.levels.set(city, levels);
  }
  return levels;
}
/** The materials a town buys: its recipes' inputs while it has a workshop. */
export function workshopInputs(game, city) { return workshopLevels(game, city) >= 1 ? workshopRecipes(game).map(recipe => recipe.input) : []; }
/** The products a town loads: while it has a workshop, or stock of one left to carry. */
export function workshopOutputs(game, city) {
  let stocked = false;
  for (const cargo in city.workshop?.output) if (city.workshop.output[cargo] >= 1) stocked = true;
  return stocked || workshopLevels(game, city) >= 1 ? [...new Set(workshopRecipes(game).map(recipe => recipe.output))] : [];
}
/** The day's work, right after the industries': each level works `rate` materials, recipes in order, while its product has room. */
export function stepWorkshops(game) {
  const recipes = workshopRecipes(game);
  for (const city of game.cities) {
    const stock = city.workshop;
    let waiting = false;
    if (stock) for (const cargo in stock.input) if (stock.input[cargo] > 0) { waiting = true; break; }
    const levels = waiting ? workshopLevels(game, city) : 0;
    if (!levels) continue;
    let cap = levels * WORKSHOP.rate;
    for (const { input, output } of recipes) {
      const room = Math.max(0, levels * WORKSHOP.store - (stock.output[output] || 0)), n = Math.min(stock.input[input] || 0, cap, room * WORKSHOP.ratio);
      if (!(n > 0)) continue;
      stock.input[input] -= n; stock.output[output] = (stock.output[output] || 0) + n / WORKSHOP.ratio; cap -= n;
      const market = ensureMarket(game, city); market.processed = (market.processed || 0) + n;
    }
  }
}
/** A materials delivery: the workshops store what fits and the town takes, and pays for, every unit. */
export function acceptWorkshopInput(game, city, cargo, units) {
  const stock = city.workshop ??= { input: {}, output: {} }, stored = Math.min(units, Math.max(0, workshopLevels(game, city) * WORKSHOP.store - (stock.input[cargo] || 0)));
  stock.input[cargo] = (stock.input[cargo] || 0) + stored;
  city.activity += units * .5;
  return units;
}
/** A saved city.workshop: this environment's recipe inputs and outputs only, each a finite stock. */
export function validWorkshop(game, stock) {
  const recipes = workshopRecipes(game), side = (value, keys) => plain(value) && Object.entries(value).every(([cargo, n]) => keys.includes(cargo) && finiteIn(0, 1e7)(n));
  return plain(stock) && Object.keys(stock).length === 2 && side(stock.input, recipes.map(recipe => recipe.input)) && side(stock.output, recipes.map(recipe => recipe.output));
}
