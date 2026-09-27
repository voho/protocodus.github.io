import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../model.js';
import { encodeGame, decodeGame, encodeBytes, decodeBytes, inspectSavedGame } from '../save-codec.js';
import { createTerrainTile, generatedElevation } from '../world-tiles.js';

test('shared generated numbers retain ordinary independent mutable tile semantics',()=>{
  for(const value of [0,-0,1/1024,.25,1,2,2.1,.123456789,NaN,Infinity])assert.ok(Object.is(generatedElevation(value),value));
  const a=createTerrainTile('grass',.25,'',4),b=createTerrainTile('grass',.25,'',4);
  assert.equal(Object.getPrototypeOf(a),Object.prototype);
  assert.deepEqual(Object.keys(a),['terrain','elevation','detail','variant','road','rail','bridge','tunnel','building','zone']);
  a.elevation=.123456789;a.road=true;
  assert.equal(b.elevation,.25);assert.equal(b.road,false);
  assert.equal(JSON.stringify(b),'\u007b"terrain":"grass","elevation":0.25,"detail":"","variant":4,"road":false,"rail":false,"bridge":false,"tunnel":false,"building":null,"zone":null}');
});

test('four-byte run encoding preserves arbitrary bytes, unaligned views and tails',()=>{
  for(const size of [0,1,2,3,4,5,7,8,9,511,512,513,516,4097,65539])for(const repeated of [false,true]){
    const storage=new Uint8Array(size+1),bytes=storage.subarray(1);
    for(let i=0;i<size;i++)bytes[i]=repeated?(i%4===3?17:0):(i*197+(i>>4)*31)&255;
    const encoded=encodeBytes(bytes,'utf16-15-rle');
    assert.deepEqual(decodeBytes(encoded,'utf16-15-rle',size),bytes);
    assert.throws(()=>decodeBytes(encoded,'utf16-15-rle',size+1));
  }
  // Valid UTF16 envelopes containing invalid run frames must be rejected.
  for(const bytes of [[128],[255,255,255,255,127],[4],[4,129,0,0,0,0],[4,0,0,0],[0,1]])assert.throws(()=>decodeBytes(encodeBytes(Uint8Array.from(bytes),'utf16-15'),'utf16-15-rle'));
});

function developed(biome){
  const game=createGame({biome,seed:1847,size:'square512'}),land=biome==='taiga'?'grass':biome==='tundra'?'snow':'sand';
  for(let y=0;y<game.height;y++)for(let x=0;x<game.width;x++){
    if(x%8&&y%8)continue;const tile=game.tiles[y*game.width+x];
    tile.road=true;tile.rail=true;
    if(tile.terrain==='water')tile.bridge=true;if(tile.terrain==='mountain')tile.tunnel=true;
    if(tile.terrain==='forest'){tile.terrain=land;tile.detail='';}
    delete tile.terrainObject;
  }
  return game;
}

for(const biome of ['taiga','tundra','desert'])test(`${biome}: a continent-wide connected network saves losslessly as small baseline deltas`,()=>{
  const game=developed(biome),home=game.tiles.find(t=>t.building),road=game.tiles.find(t=>t.publicRoad);
  home.building={...home.building,custom:{history:[1,2,3]}};
  delete road.publicRoad;game.tiles[8].futureField={nested:{value:7}};
  const saved=encodeGame(game);
  assert.equal(saved.format,'transport-procedural-v1');assert.equal(saved.tiles.layout,'baseline-xor-v1');
  assert.ok(saved.tiles.count>50_000);assert.ok(JSON.stringify(saved).length<200_000,'dense flags do not repeat the generated landscape');
  assert.equal(inspectSavedGame(saved).seed,game.seed);
  const loaded=decodeGame(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(loaded.tiles,game.tiles);
  assert.deepEqual(encodeGame(loaded),saved,'loaded deltas retain the same original recipe baseline');
});

test('dense edits with arbitrary precision or new terrain details use the original lossless tile layout',()=>{
  const game=developed('taiga');game.tiles[8].elevation=.123456789;game.tiles[16].detail='future-habitat';
  const saved=encodeGame(game);assert.equal(saved.tiles.layout,undefined);
  assert.deepEqual(decodeGame(saved).tiles,game.tiles);
});

test('dense delta corruption rejects bad core bits, duplicate extras, core overrides and truncated data',()=>{
  const saved=encodeGame(developed('taiga'));
  const changes=[
    s=>s.tiles.layout='unknown',
    s=>s.tiles.data=s.tiles.data.slice(0,-1),
    s=>s.tiles.extras=[[0,{}],[0,{}]],
    s=>s.tiles.extras=[[0,{elevation:9}]],
    s=>{const bytes=decodeBytes(s.tiles.data,s.tiles.encoding);bytes[3]|=128;s.tiles.data=encodeBytes(bytes,s.tiles.encoding);},
  ];
  for(const change of changes){const value=structuredClone(saved);change(value);assert.throws(()=>decodeGame(value));}
});
