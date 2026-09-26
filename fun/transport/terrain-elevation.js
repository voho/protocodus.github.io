import { noise } from './world-noise.js';

export const TERRAIN_LEVELS = 16;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
// Elevation remains the saved source of truth. Old companies gain relief
// without regenerating their geography or storing another height per tile.
export function terrainElevation(tile) {
  if (tile?.terrain === 'water') return 0;
  const fallback = tile?.terrain === 'mountain' ? .78 : tile?.terrain === 'rock' ? .63 : .3;
  return clamp(Number.isFinite(tile?.elevation) ? tile.elevation : fallback, 0, 1) * TERRAIN_LEVELS;
}
// Engineering uses discrete levels; natural relief retains the saved precision.
export function terrainLevel(tile) { return Math.round(terrainElevation(tile)); }
const tileAt = (game, x, y) => game.tiles[clamp(y, 0, game.height - 1) * game.width + clamp(x, 0, game.width - 1)];

// Cubic B-splines have matching values AND slopes at every tile boundary.
// The nonnegative weights cannot invent peaks, pits or negative shore heights.
function basis(t) {
  const u = 1 - t, t2 = t * t;
  return { w: [u*u*u/6, (3*t2*t-6*t2+4)/6, (-3*t2*t+3*t2+3*t+1)/6, t2*t/6],
    d: [-u*u/2, 1.5*t2-2*t, -1.5*t2+t+.5, t2/2] };
}
export function sampleTerrainHeight(game, x, y) {
  const gx = Math.floor(x-.5), gy = Math.floor(y-.5), bx = basis(x-.5-gx), by = basis(y-.5-gy);
  let height = 0, dx = 0, dy = 0;
  for (let j=0;j<4;j++) for (let i=0;i<4;i++) {
    const h = terrainElevation(tileAt(game,gx+i-1,gy+j-1));
    height += h*bx.w[i]*by.w[j]; dx += h*bx.d[i]*by.w[j]; dy += h*bx.w[i]*by.d[j];
  }
  return {height, dx, dy};
}
const COLORS = {
  taiga: { low:[105,134,88], high:[146,157,116], rock:[147,148,131], wet:[89,120,95], dry:[154,147,108], sand:[177,167,128], snow:[207,216,199] },
  tundra: { low:[159,177,162], high:[214,220,207], rock:[159,170,163], wet:[128,156,150], dry:[174,171,143], sand:[184,184,164], snow:[224,230,217] },
  desert: { low:[187,160,112], high:[218,197,153], rock:[170,146,117], wet:[149,160,116], dry:[203,176,133], sand:[211,185,139], snow:[224,223,203] },
};
function groundColor(tile, biome, variation = 0, moisture = .5) {
  const p = COLORS[biome] || COLORS.taiga, h = terrainElevation(tile)/TERRAIN_LEVELS;
  const stone = tile.terrain === 'mountain' ? .42 : tile.terrain === 'rock' ? .25 : 0;
  const wet = ['marsh','reeds'].includes(tile.detail) ? .42 : tile.terrain === 'forest' ? .12 : Math.max(0,moisture-.53)*.55;
  const dry = Math.max(0,.51-moisture)*.85;
  const frozen = tile.terrain === 'snow' || ['glacier','ice'].includes(tile.detail) || (biome === 'tundra' && tile.detail === 'glacial');
  const surface = tile.terrain === 'sand' ? p.sand : frozen || tile.detail === 'saltflat' ? p.snow : null;
  return p.low.map((v,i) => {
    let color = (v+(p.high[i]-v)*h)*(1-stone)+p.rock[i]*stone;
    color = color*(1-wet)+p.wet[i]*wet;
    color = color*(1-dry)+p.dry[i]*dry;
    const cover = tile.detail === 'glacier' ? .58 : .36;
    return (surface ? color*(1-cover)+surface[i]*cover : color)+variation;
  });
}
function light(dx, dy) {
  const nx = -dx*1.2, ny = -dy*1.2;
  // Retain a readable northwest-facing slope without embossed dark contours.
  return 1 + clamp(((-.48*nx-.62*ny+.62)/Math.hypot(nx,ny,1)-.62)*.34, -.19, .12);
}
function soilVariation(x,y,seed) {
  return (noise(x,y,seed+619,23)-.5)*15+(noise(x,y,seed+631,5.3)-.5)*9;
}
function soilMoisture(x,y,seed) {
  return noise(x+noise(x,y,seed+659,13)*8,y,seed+647,9.7);
}

// Only rasterize the requested chunk. Cost and temporary memory are independent
// of the world size; the renderer's existing LRU owns the resulting ground.
export function terrainReliefRaster(game, bounds, samplesPerTile = 6) {
  const {x0,y0,x1,y1} = bounds, width = (x1-x0)*samplesPerTile, height = (y1-y0)*samplesPerTile;
  const stride = x1-x0+4, rows = y1-y0+4, field = new Float32Array(stride*rows*5), seed=game.seed||0;
  for(let y=0;y<rows;y++)for(let x=0;x<stride;x++){
    const wx=x0+x-2, wy=y0+y-2, tile=tileAt(game,wx,wy), offset=(y*stride+x)*5;
    const color=groundColor(tile,game.biome,soilVariation(wx,wy,seed),soilMoisture(wx,wy,seed));
    field[offset]=terrainElevation(tile);field.set(color,offset+1);
    field[offset+4]=tile.terrain==='mountain'?1:tile.terrain==='rock'?.65:0;
  }
  const axis = count => Array.from({length:count},(_,p)=>{
    const phase=((p%samplesPerTile)+.5)/samplesPerTile-.5, cell=Math.floor(p/samplesPerTile)+Math.floor(phase);
    return {index:cell+1,...basis(phase-Math.floor(phase))};
  });
  const xs=axis(width),ys=axis(height),pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const bx=xs[x],by=ys[y];let dx=0,dy=0,r=0,g=0,b=0,geology=0;
    for(let j=0;j<4;j++)for(let i=0;i<4;i++){
      const offset=((by.index+j)*stride+bx.index+i)*5,w=bx.w[i]*by.w[j];
      dx+=field[offset]*bx.d[i]*by.w[j];dy+=field[offset]*bx.w[i]*by.d[j];
      r+=field[offset+1]*w;g+=field[offset+2]*w;b+=field[offset+3]*w;
      geology+=field[offset+4]*w;
    }
    const shade=light(dx,dy),out=(y*width+x)*4;
    // World-anchored grain breaks up smooth grass without repeating tile stamps.
    const wx=(x0*samplesPerTile+x+.5)/samplesPerTile,wy=(y0*samplesPerTile+y+.5)/samplesPerTile;
    const baseGrain=(noise(wx,wy,seed+673,1.4)-.5)*5+(noise(wx,wy,seed+683,.31)-.5)*2.8;
    // Exposed geology continues between individual outcrops. A restrained
    // material field avoids isolated rock stickers on perfectly smooth ground.
    const stoneGrain=geology*((noise(wx+wy*.35,wy*.65,seed+691,2.1)-.5)*22+(noise(wx-wy*.2,wy,seed+701,.47)-.5)*8);
    const grain=baseGrain+stoneGrain;
    pixels[out]=r*shade+grain;pixels[out+1]=g*shade+grain;pixels[out+2]=b*shade+grain*.8;pixels[out+3]=255;
  }
  return {width,height,pixels};
}

// Overview keeps the same elevation ramp, with cheap central-difference shading
// rather than evaluating a full surface at every sample of a continent.
export function terrainOverviewColor(game, x, y) {
  const color=groundColor(tileAt(game,x,y),game.biome,soilVariation(x,y,game.seed||0),soilMoisture(x,y,game.seed||0));
  const height=(x,y)=>terrainElevation(tileAt(game,x,y));
  const dx=(height(x+1,y)-height(x-1,y))/2;
  const dy=(height(x,y+1)-height(x,y-1))/2, shade=light(dx,dy);
  const [r,g,b]=color.map(v=>Math.round(clamp(v*shade,0,255)));
  return (255<<24)|(b<<16)|(g<<8)|r;
}
