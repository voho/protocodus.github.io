import { noise } from './world-noise.js';

export const TERRAIN_LEVELS = 16;
export const LAND_HEIGHT_VALUE_COUNT = 8;
export const LAND_HEIGHT_LEVELS = LAND_HEIGHT_VALUE_COUNT - 1;
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
// Vertices have eight values (sea 0, dry land 1–7). Keep the legacy helpers
// above unchanged for frozen map recipes and saved crossing metadata.
export function landHeightLevel(tile) { return Math.round(terrainElevation(tile) / TERRAIN_LEVELS * LAND_HEIGHT_LEVELS); }
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
  taiga: { low:[82,122,62], high:[128,152,92], rock:[128,131,117], wet:[66,104,70], dry:[142,144,90], sand:[190,169,119], snow:[218,225,214] },
  tundra: { low:[112,128,100], high:[156,164,139], rock:[137,145,137], wet:[81,110,100], dry:[158,143,111], sand:[179,173,145], snow:[222,229,223] },
  desert: { low:[179,140,86], high:[214,182,129], rock:[151,130,100], wet:[127,131,86], dry:[202,163,106], sand:[216,183,129], snow:[224,220,201], oasis:[110,136,70] },
};
function groundColor(tile, biome, variation = 0, moisture = .5) {
  const p = COLORS[biome] || COLORS.taiga, h = terrainElevation(tile)/TERRAIN_LEVELS;
  const stone = tile.terrain === 'mountain' ? .5+h*.27 : tile.terrain === 'rock' ? .48 : 0;
  // Moss greens stay fresh: damp hollows and dry rises tint the ground gently,
  // so broad soil moisture never reads as cloud shadows on the land.
  const wet = clamp((moisture-.43)*.42+(tile.terrain==='forest'?.12:0)+(['marsh','reeds'].includes(tile.detail)?.38:0),0,.56)*(1-stone*.65);
  const dry = clamp((.54-moisture)*.5+Math.max(0,h-.65)*.15,0,.42)*(1-stone*.5);
  // Desert grass and woodland only grow by water: they read as green oases.
  const oasis = p.oasis && (tile.terrain === 'grass' || tile.terrain === 'forest') ? (['marsh','reeds'].includes(tile.detail) ? .82 : .7) : 0;
  const frozen = tile.terrain === 'snow' || ['glacier','ice'].includes(tile.detail) || (biome === 'tundra' && tile.detail === 'glacial');
  const alpineSnow=biome==='tundra'?clamp((h-.48)*2.15,0,.9):0;
  const surface = tile.terrain === 'sand' ? p.sand : frozen || tile.detail === 'saltflat' || alpineSnow>0 ? p.snow : null;
  const materialCover=tile.detail==='glacier'?.92:tile.detail==='ice'?.82:tile.terrain==='snow'?.52+moisture*.18+Math.max(0,h-.6)*.3:tile.terrain==='sand'?.66:tile.detail==='saltflat'?.7:frozen?.4:0;
  const cover=Math.max(materialCover,alpineSnow);
  return p.low.map((v,i) => {
    let color = (v+(p.high[i]-v)*h)*(1-stone)+p.rock[i]*stone;
    color = color*(1-wet)+p.wet[i]*wet;
    color = color*(1-dry)+p.dry[i]*dry;
    if (oasis) color = color*(1-oasis)+p.oasis[i]*oasis;
    return (surface ? color*(1-cover)+surface[i]*cover : color)+variation*(i===2?.75:1);
  });
}
function light(dx, dy) {
  const nx = -dx*1.2, ny = -dy*1.2;
  // Retain a readable northwest-facing slope without embossed dark contours.
  return 1 + clamp(((-.77*nx-.18*ny+.62)/Math.hypot(nx,ny,1)-.62)*.34, -.19, .12);
}
function soilVariation(x,y,seed) {
  return (noise(x,y,seed+619,31)-.5)*13+(noise(x,y,seed+631,4.7)-.5)*9;
}
function soilMoisture(x,y,seed) {
  const bend=(noise(x,y,seed+659,19)-.5)*11;
  return clamp((noise(x+bend,y+bend*.37,seed+647,10.7)-.5)*1.15+.5,0,1);
}

// Only rasterize the requested chunk. Cost and temporary memory are independent
// of the world size; the renderer's existing LRU owns the resulting ground.
export function terrainReliefRaster(game, bounds, samplesPerTile = 6, { lighting = true } = {}) {
  const {x0,y0,x1,y1} = bounds, width = (x1-x0)*samplesPerTile, height = (y1-y0)*samplesPerTile;
  const stride = x1-x0+4, rows = y1-y0+4, channels=7, field = new Float32Array(stride*rows*channels), seed=game.seed||0;
  for(let y=0;y<rows;y++)for(let x=0;x<stride;x++){
    const wx=x0+x-2, wy=y0+y-2, tile=tileAt(game,wx,wy), offset=(y*stride+x)*channels;
    const color=groundColor(tile,game.biome,soilVariation(wx,wy,seed),soilMoisture(wx,wy,seed));
    field[offset]=terrainElevation(tile);field.set(color,offset+1);
    field[offset+4]=tile.terrain==='mountain'?1:tile.terrain==='rock'?.65:0;
    field[offset+5]=tile.terrain==='sand'?1:game.biome==='desert'?.7:0;
    field[offset+6]=tile.terrain==='snow'||['glacier','ice','saltflat'].includes(tile.detail)?1:game.biome==='tundra'?clamp((field[offset]/TERRAIN_LEVELS-.48)*2.15,0,.9):0;
  }
  const axis = count => Array.from({length:count},(_,p)=>{
    const phase=((p%samplesPerTile)+.5)/samplesPerTile-.5, cell=Math.floor(p/samplesPerTile)+Math.floor(phase);
    return {index:cell+1,...basis(phase-Math.floor(phase))};
  });
  const xs=axis(width),ys=axis(height),pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const bx=xs[x],by=ys[y];let dx=0,dy=0,r=0,g=0,b=0,geology=0,sand=0,snow=0;
    for(let j=0;j<4;j++)for(let i=0;i<4;i++){
      const offset=((by.index+j)*stride+bx.index+i)*channels,w=bx.w[i]*by.w[j];
      dx+=field[offset]*bx.d[i]*by.w[j];dy+=field[offset]*bx.w[i]*by.d[j];
      r+=field[offset+1]*w;g+=field[offset+2]*w;b+=field[offset+3]*w;
      geology+=field[offset+4]*w;sand+=field[offset+5]*w;snow+=field[offset+6]*w;
    }
    const shade=lighting?light(dx,dy):1,out=(y*width+x)*4;
    // Continuous world-space material fields replace isolated texture stamps.
    // The same four noise samples serve every material, keeping cost bounded.
    const wx=(x0*samplesPerTile+x+.5)/samplesPerTile,wy=(y0*samplesPerTile+y+.5)/samplesPerTile;
    // Six samples a tile resolve detail down to a third of a tile; finer noise only aliases into blotches.
    const clumps=noise(wx,wy,seed+673,1.35)-.5,fine=noise(wx,wy,seed+683,.5)-.5;
    const material=noise(wx+wy*.31,wy*.77,seed+691,3.6)-.5,aggregate=noise(wx-wy*.23,wy,seed+701,.61)-.5;
    const soil=(clumps*10+fine*5+aggregate*3)*(1-snow*.6),stone=geology*(1-snow*.8)*(material*26+aggregate*11);
    const sandGrain=sand*(material*9+fine*2-clumps*2),grain=soil+stone+sandGrain;
    pixels[out]=r*shade+grain;pixels[out+1]=g*shade+grain*.94;pixels[out+2]=b*shade+grain*.72;pixels[out+3]=255;
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
