import test from 'node:test';
import assert from 'node:assert/strict';
import { packFleet,readFleet } from '../fleet-save-codec.js';
import { createGame,restoreGame } from '../model.js';
import { encodeGame,decodeGame,inspectSavedGame,encodeBytes,decodeBytes } from '../save-codec.js';

function company() {
  const game=createGame({size:'regional'}),original=game.vehicles[0];
  game.vehicles=Array.from({length:128},(_,i)=>({...original,id:`vehicle-${i+1000}`,progress:(i%24)+.12345678901234567,x:55+(i%24)+.12345678901234567,load:i%25}));
  game.vehicles[3].future={cargo:['new'],value:null};game.vehicles[4].lastUpgradeDay=0;
  return game;
}

test('vehicle schemas preserve all numeric precision, optional fields and unknown nested data',()=>{
  const game=company(),packed=packFleet(game);
  assert.ok(Array.isArray(packed.vehicles[0]));
  assert.equal(packed.vehicleSchemas.length,3);
  assert.ok(JSON.stringify(packed.vehicles).length<JSON.stringify(game.vehicles).length*.6);
  assert.equal(readFleet(packed),packed,'metadata validation never rebuilds vehicle objects');
  assert.deepEqual(readFleet(JSON.parse(JSON.stringify(packed)),{expand:true}),game);
  assert.equal(Array.isArray(game.vehicles[0]),false,'the running fleet is untouched');
});

test('large fleet saves integrate with normal game restoration and metadata listing',()=>{
  const game=company(),saved=encodeGame(game);
  assert.ok(saved.state.vehicleSchemas);
  assert.ok(saved.state.vehicleNumbers,'fractional fields retain their exact binary precision');
  assert.equal(inspectSavedGame(saved).vehicles.length,128);
  assert.deepEqual(decodeGame(saved),game);
  assert.ok(restoreGame(saved));
});

test('binary vehicle numbers reject nonfinite values, altered counts and truncated data',()=>{
  const game=company();for(const vehicle of game.vehicles)vehicle.angle=-0;
  const packed=packFleet(game,{encodeBytes});
  assert.deepEqual(readFleet(JSON.parse(JSON.stringify(packed)),{expand:true,decodeBytes}),game,'signed zero survives JSON too');
  for(const edit of [g=>g.vehicleNumbers.count++,g=>g.vehicleNumbers.data=g.vehicleNumbers.data.slice(0,-1),g=>{
    const bytes=decodeBytes(g.vehicleNumbers.data,'utf16-15');new DataView(bytes.buffer).setFloat64(0,NaN,true);g.vehicleNumbers.data=encodeBytes(bytes,'utf16-15');
  }]) {
    const changed=structuredClone(packed);edit(changed);
    assert.throws(()=>readFleet(changed,{decodeBytes}));
    assert.throws(()=>readFleet(changed,{expand:true,decodeBytes}));
  }
});

test('legacy fleets and data that cannot be represented retain their existing JSON',()=>{
  const game=company();game.vehicles.length=4;
  assert.equal(packFleet(game),game);assert.equal(readFleet(game,{expand:true}),game);
  const unsupported=company();unsupported.vehicles[0].future=undefined;
  assert.equal(packFleet(unsupported),unsupported);
});

test('malformed schemas and record widths fail before allocating vehicles',()=>{
  const saved=packFleet(company());
  for(const edit of [g=>g.vehicleSchemas=null,g=>g.vehicleSchemas[0].push('id'),g=>g.vehicleSchemas[0][0]=null,g=>g.vehicles[0][0]=256,g=>g.vehicles[0].pop(),g=>g.vehicles[0]=null]) {
    const corrupt=structuredClone(saved);edit(corrupt);
    assert.throws(()=>readFleet(corrupt),/saved vehicle/);
    assert.throws(()=>readFleet(corrupt,{expand:true}),/saved vehicle/);
  }
});
