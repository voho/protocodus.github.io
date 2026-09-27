import { BIOME_NATURE } from './terrain-sprites.js';
import { seedNumber, hashNoise } from './world-noise.js';
import { generatedElevation } from './world-tiles.js';

const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const smooth=n=>{const t=clamp(n,0,1);return t*t*(3-2*t);};

// Recipe7 only. Old broad highland shelves become valleys between local peaks
// and short ridges. Everything is stored in the existing elevation field; no
// decorative mountain or second world-sized height/object array is introduced.
export function applyMountainReliefV7(context,biome,seed,{width,height}){
  const {tiles,starterX,starterY,land}=context,numericSeed=seedNumber(seed),features=[];
  const openingDistance=(x,y)=>Math.hypot(Math.max(starterX-40-x,0,x-starterX-64),Math.max(starterY-32-y,0,y-starterY-32));
  const tile=(x,y)=>x>=0&&y>=0&&x<width&&y<height?tiles[y*width+x]:null;
  // Candidate spacing stays in tile units even on a2048² continent. Jitter,
  // missing cells and asymmetric companion peaks prevent a regular peak grid.
  for(let cy=0;cy<Math.ceil(height/40);cy++)for(let cx=0;cx<Math.ceil(width/40);cx++){
    if(hashNoise(cx,cy,numericSeed+7403)>.78)continue;
    let best=null,score=-Infinity;
    for(let attempt=0;attempt<6;attempt++){
      const x=cx*40+Math.floor(3+hashNoise(cx*7+attempt,cy,numericSeed+7411)*34),y=cy*40+Math.floor(3+hashNoise(cx,cy*7+attempt,numericSeed+7417)*34),t=tile(x,y);
      if(!t||x<16||y<16||x>=width-16||y>=height-16||t.terrain==='water'||t.elevation<.565||openingDistance(x,y)<26)continue;
      const value=t.elevation+hashNoise(x,y,numericSeed+7421)*.065;
      if(value>score){score=value;best={x,y};}
    }
    if(!best)continue;
    const {x,y}=best;let dry=true;
    for(let dy=-11;dy<=11&&dry;dy++)for(let dx=-11;dx<=11;dx++)if(Math.abs(dx)+Math.abs(dy)<=11&&tile(x+dx,y+dy)?.terrain==='water'){dry=false;break;}
    if(!dry)continue;
    const roll=hashNoise(x,y,numericSeed+7433),crest=roll<.58?1:roll<.84?15/16:14/16;
    const angle=hashNoise(x,y,numericSeed+7439)*Math.PI*2,length=3+hashNoise(x,y,numericSeed+7451)*4;
    const plateau=biome==='desert'&&roll<.48?1.5:0,falloff=.072+hashNoise(x,y,numericSeed+7457)*.012;
    const peaks=[{x,y,height:crest,plateau}];
    if(hashNoise(x,y,numericSeed+7459)<.68){
      peaks.push({x:Math.round(x+Math.cos(angle)*length),y:Math.round(y+Math.sin(angle)*length),height:Math.max(.82,crest-1/16),plateau:0});
      if(roll<.35)peaks.push({x:Math.round(x-Math.cos(angle+.4)*length*.65),y:Math.round(y-Math.sin(angle+.4)*length*.65),height:crest-2/16,plateau:0});
    }
    features.push({x,y,peaks,falloff,detail:BIOME_NATURE[biome].mountains[Math.floor(hashNoise(x,y,numericSeed+7481)*BIOME_NATURE[biome].mountains.length)]});
  }
  // Continuous compression retains broad lowlands and river geography. The
  // opening corridor is exact, with a12-tile blend outside its protected area.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const t=tiles[y*width+x];if(t.terrain==='water'||t.elevation<=.46)continue;
    const dx=Math.max(starterX-40-x,0,x-starterX-64),dy=Math.max(starterY-32-y,0,y-starterY-32);
    if(!dx&&!dy)continue;
    // Outside the small opening collar smooth() is exactly1. Avoid millions
    // of square roots while retaining the original arithmetic inside it.
    const blend=dx>=12||dy>=12?1:smooth(Math.hypot(dx,dy)/12);
    const old=t.elevation,base=.46+(old-.46)*.22;
    t.elevation=generatedElevation(Math.round((old+(base-old)*blend)*1024)/1024);
    if((t.terrain==='mountain'||t.terrain==='rock')&&t.elevation<.595){t.terrain=land;t.detail=biome==='tundra'?'lichen':biome==='desert'?'dry-grass':'grass-tufts';}
    else if(t.terrain==='mountain'&&t.elevation<.665){t.terrain='rock';t.detail=biome==='desert'?'canyon':'glacial';}
  }
  for(const feature of features){
    const xs=feature.peaks.map(p=>p.x),ys=feature.peaks.map(p=>p.y),x0=Math.max(0,Math.min(...xs)-13),x1=Math.min(width-1,Math.max(...xs)+13),y0=Math.max(0,Math.min(...ys)-13),y1=Math.min(height-1,Math.max(...ys)+13);
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const t=tiles[y*width+x];if(t.terrain==='water'||openingDistance(x,y)<12)continue;
      let target=t.elevation;
      for(const peak of feature.peaks)target=Math.max(target,peak.height-Math.max(0,Math.hypot(x-peak.x,y-peak.y)-peak.plateau)*feature.falloff);
      if(target<=t.elevation)continue;
      // Quarter engineering-level steps retain crisp, buildable terraces while
      // the maximum gradient remains below the displayed .5-level slope cap.
      t.elevation=generatedElevation(Math.max(t.elevation,Math.min(1,Math.round(target*64)/64)));
      if(t.elevation>=.665){t.terrain='mountain';t.detail=feature.detail;}
      else if(t.elevation>=.595){t.terrain='rock';t.detail=biome==='desert'?'canyon':'glacial';}
    }
  }
  return {features:features.length,summits:features.map(({x,y,peaks})=>({x,y,height:peaks[0].height}))};
}
