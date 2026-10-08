import { INDUSTRIES } from './data.js';
import { buildingAt, siteSize } from './building-sites.js';
import { stationSiteAt, stationReach, STATION_RADIUS, LEGACY_STATION_RADIUS } from './station-sites.js';

// Missing footprint means a legacy single-tile site until a safe load migration expands it.
export const industrySize = siteSize;
export const industryFootprint = kind => INDUSTRIES[kind]?.footprint || 5;
export const isFarmIndustry = kind => Boolean(INDUSTRIES[kind]?.farming);
// Recipes 5–7 are save baselines: retain their original mixed site allocation.
const legacyLargeIndustries = new Set(['steel-mill','food-plant','furniture-factory','machine-works','refinery','cement-works','goods-factory','equipment-factory']);
export const legacyIndustryFootprint = kind => legacyLargeIndustries.has(kind) ? 3 : 2;
// A procedural save regenerates its original parcels before applying saved edits.
// Published recipes therefore retain their dimensions even when the catalogue grows.
export const generatedIndustryFootprint = (kind,version) => version>=10?industryFootprint(kind):version>=9&&isFarmIndustry(kind)?7:version>=8?3:version>=5?legacyIndustryFootprint(kind):version>=3?2:1;
export const industryContains = (industry,x,y) => x>=industry.x&&y>=industry.y&&x<industry.x+industrySize(industry)&&y<industry.y+industrySize(industry);
export function industryTiles(industry){
  const result=[],size=industrySize(industry);
  for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++)result.push({x:industry.x+dx,y:industry.y+dy});
  return result;
}
export const industryDistance = (industry,point) => Math.hypot(Math.max(industry.x-point.x,0,point.x-industry.x-industrySize(industry)+1),Math.max(industry.y-point.y,0,point.y-industry.y-industrySize(industry)+1));

// Two industries of one kind, or a supplier and its customer, stand at least this far apart, centre to centre:
// rivals never share a deposit, and no chain is handed over at the fence without a route.
export const INDUSTRY_SPACING = 16;
const feeds = (from,to) => Object.keys(INDUSTRIES[from].outputs).some(cargo => INDUSTRIES[to].inputs[cargo]);
export const relatedIndustries = (a,b) => a===b||feeds(a,b)||feeds(b,a);
/** Why a related industry is too close to this site, or null. `others` lets a plan count the sites it places first. */
export function legacyIndustrySpacingProblem(game,kind,x,y,size=industryFootprint(kind),others=game.industries){
  const cx=x+(size-1)/2,cy=y+(size-1)/2;
  const near=others.find(other=>relatedIndustries(kind,other.kind)&&Math.hypot(other.x+(industrySize(other)-1)/2-cx,other.y+(industrySize(other)-1)/2-cy)<INDUSTRY_SPACING);
  if(!near)return null;
  return near.kind===kind?`Another ${INDUSTRIES[kind].name.toLowerCase()} stands within ${INDUSTRY_SPACING} tiles.`:`Too close to the ${near.name}: a supplier and its customer stand ${INDUSTRY_SPACING} tiles apart.`;
}

/** Minimum road edges between the closest possible serving stops. New plots
 * reserve both catchments as well as the journey, measured from parcel edges. */
export const MIN_CONNECTION_LENGTH = 5;
export const MIN_SITE_GAP = STATION_RADIUS * 2 + MIN_CONNECTION_LENGTH;
export function siteGap(a, b) {
  const as = industrySize(a), bs = industrySize(b);
  return Math.hypot(Math.max(a.x - b.x - bs + 1, b.x - a.x - as + 1, 0), Math.max(a.y - b.y - bs + 1, b.y - a.y - as + 1, 0));
}
// Existing five-tile stops retain their service after loading. Account for that
// extra reach too when a player places a new neighbor beside an older company.
function existingReach(game, site) {
  return (game.stations || []).some(stop => stop.mode !== 'air' && stationReach(stop) > STATION_RADIUS && industryDistance(site, stop) <= stationReach(stop)) ? LEGACY_STATION_RADIUS : STATION_RADIUS;
}
function tooClose(game, site, other) {
  const gap = siteGap(site, other);
  // Most surveyed sites are far apart; scan old stops only in the narrow band
  // where their extra catchment can change the placement decision.
  if (gap >= LEGACY_STATION_RADIUS * 2 + MIN_CONNECTION_LENGTH) return false;
  if (gap < MIN_SITE_GAP) return true;
  return gap < existingReach(game, site) + existingReach(game, other) + MIN_CONNECTION_LENGTH;
}
export function townSpacingProblem(game, x, y) {
  const site = { x, y }, town = game.cities.find(other => tooClose(game, site, other));
  if (town) return `Too close to ${town.name}: leave room for a ${MIN_CONNECTION_LENGTH}-tile road between the towns' stop ranges.`;
  const industry = game.industries.find(other => tooClose(game, site, other));
  return industry ? `Too close to ${industry.name}: leave room for a ${MIN_CONNECTION_LENGTH}-tile road between the stop ranges.` : null;
}
export function industrySpacingProblem(game, kind, x, y, size = industryFootprint(kind), others = game.industries) {
  const site = { x, y, footprint: size }, town = game.cities.find(other => tooClose(game, site, other));
  if (town) return `Too close to ${town.name}: leave room for a ${MIN_CONNECTION_LENGTH}-tile road between the plot's and town's stop ranges.`;
  const near = others.find(other => relatedIndustries(kind, other.kind) && tooClose(game, site, other));
  if (near) return `Too close to ${near.name}: leave room for a ${MIN_CONNECTION_LENGTH}-tile road between the industries' stop ranges.`;
  return legacyIndustrySpacingProblem(game, kind, x, y, size, others);
}

export function industrySiteProblem(game,kind,x,y,size=industryFootprint(kind),exclude=null){
  const def=INDUSTRIES[kind];if(!def)return 'Unknown industry.';
  if(!def.biomes.includes(game.biome))return 'This industry is unavailable in this environment.';
  const maximum=isFarmIndustry(kind)?7:industryFootprint(kind);
  if(![1,2,3,5,7].includes(size)||size>maximum||!Number.isInteger(x)||!Number.isInteger(y))return 'Invalid industry footprint.';
  if(x<0||y<0||x+size>game.width||y+size>game.height)return `The whole ${size} × ${size} site must fit inside the map.`;
  const tile=(px,py)=>px>=0&&py>=0&&px<game.width&&py<game.height?game.tiles[py*game.width+px]:null;
  const anchor=tile(x,y);
  if(def.terrain&&!def.terrain.includes(anchor.terrain))return `${def.name} needs ${def.terrain.join(', ')} terrain.`;
  let coastal=false;
  for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++){
    const px=x+dx,py=y+dy,t=tile(px,py);
    if(t.terrain==='water'||(t.terrain==='mountain'&&!def.terrain?.includes('mountain')))return `The whole ${size} × ${size} site needs buildable land.`;
    if(buildingAt(game,px,py)||t.zone||t.road||t.rail||t.bridge||t.tunnel||stationSiteAt(game,px,py)||game.cities.some(c=>c.x===px&&c.y===py)||game.industries.some(i=>i!==exclude&&industryContains(i,px,py)))return `Clear all ${size*size} tiles before building this industry.`;
    if([[1,0],[-1,0],[0,1],[0,-1]].some(([ox,oy])=>tile(px+ox,py+oy)?.terrain==='water'))coastal=true;
  }
  if(def.coastal&&!coastal)return 'A fishery site must touch the shoreline.';
  return null;
}

export function expandGeneratedIndustrySites(game){
  for(const industry of game.industries){
    const original={x:industry.x,y:industry.y};let site=null;
    for(let radius=0;radius<=32&&!site;radius++)for(let dy=-radius;dy<=radius&&!site;dy++)for(let dx=-radius;dx<=radius&&!site;dx++){
      if(radius&&Math.abs(dx)!==radius&&Math.abs(dy)!==radius)continue;
      const x=original.x+dx,y=original.y+dy;
      if(!industrySiteProblem(game,industry.kind,x,y,2,industry))site={x,y};
    }
    if(!site)throw new Error(`Could not find a 2 × 2 site for ${industry.kind}.`);
    Object.assign(industry,site,{footprint:2});
  }
  return game;
}
