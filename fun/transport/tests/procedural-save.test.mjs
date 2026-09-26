import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick, restoreGame, build, validateGame } from '../model.js';
import { encodeGame, decodeGame, encodeBytes, inspectSavedGame, rememberGeneratedWorld } from '../save-codec.js';

function stableState(game) {
  const {tiles,maintenanceRevision,...state}=game;
  return {...state,routes:state.routes.map(({pathRevision,...route})=>route)};
}
for (const biome of ['taiga','tundra','desert']) test(`${biome}: seeded saves preserve developed terrain, construction, deletion and future simulation`, () => {
  const game=createGame({biome,seed:80217,size:'square512'});
  rememberGeneratedWorld(game);
  const pristine=encodeGame(game);
  assert.equal(pristine.format,'transport-procedural-v1');
  assert.equal(pristine.tiles.count,0);
  tick(game,45.25);
  const site=game.tiles.findIndex(tile=>!tile.road&&!tile.building&&tile.terrain==='grass');
  assert.equal(build(game,'road',site%game.width,Math.floor(site/game.width)).ok,true);
  const tile=game.tiles[17];
  Object.assign(tile,{terrain:'grass',elevation:.123456789,detail:'future-detail',variant:42,publicRoad:false,building:null,zone:null,ecology:{age:19,species:['a','b']}});
  const home=game.tiles.find(t=>t.building);
  home.building={...home.building,populationCityId:game.cities[0].id,custom:{value:4}};
  const removed=game.tiles.find(t=>t.publicRoad&&!t.building);
  delete removed.publicRoad;
  const encoded=encodeGame(game);
  assert.ok(encoded.tiles.count>20,'actual local ecology generated changed cells');
  assert.ok(encoded.tiles.count<game.tiles.length/10);
  assert.ok(JSON.stringify(encoded).length<400_000);
  const restored=restoreGame(JSON.parse(JSON.stringify(encoded)));
  assert.ok(restored); assert.equal(validateGame(restored),true);
  assert.deepEqual(restored.tiles,game.tiles);
  assert.deepEqual(stableState(restored),stableState(game));
  tick(game,4.5); tick(restored,4.5);
  assert.deepEqual(restored.tiles,game.tiles);
  assert.deepEqual(stableState(restored),stableState(game));
  assert.deepEqual(encodeGame(restored),encodeGame(game),'restored baseline retains identical sparse patches');
  assert.equal(inspectSavedGame(encoded).money,encoded.state.money);
});

test('procedural descriptors and sparse patches reject corruption before regeneration', () => {
  const game=createGame({size:'square512',seed:37});
  rememberGeneratedWorld(game);
  game.tiles[0].detail='edited'; game.tiles[5].detail='other';
  const saved=encodeGame(game);
  const corruptions=[
    value=>value.generation.version=999,
    value=>value.generation.size='square4096',
    value=>value.generation.width=1024,
    value=>value.state.generationVersion=999,
    value=>value.state.generationVersion=1,
    value=>value.tiles.count=-1,
    value=>value.tiles.count=game.tiles.length+1,
    value=>value.tiles.indices=encodeBytes(new Uint8Array([0,0]),'utf16-15'),
    value=>value.tiles.indices=encodeBytes(new Uint8Array([0,255,255,255,127]),'utf16-15'),
    value=>value.tiles.data=value.tiles.data.slice(0,-1),
  ];
  for(const corrupt of corruptions){const value=structuredClone(saved);corrupt(value);assert.throws(()=>decodeGame(value),undefined,String(corrupt));assert.equal(restoreGame(value),null);}
});

test('the original seed describes geography even if the current simulation seed changes',()=>{
  const game=createGame({size:'square512',seed:73});rememberGeneratedWorld(game);
  game.seed=91873;game.tiles[16].detail='changed';
  const saved=encodeGame(game),loaded=decodeGame(saved);
  assert.equal(saved.generation.seed,73);assert.equal(loaded.seed,91873);
  assert.deepEqual(loaded.tiles,game.tiles);
  assert.equal(encodeGame(loaded).generation.seed,73);
});

test('version 1 companies keep their original geography and changes after the version 2 upgrade',()=>{
  const game=createGame({biome:'tundra',size:'square512',seed:1847,generationVersion:1});
  tick(game,17);
  game.tiles[17].detail='retained-old-world-edit';
  const encoded=encodeGame(game);
  assert.equal(encoded.generation.version,1);
  const restored=restoreGame(JSON.parse(JSON.stringify(encoded)));
  assert.ok(restored);
  assert.equal(restored.generationVersion,1);
  assert.deepEqual(restored.tiles,game.tiles);
  assert.deepEqual(stableState(restored),stableState(game));
  tick(game,3);tick(restored,3);
  assert.deepEqual(restored.tiles,game.tiles);
  assert.deepEqual(stableState(restored),stableState(game));
  assert.equal(encodeGame(restored).generation.version,1);
});

test('reverting terrain removes its sparse patch and repeated baseline capture never hides edits',()=>{
  const game=createGame({size:'square512',seed:291});
  const original={...game.tiles[game.tiles.length-1]};
  game.tiles[game.tiles.length-1]={...original,detail:'cleared',futureField:{revision:7}};
  rememberGeneratedWorld(game);
  assert.equal(encodeGame(game).tiles.count,1,'capture is idempotent and cannot reset an existing baseline');
  assert.deepEqual(decodeGame(encodeGame(game)).tiles[game.tiles.length-1],game.tiles[game.tiles.length-1]);
  game.tiles[game.tiles.length-1]=original;
  assert.equal(encodeGame(game).tiles.count,0,'no permanent dirty bit or redundant changed tile');
});
