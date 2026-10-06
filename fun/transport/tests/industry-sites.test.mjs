import test from 'node:test';
import assert from 'node:assert/strict';
import { build, createGame, industryAt, stationCoverage, restoreGame, tick } from '../model.js';
import { localEnvironment } from '../environment.js';
import { industryConditions } from '../industry-simulation.js';
import { encodeGame } from '../save-codec.js';
import { industryTiles, industrySiteProblem, industryFootprint, INDUSTRY_SPACING } from '../industry-sites.js';
import { quoteBuildPlan } from '../construction-plan.js';
import { INDUSTRIES } from '../data.js';
import { WORLD_GENERATION_VERSION } from '../world.js';
import { emptyGame, tileAt } from './helpers.mjs';

test('eligible industry sites reserve 3×3 factories and 7×7 farms',()=>{
  for(const [kind,def] of Object.entries(INDUSTRIES))for(const biome of def.biomes){
    const game=emptyGame(biome);if(def.coastal)tileAt(game,23,21).terrain='water';
    const size=def.farming?7:3;
    assert.equal(def.footprint,size,kind);assert.equal(industryFootprint(kind),size,kind);
    const result=build(game,kind,20,20);assert.equal(result.ok,true,`${biome} ${kind}: ${result.message}`);
    assert.equal(result.industry.footprint,size,kind);assert.equal(industryTiles(result.industry).length,size*size,kind);
  }
});

test('a 3×3 industry reserves every tile and demolition clears the complete site',()=>{
  const game=emptyGame();const result=build(game,'oil-well',20,20);
  assert.equal(result.ok,true);assert.equal(result.industry.footprint,3);
  for(const {x,y} of industryTiles(result.industry)){
    assert.equal(industryAt(game,x,y),result.industry);
    for(const tool of ['road','rail','residential','school','oil-well'])assert.equal(build(game,tool,x,y).ok,false,`${tool} cannot overlap ${x},${y}`);
  }
  assert.equal(build(game,'bulldoze',22,22).ok,true);
  assert.equal(game.industries.length,0);
  assert.equal(build(game,'road',20,20).ok,true);
});
test('industry placement validates the entire site before spending or changing land',()=>{
  for(const obstruction of ['road','building','water','edge']){
    const game=emptyGame(),x=obstruction==='edge'?game.width-1:20,y=20;
    if(obstruction==='road')tileAt(game,22,22).road=true;
    if(obstruction==='building')tileAt(game,22,22).building={kind:'school',level:1};
    if(obstruction==='water')tileAt(game,22,22).terrain='water';
    const before=JSON.stringify(game);assert.equal(build(game,'oil-well',x,y).ok,false,obstruction);assert.equal(JSON.stringify(game),before);
  }
});
test('catchment reaches the nearest industry edge and fisheries accept any shoreline edge',()=>{
  const game=emptyGame('tundra');tileAt(game,23,21).terrain='water';
  assert.equal(build(game,'fishery',20,20).ok,true);
  assert.equal(stationCoverage(game,{x:27,y:21}).industries.length,1);
  assert.equal(stationCoverage(game,{x:28,y:21}).industries.length,0);
});

// Reflect the same neighborhood around the center of a 3×3 site at (20,20).
const siteSides = {
  west: (x,y) => ({x,y}),
  east: (x,y) => ({x:42-x,y}),
  north: (x,y) => ({x:y,y:x}),
  south: (x,y) => ({x:y,y:42-x}),
};
function flatIndustryGame(kind='oil-well') {
  const game=emptyGame();
  for(const tile of game.tiles)tile.elevation=0;
  assert.equal(build(game,kind,20,20).ok,true);
  return game;
}

test('3×3 site road and rail access reach the same fixed distance from all four edges',()=>{
  const base=flatIndustryGame();
  for(const [side,point] of Object.entries(siteSides))for(const [network,distance,property] of [['road',1,'roadAccess'],['rail',2,'railAccess']]){
    for(const offset of [distance,distance+1]){
      const game=structuredClone(base),position=point(20-offset,20);
      tileAt(game,position.x,position.y)[network]=true;
      // A small nature sample must not reduce the fixed network catchment.
      const environment=localEnvironment(game,20,20,1,3);
      assert.equal(environment[property],offset===distance,`${side} ${network} at distance ${offset}`);
    }
  }
});

test('industry productivity and local services are symmetric around a 3×3 footprint',()=>{
  const base=flatIndustryGame();let reference;
  for(const [side,point] of Object.entries(siteSides)){
    const game=structuredClone(base);
    for(const [network,x] of [['road',19],['rail',18]]){
      const p=point(x,20);tileAt(game,p.x,p.y)[network]=true;
    }
    for(const [kind,x] of [['school',17],['service-bank',16]]){
      const p=point(x,20);tileAt(game,p.x,p.y).building={kind,level:1};
    }
    game.stations=[{id:'active-stop',mode:'road',...point(15,20)}];
    game.routes=[{id:'active-route',active:true,stops:['active-stop']}];
    const conditions=industryConditions(game,game.industries[0]),environment=conditions.environment;
    assert.equal(environment.transport,.6,`${side} active station reaches the nearest site edge`);
    assert.equal(environment.school,1,side);assert.equal(environment.services,1,side);
    assert.equal(environment.roadAccess,true,side);assert.equal(environment.railAccess,true,side);
    assert.ok(conditions.positive.includes('Served by a route'),side);
    if(reference)assert.deepEqual(conditions,reference,`${side} receives the same production support`);
    else reference=conditions;
  }
});

test('industry transport catchments exclude inactive and out-of-range stops without expanding legacy sites',()=>{
  const base=flatIndustryGame();
  for(const [side,point] of Object.entries(siteSides))for(const [distance,active,expected] of [[5,true,.6],[6,true,0],[5,false,0]]){
    const game=structuredClone(base);
    game.stations=[{id:'stop',mode:'road',...point(20-distance,20)}];
    game.routes=[{id:'route',active,stops:['stop']}];
    assert.equal(industryConditions(game,game.industries[0]).environment.transport,expected,`${side}, distance ${distance}, active ${active}`);
  }
  const legacy=structuredClone(base);delete legacy.industries[0].footprint;
  legacy.stations=[{id:'stop',mode:'road',x:26,y:20}];
  legacy.routes=[{id:'route',active:true,stops:['stop']}];
  assert.equal(industryConditions(legacy,legacy.industries[0]).environment.transport,0);
  assert.equal(localEnvironment(legacy,20,20,4).transport,0);
});

test('fire and local services reduce player-industry upkeep equally on every side',()=>{
  const base=flatIndustryGame('oil-well'),expenses=[];
  for(const point of Object.values(siteSides)){
    const game=structuredClone(base);
    for(const y of [19,20,21,22,23]){
      const p=point(17,y);tileAt(game,p.x,p.y).building={kind:'fire-station',level:1};
    }
    for(const y of [20,21,22]){
      const p=point(18,y);tileAt(game,p.x,p.y).building={kind:'service-bank',level:1};
    }
    tick(game,30);expenses.push(game.totalOperatingExpenses);
  }
  tick(base,30);
  assert.ok(expenses[0]<base.totalOperatingExpenses,'nearby services must actually lower running costs');
  assert.ok(expenses.every(value=>value===expenses[0]),`all four sides receive equal support: ${expenses}`);
});
test('footprints survive saves while legacy sites keep their original extent',()=>{
  const game=emptyGame();assert.equal(build(game,'oil-well',20,20).ok,true);
  const loaded=restoreGame(encodeGame(game));assert.ok(loaded);
  assert.equal(loaded.industries[0].footprint,3);assert.ok(industryAt(loaded,22,22));
  delete game.industries[0].footprint;
  assert.equal(industryAt(restoreGame(encodeGame(game)),21,21),null);
});
test('new worlds have catalog-sized industrial sites and old geography recipes remain unchanged',()=>{
  for(const biome of ['taiga','tundra','desert']){
    const game=createGame({biome,size:'square512',seed:1847});assert.equal(game.generationVersion,WORLD_GENERATION_VERSION);
    for(const industry of game.industries){assert.equal(industry.footprint,industryFootprint(industry.kind));assert.equal(industrySiteProblem(game,industry.kind,industry.x,industry.y,industry.footprint,industry),null);}
  }
  const legacy=createGame({size:'square512',generationVersion:2});assert.equal(legacy.generationVersion,2);assert.ok(legacy.industries.every(i=>i.footprint===undefined));
});

test('version-1 saves expand compact industries safely and preserve operations',()=>{
  for(const blocked of [false,true]){
    const game=emptyGame();build(game,'oil-well',20,20);game.siteFootprintVersion=1;
    const industry=game.industries[0];industry.footprint=2;industry.capacity=1.7;industry.inventory.oil=57;industry.shipped=33;
    if(blocked)for(const [x,y] of [[22,22],[19,19],[19,22],[22,19]])tileAt(game,x,y).road=true;
    const before=structuredClone(industry),tiles=structuredClone(game.tiles),money=game.money;
    const loaded=restoreGame(encodeGame(game));assert.ok(loaded);assert.equal(loaded.siteFootprintVersion,2);
    assert.deepEqual(loaded.industries[0],{...before,footprint:blocked?2:3});
    assert.deepEqual(loaded.tiles,tiles);assert.equal(loaded.money,money);
    assert.equal(industryAt(loaded,22,22),blocked?null:loaded.industries[0]);
    const again=restoreGame(encodeGame(loaded));assert.equal(again.revision,loaded.revision);
  }
});
test('one kind, or a supplier and its customer, keep the industry spacing apart',()=>{
  const game=emptyGame(),far=20+INDUSTRY_SPACING;
  assert.equal(build(game,'logging-camp',20,20).ok,true);
  // The sawmill buys timber; spacing runs centre to centre.
  assert.match(build(game,'sawmill',far-1,20).message,/^Too close to the Logging camp: a supplier and its customer stand \d+ tiles apart\.$/);
  assert.equal(build(game,'sawmill',far,20).ok,true);
  assert.equal(build(game,'logging-camp',20,far-1).message,`Another logging camp stands within ${INDUSTRY_SPACING} tiles.`);
  assert.equal(build(game,'logging-camp',20,far).ok,true);
  assert.equal(build(game,'oil-well',24,20).ok,true,'an unrelated industry may stand next door');
  // A drag counts the sites it places first.
  const quote=quoteBuildPlan(game,'farm',[{x:20,y:60},{x:30,y:60}]);
  assert.equal(quote.ok,false);assert.equal(quote.message,`Another grain farm stands within ${INDUSTRY_SPACING} tiles.`);
});
test('a saved 2×2 nonfarm industry grows to 3×3 once, around the ground it had',()=>{
  const game=emptyGame();game.siteFootprintVersion=1;
  assert.equal(build(game,'oil-well',20,20).ok,true);game.industries[0].footprint=2;tileAt(game,22,22).road=true;
  const loaded=restoreGame(encodeGame(game)),farm=loaded.industries[0];
  assert.deepEqual([farm.x,farm.y,farm.footprint,loaded.siteFootprintVersion],[19,20,3,2],'the road holds one corner, so the site grows west');
  const again=restoreGame(encodeGame(loaded));assert.deepEqual(again.industries,loaded.industries);assert.equal(again.revision,loaded.revision);
});
