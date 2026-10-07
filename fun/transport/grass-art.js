import { noise, randomSource } from './world-noise.js';
import { paintGroundTextures } from './terrain-materials.js';

const TILE = 32;
const PALETTES = {
  taiga: { shade:'#30482d', moss:'#b1bc70', blade:'#c1d194', earth:'#796745', bloom:'#e5d9ad' },
  tundra: { shade:'#4c5c44', moss:'#c0bc83', blade:'#d0d0a3', earth:'#807458', bloom:'#e5e4c4' },
  desert: { shade:'#696143', moss:'#c5b272', blade:'#e2cc91', earth:'#907149', bloom:'#e7d0a0' },
};
const grassy = t => t && (t.terrain === 'grass' || t.terrain === 'forest');
const mottles = new Map();
const grains = new Map();
const GRAIN_SIZE = 96;
const GRAIN_VARIANTS = 8;

// A fixed-size bank of granular ground textures replaces hundreds of native
// marks per tile with batched cold-chunk pattern fills. All climates retain
// at most 24 × 96² RGBA pixels (864 KiB), independent of world size or seed.
function grainSurface(p, variant) {
  const key = `${p.shade}:${variant}`;
  if(grains.has(key))return grains.get(key);
  const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(GRAIN_SIZE,GRAIN_SIZE):document.createElement('canvas');
  canvas.width=canvas.height=GRAIN_SIZE;
  const c=canvas.getContext('2d'),pixels=c.createImageData(GRAIN_SIZE,GRAIN_SIZE);
  const colors=[p.shade,p.blade,p.earth].map(color=>[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16)));
  const r=randomSource(variant*9199+parseInt(p.shade.slice(1),16)+811);
  for(let i=0;i<pixels.data.length;i+=4){
    const roll=r();if(roll>.86)continue;
    const color=colors[roll<.42?0:roll<.73?1:2];
    pixels.data[i]=color[0];pixels.data[i+1]=color[1];pixels.data[i+2]=color[2];
    pixels.data[i+3]=Math.round((roll<.42?32:20)+r()*(roll<.42?48:42));
  }
  c.putImageData(pixels,0,0);c.scale(GRAIN_SIZE/TILE,GRAIN_SIZE/TILE);
  // Sparse soil/moss flecks suggest the surface without competing with the
  // broad moisture colors, vegetation sprites or directional slope lighting.
  for(let n=0;n<48;n++){
    const x=r()*TILE,y=r()*TILE,w=.3+r()*.85,h=.22+r()*.62;
    c.fillStyle=n%5===0?p.earth:n%2?p.blade:p.shade;c.globalAlpha=.08+r()*.1;
    c.fillRect(x,y,w,h);
    if(n%4===0)c.fillRect(x+w*.55,y+h*.6,w*.45,h*.65);
  }
  grains.set(key,canvas);return canvas;
}

function mottle(color) {
  if(mottles.has(color))return mottles.get(color);
  const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(64,64):document.createElement('canvas');
  canvas.width=canvas.height=64;
  const c=canvas.getContext('2d'),shade=c.createRadialGradient(32,32,5,32,32,32);
  shade.addColorStop(0,color);shade.addColorStop(.55,color+'88');shade.addColorStop(1,color+'00');
  c.fillStyle=shade;c.fillRect(0,0,64,64);mottles.set(color,canvas);return canvas;
}

function leaf(path, x, y, dx, dy, width) {
  const length = Math.hypot(dx,dy), nx = -dy / length * width, ny = dx / length * width;
  path.moveTo(x-nx,y-ny);path.quadraticCurveTo(x+dx*.42+nx,y+dy*.42+ny,x+dx,y+dy);
  path.quadraticCurveTo(x+dx*.32-nx,y+dy*.32-ny,x+nx,y+ny);path.closePath();
}

function grain(path, x, y, rx, ry) {
  path.moveTo(x+rx,y);path.ellipse(x,y,rx,ry,0,0,Math.PI*2);path.closePath();
}

// These are marks on the ground plane, projected once with the terrain mesh.
// Neighboring chunks replay the same world-anchored marks through a one-tile
// apron. Nothing is animated or added to the per-frame scenery list.
export function paintGrassGround(c, bounds, tile, biome, seed, profile) {
  const p = PALETTES[biome] || PALETTES.taiga, regional = profile === 'region';
  const x0 = Math.max(0,bounds.x0-1), y0 = Math.max(0,bounds.y0-1), x1 = bounds.x1+1, y1 = bounds.y1+1;
  c.save();
  // The relief color field alone left rocky hills completely smooth. Authored
  // materials cover all dry land before short vegetation is painted on top.
  paintGroundTextures(c,{x0,y0,x1,y1},tile,biome,profile,seed);
  // Small broken swards sit between the broad soil tint and individual blades.
  // Their centers use a two-tile lattice rather than repeating tile stamps.
  for(let gy=Math.floor(y0/2);gy<Math.ceil(y1/2);gy++)for(let gx=Math.floor(x0/2);gx<Math.ceil(x1/2);gx++){
    const r=randomSource(seed+Math.imul(gx,17651)+Math.imul(gy,2671)+719);
    const x=(gx*2+r()*2)*TILE,y=(gy*2+r()*2)*TILE;
    if(!grassy(tile(Math.floor(x/TILE),Math.floor(y/TILE))))continue;
    const radius=7+r()*13,color=r()>.48?p.moss:p.shade;
    c.globalAlpha=regional?.04:.08;c.drawImage(mottle(color),x-radius,y-radius,radius*2,radius*2);
  }
  const grainMasks=new Map();
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const t=tile(x,y);if(!grassy(t))continue;
    const r=randomSource(seed+Math.imul(x,17651)+Math.imul(y,2671)+877),px=x*TILE,py=y*TILE;
    const meadow=noise(x+.5,y+.5,seed+743,3.8),forest=t.terrain==='forest';
    // Registration depends only on the saved seed and world tile, never the
    // viewport, chunk boundaries or camera. Broad meadow moisture modulates
    // the grain gently without introducing a visible tile lattice.
    const variant=Math.floor(r()*GRAIN_VARIANTS),band=forest?2:meadow>.5?1:0,key=variant*3+band;
    let mask=grainMasks.get(key);if(!mask){mask=new Path2D();grainMasks.set(key,mask);}mask.rect(px,py,TILE,TILE);
  }
  // Pattern origins are fixed at world zero. Grouping only the rectangular
  // terrain masks keeps the dense grain to at most 24 inexpensive fills.
  const smoothing=c.imageSmoothingEnabled;c.imageSmoothingEnabled=false;
  for(const [key,mask]of grainMasks){
    const pattern=c.createPattern(grainSurface(p,Math.floor(key/3)),'repeat');
    pattern.setTransform({a:TILE/GRAIN_SIZE,d:TILE/GRAIN_SIZE});
    c.fillStyle=pattern;c.globalAlpha=(regional?.18:profile==='town'?.30:.38)*[.83,.97,.7][key%3];c.fill(mask);
  }
  c.imageSmoothingEnabled=smoothing;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const t=tile(x,y);if(!grassy(t))continue;
    const r=randomSource(seed+Math.imul(x,17651)+Math.imul(y,2671)+733),px=x*TILE,py=y*TILE;
    if(regional){
      c.fillStyle=p.earth;c.globalAlpha=.12;c.fillRect(px+r()*TILE,py+r()*TILE,.3+r()*.6,.25+r()*.4);
      continue;
    }
    const meadow=noise(x+.5,y+.5,seed+743,3.8),forest=t.terrain==='forest';
    const shade=new Path2D(),light=new Path2D(),earth=new Path2D(),flowers=new Path2D();
    // A jittered lattice keeps the fine grain evenly spread without aligned
    // rows. Dense swards form clustered blades; woodland uses shorter moss flecks.
    for(let n=0;n<24;n++){
      const xx=px+((n%6)+.1+r()*.8)*TILE/6,yy=py+(Math.floor(n/6)+.1+r()*.8)*8;
      const length=n%5===0?2.3+r()*2.2:1.4+r()*1.6,size=forest?.65:1,lean=(r()-.5)*.75,roll=r();
      if(profile==='town'&&n%3===0||roll>.24+meadow*.24)continue;
      const blades=roll<.22?3:2;
      for(let j=0;j<blades;j++){
        const angle=-Math.PI*.6+(j-(blades-1)/2)*.72+lean,l=length*size*(.72+r()*.6);
        const dx=Math.cos(angle)*l,dy=Math.sin(angle)*l;
        leaf(shade,xx,yy,dx,dy,.2+r()*.12);
        leaf(light,xx-.12,yy-.13,dx*.83,dy*.83,.1+r()*.07);
      }
      if(roll<.09)grain(earth,xx+.3,yy+.35,.35+r()*.5,.2+r()*.2);
    }
    // Sparse bare-soil grains and pale seed heads break up the uniform green.
    for(let n=0;n<5;n++){
      const xx=px+r()*TILE,yy=py+r()*TILE,w=.3+r()*.6;
      earth.rect(xx,yy,w,.25+r()*.4);
      if(n===0&&r()<(t.detail==='wildflowers'||t.detail==='bluebells'?.35:.045)){
        grain(flowers,xx,yy,.4,.32);
        grain(flowers,xx+1.3,yy+.65,.3,.25);
      }
    }
    c.fillStyle=p.shade;c.globalAlpha=forest?.18:.23;c.fill(shade);
    c.fillStyle=p.blade;c.globalAlpha=forest?.18:.28;c.fill(light);
    c.fillStyle=p.earth;c.globalAlpha=.12;c.fill(earth);
    c.fillStyle=p.bloom;c.globalAlpha=.35;c.fill(flowers);
  }
  c.restore();
}
