import { registerAtlas, drawAtlas, atlasAvailable, worldArtRevision } from './atlas-runtime.js';
import { createSpriteCache } from './sprite-cache.js';

// Upright structures use authored dimetric views. Road/rail surface textures
// remain in the ground plane and receive the shared projection exactly once.
registerAtlas({id:'isometric-infrastructure',path:'./assets/world/isometric-infrastructure-v2/atlas',columns:3,rows:2,maxCell:256,
  entries:['bus-stop','train-stop','port-w','port-e','port-n','port-s'].map(id=>'isometric:'+id)});
registerAtlas({id:'isometric-portals',path:'./assets/world/isometric-portals-v2/atlas',columns:3,rows:3,maxCell:256,
  entries:['road-e','road-s','road-w','road-n','rail-e','rail-s','rail-w','rail-n',null].map(id=>id&&'portal:'+id)});

export const cardinalDirection=(dx,dy)=>Math.abs(dx)>Math.abs(dy)?dx>0?'e':'w':dy>0?'s':'n';
// Atlas cells share one dimetric camera. Scaling both axes equally preserves
// their 2:1 ground directions; keep the pavement's lower contact point stable.
export const isometricStationBounds=mode=>mode==='water'
  ?{left:-35,top:-54,size:70}:{left:-16,top:-28,size:32};
export function drawIsometricInfrastructure(c,kind,x,y,w,h,pixelScale=1){
  const id=kind==='port'?'isometric:port-w':['bus-stop','train-stop'].includes(kind)?'isometric:'+kind:kind==='road-tunnel'?'portal:road-e':kind==='rail-tunnel'?'portal:rail-e':null;
  const size=Math.min(w,h);
  return id?drawAtlas(c,id,x+(w-size)/2,y+(h-size)/2,size,size,{pixelScale}):false;
}
export function drawIsometricStop(c,mode,x,y,pixelScale=1){const{left,top,size}=isometricStationBounds(mode);return drawAtlas(c,'isometric:'+(mode==='rail'?'train-stop':'bus-stop'),x+left,y+top,size,size,{pixelScale});}
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
      if(!drawAtlas(p,id,0,0,bounds.size,bounds.size,{pixelScale:scale}))return false;
      image.infrastructureFrame={id,pixelScale:scale,...bounds};cache.set(key,image);created++;
    }
    c.drawImage(image,x+bounds.left,y+bounds.top,image.width/scale,image.height/scale);return true;
  }
  return {
    stop:(c,mode,x,y)=>draw(c,'isometric:'+(mode==='rail'?'train-stop':'bus-stop'),x,y,isometricStationBounds(mode)),
    port:(c,dx,dy,x,y)=>draw(c,'isometric:port-'+cardinalDirection(dx,dy),x,y,isometricStationBounds('water')),
    portal:(c,mode,dx,dy,x,y)=>draw(c,'portal:'+mode+'-'+cardinalDirection(dx,dy),x,y,{left:-22,top:-35,size:44}),
    getStats:()=>({created,hits,pixelScale:scale}),
  };
}

// Glass and lanterns measured on the final 256px dimetric masters. Coordinates
// returned here share the drawing functions' local origin; the renderer only
// translates them to the station center, never projects or rotates the panes.
const stationPanes={
  'bus-stop':[[205,94,3,6],[209,94,4,6]],
  'train-stop':[[64,138,2,6],[67,138,3,6]],
  'port-w':[[66,102,4,7],[71,105,4,7],[66,110,4,7],[71,112,4,7],[93,114,5,5]],
  'port-e':[[196,145,4,5],[191,147,3,6],[196,151,4,7],[191,154,3,7],[141,140,5,5]],
  'port-n':[[191,106,4,5],[186,108,3,6],[191,112,4,7],[186,115,3,6],[160,116,5,4]],
  'port-s':[[53,145,3,7],[58,148,4,7],[53,153,3,8],[58,155,4,8],[81,160,5,4]],
};
export function isometricStationLights(mode,dx=-1,dy=0){
  const port=mode==='water',kind=port?'port-'+cardinalDirection(dx,dy):mode==='rail'?'train-stop':'bus-stop';
  if(!atlasAvailable('isometric:'+kind))return [];
  const {left,top,size}=isometricStationBounds(mode);
  return stationPanes[kind].map(([x,y,w,h])=>[left+x/256*size,top+y/256*size,w/256*size,h/256*size]);
}
