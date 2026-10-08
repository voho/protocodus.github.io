import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { noteSurfaceChanges, noteSiteChanges, surfaceChangesSince, viewChangesSince } from '../change-journal.js';
import { createGame, build, buildPath, addRoute } from '../model.js';
import { stepEcology } from '../environment.js';
import { stepSettlements } from '../settlements.js';
import { allocateTerrainObjects } from '../world-terrain-objects.js';
import { terrainObjectAt, terrainObjectTiles, releaseTerrainObjects, releaseTerrainObjectsCells } from '../terrain-objects.js';
import { surfaceHeight, terrainGeometryStats, clearTerrainGeometryCache } from '../terrain-geometry.js';
import { emptyGame, line } from './helpers.mjs';

const world=(width=32,height=24)=>({width,height,revision:0,tiles:Array.from({length:width*height},()=>({terrain:'grass',detail:'',elevation:.3}))});
const flatForest=(seed=1847)=>({seed,biome:'taiga',width:64,height:48,day:0,revision:0,cities:[],industries:[],stations:[],zones:[],routes:[],
  tiles:Array.from({length:64*48},(_,n)=>({terrain:'forest',detail:'pine',elevation:.25,variant:n%7,building:null,road:false,rail:false,zone:null}))});
const note=(game,indices)=>{const from=game.revision;game.revision++;noteSurfaceChanges(game,from,game.revision,indices);};
const list=changes=>changes&&[...changes];
const digest=game=>createHash('sha256').update(JSON.stringify(game.tiles)).digest('hex').slice(0,16);

test('contiguous surface entries answer the sorted union of their cells',()=>{
  const game=world();
  note(game,[40,7,40]);note(game,[9]);note(game,[7,300]);
  assert.deepEqual(list(surfaceChangesSince(game,0)),[7,9,40,300]);
  assert.deepEqual(list(surfaceChangesSince(game,1)),[7,9,300]);
  assert.deepEqual(list(surfaceChangesSince(game,2)),[7,300]);
  assert.deepEqual(list(surfaceChangesSince(game,3)),[],'an unchanged revision needs no work');
  assert.equal(surfaceChangesSince(game,-1),null,'a renderer that never drew has no journaled start');
  assert.equal(surfaceChangesSince(game,4),null,'a future revision is never covered');
  assert.equal(surfaceChangesSince(world(),0).length,0);assert.equal(surfaceChangesSince(Object.assign(world(),{revision:2}),0),null);
  const changes=surfaceChangesSince(game,0);changes[0]=99;assert.deepEqual(list(surfaceChangesSince(game,0)),[7,9,40,300],'callers receive their own copy');
});

test('overflowing the ring by entries or by cells drops the oldest coverage',()=>{
  const game=world();
  for(let n=0;n<65;n++)note(game,[n]);
  assert.equal(surfaceChangesSince(game,0),null,'65 days exceed the 64-entry ring');
  assert.equal(surfaceChangesSince(game,1).length,64);
  const busy=world(512,512);
  note(busy,Array.from({length:40000},(_,n)=>n));note(busy,Array.from({length:30000},(_,n)=>n+100000));
  assert.equal(surfaceChangesSince(busy,0),null,'70,000 cells exceed the 65,536-cell budget');
  assert.equal(surfaceChangesSince(busy,1).length,30000);
  const huge=world(512,512);note(huge,Array.from({length:70000},(_,n)=>n));
  assert.equal(surfaceChangesSince(huge,0),null,'one oversized day is never retained');
});

test('any unjournaled construction or settlement revision breaks coverage across it',()=>{
  const game=emptyGame();game.day=1;
  for(let n=0;n<game.tiles.length;n+=3){const tile=game.tiles[n];tile.terrain='forest';tile.detail='pine';}
  const start=game.revision;
  for(let day=2;game.revision===start;day++){game.day=day;stepEcology(game);}
  const ecology=game.revision;assert.ok(surfaceChangesSince(game,start).length>0);
  assert.equal(build(game,'road',40,40).ok,true);const built=game.revision;assert.ok(built>ecology);
  assert.equal(surfaceChangesSince(game,start),null,'a construction revision after ecology');
  assert.equal(surfaceChangesSince(game,ecology),null,'the construction revision itself');
  const before=game.revision;for(let day=game.day+1;game.revision===before;day++){game.day=day;stepEcology(game);}
  assert.equal(surfaceChangesSince(game,start),null,'a construction gap between two ecology days');
  assert.ok(surfaceChangesSince(game,built).length>0,'ecology after the construction is covered again');
  const town=emptyGame();build(town,'city',10,10);build(town,'residential',18,10);town.zones[0].progress=.99;build(town,'city',23,10);
  buildPath(town,'road',line(10,21,11));build(town,'bus-stop',10,11);build(town,'bus-stop',21,11);
  assert.equal(addRoute(town,{mode:'road',cargo:'passengers',stops:town.stations.map(stop=>stop.id)}).ok,true);
  town.tiles.forEach((tile,index)=>{if(index%3===0&&tile.terrain==='grass'&&!tile.road&&!tile.building&&!tile.zone&&Math.abs(index%town.width-15)>8){tile.terrain='forest';tile.detail='pine';}});
  let checked=0;
  for(let day=1;day<=60&&!checked;day++){
    town.day=day;for(const city of town.cities){city.activity=0;city.lastServiceDay=day;}
    const r0=town.revision;stepSettlements(town);const r1=town.revision;stepEcology(town);const r2=town.revision;
    if(r1===r0||r2===r1)continue;
    assert.equal(surfaceChangesSince(town,r0),null,'settlement growth plus ecology in one day');
    assert.ok(surfaceChangesSince(town,r1).length>0,'the ecology part alone is exact');checked++;
  }
  assert.equal(checked,1,'the zoned plot developed on an ecology day');
});

test('replacing the tile array invalidates every journaled span',()=>{
  const game=world();note(game,[1,2]);note(game,[3]);
  game.tiles=game.tiles.map(tile=>({...tile}));
  assert.equal(surfaceChangesSince(game,0),null);assert.equal(surfaceChangesSince(game,1),null);assert.equal(surfaceChangesSince(game,2),null);
  note(game,[4]);assert.deepEqual(list(surfaceChangesSince(game,2)),[4],'a new ring starts for the new tiles');assert.equal(surfaceChangesSince(game,1),null);
});

test('released groves report every footprint cell and keep the legacy count',()=>{
  const game=flatForest();allocateTerrainObjects(game);
  const sites=game.tiles.flatMap((tile,index)=>tile.terrainObject?[{x:index%game.width,y:Math.floor(index/game.width),object:tile.terrainObject}]:[]);
  const grove=sites.find(site=>site.object.footprint===3),pair=sites.find(site=>site.object.footprint===2);
  assert.ok(grove&&pair,'the forest holds 3×3 and 2×2 parcels');
  const cells=releaseTerrainObjectsCells(game,[{x:grove.x+2,y:grove.y+1},{x:grove.x,y:grove.y},{x:1000,y:1}]);
  assert.deepEqual(cells.sort((a,b)=>a-b),terrainObjectTiles(grove).map(p=>p.y*game.width+p.x).sort((a,b)=>a-b));
  assert.equal(terrainObjectAt(game,grove.x+1,grove.y+1),null);
  assert.equal(releaseTerrainObjects(game,[{x:pair.x+1,y:pair.y+1},{x:pair.x,y:pair.y}]),1);assert.deepEqual(releaseTerrainObjectsCells(game,[{x:pair.x,y:pair.y}]),[]);
});

test('ecology journals exactly its changed cells and dissolved grove footprints',()=>{
  const game=flatForest();allocateTerrainObjects(game);let days=0,dissolved=0;
  for(let day=1;day<=120;day++){
    game.day=day;const before=game.tiles.map(tile=>JSON.stringify(tile)),objects=game.tiles.map((_,index)=>terrainObjectAt(game,index%game.width,Math.floor(index/game.width))),revision=game.revision;
    const count=stepEcology(game);if(!count){assert.equal(game.revision,revision);continue;}
    const changes=new Set(surfaceChangesSince(game,revision)),changed=before.flatMap((json,index)=>json!==JSON.stringify(game.tiles[index])?[index]:[]);
    for(const index of changed)assert.ok(changes.has(index),`day ${day}: changed cell ${index} is journaled`);
    for(const index of changes){const was=objects[index];assert.ok(changed.includes(index)||(was&&!terrainObjectAt(game,index%game.width,Math.floor(index/game.width))),`day ${day}: ${index} changed or lost its grove`);}
    assert.ok(changes.size>=count);if(changes.size>count)dissolved++;days++;
  }
  assert.ok(days>20&&dissolved>0,'the sample covers ordinary days and dissolved groves');
});

// Recorded before the journal existed: the same seeded succession, day counts
// and final tiles. Noting changes must never alter a decision or a write.
test('stepEcology keeps identical tile state and random outcomes with the journal',()=>{
  const golden={
    grove:{counts:'1,1,1,1,1,0,1,1,0,0,1,0,0,1,1,1,2,0,2,0,2,0,0,0,1,0,0,4,0,1,1,0,0,0,0,2,2,1,1,0,3,0,1,0,2,0,2,2,0,1,1,0,0,2,1,0,1,0,0,1',left:84,revision:33,digest:'a6fec2ecdfd370bb'},
    taiga:{counts:'3,4,11,8,6,5,11,2,3,4,2,14,9,8,3,9,8,13,4,7,4,4,4,4,3,8,1,7,8,6,9,9,6,1,4,12,7,13,4,6,13,9,7,4,5,0,10,5,6,8,11,3,4,5,3,9,2,3,11,5',left:0,revision:60,digest:'bbc31873f43569d7'},
  };
  const games={grove:()=>{const game=flatForest();allocateTerrainObjects(game);return game;},taiga:()=>createGame({biome:'taiga',size:'regional',seed:1847})};
  for(const [name,make] of Object.entries(games)){
    const game=make(),counts=[];
    for(let day=1;day<=60;day++){game.day=day;counts.push(stepEcology(game));if(day%7===0)noteSurfaceChanges(game,game.revision,game.revision+1,[0]);}
    assert.deepEqual({counts:counts.join(','),left:game.tiles.filter(tile=>tile.terrainObject).length,revision:game.revision,digest:digest(game)},golden[name],name);
  }
});

test('terrain geometry keeps its height fields across ecology revisions only',()=>{
  const game=flatForest();game.tiles.forEach((tile,index)=>{tile.elevation=(index*7%5)/10+.2;});clearTerrainGeometryCache(game);
  const sample=()=>Array.from({length:40},(_,n)=>surfaceHeight(game,n%game.width+.25,(n*5)%game.height+.5));
  const heights=sample(),built=terrainGeometryStats(game).builtChunks;
  let day=1;for(const revision=game.revision;game.revision===revision;day++){game.day=day;stepEcology(game);}
  assert.deepEqual(sample(),heights);assert.equal(terrainGeometryStats(game).builtChunks,built,'an ecology day reuses every field');
  game.tiles[5].elevation=.9;game.revision++;
  sample();assert.ok(terrainGeometryStats(game).builtChunks>0&&terrainGeometryStats(game).builtChunks<=built,'an unjournaled revision starts a new cache');
  const fresh=structuredClone(game);assert.deepEqual(sample(),Array.from({length:40},(_,n)=>surfaceHeight(fresh,n%game.width+.25,(n*5)%game.height+.5)));
});

test('the view reads surface and site entries together; everything else still breaks its span',()=>{
  const game=world();
  note(game,[40,7]);let from=game.revision;game.revision++;noteSiteChanges(game,from,game.revision,[9,9,3]);note(game,[3,300]);
  const view=viewChangesSince(game,0);
  assert.deepEqual([list(view.surface),list(view.sites)],[[3,7,40,300],[3,9]]);
  assert.equal(surfaceChangesSince(game,0),null,'surface-only readers still see a site day as a gap');
  assert.deepEqual(list(surfaceChangesSince(game,2)),[3,300]);
  assert.deepEqual([list(viewChangesSince(game,3).surface),list(viewChangesSince(game,3).sites)],[[],[]]);
  game.revision++;assert.equal(viewChangesSince(game,0),null,'an unjournaled revision');
  assert.equal(viewChangesSince(world(),-1),null);
});

test('a town journals exactly the cells its new homes change',()=>{
  const town=emptyGame();build(town,'city',10,10);build(town,'residential',18,10);town.zones[0].progress=.99;build(town,'city',23,10);
  buildPath(town,'road',line(10,21,11));build(town,'bus-stop',10,11);build(town,'bus-stop',21,11);
  assert.equal(addRoute(town,{mode:'road',cargo:'passengers',stops:town.stations.map(stop=>stop.id)}).ok,true);
  let grown=0;
  for(let day=1;day<=90;day++){
    town.day=day;for(const city of town.cities){city.activity=20;city.lastServiceDay=day;}
    const before=town.tiles.map(tile=>JSON.stringify(tile)),r0=town.revision;stepSettlements(town);
    if(town.revision===r0)continue;
    const view=viewChangesSince(town,r0),sites=new Set(view.sites),changed=before.flatMap((json,index)=>json!==JSON.stringify(town.tiles[index])?[index]:[]);
    assert.equal(view.surface.length,0);
    for(const index of changed)assert.ok(sites.has(index),`day ${day}: changed cell ${index} is journaled`);
    grown++;
  }
  assert.ok(grown>0,'the towns built homes');
});
