import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, constructionCost, restoreGame, validateGame, industryAt } from '../model.js';
import { buildingAt, buildingSize, buildingFootprint, buildingTiles, buildingSiteProblem, placeBuildingSite, siteSize } from '../building-sites.js';
import { industryFootprint, industrySize, industryTiles } from '../industry-sites.js';
import { encodeGame } from '../save-codec.js';
import { emptyGame, tileAt } from './helpers.mjs';

test('new site definitions and stored compact instances have distinct sizes',()=>{
  for(const [kind,size] of [['house-cheap-1',1],['house-normal-3',1],['pub',1],['school',2],['house-expensive-1',2],['service-bank',2],['stadium',3],['factory',2],['apartment',2],['office',2]])assert.equal(buildingFootprint(kind),size,kind);
  assert.equal(industryFootprint('oil-well'),5);assert.equal(industryFootprint('steel-mill'),5);
  assert.equal(buildingSize({kind:'stadium'}),1);assert.equal(industrySize({kind:'steel-mill'}),1);
});

test('stored site extents include current 5×5 and legacy 7×7 industries',()=>{
  for(const [footprint,size] of [[1,1],[2,2],[3,3],[5,5],[7,7],[0,1],[4,1],[6,1],[-2,1],[2.5,1],['2',1],[null,1],[undefined,1],[NaN,1]])assert.equal(siteSize({footprint}),size,String(footprint));
  assert.equal(siteSize(null),1);assert.equal(siteSize(undefined),1);assert.equal(buildingSize({kind:'stadium',footprint:3}),3);
});

test('each 2×2 and 3×3 building is one charged site owned by its anchor',()=>{
  for(const kind of ['hospital','stadium']){
    const game=emptyGame(),before=game.money,cost=constructionCost(game,kind,20,20),result=build(game,kind,20,20);
    assert.equal(result.ok,true);assert.equal(game.money,before-cost);
    const site=buildingAt(game,20,20);assert.equal(buildingTiles(site).length,buildingFootprint(kind)**2);
    for(const p of buildingTiles(site)){
      assert.deepEqual(buildingAt(game,p.x,p.y),site);
      if(p.x!==20||p.y!==20)assert.equal(tileAt(game,p.x,p.y).building,null,'no duplicate child objects');
      for(const tool of ['road','rail','residential','school','oil-well','raise','lower'])assert.equal(build(game,tool,p.x,p.y).ok,false,`${kind} reserves ${p.x},${p.y} against ${tool}`);
    }
    assert.equal(validateGame(game),true);
  }
});

test('whole-footprint placement fails atomically for any occupied far corner',()=>{
  for(const obstruction of ['road','rail','building','industry','water','mountain','zone','station','city','edge']){
    const game=emptyGame(),x=obstruction==='edge'?game.width-2:20,y=20;
    const cell=tileAt(game,22,22);
    if(['road','rail'].includes(obstruction))cell[obstruction]=true;
    if(obstruction==='building')cell.building={kind:'pub',level:1};
    if(obstruction==='industry')assert.equal(build(game,'oil-well',22,22).ok,true);
    if(['water','mountain'].includes(obstruction))cell.terrain=obstruction;
    if(obstruction==='zone'){cell.zone='residential';game.zones.push({x:22,y:22,kind:'residential',progress:0});}
    if(obstruction==='station')game.stations.push({x:22,y:22});
    if(obstruction==='city')game.cities.push({x:22,y:22});
    const snapshot=JSON.stringify(game);assert.equal(build(game,'stadium',x,y).ok,false,obstruction);assert.equal(JSON.stringify(game),snapshot,obstruction);
  }
  const game=emptyGame();assert.match(buildingSiteProblem(game,'pub',game.width,10),/inside the map/);
});

test('site overlap is rejected when only reserved child tiles intersect',()=>{
  const game=emptyGame();assert.equal(build(game,'stadium',20,20).ok,true);
  assert.equal(build(game,'steel-mill',18,18).ok,false);
  assert.equal(build(game,'school',19,22).ok,false);
  assert.equal(build(game,'steel-mill',26,20).ok,true);
  assert.equal(industryAt(game,28,22).kind,'steel-mill');
  assert.equal(build(game,'school',28,22).ok,false);
});

test('demolition from every site corner removes the whole building and charges once',()=>{
  for(const [dx,dy] of [[0,0],[2,0],[0,2],[2,2]]){
    const game=emptyGame();build(game,'stadium',20,20);const before=game.money,cost=constructionCost(game,'bulldoze',20+dx,20+dy);
    assert.equal(build(game,'bulldoze',20+dx,20+dy).ok,true);assert.equal(game.money,before-cost);
    for(let y=20;y<23;y++)for(let x=20;x<23;x++)assert.equal(buildingAt(game,x,y),null);
    assert.equal(validateGame(game),true);
  }
});

test('zoned expansion preserves its growth anchor and consumes only child zone records',()=>{
  const game=emptyGame();for(let y=20;y<22;y++)for(let x=20;x<22;x++)build(game,'industrial',x,y);
  const anchorZone=game.zones.find(z=>z.x===20&&z.y===20),site=placeBuildingSite(game,'factory',20,20,{allowZone:true,building:{level:2}});
  assert.equal(site.building.footprint,2);assert.equal(tileAt(game,20,20).zone,'industrial');assert.deepEqual(game.zones,[anchorZone]);
  assert.equal(tileAt(game,21,21).zone,null);assert.equal(validateGame(game),true);
  assert.equal(build(game,'bulldoze',21,21).ok,true);assert.equal(game.zones.length,0);assert.equal(tileAt(game,20,20).zone,null);
});

test('3×3 buildings and 5×5 industries survive lossless current saves',()=>{
  const game=emptyGame();build(game,'stadium',20,20);build(game,'steel-mill',30,20);
  const loaded=restoreGame(encodeGame(game));assert.ok(loaded);assert.equal(validateGame(loaded),true);
  assert.equal(buildingAt(loaded,22,22).building.footprint,3);assert.equal(industryAt(loaded,34,24).footprint,5);
  assert.deepEqual(loaded.tiles,game.tiles);assert.equal(loaded.revision,game.revision);
  assert.equal(industryTiles(loaded.industries[0]).length,25);
});

test('save validation rejects inconsistent extents and occupied footprint cells',()=>{
  const base=emptyGame();build(base,'stadium',20,20);build(base,'steel-mill',30,20);
  const corruptions=[
    g=>{tileAt(g,20,20).building.footprint=4;},
    g=>{tileAt(g,20,20).building.footprint=5;},
    g=>{tileAt(g,20,20).building.footprint=7;},
    g=>{tileAt(g,20,20).building.footprint='3';},
    g=>{tileAt(g,20,20).building.kind='pub';},
    g=>{tileAt(g,g.width-1,20).building=tileAt(g,20,20).building;tileAt(g,20,20).building=null;},
    g=>{tileAt(g,22,22).building={kind:'pub',level:1};},
    g=>{tileAt(g,22,22).road=true;},
    g=>{tileAt(g,22,22).terrain='water';},
    g=>{tileAt(g,22,22).zone='commercial';},
    g=>{g.zones.push({x:22,y:22,kind:'commercial',progress:0});},
    g=>{g.industries[0].x=22;},
    g=>{g.industries[0].x=g.width-2;},
    g=>{g.industries[0].footprint=null;},
    g=>{g.industries[0].footprint='3';},
    g=>{g.industries[0].footprint=4;},
    g=>{g.industries[0].footprint=7;},
    g=>{tileAt(g,34,24).rail=true;},
    g=>{g.stations.push({id:'invalid-stop',name:'Invalid',mode:'road',x:34,y:24});},
  ];
  for(const corrupt of corruptions){const game=structuredClone(base);corrupt(game);assert.equal(validateGame(game),false,String(corrupt));assert.equal(restoreGame(game),null,String(corrupt));}
});

test('legacy migration expands clear sites in place and preserves all operating data',()=>{
  const game=emptyGame();delete game.siteFootprintVersion;
  tileAt(game,20,20).building={kind:'stadium',level:2,populationCityId:null};
  build(game,'steel-mill',30,20);const industry=game.industries[0];industry.footprint=2;industry.capacity=1.7;industry.inventory.coal=71;industry.production=14;industry.shipped=33;
  const before=structuredClone(industry),building=structuredClone(tileAt(game,20,20).building),money=game.money;
  const loaded=restoreGame(encodeGame(game));assert.ok(loaded);assert.equal(loaded.siteFootprintVersion,3);assert.equal(loaded.money,money);
  assert.deepEqual(buildingAt(loaded,22,22).building,{...building,footprint:3});assert.deepEqual(loaded.industries[0],{...before,footprint:5});assert.equal(validateGame(loaded),true);
  const again=restoreGame(encodeGame(loaded));assert.equal(again.revision,loaded.revision);assert.deepEqual(again.tiles,loaded.tiles);
});

test('legacy compact sites keep every neighbor when desired expansion is blocked',()=>{
  for(const obstruction of ['road','building','zone','industry','edge']){
    const game=emptyGame();delete game.siteFootprintVersion;const x=obstruction==='edge'?game.width-1:20;
    tileAt(game,x,20).building={kind:'stadium',level:1};
    if(obstruction==='road')tileAt(game,22,22).road=true;
    if(obstruction==='building')tileAt(game,22,22).building={kind:'pub',level:1};
    if(obstruction==='zone')build(game,'residential',22,22);
    if(obstruction==='industry')build(game,'oil-well',22,22);
    const snapshot=structuredClone(game.tiles),loaded=restoreGame(encodeGame(game));assert.ok(loaded,obstruction);
    assert.equal(buildingSize(tileAt(loaded,x,20).building),1,obstruction);assert.deepEqual(loaded.tiles,snapshot,obstruction);
  }
  // An industry may grow in any direction that keeps its ground, so roads at all four corners hold it.
  const game=emptyGame(),corners=[[22,22],[19,19],[19,22],[22,19]];delete game.siteFootprintVersion;build(game,'steel-mill',20,20);game.industries[0].footprint=2;for(const [x,y] of corners)tileAt(game,x,y).road=true;
  const loaded=restoreGame(encodeGame(game));assert.ok(loaded);assert.equal(loaded.industries[0].footprint,2);assert.deepEqual(loaded.industries[0],game.industries[0]);for(const [x,y] of corners)assert.equal(tileAt(loaded,x,y).road,true);
});

test('demolishing a prestige home from a child tile removes its residents exactly once',()=>{
  const game=emptyGame();build(game,'city',14,20);const city=game.cities[0],population=city.population;
  assert.equal(build(game,'house-expensive-1',20,20).ok,true);assert.equal(city.population,population+28);
  assert.equal(tileAt(game,20,20).building.populationCityId,city.id);
  assert.equal(build(game,'bulldoze',21,21).ok,true);assert.equal(city.population,population);
  assert.equal(build(game,'bulldoze',20,20).ok,false);assert.equal(city.population,population);
});

test('5×5 industry demolition from a far corner frees all 25 cells with one charge',()=>{
  const game=emptyGame();build(game,'steel-mill',20,20);const before=game.money,cost=constructionCost(game,'bulldoze',24,24);
  assert.equal(build(game,'bulldoze',24,24).ok,true);assert.equal(game.money,before-cost);assert.equal(game.industries.length,0);
  for(let y=20;y<25;y++)for(let x=20;x<25;x++)assert.equal(build(game,'road',x,y).ok,true);
  assert.equal(validateGame(game),true);
});


test('model bulk demolition canonicalizes all site cells before charging and counting',()=>{
  const game=emptyGame();build(game,'stadium',20,20);build(game,'steel-mill',30,20);
  const points=[...buildingTiles(buildingAt(game,20,20)),...industryTiles(game.industries[0])],before=game.money,cost=constructionCost(game,'bulldoze',20,20);
  const result=buildPath(game,'bulldoze',points);assert.equal(result.ok,true);assert.equal(result.built,2);assert.equal(result.failed,0);assert.equal(result.cost,2*cost);assert.equal(game.money,before-2*cost);
  assert.equal(buildingAt(game,22,22),null);assert.equal(industryAt(game,32,22),null);
});
