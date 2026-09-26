import { INDUSTRIES } from './data.js';

// Missing footprint means a legacy single-tile site; saves never expand in place.
export const industrySize = industry => industry?.footprint === 2 ? 2 : 1;
export const industryContains = (industry,x,y) => x>=industry.x&&y>=industry.y&&x<industry.x+industrySize(industry)&&y<industry.y+industrySize(industry);
export function industryTiles(industry){
  const result=[],size=industrySize(industry);
  for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++)result.push({x:industry.x+dx,y:industry.y+dy});
  return result;
}
export const industryDistance = (industry,point) => Math.hypot(Math.max(industry.x-point.x,0,point.x-industry.x-industrySize(industry)+1),Math.max(industry.y-point.y,0,point.y-industry.y-industrySize(industry)+1));

export function industrySiteProblem(game,kind,x,y,size=2,exclude=null){
  const def=INDUSTRIES[kind];if(!def)return 'Unknown industry.';
  if(!def.biomes.includes(game.biome))return 'This industry is unavailable in this environment.';
  if(x<0||y<0||x+size>game.width||y+size>game.height)return 'The whole 2 × 2 site must fit inside the map.';
  const tile=(px,py)=>px>=0&&py>=0&&px<game.width&&py<game.height?game.tiles[py*game.width+px]:null;
  const anchor=tile(x,y);
  if(def.terrain&&!def.terrain.includes(anchor.terrain))return `${def.name} needs ${def.terrain.join(', ')} terrain.`;
  let coastal=false;
  for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++){
    const px=x+dx,py=y+dy,t=tile(px,py);
    if(t.terrain==='water'||(t.terrain==='mountain'&&!def.terrain?.includes('mountain')))return 'The whole 2 × 2 site needs buildable land.';
    if(t.building||t.zone||t.road||t.rail||t.bridge||t.tunnel||game.stations.some(s=>s.x===px&&s.y===py)||game.cities.some(c=>c.x===px&&c.y===py)||game.industries.some(i=>i!==exclude&&industryContains(i,px,py)))return 'Clear all four tiles before building this industry.';
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
