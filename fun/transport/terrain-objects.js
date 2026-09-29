import { terrainElevation, terrainLevel } from './terrain-elevation.js';
import { stationSiteAt } from './station-sites.js';

export const TERRAIN_OBJECT_KINDS = new Set(['forest','rock','mountain']);
export const terrainObjectSize = object => [2,3].includes(object?.footprint)?object.footprint:1;
const inside=(game,x,y)=>Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<game.width&&y<game.height;
const sizeOf=object=>[1,2,3].includes(object?.footprint)?object.footprint:1;

// Explicit parcels own only one anchor. No inferred parcel is claimed around
// old terrain: it remains the ordinary single-tile art until safely allocated.
export function terrainObjectAt(game,x,y){
  if(!inside(game,x,y))return null;
  for(let ay=y;ay>=Math.max(0,y-2);ay--)for(let ax=x;ax>=Math.max(0,x-2);ax--){
    const object=game.tiles[ay*game.width+ax]?.terrainObject;
    if(object&&x<ax+terrainObjectSize(object)&&y<ay+terrainObjectSize(object))return{x:ax,y:ay,object};
  }
  return null;
}
export function terrainObjectTiles(site){
  const points=[],size=terrainObjectSize(site.object);
  for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++)points.push({x:site.x+dx,y:site.y+dy});
  return points;
}
function releaseSites(game,points){
  const anchors=new Map();
  for(const point of points){const site=terrainObjectAt(game,point.x,point.y);if(site)anchors.set(site.y*game.width+site.x,site);}
  for(const index of anchors.keys())delete game.tiles[index].terrainObject;
  return anchors;
}
export function releaseTerrainObjects(game,points){return releaseSites(game,points).size;}
// Every cell whose shared grove or outcrop artwork dissolved, for view caches.
export function releaseTerrainObjectsCells(game,points){
  const cells=[];
  for(const site of releaseSites(game,points).values())for(const point of terrainObjectTiles(site))cells.push(point.y*game.width+point.x);
  return cells;
}

// Continuous elevation limits avoid giant sprites perched across a hill even
// when all rounded engineering levels happen to agree. A full collar also
// excludes shoreline rims and cliffs just beyond the site's ground diamond.
export function terrainObjectGroundIsFlat(game,x,y,size){
  if(![2,3].includes(size)||!inside(game,x-1,y-1)||!inside(game,x+size,y+size))return false;
  const level=terrainLevel(game.tiles[y*game.width+x]);let minimum=Infinity,maximum=-Infinity,collarMin=Infinity,collarMax=-Infinity;
  for(let dy=-1;dy<=size;dy++)for(let dx=-1;dx<=size;dx++){
    const tile=game.tiles[(y+dy)*game.width+x+dx],height=terrainElevation(tile);
    if(tile.terrain==='water'||!Number.isFinite(tile.elevation))return false;
    collarMin=Math.min(collarMin,height);collarMax=Math.max(collarMax,height);
    if(dx>=0&&dy>=0&&dx<size&&dy<size){
      if(terrainLevel(tile)!==level)return false;
      minimum=Math.min(minimum,height);maximum=Math.max(maximum,height);
    }
  }
  return maximum-minimum<=.3+1e-9&&collarMax-collarMin<=.6+1e-9;
}
export const terrainObjectSiteFlat=terrainObjectGroundIsFlat;

// Deliberately independent of building-sites: construction releases parcels,
// while parcels must recognize reserved building cells without import cycles.
function hasBuilding(game,x,y){
  for(let ay=y;ay>=Math.max(0,y-2);ay--)for(let ax=x;ax>=Math.max(0,x-2);ax--){
    const building=game.tiles[ay*game.width+ax]?.building;
    if(building&&x<ax+sizeOf(building)&&y<ay+sizeOf(building))return true;
  }
  return false;
}
export function terrainObjectSiteProblem(game,kind,x,y,size,{exclude=null}={}){
  if(!TERRAIN_OBJECT_KINDS.has(kind)||![2,3].includes(size)||!inside(game,x,y)||!inside(game,x+size-1,y+size-1))return 'Invalid terrain-object footprint.';
  if(!terrainObjectGroundIsFlat(game,x,y,size))return 'Large terrain objects need a level site with gently graded surroundings.';
  for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++){
    const px=x+dx,py=y+dy,tile=game.tiles[py*game.width+px],existing=terrainObjectAt(game,px,py);
    if(tile.terrain!==kind)return 'The whole parcel must have the same base terrain.';
    if(existing&&!(exclude&&existing.x===exclude.x&&existing.y===exclude.y))return 'Terrain-object parcels cannot overlap.';
    if(tile.road||tile.rail||tile.bridge||tile.tunnel||tile.zone||hasBuilding(game,px,py)||(game.industries||[]).some(i=>px>=i.x&&py>=i.y&&px<i.x+sizeOf(i)&&py<i.y+sizeOf(i))||(game.cities||[]).some(c=>c.x===px&&c.y===py)||stationSiteAt(game,px,py)||(game.zones||[]).some(z=>z.x===px&&z.y===py))return 'Terrain-object parcels need unoccupied land.';
  }
  return null;
}
