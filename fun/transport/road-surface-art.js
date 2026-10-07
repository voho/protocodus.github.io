import { featureWorldPixels } from './sprite-art-direction.js';

// Authored directly in the terrain plane: 6.4m carriageway and 0.8m shoulders.
// The renderer projects this once, so every slope and junction meets its tile edge.
export const ROAD_PALETTE = Object.freeze({
  edge: '#777a6f', shoulder: '#c3beaa', asphalt: '#777e78', lane: '#e7dec2',
  bridge: '#87958f', bridgeEdge: '#566760',
});
// Shared concrete/stone piers for road bridges and railway viaducts. The
// northwest face stays light, with a short southeast contact shadow.
export const BRIDGE_SUPPORT_PALETTE = Object.freeze({
  light: '#b8c1b4', shade: '#6d7e75', foot: '#5e7068',
  shadow: '#243c3438', sideShadow: '#52685e80',
});
const CARRIAGEWAY = featureWorldPixels(6.4), SHOULDER = featureWorldPixels(.8);
function stroke(c, points, color, width) {
  c.beginPath(); points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));
  c.strokeStyle=color;c.lineWidth=width;c.stroke();
}
export function drawRoadSurface(c,cx,cy,arms,{bridge=false,detailLevel='town',inner=0}={}) {
  if(!arms.length)return false;
  c.save();c.beginPath();c.rect(cx-16,cy-16,32,32);c.clip();c.lineCap='butt';c.lineJoin='round';
  const paths=arms.map(([dx,dy])=>{const length=Math.hypot(dx,dy)||1;return [[cx+dx/length*inner,cy+dy/length*inner],[cx+16*dx,cy+16*dy]];});
  for(const [color,width] of [[bridge?ROAD_PALETTE.bridgeEdge:ROAD_PALETTE.edge,CARRIAGEWAY+SHOULDER*2+1],[bridge?ROAD_PALETTE.bridge:ROAD_PALETTE.shoulder,CARRIAGEWAY+SHOULDER*2],[ROAD_PALETTE.asphalt,CARRIAGEWAY]])
    for(const path of paths)stroke(c,path,color,width);
  // Marks stop short of the junction: no intersecting dashes or painted wedges.
  for(const [dx,dy]of arms){const len=Math.hypot(dx,dy);if(!len)continue;const ux=dx/len,uy=dy/len;
    const start=Math.max(inner+2,arms.length>2?8:3);
    for(let d=start;d<16*len;d+=8)stroke(c,[[cx+ux*d,cy+uy*d],[cx+ux*Math.min(d+3.5,16*len),cy+uy*Math.min(d+3.5,16*len)]],ROAD_PALETTE.lane,detailLevel==='region'?.85:.65);
  }
  c.restore();return true;
}
export function drawRoadPortrait(c,kind,x,y,width,height){
  c.save();c.translate(x+width/2,y+height/2);c.scale(width/32,height/32);
  const painted=drawRoadSurface(c,0,0,[[0,-1],[0,1]],{bridge:kind==='road-bridge',detailLevel:'detail'});c.restore();return painted;
}
