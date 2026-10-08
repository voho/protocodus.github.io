import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { build, createGame, industryAt, stationCoverage, validateGame, restoreGame, STATION_RADIUS } from '../model.js';
import { INDUSTRIES } from '../data.js';
import { industrySize, industryTiles, industryDistance, industrySiteProblem, isFarmIndustry, MIN_SITE_GAP } from '../industry-sites.js';
import { buildingSiteProblem } from '../building-sites.js';
import { localEnvironment } from '../environment.js';
import { quoteBuildPlan, buildPlan } from '../construction-plan.js';
import { captureUndo, finishUndo, undoConstruction, undoProblem } from '../construction-undo.js';
import { planConnection } from '../network-router.js';
import { encodeGame } from '../save-codec.js';
import { generateWorld, WORLD_GENERATION_VERSION } from '../world.js';
import { emptyGame, tileAt } from './helpers.mjs';

const farms=['farm','dairy-farm','vegetable-farm','orchard','livestock-farm'];
const ok=result=>assert.equal(result.ok,true,result.message);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const baselines=JSON.parse(readFileSync(new URL('./farm-plots-recipes.json',import.meta.url)));
const recipe9Baselines={taiga:'1e5649f5aa3498b483769859456178d20dcc9d0f2b685f13b414ca075d47fa24',tundra:'f254fe5c4c07fd5cca28c3ef4e0c4b9f0828a51ef2c0dd90e021e39e0878a4c8',desert:'15110c0e92b92f8ff433961392be718d39af326c8e0e7f77782fc56e520858f7'};
const sides={
  west:(distance)=>({x:20-distance,y:22}),
  east:(distance)=>({x:24+distance,y:22}),
  north:(distance)=>({x:22,y:20-distance}),
  south:(distance)=>({x:22,y:24+distance}),
};

test('all five farms claim 25 tiles as one agricultural site',()=>{
  for(const kind of farms){
    const game=emptyGame(),placed=build(game,kind,20,20);ok(placed);
    assert.equal(isFarmIndustry(kind),true);assert.equal(industrySize(placed.industry),5);
    assert.equal(industryTiles(placed.industry).length,25);
    for(const point of industryTiles(placed.industry)){
      assert.equal(industryAt(game,point.x,point.y),placed.industry);
      assert.equal(tileAt(game,point.x,point.y).building,null);
      for(const tool of ['road','rail','residential','school','oil-well','raise','lower'])assert.equal(build(game,tool,point.x,point.y).ok,false,`${kind}: ${tool} overlaps field ${point.x},${point.y}`);
    }
    ok(build(game,'bulldoze',24,24));assert.equal(game.industries.length,0);
    ok(build(game,'road',24,24));assert.ok(validateGame(game));
  }
  for(const kind of ['food-plant','dairy-plant','cannery','meat-packer'])assert.equal(INDUSTRIES[kind].footprint,5);
});

test('far-field obstructions, boundaries and overlapping quotes reject complete farm sites atomically',()=>{
  for(const obstruction of ['road','rail','zone','building','water','industry','edge']){
    const game=emptyGame(),point={x:obstruction==='edge'?game.width-4:20,y:20};
    const far=tileAt(game,24,24);
    if(obstruction==='road'||obstruction==='rail')far[obstruction]=true;
    if(obstruction==='zone')far.zone='residential';
    if(obstruction==='building')far.building={kind:'school',level:1};
    if(obstruction==='water')far.terrain='water';
    if(obstruction==='industry')ok(build(game,'oil-well',24,24));
    const before=JSON.stringify(game),quote=quoteBuildPlan(game,'farm',[point]);
    assert.equal(quote.ok,false,obstruction);assert.equal(buildPlan(game,'farm',[point]).ok,false,obstruction);
    assert.equal(JSON.stringify(game),before,`${obstruction}: no charge or partial field clearing`);
  }
  const game=emptyGame(),before=JSON.stringify(game),quote=quoteBuildPlan(game,'farm',[{x:20,y:20},{x:24,y:24}]);
  assert.equal(quote.span,5);assert.equal(quote.ok,false);assert.match(quote.message,/5-tile road between the industries/);
  assert.equal(JSON.stringify(game),before);
  assert.match(buildingSiteProblem(game,'stadium',20,20,5),/Invalid building footprint/);
});

test('indexed station catchment and transport access reach all four full farm edges',()=>{
  const base=emptyGame(),farm=build(base,'farm',20,20).industry;
  // More than16 sites forces the spatial index instead of its full-list shortcut.
  for(let n=0;n<17;n++)ok(build(base,'oil-well',30+n%6*(MIN_SITE_GAP+4),50+Math.floor(n/6)*(MIN_SITE_GAP+4)));
  for(const [side,point] of Object.entries(sides)){
    assert.ok(stationCoverage(base,point(STATION_RADIUS)).industries.includes(farm),side);
    assert.equal(stationCoverage(base,point(STATION_RADIUS+1)).industries.includes(farm),false,side);
    for(const [network,distance,property] of [['road',1,'roadAccess'],['rail',2,'railAccess']])for(const offset of [distance,distance+1]){
      const game=structuredClone(base),p=point(offset);tileAt(game,p.x,p.y)[network]=true;
      assert.equal(localEnvironment(game,20,20,1,5)[property],offset===distance,`${side} ${network} ${offset}`);
    }
    const game=structuredClone(base),p=point(STATION_RADIUS);
    game.stations=[{id:'stop-farm',mode:'road',...p}];game.routes=[{id:'route-farm',active:true,stops:['stop-farm']}];
    assert.equal(localEnvironment(game,20,20,4,5).transport,1-STATION_RADIUS*.08,`${side}: route reaches the field edge`);
  }
});

for(const mode of ['road','rail'])test(`${mode} connection plans survey complete farms and build beside the fields`,()=>{
  const game=emptyGame(),farm=build(game,'farm',20,20).industry,plant=build(game,'food-plant',46,23).industry;
  const plan=planConnection(game,farm,plant,mode,{budgetMs:1e9});
  assert.equal(plan.ok,true,plan.reason);
  assert.ok(plan.path.every(point=>!industryAt(game,point.x,point.y)));
  assert.ok(plan.stops.every((stop,index)=>industryDistance(index?plant:farm,stop)>0&&industryDistance(index?plant:farm,stop)<=STATION_RADIUS));
  const quote=quoteBuildPlan(game,mode,plan.path);assert.equal(quote.ok,true,quote.message);
  ok(buildPlan(game,mode,plan.path));
  for(const stop of plan.stops)ok(build(game,mode==='road'?'bus-stop':'train-stop',stop.x,stop.y));
  assert.ok(validateGame(game));
});

test('farm construction and far-corner demolition undo restore the complete field and removed terrain objects',()=>{
  const game=emptyGame(),point={x:20,y:20};
  for(let y=22;y<=24;y++)for(let x=22;x<=24;x++)Object.assign(tileAt(game,x,y),{terrain:'forest',detail:'pine'});
  tileAt(game,22,22).terrainObject={kind:'forest',detail:'pine',variant:7,footprint:3};
  const before=structuredClone(game.tiles),money=game.money,entry=captureUndo(game,'farm',[point]),result=buildPlan(game,'farm',[point]);ok(result);
  const undo=finishUndo(entry,game,result);assert.ok(undo);assert.equal(tileAt(game,22,22).terrainObject,undefined);
  ok(undoConstruction(game,undo));assert.deepEqual(game.tiles,before);assert.equal(game.money,money);
  const farm=build(game,'farm',20,20).industry,land=structuredClone(game.tiles);
  const demolition=captureUndo(game,'bulldoze',[{x:24,y:24}]),cleared=buildPlan(game,'bulldoze',[{x:24,y:24}]);ok(cleared);
  const reverse=finishUndo(demolition,game,cleared);assert.ok(reverse);
  assert.notDeepEqual(game.tiles,land,'demolition clears natural ground across the field');
  ok(undoConstruction(game,reverse));assert.equal(game.industries[0],farm);assert.deepEqual(game.tiles,land);
  assert.ok(validateGame(game));
  const entry2=captureUndo(game,'bulldoze',[point]),result2=buildPlan(game,'bulldoze',[point]);ok(result2);
  const undo2=finishUndo(entry2,game,result2);ok(build(game,'road',24,24));
  assert.match(undoProblem(game,undo2),/land there has changed/,'construction on the distant field blocks an older undo');
});

test('current 5×5 and already-migrated legacy farm extents round-trip unchanged',()=>{
  for(const kind of farms)for(const footprint of [undefined,1,2,3,5,7]){
    const game=emptyGame(),farm=build(game,kind,20,20).industry;
    if(footprint===undefined)delete farm.footprint;else farm.footprint=footprint;
    game.siteFootprintVersion=3;farm.capacity=1.7;farm.shipped=33;
    const before=structuredClone(farm),loaded=restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
    assert.ok(loaded,`${kind} footprint${footprint}`);
    assert.deepEqual(loaded.industries[0],before);
    assert.equal(industryAt(loaded,20+(footprint||1)-1,20),loaded.industries[0]);
    assert.equal(industryAt(loaded,20+(footprint||1),20),null);
    assert.ok(validateGame(loaded));
  }
  for(const footprint of [4,6,8]){
    const game=emptyGame(),farm=build(game,'farm',20,20).industry;farm.footprint=footprint;
    assert.equal(validateGame(game),false);assert.equal(restoreGame(encodeGame(game)),null);
  }
  const game=emptyGame();ok(build(game,'school',50,50));tileAt(game,50,50).building.footprint=7;
  assert.equal(validateGame(game),false,'allowing farm plots does not permit buildings larger than their catalog');
});

test('old compact farms expand safely to 5×5 once and retain their production state',()=>{
  for(const footprint of [undefined,1,2,3]){
    const game=emptyGame(),farm=build(game,'farm',20,20).industry;
    if(footprint===undefined)delete farm.footprint;else farm.footprint=footprint;
    game.siteFootprintVersion=2;farm.capacity=1.7;farm.inventory.grain=57;farm.shipped=33;
    const before=structuredClone(farm),money=game.money,loaded=restoreGame(encodeGame(game));
    assert.ok(loaded);assert.deepEqual(loaded.industries[0],{...before,footprint:5});
    assert.equal(loaded.siteFootprintVersion,3);assert.equal(loaded.money,money);
    assert.equal(industryAt(loaded,24,24),loaded.industries[0]);
    const again=restoreGame(encodeGame(loaded));assert.deepEqual(again.industries,loaded.industries);assert.equal(again.revision,loaded.revision);
  }
  const game=emptyGame(),farm=build(game,'farm',20,20).industry;
  farm.footprint=2;game.siteFootprintVersion=2;
  for(const [x,y] of [[19,19],[22,19],[19,22],[22,22]])tileAt(game,x,y).road=true;
  const before=structuredClone(game.tiles),loaded=restoreGame(encodeGame(game));
  assert.ok(loaded);assert.equal(loaded.industries[0].footprint,2);assert.deepEqual(loaded.tiles,before);
});

test('old 7×7 farms shrink within their parcel only when every existing station remains in range',()=>{
  for(const positions of [[],[{x:31,y:23}],[{x:15,y:23},{x:31,y:23}]]){
    const game=emptyGame(),farm=build(game,'farm',20,20).industry;
    farm.footprint=7;game.siteFootprintVersion=2;game.revision++;
    for(const point of positions){ok(build(game,'road',point.x,point.y));const placed=build(game,'bus-stop',point.x,point.y);ok(placed);placed.station.catchmentRadius=5;}
    for(const station of game.stations)assert.ok(stationCoverage(game,station).industries.includes(farm));
    const tiles=structuredClone(game.tiles),money=game.money,loaded=restoreGame(encodeGame(game)),restored=loaded?.industries[0];
    assert.ok(loaded);assert.equal(restored.footprint,positions.length===2?7:5);
    assert.ok(restored.x>=20&&restored.y>=20&&restored.x+restored.footprint<=27&&restored.y+restored.footprint<=27,'the resized farm stays within its original parcel');
    for(const station of loaded.stations)assert.ok(stationCoverage(loaded,station).industries.includes(restored),'the farm retains its station connection');
    assert.deepEqual(loaded.tiles,tiles);assert.equal(loaded.money,money);
    const again=restoreGame(encodeGame(loaded));assert.deepEqual(again.industries,loaded.industries);assert.equal(again.revision,loaded.revision);
  }
});

for(const [biome,versions] of Object.entries(baselines))for(const [version,expected] of Object.entries(versions))test(`${biome} recipe${version} preserves all pre-field generation bytes`,()=>{
  assert.equal(digest(generateWorld(biome,1847,'square512',Number(version))),expected);
});

for(const [biome,expected] of Object.entries(recipe9Baselines))test(`${biome} recipe9 preserves the published farm7 world exactly`,()=>{
  assert.equal(digest(generateWorld(biome,1847,'square512',9)),expected);
});

test('recipe10 allocates 5×5 sites and its sparse procedural save remains loadable',()=>{
  assert.ok(WORLD_GENERATION_VERSION>=10);
  for(const biome of ['taiga','desert']){
    const game=createGame({biome,seed:1847,size:'square512',generationVersion:10,townCount:4,industryDistricts:1});
    assert.equal(game.generationVersion,10);assert.ok(validateGame(game));
    const farm=game.industries.find(site=>site.kind==='farm');assert.equal(farm.footprint,5);
    assert.ok(game.industries.every(site=>site.footprint===5));
    assert.equal(industrySiteProblem(game,'farm',farm.x,farm.y,5,farm),null);
    const saved=encodeGame(game),loaded=restoreGame(JSON.parse(JSON.stringify(saved)));assert.ok(loaded);
    assert.equal(loaded.generationVersion,10);assert.deepEqual(loaded.industries,game.industries);
    assert.equal(industryTiles(loaded.industries.find(site=>site.id===farm.id)).length,25);
  }
});
