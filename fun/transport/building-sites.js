import { BUILDINGS } from './buildings.js';
import { releaseTerrainObjects } from './terrain-objects.js';
import { stationSiteAt } from './station-sites.js';

// Extent belongs to the saved instance. A missing field is an old one-tile
// site, even when today's catalog creates a larger version of its kind.
export const siteSize = site => site?.footprint === 2 || site?.footprint === 3 || site?.footprint === 5 || site?.footprint === 7 ? site.footprint : 1;
export const buildingSize = siteSize;
export const buildingFootprint = kind => BUILDINGS[kind]?.footprint || (['apartment','office','factory'].includes(kind)?2:1);
export const siteContains = (site,x,y) => x>=site.x&&y>=site.y&&x<site.x+siteSize(site)&&y<site.y+siteSize(site);
const tileAt=(game,x,y)=>x>=0&&y>=0&&x<game.width&&y<game.height?game.tiles[y*game.width+x]:null;

export function buildingAt(game,x,y) {
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=game.width||y>=game.height)return null;
  for(let ay=y;ay>=Math.max(0,y-2);ay--)for(let ax=x;ax>=Math.max(0,x-2);ax--){
    const building=game.tiles[ay*game.width+ax]?.building;
    if(building&&x<ax+buildingSize(building)&&y<ay+buildingSize(building))return{x:ax,y:ay,building};
  }
  return null;
}

export function buildingTiles(site) {
  const result=[],size=buildingSize(site.building);
  for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++)result.push({x:site.x+dx,y:site.y+dy});
  return result;
}

export function buildingSiteProblem(game,kind,x,y,size=buildingFootprint(kind),{exclude=null,allowZone=false}={}) {
  if(!Object.hasOwn(BUILDINGS,kind)&&!['house','apartment','shop','office','factory'].includes(kind))return 'Unknown building.';
  if(![1,2,3].includes(size)||size>buildingFootprint(kind)||!Number.isInteger(x)||!Number.isInteger(y))return 'Invalid building footprint.';
  if(x<0||y<0||x+size>game.width||y+size>game.height)return `The whole ${size} × ${size} site must fit inside the map.`;
  for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++){
    const px=x+dx,py=y+dy,t=tileAt(game,px,py),occupied=buildingAt(game,px,py);
    if(t.terrain==='water'||t.terrain==='mountain')return `The whole ${size} × ${size} site needs buildable land.`;
    if((occupied&&!(exclude&&occupied.x===exclude.x&&occupied.y===exclude.y))||(!allowZone&&t.zone&&!(exclude&&px===exclude.x&&py===exclude.y))||t.road||t.rail||t.bridge||t.tunnel||stationSiteAt(game,px,py)||game.cities.some(c=>c.x===px&&c.y===py)||game.industries.some(i=>siteContains(i,px,py)))return `Clear all ${size*size} tiles before building here.`;
  }
  return null;
}

export function placeBuildingSite(game,kind,x,y,{size=buildingFootprint(kind),building={},exclude=null,allowZone=false}={}) {
  if(buildingSiteProblem(game,kind,x,y,size,{exclude,allowZone}))return null;
  const stored={level:1,...building,kind,footprint:size},site={x,y,building:stored};
  if(exclude&&(exclude.x!==x||exclude.y!==y))tileAt(game,exclude.x,exclude.y).building=null;
  releaseTerrainObjects(game,buildingTiles(site));
  for(const p of buildingTiles(site)){
    const cell=tileAt(game,p.x,p.y);cell.detail='';
    if(['forest','rock'].includes(cell.terrain))cell.terrain=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';
    if(allowZone&&(p.x!==x||p.y!==y))cell.zone=null;
  }
  // A plot's ground rent follows the zone tiles paid for: a block taken into one building keeps their count on its anchor record.
  if(allowZone){const anchor=game.zones.find(z=>z.x===x&&z.y===y),taken=game.zones.filter(z=>(z.x!==x||z.y!==y)&&z.x>=x&&z.y>=y&&z.x<x+size&&z.y<y+size);if(anchor&&taken.length)anchor.tiles=(anchor.tiles??1)+taken.reduce((sum,z)=>sum+(z.tiles??1),0);}
  if(allowZone)game.zones=game.zones.filter(z=>(z.x===x&&z.y===y)||z.x<x||z.y<y||z.x>=x+size||z.y>=y+size);
  tileAt(game,x,y).building=stored;
  return site;
}
