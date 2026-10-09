import { INDUSTRIES, TOWN_CARGO } from './data.js';
import { randomAt } from './environment.js';
import { industryFootprint, industrySiteProblem, worldSpacingProblem, industryDistance, industrySize } from './industry-sites.js';
import { buildingAt } from './building-sites.js';
import { nearbyCities, nearbyIndustries, nearbyStations } from './simulation-spatial.js';
import { surfaceHeight } from './terrain-geometry.js';
import { workshopLevels, workshopRecipes } from './town-market.js';
import { stationReach, stationServes, STATION_RADIUS, LEGACY_STATION_RADIUS } from './station-sites.js';

// New industries open, never close. From 1952, once the company has delivered freight, a month's
// roll may open one 10 to 24 tiles from a town a stop reaches: on free, gentle ground with a trading
// partner in reach, clear of related industries, outside every stop's catchment and every home's,
// zone's and industry's survey, so nothing already running changes. DOM-free and pure: the model
// places the plan it returns.
export const OPENINGS = Object.freeze({ firstMonth: 24, catchment: STATION_RADIUS, baseChance: .03, perTown: .005, maxChance: .1, nearTown: 10, farTown: 24, attempts: 48, homeMargin: 4, siteGap: 5, localRadius: 16, localCap: 5, partner: 40, share: .5, minCeiling: 4 });
const KEY = 'industry-opening';
// The anchor tile's habitat, as world placement chooses it; fisheries already need a shore.
const RESOURCE = kind => kind === 'logging-camp' ? ['forest'] : /mine|quarry/.test(kind) ? ['rock', 'mountain'] : kind === 'sand-pit' ? ['sand'] : kind === 'farm' ? ['grass'] : null;
const isRaw = kind => !Object.keys(INDUSTRIES[kind].inputs).length;
// Freight is what industries make: passengers and any town-only cargo never count.
const FREIGHT = new Set(Object.values(INDUSTRIES).flatMap(def => Object.keys(def.outputs)));

/** Towns with a stop within reach of their centre, in town order. */
export function openingAnchors(game) {
  const ids = new Set();
  for (const stop of game.stations) for (const city of nearbyCities(game, stop.x, stop.y, stationReach(stop) + (stop.mode === 'air' ? 5 : 0))) if (stationServes(stop, city)) ids.add(city.id);
  return ids.size ? game.cities.filter(city => ids.has(city.id)) : [];
}
export const openingChance = towns => Math.min(OPENINGS.maxChance, OPENINGS.baseChance + OPENINGS.perTown * towns);
/** Half as many openings as the region started with; projects reserve their share before opening. */
export function openingCeiling(game) {
  const original = game.industries.filter(site => site.owner !== 'player' && site.openedDay === undefined && !site.construction).length;
  return Math.max(OPENINGS.minCeiling, Math.ceil(original * OPENINGS.share));
}
export const openedCount = game => game.industries.filter(site => site.owner !== 'player' && (site.openedDay !== undefined || site.construction)).length;
export const hasCarriedFreight = game => game.routes.some(route => FREIGHT.has(route.cargo) && route.delivered > 0);

function gentle(game, x, y, size) {
  let low = Infinity, high = -Infinity;
  for (let v = y; v <= y + size; v++) for (let u = x; u <= x + size; u++) { const h = surfaceHeight(game, u, v); low = Math.min(low, h); high = Math.max(high, h); }
  return high - low <= 1;
}
// Something within reach buys an output, and a processor also has a supplier.
function partnered(game, kind, cx, cy) {
  const def = INDUSTRIES[kind], R = OPENINGS.partner, sites = nearbyIndustries(game, cx, cy, R).filter(site => Math.hypot(site.x - cx, site.y - cy) <= R);
  const town = () => nearbyCities(game, cx, cy, R).some(city => Math.hypot(city.x - cx, city.y - cy) <= R);
  // A town's workshops buy their materials.
  const works = cargo => workshopRecipes(game).some(recipe => recipe.input === cargo) && nearbyCities(game, cx, cy, R).some(city => Math.hypot(city.x - cx, city.y - cy) <= R && workshopLevels(game, city) >= 1);
  const buyer = Object.keys(def.outputs).some(cargo => sites.some(site => INDUSTRIES[site.kind].inputs[cargo]) || (TOWN_CARGO.includes(cargo) && town()) || works(cargo));
  return buyer && (isRaw(kind) || Object.keys(def.inputs).some(cargo => sites.some(site => INDUSTRIES[site.kind].outputs[cargo])));
}

/** Why an opening cannot use this plot, or null. Cheap tile reads first, the O(n) Build check last. */
export function openingSiteProblem(game, kind, x, y) {
  const def = INDUSTRIES[kind], size = industryFootprint(kind), site = { x, y, footprint: size }, cx = x + (size - 1) / 2, cy = y + (size - 1) / 2, O = OPENINGS;
  if (x < 0 || y < 0 || x + size > game.width || y + size > game.height) return 'site';
  for (let py = y; py < y + size; py++) for (let px = x; px < x + size; px++) {
    const t = game.tiles[py * game.width + px];
    if (t.terrain === 'water' || (t.terrain === 'mountain' && !def.terrain?.includes('mountain')) || t.road || t.rail || t.bridge || t.tunnel || t.zone) return 'site';
  }
  const anchor = game.tiles[y * game.width + x].terrain;
  if (def.terrain && !def.terrain.includes(anchor)) return 'site';
  if (RESOURCE(kind) && !RESOURCE(kind).includes(anchor)) return 'habitat';
  // Chebyshev, so the site stays outside the widest square a town grows its streets in.
  if (nearbyCities(game, cx, cy, O.nearTown + 3).some(city => Math.max(x - city.x, city.x - (x + size - 1), y - city.y, city.y - (y + size - 1)) < O.nearTown)) return 'town';
  if (nearbyStations(game, cx, cy, LEGACY_STATION_RADIUS + 3).some(stop => stop.mode !== 'air' && industryDistance(site, stop) <= stationReach(stop))) return 'stop';
  const neighbours = nearbyIndustries(game, cx, cy, O.localRadius + 4), center = { x: cx, y: cy };
  if (worldSpacingProblem(game, kind, x, y, size, neighbours)) return 'spacing';
  if (neighbours.filter(other => industryDistance(other, center) <= O.localRadius).length >= O.localCap) return 'crowded';
  // Industry surveys reach four tiles and settlement surveys three: no new pollution reaches anyone.
  if (neighbours.some(other => Math.max(other.x - (x + size - 1), x - (other.x + industrySize(other) - 1), other.y - (y + size - 1), y - (other.y + industrySize(other) - 1)) <= O.siteGap)) return 'margin';
  for (let py = Math.max(0, y - O.homeMargin); py < Math.min(game.height, y + size + O.homeMargin); py++) for (let px = Math.max(0, x - O.homeMargin); px < Math.min(game.width, x + size + O.homeMargin); px++) {
    if (game.tiles[py * game.width + px].zone || buildingAt(game, px, py)) return 'margin';
  }
  if (!gentle(game, x, y, size)) return 'slope';
  if (!partnered(game, kind, cx, cy)) return 'partner';
  return industrySiteProblem(game, kind, x, y, size) ? 'site' : null;
}

/** This calendar month's opening, {kind, x, y, anchorId}, or null. Pure; `force` skips the date, freight and chance gates. */
export function planIndustryOpening(game, month, { force = false } = {}) {
  const O = OPENINGS;
  if (!force && (month < O.firstMonth || !hasCarriedFreight(game))) return null;
  // The roll comes first, so nine months in ten cost one hash.
  const roll = randomAt(game, month, KEY, 901);
  if (!force && roll >= O.maxChance) return null;
  const anchors = openingAnchors(game);
  if (!anchors.length || (!force && roll >= openingChance(anchors.length)) || openedCount(game) >= openingCeiling(game)) return null;
  const kinds = Object.keys(INDUSTRIES).filter(kind => !INDUSTRIES[kind].buildOnly&&INDUSTRIES[kind].biomes.includes(game.biome)), weight = kind => isRaw(kind) && kind !== 'oil-well' ? 2 : 1, total = kinds.reduce((sum, kind) => sum + weight(kind), 0);
  const town = anchors[Math.floor(randomAt(game, month, KEY, 903) * anchors.length)];
  for (let k = 0; k < O.attempts; k++) {
    let pick = randomAt(game, month, KEY, 1200 + k) * total, kind = kinds.at(-1);
    for (const option of kinds) { pick -= weight(option); if (pick < 0) { kind = option; break; } }
    const size = industryFootprint(kind), angle = randomAt(game, month, KEY, 1000 + k * 2) * Math.PI * 2, distance = O.nearTown + randomAt(game, month, KEY, 1001 + k * 2) * (O.farTown - O.nearTown);
    const x = Math.round(town.x + Math.cos(angle) * distance - (size - 1) / 2), y = Math.round(town.y + Math.sin(angle) * distance - (size - 1) / 2);
    if (!openingSiteProblem(game, kind, x, y)) return { kind, x, y, anchorId: town.id };
  }
  return null;
}
