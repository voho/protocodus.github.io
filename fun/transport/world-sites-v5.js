import { INDUSTRIES } from './data.js';
import { buildingFootprint, buildingTiles, placeBuildingSite } from './building-sites.js';
import { industryFootprint, industrySize, industryTiles, industrySiteProblem } from './industry-sites.js';

// Recipe 5 allocates real plots after the unchanged natural-world recipe. A
// temporary occupancy byte per tile keeps continental placement independent of
// the number of factories/towns; saved worlds still store only their anchors.
export function allocateGeneratedSites(game) {
  const reserved = new Uint8Array(game.tiles.length), large = [];
  const tile = (x,y) => x>=0&&y>=0&&x<game.width&&y<game.height ? game.tiles[y*game.width+x] : null;
  const mark = (points,value=1) => { for(const p of points) reserved[p.y*game.width+p.x]=value; };
  for(let index=0;index<game.tiles.length;index++) {
    const t=game.tiles[index],x=index%game.width,y=Math.floor(index/game.width);
    if(t.road||t.rail||t.bridge||t.tunnel||t.zone)reserved[index]=1;
    if(!t.building)continue;
    const size=buildingFootprint(t.building.kind);
    if(size>1){large.push({x,y,building:t.building,size});t.building=null;}
    else {t.building.footprint=1;reserved[index]=1;}
  }
  mark([...(game.cities||[]),...(game.stations||[])]);
  for(const industry of game.industries)mark(industryTiles(industry));

  const clear = (x,y,size,allowMountain=false) => {
    if(x<0||y<0||x+size>game.width||y+size>game.height)return false;
    for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++) {
      const index=(y+dy)*game.width+x+dx,t=game.tiles[index];
      if(reserved[index]||t.terrain==='water'||(!allowMountain&&t.terrain==='mountain'))return false;
    }
    return true;
  };
  const besideRoad = (x,y,size) => {
    for(let d=-1;d<=size;d++)for(const [px,py]of [[x+d,y-1],[x+d,y+size],[x-1,y+d],[x+size,y+d]])if(tile(px,py)?.road)return true;
    return false;
  };
  function nearest(origin,size,valid,preferRoad=false) {
    let fallback=null,firstRadius=Infinity;
    for(let radius=0;radius<=48;radius++) {
      for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++) {
        if(radius&&Math.abs(dx)!==radius&&Math.abs(dy)!==radius)continue;
        const x=origin.x+dx,y=origin.y+dy;if(!valid(x,y))continue;
        if(!preferRoad||besideRoad(x,y,size))return{x,y};
        if(!fallback){fallback={x,y};firstRadius=radius;}
      }
      // Give a nearby street frontage priority over an isolated plot, while
      // retaining a bounded move around the building's original neighborhood.
      if(fallback&&radius>=firstRadius+3)return fallback;
    }
    return fallback;
  }

  for(const industry of game.industries) {
    const size=industryFootprint(industry.kind);if(industrySize(industry)===size)continue;
    mark(industryTiles(industry),0);
    const def=INDUSTRIES[industry.kind],valid=(x,y)=> {
      if(!clear(x,y,size,def.terrain?.includes('mountain')))return false;
      if(def.terrain&&!def.terrain.includes(tile(x,y).terrain))return false;
      if(def.coastal){
        let coast=false;
        for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++)for(const [ox,oy]of [[1,0],[-1,0],[0,1],[0,-1]])if(tile(x+dx+ox,y+dy+oy)?.terrain==='water')coast=true;
        if(!coast)return false;
      }
      return true;
    };
    const site=nearest(industry,size,valid);
    if(!site||industrySiteProblem(game,industry.kind,site.x,site.y,size,industry))throw new Error(`Could not allocate a ${size} × ${size} ${industry.kind} site.`);
    Object.assign(industry,site,{footprint:size});mark(industryTiles(industry));
  }
  large.sort((a,b)=>b.size-a.size||a.y-b.y||a.x-b.x);
  for(const original of large) {
    const {size,building}=original,site=nearest(original,size,(x,y)=>clear(x,y,size),true);
    if(!site)throw new Error(`Could not allocate a ${size} × ${size} ${building.kind} plot.`);
    const placed=placeBuildingSite(game,building.kind,site.x,site.y,{size,building});
    if(!placed)throw new Error(`Generated ${building.kind} plot overlaps another structure.`);
    mark(buildingTiles(placed));
  }
  return game;
}
