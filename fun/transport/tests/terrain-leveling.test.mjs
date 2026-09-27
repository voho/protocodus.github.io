import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, quoteTerraformLevel, buildTerraformLevel, validateGame, restoreGame } from '../model.js';
import { buildPlan, quoteBuildPlan } from '../construction-plan.js';
import { networkTerrainShape } from '../terrain-engineering.js';
import { priceFor } from '../economy-pricing.js';
import { terrainObjectAt } from '../terrain-objects.js';
import { emptyGame, tileAt } from './helpers.mjs';
const area=(x,y,size)=>Array.from({length:size*size},(_,n)=>({x:x+n%size,y:y+Math.floor(n/size)}));
function ground(){const game=emptyGame();for(const tile of game.tiles)tile.elevation=4/7;return game;}

test('paid leveling uses the first tile, prices every height step and keeps quotes read-only',()=>{
  const game=ground(),points=area(20,20,3);
  tileAt(game,21,20).elevation=3/7;tileAt(game,22,22).elevation=5/7;
  const before=structuredClone(game),quote=quoteBuildPlan(game,'level',points),result=buildPlan(game,'level',points);
  assert.equal(quote.ok,true);assert.equal(quote.level,4);assert.equal(quote.cost,2*priceFor(before,280));
  assert.equal(result.ok,true);assert.equal(result.built,2);assert.equal(result.skipped,7);assert.equal(result.cost,quote.cost);
  assert.equal(game.money,before.money-quote.cost);
  for(const point of points)assert.equal(tileAt(game,point.x,point.y).elevation,4/7);
  const stable=structuredClone(game),again=quoteTerraformLevel(game,points);
  assert.equal(again.cost,0);assert.deepEqual(game,stable,'a preview never changes heights or finances');
  assert.equal(buildTerraformLevel(game,points).cost,0);assert.deepEqual(game,stable,'already level land is a true no-op');
});

test('unchanged displayed vertices preserve fractional legacy sources and paid levels follow inflation',()=>{
  const game=ground(),point={x:20,y:20};tileAt(game,20,20).elevation=4.01/7;
  const unchanged=quoteTerraformLevel(game,[point]);assert.equal(unchanged.placements[0].steps,0);assert.equal(unchanged.cost,0);
  assert.equal(build(game,'level',20,20).cost,0);assert.equal(tileAt(game,20,20).elevation,4.01/7);
  const quote=quoteTerraformLevel(game,[point],{targetLevel:5});assert.equal(quote.cost,280);
  game.day=3*365;const inflated=quoteTerraformLevel(game,[point],{targetLevel:5});assert.ok(inflated.cost>quote.cost);
  assert.equal(buildTerraformLevel(game,[point],{targetLevel:5}).cost,inflated.cost);
  assert.equal(tileAt(game,20,20).elevation,5/7);
});

for(const obstacle of ['water','road','rail','building','zone','industry','funds','edge','target'])test(`leveling ${obstacle} rejection leaves the entire area unchanged`,()=>{
  const game=ground(),points=area(20,20,3),cell=tileAt(game,22,22);cell.elevation=3/7;
  if(obstacle==='water')cell.terrain='water';
  if(obstacle==='road'||obstacle==='rail')cell[obstacle]=true;
  if(obstacle==='building')cell.building={kind:'house-cheap-1',level:1};
  if(obstacle==='zone'){cell.zone='residential';game.zones.push({x:22,y:22,kind:'residential',progress:0});}
  if(obstacle==='industry')game.industries.push({x:21,y:21,footprint:2,kind:'farm'});
  if(obstacle==='funds')game.money=1;
  if(obstacle==='edge')points.push({x:game.width,y:20});
  const options=obstacle==='target'?{targetLevel:8}:undefined,before=structuredClone(game);
  assert.equal(quoteBuildPlan(game,'level',points,options).ok,false);
  const result=buildPlan(game,'level',points,options);assert.equal(result.ok,false);assert.equal(result.cost,0);assert.deepEqual(game,before);
});

test('explicit target, duplicate points and direct path construction share the same atomic API',()=>{
  const game=ground(),points=[{x:20,y:20},{x:20,y:20},{x:21,y:20}];
  const quote=quoteTerraformLevel(game,points,{targetLevel:3}),result=buildTerraformLevel(game,points,{targetLevel:3});
  assert.equal(quote.placements.length,2);assert.equal(quote.cost,560);assert.equal(result.cost,560);
  tileAt(game,21,20).elevation=2/7;
  assert.equal(buildPath(game,'level',points).cost,280);
  assert.equal(tileAt(game,21,20).elevation,3/7);
});

test('leveling gives a compound slope a buildable interior and preserves its edits through saves',()=>{
  const game=ground();
  for(let y=15;y<=25;y++)for(let x=15;x<=25;x++)tileAt(game,x,y).elevation=(4+(x-20)*.3+(y-20)*.3)/7;
  assert.equal(networkTerrainShape(game,20,20).kind,'complex');
  const points=area(13,13,15),quote=quoteTerraformLevel(game,points,{targetLevel:4});
  assert.equal(quote.ok,true);assert.equal(buildTerraformLevel(game,points,{targetLevel:4}).ok,true);
  assert.equal(networkTerrainShape(game,20,20).kind,'flat');
  assert.equal(buildPlan(game,'road',[{x:19,y:20},{x:20,y:20},{x:21,y:20}]).ok,true);
  assert.equal(validateGame(game),true);
  const restored=restoreGame(structuredClone(game));assert.ok(restored);assert.deepEqual(restored.tiles,game.tiles);
});

test('changed collars dissolve large terrain parcels without changing neighboring heights',()=>{
  const game=ground();
  for(const p of area(20,20,3))Object.assign(tileAt(game,p.x,p.y),{terrain:'forest',detail:'pine'});
  tileAt(game,20,20).terrainObject={kind:'forest',detail:'pine',variant:0,footprint:3};
  const old=tileAt(game,20,20).elevation;
  assert.ok(terrainObjectAt(game,22,22));
  assert.equal(buildTerraformLevel(game,[{x:19,y:19}],{targetLevel:3}).ok,true);
  assert.equal(terrainObjectAt(game,22,22),null);
  assert.equal(tileAt(game,20,20).elevation,old);
});
