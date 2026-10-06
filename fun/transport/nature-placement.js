// The renderer and inspection share deterministic species and canopy choices.
import { noise, hashNoise } from './world-noise.js';
import { terrainElevation } from './terrain-elevation.js';

const tileAt=(game,x,y)=>x<0||y<0||x>=game.width||y>=game.height?null:game.tiles[y*game.width+x];

export function natureVariant(game,x,y,t) {
  let h=(game.seed||0)^Math.imul(x+1,374761393)^Math.imul(y+1,668265263)^Math.imul((t.variant||0)+1,1274126177);
  h=Math.imul(h^(h>>>13),1274126177);return (h^(h>>>16))>>>26;
}
export function natureDensity(game,x,y,t) {
  const seed=game.seed||0;
  if(t.terrain==='forest'){
    let neighbors=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&tileAt(game,x+dx,y+dy)?.terrain==='forest')neighbors++;
    const patch=noise(x,y,seed+2179,7.3)*.7+noise(x,y,seed+2203,19)*.3;
    // Woodland interiors form canopy, softer edges and broad open glades.
    if(neighbors<=3||patch<.3)return 1;
    return neighbors>=6&&patch>.42?3:2;
  }
  let rocky=0,min=terrainElevation(t),max=min;
  for(const [dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]]){
    const n=tileAt(game,x+dx,y+dy);if(!n)continue;
    if(n.terrain==='mountain'||n.terrain==='rock')rocky++;
    const height=terrainElevation(n);min=Math.min(min,height);max=Math.max(max,height);
  }
  const patch=noise(x,y,seed+2221,6.3),mountain=t.terrain==='mountain';
  let chance=(mountain?.045:.08)+patch*patch*(mountain?.32:.48)+Math.min(.1,(max-min)*.05);
  chance*=.55+rocky*.1125;
  if(patch<.36)chance*=.18;else if(patch>.7)chance*=1.5;
  return hashNoise(x,y,seed+2267)<chance*.18?1:0;
}
