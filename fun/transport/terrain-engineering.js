import { terrainLevel, TERRAIN_LEVELS, landHeightLevel, LAND_HEIGHT_LEVELS } from './terrain-elevation.js';
import { industryContains, industrySize } from './industry-sites.js';
import { buildingAt, buildingSize } from './building-sites.js';
import { tileSurface, surfaceHeight, previewVertexHeights } from './terrain-geometry.js';
import { stationSiteAt, stationTiles } from './station-sites.js';

export const SPAN_TOOLS = new Set(['bridge', 'railbridge', 'tunnel', 'railtunnel']);
const tileAt = (game, x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y * game.width + x] : null;
const at = (point, x, y) => point.x === x && point.y === y;
const occupied = (game, x, y) => buildingAt(game, x, y) || game.industries.some(i => industryContains(i, x, y)) || game.cities.some(c => at(c, x, y));

export function terraformProblem(game, tool, x, y) {
  const tile = tileAt(game, x, y);
  if (!tile) return 'Choose a terrain point inside the map.';
  if (!['raise', 'lower', 'level'].includes(tool)) return 'Choose Raise, Lower or Level terrain.';
  // This coordinate is a ground vertex shared by the four adjoining cells.
  // A shoreline vertex stays at sea level; occupied cells keep all corners.
  for(let dy=-1;dy<=0;dy++)for(let dx=-1;dx<=0;dx++){
    const cx=x+dx,cy=y+dy,cell=tileAt(game,cx,cy);if(!cell)continue;
    if(cell.terrain==='water')return 'Shape dry land; rivers and seas keep their shoreline.';
    if(cell.building||cell.zone||cell.road||cell.rail||cell.bridge||cell.tunnel||occupied(game,cx,cy)||stationSiteAt(game,cx,cy))return 'Clear buildings, zones and networks before changing this point’s height.';
  }
  const level = surfaceHeight(game,x,y);
  if (tool === 'raise' && level >= LAND_HEIGHT_LEVELS) return `Highest terrain level is ${LAND_HEIGHT_LEVELS}.`;
  if (tool === 'lower' && level <= 1) return 'Lowest dry-land level is 1.';
  if(tool==='raise')for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    if((dx||dy)&&tileAt(game,x+dx,y+dy)&&surfaceHeight(game,x+dx,y+dy)<level)return 'Raise neighboring points first; adjacent heights can differ by one level.';
  }
  if(tool==='raise'||tool==='lower')return occupiedHeightProblem(game,[{x,y,level:level+(tool==='raise'?1:-1)}]);
  return null;
}

// Changing one vertex can move the limited surface farther away. Compare a
// read-only local counterfactual at protected corners before committing it.
function occupiedHeightProblem(game,placements,verifyTargets=false){
  if(!placements.length)return null;
  let x0=game.width,y0=game.height,x1=0,y1=0;
  const updates=new Map();
  for(const p of placements){x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y);updates.set(String(p.y*game.width+p.x),{...tileAt(game,p.x,p.y),elevation:p.level/LAND_HEIGHT_LEVELS});}
  x0=Math.max(0,x0-LAND_HEIGHT_LEVELS-1);y0=Math.max(0,y0-LAND_HEIGHT_LEVELS-1);x1=Math.min(game.width-1,x1+LAND_HEIGHT_LEVELS);y1=Math.min(game.height-1,y1+LAND_HEIGHT_LEVELS);
  const vertices=new Set(),addCell=(x,y)=>{
    if(x<x0||y<y0||x>x1||y>y1)return;
    for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++)vertices.add((y+dy)*(game.width+1)+x+dx);
  };
  for(let y=Math.max(0,y0-2);y<=y1;y++)for(let x=Math.max(0,x0-2);x<=x1;x++){
    const tile=tileAt(game,x,y);
    if(tile.building){const size=buildingSize(tile.building);for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++)addCell(x+dx,y+dy);}
    if(tile.zone||tile.road||tile.rail||tile.bridge||tile.tunnel)addCell(x,y);
  }
  for(const p of [...game.cities,...game.stations.flatMap(stationTiles)])addCell(p.x,p.y);
  for(const industry of game.industries){const size=industrySize(industry);for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++)addCell(industry.x+dx,industry.y+dy);}
  if(!vertices.size&&!verifyTargets)return null;
  const changed={...game,tiles:new Proxy(game.tiles,{get:(tiles,key)=>updates.get(key)??Reflect.get(tiles,key)})};
  if(verifyTargets)for(const p of placements)if(surfaceHeight(changed,p.x,p.y)!==p.level)return 'Raise neighboring points first; this selection cannot reach the requested heights.';
  for(const index of vertices){const x=index%(game.width+1),y=Math.floor(index/(game.width+1));
    if(surfaceHeight(game,x,y)!==surfaceHeight(changed,x,y))return 'This change would move nearby buildings or networks. Clear them first.';
  }
  return null;
}

/** Natural growth levels a plot for free once a town builds on it: the plot's corners move to the height that needs the
 * fewest steps, as long as no corner shared with a street, another building, a site or water moves and nothing
 * built nearby settles with them. The moved corners as {x, y, level}, or null when the plot is level already or cannot
 * be levelled; the building then keeps its plinth. */
export function plotLevelPlan(game,x,y,size){
  const own=(cx,cy)=>cx>=x&&cy>=y&&cx<x+size&&cy<y+size;
  // A zoned plot nobody has built on yet has no ground to disturb.
  const kept=(cx,cy)=>{const cell=tileAt(game,cx,cy);return !cell||cell.terrain==='water'||!own(cx,cy)&&Boolean(cell.building||cell.road||cell.rail||cell.bridge||cell.tunnel||occupied(game,cx,cy)||stationSiteAt(game,cx,cy));};
  const fixed=(u,v)=>kept(u-1,v-1)||kept(u,v-1)||kept(u-1,v)||kept(u,v);
  const corners=[];
  for(let v=y;v<=y+size;v++)for(let u=x;u<=x+size;u++)corners.push({x:u,y:v,height:surfaceHeight(game,u,v),fixed:fixed(u,v)});
  if(corners.every(c=>c.height===corners[0].height))return null;
  const steps=level=>corners.reduce((sum,c)=>sum+Math.abs(c.height-level),0);
  const reach=LAND_HEIGHT_LEVELS+1;
  for(const level of [...new Set(corners.map(c=>c.height))].filter(h=>h>=1).sort((a,b)=>steps(a)-steps(b)||a-b)){
    if(corners.some(c=>c.fixed&&c.height!==level))continue;
    const placements=corners.filter(c=>c.height!==level).map(({x,y})=>({x,y,level}));
    // Keyed by tile index, as the height field reads tiles; a corner on the map's far edge keys the next row, as it always has.
    const updates=new Map(placements.map(p=>[p.y*game.width+p.x,{...tileAt(game,p.x,p.y),elevation:p.level/LAND_HEIGHT_LEVELS}]));
    const changed=previewVertexHeights(game,Math.max(0,x-reach),Math.max(0,y-reach),Math.min(game.width,x+size+reach),Math.min(game.height,y+size+reach),index=>updates.get(index));
    if(corners.some(c=>changed(c.x,c.y)!==level))continue;
    let settles=false;
    for(let v=y-reach;v<=y+size+reach&&!settles;v++)for(let u=x-reach;u<=x+size+reach;u++){
      if(u>=x&&v>=y&&u<=x+size&&v<=y+size||!fixed(u,v))continue;
      if(surfaceHeight(game,u,v)!==changed(u,v)){settles=true;break;}
    }
    if(!settles)return placements;
  }
  return null;
}

export function planTerraformStroke(game,tool,points){
  const fail=message=>({ok:false,message,placements:[],cost:0});
  if(!['raise','lower'].includes(tool)||!Array.isArray(points)||!points.length)return fail('Choose terrain points to shape.');
  const unique=new Map(),placements=[];
  for(const p of points){if(!p||!tileAt(game,p.x,p.y))return fail('Keep every terrain point inside the map.');unique.set(p.y*game.width+p.x,p);}
  for(const {x,y} of unique.values()){
    const problem=terraformProblem(game,'level',x,y);if(problem)return fail(problem);
    const level=surfaceHeight(game,x,y)+(tool==='raise'?1:-1);
    if(level<1)return fail('Lowest dry-land level is 1.');
    if(level>LAND_HEIGHT_LEVELS)return fail(`Highest terrain level is ${LAND_HEIGHT_LEVELS}.`);
    placements.push({x,y,tool,level,steps:1,unchanged:false});
  }
  const problem=occupiedHeightProblem(game,placements,true);if(problem)return fail(problem);
  return {ok:true,message:'Change each selected point by one level.',placements};
}

/** Paid area leveling targets an engineering level; it never rounds for free. */
export function planTerraformLevel(game, points, targetLevel) {
  const fail = message => ({ ok: false, message, placements: [], cost: 0 });
  if (!Array.isArray(points) || !points.length) return fail('Choose terrain points to level.');
  const first = tileAt(game, points[0]?.x, points[0]?.y);
  if (!first) return fail('Choose a terrain point inside the map.');
  targetLevel ??= Math.max(1, surfaceHeight(game,points[0].x,points[0].y));
  if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > LAND_HEIGHT_LEVELS) return fail(`Choose a terrain level from 1 to ${LAND_HEIGHT_LEVELS}.`);
  const unique = new Map(), placements = [];
  for (const point of points) {
    if (!point || !tileAt(game, point.x, point.y)) return fail('Keep the whole leveling area inside the map.');
    unique.set(point.y * game.width + point.x, point);
  }
  for (const { x, y } of unique.values()) {
    const difference = Math.abs(surfaceHeight(game,x,y)-targetLevel),unchanged=difference===0;
    const problem = !unchanged && terraformProblem(game, 'level', x, y);
    if (problem) return fail(problem);
    placements.push({ x, y, tool: 'level', level: targetLevel, steps:difference, unchanged });
  }
  for(const {x,y} of placements)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const nx=x+dx,ny=y+dy;
    if((dx||dy)&&tileAt(game,nx,ny)&&!unique.has(ny*game.width+nx)&&surfaceHeight(game,nx,ny)<targetLevel-1)return fail('Raise neighboring points first or include more land; this area cannot reach that height.');
  }
  const occupied=occupiedHeightProblem(game,placements.filter(p=>!p.unchanged));if(occupied)return fail(occupied);
  return { ok: true, message: `Level ground to ${targetLevel}.`, level: targetLevel, placements };
}

// Tiny natural grade variations are playable as level ground. Beyond that,
// the tile must describe one straight, monotonic ramp with matching side edges.
export function networkTerrainShape(game, x, y) {
  const surface = tileSurface(game, x, y), { nw, ne, se, sw, center } = surface;
  const heights = [nw.height, ne.height, se.height, sw.height, center.height];
  const span = Math.max(...heights) - Math.min(...heights);
  if (span <= .075 + 1e-9) return { kind: 'flat', axis: null, span };
  const riseX = (ne.height + se.height - nw.height - sw.height) / 2;
  const riseY = (sw.height + se.height - nw.height - ne.height) / 2;
  const axis = Math.abs(riseX) >= Math.abs(riseY) ? 'x' : 'y';
  const rise = axis === 'x' ? riseX : riseY, cross = axis === 'x' ? riseY : riseX;
  const twist = Math.abs(nw.height + se.height - ne.height - sw.height) / 2;
  const start = axis === 'x' ? (nw.height + sw.height) / 2 : (nw.height + ne.height) / 2;
  const end = axis === 'x' ? (ne.height + se.height) / 2 : (sw.height + se.height) / 2;
  const tolerance = .035;
  const monotonic = center.height >= Math.min(start,end)-tolerance && center.height <= Math.max(start,end)+tolerance;
  const straight = Math.abs(cross) <= tolerance && twist <= tolerance && monotonic;
  return { kind: straight ? 'incline' : 'complex', axis: straight ? axis : null, rise, span };
}

const NETWORK_DIRECTIONS = [[1,0],[-1,0],[0,1],[0,-1]];
const slopeMessage = 'Level this slope first. Roads and rails need flat ground or a straight uphill/downhill grade.';

// The tile a stroke must avoid or reshape: 'uneven' ground, an incline used
// 'sideways', or a 'ramp-junction' that would give the existing ramp `at` a side link.
function networkTerrainIssue(game, x, y, mode, { proposed = null, axis = null, checkNeighbors = true } = {}) {
  const tile = tileAt(game, x, y);
  if (!tile || !['road', 'rail'].includes(mode)) return null;
  if (tile.bridge || tile.tunnel || tile.structureAxis) return null;
  const index = y * game.width + x;
  const planned = proposed || new Set([index]);
  const shape = networkTerrainShape(game, x, y);
  if (shape.kind === 'complex') return { x, y, kind: 'uneven' };
  if (shape.kind === 'incline' && axis && axis !== shape.axis) return { x, y, kind: 'sideways' };
  for (const [dx, dy] of NETWORK_DIRECTIONS) {
    const nx = x + dx, ny = y + dy, neighbor = tileAt(game, nx, ny);
    if (!neighbor || (!neighbor[mode] && !planned.has(ny * game.width + nx))) continue;
    if (!networkEdgeAllowed(tile, neighbor, dx, dy, mode, game, x, y)) continue;
    const direction = dx ? 'x' : 'y';
    if (shape.kind === 'incline' && direction !== shape.axis) return { x, y, kind: 'sideways' };
    // Connecting a new flat tile to the side of an existing ramp would turn
    // that old ramp into an illegal bend or junction, too.
    if (checkNeighbors && neighbor[mode] && !neighbor.bridge && !neighbor.tunnel && !neighbor.structureAxis) {
      if (networkTerrainIssue(game, nx, ny, mode, { proposed: planned, axis: direction, checkNeighbors: false })) return { x, y, kind: 'ramp-junction', at: { x: nx, y: ny } };
    }
  }
  return null;
}

/** Construction eligibility only. Saved networks keep their existing routes. */
export function networkTerrainProblem(game, x, y, mode, options) {
  return networkTerrainIssue(game, x, y, mode, options) ? slopeMessage : null;
}

/** Every tile of the final stroke that breaks the grade rules, once each. */
export function networkTerrainPlanIssues(game, placements, limit = 64) {
  const issues = [], seen = new Set();
  for (const mode of ['road', 'rail']) {
    const points = placements.filter(p => p.tool === mode || p.tool === (mode === 'rail' ? 'railbridge' : 'bridge') || p.tool === (mode === 'rail' ? 'railtunnel' : 'tunnel'));
    const proposed = new Set(points.map(p => p.y * game.width + p.x));
    for (const point of points) {
      const tile = tileAt(game, point.x, point.y);
      if (!tile || point.tool !== mode || tile[mode] || tile.bridge || tile.tunnel || tile.terrain === 'water' || tile.terrain === 'mountain') continue;
      const issue = networkTerrainIssue(game, point.x, point.y, mode, { proposed }), key = issue && issue.y * game.width + issue.x;
      if (!issue || seen.has(key)) continue;
      seen.add(key); issues.push(issue);
      if (issues.length >= limit) return issues;
    }
  }
  return issues;
}

/** Check the final stroke before committing any of its pieces. */
export function networkTerrainPlanProblem(game, placements) {
  return networkTerrainPlanIssues(game, placements, 1).length ? slopeMessage : null;
}

// Only interiors carry a deck/bore level. Ordinary network tiles keep their
// original grade rules; a structure can be entered only along its own axis.
export function transportElevation(tile) {
  return Number.isInteger(tile?.structureLevel) ? tile.structureLevel / TERRAIN_LEVELS : tile?.elevation || 0;
}
export function networkEdgeAllowed(a, b, dx, dy, mode, game = null, x = 0, y = 0) {
  if (mode === 'water') return true;
  if (!a?.structureAxis && !b?.structureAxis) return true;
  const axis = dx ? 'x' : 'y';
  if ((a.structureAxis && a.structureAxis !== axis) || (b.structureAxis && b.structureAxis !== axis)) return false;
  const level = tile => Number.isInteger(tile.structureLevel) ? Math.round(tile.structureLevel / TERRAIN_LEVELS * LAND_HEIGHT_LEVELS) : landHeightLevel(tile);
  if(level(a)===level(b))return true; // Old crossings retain their source-height connections.
  if(!game)return false;
  const actual=(tile,tx,ty,neighbor)=>{
    if(tile.structureAxis)return level(tile);
    // An engineered bridge can meet the high end of a straight riverbank
    // ramp. Its centre is halfway down that bank, below the shared deck edge.
    if(neighbor.bridge&&neighbor.terrain==='water'){const shape=networkTerrainShape(game,tx,ty);if(shape.kind==='incline'&&shape.axis===axis)return Math.max(...tileSurface(game,tx,ty).corners.map(p=>p.height));}
    return surfaceHeight(game,tx+.5,ty+.5);
  };
  return actual(a,x,y,b)===actual(b,x+dx,y+dy,a);
}
export function validStructureMetadata(tile, game = null, x = 0, y = 0) {
  if (tile.structureLevel === undefined && tile.structureAxis === undefined) return true;
  if(!(Number.isInteger(tile.structureLevel)&&tile.structureLevel>=1&&tile.structureLevel<=TERRAIN_LEVELS&&['x','y'].includes(tile.structureAxis)&&Boolean(tile.road)!==Boolean(tile.rail)&&Boolean(tile.bridge)!==Boolean(tile.tunnel)))return false;
  if(tile.bridge?tile.terrain==='water'||terrainLevel(tile)<tile.structureLevel:tile.terrain!=='water'&&terrainLevel(tile)>tile.structureLevel)return true;
  if(!game||tile.terrain==='water')return false;
  return spanClearance(game,tile.bridge?'bridge':'tunnel',x,y,Math.round(tile.structureLevel/TERRAIN_LEVELS*LAND_HEIGHT_LEVELS));
}

export function spanClearance(game,structure,x,y,height){
  const heights=tileSurface(game,x,y).corners.map(point=>point.height),lo=Math.min(...heights),hi=Math.max(...heights);
  return structure==='bridge'?hi<=height&&lo<height:lo>=height&&hi>height;
}

/** Geometry and occupancy only: callers add prices, then commit atomically. */
export function planStructureSpan(game, tool, points, { engineeredBanks = false } = {}) {
  const mode = tool.startsWith('rail') ? 'rail' : 'road', structure = tool.endsWith('bridge') ? 'bridge' : 'tunnel';
  const fail = message => ({ ok: false, message, placements: [], cost: 0, structure });
  if (!SPAN_TOOLS.has(tool)) return fail('Choose a bridge or tunnel.');
  if (!Array.isArray(points) || points.length < 3) return fail('Drag a straight span of at least 3 tiles, including both ends.');
  const first = points[0], last = points.at(-1);
  if (!first || !last || (first.x !== last.x && first.y !== last.y)) return fail('Bridges and tunnels must be straight.');
  const axis = first.y === last.y ? 'x' : 'y', direction = Math.sign(last[axis] - first[axis]);
  if (!direction) return fail('Choose two different endpoints.');
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p || !tileAt(game, p.x, p.y)) return fail('Keep the whole span inside the map.');
    if (p[axis] !== first[axis] + i * direction || p[axis === 'x' ? 'y' : 'x'] !== first[axis === 'x' ? 'y' : 'x']) return fail('Drag one continuous, straight span.');
  }
  const start = tileAt(game, first.x, first.y), end = tileAt(game, last.x, last.y);
  const bankGrade=point=>{const shape=networkTerrainShape(game,point.x,point.y),inward=point===first?direction:-direction,neighbor=tileAt(game,point.x+(axis==='x'?inward:0),point.y+(axis==='y'?inward:0));return engineeredBanks&&structure==='bridge'&&neighbor?.terrain==='water'&&shape.kind==='incline'&&shape.axis===axis;};
  for(const point of [first,last])if(!tileAt(game,point.x,point.y)[mode]&&networkTerrainShape(game,point.x,point.y).kind!=='flat'&&!bankGrade(point))return fail('Level both end tiles first; crossings need flat banks or portals. Start farther back from the shore.');
  const endpointHeight=(point,tile)=>tile[mode]?landHeightLevel(tile):bankGrade(point)?Math.max(...tileSurface(game,point.x,point.y).corners.map(p=>p.height)):surfaceHeight(game,point.x+.5,point.y+.5);
  const height=endpointHeight(first,start),endHeight=endpointHeight(last,end);
  let level = Math.round(height / LAND_HEIGHT_LEVELS * TERRAIN_LEVELS);
  if ([start, end].some(t => ['water', 'mountain'].includes(t.terrain) || t.bridge || t.tunnel)) return fail('Both ends need open dry land, outside existing bridges or tunnels.');
  if (height < 1 || height !== endHeight) return fail(`Match both ends: start level ${height}, end level ${endHeight}. Use Raise or Lower.`);
  // Retain a surviving crossing's exact saved height when repairing it. Older
  // decks used sixteen steps, including codes between today's display levels.
  const existing = points.slice(1,-1).map(p=>({p,tile:tileAt(game,p.x,p.y)})).find(({p,tile})=>tile[mode]&&tile[structure]&&tile.structureAxis===axis&&validStructureMetadata(tile,game,p.x,p.y)&&Math.round(tile.structureLevel/TERRAIN_LEVELS*LAND_HEIGHT_LEVELS)===height)?.tile;
  if(existing)level=existing.structureLevel;
  const placements = [];
  for (let i = 0; i < points.length; i++) {
    const { x, y } = points[i], tile = tileAt(game, x, y), interior = i > 0 && i < points.length - 1;
    if (tile.building || tile.zone || occupied(game, x, y)) return fail('Clear buildings and zones along the span first.');
    const station = stationSiteAt(game, x, y);
    if (station && (interior || station.mode !== mode)) return fail('Keep stops outside the span, on a matching network.');
    if (interior) {
      const clearance=spanClearance(game,structure,x,y,height)||(existing&&(structure==='bridge'?terrainLevel(tile)<level:terrainLevel(tile)>level));
      if(structure==='bridge'&&tile.terrain!=='water'&&!clearance)return fail(`Bridge deck is level ${height}; every middle tile needs lower ground or water.`);
      if(structure==='tunnel'&&(tile.terrain==='water'||!clearance))return fail(`Tunnel is level ${height}; every middle tile needs higher dry land.`);
      const same = tile[mode] && tile[structure] && tile.structureLevel === level && tile.structureAxis === axis;
      if ((tile.road || tile.rail || tile.bridge || tile.tunnel) && !same) return fail('Clear existing networks inside the span first.');
      if (tile[mode === 'road' ? 'rail' : 'road']) return fail('Each span carries one transport mode.');
    }
    placements.push({ x, y, tool: interior ? tool : mode, interior, level, height, axis });
  }
  // Decks and bores bypass ground slopes, but their newly built approaches
  // are ordinary networks and must meet both the ground and the span axis.
  // Existing approaches remain usable when rebuilding a legacy crossing.
  const proposed = new Set(placements.map(p => p.y * game.width + p.x));
  for (const point of [first, last]) {
    if (tileAt(game, point.x, point.y)[mode]) continue;
    const problem = networkTerrainProblem(game, point.x, point.y, mode, { proposed, axis });
    if (problem) return fail(problem);
  }
  return { ok: true, message: `${structure === 'bridge' ? 'Bridge' : 'Tunnel'} at level ${height}.`, placements, level, height, axis, mode, structure };
}
