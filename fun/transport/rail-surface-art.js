import { featureWorldPixels } from './sprite-art-direction.js';

// Horizontal railway material is drawn in the square world plane and receives
// the terrain's dimetric projection once. It cannot drift when artwork loads.
export const RAIL_PALETTE = Object.freeze({
  edge: '#65716f', ballast: '#aeb7b5',
  sleeper: '#6b7371', steelEdge: '#495956', steel: '#e1e7e5',
  bridgeEdge: '#60746f', bridgeDeck: '#b5c0b4', overview: '#9faa9f',
});
const HALF_GAUGE = featureWorldPixels(1.435) / 2;
const HALF_SLEEPER = featureWorldPixels(2.6) / 2;
const BED_WIDTH = featureWorldPixels(5.2);

function stroke(c, points, color, width) {
  c.beginPath();
  points.forEach(([x,y], i) => i ? c.lineTo(x,y) : c.moveTo(x,y));
  c.strokeStyle = color; c.lineWidth = width; c.stroke();
}

function offsetTrack(points, offset) {
  const normals = points.slice(1).map(([x,y], i) => {
    const dx = x-points[i][0], dy = y-points[i][1], length = Math.hypot(dx,dy);
    return [-dy/length, dx/length];
  });
  return points.map(([x,y], i) => {
    if (i === 0 || i === points.length-1) {
      const [nx,ny] = normals[i === 0 ? 0 : i-1];
      return [x+nx*offset,y+ny*offset];
    }
    const a = normals[i-1], b = normals[i], scale = offset/(1+a[0]*b[0]+a[1]*b[1]);
    return [x+(a[0]+b[0])*scale,y+(a[1]+b[1])*scale];
  });
}

/** Connected arms retain their true endpoints, including short isolated stubs. */
export function drawRailSurface(c, cx, cy, arms, { inner = 0, detailLevel = 'town' } = {}) {
  const directions = arms.filter(([dx,dy]) => Math.hypot(dx,dy) > 0).map(([dx,dy]) => {
    const length = Math.hypot(dx,dy), ux = dx/length, uy = dy/length;
    return { ux, uy, reach: 16*length, end: [cx+dx*16,cy+dy*16] };
  });
  if (!directions.length) return false;
  const paths = [], unused = new Set(directions);
  if (!inner && directions.length === 2) {
    // A single joined pair keeps both steel rails continuous around a turn.
    paths.push([directions[0].end,[cx,cy],directions[1].end]);
  } else {
    for (const a of directions) {
      if (!unused.has(a)) continue;
      const b = !inner && directions.find(other => unused.has(other) && other !== a && a.ux*other.ux+a.uy*other.uy < -.99);
      if (b) { paths.push([a.end,[cx,cy],b.end]); unused.delete(b); }
      else paths.push([[cx+a.ux*inner,cy+a.uy*inner],a.end]);
      unused.delete(a);
    }
  }
  c.save();
  // Tile clipping prevents the shoulders of bends/junctions entering a neighbor
  // that has no railway. The mesh later applies the same clip on sloping ground.
  c.beginPath(); c.rect(cx-16,cy-16,32,32); c.clip();
  c.lineCap = 'butt'; c.lineJoin = 'round';
  for (const [color,width] of [[RAIL_PALETTE.edge,BED_WIDTH],[RAIL_PALETTE.ballast,BED_WIDTH-1.1]])
    for (const points of paths) stroke(c,points,color,width);
  for (const {ux,uy,reach} of directions) {
    for (let distance = Math.max(2,inner+2); distance < reach; distance += detailLevel === 'region' ? 8 : 4.5) {
      const x = cx+ux*distance, y = cy+uy*distance;
      stroke(c,[[x-uy*HALF_SLEEPER,y+ux*HALF_SLEEPER],[x+uy*HALF_SLEEPER,y-ux*HALF_SLEEPER]],RAIL_PALETTE.sleeper,1.55);
    }
  }
  for (const offset of [-HALF_GAUGE,HALF_GAUGE]) for (const points of paths) {
    const rail = offsetTrack(points,offset);
    stroke(c,rail,RAIL_PALETTE.steelEdge,1.5);
    stroke(c,rail,RAIL_PALETTE.steel,.8);
  }
  c.restore(); return true;
}

export function drawRailPortrait(c, kind, x, y, width, height) {
  c.save(); c.translate(x+width/2,y+height/2); c.scale(width/32,height/32);
  if (kind === 'rail-bridge') {
    stroke(c,[[0,-16],[0,16]],RAIL_PALETTE.bridgeEdge,17);
    stroke(c,[[0,-16],[0,16]],RAIL_PALETTE.bridgeDeck,15);
  }
  drawRailSurface(c,0,0,[[0,-1],[0,1]]);
  c.restore(); return true;
}
