import { projectTerrainPoint } from './terrain-geometry.js';
import { featureWorldPixels } from './sprite-art-direction.js';

// Upright construction surrounds the shared road/track surface. It never
// changes the deck centreline, route geometry, or the saved engineering level.
export const BRIDGE_ART_PALETTE = Object.freeze({
  concrete: '#b9c0b1', cap: '#e0dfcf', fascia: '#718177', end: '#89988c',
  steel: '#546a67', steelLight: '#aebdb3', pierLight: '#b4baaa', pierShade: '#728278',
  foot: '#566b61', shadow: '#263e3538',
});
const HALF_WIDTH = 9 / 32, SLAB = featureWorldPixels(1.4), RAIL_HEIGHT = featureWorldPixels(1.3);
const polygon = (c, points, fill) => {
  c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.fillStyle=fill;c.fill();
};
const line = (c, points, color, width) => {
  c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.strokeStyle=color;c.lineWidth=width;c.stroke();
};
const down = (p, distance) => ({x:p.x,y:p.y+distance});

/** Paint one continuous tile of a bridge in projected world pixels. */
export function drawBridgeStructure(c, {x,y,axis='x',height=0,groundHeight=0,heightStep=12,mode='road',detailLevel='town',support=false}, paintDeck) {
  const color=BRIDGE_ART_PALETTE,rail=mode==='rail';
  const point=(along,across,level=height)=>projectTerrainPoint(x+.5+(axis==='x'?along:across),y+.5+(axis==='x'?across:along),level,heightStep);
  const farA=point(-.5,-HALF_WIDTH),farB=point(.5,-HALF_WIDTH),nearA=point(-.5,HALF_WIDTH),nearB=point(.5,HALF_WIDTH);
  const clearance=Math.max(0,(height-groundHeight)*heightStep),slab=Math.min(SLAB,Math.max(1.2,clearance*.45));
  c.save();c.lineJoin='round';c.lineCap='butt';
  // A continuous offset shadow separates the span from water even at Region
  // scale; piers are sparse so the river remains open beneath a long crossing.
  const ground=[point(-.5,-HALF_WIDTH,groundHeight),point(.5,-HALF_WIDTH,groundHeight),point(.5,HALF_WIDTH,groundHeight),point(-.5,HALF_WIDTH,groundHeight)];
  polygon(c,ground.map(p=>({x:p.x+3,y:p.y+2})),color.shadow);
  if(support&&clearance>slab+2){
    const base=[point(-.065,-.14,groundHeight),point(.065,-.14,groundHeight),point(.065,.14,groundHeight),point(-.065,.14,groundHeight)];
    const top=[point(-.065,-.14),point(.065,-.14),point(.065,.14),point(-.065,.14)].map(p=>down(p,slab));
    polygon(c,[top[0],top[3],base[3],base[0]],color.pierLight);
    polygon(c,[top[3],top[2],base[2],base[3]],color.pierShade);
    polygon(c,[top[1],top[2],base[2],base[1]],color.fascia);
    line(c,[point(.07,-.2,groundHeight),point(.07,.2,groundHeight)],color.foot,1.6);
  }
  // The lower long face and the end face make this a slab, not painted asphalt.
  polygon(c,[nearA,nearB,down(nearB,slab),down(nearA,slab)],rail?color.steel:color.fascia);
  polygon(c,[farB,nearB,down(nearB,slab),down(farB,slab)],color.end);
  paintDeck();
  // Pale coping and raised handrails are recognisable even with Flat relief.
  // Half-open post spacing shares boundaries, so adjoining pieces have no
  // doubled end posts or gaps. There are no crossbars across the traffic lane.
  for(const across of [-HALF_WIDTH,HALF_WIDTH]){
    const a=point(-.5,across),b=point(.5,across),topA=down(a,-RAIL_HEIGHT),topB=down(b,-RAIL_HEIGHT);
    line(c,[a,b],rail?color.steelLight:color.concrete,1.9);
    const positions=detailLevel==='region'?[-.5]:[-.5,0];
    for(const along of positions){const p=point(along,across);line(c,[p,down(p,-RAIL_HEIGHT)],rail?color.steel:color.fascia,1.15);}
    line(c,[topA,topB],rail?color.steel:color.fascia,1.8);
    line(c,[down(topA,-.35),down(topB,-.35)],color.cap,.65);
  }
  c.restore();
}
