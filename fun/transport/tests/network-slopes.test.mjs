import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, findPath, restoreGame, validateGame } from '../model.js';
import { buildPlan, quoteBuildPlan } from '../construction-plan.js';
import { networkTerrainShape, networkTerrainProblem, networkTerrainPlanIssues, networkTerrainPlanProblem } from '../terrain-engineering.js';
import { emptyGame, tileAt } from './helpers.mjs';

function terrain(surface) {
  const game = emptyGame();
  for (const tile of game.tiles) tile.elevation = 4/7;
  for (let y=14;y<=26;y++) for (let x=14;x<=26;x++) tileAt(game,x,y).elevation=Math.max(0,Math.min(7,surface(x-20,y-20)))/7;
  return game;
}
const line = (axis, direction=1) => Array.from({length:5},(_,n)=>axis==='x'?{x:20+(n-2)*direction,y:20}:{x:20,y:20+(n-2)*direction});

for(const mode of ['road','rail']) {
  test(`${mode}: flat ground permits bends and junctions`,()=>{
    const game=terrain(()=>4),points=[{x:18,y:20},{x:19,y:20},{x:20,y:20},{x:20,y:21},{x:20,y:22},{x:20,y:19}];
    assert.equal(networkTerrainShape(game,20,20).kind,'flat');
    assert.equal(quoteBuildPlan(game,mode,points).ok,true);
    assert.equal(buildPlan(game,mode,points).ok,true);
    assert.ok(findPath(game,points[0],points.at(-2),mode));
  });
  for(const axis of ['x','y'])for(const direction of [1,-1])test(`${mode}: ${axis} ramps can be built in direction ${direction} without changing heights`,()=>{
    const game=terrain((x,y)=>4+(axis==='x'?x:y)),points=line(axis,direction),heights=game.tiles.map(t=>t.elevation),before=game.money;
    assert.deepEqual(networkTerrainShape(game,20,20).axis,axis);
    const quote=quoteBuildPlan(game,mode,points),result=buildPlan(game,mode,points);
    assert.equal(quote.ok,true);assert.equal(result.ok,true,result.message);
    assert.equal(game.money,before-quote.cost);assert.equal(result.cost,quote.cost);
    assert.deepEqual(game.tiles.map(t=>t.elevation),heights,'construction does not level terrain for free');
    assert.ok(findPath(game,points[0],points.at(-1),mode));
  });
  test(`${mode}: an isolated incline infers its axis, then accepts only straight extensions`,()=>{
    const game=terrain(x=>4+x);
    assert.equal(build(game,mode,20,20).ok,true);
    assert.equal(build(game,mode,19,20).ok,true);
    const before=structuredClone(game);
    const sideways=build(game,mode,20,19);
    assert.equal(sideways.ok,false);assert.match(sideways.message,/clear dry land|existing network/);
    assert.deepEqual(game,before);
    assert.equal(build(game,mode,21,20).ok,true);
  });
  for(const shape of ['sidehill','bend','junction','compound','crown','saddle'])test(`${mode}: ${shape} construction includes the necessary terrain preparation`,()=>{
    const surface=shape==='compound'?(x,y)=>4+x*.5+y*.5:shape==='crown'?(x,y)=>4+(x===0&&y===0?1:0):shape==='saddle'?(x,y)=>4+((x===0&&y===0)||(x===1&&y===1)?1:0):x=>4+x;
    const game=terrain(surface);
    const points=shape==='sidehill'?line('y'):shape==='bend'?[{x:19,y:20},{x:20,y:20},{x:20,y:21}]:shape==='junction'?[...line('x'),{x:20,y:21}]:[{x:20,y:20}];
    assert.ok(networkTerrainPlanIssues(game,points.map(p=>({...p,tool:mode}))).length,'the strict grade validator still identifies the original slope');
    const before=structuredClone(game),quote=quoteBuildPlan(game,mode,points);
    assert.equal(quote.ok,true,quote.message);assert.ok(quote.terrainCost>0);assert.deepEqual(game,before,'preparation is quoted without changing the world');
    const result=buildPlan(game,mode,points);assert.equal(result.ok,true,result.message);assert.equal(result.cost,quote.cost);assert.equal(result.built,points.length);
    for(const p of points)assert.equal(networkTerrainProblem(game,p.x,p.y,mode),null,'the paid surface satisfies the same strict grade rule');
    const rawGame=structuredClone(before),raw=buildPath(rawGame,mode,points);assert.equal(raw.ok,true);assert.equal(raw.cost,quote.cost);assert.deepEqual(rawGame,game);
  });
}

for(const mode of ['road','rail'])test(`${mode}: strict grade issues identify repairs while protected ramp junctions remain refused`,()=>{
  const game=terrain((x,y)=>4+(x===0&&y===0?1:0)),L=[...Array.from({length:6},(_,n)=>({x:15+n,y:21})),{x:20,y:20}];
  const placements=L.map(p=>({...p,tool:mode}));
  assert.deepEqual(networkTerrainPlanIssues(game,placements),[{x:20,y:20,kind:'uneven'}],'the L crosses one uneven tile');
  assert.equal(networkTerrainPlanProblem(game,placements),'Level this slope first. Roads and rails need flat ground or a straight uphill/downhill grade.');
  const quote=quoteBuildPlan(game,mode,L);
  assert.equal(quote.ok,true,quote.message);assert.ok(quote.terrainCost>0);assert.deepEqual(quote.placements.map(p=>p.state),Array(7).fill('ok'));assert.deepEqual(quote.issues,[]);
  const junction=terrain((x,y)=>4+(axisSide(x,y)?1:0)),sideways=[{x:19,y:20},{x:20,y:20},{x:20,y:21}].map(p=>({...p,tool:mode}));
  assert.deepEqual(networkTerrainPlanIssues(terrain(x=>4+x),sideways),[{x:20,y:20,kind:'sideways'},{x:20,y:21,kind:'sideways'}],'the bend and the branch climb sideways; the approach does not');
  for(let x=18;x<=22;x++)tileAt(junction,x,20)[mode]=true; // A legacy line running across the slope.
  const join=[{x:20,y:17},{x:20,y:18},{x:20,y:19}];
  assert.equal(networkTerrainShape(junction,20,19).kind,'flat');assert.equal(networkTerrainShape(junction,20,20).axis,'y');
  assert.deepEqual(networkTerrainPlanIssues(junction,join.map(p=>({...p,tool:mode}))),[{x:20,y:19,kind:'ramp-junction',at:{x:20,y:20}}]);
  const joined=quoteBuildPlan(junction,mode,join);
  assert.equal(joined.ok,false);assert.match(joined.message,/reshape an existing network/);
  const before=structuredClone(junction);assert.equal(buildPlan(junction,mode,join).ok,false);assert.deepEqual(junction,before);
  assert.equal(quoteBuildPlan(junction,mode,join.slice(0,2)).ok,true,'ending one tile earlier is buildable');
});
const axisSide=(x,y)=>y>=1;

test('gentle natural variations remain buildable while old nonconforming networks still route and load',()=>{
  const gentle=terrain((x,y)=>4+x*.02+y*.02);
  assert.equal(networkTerrainShape(gentle,20,20).kind,'flat');
  assert.equal(networkTerrainProblem(gentle,20,20,'road'),null);
  const legacy=terrain((x,y)=>4+x*.5+y*.5),points=[{x:19,y:20},{x:20,y:20},{x:20,y:21}];
  for(const p of points)tileAt(legacy,p.x,p.y).road=true;
  assert.equal(validateGame(legacy),true);
  assert.ok(findPath(legacy,points[0],points.at(-1),'road'));
  const restored=restoreGame(structuredClone(legacy));assert.ok(restored);
  assert.ok(findPath(restored,points[0],points.at(-1),'road'));
  assert.equal(build(restored,'road',20,20).unchanged,true,'existing construction stays usable');
});

for(const mode of ['road','rail'])test(`${mode}: a straight shoreline grade reaches an ordinary bridge without auto-leveling`,()=>{
  const game=terrain(()=>4);
  for(let y=0;y<game.height;y++)Object.assign(tileAt(game,20,y),{terrain:'water',elevation:0});
  const points=Array.from({length:15},(_,n)=>({x:n+13,y:20})),heights=game.tiles.map(t=>t.elevation);
  assert.equal(networkTerrainShape(game,19,20).axis,'x');
  assert.equal(buildPlan(game,mode,points).ok,true);
  assert.deepEqual(game.tiles.map(t=>t.elevation),heights);
  assert.ok(findPath(game,points[0],points.at(-1),mode));
});
