import test from 'node:test';
import assert from 'node:assert/strict';
import { build, createGame, industryAt, stationCoverage, restoreGame, tick } from '../model.js';
import { localEnvironment } from '../environment.js';
import { industryConditions } from '../industry-simulation.js';
import { encodeGame } from '../save-codec.js';
import { industryTiles, industrySiteProblem } from '../industry-sites.js';
import { emptyGame, tileAt } from './helpers.mjs';

test('a 2×2 industry reserves every tile and demolition clears the complete site',()=>{
  const game=emptyGame();const result=build(game,'oil-well',20,20);
  assert.equal(result.ok,true);assert.equal(result.industry.footprint,2);
  for(const {x,y} of industryTiles(result.industry)){
    assert.equal(industryAt(game,x,y),result.industry);
    for(const tool of ['road','rail','residential','school','oil-well'])assert.equal(build(game,tool,x,y).ok,false,`${tool} cannot overlap ${x},${y}`);
  }
  assert.equal(build(game,'bulldoze',21,21).ok,true);
  assert.equal(game.industries.length,0);
  assert.equal(build(game,'road',20,20).ok,true);
});
test('industry placement validates the entire site before spending or changing land',()=>{
  for(const obstruction of ['road','building','water','edge']){
    const game=emptyGame(),x=obstruction==='edge'?game.width-1:20,y=20;
    if(obstruction==='road')tileAt(game,21,21).road=true;
    if(obstruction==='building')tileAt(game,21,21).building={kind:'school',level:1};
    if(obstruction==='water')tileAt(game,21,21).terrain='water';
    const before=JSON.stringify(game);assert.equal(build(game,'oil-well',x,y).ok,false,obstruction);assert.equal(JSON.stringify(game),before);
  }
});
test('catchment reaches the nearest industry edge and fisheries accept any shoreline edge',()=>{
  const game=emptyGame('tundra');tileAt(game,22,21).terrain='water';
  assert.equal(build(game,'fishery',20,20).ok,true);
  assert.equal(stationCoverage(game,{x:26,y:21}).industries.length,1);
  assert.equal(stationCoverage(game,{x:27,y:21}).industries.length,0);
});

// Reflect the same neighborhood around the center of a 2×2 site at (20,20).
const siteSides = {
  west: (x,y) => ({x,y}),
  east: (x,y) => ({x:41-x,y}),
  north: (x,y) => ({x:y,y:x}),
  south: (x,y) => ({x:y,y:41-x}),
};
function flatIndustryGame(kind='oil-well') {
  const game=emptyGame();
  for(const tile of game.tiles)tile.elevation=0;
  assert.equal(build(game,kind,20,20).ok,true);
  return game;
}

test('2×2 site road and rail access reach the same fixed distance from all four edges',()=>{
  const base=flatIndustryGame();
  for(const [side,point] of Object.entries(siteSides))for(const [network,distance,property] of [['road',1,'roadAccess'],['rail',2,'railAccess']]){
    for(const offset of [distance,distance+1]){
      const game=structuredClone(base),position=point(20-offset,20);
      tileAt(game,position.x,position.y)[network]=true;
      // A small nature sample must not reduce the fixed network catchment.
      const environment=localEnvironment(game,20,20,1,2);
      assert.equal(environment[property],offset===distance,`${side} ${network} at distance ${offset}`);
    }
  }
});

test('industry productivity and local services are symmetric around a 2×2 footprint',()=>{
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
    assert.ok(conditions.positive.includes('Transport service'),side);
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
  const base=flatIndustryGame('machine-works'),expenses=[];
  for(const point of Object.values(siteSides)){
    const game=structuredClone(base);
    for(const y of [19,20,21,22]){
      const p=point(17,y);tileAt(game,p.x,p.y).building={kind:'fire-station',level:1};
    }
    for(const y of [20,21]){
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
  assert.equal(loaded.industries[0].footprint,2);assert.ok(industryAt(loaded,21,21));
  delete game.industries[0].footprint;
  assert.equal(industryAt(restoreGame(encodeGame(game)),21,21),null);
});
test('new worlds have valid 2×2 industrial sites and old geography recipes remain unchanged',()=>{
  for(const biome of ['taiga','tundra','desert']){
    const game=createGame({biome,size:'square512',seed:1847});assert.equal(game.generationVersion,3);
    for(const industry of game.industries){assert.equal(industry.footprint,2);assert.equal(industrySiteProblem(game,industry.kind,industry.x,industry.y,2,industry),null);}
  }
  const legacy=createGame({size:'square512',generationVersion:2});assert.equal(legacy.generationVersion,2);assert.ok(legacy.industries.every(i=>i.footprint===undefined));
});
