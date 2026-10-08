import { townOf, townLedger, marketView, propertyOccupancy, familyCargo, MARKET, OUTLET, GROUND_RENT, BUILT_YIELD, TOWN_RADIUS } from './town-market.js';
import { zoneServiceActive, servedTownSet, housingCapacity } from './settlements.js';
import { hasRoadAccess } from './environment.js';
import { BUILDINGS, residentialKind, commercialKind } from './buildings.js';
import { constructionDuration, CONSTRUCTION_MONTH_DAYS } from './building-construction.js';
import { buildingAt, buildingFootprint } from './building-sites.js';
import { nearbyZones } from './simulation-spatial.js';
import { WORKSHOP, WORKSHOP_RECIPES } from './data.js';
import { priceFor } from './economy-pricing.js';
import { money, number, count, listJoin, cargoName } from './copy.js';

// What an investment in a town would bring, for the placement tip: residents, rent, payback, and the shop wants or workshop
// products it adds. DOM-free and read-only: it reads the kinds, footprints, road rule, service gate and occupancy the simulation
// uses, never calls ensureMarket, draws no randomAt, spends no nextId and saves nothing. model.js never imports it.
/** Development interest precedes construction; each building phase adds its own calendar time below. */
export const FORECAST = Object.freeze({ monthsToBuild: 6 });
const ZONES = new Set(['residential', 'commercial', 'industrial']), SOLD = ['food', 'household', 'fuel'];
const HOMES = Object.freeze({ sector: 'homes' }), WORKS = Object.freeze({ sector: 'works' });
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const tileAt = (game, x, y) => x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y * game.width + x] : null;
const developmentKind = (kind, variant, level) => kind === 'residential' ? residentialKind(variant, level) : commercialKind(variant, level);
/** The level a residential or commercial zone tile settles at: the highest of 1-3 whose building still fits its own tile. A 2 × 2
 * kind needs free land beside it, which a zoned block never has, so homes stop at 2 and shops at 3 or 1 by the tile's variant. */
export function matureLevel(game, kind, x, y) {
  const variant = tileAt(game, x, y)?.variant;
  let level = 0;
  while (level < 3 && buildingFootprint(developmentKind(kind, variant, level + 1)) === 1) level++;
  return level;
}
// city-market's wants: residents × perResident, scaled by outlets × reach per resident up to 1.
const wantsFor = (P, outlets, family) => Math.round(P * MARKET.perResident[family] * clamp(P > 0 ? outlets * MARKET.reach[family] / P : 0));

// A town's market as the interface sees it (marketView: the saved one, or a preview that writes nothing) and its outlets,
// read once a day and revision.
const towns = new WeakMap();
function townInfo(game, city) {
  const day = Math.floor(game.day);
  let memo = towns.get(game);
  if (!memo || memo.day !== day || memo.revision !== game.revision) towns.set(game, memo = { day, revision: game.revision, cities: new Map() });
  let info = memo.cities.get(city.id);
  if (!info || info.market !== city.market) memo.cities.set(city.id, info = { market: city.market, view: marketView(game, city), outlets: null });
  return info;
}
const outletsOf = (game, city, info) => info.outlets ??= townLedger(game, city, new Map(nearbyZones(game, city.x, city.y, TOWN_RADIUS).map(zone => [zone.y * game.width + zone.x, zone]))).outlets;
// Each forecast keeps its last answer, keyed by its tiles, the day, both revisions, the served set and the funded towns
// (funding moves no revision, and the tip must follow it at once).
const memos = new WeakMap();
function remember(game, slot, key, compute) {
  let funded = '';
  for (const city of game.cities) if (city.fundedUntil !== undefined) funded += `${city.id}:${city.fundedUntil},`;
  const served = servedTownSet(game), stamp = `${key}|${Math.floor(game.day)}|${game.revision}|${game.networkRevision || 0}|${funded}`;
  let memo = memos.get(game);
  if (!memo) memos.set(game, memo = {});
  const last = memo[slot];
  if (last?.stamp === stamp && last.served === served) return last.value;
  const value = compute(served);
  memo[slot] = { stamp, served, value };
  return value;
}

// Disjoint 2 × 2 squares, row by row, over the stroke's tiles in a town and the vacant industrial zones already there. A square
// needs one new tile, and one tile with a road beside it, since that zone grows the workshop over the other three. Lone tiles
// and ragged edges count nothing: the forecast never promises a workshop spreading onto unzoned land.
function workshopSquares(game, open) {
  const W = game.width, fresh = new Map(open.map(p => [p.y * W + p.x, p])), used = new Set(), squares = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of open) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const free = (x, y) => { const i = y * W + x; return !used.has(i) && (fresh.has(i) || tileAt(game, x, y)?.zone === 'industrial' && !buildingAt(game, x, y)); };
  for (let y = y0 - 1; y <= y1; y++) for (let x = x0 - 1; x <= x1; x++) {
    const cells = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
    if (!cells.every(([u, v]) => free(u, v))) continue;
    const own = cells.map(([u, v]) => fresh.get(v * W + u)).filter(Boolean);
    if (!own.length || !cells.some(([u, v]) => fresh.get(v * W + u)?.road ?? hasRoadAccess(game, u, v))) continue;
    for (const [u, v] of cells) used.add(v * W + u);
    squares.push({ x, y, city: (own.find(p => p.road) || own[0]).city });
  }
  return squares;
}

/** A zone stroke's forecast from the quote's placements that would be built (state 'ok'); null for other tools.
 * {towns: [{city, tiles}], far, roadless, served, residents, levels, workshopLevels, goods, input, output, wants: {family, units, cargo} | null,
 * rent, payback, cost}. Tiles with no town within 10 tiles count in far, tiles without a road beside them in roadless; the rest group
 * by town, most tiles first. Rent is today's price of the mature ground rent at today's occupancy; rent and payback (months, with
 * FORECAST.monthsToBuild of development plus the construction phases) are null until one of those towns meets the zone gate. */
export function zoneForecast(game, kind, placements) {
  if (!ZONES.has(kind)) return null;
  const tiles = placements.filter(p => !p.state || p.state === 'ok');
  return remember(game, 'zone', `${kind}:${tiles.map(p => p.y * game.width + p.x)}`, served => {
    const groups = new Map(), open = [], recipe = WORKSHOP_RECIPES[game.biome]?.[0];
    let far = 0, roadless = 0, cost = 0, base = 0;
    for (const p of tiles) {
      cost += p.cost || 0;
      const city = townOf(game, p.x, p.y);
      if (!city) { far++; continue; }
      const road = hasRoadAccess(game, p.x, p.y);
      if (!road) roadless++;
      if (kind === 'industrial') open.push({ x: p.x, y: p.y, city, road });
      if (!road) continue;
      const group = groups.get(city);
      if (group) group.tiles.push(p); else groups.set(city, { city, tiles: [p] });
    }
    const list = [...groups.values()].sort((a, b) => b.tiles.length - a.tiles.length || game.cities.indexOf(a.city) - game.cities.indexOf(b.city));
    const active = list.filter(group => zoneServiceActive(game, group.city, served));
    const result = { towns: list.map(group => ({ city: group.city, tiles: group.tiles.length })), far, roadless, served: list.length > 0 && active.length === list.length, residents: 0, levels: 0, workshopLevels: 0, goods: 0, input: recipe?.input ?? null, output: recipe?.output ?? null, wants: null, rent: null, payback: null, cost, constructionMonths: 0 };
    if (kind === 'industrial') {
      const squares = workshopSquares(game, open);
      for (const square of squares) base += GROUND_RENT.works * 4 * 3 * propertyOccupancy(townInfo(game, square.city).view, WORKS, square.city.population);
      result.workshopLevels = 3 * squares.length;
      if (squares.length) result.constructionMonths = [1, 2, 3].reduce((days, level) => days + constructionDuration('factory', { level }), 0) / CONSTRUCTION_MONTH_DAYS;
      result.goods = result.workshopLevels * WORKSHOP.rate * 30 / WORKSHOP.ratio;
    } else {
      const wanted = { food: 0, household: 0, fuel: 0 }, maturity = new Map();
      for (const { city, tiles: own } of list) {
        const info = townInfo(game, city), added = { food: 0, household: 0, fuel: 0 };
        for (const p of own) {
          const variant = tileAt(game, p.x, p.y).variant;
          let shape = maturity.get(variant);
          if (!shape) {
            const level = matureLevel(game, kind, p.x, p.y); let days = 0;
            for (let tier = 1; tier <= level; tier++) days += constructionDuration(developmentKind(kind, variant, tier), { level: tier });
            shape = { level, months: days / CONSTRUCTION_MONTH_DAYS }; maturity.set(variant, shape);
          }
          const { level } = shape; result.levels += level;
          result.constructionMonths = Math.max(result.constructionMonths, shape.months);
          if (kind === 'residential') { result.residents += housingCapacity({ kind: residentialKind(variant, level), level }); base += GROUND_RENT.homes * level * propertyOccupancy(info.view, HOMES, city.population); continue; }
          // A developed commercial zone also keeps the family of the shop it grew from, as townLedger counts it.
          const sells = OUTLET[commercialKind(variant, level)], grew = OUTLET[commercialKind(variant, 1)];
          if (sells) added[sells] += level;
          if (grew && grew !== sells) added[grew] += level;
          base += GROUND_RENT.shops * level * propertyOccupancy(info.view, { sector: 'shops', family: sells || grew || null }, city.population);
        }
        if (kind !== 'commercial') continue;
        const P = Math.max(0, city.population), outlets = outletsOf(game, city, info);
        for (const family of SOLD) wanted[family] += wantsFor(P, outlets[family] + added[family], family) - wantsFor(P, outlets[family], family);
      }
      const family = SOLD.reduce((best, key) => wanted[key] > (best ? wanted[best] : 0) ? key : best, null);
      if (family) result.wants = { family, units: wanted[family], cargo: familyCargo(game, family)[0] };
    }
    const rent = active.length ? priceFor(game, base) : 0;
    if (rent > 0) { result.rent = rent; result.payback = Math.ceil(cost / rent) + FORECAST.monthsToBuild + result.constructionMonths; }
    return result;
  });
}

/** One home, shop, service or workshop placed at an anchor: {city, rent, stockedRent, family, payback, goods, input, output}; null
 * for the town's own buildings (schools, pubs and the rest), which are never property. It belongs to the town nearest its anchor,
 * as city-property's ledger counts it; in the countryside it earns nothing. A shop that sells a family would earn stockedRent with
 * that family's wants met. A workshop's goods are one level's month, made from the first material its environment uses. */
export function buildingForecast(game, kind, x, y) {
  const workshop = kind === 'workshop', group = BUILDINGS[kind]?.group;
  if (!workshop && group !== 'homes' && group !== 'shops' && group !== 'services') return null;
  return remember(game, 'building', `${kind}:${x},${y}`, () => {
    const city = townOf(game, x, y), family = workshop ? null : OUTLET[kind] || null, recipe = workshop ? WORKSHOP_RECIPES[game.biome]?.[0] : null;
    const result = { city, rent: 0, stockedRent: 0, family, payback: null, constructionMonths: constructionDuration(kind) / CONSTRUCTION_MONTH_DAYS, goods: workshop ? WORKSHOP.rate * 30 / WORKSHOP.ratio : 0, input: recipe?.input ?? null, output: recipe?.output ?? null };
    if (!city) return result;
    const view = townInfo(game, city).view, cost = workshop ? WORKSHOP.cost : BUILDINGS[kind].cost, sector = workshop ? 'works' : group === 'homes' ? 'homes' : 'shops';
    const rent = p => priceFor(game, BUILT_YIELD * cost * propertyOccupancy(view, p, city.population));
    result.rent = rent({ sector, family });
    result.stockedRent = family ? rent({ sector, family: null }) : result.rent;
    if (result.rent > 0) result.payback = Math.ceil(priceFor(game, cost) / result.rent) + result.constructionMonths;
    return result;
  });
}

const paysBack = months => `pays back in about ${months < 24 ? count(months, 'month') : count(Math.round(months / 12), 'year')}`;
const made = f => `about ${number(f.goods)} ${cargoName(f.output)} a month from delivered ${cargoName(f.input)}`;
/** The placement tip's forecast line for a zone stroke or one building: {forecast, warning}, or null when it has nothing to add
 * (every tile needs a road, which the quote already says, or a building the town owns). */
export function forecastNote(game, tool, placements) {
  if (ZONES.has(tool)) {
    const f = zoneForecast(game, tool, placements);
    if (!f.towns.length) return f.far ? { forecast: f.roadless ? `${number(f.far)} too far from a town to develop` : 'Too far from a town to develop', warning: true } : null;
    const where = listJoin(f.towns.map(town => town.city.name)), far = f.far ? `, ${number(f.far)} too far from a town` : '';
    const line = tool === 'industrial' && !f.workshopLevels ? `${where}, a workshop needs a 2 × 2 block`
      : f.rent === null ? `Develops once a route serves ${where}`
      : tool === 'residential' ? `${where}, once built, about +${number(f.residents)} residents and ${money(f.rent)} a month in rent, ${paysBack(f.payback)}`
      : tool === 'commercial' ? `${where}, once built, about ${money(f.rent)} a month in rent, ${paysBack(f.payback)}${f.wants ? `, shops would want about +${number(f.wants.units)} ${cargoName(f.wants.cargo)}` : ''}`
      : `${where}, once built, ${made(f)} and ${money(f.rent)} a month in rent`;
    return { forecast: line + far, warning: f.far > 0 };
  }
  const at = placements[0], f = at && buildingForecast(game, tool, at.x, at.y);
  if (!f) return null;
  if (!f.city) return { forecast: 'Countryside, earns no rent', warning: false };
  if (tool === 'workshop') return { forecast: `${f.city.name}, once built, ${made(f)} and ${money(f.rent)} a month in rent`, warning: false };
  const stocked = f.stockedRent > f.rent ? ` or ${money(f.stockedRent)} stocked with ${cargoName(familyCargo(game, f.family)[0])}` : '';
  return { forecast: `${f.city.name}, once built, about ${money(f.rent)} a month in rent${stocked}, ${paysBack(f.payback)}`, warning: false };
}
