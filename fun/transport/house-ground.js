import { createSpriteCache } from './sprite-cache.js';

const grounds=createSpriteCache({limit:18*1024*1024});
const identities=new WeakMap();let nextIdentity=0,prepared=0;
const clamp=value=>Math.max(0,Math.min(1,value));

// This is a garden-plane mask, not a global green key. Architecture is above
// the plane; the center facade, outer fence, flowers and high-contrast foliage
// retain the authored image. Only exposed lawn, snow or bare garden soil can
// reveal the actual terrain under the house.
export function houseTerrainCutout(atlas,cell,biome){
  let identity=identities.get(atlas);if(!identity){identity=++nextIdentity;identities.set(atlas,identity);}
  const key=`${identity}:${biome}:${cell}`,cached=grounds.get(key);if(cached)return cached;
  const canvas=document.createElement('canvas');canvas.width=atlas.naturalWidth;canvas.height=atlas.naturalHeight;
  const c=canvas.getContext('2d',{willReadFrequently:true});c.drawImage(atlas,0,0);
  const pixels=c.getImageData(0,0,canvas.width,canvas.height),data=pixels.data,original=new Uint8ClampedArray(data),scale=cell/256;
  for(let kind=0;kind<9;kind++){
    // The calibrated masters use one full parcel envelope. Prestige gardens
    // are twice as wide in the world, with smaller architecture inside that
    // envelope; their exposed lawn starts behind the ordinary foreground.
    const ox=kind%3*cell,oy=Math.floor(kind/3)*cell,prestige=kind>=6,halfWidth=120;
    for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
      const px=(x+.5)/scale,py=(y+.5)/scale,dx=Math.abs(px-128),i=((oy+y)*canvas.width+ox+x)*4;
      const back=prestige?112+dx*.26:132-dx*.14,front=236-dx*.52;
      if(original[i+3]<32||dx>halfWidth-9||py>front||py<back||dx<(prestige?50:64)&&py<(prestige?155:160))continue;
      const r=original[i],g=original[i+1],b=original[i+2],max=Math.max(r,g,b),min=Math.min(r,g,b);
      // Snow gardens, arid soil and temperate lawns have separate ranges.
      // Pale stone paths are warmer than snow and less saturated than soil;
      // vivid flowers, fence wood and dark foliage remain opaque.
      const ground=biome==='tundra'?max-min<34&&g>=r-8&&b>=r-20&&max>125:
        biome==='desert'?r>g*1.06&&r<g*1.48&&g>b*1.35&&g<b*2.7&&g>85&&r<229:
        g>r*.82&&g> b*1.65&&g<218&&g>90&&r>g*.82&&r<g*1.2&&b>g*.15;
      if(!ground)continue;
      // Preserve strong leaf tips, bright blooms and object contours. Sample
      // in source-world units so the protection does not change with zoom.
      const step=Math.max(1,Math.round(2*scale));let contrast=0;
      for(const[tx,ty]of[[x-step,y],[x+step,y],[x,y-step],[x,y+step]]){
        if(tx<0||ty<0||tx>=cell||ty>=cell)continue;
        const n=((oy+ty)*canvas.width+ox+tx)*4;
        contrast=Math.max(contrast,Math.abs(r-original[n])+Math.abs(g-original[n+1])+Math.abs(b-original[n+2]));
      }
      const edge=clamp((contrast-85)/110),plane=clamp((py-back)/5)*clamp((front-py)/4);
      const alpha=Math.round(original[i+3]*(1-plane*(1-edge*.78)));
      // Grainy lawn shadows still belong to the substrate. Clear their low
      // opacity remnants so downsampling cannot turn the garden back into a
      // translucent green plate; plant/fence contours retain their strong edge.
      data[i+3]=alpha<112?0:alpha;
    }
  }
  c.putImageData(pixels,0,0);grounds.set(key,canvas);prepared++;return canvas;
}

export function houseGroundStats(){return{...grounds.getStats(),prepared};}
