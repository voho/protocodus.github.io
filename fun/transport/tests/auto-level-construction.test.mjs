import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, buildProblem, constructionCost, priceFor, BUILD_COSTS, findPath } from '../model.js';
import { quoteBuildPlan, buildPlan } from '../construction-plan.js';
import { captureUndo, finishUndo, undoConstruction } from '../construction-undo.js';
import { earthworksView } from '../construction-earthworks.js';
import { networkTerrainPlanIssues } from '../terrain-engineering.js';
import { emptyGame, tileAt, line } from './helpers.mjs';

function corner(mode='road'){
  const game=emptyGame();for(const t of game.tiles)t.elevation=2/7;
  Object.assign(tileAt(game,20,20),{elevation:3/7,terrain:'forest',detail:'pine'});
  const points=line(18,22,20);return {game,points,mode};
}
const withoutRevisions=({revision,networkRevision,...rest})=>rest;

for(const mode of ['road','rail'])test(`${mode}: one paid quote repairs a corner and atomically builds the connected path`,()=>{
  const {game,points}=corner(mode);game.day=730;
  assert.ok(networkTerrainPlanIssues(game,points.map(p=>({...p,tool:mode}))).length,'the original corner fails the strict grade rule');
  const before=structuredClone(game),quote=quoteBuildPlan(game,mode,points);
  assert.equal(quote.ok,true,quote.message);assert.deepEqual(game,before,'quotes never mutate the company');
  assert.ok(quote.terrain.length>0);assert.ok(quote.terrainCost>0);
  assert.equal(quote.cost,quote.networkCost+quote.terrainCost);
  assert.equal(quote.terrainCost,quote.terrain.reduce((sum,p)=>sum+p.steps*priceFor(game,BUILD_COSTS.level),0));
  const view=earthworksView(game,quote.terrain);
  assert.equal(quote.networkCost,quote.placements.reduce((sum,p)=>sum+constructionCost(view,p.tool,p.x,p.y),0),'clearance charges use the terrain that will actually be built on');
  const entry=captureUndo(game,mode,points),result=buildPlan(game,mode,points),undo=finishUndo(entry,game,result);
  assert.equal(result.ok,true,result.message);assert.equal(result.cost,quote.cost);assert.equal(result.terrainCost,quote.terrainCost);
  assert.equal(game.money,before.money-quote.cost);assert.equal(game.totalExpenses,before.totalExpenses+quote.cost);
  assert.equal(result.built,points.length);assert.ok(findPath(game,points[0],points.at(-1),mode));
  for(const p of quote.terrain)assert.equal(tileAt(game,p.x,p.y).elevation,p.level/7);
  const after=structuredClone(game),repeat=buildPlan(game,mode,points);
  assert.equal(repeat.cost,0);assert.equal(repeat.terrainCost,0);assert.equal(repeat.skipped,points.length);assert.deepEqual(game,after,'repeating a built path never regrades or charges it');
  assert.ok(undo);assert.equal(undoConstruction(game,undo).ok,true);
  assert.deepEqual(withoutRevisions(game),withoutRevisions(before),'one undo restores both the network and earthworks accounting');
});

test('a budget covering only the network refuses all construction and terrain changes',()=>{
  const {game,points}=corner(),quote=quoteBuildPlan(game,'road',points);assert.equal(quote.ok,true,quote.message);assert.ok(quote.terrainCost>0);
  game.money=quote.networkCost;const before=structuredClone(game),short=quoteBuildPlan(game,'road',points);
  assert.equal(short.ok,false);assert.equal(short.cost,quote.cost);assert.match(short.message,/Need \$/);
  const built=buildPlan(game,'road',points);assert.equal(built.ok,false);assert.equal(built.cost,0);assert.equal(built.built,0);assert.deepEqual(game,before);
});

test('a changed obstruction is rechecked before any paid network or earthwork commit',()=>{
  const {game,points}=corner(),quote=quoteBuildPlan(game,'road',points);assert.equal(quote.ok,true,quote.message);
  tileAt(game,22,20).building={kind:'house-cheap-1',level:1,footprint:1};game.revision++;
  const before=structuredClone(game),built=buildPlan(game,'road',points);
  assert.equal(built.ok,false);assert.equal(built.cost,0);assert.equal(built.built,0);assert.deepEqual(game,before);
});

test('single-tile build, buildProblem and raw buildPath use the same automatic leveling quote',()=>{
  for(const method of ['single','path']){
    const {game}=corner(),points=[{x:20,y:20}],quote=quoteBuildPlan(game,'road',points),before=game.money;
    assert.equal(quote.ok,true,quote.message);assert.equal(buildProblem(game,'road',20,20),null);assert.equal(buildProblem(game,'road',20,20,{autoLevel:false}).reason,'terrain');
    const result=method==='single'?build(game,'road',20,20):buildPath(game,'road',points);
    assert.equal(result.ok,true,result.message);assert.equal(result.cost,quote.cost);assert.equal(game.money,before-quote.cost);
  }
});

test('one undo restores earthworks beyond the former three-tile capture collar, including an explicit connection capture',()=>{
  for(const captureTool of ['bridge','connection']){
    const game=emptyGame();for(const t of game.tiles)t.elevation=1;
    for(const x of [20,40]){
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)tileAt(game,x+dx,20+dy).elevation=2/7;
      tileAt(game,x,20).road=true;
    }
    const points=line(20,40,20),before=structuredClone(game),quote=quoteBuildPlan(game,'bridge',points);
    assert.equal(quote.ok,true,quote.message);
    const remote=quote.terrain.filter(p=>points.every(q=>Math.max(Math.abs(q.x-p.x),Math.abs(q.y-p.y))>3));
    assert.ok(remote.length>0,'this bridge requires paid ground changes beyond the old undo collar');
    const entry=captureUndo(game,captureTool,points,captureTool==='connection'?{terrain:quote.terrain}:undefined),result=buildPlan(game,'bridge',points),undo=finishUndo(entry,game,result);
    assert.equal(result.ok,true,result.message);assert.equal(result.cost,quote.cost);assert.ok(findPath(game,points[0],points.at(-1),'road'));
    for(const p of remote)assert.equal(tileAt(game,p.x,p.y).elevation,p.level/7);
    assert.ok(undo);assert.equal(undoConstruction(game,undo).ok,true);
    assert.deepEqual(withoutRevisions(game),withoutRevisions(before),'all distant heights, original endpoint roads and combined spending are restored');
  }
});
