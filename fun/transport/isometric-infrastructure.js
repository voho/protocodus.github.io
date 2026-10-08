import { registerAtlas, drawAtlas, worldArtRevision } from './atlas-runtime.js';
import { createSpriteCache } from './sprite-cache.js';
import { drawRailStationFallback } from './rail-station-art.js';
import { drawNativeBusStop, drawNativePort, drawNativePortal } from './native-transport-art.js';

// Upright structures use authored dimetric views. Road/rail surface textures
// remain in the ground plane and receive the shared projection exactly once.
registerAtlas({id:'isometric-infrastructure',path:'./assets/world/isometric-infrastructure-v2/atlas',columns:3,rows:2,maxCell:512,
  entries:['bus-stop',null,'port-w','port-e','port-n','port-s'].map(id=>id&&'isometric:'+id)});
registerAtlas({id:'isometric-rail-station',path:'./assets/world/isometric-rail-station/atlas',columns:1,rows:1,maxCell:512,
  entries:['isometric:train-stop']});
registerAtlas({id:'isometric-portals',path:'./assets/world/isometric-portals-regenerated-v3/atlas',columns:3,rows:3,maxCell:256,
  entries:['road-e','road-s','road-w','road-n','rail-e','rail-s','rail-w','rail-n',null].map(id=>id&&'portal:'+id)});

export const cardinalDirection=(dx,dy)=>Math.abs(dx)>Math.abs(dy)?dx>0?'e':'w':dy>0?'s':'n';
// Atlas cells share one dimetric camera. Scaling both axes equally preserves
// their 2:1 ground directions; keep the pavement's lower contact point stable.
export const isometricStationBounds=()=>({left:-36,top:-54,size:72});
function drawStationArt(c,id,x,y,size,pixelScale){
  if(drawAtlas(c,id,x,y,size,size,{pixelScale}))return true;
  if(id==='isometric:train-stop')return drawRailStationFallback(c,x,y,size);
  const heading={e:Math.atan2(1,2),s:Math.atan2(1,-2),w:Math.atan2(-1,-2),n:Math.atan2(-1,2)}[id.split('-').at(-1)]||0;
  c.save();
  let drawn=false;
  if(id==='isometric:bus-stop'){c.translate(x+size/2,y+size*.75);c.scale(size/72,size/72);drawn=drawNativeBusStop(c);}
  else if(id.startsWith('isometric:port-')){c.translate(x+size/2,y+size*.75);c.scale(size/72,size/72);drawn=drawNativePort(c,{heading});}
  else if(id.startsWith('portal:')){c.translate(x+size/2,y+size*35/44);c.scale(size/44,size/44);drawn=drawNativePortal(c,{mode:id.includes('rail-')?'rail':'road',heading});}
  c.restore();return drawn;
}
// Reflection swaps the two world axes while leaving verticals, physical scale
// and the registered ground centre intact. Rotation would tilt the building.
function drawStopArt(c,id,x,y,size,pixelScale,axis='x'){
  if(axis!=='y')return drawStationArt(c,id,x,y,size,pixelScale);
  c.save();c.translate(2*x+size,0);c.scale(-1,1);
  const drawn=drawStationArt(c,id,x,y,size,pixelScale);c.restore();return drawn;
}
export function drawIsometricInfrastructure(c,kind,x,y,w,h,pixelScale=1){
  const id=kind==='port'?'isometric:port-w':['bus-stop','train-stop'].includes(kind)?'isometric:'+kind:kind==='road-tunnel'?'portal:road-e':kind==='rail-tunnel'?'portal:rail-e':null;
  const size=Math.min(w,h);
  return id?drawStationArt(c,id,x+(w-size)/2,y+(h-size)/2,size,pixelScale):false;
}
export function drawIsometricStop(c,mode,x,y,pixelScale=1,axis='x'){const{left,top,size}=isometricStationBounds(mode);return drawStopArt(c,'isometric:'+(mode==='rail'?'train-stop':'bus-stop'),x+left,y+top,size,pixelScale,axis);}
export function drawIsometricPort(c,dx,dy,x,y,pixelScale=1){const{left,top,size}=isometricStationBounds('water');return drawStationArt(c,'isometric:port-'+cardinalDirection(dx,dy),x+left,y+top,size,pixelScale);}
export function drawIsometricPortal(c,mode,dx,dy,x,y,pixelScale=1){return drawStationArt(c,'portal:'+mode+'-'+cardinalDirection(dx,dy),x-22,y-35,44,pixelScale);}

// World structures share the fleet's bounded cache of prepared zoom images.
// The direct atlas helpers above still serve arbitrary-sized menu previews.
export function createIsometricInfrastructureSprites({pixelScale=1,cache:sharedCache=null}={}){
  const scale=Math.max(.25,Number(pixelScale)||1),cache=sharedCache||createSpriteCache({limit:4*1024*1024});
  let created=0,hits=0;
  function draw(c,id,x,y,bounds,axis=null){
    cache.syncRevision(worldArtRevision());
    const key=`infrastructure:${scale}:${id}:${axis||''}`;let image=cache.get(key);
    if(image)hits++;
    else{
      image=document.createElement('canvas');image.width=image.height=Math.ceil(bounds.size*scale);
      const p=image.getContext('2d');p.scale(scale,scale);
      if(!(axis?drawStopArt(p,id,0,0,bounds.size,scale,axis):drawStationArt(p,id,0,0,bounds.size,scale)))return false;
      image.infrastructureFrame={id,pixelScale:scale,...bounds,...axis?{axis}:{}};cache.set(key,image);created++;
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
    stop:(c,mode,x,y,axis='x')=>Boolean(draw(c,'isometric:'+(mode==='rail'?'train-stop':'bus-stop'),x,y,isometricStationBounds(mode),axis)),
    stopFrame:(c,mode,x,y,axis='x')=>draw(c,'isometric:'+(mode==='rail'?'train-stop':'bus-stop'),x,y,isometricStationBounds(mode),axis),
    port:(c,dx,dy,x,y)=>Boolean(draw(c,'isometric:port-'+cardinalDirection(dx,dy),x,y,isometricStationBounds('water'))),
    portFrame:(c,dx,dy,x,y)=>draw(c,'isometric:port-'+cardinalDirection(dx,dy),x,y,isometricStationBounds('water')),
    portal:(c,mode,dx,dy,x,y)=>Boolean(draw(c,'portal:'+mode+'-'+cardinalDirection(dx,dy),x,y,{left:-22,top:-35,size:44})),
    getStats:()=>({created,hits,pixelScale:scale}),
  };
}
