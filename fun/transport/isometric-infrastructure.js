import { registerAtlas, drawAtlas, atlasAvailable } from './atlas-runtime.js';

// Upright structures use authored dimetric views. Road/rail surface textures
// remain in the ground plane and receive the shared projection exactly once.
registerAtlas({id:'isometric-infrastructure',path:'./assets/world/isometric-infrastructure/atlas',columns:3,rows:2,
  entries:['bus-stop','train-stop','port-w','port-e','port-n','port-s'].map(id=>'isometric:'+id)});
registerAtlas({id:'isometric-portals',path:'./assets/world/isometric-portals/atlas',columns:3,rows:3,
  entries:['road-e','road-s','road-w','road-n','rail-e','rail-s','rail-w','rail-n',null].map(id=>id&&'portal:'+id)});

export const cardinalDirection=(dx,dy)=>Math.abs(dx)>Math.abs(dy)?dx>0?'e':'w':dy>0?'s':'n';
export function drawIsometricInfrastructure(c,kind,x,y,w,h,pixelScale=1){
  const id=kind==='port'?'isometric:port-w':['bus-stop','train-stop'].includes(kind)?'isometric:'+kind:kind==='road-tunnel'?'portal:road-e':kind==='rail-tunnel'?'portal:rail-e':null;
  return id?drawAtlas(c,id,x,y,w,h,{pixelScale}):false;
}
export function drawIsometricStop(c,mode,x,y,pixelScale=1){return drawAtlas(c,'isometric:'+(mode==='rail'?'train-stop':'bus-stop'),x-12,y-32,24,36,{pixelScale});}
export function drawIsometricPort(c,dx,dy,x,y,pixelScale=1){return drawAtlas(c,'isometric:port-'+cardinalDirection(dx,dy),x-35,y-48,70,64,{pixelScale});}
export function drawIsometricPortal(c,mode,dx,dy,x,y,pixelScale=1){return drawAtlas(c,'portal:'+mode+'-'+cardinalDirection(dx,dy),x-22,y-35,44,44,{pixelScale});}

// Glass and lanterns measured on the final 256px dimetric masters. Coordinates
// returned here share the drawing functions' local origin; the renderer only
// translates them to the station center, never projects or rotates the panes.
const stationPanes={
  'bus-stop':[[67,116,5,18],[162,79,5,20]],
  'train-stop':[[80,141,4,6]],
  'port-w':[[43,137,5,11],[103,144,4,10],[161,138,5,10]],
  'port-e':[[150,155,5,11],[207,146,5,11],[59,87,5,9]],
  'port-n':[[75,67,5,10],[153,70,5,11],[151,109,5,10]],
  'port-s':[[43,143,5,11],[106,146,4,10],[172,87,5,9]],
};
export function isometricStationLights(mode,dx=-1,dy=0){
  const port=mode==='water',kind=port?'port-'+cardinalDirection(dx,dy):mode==='rail'?'train-stop':'bus-stop';
  if(!atlasAvailable('isometric:'+kind))return [];
  const width=port?70:24,height=port?64:36,left=port?-35:-12,top=port?-48:-32;
  return stationPanes[kind].map(([x,y,w,h])=>[left+x/256*width,top+y/256*height,w/256*width,h/256*height]);
}
