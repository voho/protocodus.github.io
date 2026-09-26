import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, INDUSTRIES, WORLD_SIZES, createGame, build, tileAt, tick, validateGame, saveGame, loadGame, SAVE_KEY } from '../model.js';
import { encodeGame, decodeGame } from '../save-codec.js';

function stored(run) {
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map();
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
  Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
  try {run(storage);} finally {if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;}
}
function stable(game) {
  const copy=structuredClone(game);delete copy.maintenanceRevision;
  for(const route of copy.routes)delete route.pathRevision;
  return copy;
}

test('all supported sizes provide dispersed towns, complete industries and the same short starter service',()=>{
  for(const [size,dimensions] of Object.entries(WORLD_SIZES)) {
    const game=createGame({size,seed:19281});
    assert.equal(game.width,dimensions.width);assert.equal(game.height,dimensions.height);
    assert.equal(game.size,size);assert.equal(validateGame(game),true);
    assert.equal(game.routes[0].path.length,25);
    assert.ok(game.cities.length>=(size==='huge'?30:size==='large'?16:8));
    assert.ok(Math.max(...game.cities.map(c=>c.x))-Math.min(...game.cities.map(c=>c.x))>game.width*.5);
    assert.ok(Math.max(...game.cities.map(c=>c.y))-Math.min(...game.cities.map(c=>c.y))>game.height*.5);
    const industries=new Set(game.industries.map(i=>i.kind));
    for(const [kind,definition] of Object.entries(INDUSTRIES))if(definition.biomes.includes(game.biome))assert.ok(industries.has(kind));
    assert.deepEqual(new Set(game.tiles.flatMap(tile=>tile.building?[tile.building.kind]:[])),new Set(Object.keys(BUILDINGS)));
  }
});

test('every house, civic building, shop and service can be built with its listed cost',()=>{
  const game=createGame({size:'regional'});game.money=1e7;
  for(const [kind,definition] of Object.entries(BUILDINGS)) {
    const x=5,y=5,tile=tileAt(game,x,y);
    Object.assign(tile,{terrain:'grass',building:null,zone:null,road:false,rail:false});
    const before=game.money,result=build(game,kind,x,y);
    assert.equal(result.ok,true,`${kind}: ${result.message}`);
    assert.deepEqual(tile.building,{kind,level:1});
    assert.equal(game.money,before-definition.cost);
    assert.equal(build(game,kind,x,y).ok,false,'occupied plots remain protected');
    tile.building=null;tile.terrain='water';
    assert.equal(build(game,kind,x,y).ok,false,'town buildings cannot float on water');
  }
  assert.equal(validateGame(game),true);
});

test('transport-driven growth preserves civic landmarks and never downgrades expensive homes',()=>{
  const game=createGame({size:'regional'}),city=game.cities[0];
  const home=tileAt(game,city.x+1,city.y+1),landmark=tileAt(game,city.x-1,city.y-1);
  home.building={kind:'house-expensive-3',level:1};landmark.building={kind:'hospital',level:1};
  tick(game,240);
  assert.equal(landmark.building.kind,'hospital');
  assert.ok(home.building.kind.startsWith('house-expensive'));
  assert.ok(city.population>740);
});

test('huge games save losslessly under the browser quota and resume the identical economy',()=>stored(storage=>{
  const game=createGame({size:'huge',seed:38723});tick(game,45);
  // Include precision and optional-property cases that packed lanes must never round or discard.
  Object.assign(game.tiles[0],{elevation:Math.PI,variant:42,detail:'custom-reeds'});
  assert.equal(saveGame(game).ok,true);
  const encoded=storage.getItem(SAVE_KEY);
  assert.ok(encoded.length<2_000_000,`packed huge world uses ${encoded.length} characters`);
  const restored=loadGame();assert.ok(restored);
  assert.deepEqual(stable(restored),stable(game));
  tick(game,30);tick(restored,30);assert.deepEqual(stable(restored),stable(game));
}));

test('legacy 100 × 72 JSON companies still load with their original terrain and buildings',()=>stored(storage=>{
  const game=createGame({size:'regional'}),originalWidth=game.width;
  game.tiles=game.tiles.filter((tile,index)=>index%originalWidth<100&&Math.floor(index/originalWidth)<72);
  game.width=100;game.height=72;delete game.size;
  for(const key of ['cities','industries'])game[key]=game[key].filter(item=>item.x<100&&item.y<72);
  for(const tile of game.tiles) {delete tile.detail;delete tile.publicRoad;if(tile.building)tile.building={kind:'house',level:1};}
  assert.equal(validateGame(game),true);
  storage.setItem(SAVE_KEY,JSON.stringify(game));
  const restored=loadGame();assert.ok(restored);assert.deepEqual(stable(restored),stable(game));
  assert.equal(saveGame(restored).ok,true);assert.deepEqual(stable(loadGame()),stable(restored));
}));

test('packed save corruption cannot fabricate terrain or allocate unsupported worlds',()=>{
  const encoded=encodeGame(createGame({size:'regional'}));
  const badLength=structuredClone(encoded);badLength.tiles.data=badLength.tiles.data.slice(4);
  assert.throws(()=>decodeGame(badLength));
  const badDimensions=structuredClone(encoded);badDimensions.state.width=100000;
  assert.throws(()=>decodeGame(badDimensions));
  const badPalette=structuredClone(encoded);badPalette.tiles.elevations=[null];
  assert.throws(()=>decodeGame(badPalette));
  const unknownSize=createGame({size:'regional'});unknownSize.size='impossible';assert.equal(validateGame(unknownSize),false);
});
