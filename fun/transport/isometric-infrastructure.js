import { registerAtlas, drawAtlas, worldArtRevision } from './atlas-runtime.js';
import { createSpriteCache } from './sprite-cache.js';
import { drawRailStationFallback } from './rail-station-art.js';

// Upright structures use authored dimetric views. Road/rail surface textures
// remain in the ground plane and receive the shared projection exactly once.
registerAtlas({id:'isometric-infrastructure',path:'./assets/world/isometric-infrastructure-v2/atlas',columns:3,rows:2,maxCell:512,
  entries:['bus-stop',null,'port-w','port-e','port-n','port-s'].map(id=>id&&'isometric:'+id)});
registerAtlas({id:'isometric-rail-station',path:'./assets/world/isometric-rail-station/atlas',columns:1,rows:1,maxCell:256,
  entries:['isometric:train-stop']});
registerAtlas({id:'isometric-portals',path:'./assets/world/isometric-portals-v2/atlas',columns:3,rows:3,maxCell:256,
  entries:['road-e','road-s','road-w','road-n','rail-e','rail-s','rail-w','rail-n',null].map(id=>id&&'portal:'+id)});

export const cardinalDirection=(dx,dy)=>Math.abs(dx)>Math.abs(dy)?dx>0?'e':'w':dy>0?'s':'n';
// Atlas cells share one dimetric camera. Scaling both axes equally preserves
// their 2:1 ground directions; keep the pavement's lower contact point stable.
export const isometricStationBounds=mode=>mode==='water'
  ?{left:-35,top:-54,size:70}:mode==='rail'
  // The calibrated 48px one-tile parcel has transparent padding to a 64px
  // frame, so all zooms can copy whole atlas-density pixels. Pavement retains
  // the road shelter's +2.5px ground contact; the building does not grow.
  ?{left:-32,top:-60,size:64}:{left:-16,top:-28,size:32};
function drawStationArt(c,id,x,y,size,pixelScale){
  return drawAtlas(c,id,x,y,size,size,{pixelScale})||
    (id==='isometric:train-stop'&&drawRailStationFallback(c,x,y,size));
}
export function drawIsometricInfrastructure(c,kind,x,y,w,h,pixelScale=1){
  const id=kind==='port'?'isometric:port-w':['bus-stop','train-stop'].includes(kind)?'isometric:'+kind:kind==='road-tunnel'?'portal:road-e':kind==='rail-tunnel'?'portal:rail-e':null;
  const size=Math.min(w,h);
  return id?drawStationArt(c,id,x+(w-size)/2,y+(h-size)/2,size,pixelScale):false;
}
export function drawIsometricStop(c,mode,x,y,pixelScale=1){const{left,top,size}=isometricStationBounds(mode);return drawStationArt(c,'isometric:'+(mode==='rail'?'train-stop':'bus-stop'),x+left,y+top,size,pixelScale);}
export function drawIsometricPort(c,dx,dy,x,y,pixelScale=1){const{left,top,size}=isometricStationBounds('water');return drawAtlas(c,'isometric:port-'+cardinalDirection(dx,dy),x+left,y+top,size,size,{pixelScale});}
export function drawIsometricPortal(c,mode,dx,dy,x,y,pixelScale=1){return drawAtlas(c,'portal:'+mode+'-'+cardinalDirection(dx,dy),x-22,y-35,44,44,{pixelScale});}

// World structures share the fleet's bounded cache of prepared zoom images.
// The direct atlas helpers above still serve arbitrary-sized menu previews.
export function createIsometricInfrastructureSprites({pixelScale=1,cache:sharedCache=null}={}){
  const scale=Math.max(.25,Number(pixelScale)||1),cache=sharedCache||createSpriteCache({limit:4*1024*1024});
  let created=0,hits=0;
  function draw(c,id,x,y,bounds){
    cache.syncRevision(worldArtRevision());
    const key=`infrastructure:${scale}:${id}`;let image=cache.get(key);
    if(image)hits++;
    else{
      image=document.createElement('canvas');image.width=image.height=Math.ceil(bounds.size*scale);
      const p=image.getContext('2d');p.scale(scale,scale);
      if(!drawStationArt(p,id,0,0,bounds.size,scale))return false;
      image.infrastructureFrame={id,pixelScale:scale,...bounds};cache.set(key,image);created++;
    }
    // Prepared antialiasing is final: snap only the stationary upright image,
    // preserving its measured anchor and native physical-pixel dimensions.
    const transform=c.getTransform(),native=Math.abs(transform.a-scale)<1e-7&&Math.abs(transform.d-scale)<1e-7&&Math.abs(transform.b)<1e-7&&Math.abs(transform.c)<1e-7;
    // A world camera is registered to physical pixels, but projection can
    // leave its integer translation a few floating-point bits below a tie.
    // Preserve real fractional preview phases while stabilizing camera ties.
    const phaseX=Math.abs(transform.e-Math.round(transform.e))<1e-7?Math.round(transform.e):transform.e,phaseY=Math.abs(transform.f-Math.round(transform.f))<1e-7?Math.round(transform.f):transform.f;
    const left=native?(Math.round((x+bounds.left)*scale+phaseX)-transform.e)/scale:x+bounds.left,top=native?(Math.round((y+bounds.top)*scale+phaseY)-transform.f)/scale:y+bounds.top;
    c.save();c.imageSmoothingEnabled=!native;if(!native)c.imageSmoothingQuality='high';
    const frame={image,x:left,y:top,w:image.width/scale,h:image.height/scale};
    c.drawImage(image,frame.x,frame.y,frame.w,frame.h);c.restore();return frame;
  }
  return {
    stop:(c,mode,x,y)=>Boolean(draw(c,'isometric:'+(mode==='rail'?'train-stop':'bus-stop'),x,y,isometricStationBounds(mode))),
    stopFrame:(c,mode,x,y)=>draw(c,'isometric:'+(mode==='rail'?'train-stop':'bus-stop'),x,y,isometricStationBounds(mode)),
    port:(c,dx,dy,x,y)=>Boolean(draw(c,'isometric:port-'+cardinalDirection(dx,dy),x,y,isometricStationBounds('water'))),
    portFrame:(c,dx,dy,x,y)=>draw(c,'isometric:port-'+cardinalDirection(dx,dy),x,y,isometricStationBounds('water')),
    portal:(c,mode,dx,dy,x,y)=>Boolean(draw(c,'portal:'+mode+'-'+cardinalDirection(dx,dy),x,y,{left:-22,top:-35,size:44})),
    getStats:()=>({created,hits,pixelScale:scale}),
  };
}
