import { LAND_HEIGHT_LEVELS, landHeightLevel } from './terrain-elevation.js';
import { surfaceHeight, tileSurface } from './terrain-geometry.js';
import { SPAN_TOOLS, terraformProblem, networkTerrainPlanIssues, planStructureSpan } from './terrain-engineering.js';

// Planning stays local to the changed points and their seven-level slope
// envelope. Limits bound pointer previews independently of the world area.
const MAX_EARTHWORKS = 4096, MAX_ATTEMPTS = 128, REACH = LAND_HEIGHT_LEVELS;
const planCaches=new WeakMap();
const tileAt = (game,x,y) => Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<game.width&&y<game.height?game.tiles[y*game.width+x]:null;
const keyOf = (game,x,y) => y*(game.width+1)+x;
const pointOf = (game,key) => ({x:key%(game.width+1),y:Math.floor(key/(game.width+1))});
const corners = point => [{x:point.x,y:point.y},{x:point.x+1,y:point.y},{x:point.x+1,y:point.y+1},{x:point.x,y:point.y+1}];
const fail = (message,placements=[],issues=[]) => ({ok:false,message,placements,terrain:[],affected:[],issues});

/** A sparse, read-only view with exactly the source changes commit will use. */
export function earthworksView(game, terrain = []) {
  if(!terrain.length)return game;
  const updates=new Map(),base=game.biome==='desert'?'sand':game.biome==='tundra'?'snow':'grass';
  for(const p of terrain){
    const tile=tileAt(game,p.x,p.y);if(!tile)continue;
    const elevation=p.level/LAND_HEIGHT_LEVELS;
    const clear=tile.terrain==='forest'||tile.terrain==='mountain'&&elevation<12/16||tile.terrain==='rock'&&elevation<10/16;
    updates.set(String(p.y*game.width+p.x),{...tile,elevation,terrain:clear?base:tile.terrain,detail:''});
  }
  return {...game,tiles:new Proxy(game.tiles,{get:(tiles,key)=>updates.get(key)??Reflect.get(tiles,key)})};
}

function context(game){
  const heights=new Map(),protectedPoints=new Map();
  return {game,height(x,y){const key=keyOf(game,x,y);if(!heights.has(key))heights.set(key,surfaceHeight(game,x,y));return heights.get(key);},
    protected(x,y){const key=keyOf(game,x,y);if(!protectedPoints.has(key))protectedPoints.set(key,!tileAt(game,x,y)||Boolean(terraformProblem(game,'level',x,y)));return protectedPoints.get(key);}};
}

// The least raised/lowered one-level envelope around requested vertex levels.
// Counterfactual sampling below also captures latent source relief revealed by
// a raise; every visible change is charged and included in the undo record.
function adjust(ctx,targets){
  const {game}=ctx,lower=new Map(),upper=new Map(),values=new Map();
  for(const target of targets.values()){
    const original=ctx.height(target.x,target.y),distance=Math.abs(target.level-original);
    if(!distance)continue;
    if(!Number.isInteger(target.level)||target.level<1||target.level>REACH||ctx.protected(target.x,target.y))return null;
    for(let dy=-distance;dy<=distance;dy++)for(let dx=-distance;dx<=distance;dx++){
      const x=target.x+dx,y=target.y+dy;if(x<0||y<0||x>game.width||y>game.height)continue;
      const key=keyOf(game,x,y),radius=Math.max(Math.abs(dx),Math.abs(dy));
      if(target.level>original)lower.set(key,Math.max(lower.get(key)??-Infinity,target.level-radius));
      else upper.set(key,Math.min(upper.get(key)??Infinity,target.level+radius));
    }
  }
  for(const key of new Set([...lower.keys(),...upper.keys()])){
    const {x,y}=pointOf(game,key),lo=lower.get(key)??-Infinity,hi=upper.get(key)??Infinity,original=ctx.height(x,y);
    if(lo>hi)return null;
    const level=Math.max(lo,Math.min(hi,original));
    if(level!==original){if(level<1||ctx.protected(x,y))return null;values.set(key,{x,y,level});}
  }
  if(values.size>MAX_EARTHWORKS)return null;
  if(!values.size)return {terrain:[],view:game,steps:0};
  const view=earthworksView(game,[...values.values()]),affected=new Set();
  for(const p of values.values())for(let dy=-REACH;dy<=REACH;dy++)for(let dx=-REACH;dx<=REACH;dx++){
    const x=p.x+dx,y=p.y+dy;if(x>=0&&y>=0&&x<=game.width&&y<=game.height)affected.add(keyOf(game,x,y));
  }
  for(const p of targets.values())if(surfaceHeight(view,p.x,p.y)!==p.level)return null;
  const terrain=[];
  for(const key of affected){
    const {x,y}=pointOf(game,key),before=ctx.height(x,y),level=surfaceHeight(view,x,y);
    if(level!==before){if(ctx.protected(x,y))return null;terrain.push({x,y,level,steps:Math.abs(level-before)});}
  }
  if(terrain.length>MAX_EARTHWORKS)return null;
  const sameSources=terrain.length===values.size&&terrain.every(p=>values.get(keyOf(game,p.x,p.y))?.level===p.level);
  return {terrain,view:sameSources?view:earthworksView(game,terrain),steps:terrain.reduce((sum,p)=>sum+p.steps,0)};
}
function combine(game,previous,next){
  const points=new Map(previous.map(p=>[keyOf(game,p.x,p.y),p]));
  for(const p of next){const steps=Math.abs(surfaceHeight(game,p.x,p.y)-p.level);if(steps||landHeightLevel(tileAt(game,p.x,p.y))!==p.level)points.set(keyOf(game,p.x,p.y),{...p,steps});else points.delete(keyOf(game,p.x,p.y));}
  return [...points.values()];
}
function affectedCells(game,terrain){
  const cells=new Map();for(const p of terrain)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const x=p.x+dx,y=p.y+dy;if(tileAt(game,x,y))cells.set(y*game.width+x,{x,y});}return [...cells.values()];
}
function finish(game,placements,terrain,extra={}){return {ok:true,message:terrain.length?'Ground preparation included.':'Follow flat ground or a straight grade.',placements,terrain,affected:affectedCells(game,terrain),issues:[],...extra};}

function resolvePlacements(game,mode,points){return points.map(p=>{const tile=tileAt(game,p.x,p.y);return {...p,tool:tile.terrain==='water'?(mode==='rail'?'railbridge':'bridge'):tile.terrain==='mountain'?(mode==='rail'?'railtunnel':'tunnel'):mode};});}
function batchRepairs(ctx,issues){
  const targets=new Map();
  for(const issue of issues){
    const points=corners(issue),levels=[...new Set(points.map(p=>ctx.height(p.x,p.y)))].filter(level=>level>=1);
    levels.sort((a,b)=>points.reduce((sum,p)=>sum+Math.abs(ctx.height(p.x,p.y)-a)-Math.abs(ctx.height(p.x,p.y)-b),0)||a-b);
    const possible=levels.filter(level=>points.every(p=>ctx.height(p.x,p.y)===level||!ctx.protected(p.x,p.y)));
    if(!possible.length)return {blocked:true};
    const level=possible.find(level=>points.every(p=>{
      const previous=targets.get(keyOf(ctx.game,p.x,p.y));
      return !previous||previous.level===level;
    }));
    if(level===undefined)return null;
    for(const p of points)targets.set(keyOf(ctx.game,p.x,p.y),{...p,level});
  }
  return adjust(ctx,targets);
}
function planStroke(game,placements,mode){
  const originalIssues=networkTerrainPlanIssues(game,placements,Infinity);
  if(!originalIssues.length)return finish(game,placements,[]);
  if(originalIssues.some(issue=>issue.kind==='ramp-junction'))return fail('This path would reshape an existing network. Approach along its grade or build around it.',placements,originalIssues);
  // Independent crowns and corner cuts share one terrain field and one final
  // validation. A long drag must not rebuild the whole view for every bump.
  const batch=batchRepairs(context(game),originalIssues);
  if(batch?.blocked)return fail('There is not enough clear dry land to prepare this grade. Move the path away from nearby water, buildings or networks.',placements,originalIssues);
  if(batch){
    const prepared=mode?resolvePlacements(batch.view,mode,placements):placements;
    if(!networkTerrainPlanIssues(batch.view,prepared,1).length)return finish(game,prepared,batch.terrain);
  }
  let view=game,terrain=[],issues=originalIssues;
  const visited=new Set();
  for(let attempt=0;attempt<Math.min(MAX_ATTEMPTS,placements.length*4+8);attempt++){
    const issue=issues[0];if(!issue)return finish(game,placements,terrain);
    if(issue.kind==='ramp-junction')return fail('This path would reshape an existing network. Approach along its grade or build around it.',placements,originalIssues);
    const ctx=context(view),shape=tileSurface(view,issue.x,issue.y),levels=[...new Set(shape.corners.map(p=>p.height))].filter(level=>level>=1);
    let best=null;
    for(const level of levels){
      const targets=new Map(corners(issue).map(p=>[keyOf(view,p.x,p.y),{...p,level}])),candidate=adjust(ctx,targets);if(!candidate)continue;
      const nextPlacements=mode?resolvePlacements(candidate.view,mode,placements):placements,nextIssues=networkTerrainPlanIssues(candidate.view,nextPlacements,Infinity);
      if(nextIssues.some(p=>p.x===issue.x&&p.y===issue.y)||nextIssues.length>issues.length)continue;
      const merged=combine(game,terrain,candidate.terrain),signature=merged.map(p=>`${p.x},${p.y}:${p.level}`).sort().join(';');if(visited.has(signature))continue;
      const score=nextIssues.length*100000+merged.reduce((sum,p)=>sum+p.steps,0);
      if(!best||score<best.score)best={...candidate,terrain:merged,placements:nextPlacements,issues:nextIssues,signature,score};
    }
    if(!best)return fail('There is not enough clear dry land to prepare this grade. Move the path away from nearby water, buildings or networks.',placements,originalIssues);
    terrain=best.terrain;view=earthworksView(game,terrain);placements=mode?resolvePlacements(view,mode,best.placements):best.placements;issues=networkTerrainPlanIssues(view,placements,Infinity);visited.add(best.signature);
    if(!issues.length)return finish(game,placements,terrain);
  }
  return fail('Build this difficult slope in shorter sections so the ground can be prepared safely.',placements,originalIssues);
}

function planSpan(game,tool,points){
  const original=planStructureSpan(game,tool,points,{engineeredBanks:true});
  if(original.ok)return finish(game,original.placements,[],{...original,spanPlan:original});
  if(points.length<3||points.some(p=>!tileAt(game,p.x,p.y)))return {...fail(original.message),structure:original.structure};
  const first=points[0],last=points.at(-1),axis=first.y===last.y?'x':first.x===last.x?'y':null;
  if(!axis||points.some((p,index)=>p[axis]!==first[axis]+index*Math.sign(last[axis]-first[axis])||p[axis==='x'?'y':'x']!==first[axis==='x'?'y':'x']))return fail(original.message);
  const bridge=tool.endsWith('bridge'),ctx=context(game);let best=null;
  for(let level=1;level<=REACH;level++){
    const targets=new Map(),endpointKeys=new Set();
    for(const endpoint of [first,last])for(const p of corners(endpoint)){
      const key=keyOf(game,p.x,p.y);endpointKeys.add(key);
      // Water-facing vertices stay at sea level. A bridge can use that
      // existing straight bank grade; a tunnel still needs a level portal.
      const height=bridge&&ctx.protected(p.x,p.y)&&ctx.height(p.x,p.y)===0?0:level;
      targets.set(key,{...p,level:height});
    }
    for(const point of points.slice(1,-1)){
      if(tileAt(game,point.x,point.y).terrain==='water')continue;
      for(const p of corners(point)){
        const key=keyOf(game,p.x,p.y);if(endpointKeys.has(key))continue;
        const old=ctx.height(p.x,p.y),height=bridge?Math.min(old,Math.max(1,level-1)):Math.max(old,Math.min(REACH,level+1));
        targets.set(key,{...p,level:height});
      }
    }
    const candidate=adjust(ctx,targets);if(!candidate)continue;
    const span=planStructureSpan(candidate.view,tool,points,{engineeredBanks:true});if(!span.ok)continue;
    if(!best||candidate.steps<best.steps)best={...candidate,span};
  }
  return best?finish(game,best.span.placements,best.terrain,{...best.span,spanPlan:best.span}):fail(`${original.message} There is not enough clear land for automatic ground preparation.`);
}

/** Pure construction geometry. Money, occupancy preflight and commit belong to model.js. */
function calculatePlan(game,tool,points){
  if(!['road','rail',...SPAN_TOOLS].includes(tool))return fail('Choose a road, railway, bridge or tunnel.');
  if(!Array.isArray(points)||!points.length||points.some(p=>!p||!tileAt(game,p.x,p.y)))return fail('Keep the construction path inside the map.');
  const unique=[...new Map(points.map(p=>[p.y*game.width+p.x,{x:p.x,y:p.y}])).values()];
  if(SPAN_TOOLS.has(tool)&&unique.length>1)return planSpan(game,tool,unique);
  const mode=tool==='road'||tool==='rail'?tool:null,placements=mode?resolvePlacements(game,mode,unique):unique.map(p=>({...p,tool}));
  return planStroke(game,placements,mode);
}

export function planNetworkConstruction(game,tool,points){
  if(!Array.isArray(points))return calculatePlan(game,tool,points);
  let cache=planCaches.get(game);
  if(!cache||cache.tiles!==game.tiles||cache.revision!==game.revision||cache.networkRevision!==game.networkRevision){cache={tiles:game.tiles,revision:game.revision,networkRevision:game.networkRevision,plans:new Map()};planCaches.set(game,cache);}
  const key=`${tool}:${points.map(p=>`${p?.x},${p?.y}`).join(';')}`;
  if(cache.plans.has(key))return cache.plans.get(key);
  const plan=calculatePlan(game,tool,points);cache.plans.set(key,plan);
  if(cache.plans.size>16)cache.plans.delete(cache.plans.keys().next().value);
  return plan;
}
