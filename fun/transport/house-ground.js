import { createSpriteCache } from './sprite-cache.js';
import { BUILDING_PALETTES, BUILDING_REGISTRATION, SPRITE_SCALE, featureMasterPixels } from './sprite-art-direction.js';

const grounds=createSpriteCache({limit:18*1024*1024});
const identities=new WeakMap();let nextIdentity=0,prepared=0;
const rgb=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
const distance=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);
const center=BUILDING_REGISTRATION.groundCenterMaster;
// The fenced garden is inset from the shared 10m architectural envelope.
const halfWidth=featureMasterPixels(BUILDING_REGISTRATION.architecturalEnvelopeMetresPerTile*.96);
const slope=BUILDING_REGISTRATION.groundEdgeSlope;
function groundLike([r,g,b],biome){
  if(biome==='tundra')return Math.max(r,g,b)-Math.min(r,g,b)<36&&g>=r-8&&b>=r-22&&Math.min(r,g,b)>140;
  if(biome==='desert')return r>=g*.98&&r<g*1.32&&g>b*1.13&&g<b*1.8&&g>124&&r<235;
  return g>r*1.02&&g>b*1.2&&g<218&&g>85&&r>g*.65&&b>g*.35;
}
function gardenPoint(px,py){
  const dx=Math.abs(px-center[0]),back=center[1]-halfWidth*slope+dx*slope,front=center[1]+halfWidth*slope-dx*slope;
  // Keep the fence gutter and the complete central architectural contact area.
  const inside=dx<halfWidth-4&&py>back+4&&py<front-4;
  const architecture=dx<72&&py<218-dx*.16;
  return {eligible:inside&&!architecture,seed:inside&&!architecture&&py>=215&&py>front-18};
}

// This is a connected garden-plane mask, not a green key. A ground-like colour
// can only clear in the registered plane, outside the architectural core, and
// in a broad low-contrast region connected to exposed foreground lawn. Object
// contours are barriers: enclosed green roofs and tree crowns keep their whole
// interior, rather than losing their fill while retaining only an edge ring.
export function houseTerrainCutout(atlas,cell,biome,{authoredTransparent=false}={}){
  let identity=identities.get(atlas);if(!identity){identity=++nextIdentity;identities.set(atlas,identity);}
  const key=`${identity}:${biome}:${cell}:${authoredTransparent?'authored':'legacy'}`,cached=grounds.get(key);if(cached)return cached;
  const canvas=document.createElement('canvas');canvas.width=atlas.naturalWidth;canvas.height=atlas.naturalHeight;
  const c=canvas.getContext('2d',{willReadFrequently:true});c.drawImage(atlas,0,0);
  // Registered current families author bare ground as transparent. Trust that
  // reviewed source contract: a shrub must never become a colour-key candidate.
  if(authoredTransparent){grounds.set(key,canvas);prepared++;return canvas;}
  const pixels=c.getImageData(0,0,canvas.width,canvas.height),data=pixels.data,original=new Uint8ClampedArray(data),scale=cell/SPRITE_SCALE.masterCellPixels;
  const p=BUILDING_PALETTES[biome]||BUILDING_PALETTES.taiga;
  const groundColors=[rgb(p.ground),...(biome==='tundra'?[rgb(p.snow)]:[])];
  const protectedColors=Object.entries(p).filter(([name])=>name!=='ground'&&name!=='snow').map(([,color])=>rgb(color));
  const materialProtected=color=>protectedColors.some(material=>distance(color,material)<=24)&&!groundColors.some(ground=>distance(color,ground)<=12);
  const step=Math.max(1,Math.round(scale)),area=cell*cell;
  for(let kind=0;kind<9;kind++){
    const ox=kind%3*cell,oy=Math.floor(kind/3)*cell,eligible=new Uint8Array(area),seeds=new Uint8Array(area),colors=new Uint8Array(area*3),histogram=new Map();
    const index=(x,y)=>((oy+y)*canvas.width+ox+x)*4;
    for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
      const n=index(x,y),position=y*cell+x,plane=gardenPoint((x+.5)/scale,(y+.5)/scale),color=[original[n],original[n+1],original[n+2]];
      // Antialiased fence and plant edges retain their exact source opacity.
      if(!plane.eligible||original[n+3]<220||!groundLike(color,biome)||materialProtected(color))continue;
      let contrast=0;
      for(const [tx,ty] of [[x-step,y],[x+step,y],[x,y-step],[x,y+step]]){
        if(tx<0||ty<0||tx>=cell||ty>=cell)continue;
        const neighbour=index(tx,ty);
        contrast=Math.max(contrast,distance(color,[original[neighbour],original[neighbour+1],original[neighbour+2]]));
      }
      if(contrast>=30)continue;
      eligible[position]=1;seeds[position]=Number(plane.seed);colors.set(color,position*3);
      if(plane.seed){
        // Learn small painted-light variation from the trusted foreground only.
        // Canonical materials remain excluded before any adaptive classification.
        const bin=color.map(value=>Math.floor(value/12)).join(':');
        const entry=histogram.get(bin)||{count:0,sum:[0,0,0]};entry.count++;color.forEach((value,i)=>entry.sum[i]+=value);histogram.set(bin,entry);
      }
    }
    const dominant=[...histogram.values()].sort((a,b)=>b.count-a.count)[0];
    if(!dominant||dominant.count<Math.max(2,8*scale*scale))continue;
    const learned=dominant.sum.map(value=>value/dominant.count),targets=[...groundColors,learned];
    for(let n=0;n<area;n++)if(eligible[n]&&!targets.some(target=>distance(colors.subarray(n*3,n*3+3),target)<64))eligible[n]=0;
    const seen=new Uint8Array(area),queue=new Int32Array(area);
    for(let start=0;start<area;start++){
      if(!eligible[start]||seen[start])continue;
      let count=0,end=1,seedCount=0,seedMinX=cell,seedMaxX=0,minX=cell,maxX=0,minY=cell,maxY=0;queue[0]=start;seen[start]=1;
      while(count<end){
        const position=queue[count++],x=position%cell,y=Math.floor(position/cell);seedCount+=seeds[position];
        if(seeds[position]){seedMinX=Math.min(seedMinX,x);seedMaxX=Math.max(seedMaxX,x);}
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        for(const next of [x>0?position-1:-1,x+1<cell?position+1:-1,y>0?position-cell:-1,y+1<cell?position+cell:-1])if(next>=0&&eligible[next]&&!seen[next]){seen[next]=1;queue[end++]=next;}
      }
      // Thin colour strips and disconnected/ambiguous painted regions stay.
      if(seedCount<Math.max(2,4*scale*scale)||seedMaxX-seedMinX+1<24*scale||count<Math.max(4,40*scale*scale)||maxX-minX+1<8*scale||maxY-minY+1<8*scale)continue;
      for(let n=0;n<count;n++){const position=queue[n];data[index(position%cell,Math.floor(position/cell))+3]=0;}
    }
  }
  c.putImageData(pixels,0,0);grounds.set(key,canvas);prepared++;return canvas;
}

export function houseGroundStats(){return{...grounds.getStats(),prepared};}
