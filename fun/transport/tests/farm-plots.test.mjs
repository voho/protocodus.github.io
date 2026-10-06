import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { build, createGame, industryAt, stationCoverage, validateGame, restoreGame, STATION_RADIUS } from '../model.js';
import { INDUSTRIES } from '../data.js';
import { industrySize, industryTiles, industryDistance, industrySiteProblem, isFarmIndustry } from '../industry-sites.js';
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
const sides={
  west:(distance)=>({x:20-distance,y:23}),
  east:(distance)=>({x:26+distance,y:23}),
  north:(distance)=>({x:23,y:20-distance}),
  south:(distance)=>({x:23,y:26+distance}),
};

test('all five farms claim 49 tiles and leave their 2×2 barn as a visual detail',()=>{
  for(const kind of farms){
    const game=emptyGame(),placed=build(game,kind,20,20);ok(placed);
    assert.equal(isFarmIndustry(kind),true);assert.equal(industrySize(placed.industry),7);
    assert.equal(industryTiles(placed.industry).length,49);
    for(const point of industryTiles(placed.industry)){
      assert.equal(industryAt(game,point.x,point.y),placed.industry);
      assert.equal(tileAt(game,point.x,point.y).building,null);
      for(const tool of ['road','rail','residential','school','oil-well','raise','lower'])assert.equal(build(game,tool,point.x,point.y).ok,false,`${kind}: ${tool} overlaps field ${point.x},${point.y}`);
    }
    ok(build(game,'bulldoze',26,26));assert.equal(game.industries.length,0);
    ok(build(game,'road',26,26));assert.ok(validateGame(game));
  }
  for(const kind of ['food-plant','dairy-plant','cannery','meat-packer'])assert.equal(INDUSTRIES[kind].footprint,3);
});

test('far-field obstructions, boundaries and overlapping quotes reject complete farm sites atomically',()=>{
  for(const obstruction of ['road','rail','zone','building','water','industry','edge']){
    const game=emptyGame(),point={x:obstruction==='edge'?game.width-6:20,y:20};
    const far=tileAt(game,26,26);
    if(obstruction==='road'||obstruction==='rail')far[obstruction]=true;
    if(obstruction==='zone')far.zone='residential';
    if(obstruction==='building')far.building={kind:'school',level:1};
    if(obstruction==='water')far.terrain='water';
    if(obstruction==='industry')ok(build(game,'oil-well',26,26));
    const before=JSON.stringify(game),quote=quoteBuildPlan(game,'farm',[point]);
    assert.equal(quote.ok,false,obstruction);assert.equal(buildPlan(game,'farm',[point]).ok,false,obstruction);
    assert.equal(JSON.stringify(game),before,`${obstruction}: no charge or partial field clearing`);
  }
  const game=emptyGame(),before=JSON.stringify(game),quote=quoteBuildPlan(game,'farm',[{x:20,y:20},{x:26,y:26}]);
  assert.equal(quote.span,7);assert.equal(quote.ok,false);assert.match(quote.message,/overlap/);
  assert.equal(JSON.stringify(game),before);
  assert.match(buildingSiteProblem(game,'stadium',20,20,7),/Invalid building footprint/);
});

test('indexed station catchment and transport access reach all four full farm edges',()=>{
  const base=emptyGame(),farm=build(base,'farm',20,20).industry;
  // More than16 sites forces the spatial index instead of its full-list shortcut.
  for(let n=0;n<17;n++)ok(build(base,'oil-well',70+n%6*5,50+Math.floor(n/6)*5));
  for(const [side,point] of Object.entries(sides)){
    assert.ok(stationCoverage(base,point(STATION_RADIUS)).industries.includes(farm),side);
    assert.equal(stationCoverage(base,point(STATION_RADIUS+1)).industries.includes(farm),false,side);
    for(const [network,distance,property] of [['road',1,'roadAccess'],['rail',2,'railAccess']])for(const offset of [distance,distance+1]){
      const game=structuredClone(base),p=point(offset);tileAt(game,p.x,p.y)[network]=true;
      assert.equal(localEnvironment(game,20,20,1,7)[property],offset===distance,`${side} ${network} ${offset}`);
    }
    const game=structuredClone(base),p=point(STATION_RADIUS);
    game.stations=[{id:'stop-farm',mode:'road',...p}];game.routes=[{id:'route-farm',active:true,stops:['stop-farm']}];
    assert.equal(localEnvironment(game,20,20,4,7).transport,.6,`${side}: route reaches the field edge`);
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
  for(let y=24;y<=26;y++)for(let x=24;x<=26;x++)Object.assign(tileAt(game,x,y),{terrain:'forest',detail:'pine'});
  tileAt(game,24,24).terrainObject={kind:'forest',detail:'pine',variant:7,footprint:3};
  const before=structuredClone(game.tiles),money=game.money,entry=captureUndo(game,'farm',[point]),result=buildPlan(game,'farm',[point]);ok(result);
  const undo=finishUndo(entry,game,result);assert.ok(undo);assert.equal(tileAt(game,24,24).terrainObject,undefined);
  ok(undoConstruction(game,undo));assert.deepEqual(game.tiles,before);assert.equal(game.money,money);
  const farm=build(game,'farm',20,20).industry,land=structuredClone(game.tiles);
  const demolition=captureUndo(game,'bulldoze',[{x:26,y:26}]),cleared=buildPlan(game,'bulldoze',[{x:26,y:26}]);ok(cleared);
  const reverse=finishUndo(demolition,game,cleared);assert.ok(reverse);
  assert.notDeepEqual(game.tiles,land,'demolition clears natural ground across the field');
  ok(undoConstruction(game,reverse));assert.equal(game.industries[0],farm);assert.deepEqual(game.tiles,land);
  assert.ok(validateGame(game));
  const entry2=captureUndo(game,'bulldoze',[point]),result2=buildPlan(game,'bulldoze',[point]);ok(result2);
  const undo2=finishUndo(entry2,game,result2);ok(build(game,'road',26,26));
  assert.match(undoProblem(game,undo2),/land there has changed/,'construction on the distant field blocks an older undo');
});

test('new farm7 saves round-trip and saved compact farms retain their original land titles',()=>{
  for(const kind of farms)for(const footprint of [undefined,1,2,3,7]){
    const game=emptyGame(),farm=build(game,kind,20,20).industry;
    if(footprint===undefined)delete farm.footprint;else farm.footprint=footprint;
    game.siteFootprintVersion=1;farm.capacity=1.7;farm.shipped=33;
    const before=structuredClone(farm),loaded=restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));
    assert.ok(loaded,`${kind} footprint${footprint}`);
    assert.deepEqual(loaded.industries[0],before);
    assert.equal(industryAt(loaded,20+(footprint||1)-1,20),loaded.industries[0]);
    assert.equal(industryAt(loaded,20+(footprint||1),20),null);
    assert.ok(validateGame(loaded));
  }
  for(const footprint of [4,5,6,8]){
    const game=emptyGame(),farm=build(game,'farm',20,20).industry;farm.footprint=footprint;
    assert.equal(validateGame(game),false);assert.equal(restoreGame(encodeGame(game)),null);
  }
  const game=emptyGame();ok(build(game,'school',50,50));tileAt(game,50,50).building.footprint=7;
  assert.equal(validateGame(game),false,'allowing farm plots does not permit buildings larger than their catalog');
});

for(const [biome,versions] of Object.entries(baselines))for(const [version,expected] of Object.entries(versions))test(`${biome} recipe${version} preserves all pre-field generation bytes`,()=>{
  assert.equal(digest(generateWorld(biome,1847,'square512',Number(version))),expected);
});

test('recipe9 allocates full grain fields and its sparse procedural save remains loadable',()=>{
  assert.equal(WORLD_GENERATION_VERSION,9);
  for(const biome of ['taiga','desert']){
    const game=createGame({biome,seed:1847,size:'square512',townCount:4,industryDistricts:1});
    assert.equal(game.generationVersion,9);assert.ok(validateGame(game));
    const farm=game.industries.find(site=>site.kind==='farm');assert.equal(farm.footprint,7);
    assert.equal(industrySiteProblem(game,'farm',farm.x,farm.y,7,farm),null);
    const saved=encodeGame(game),loaded=restoreGame(JSON.parse(JSON.stringify(saved)));assert.ok(loaded);
    assert.equal(loaded.generationVersion,9);assert.deepEqual(loaded.industries,game.industries);
    assert.equal(industryTiles(loaded.industries.find(site=>site.id===farm.id)).length,49);
  }
});
