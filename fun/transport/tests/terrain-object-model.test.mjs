import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, buildStructureSpan, constructionCost, restoreGame, validateGame } from '../model.js';
import { buildingAt, placeBuildingSite } from '../building-sites.js';
import { terrainObjectAt, terrainObjectSize, terrainObjectTiles, terrainObjectSiteProblem, terrainObjectGroundIsFlat, releaseTerrainObjects } from '../terrain-objects.js';
import { encodeGame } from '../save-codec.js';
import { emptyGame, tileAt } from './helpers.mjs';

function flatGame(){const game=emptyGame();for(const tile of game.tiles)tile.elevation=.5;return game;}
function parcel(game,kind='forest',x=20,y=20,size=3){
  for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++)Object.assign(tileAt(game,x+dx,y+dy),{terrain:kind,detail:kind==='forest'?'pine':'',variant:dx+dy});
  const object={kind,detail:kind==='forest'?'pine':'',variant:7,footprint:size};
  assert.equal(terrainObjectSiteProblem(game,kind,x,y,size),null);
  tileAt(game,x,y).terrainObject=object;return{x,y,object};
}

test('explicit terrain objects resolve every occupied cell to one stable anchor',()=>{
  const game=flatGame(),site=parcel(game);
  assert.equal(terrainObjectSize(site.object),3);assert.equal(terrainObjectTiles(site).length,9);
  for(const p of terrainObjectTiles(site)){assert.deepEqual(terrainObjectAt(game,p.x,p.y),site);if(p.x!==20||p.y!==20)assert.equal(tileAt(game,p.x,p.y).terrainObject,undefined);}
  assert.equal(terrainObjectAt(game,23,22),null);assert.equal(terrainObjectAt(game,-1,20),null);
  assert.equal(validateGame(game),true);
});

test('large objects require equal levels, tight continuous grades, and a flat dry collar',()=>{
  const game=flatGame();assert.equal(terrainObjectGroundIsFlat(game,20,20,3),true);
  tileAt(game,22,22).elevation=.53;assert.equal(terrainObjectGroundIsFlat(game,20,20,3),false,'same rounded level still exceeds .3 continuous levels');
  tileAt(game,22,22).elevation=.5;tileAt(game,23,23).elevation=.55;assert.equal(terrainObjectGroundIsFlat(game,20,20,3),false,'collar exceeds .6 levels');
  tileAt(game,23,23).elevation=.5;tileAt(game,19,19).terrain='water';assert.equal(terrainObjectGroundIsFlat(game,20,20,3),false,'water in collar');
  assert.equal(terrainObjectGroundIsFlat(game,0,0,2),false,'edge needs a complete collar');
});

test('parcel placement rejects mixed base terrain, overlapping parcels and reserved structure children',()=>{
  const game=flatGame(),site=parcel(game);
  assert.equal(terrainObjectSiteProblem(game,'forest',20,20,3,{exclude:site}),null);
  assert.match(terrainObjectSiteProblem(game,'forest',21,21,2),/overlap/);
  delete tileAt(game,20,20).terrainObject;tileAt(game,22,22).terrain='grass';assert.match(terrainObjectSiteProblem(game,'forest',20,20,3),/same base/);
  tileAt(game,22,22).terrain='forest';placeBuildingSite(game,'school',21,21);for(const p of [{x:21,y:21},{x:22,y:21},{x:21,y:22},{x:22,y:22}])tileAt(game,p.x,p.y).terrain='forest';
  assert.match(terrainObjectSiteProblem(game,'forest',20,20,3),/unoccupied/);
});

test('releasing an intersected parcel preserves every base terrain and elevation cell',()=>{
  const game=flatGame();parcel(game);const snapshot=game.tiles.map(({terrainObject,...tile})=>tile);
  assert.equal(releaseTerrainObjects(game,[{x:22,y:22},{x:20,y:20}]),1);assert.equal(terrainObjectAt(game,20,20),null);
  assert.deepEqual(game.tiles,snapshot);assert.equal(releaseTerrainObjects(game,[{x:22,y:22}]),0);
});

test('forest and rock demolition clear the full parcel once and preserve its land levels',()=>{
  for(const kind of ['forest','rock']){
    const game=flatGame(),site=parcel(game,kind),before=game.money,cost=constructionCost(game,'bulldoze',22,22);
    const outcome=buildPath(game,'bulldoze',terrainObjectTiles(site));assert.equal(outcome.ok,true);assert.equal(outcome.built,1);assert.equal(outcome.failed,0);assert.equal(game.money,before-cost);
    for(const p of terrainObjectTiles(site)){const tile=tileAt(game,p.x,p.y);assert.equal(tile.terrain,'grass');assert.equal(tile.elevation,.5);assert.equal(tile.detail,'');assert.equal(terrainObjectAt(game,p.x,p.y),null);}
    assert.equal(validateGame(game),true);
  }
});

test('mountain parcels cannot be bulldozed; tunnels release only their large art',()=>{
  const game=flatGame();parcel(game,'mountain');const snapshot=JSON.stringify(game);
  assert.equal(build(game,'bulldoze',22,22).ok,false);assert.equal(JSON.stringify(game),snapshot);
  assert.equal(build(game,'tunnel',22,22).ok,true);assert.equal(terrainObjectAt(game,20,20),null);
  assert.equal(tileAt(game,22,22).terrain,'mountain');assert.equal(tileAt(game,22,22).elevation,.5);assert.equal(validateGame(game),true);
});

test('successful road, zone, building and industry construction release crossed large nature',()=>{
  for(const tool of ['road','rail','residential','school','logging-camp']){
    const game=flatGame();parcel(game);assert.equal(build(game,tool,21,21).ok,true,tool);
    assert.equal(terrainObjectAt(game,20,20),null,tool);assert.equal(tileAt(game,20,20).terrain,'forest','unbuilt parcel cells return to small trees');
    assert.equal(validateGame(game),true,tool);
  }
});

test('failed purchases and obstructed spans leave parcel anchors untouched',()=>{
  const game=flatGame();parcel(game);game.money=0;const snapshot=JSON.stringify(game);
  for(const tool of ['road','school','bulldoze','lower'])assert.equal(build(game,tool,21,21).ok,false,tool);
  assert.equal(JSON.stringify(game),snapshot);
  assert.equal(buildStructureSpan(game,'tunnel',[{x:19,y:21},{x:20,y:21},{x:21,y:21},{x:22,y:21},{x:23,y:21}]).ok,false);assert.equal(JSON.stringify(game),snapshot);
});

test('earthworks dissolve parcels both on edited cells and beside their changed collars',()=>{
  for(const x of [22,23]){
    const game=flatGame();parcel(game);assert.equal(build(game,'raise',x,21).ok,true);
    assert.equal(terrainObjectAt(game,20,20),null,`edit x=${x}`);assert.equal(tileAt(game,20,20).elevation,.5);assert.equal(validateGame(game),true);
  }
});

test('large terrain sites survive current packed saves and reject corrupt occupancy/grades',()=>{
  const base=flatGame();parcel(base);parcel(base,'mountain',30,20,2);
  const loaded=restoreGame(encodeGame(base));assert.ok(loaded);assert.deepEqual(loaded.tiles,base.tiles);assert.equal(validateGame(loaded),true);
  const corruptions=[
    g=>{tileAt(g,20,20).terrainObject.footprint=1;},
    g=>{tileAt(g,20,20).terrainObject.kind='water';},
    g=>{tileAt(g,20,20).terrainObject.variant=.5;},
    g=>{tileAt(g,20,20).terrainObject.detail=null;},
    g=>{tileAt(g,22,22).terrainObject={kind:'forest',detail:'',variant:0,footprint:2};},
    g=>{tileAt(g,22,22).terrain='grass';},
    g=>{tileAt(g,22,22).road=true;},
    g=>{tileAt(g,22,22).building={kind:'pub',level:1};},
    g=>{tileAt(g,22,22).elevation=.53;},
    g=>{tileAt(g,23,22).elevation=.56;},
    g=>{g.zones.push({x:22,y:22,kind:'residential',progress:0});},
  ];
  for(const corrupt of corruptions){const game=structuredClone(base);corrupt(game);assert.equal(validateGame(game),false,String(corrupt));assert.equal(restoreGame(game),null,String(corrupt));}
});

test('old companies gain parcels once without modifying geography or neighbors',()=>{
  const game=flatGame();delete game.terrainObjectVersion;
  for(let y=5;y<55;y++)for(let x=5;x<75;x++)tileAt(game,x,y).terrain='forest';
  build(game,'school',20,20);build(game,'road',40,20);const original=game.tiles.map(({terrainObject,...tile})=>tile),money=game.money;
  const loaded=restoreGame(encodeGame(game));assert.ok(loaded);assert.equal(loaded.terrainObjectVersion,1);assert.equal(loaded.money,money);
  assert.deepEqual(loaded.tiles.map(({terrainObject,...tile})=>tile),original);assert.ok(loaded.tiles.some(t=>t.terrainObject));assert.ok(buildingAt(loaded,21,21));assert.equal(terrainObjectAt(loaded,21,21),null);assert.equal(terrainObjectAt(loaded,40,20),null);
  const again=restoreGame(encodeGame(loaded));assert.deepEqual(again.tiles,loaded.tiles);assert.equal(again.revision,loaded.revision);
});

test('a valid tunnel span releases a mountain parcel without changing its elevations',()=>{
  const game=flatGame();parcel(game,'mountain');
  // Lower the land on both sides of the ridge, preserving the parcel's flat
  // collar while giving each new portal a straight approach instead of a pit.
  for(let y=0;y<game.height;y++)for(let x=0;x<game.width;x++)if(x<19||x>23)tileAt(game,x,y).elevation=7/16;
  game.revision++;
  const points=Array.from({length:8},(_,n)=>({x:17+n,y:21}));
  const before=points.map(p=>tileAt(game,p.x,p.y).elevation),result=buildStructureSpan(game,'tunnel',points);
  assert.equal(result.ok,true,result.message);assert.equal(terrainObjectAt(game,20,20),null);assert.deepEqual(points.map(p=>tileAt(game,p.x,p.y).elevation),before);
  assert.equal(tileAt(game,22,21).terrain,'mountain');assert.equal(tileAt(game,22,21).tunnel,true);assert.equal(validateGame(game),true);
});
