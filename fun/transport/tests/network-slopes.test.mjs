import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, findPath, restoreGame, validateGame } from '../model.js';
import { buildPlan, quoteBuildPlan } from '../construction-plan.js';
import { networkTerrainShape, networkTerrainProblem } from '../terrain-engineering.js';
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
    assert.equal(sideways.ok,false);assert.match(sideways.message,/Level this slope first/);
    assert.deepEqual(game,before);
    assert.equal(build(game,mode,21,20).ok,true);
  });
  for(const shape of ['sidehill','bend','junction','compound','crown','saddle'])test(`${mode}: ${shape} construction is rejected atomically`,()=>{
    const surface=shape==='compound'?(x,y)=>4+x*.5+y*.5:shape==='crown'?(x,y)=>4+(x===0&&y===0?1:0):shape==='saddle'?(x,y)=>4+((x===0&&y===0)||(x===1&&y===1)?1:0):x=>4+x;
    const game=terrain(surface);
    const points=shape==='sidehill'?line('y'):shape==='bend'?[{x:19,y:20},{x:20,y:20},{x:20,y:21}]:shape==='junction'?[...line('x'),{x:20,y:21}]:[{x:20,y:20}];
    const before=structuredClone(game),quote=quoteBuildPlan(game,mode,points),result=buildPlan(game,mode,points);
    assert.equal(quote.ok,false);assert.match(quote.message,/Level this slope first/);
    assert.equal(result.ok,false);assert.equal(result.cost,0);assert.equal(result.built,0);assert.deepEqual(game,before);
    const raw=buildPath(game,mode,points);assert.equal(raw.ok,false);assert.equal(raw.cost,0);assert.deepEqual(game,before);
  });
}

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
